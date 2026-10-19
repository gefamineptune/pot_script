try {
    const moment = modules.moment;
    const seq = modules.sequelize;
    const { In } = operators;

    // ----------------------------------------------------
    // Database Connection & Fetch DWH Data
    // ----------------------------------------------------
    const DB_HOST = await vault.decrypt("DB-HOST");
    const DB_USER = await vault.decrypt("DB-USER");
    const DB_PASS = await vault.decrypt("DB-PASS");

    const sequelize = new seq("DWH_BUSDAT", DB_USER, DB_PASS, {
        host: DB_HOST,
        dialect: "mssql",
        logging: false,
        dialectOptions: {
            options: {
                encrypt: false,
                trustServerCertificate: true
            }
        }
    });

    await sequelize.authenticate(); // Authenticate the connection

    let customer_po, allocation, doToBilShip; // Store the query results
    try {
        [customer_po] = await sequelize.query(`SELECT * FROM dt_gld.customer_po_list`);
        [allocation] = await sequelize.query(`SELECT * FROM dt_gld.allocation`);
        [doToBilShip] = await sequelize.query(`SELECT * FROM dt_gld.do_to_bil_ship`);
    } catch (error) {
        try { await sequelize.close(); } catch (e) {} // Close the connection before return
        console.log(JSON.stringify({ success: false, message: "Failed to fetch data from DWH. Check if tables exist.", error: error.message, stack: error.stack }, null, 4));
        result.statusCode = 500;
        result.data = { success: false, message: "Failed to fetch data from DWH. Check if tables exist.", error: error.message, stack: error.stack };
        complete();
        return;
    }

    // Early Exit Guard: If no customer PO data found, skip sync
    if (!customer_po || customer_po.length === 0) {
        try { await sequelize.close(); } catch (e) {} // Close the connection before return
        console.log("No customer PO data found in DWH. Sync skipped");
        result.statusCode = 200;
        result.data = { success: true, message: "Sync completed successfully. No customer PO data to sync from DWH." };
        complete();
        return;
    }

    try { await sequelize.close(); } catch (e) {} // Close the connection

    // ----------------------------------------------------
    // Helper Functions
    // ----------------------------------------------------
    function cleanDate(dateStr) {
        if (!dateStr) return null;
        const cleaned = String(dateStr).trim();
        if (!cleaned) return null;
        return cleaned.split(' ')[0]; // Ambil hanya YYYY-MM-DD
    }

    function combineDateTime(dateStr, timeStr) {
        if (!dateStr) return null;
        if (!timeStr) return cleanDate(dateStr); // Fallback ke date saja
        const date = String(dateStr).trim();
        const time = String(timeStr).trim();
        return `${date} ${time}`; // Format: YYYY-MM-DD HH:mm:ss
    }

    function cleanNumber(numStr) {
        if (numStr === null || numStr === undefined || numStr === '') return 0;
        const num = Number(numStr);
        return isNaN(num) ? 0 : num;
    }

    function mapSourcingType(type) {
        if (!type) return null;
        const t = String(type).trim().toUpperCase();
        if (t === 'TP') return 'TP';
        if (t === 'PO-STO' || t === 'MPO-STO') return 'PO STO';
        if (t === 'PR') return 'PR';
        return null;
    }

    function mapSourcingVariant(subType) {
        if (!subType) return '';
        const t = String(subType).trim();
        if (t.toLowerCase().includes('indirect')) return 'PR Indirect';
        if (t.toLowerCase().includes('direct')) return 'PR Direct';
        return '';
    }

    function toDate(value) {
        if (!value) return null;
        const date = new Date(value);
        return isNaN(date.getTime()) ? null : date;
    }

    function addCalendarDays(date, days) {
        const result = toDate(date);
        if (!result) return null;
        result.setDate(result.getDate() + Number(days || 0));
        return result;
    }

    function addWorkingDays(date, days) {
        const result = toDate(date);
        if (!result) return null;

        const remainingDays = Number(days || 0);
        // days = 0 → return tanggal asli, termasuk jika tanggalnya weekend
        if (remainingDays === 0) {
            return result;
        }

        let remaining = remainingDays;
        while (remaining > 0) {
            result.setDate(result.getDate() + 1);
            if (result.getDay() !== 0 && result.getDay() !== 6) {
                remaining--;
            }
        }

        return result;
    }

    function formatDate(date) {
        if (!date) return null;
        return moment(date).format("YYYY-MM-DD");
    }

    function normalize(value) {
        return String(value ?? "").trim().toLowerCase();
    }

    // ----------------------------------------------------
    // CONFIG
    // ----------------------------------------------------
    const STATUS = {
        PO_RECEIVED: "PO_RECEIVED",
        PROCESSING: "PROCESSING",
        READY_AT_WAREHOUSE: "READY_AT_WAREHOUSE",
        SHIPPED: "SHIPPED",
        DELIVERED: "DELIVERED"
    };

    const SOURCING = { PR: "PR", PO_STO: "PO STO", TP: "TP" };

    const ETA_TYPE = {
        ETA1_PR: "ETA1_PR",
        ETA2_PR: "ETA2_PR",
        ETA3_PR: "ETA3_PR",
        ETA1_PO_STO: "ETA1_PO_STO",
        ETA2_PO_STO: "ETA2_PO_STO",
        ETA_TP: "ETA_TP",
        ETA_BILLING: "ETA_BILLING",
        TBA: "TBA",
        NULL: "NULL"
    };

    // --------------------------------------------------
    // Get Order Status
    // --------------------------------------------------
    const statusList = await entities.pot_master_order_status.find();
    const statusCodeToId = {};
    const statusByIdMap = {};
    statusList.forEach(status => {
        statusCodeToId[status.status_code] = status.id;
        statusByIdMap[status.id] = status;
    });

    // --------------------------------------------------
    // Get Customer
    // --------------------------------------------------
    const customerList = await entities.pot_customer.find();
    const customerMap = {};
    customerList.forEach(data => { customerMap[data.customer_code] = data; });

    // --------------------------------------------------
    // Get Customer Group
    // --------------------------------------------------
    const customerGroupList = await entities.pot_customer_group.find();
    const customerGroupMap = {};
    customerGroupList.forEach(data => { customerGroupMap[data.id] = data; });

    // ----------------------------------------------------
    // Get Lead Times
    // ----------------------------------------------------
    const allGeneralLT = await entities.pot_eta_lead_time_general.find();
    const allTPLT = await entities.pot_eta_lead_time_tp.find();
    const allPOSTOLT = await entities.pot_eta_lead_time_po_sto.find();
    const allPRLT = await entities.pot_eta_lead_time_pr.find();

    function getLT_General() {
        const billing = Number(allGeneralLT.find(x => x.lead_time === "LT Billing")?.total_days) || 0;
        const delivery = Number(allGeneralLT.find(x => x.lead_time === "LT Delivery")?.total_days) || 0;
        return { lt_BILLING: billing, lt_DELIVERY: delivery };
    }

    function getLT_TP(plant) {
        return allTPLT.find(x => x.Plant === plant) || {};
    }

    function getLT_POSTO(fromPlant, toPlant, moda, modaDefault) {
        const normFrom = normalize(fromPlant);
        const normTo = normalize(toPlant);
        const normModa = normalize(moda);
        
        // Cek apakah dari atau ke JKT
        const isJKT = normFrom === 'jkt' && normTo === 'jkt';

        // 1. Jika diminta default, ATAU (moda kosong/null DAN melibatkan JKT), langsung ambil moda default
        if (modaDefault === "Y" || ((normModa === "" || normModa === null) && isJKT)) {
            const foundDefault = allPOSTOLT.find(x => 
                normalize(x.from_plant) === normFrom && 
                normalize(x.to_plant) === normTo && 
                normalize(x.moda_default) === "y"
            );
            if (foundDefault) return foundDefault;
        }

        // 2. Cari berdasarkan moda spesifik
        let found = allPOSTOLT.find(x => 
            normalize(x.from_plant) === normFrom && 
            normalize(x.to_plant) === normTo && 
            normalize(x.moda) === normModa
        );

        return found || {};
    }

    function getLT_PR(materialType, plantPR, plantPO, labOffice, poType, vendorCode, pr_poDate) {
        const normMaterialType = normalize(materialType);
        const normPlantPR = normalize(plantPR);
        const normLabOffice = normalize(labOffice);
        const normPlantPO = normalize(plantPO);
        const normPoType = normalize(poType);
        const normVendorCode = normalize(vendorCode);

        // 1. Jika pr_poDate ADA, coba filter dengan SEMUA parameter (Strict Match)
        if (pr_poDate) {
            const foundStrict = allPRLT.find(x =>
                normalize(x.material_type) === normMaterialType &&
                normalize(x.plant_pr) === normPlantPR &&
                normalize(x.lab_office) === normLabOffice &&
                normalize(x.plant_po) === normPlantPO &&
                normalize(x.po_type) === normPoType &&
                normalize(x.vendor_code) === normVendorCode
            );
            if (foundStrict) return foundStrict;
        }

        // 2. Cari Default Match berdasarkan 3 kombinasi utama
        const foundDefaultBase = allPRLT.find(x =>
            normalize(x.material_type) === normMaterialType &&
            normalize(x.plant_pr) === normPlantPR &&
            normalize(x.lab_office) === normLabOffice
        );

        if (foundDefaultBase) {
            // Ambil nilai default dari hasil pencarian pertama
            const refPoType = foundDefaultBase.default_po_type; 
            const refPlantPO = foundDefaultBase.default_plant_po;
            const refVendorCode = foundDefaultBase.default_vendor_code;

            // 3. Filter Ulang (Refined Search) menggunakan nilai default sebagai tambahan filter
            // Kita cari baris di allPRLT yang cocok dengan 3 kombinasi awal + nilai referensi dari default
            const foundRefined = allPRLT.find(x =>
                normalize(x.material_type) === normMaterialType &&
                normalize(x.plant_pr) === normPlantPR &&
                normalize(x.lab_office) === normLabOffice &&
                normalize(x.plant_po) === normalize(refPlantPO) &&
                normalize(x.po_type) === normalize(refPoType) &&
                normalize(x.vendor_code) === normalize(refVendorCode)
            );

            // Jika ditemukan hasil yang lebih spesifik berdasarkan referensi default, kembalikan itu
            if (foundRefined) {
                return foundRefined;
            }

            // Jika tidak ditemukan hasil refined, kembalikan hasil default dasar (3 kombinasi)
            // return foundDefaultBase;
        }

        // 4. Jika semuanya gagal, kembalikan objek kosong
        return {};
    }

    // ----------------------------------------------------
    // ETA PR
    // ----------------------------------------------------
    function calculateETAPR(process, etaHistory) {
        const leadTimePR_data = getLT_PR(process.material_type, process.pr_plant, process.po_plant, process.lab_office, process.po_type, process.vendor_code, process.po_date_pr);

        if (Object.keys(leadTimePR_data).length === 0) {
            etaHistory.push({
                eta_type: ETA_TYPE.NULL,
                base_date: process.pr_date,
                eta_date: null,
                eta_date_formatted: null,
                leadTimePR_data
            });
            return;
        }

        const { lt_BILLING, lt_DELIVERY } = getLT_General();
        const lt_PR_TO_PO = leadTimePR_data?.pr_po || 0;
        const lt_PO_TO_MIGO107 = leadTimePR_data?.po_migo_107 || 0;
        const lt_MIGO107_TO_MIGO109 = leadTimePR_data?.migo_107_migo_109 || 0;
        const lt_MIGO109_TO_CONFIRM_IN = leadTimePR_data?.migo_109_confirm_to || 0;
        const lt_CONFIRM_IN_TO_UU = leadTimePR_data?.confirm_to_to_confirm_uu || 0;

        const leadTimePOSTO_Default = process.po_date_pr 
            ? getLT_POSTO(process.po_plant, process.sales_office, process.moda, "Y")
            : {};
        const lt_PO_TO_TO = leadTimePOSTO_Default?.po_sto_to_po_sto || 0;
        const lt_TO_TO_CONFIRM_OUT = leadTimePOSTO_Default?.po_sto_to_out_confirm || 0;
        const lt_CONFIRM_OUT_TO_SPB = leadTimePOSTO_Default?.out_confirm_to_create_spb || 0;
        const lt_SPB_TO_GI = leadTimePOSTO_Default?.create_spb_to_gi || 0;
        const lt_SHIPMENT_TO_MIGO101 = leadTimePOSTO_Default?.gi_to_gr || 0; // FSD: Calendar Days
        const lt_MIGO101_TO_CONFIRM_IN = leadTimePOSTO_Default?.gr_to_in_confirm || 0;
        const lt_CONFIRM_IN_TO_UU_POSTO = leadTimePOSTO_Default?.in_confirm_to_confirm_uu || 0;

        // Cek apakah PO Type adalah ZPLP
        const isZPLP = process.po_type === 'ZPLP';

        // Material Type Section 1 & 2 (Trigger TBA jika PR->PO > 2x LT Matrix)
        const section1MaterialTypes = [
            'ZPBT', 'ZPLG', 'ZPCN', 'ZPMF', 'ZPFG', 'ZPPE', 'ZPGD', 'ZPRD', 
            'ZPHC', 'ZPRX', 'ZPIR', 'ZPTY', 'ZPKB', 'ZPRL', 'ZPLB', 'ZPTB'
        ];
        
        // PO Type dengan multiplier 2x
        const poTypeMultiplier2 = ['ZEVO', 'ZEAJ', 'ZSAI'];
        
        // PO Type dengan multiplier 1x
        const poTypeMultiplier1 = ['ZSSE', 'ZESE', 'ZPPO', 'ZPLP'];
        
        // Material Type Section 2.1 (langsung TBA sampai MIGO 107 / MIGO 109)
        const section_2_1_MaterialTypes = ['ZPCB', 'ZPKD', 'ZPKT', 'ZPOL', 'ZPAT', 'ZPGR'];
        
        // Material Type Section 2.2 (Trigger TBA jika PR->PO > 2x LT Matrix)
        const section_2_2_MaterialTypes = [
            'ZPBT', 'ZPLG', 'ZPCN', 'ZPMF', 'ZPFG', 'ZPPE', 'ZPGD', 'ZPRD', 
            'ZPHC', 'ZPRX', 'ZPIR', 'ZPTY', 'ZPKB', 'ZPRL', 'ZPLB', 'ZPTB'
        ];

        // Tentukan target tanggal dan lead time berdasarkan kondisi ZPLP
        const targetMigoDate = isZPLP ? process.migo109_date : process.migo107_date;
        const targetMigoName = isZPLP ? "MIGO 109" : "MIGO 107";

        // Jika ZPLP, lead time dari PO langsung menggunakan lt_MIGO109_TO_CONFIRM_IN 
        const effectiveLtPoToMigo = isZPLP ? lt_MIGO109_TO_CONFIRM_IN : lt_PO_TO_MIGO107;

        // --------------------------------------------------
        // SECTION 2.1: Kondisi Direct TBA sampai MIGO 107 / MIGO 109
        // --------------------------------------------------
        if (section_2_1_MaterialTypes.includes(process.material_type)) {
            if (!targetMigoDate) {
                etaHistory.push({
                    eta_type: ETA_TYPE.TBA,
                    base_date: process.pr_date,
                    eta_date: null,
                    eta_date_formatted: "TBA",
                    reason: `Material type ${process.material_type}: TBA sampai ${targetMigoName} terbit`,
                });
                return;
            }
        }

        // --------------------------------------------------
        // SECTION 2.2: Kondisi Special Threshold (Aturan Baru: PR-PO > 2x LT Matrix PR-PO)
        // --------------------------------------------------
        if (section_2_2_MaterialTypes.includes(process.material_type) && process.pr_date) {
            // Hitung tanggal batas: PR Date + (2 x Lead Time PR ke PO)
            const thresholdDays = lt_PR_TO_PO * 2;
            const thresholdDate = addWorkingDays(process.pr_date, thresholdDays);

            // Normalisasi kedua tanggal ke 00:00:00 untuk perbandingan murni tanggal
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const compareThreshold = new Date(thresholdDate);
            compareThreshold.setHours(0, 0, 0, 0);

            // Cek apakah sudah LEWAT threshold dan belum ada Target MIGO
            if (today > compareThreshold && !process.po_date_pr) {
                etaHistory.push({
                    eta_type: ETA_TYPE.TBA,
                    base_date: process.pr_date,
                    eta_date: null,
                    eta_date_formatted: "TBA",
                    reason: `Melewati batas waktu PR ke PO (${thresholdDays} hari kerja / 2x LT Matrix)`,
                    thresholdDate: formatDate(thresholdDate),
                    leadTime: { lt_PR_TO_PO },
                });
                return;
            }
        }

        // --------------------------------------------------
        // SECTION 1: PO ke Target MIGO dengan multiplier
        // --------------------------------------------------
        if (section1MaterialTypes.includes(process.material_type) && process.pr_date) {
            let multiplier = 0;
            if (poTypeMultiplier2.includes(process.po_type)) {
                multiplier = 2;
            } else if (poTypeMultiplier1.includes(process.po_type)) {
                multiplier = 1;
            }

            if (multiplier > 0 && process.po_date_pr) {
                // Hitung threshold: PO Date + 22 hari kerja + (PO → Target MIGO × multiplier)
                const thresholdDays = 22 + (effectiveLtPoToMigo * multiplier);
                const thresholdDate = addWorkingDays(process.po_date_pr, thresholdDays);

                // Normalisasi kedua tanggal ke 00:00:00 untuk perbandingan murni tanggal
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const compareThreshold = new Date(thresholdDate);
                compareThreshold.setHours(0, 0, 0, 0);

                // Cek apakah sudah LEWAT threshold dan belum ada Target MIGO
                if (today > compareThreshold && !targetMigoDate) {
                    etaHistory.push({
                        eta_type: ETA_TYPE.TBA,
                        base_date: process.po_date_pr,
                        eta_date: null,
                        eta_date_formatted: "TBA",
                        reason: `Melewati threshold ${thresholdDays} hari kerja (22 + ${effectiveLtPoToMigo} × ${multiplier})`,
                        thresholdDate: formatDate(thresholdDate),
                        leadTime: { effectiveLtPoToMigo },
                    });
                    return;
                }
            }
        }

        // --------------------------------------------------
        // ETA #1 PR
        // PR Date + LTM PR + Billing + Delivery (Case PR Direct)
        // PR Date + LTM PR + LTM POSTO Default + Billing + Delivery (Case PR Indirect)
        // --------------------------------------------------
        if (process.pr_date) {
            // Case ketika mulai PR
            let leadTimePOSTO_Default = {};
            const foundDefaultBase = allPRLT.find(x =>
                normalize(x.material_type) === normalize(process.material_type) &&
                normalize(x.plant_pr) === normalize(process.pr_plant) &&
                normalize(x.lab_office) === normalize(process.lab_office)
            );

            if (foundDefaultBase) {
                const default_po_plant = foundDefaultBase.default_plant_po;

                // Case PR Indirect
                if (default_po_plant !== process.sales_office) {
                    leadTimePOSTO_Default = getLT_POSTO(default_po_plant, process.sales_office, process.moda, "Y");
                    const lt_PO_TO_TO = leadTimePOSTO_Default?.po_sto_to_po_sto || 0;
                    const lt_TO_TO_CONFIRM_OUT = leadTimePOSTO_Default?.po_sto_to_out_confirm || 0;
                    const lt_CONFIRM_OUT_TO_SPB = leadTimePOSTO_Default?.out_confirm_to_create_spb || 0;
                    const lt_SPB_TO_GI = leadTimePOSTO_Default?.create_spb_to_gi || 0;
                    const lt_SHIPMENT_TO_MIGO101 = leadTimePOSTO_Default?.gi_to_gr || 0; // FSD: Calendar Days
                    const lt_MIGO101_TO_CONFIRM_IN = leadTimePOSTO_Default?.gr_to_in_confirm || 0;
                    const lt_CONFIRM_IN_TO_UU_POSTO = leadTimePOSTO_Default?.in_confirm_to_confirm_uu || 0;

                    const lt_isZPLP = !isZPLP ? (lt_PO_TO_MIGO107 + lt_MIGO107_TO_MIGO109 + lt_MIGO109_TO_CONFIRM_IN) : lt_MIGO109_TO_CONFIRM_IN;
                    let etaDate = addWorkingDays(
                        process.pr_date,
                        lt_PR_TO_PO + lt_isZPLP + lt_CONFIRM_IN_TO_UU
                    );

                    // PO STO -> Create TO -> Confirm TO Out -> Create SPB -> SPB -> GI
                    etaDate = addWorkingDays(
                        etaDate,
                        lt_PO_TO_TO + lt_TO_TO_CONFIRM_OUT + lt_CONFIRM_OUT_TO_SPB + lt_SPB_TO_GI
                    );

                    // GI -> MIGO 101
                    etaDate = addCalendarDays(etaDate, lt_SHIPMENT_TO_MIGO101);

                    // MIGO 101 -> Confirm TO In -> UU / Block -> Billing -> Delivery
                    etaDate = addWorkingDays(
                        etaDate,
                        lt_MIGO101_TO_CONFIRM_IN + lt_CONFIRM_IN_TO_UU_POSTO + lt_BILLING + lt_DELIVERY
                    );

                    etaHistory.push({
                        eta_type: ETA_TYPE.ETA1_PR,
                        sourcing_sub_type: process.sourcing_sub_type,
                        base_date: process.pr_date,
                        eta_date: etaDate,
                        eta_date_formatted: formatDate(etaDate),
                        isZPLP,
                        leadTime: {
                            lt_PR_TO_PO,
                            lt_PO_TO_MIGO107,
                            lt_MIGO107_TO_MIGO109,
                            lt_MIGO109_TO_CONFIRM_IN,
                            lt_CONFIRM_IN_TO_UU,
                            lt_PO_TO_TO,
                            lt_TO_TO_CONFIRM_OUT,
                            lt_CONFIRM_OUT_TO_SPB,
                            lt_SPB_TO_GI,
                            lt_SHIPMENT_TO_MIGO101,
                            lt_MIGO101_TO_CONFIRM_IN,
                            lt_CONFIRM_IN_TO_UU_POSTO,
                            lt_BILLING,
                            lt_DELIVERY,
                            leadTimePR_data,
                            leadTimePOSTO_Default
                        }
                    });
                } 
                // Case PR Direct
                else {
                    // Menggunakan lead time yang sudah disesuaikan (langsung ke 109 jika ZPLP)
                    const lt_isZPLP = !isZPLP ? (lt_PO_TO_MIGO107 + lt_MIGO107_TO_MIGO109 + lt_MIGO109_TO_CONFIRM_IN) : lt_MIGO109_TO_CONFIRM_IN;
                    const etaDate = addWorkingDays(
                        process.pr_date,
                        lt_PR_TO_PO + lt_isZPLP + lt_CONFIRM_IN_TO_UU + lt_BILLING + lt_DELIVERY
                    );

                    etaHistory.push({
                        eta_type: ETA_TYPE.ETA1_PR,
                        sourcing_sub_type: process.sourcing_sub_type,
                        base_date: process.pr_date,
                        eta_date: etaDate,
                        eta_date_formatted: formatDate(etaDate),
                        isZPLP,
                        leadTime: {
                            lt_PR_TO_PO,
                            lt_PO_TO_MIGO107,
                            lt_MIGO107_TO_MIGO109,
                            lt_MIGO109_TO_CONFIRM_IN,
                            lt_CONFIRM_IN_TO_UU,
                            lt_BILLING,
                            lt_DELIVERY,
                            leadTimePR_data
                        }
                    });
                }
            }
        }

        // --------------------------------------------------
        // ETA #2 PR
        // PO Date + LTM PR + Billing + Delivery (Case PR Direct)
        // PO Date + LTM PR + LTM POSTO Default + Billing + Delivery (Case PR Indirect)
        // --------------------------------------------------
        if (process.po_date_pr) {
            // Case PR Direct
            if (process.sourcing_sub_type === "PR Direct") {
                const lt_isZPLP = !isZPLP ? (lt_PO_TO_MIGO107 + lt_MIGO107_TO_MIGO109 + lt_MIGO109_TO_CONFIRM_IN) : lt_MIGO109_TO_CONFIRM_IN;
                const etaDate = addWorkingDays(
                    process.po_date_pr,
                    lt_isZPLP + lt_CONFIRM_IN_TO_UU + lt_BILLING + lt_DELIVERY
                );

                etaHistory.push({
                    eta_type: ETA_TYPE.ETA2_PR,
                    sourcing_sub_type: process.sourcing_sub_type,
                    base_date: process.po_date_pr,
                    eta_date: etaDate,
                    eta_date_formatted: formatDate(etaDate),
                    isZPLP,
                    leadTime: {
                        lt_PO_TO_MIGO107,
                        lt_MIGO107_TO_MIGO109,
                        lt_MIGO109_TO_CONFIRM_IN,
                        lt_CONFIRM_IN_TO_UU,
                        lt_BILLING,
                        lt_DELIVERY,
                        leadTimePR_data
                    }
                });
            } 
            // Case PR Indirect
            else if (process.sourcing_sub_type === "PR Indirect") {
                const lt_isZPLP = !isZPLP ? (lt_PO_TO_MIGO107 + lt_MIGO107_TO_MIGO109 + lt_MIGO109_TO_CONFIRM_IN) : lt_MIGO109_TO_CONFIRM_IN;
                let etaDate = addWorkingDays(
                    process.po_date_pr,
                    lt_isZPLP + lt_CONFIRM_IN_TO_UU
                );

                // PO STO -> Create TO -> Confirm TO Out -> Create SPB -> SPB -> GI
                etaDate = addWorkingDays(
                    etaDate,
                    lt_PO_TO_TO + lt_TO_TO_CONFIRM_OUT + lt_CONFIRM_OUT_TO_SPB + lt_SPB_TO_GI
                );

                // GI -> MIGO 101
                etaDate = addCalendarDays(etaDate, lt_SHIPMENT_TO_MIGO101);

                // MIGO 101 -> Confirm TO In -> UU / Block -> Billing -> Delivery
                etaDate = addWorkingDays(
                    etaDate,
                    lt_MIGO101_TO_CONFIRM_IN + lt_CONFIRM_IN_TO_UU_POSTO + lt_BILLING + lt_DELIVERY
                );

                etaHistory.push({
                    eta_type: ETA_TYPE.ETA2_PR,
                    sourcing_sub_type: process.sourcing_sub_type,
                    base_date: process.po_date_pr,
                    eta_date: etaDate,
                    eta_date_formatted: formatDate(etaDate),
                    isZPLP,
                    leadTime: {
                        lt_PO_TO_MIGO107,
                        lt_MIGO107_TO_MIGO109,
                        lt_MIGO109_TO_CONFIRM_IN,
                        lt_CONFIRM_IN_TO_UU,
                        lt_PO_TO_TO,
                        lt_TO_TO_CONFIRM_OUT,
                        lt_CONFIRM_OUT_TO_SPB,
                        lt_SPB_TO_GI,
                        lt_SHIPMENT_TO_MIGO101,
                        lt_MIGO101_TO_CONFIRM_IN,
                        lt_CONFIRM_IN_TO_UU_POSTO,
                        lt_BILLING,
                        lt_DELIVERY,
                        leadTimePR_data,
                        leadTimePOSTO_Default
                    }
                });
            }
        }

        // --------------------------------------------------
        // ETA #3 PR
        // Target MIGO Date (109 jika ZPLP) + remaining PR LT (langsung ke 109 jika ZPLP) + Billing + Delivery
        // Target MIGO Date (109 jika ZPLP) + remaining PR LT (langsung ke 109 jika ZPLP) + LTM POSTO Default + Billing + Delivery
        // --------------------------------------------------
        if (targetMigoDate) {
            // Case PR Direct
            if (process.sourcing_sub_type === "PR Direct") {
                const lt_isZPLP = !isZPLP ? (lt_MIGO107_TO_MIGO109 + lt_MIGO109_TO_CONFIRM_IN) : lt_MIGO109_TO_CONFIRM_IN;
                const etaDate = addWorkingDays(
                    targetMigoDate,
                    lt_isZPLP + lt_CONFIRM_IN_TO_UU + lt_BILLING + lt_DELIVERY
                );

                etaHistory.push({
                    eta_type: ETA_TYPE.ETA3_PR,
                    sourcing_sub_type: process.sourcing_sub_type,
                    base_date: targetMigoDate,
                    eta_date: etaDate,
                    eta_date_formatted: formatDate(etaDate),
                    isZPLP,
                    leadTime: {
                        lt_MIGO107_TO_MIGO109,
                        lt_MIGO109_TO_CONFIRM_IN,
                        lt_CONFIRM_IN_TO_UU,
                        lt_BILLING,
                        lt_DELIVERY,
                        leadTimePR_data
                    }
                });
            } 
            // Case PR Indirect
            else if (process.sourcing_sub_type === "PR Indirect") {
                const lt_isZPLP = !isZPLP ? (lt_MIGO107_TO_MIGO109 + lt_MIGO109_TO_CONFIRM_IN) : lt_MIGO109_TO_CONFIRM_IN;
                let etaDate = addWorkingDays(
                    targetMigoDate,
                    lt_isZPLP +
                    lt_CONFIRM_IN_TO_UU
                );

                // PO STO -> Create TO -> Confirm TO Out -> Create SPB -> SPB -> GI
                etaDate = addWorkingDays(
                    etaDate,
                    lt_PO_TO_TO + lt_TO_TO_CONFIRM_OUT + lt_CONFIRM_OUT_TO_SPB + lt_SPB_TO_GI
                );

                // GI -> MIGO 101
                etaDate = addCalendarDays(etaDate, lt_SHIPMENT_TO_MIGO101);

                // MIGO 101 -> Confirm TO In -> UU / Block -> Billing -> Delivery
                etaDate = addWorkingDays(
                    etaDate,
                    lt_MIGO101_TO_CONFIRM_IN + lt_CONFIRM_IN_TO_UU_POSTO + lt_BILLING + lt_DELIVERY
                );

                etaHistory.push({
                    eta_type: ETA_TYPE.ETA3_PR,
                    sourcing_sub_type: process.sourcing_sub_type,
                    base_date: targetMigoDate,
                    eta_date: etaDate,
                    eta_date_formatted: formatDate(etaDate),
                    isZPLP,
                    leadTime: {
                        lt_MIGO107_TO_MIGO109,
                        lt_MIGO109_TO_CONFIRM_IN,
                        lt_CONFIRM_IN_TO_UU,
                        lt_PO_TO_TO,
                        lt_TO_TO_CONFIRM_OUT,
                        lt_CONFIRM_OUT_TO_SPB,
                        lt_SPB_TO_GI,
                        lt_SHIPMENT_TO_MIGO101,
                        lt_MIGO101_TO_CONFIRM_IN,
                        lt_CONFIRM_IN_TO_UU_POSTO,
                        lt_BILLING,
                        lt_DELIVERY,
                        leadTimePR_data,
                        leadTimePOSTO_Default
                    }
                });
            }
        }
    }

    // ----------------------------------------------------
    // ETA PO STO
    // ----------------------------------------------------
    function calculateETAPOSTO(process, etaHistory) {
        const { lt_BILLING, lt_DELIVERY } = getLT_General();

        // --------------------------------------------------
        // ETA #1 PO STO
        //
        // PO STO Date + LTM PO STO + LT Billing + LT Delivery
        // ETA #1 selalu menggunakan MODA DEFAULT = Y
        // --------------------------------------------------
        if (process.po_sto_date) {
            const leadTimePOSTO_Default = getLT_POSTO(process.from_plant, process.to_plant, process.moda, "Y");

            if (Object.keys(leadTimePOSTO_Default).length === 0) {
                etaHistory.push({
                    eta_type: ETA_TYPE.NULL,
                    base_date: process.po_sto_date,
                    eta_date: null,
                    eta_date_formatted: null,
                });
                return;
            }

            const lt_PO_TO_TO = leadTimePOSTO_Default?.po_sto_to_po_sto || 0;
            const lt_TO_TO_CONFIRM_OUT = leadTimePOSTO_Default?.po_sto_to_out_confirm || 0;
            const lt_CONFIRM_OUT_TO_SPB = leadTimePOSTO_Default?.out_confirm_to_create_spb || 0;
            const lt_SPB_TO_GI = leadTimePOSTO_Default?.create_spb_to_gi || 0;
            const lt_SHIPMENT_TO_MIGO101 = leadTimePOSTO_Default?.gi_to_gr || 0; // FSD: Calendar Days
            const lt_MIGO101_TO_CONFIRM_IN = leadTimePOSTO_Default?.gr_to_in_confirm || 0;
            const lt_CONFIRM_IN_TO_UU = leadTimePOSTO_Default?.in_confirm_to_confirm_uu || 0;

            // ------------------------------------------------
            // PO STO -> Create TO -> Confirm TO Out -> Create SPB -> SPB -> GI
            // ------------------------------------------------
            let etaDate = addWorkingDays(
                process.po_sto_date,
                lt_PO_TO_TO + lt_TO_TO_CONFIRM_OUT + lt_CONFIRM_OUT_TO_SPB + lt_SPB_TO_GI
            );

            // ------------------------------------------------
            // GI -> MIGO 101
            // ------------------------------------------------
            etaDate = addCalendarDays(etaDate, lt_SHIPMENT_TO_MIGO101);

            // ------------------------------------------------
            // MIGO 101 -> Confirm TO In -> UU / Block -> Billing -> Delivery
            // ------------------------------------------------
            etaDate = addWorkingDays(
                etaDate,
                lt_MIGO101_TO_CONFIRM_IN + lt_CONFIRM_IN_TO_UU + lt_BILLING + lt_DELIVERY
            );

            etaHistory.push({
                eta_type: ETA_TYPE.ETA1_PO_STO,
                base_date: process.po_sto_date,
                eta_date: etaDate,
                eta_date_formatted: formatDate(etaDate),
                leadTime: {
                    lt_PO_TO_TO,
                    lt_TO_TO_CONFIRM_OUT,
                    lt_CONFIRM_OUT_TO_SPB,
                    lt_SPB_TO_GI,
                    lt_SHIPMENT_TO_MIGO101,
                    lt_MIGO101_TO_CONFIRM_IN,
                    lt_CONFIRM_IN_TO_UU,
                    lt_BILLING,
                    lt_DELIVERY,
                    leadTimePOSTO_Default
                }
            });
        }

        // --------------------------------------------------
        // ETA #2 PO STO
        //
        // SPB Date + SPB -> GI + Shipment -> MIGO 101 + MIGO 101 -> Confirm TO In + Confirm TO In -> UU + Billing + Delivery
        // ETA #2 menggunakan MODA AKTUAL.
        // --------------------------------------------------
        if (process.po_sto_spb_created_date) {
            const leadTimePOSTO_Actual = getLT_POSTO(process.from_plant, process.to_plant, process.moda, "N");

            if (Object.keys(leadTimePOSTO_Actual).length === 0) {
                etaHistory.push({
                    eta_type: ETA_TYPE.NULL,
                    base_date: process.po_sto_spb_created_date,
                    eta_date: null,
                    eta_date_formatted: null,
                });
                return;
            }

            const lt_SPB_TO_GI = leadTimePOSTO_Actual?.create_spb_to_gi || 0;
            const lt_SHIPMENT_TO_MIGO101 = leadTimePOSTO_Actual?.gi_to_gr || 0; // FSD: Calendar Days
            const lt_MIGO101_TO_CONFIRM_IN = leadTimePOSTO_Actual?.gr_to_in_confirm || 0;
            const lt_CONFIRM_IN_TO_UU = leadTimePOSTO_Actual?.in_confirm_to_confirm_uu || 0;

            // ------------------------------------------------
            // SPB -> GI
            // ------------------------------------------------
            let etaDate = addWorkingDays(process.po_sto_spb_created_date, lt_SPB_TO_GI);

            // ------------------------------------------------
            // GI -> MIGO 101
            // ------------------------------------------------
            etaDate = addCalendarDays(etaDate, lt_SHIPMENT_TO_MIGO101);

            // ------------------------------------------------
            // MIGO 101 -> Confirm TO In -> UU / Block -> Billing -> Delivery
            // ------------------------------------------------
            etaDate = addWorkingDays(
                etaDate,
                lt_MIGO101_TO_CONFIRM_IN + lt_CONFIRM_IN_TO_UU + lt_BILLING + lt_DELIVERY
            );

            etaHistory.push({
                eta_type: ETA_TYPE.ETA2_PO_STO,
                base_date: process.po_sto_spb_created_date,
                eta_date: etaDate,
                eta_date_formatted: formatDate(etaDate),
                leadTime: {
                    lt_SPB_TO_GI,
                    lt_SHIPMENT_TO_MIGO101,
                    lt_MIGO101_TO_CONFIRM_IN,
                    lt_CONFIRM_IN_TO_UU,
                    lt_BILLING,
                    lt_DELIVERY,
                    leadTimePOSTO_Actual
                }
            });
        }
    }

    // ----------------------------------------------------
    // ETA TP
    // TP Date + LTM TP + LT Billing + LT Delivery
    // ----------------------------------------------------
    function calculateETATP(process, etaHistory) {
        if (!process.tp_date) return;

        const leadTimeTP_data = getLT_TP(process.plant);

        if (Object.keys(leadTimeTP_data).length === 0) {
            etaHistory.push({
                eta_type: ETA_TYPE.NULL,
                base_date: process.tp_date,
                eta_date: null,
                eta_date_formatted: null,
            });
            return;
        }

        const { lt_BILLING, lt_DELIVERY } = getLT_General();
        const lt_TP = leadTimeTP_data?.CreateTP_CheckStock || 0;

        const etaDate = addWorkingDays(
            process.tp_date,
            lt_TP + lt_BILLING + lt_DELIVERY
        );

        etaHistory.push({
            eta_type: ETA_TYPE.ETA_TP,
            base_date: process.tp_date,
            eta_date: etaDate,
            eta_date_formatted: formatDate(etaDate),
            leadTime: {
                lt_TP,
                lt_BILLING,
                lt_DELIVERY,
                leadTimeTP_data
            }
        });
    }

    // ----------------------------------------------------
    // ETA UPDATE BILLING
    // Confirm TO Out + Billing + Delivery
    // ----------------------------------------------------
    function calculateETABilling(process, etaHistory) {
        if (!process.confirm_to_out_date) return;
        const { lt_BILLING, lt_DELIVERY } = getLT_General();
        const etaDate = addWorkingDays(
            process.confirm_to_out_date, 
            lt_BILLING + lt_DELIVERY
        );
        etaHistory.push({
            eta_type: ETA_TYPE.ETA_BILLING,
            base_date: process.confirm_to_out_date,
            eta_date: etaDate,
            eta_date_formatted: formatDate(etaDate),
            leadTime: {
                lt_BILLING,
                lt_DELIVERY,
            }
        });
    }

    // ----------------------------------------------------
    // Build Internal Process
    // ----------------------------------------------------
    function buildInternalProcess(data) {
        if (!data || !data.length) return null;

        const process = { ...data[0] };
        process.eta_type = ETA_TYPE.NULL;
        process.eta_customer_received = null;
        process.eta_customer_received_formatted = null;
        process.eta_history = [];
        process.status_history = [];

        // PR
        if (process.sourcing_type === SOURCING.PR) {
            calculateETAPR(process, process.eta_history);
            // PR Indirect -> PO STO
            if (process.sourcing_sub_type === 'PR Indirect') {
                calculateETAPOSTO(process, process.eta_history);
            }
        }
        // PO STO
        if (process.sourcing_type === SOURCING.PO_STO) {
            calculateETAPOSTO(process, process.eta_history);
        }
        // TP
        if (process.sourcing_type === SOURCING.TP) {
            calculateETATP(process, process.eta_history);
        }

        // ITEM ETA
        const hasTBA = process.eta_history.some(item => item.eta_type === ETA_TYPE.TBA);
        if (hasTBA) {
            process.eta_type = ETA_TYPE.TBA;
            process.eta_customer_received = null;
            process.eta_customer_received_formatted = "TBA";
        } else {
            const latestEta = process.eta_history.length ? process.eta_history[process.eta_history.length - 1] : null;
            process.eta_type = latestEta?.eta_type || ETA_TYPE.NULL;
            process.eta_customer_received = latestEta?.eta_date || null;
            process.eta_customer_received_formatted = latestEta?.eta_date_formatted || null;
        }

        // Determine Status
        if (process.so_created_date) {
            process.status_code = STATUS.PROCESSING;
        } else {
            process.status_code = STATUS.PO_RECEIVED;
        }
        process.status_id = statusCodeToId[process.status_code];

        // Build Status History for this process
        const addHistory = (statusCode, date) => {
            if (!date) return;
            const status = statusList.find(item => item.status_code === statusCode);
            if (!status) return;
            process.status_history.push({
                status_id: status.id,
                status_code: status.status_code,
                status_sequence: status.sequence,
                status_name: status.status_name || status.status_code,
                date: date,
            });
        };
        addHistory(STATUS.PO_RECEIVED, process.po_receive_date);
        addHistory(STATUS.PROCESSING, process.so_created_datetime);

        return process;
    }

    // ----------------------------------------------------
    // Build Delivery Process
    // ----------------------------------------------------
    function buildDeliveryProcess(data) {
        if (!data || !data.length) return null;

        const process = { ...data[0] };
        process.eta_type = ETA_TYPE.NULL;
        process.eta_customer_received = null;
        process.eta_customer_received_formatted = null;
        process.eta_history = [];
        process.status_history = [];

        // ETA Billing
        if (process.confirm_to_out_date) { calculateETABilling(process, process.eta_history) }

        const latestEta = process.eta_history.length ? process.eta_history[process.eta_history.length - 1] : null;
        process.eta_type = latestEta?.eta_type || ETA_TYPE.NULL;
        process.eta_customer_received = latestEta?.eta_date || null;
        process.eta_customer_received_formatted = latestEta?.eta_date_formatted || null;

        // Determine Status
        if (process.confirm_to_out_date) {
            process.status_code = STATUS.READY_AT_WAREHOUSE;
        } else if (process.so_created_date) {
            process.status_code = STATUS.PROCESSING;
        } else {
            process.status_code = STATUS.PO_RECEIVED;
        }
        process.status_id = statusCodeToId[process.status_code];

        // Build Status History for this process
        const addHistory = (statusCode, date) => {
            if (!date) return;
            const status = statusList.find(item => item.status_code === statusCode);
            if (!status) return;
            process.status_history.push({
                status_id: status.id,
                status_code: status.status_code,
                status_sequence: status.sequence,
                status_name: status.status_name || status.status_code,
                date: date,
            });
        };
        addHistory(STATUS.PO_RECEIVED, process.po_receive_date);
        addHistory(STATUS.PROCESSING, process.so_created_datetime);
        addHistory(STATUS.READY_AT_WAREHOUSE, process.confirm_to_out_datetime);

        return process;
    }

    // ==========================================================
    // HELPER FUNCTION: Memproses baris yang sudah di-MERGE
    // ==========================================================
    function processMergedRow(mergedRow, poKey, poMap, mode) {
        // Determine Sourcing Type and Variant from Allocation Type
        const sourcingType = mapSourcingType(mergedRow.allocation_type);
        const sourcingVariant = mapSourcingVariant(mergedRow.allocation_sub_type);

        // --------------------------------------------------
        // CONFIRM TO OUT (Customer-Facing)
        // --------------------------------------------------
        let confirmToOutDate = null;
        let confirmToOutDateTime = null;
        const hasLt15Cancel = Number(mergedRow.has_lt15_cancellation) === 1;
        const hasLt0gCancel = Number(mergedRow.has_ltog_cancellation) === 1;

        if (!hasLt15Cancel && !hasLt0gCancel && mergedRow.transfer_order_confirmed_date) {
            confirmToOutDate = cleanDate(mergedRow.transfer_order_confirmed_date);
            confirmToOutDateTime = combineDateTime(mergedRow.transfer_order_confirmed_date, mergedRow.transfer_order_confirmed_time);
        }

        // ---------------------------------------------------------
        // BUILD ITEM OBJECT (Sekarang ambil semua data dari mergedRow)
        // ---------------------------------------------------------
        const item = {
            po_number: poKey,
            so_created_date: mergedRow.sales_document_created_date
                ? cleanDate(mergedRow.sales_document_created_date)
                : cleanDate(mergedRow.allocation_created_date),
            so_created_datetime: mergedRow.sales_document_created_date
                ? combineDateTime(mergedRow.sales_document_created_date, mergedRow.sales_document_created_time)
                : combineDateTime(mergedRow.allocation_created_date, mergedRow.allocation_created_time),
            po_receive_date: cleanDate(mergedRow.customer_po_receive_date),
            process_no: cleanNumber(mergedRow.sourcing_no_urut),
            sourcing_type: sourcingType,
            sourcing_sub_type: sourcingVariant,
            so_number: mergedRow.sales_document_no,
            so_item: mergedRow.sales_document_item,
            so_type: mergedRow.sales_document_type,
            part_number: mergedRow.sales_material 
                ? mergedRow.sales_material
                : mergedRow.allocation_material,
            part_description: mergedRow.sales_item_description 
                ? mergedRow.sales_item_description
                : mergedRow.part_description,
            product: mergedRow.product,
            material_type: mergedRow.sales_material_type
                ? mergedRow.sales_material_type
                : mergedRow.material_type,
            po_type: mergedRow.po_type,
            plant: mergedRow.sales_order_plant 
                ? mergedRow.sales_order_plant
                : mergedRow.allocation_plant,
            pss_no: mergedRow.pss_no,
            pss_name: mergedRow.pss_name,
            sales_office: mergedRow.sales_office,
            sales_office_name: mergedRow.sales_office_name,
            sales_item_category: mergedRow.sales_item_category,
            sales_item_currency: mergedRow.sales_item_currency,
            sales_item_net_value: cleanNumber(mergedRow.sales_item_net_value),
            sales_item_net_price: cleanNumber(mergedRow.sales_item_net_price),
            requested_delivery_date: cleanDate(mergedRow.requested_delivery_date),
            customer_purchase_order_date: cleanDate(mergedRow.customer_purchase_order_date),
            partial_delivery: mergedRow.complete_delivery && mergedRow.complete_delivery.toLowerCase() === "x" ? "Full Delivery" : "Partial Delivery",

            // Sales Order (Item)
            qty_sales_order: cleanNumber(mergedRow.sales_order_quantity),
            qty_sales_order_confirm: cleanNumber(mergedRow.goods_movement_quantity),

            // Flag Rejection SO Item
            sales_order_rejection_reason: mergedRow.sales_item_rejection_reason || null,

            // Flag Return SO Item
            return_sales_document_no: mergedRow.return_sales_document_no || null,

            // Allocation
            qty_sourcing: cleanNumber(mergedRow.sourcing_quantity),
            qty_allocated: cleanNumber(mergedRow.allocated_quantity),
            allocated_date: cleanDate(mergedRow.allocated_date),

            // Field dari DO (Delivery & Shipping)
            create_do_date: combineDateTime(mergedRow.delivery_created_date, mergedRow.delivery_created_time),
            create_to_date: combineDateTime(mergedRow.transfer_order_created_date, mergedRow.transfer_order_created_time),
            confirm_to_out_date: confirmToOutDate,
            confirm_to_out_datetime: confirmToOutDateTime,
            spb_number: mergedRow.shipment_no,
            spb_created_date: combineDateTime(mergedRow.shipment_created_date, mergedRow.shipment_created_time),
            gi_number: mergedRow.goods_movement_document_no,
            gi_date: combineDateTime(mergedRow.shipment_gi_date, mergedRow.shipment_gi_time),

            // Flag ambil ETA dari Delivery Process
            is_qty_conf_to_eq_qty_order_or_sales_item_rejection: mergedRow.is_qty_conf_to_eq_qty_order_or_sales_item_rejection || 0,

            // Flag Cancel GI
            has_customer_gi_cancellation_event: mergedRow.has_customer_gi_cancellation_event || 0,

            // Key untuk allocation row
            row_hash: mergedRow.row_hash || null,

            // Flag SO Item BOM
            sales_item_higher_level_item: mergedRow.sales_item_higher_level_item,
            is_header: mergedRow.is_header,
        };

        // ==================================================
        // TP
        // ==================================================
        if (sourcingType === 'TP') {
            item.tp_number = mergedRow.tp_document_no;
            item.tp_date = cleanDate(mergedRow.tp_posting_date);
        }

        // ==================================================
        // PO STO (Internal) / PR Indirect
        // ==================================================
        if (sourcingType === 'PO STO' || (sourcingType === 'PR' && sourcingVariant === 'PR Indirect')) {
            // PO STO Plant
            item.from_plant = mergedRow.po_sto_supplying_plant;
            item.to_plant = mergedRow.po_sto_destination_plant;
            item.moda = mergedRow.spb_shipping_type_name;

            // PO STO
            item.po_sto_number = mergedRow.po_sto_no;
            item.po_sto_item = mergedRow.po_sto_item;
            item.po_sto_date = cleanDate(mergedRow.po_sto_created_date);

            // Delivery / DO STO (Internal)
            item.po_sto_do_number = mergedRow.delivery_no_posto;
            item.po_sto_do_date = cleanDate(mergedRow.delivery_posto_created_date);
            item.po_sto_do_quantity = cleanNumber(mergedRow.delivery_quantity_posto);

            // Transfer Order / TO STO (Internal)
            item.po_sto_to_number = mergedRow.po_sto_transfer_order_no;
            item.po_sto_create_to_date = cleanDate(mergedRow.po_sto_transfer_order_created_date);
            item.po_sto_create_to_time = mergedRow.po_sto_transfer_order_created_time;
            item.po_sto_confirm_to_out_date = cleanDate(mergedRow.po_sto_transfer_order_confirmed_date);
            item.po_sto_confirm_to_out_time = mergedRow.po_sto_transfer_order_confirmed_time;

            // SPB (internal)
            item.po_sto_spb_number = mergedRow.po_sto_spb_number;
            item.po_sto_spb_created_date = cleanDate(mergedRow.po_sto_spb_created_date);
            item.po_sto_spb_created_time = mergedRow.po_sto_spb_created_time;

            // GI (internal)
            item.po_sto_gi_number = mergedRow.po_sto_gi_number;
            item.po_sto_gi_date = cleanDate(mergedRow.po_sto_gi_date);
            item.po_sto_gi_time = mergedRow.po_sto_gi_time;

            // MIGO 101 / GR
            item.migo101_date = cleanDate(mergedRow.mseg101_posting_date);

            // MIGO 101 / GR TO
            item.migo101_to_created_date = combineDateTime(mergedRow.mseg101_to_created_date, mergedRow.mseg101_to_created_time);
            item.po_sto_confirm_to_in_date = cleanDate(mergedRow.mseg101_to_confirmed_date);

            // QI → Block / UU STO
            item.po_sto_qi_to_block_date = mergedRow.mseg350_posting_date;
            item.po_sto_qi_to_block_document = mergedRow.qi_to_block_material_document_no;
            item.po_sto_qi_to_block_quantity = cleanNumber(mergedRow.mseg350_quantity);

            // QI → UU STO
            item.po_sto_qi_to_uu_date = mergedRow.mseg321_posting_date;
            item.po_sto_qi_to_uu_document = mergedRow.qi_to_uu_material_document_no;
            item.po_sto_qi_to_uu_quantity = cleanNumber(mergedRow.mseg321_quantity);
        }

        // ==================================================
        // PR
        // ==================================================
        if (sourcingType === 'PR') {
            // Plant
            item.pr_plant = mergedRow.purchase_requisition_plant;
            item.po_plant = mergedRow.purchase_order_plant;
            item.lab_office = mergedRow.purchase_requisition_requisitioner;
            item.vendor_code = mergedRow.purchase_order_supplier_no;
            item.vendor_name = mergedRow.purchase_order_supplier_name;

            // PR
            item.pr_number = mergedRow.purchase_requisition_no;
            item.pr_date = cleanDate(mergedRow.purchase_requisition_created_date);
            item.pr_quantity = cleanNumber(mergedRow.purchase_requisition_quantity);
            item.pr_type = mergedRow.purchase_requisition_document_type;

            // PO hasil PR
            item.po_number_pr = mergedRow.purchase_order_no;
            item.po_date_pr = cleanDate(mergedRow.purchase_order_created_date);
            item.po_quantity_pr = cleanNumber(mergedRow.purchase_order_quantity);
            item.po_type_pr = mergedRow.purchase_order_document_type;

            // MIGO 107 (Internal)
            item.migo107_date = mergedRow.pr107_mkpf_document_date
                ? cleanDate(mergedRow.pr107_mkpf_document_date)
                : cleanDate(mergedRow.pr107_posting_date);
            item.migo107_document = mergedRow.pr107_material_document_no;
            item.migo107_quantity = cleanNumber(mergedRow.pr107_quantity);

            // MIGO 109 / PR Goods Receipt (Internal)
            item.migo109_date = cleanDate(mergedRow.pr_goods_receipt_posting_date);
            item.migo109_document = mergedRow.pr_goods_receipt_material_document_no;
            item.migo109_quantity = cleanNumber(mergedRow.pr_goods_receipt_quantity);

            // PR TO Create/Confirm (Internal)
            item.pr_create_to_date = combineDateTime(mergedRow.pr_goods_receipt_to_created_date, mergedRow.pr_goods_receipt_to_created_time);
            item.pr_confirm_to_in_date = cleanDate(mergedRow.pr_goods_receipt_to_confirmed_date);

            // PR QI → Block / UU (Internal)
            item.pr_qi_to_block_date = mergedRow.pr350_posting_date;
            item.pr_qi_to_block_document = mergedRow.pr_qi_to_block_material_document_no;
            item.pr_qi_to_block_quantity = cleanNumber(mergedRow.pr350_quantity);

            // PR QI → UU (Internal)
            item.pr_qi_to_uu_date = mergedRow.pr321_posting_date;
            item.pr_qi_to_uu_document = mergedRow.pr_qi_to_uu_material_document_no;
            item.pr_qi_to_uu_quantity = cleanNumber(mergedRow.pr321_quantity);
        }

        // Cek apakah item sudah ada di PO
        let existingItem = poMap[poKey].items.find(i => i.so_number === item.so_number && i.so_item === item.so_item);
        if (!existingItem) {
            existingItem = {
                po_number: poKey,
                so_date: item.so_created_date,
                so_number: item.so_number,
                so_item: item.so_item,
                so_type: item.so_type,
                so_quantity: item.qty_sales_order,
                part_number: item.part_number,
                part_description: item.part_description,
                material_type: item.material_type,
                product: item.product,
                plant: item.plant,
                pss_no: item.pss_no,
                pss_name: item.pss_name,
                sales_office: item.sales_office,
                sales_office_name: item.sales_office_name,
                sales_item_category: item.sales_item_category,
                sales_item_currency: item.sales_item_currency,
                sales_item_net_value: item.sales_item_net_value,
                sales_item_net_price: item.sales_item_net_price,
                requested_delivery_date: item.requested_delivery_date,
                customer_purchase_order_date: item.customer_purchase_order_date,
                sales_order_rejection_reason: item.sales_order_rejection_reason,
                qty_order: item.sales_order_rejection_reason === null 
                    ? item.qty_sales_order
                    : 0,
                qty_supply: 0,
                eta_type: ETA_TYPE.NULL,
                eta_customer_received: null,
                eta_customer_received_formatted: null,

                // Flag ambil ETA dari Delivery Process
                is_qty_conf_to_eq_qty_order_or_sales_item_rejection: item.is_qty_conf_to_eq_qty_order_or_sales_item_rejection,

                // Flag SO Item BOM
                sales_item_higher_level_item: item.sales_item_higher_level_item,
                is_header: item.is_header,

                internalProcesses: [],
                deliveryProcesses: []
            };
            poMap[poKey].po_receive_date = poMap[poKey].po_receive_date ? poMap[poKey].po_receive_date : item.po_receive_date;
            poMap[poKey].plant = item.plant ? item.plant : item.sales_office;
            poMap[poKey].sales_office = item.sales_office;
            poMap[poKey].sales_office_name = item.sales_office_name;
            poMap[poKey].items.push(existingItem);
        }

        // Build Internal Process
        if (mode === 'internal' && sourcingType !== null) {
            const process = buildInternalProcess([item]);
            if (process) {
                const exists = existingItem.internalProcesses.some(p => p.row_hash === process.row_hash);
                if (!exists) {
                    existingItem.internalProcesses.push(process);
                }
            }
        }

        // Build Delivery Process (Jika delivery_no ada atau return_sales_document_no ada)
        if (mode === 'delivery' && (mergedRow.delivery_no || mergedRow.return_sales_document_no)) {
            const deliveryItem = {
                ...item,
                delivery_no: mergedRow.delivery_no,
                delivery_created_date: cleanDate(mergedRow.delivery_created_date),
                delivery_created_datetime: combineDateTime(mergedRow.delivery_created_date, mergedRow.delivery_created_time),
                delivery_type: mergedRow.delivery_type || null,
                delivery_item: mergedRow.delivery_item || null,
                delivery_quantity: cleanNumber(mergedRow.delivery_quantity),
                superodinate: mergedRow.payer_customer_no || null,
                superodinate_description: mergedRow.payer_customer_name || null,
                invoice_no: mergedRow.billing_document_no || null,
                invoice_date: mergedRow.billing_date || null,
                invoice_quantity: mergedRow.invoice_quantity || null,
                return_sales_document_no: mergedRow.return_sales_document_no || null,
            };

            const deliveryProcess = buildDeliveryProcess([deliveryItem]);
            if (deliveryProcess) {
                const exists = existingItem.deliveryProcesses.some(p => p.delivery_no === deliveryProcess.delivery_no);
                if (!exists) {
                    existingItem.deliveryProcesses.push(deliveryProcess);
                    // Update qty_order berdasarkan qty_sales_order_confirm jika terjadi SO rejection
                    if (item.sales_order_rejection_reason === null) {
                        existingItem.qty_order = Number(item.qty_sales_order || 0);
                    } else {
                        existingItem.qty_order += Number(item.qty_sales_order_confirm || 0);
                    }
                }
            }
        }
    }

    // ----------------------------------------------------
    // MAIN LOOP: Build PO Map from Customer PO
    // ----------------------------------------------------
    const poMap = {};

    for (const cpRow of customer_po) {
        if (!cpRow.po_number) continue;
        const poKey = String(cpRow.po_number).trim();

        // Inisialisasi PO (Pastikan semua PO dari customer_po masuk)
        if (!poMap[poKey]) {
            poMap[poKey] = {
                po_number: poKey,
                customer_code: cpRow.customer_code || null,
                po_receive_date: cpRow.po_receive_date ? cleanDate(cpRow.po_receive_date) : null,
                items: []
            };
        }

        const allocRows = allocation.filter(r => String(r.customer_purchase_order_no).trim() === poKey);
        const doRows = doToBilShip.filter(d => String(d.customer_purchase_order_no).trim() === poKey);

        // Group by SO Item
        const allocBySoItem = {};
        for (const row of allocRows) {
            if (row.sales_document_no && row.sales_document_item) {
                const key = `${row.sales_document_no}_${row.sales_document_item}`;
                if (!allocBySoItem[key]) allocBySoItem[key] = [];
                allocBySoItem[key].push(row);
            }
        }

        const doBySoItem = {};
        for (const d of doRows) {
            if (d.sales_document_no && d.sales_document_item) {
                const key = `${d.sales_document_no}_${d.sales_document_item}`;
                if (!doBySoItem[key]) doBySoItem[key] = [];
                doBySoItem[key].push(d);
            }
        }

        const allSoKeys = new Set([...Object.keys(allocBySoItem), ...Object.keys(doBySoItem)]);

        for (const soKey of allSoKeys) {
            const [soNo, soItem] = soKey.split('_');
            const allocsForSo = allocBySoItem[soKey] || [];
            const dosForSo = doBySoItem[soKey] || [];
            const latestDo = dosForSo.length > 0 
                ? dosForSo.reduce((latest, current) => {
                    return (current.delivery_created_date || '') > (latest.delivery_created_date || '') ? current : latest;
                })
                : {};

            // 1. Process Internal Processes (from ALL allocations for this SO item)
            for (const allocRow of allocsForSo) {
                const mergedRow = {
                    ...allocRow,
                    ...(Object.keys(latestDo).length > 0 ? { ...latestDo } : {}),
                    sales_document_no: soNo,
                    sales_document_item: soItem,
                    customer_purchase_order_no: poKey,
                    po_sto_transfer_order_no: allocRow.transfer_order_no ? String(allocRow.transfer_order_no) : null,
                    po_sto_transfer_order_created_date: allocRow.transfer_order_created_date,
                    po_sto_transfer_order_created_time: allocRow.transfer_order_created_time,
                    po_sto_transfer_order_confirmed_date: allocRow.transfer_order_confirmed_date,
                    po_sto_transfer_order_confirmed_time: allocRow.transfer_order_confirmed_time,
                    po_sto_spb_number: allocRow.spb_no ? String(allocRow.spb_no) : null,
                    po_sto_spb_created_date: allocRow.spb_created_date,
                    po_sto_spb_created_time: allocRow.spb_created_time,
                    po_sto_gi_number: allocRow.mseg641_material_document_no ? String(allocRow.mseg641_material_document_no) : null,
                    po_sto_gi_date: allocRow.shipment_gi_date,
                    po_sto_gi_time: allocRow.shipment_gi_time,
                };
                processMergedRow(mergedRow, poKey, poMap, 'internal');
            }

            // 2. Process Delivery Processes (from ALL DOs for this SO item)
            for (const doRow of dosForSo) {
                const firstAlloc = allocsForSo.length > 0 ? allocsForSo[0] : {};
                const mergedDeliveryRow = {
                    ...firstAlloc,
                    ...doRow,
                    sales_document_no: soNo,
                    sales_document_item: soItem,
                    customer_purchase_order_no: poKey
                };
                processMergedRow(mergedDeliveryRow, poKey, poMap, 'delivery');
            }
        }
    }

    // ----------------------------------------------------
    // AGGREGATE PO LIST (Finalisasi ETA)
    // ----------------------------------------------------
    const poList = Object.values(poMap).map(po => {

        // --------------------------------------------------
        // RECALCULATE QTY ORDER PER ITEM BERDASARKAN RETURN (Jika ada delivery process yang di RETURN)
        // --------------------------------------------------
        for (const item of po.items) {
            const allDeliveryProcs = item.deliveryProcesses || [];

            // Cek apakah ada delivery process yang merupakan RETURN
            const hasReturn = allDeliveryProcs.some(d => d.return_sales_document_no !== null);

            if (hasReturn) {
                let recalculatedQtyOrder = 0;

                allDeliveryProcs.forEach(d => {
                    // Hanya jumlahkan jika delivery_no ada DAN bukan dokumen return
                    if (d.delivery_no !== null && d.return_sales_document_no === null) {
                        recalculatedQtyOrder += Number(d.qty_sales_order_confirm || 0);
                    }
                });

                // Update qty_order item dengan hasil kalkulasi baru
                item.qty_order = recalculatedQtyOrder;
            }
            // Jika tidak ada return, item.qty_order tetap menggunakan nilai asli dari prosesMergedRow
        }

        // --------------------------------------------------
        // FILTER DELIVERY PROCESS (Hanya ambil yang punya delivery_no)
        // Dilakukan SETELAH logika hasReturn selesai
        // --------------------------------------------------
        for (const item of po.items) {
            if (item.deliveryProcesses && item.deliveryProcesses.length > 0) {
                // Filter array deliveryProcesses, sisakan hanya yang delivery_no-nya tidak kosong
                item.deliveryProcesses = item.deliveryProcesses.filter(d => d.delivery_no !== null);
            }
        }

        // --------------------------------------------------
        // FILTER ITEM UTAMA (ROOT ITEMS ONLY) - untuk perhitungan Total Item & Qty Order PO
        // --------------------------------------------------
        // PENTING: Jika sales_item_higher_level_item = 0, maka itu adalah Root Item
        const rootItems = po.items.filter(item => {
            return Number(item.sales_item_higher_level_item) === 0;
        });

        // Hitung qty_order PO HANYA dari Root Items
        const qtyOrder = rootItems.reduce((total, item) => total + Number(item.qty_order || 0), 0);
        // Total Item PO juga hanya menghitung Root Items
        const totalItem = rootItems.length;

        // Hitung ETA untuk setiap Item
        for (const item of po.items) {

            // CEK FLAG is_qty_conf_to_eq_qty_order_or_sales_item_rejection
            const isQtyConfToEqQtyOrRejection = Number(item.is_qty_conf_to_eq_qty_order_or_sales_item_rejection) === 1;

            // 1. Tentukan proses mana yang akan digunakan berdasarkan flag
            let processesToCheck = [];
            if (isQtyConfToEqQtyOrRejection && item.deliveryProcesses.length > 0) {
                // Jika flag = 1: hanya ambil dari delivery process
                processesToCheck = [...(item.deliveryProcesses || [])];
            } else {
                // Jika flag = 0: ambil dari internal DAN delivery process
                processesToCheck = [
                    ...(item.internalProcesses || []),
                    ...(item.deliveryProcesses || [])
                ];
            }

            // 2. Cek TBA dari SEMUA process
            const hasItemTBA = processesToCheck.some(p => p.eta_type === ETA_TYPE.TBA);
            if (hasItemTBA) {
                item.eta_type = ETA_TYPE.TBA;
                item.eta_customer_received = null;
                item.eta_customer_received_formatted = "TBA";
            } else {
                // 3. Ambil ETA terbaru dari SEMUA process yang valid
                const validEta = processesToCheck.filter(p => p.eta_customer_received);
                if (validEta.length > 0) {
                    const latest = validEta.reduce((max, p) => new Date(p.eta_customer_received) > new Date(max.eta_customer_received) ? p : max);
                    item.eta_type = latest.eta_type || ETA_TYPE.NULL;
                    item.eta_customer_received = latest.eta_customer_received;
                    item.eta_customer_received_formatted = formatDate(latest.eta_customer_received);
                }
            }
        }

        // Hitung ETA & Status PO
        const hasPoTBA = po.items.some(item => item.eta_customer_received_formatted === "TBA");
        let poEtaType = ETA_TYPE.NULL;
        let poEta = null;
        let poEtaFormatted = null;

        if (hasPoTBA) {
            poEtaType = ETA_TYPE.TBA;
            poEtaFormatted = "TBA";
        } else {
            const validEtaItems = po.items.filter(item => item.eta_customer_received);
            if (validEtaItems.length > 0) {
                const latest = validEtaItems.reduce((max, item) => new Date(item.eta_customer_received) > new Date(max.eta_customer_received) ? item : max);
                poEtaType = latest.eta_type || ETA_TYPE.NULL;
                poEta = latest.eta_customer_received;
                poEtaFormatted = formatDate(poEta);
            }
        }

        // Lookup Customer
        const customer = po.customer_code ? (customerMap[po.customer_code] || {}) : {};
        const customerGroup = customerGroupMap[customer.customer_group_id] || {};

        return {
            po_number: po.po_number,
            po_receive_date: po.po_receive_date,
            sales_office: po.sales_office || null,
            sales_office_name: po.sales_office_name || null,
            customer_id: customer.id || null,
            customer_group_id: customer.customer_group_id || null,
            group_type_id: customerGroup.group_type_id || null,
            plant: po.plant || null,
            total_item: totalItem,
            qty_order: qtyOrder,
            eta_type: poEtaType,
            eta_full_supply: poEta,
            eta_full_supply_formatted: poEtaFormatted,
            items: po.items
        };
    });

    // ----------------------------------------------------
    // SYNC TO DATABASE (Upsert Logic)
    // ----------------------------------------------------
    let syncSummary = {
        createdPO: 0, updatedPO: 0, deletedPO: 0,
        createdItem: 0, updatedItem: 0, deletedItem: 0,
        createdInternal: 0, updatedInternal: 0, deletedInternal: 0,
        createdHistory: 0, updatedHistory: 0, deletedHistory: 0,
        createdDelivery: 0, updatedDelivery: 0, deletedDelivery: 0,    
        createdDelHistory: 0, updatedDelHistory: 0, deletedDelHistory: 0,
        errors: []
    };

    // SYNC EACH PO
    for (const poDef of poList) {

        const by = (req.user && req.user.username) || "system";
        const now = Date.now();

        try {
            // PO EXISTING
            const existingPO = await entities.pot_po.findOne({
                where: { po_number: poDef.po_number }
            });

            // ==========================================================
            // HANDLE DELETION: Jika PO ada di DWH tapi tidak punya item
            // ==========================================================
            if (poDef.items.length === 0) {
                if (existingPO) {
                    const existingItemsInDb = await entities.pot_po_item.find({ 
                        where: { po_id: existingPO.id } 
                    });

                    for (const dbItem of existingItemsInDb) {
                        // 1. Delete internal processes and histories
                        const internalProcesses = await entities.pot_po_internal_process.find({ 
                            where: { po_item_id: dbItem.id } 
                        });
                        for (const proc of internalProcesses) {
                            await entities.pot_po_history_status.createQueryBuilder()
                                .delete()
                                .where("po_internal_process_id = :id", { id: proc.id })
                                .execute();
                            await entities.pot_po_internal_process.createQueryBuilder()
                                .delete()
                                .where("id = :id", { id: proc.id })
                                .execute();
                        }

                        // 2. Delete delivery processes and histories
                        const deliveryProcesses = await entities.pot_po_delivery_process.find({ 
                            where: { po_item_id: dbItem.id } 
                        });
                        for (const del of deliveryProcesses) {
                            await entities.pot_po_history_status.createQueryBuilder()
                                .delete()
                                .where("po_delivery_process_id = :id", { id: del.id })
                                .execute();
                            await entities.pot_po_delivery_process.createQueryBuilder()
                                .delete()
                                .where("id = :id", { id: del.id })
                                .execute();
                        }

                        // 3. Delete the item itself
                        await entities.pot_po_item.createQueryBuilder()
                            .delete()
                            .where("id = :id", { id: dbItem.id })
                            .execute();
                    }

                    // 4. Delete the PO itself
                    await entities.pot_po.createQueryBuilder()
                        .delete()
                        .where("id = :id", { id: existingPO.id })
                        .execute();
                    syncSummary.deletedPO++;
                }
                continue; // Skip ke PO berikutnya karena PO ini sudah dihapus
            }

            let poId = null;
            const poPayload = {
                customer_id: poDef.customer_id || null,
                customer_group_id: poDef.customer_group_id || null,
                group_type_id: poDef.group_type_id || null,
                branch_id: poDef.plant || null,
                sales_office: poDef.sales_office || null,
                sales_office_name: poDef.sales_office_name || null,
                po_receive_date: poDef.po_receive_date || null,
                eta_type: poDef.eta_type || ETA_TYPE.NULL,
                eta_full_supply: poDef.eta_full_supply || null,
                total_item: poDef.total_item || 0,
                qty_order: poDef.qty_order || 0,
                updatedBy: by,
                updatedAt: now
            };

            if (!existingPO) {
                // INSERT PO
                poPayload.po_number = poDef.po_number;
                poPayload.qty_supply = 0;
                poPayload.progress_supply = 0;
                poPayload.order_status_id = statusCodeToId[STATUS.PO_RECEIVED];
                poPayload.createdBy = by; 
                poPayload.createdAt = now;
                const insertResult = await entities.pot_po.createQueryBuilder()
                    .insert()
                    .values(poPayload)
                    .execute();
                poId = insertResult.identifiers[0].id;
                syncSummary.createdPO++;
            } else {
                // UPDATE PO
                await entities.pot_po.createQueryBuilder()
                    .update()
                    .set(poPayload)
                    .where("id = :id", { id: existingPO.id })
                    .execute();
                poId = existingPO.id;
                syncSummary.updatedPO++;
            }

            // ==========================================================
            // HANDLE DELETED ITEMS (Cascade Delete) jika SO tidak ada di PO
            // ==========================================================
            if (existingPO) {
                const existingItemsInDb = await entities.pot_po_item.find({ 
                    where: { po_id: poId } 
                });
                const currentSoKeys = new Set((poDef.items || []).map(i => `${i.so_number}_${i.so_item}`));

                for (const dbItem of existingItemsInDb) {
                    const soKey = `${dbItem.so_number}_${dbItem.so_item}`;
                    if (!currentSoKeys.has(soKey)) {
                        // 1. Delete internal processes and their histories
                        const internalProcesses = await entities.pot_po_internal_process.find({ 
                            where: { po_item_id: dbItem.id } 
                        });
                        for (const proc of internalProcesses) {
                            const histCount = await entities.pot_po_history_status.count({ where: { po_internal_process_id: proc.id } });
                            await entities.pot_po_history_status.createQueryBuilder()
                                .delete()
                                .where("po_internal_process_id = :id", { id: proc.id })
                                .execute();
                            await entities.pot_po_internal_process.createQueryBuilder()
                                .delete()
                                .where("id = :id", { id: proc.id })
                                .execute();
                            syncSummary.deletedInternal++;
                            syncSummary.deletedHistory += histCount;
                        }

                        // 2. Delete delivery processes and their histories
                        const deliveryProcesses = await entities.pot_po_delivery_process.find({ 
                            where: { po_item_id: dbItem.id } 
                        });
                        for (const del of deliveryProcesses) {
                            const histCount = await entities.pot_po_history_status.count({ where: { po_delivery_process_id: del.id } });
                            await entities.pot_po_history_status.createQueryBuilder()
                                .delete()
                                .where("po_delivery_process_id = :id", { id: del.id })
                                .execute();
                            await entities.pot_po_delivery_process.createQueryBuilder()
                                .delete()
                                .where("id = :id", { id: del.id })
                                .execute();
                            syncSummary.deletedDelivery++;
                            syncSummary.deletedDelHistory += histCount;
                        }

                        // 3. Delete the item itself
                        await entities.pot_po_item.createQueryBuilder()
                            .delete()
                            .where("id = :id", { id: dbItem.id })
                            .execute();
                        syncSummary.deletedItem++;
                    }
                }
            }

            // SYNC ITEMS (Upsert for remaining/updated items)
            for (const itemDef of poDef.items || []) {
                try {
                    // ITEM EXISTING
                    const existingItem = await entities.pot_po_item.findOne({
                        where: { po_id: poId, so_number: itemDef.so_number, so_item: itemDef.so_item }
                    });

                    let preliminaryItemId = existingItem ? existingItem.id : null;

                    // ==========================================================
                    // HANDLE DELETIONS: Hapus Internal Process berdasarkan key yang tidak ada di DWH
                    // ==========================================================
                    if (preliminaryItemId) {
                        const existingInternalProcsInDb = await entities.pot_po_internal_process.find({ 
                            where: { po_item_id: preliminaryItemId } 
                        });

                        // Kumpulkan semua row_hash yang ada di payload DWH saat ini
                        const currentRowHashes = (itemDef.internalProcesses || []).map(p => String(p.row_hash || ''));

                        for (const existingProc of existingInternalProcsInDb) {
                            const rowHash = String(existingProc.row_hash || '');

                            // Jika row_hash di DB tidak ditemukan di payload DWH, berarti dihapus di sumber
                            if (!currentRowHashes.includes(rowHash)) {
                                const histCount = await entities.pot_po_history_status.count({ where: { po_internal_process_id: existingProc.id } });
                                await entities.pot_po_history_status.createQueryBuilder()
                                    .delete()
                                    .where("po_internal_process_id = :id", { id: existingProc.id })
                                    .execute();
                                await entities.pot_po_internal_process.createQueryBuilder()
                                    .delete()
                                    .where("id = :id", { id: existingProc.id })
                                    .execute();
                                syncSummary.deletedInternal++;
                                syncSummary.deletedHistory += histCount;
                            }
                        }
                    }

                    // ==========================================================
                    // HANDLE DELETIONS: Hapus DO yang tidak ada di DWH
                    // ==========================================================
                    if (preliminaryItemId) {
                        const existingDeliveriesInDb = await entities.pot_po_delivery_process.find({ 
                            where: { po_item_id: preliminaryItemId } 
                        });

                        // Kumpulkan semua delivery_no yang ada di payload DWH saat ini
                        const currentDeliveryNos = (itemDef.deliveryProcesses || []).map(d => d.delivery_no).filter(Boolean);

                        for (const existingDel of existingDeliveriesInDb) {
                            const delNo = existingDel.delivery_no || existingDel.do;

                            // Jika delivery_no di DB tidak ditemukan di payload saat ini, berarti DO dihapus di sumber
                            if (delNo && !currentDeliveryNos.includes(delNo)) {
                                const histCount = await entities.pot_po_history_status.count({ where: { po_delivery_process_id: existingDel.id } });
                                await entities.pot_po_history_status.createQueryBuilder()
                                    .delete()
                                    .where("po_delivery_process_id = :id", { id: existingDel.id })
                                    .execute();
                                await entities.pot_po_delivery_process.createQueryBuilder()
                                    .delete()
                                    .where("id = :id", { id: existingDel.id })
                                    .execute();
                                syncSummary.deletedDelivery++;
                                syncSummary.deletedDelHistory += histCount;
                            }
                        }
                    }

                    let itemId = null;
                    const itemPayload = {
                        so_date: itemDef.so_date || null,
                        so_type: itemDef.so_type || null,
                        so_quantity: Number(itemDef.so_quantity || 0), 
                        part_number: itemDef.part_number || null, 
                        part_description: itemDef.part_description || null, 
                        material_type: itemDef.material_type || null,
                        product: itemDef.product || null,
                        plant: itemDef.plant || null,
                        pss_no: itemDef.pss_no || null,
                        pss_name: itemDef.pss_name || null,
                        sales_office: itemDef.sales_office || null,
                        sales_office_name: itemDef.sales_office_name || null,
                        sales_item_category: itemDef.sales_item_category || null,
                        sales_item_currency: itemDef.sales_item_currency || null,
                        sales_item_net_value: Number(itemDef.sales_item_net_value || 0), 
                        sales_item_net_price: Number(itemDef.sales_item_net_price || 0), 
                        requested_delivery_date: itemDef.requested_delivery_date || null,
                        customer_po_date: itemDef.customer_purchase_order_date || null,
                        qty_order: Number(itemDef.qty_order || 0), 
                        eta_type: itemDef.eta_type || ETA_TYPE.NULL,
                        eta_customer_received: itemDef.eta_customer_received || null,
                        sales_item_higher_level_item: itemDef.sales_item_higher_level_item || 0,
                        is_sales_item_header: itemDef.is_header || 0,
                    };

                    if (!existingItem) {
                        // INSERT ITEM
                        itemPayload.po_id = poId; 
                        itemPayload.so_number = itemDef.so_number; 
                        itemPayload.so_item = itemDef.so_item;
                        itemPayload.qty_supply = 0;
                        itemPayload.createdBy = by; 
                        itemPayload.createdAt = now;
                        itemPayload.updatedBy = by; 
                        itemPayload.updatedAt = now;
                        const insertResult = await entities.pot_po_item.createQueryBuilder()
                            .insert()
                            .values(itemPayload)
                            .execute();
                        itemId = insertResult.identifiers[0].id;
                        syncSummary.createdItem++;
                    } else {
                        itemId = existingItem.id;

                        // CHECK IF ITEM CHANGED
                        let hasChanges = false;
                        if (formatDate(itemPayload.so_date) !== formatDate(existingItem.so_date)) hasChanges = true;
                        if (String(itemPayload.so_type) !== String(existingItem.so_type)) hasChanges = true;
                        if (String(itemPayload.so_quantity) !== String(existingItem.so_quantity)) hasChanges = true;
                        if (String(itemPayload.part_number) !== String(existingItem.part_number)) hasChanges = true;
                        if (String(itemPayload.part_description) !== String(existingItem.part_description)) hasChanges = true;
                        if (String(itemPayload.material_type) !== String(existingItem.material_type)) hasChanges = true;
                        if (String(itemPayload.product) !== String(existingItem.product)) hasChanges = true;
                        if (String(itemPayload.plant) !== String(existingItem.plant)) hasChanges = true;
                        if (String(itemPayload.pss_no) !== String(existingItem.pss_no)) hasChanges = true;
                        if (String(itemPayload.pss_name) !== String(existingItem.pss_name)) hasChanges = true;
                        if (String(itemPayload.sales_office) !== String(existingItem.sales_office)) hasChanges = true;
                        if (String(itemPayload.sales_office_name) !== String(existingItem.sales_office_name)) hasChanges = true;
                        if (String(itemPayload.sales_item_category) !== String(existingItem.sales_item_category)) hasChanges = true;
                        if (String(itemPayload.sales_item_currency) !== String(existingItem.sales_item_currency)) hasChanges = true;
                        if (String(itemPayload.sales_item_net_value) !== String(existingItem.sales_item_net_value)) hasChanges = true;
                        if (String(itemPayload.sales_item_net_price) !== String(existingItem.sales_item_net_price)) hasChanges = true;
                        if (formatDate(itemPayload.requested_delivery_date) !== formatDate(existingItem.requested_delivery_date)) hasChanges = true;
                        if (formatDate(itemPayload.customer_po_date) !== formatDate(existingItem.customer_po_date)) hasChanges = true;
                        if (String(itemPayload.qty_order) !== String(existingItem.qty_order)) hasChanges = true;
                        if (String(itemPayload.eta_type) !== String(existingItem.eta_type)) hasChanges = true;
                        if (formatDate(itemPayload.eta_customer_received) !== formatDate(existingItem.eta_customer_received)) hasChanges = true;
                        if (String(itemPayload.sales_item_higher_level_item) !== String(existingItem.sales_item_higher_level_item)) hasChanges = true;
                        if (String(itemPayload.is_sales_item_header) !== String(existingItem.is_sales_item_header)) hasChanges = true;

                        if (hasChanges) {
                            // UPDATE ITEM
                            itemPayload.updatedBy = by; 
                            itemPayload.updatedAt = now;
                            await entities.pot_po_item.createQueryBuilder()
                                .update()
                                .set(itemPayload)
                                .where("id = :id", { id: existingItem.id })
                                .execute();
                            syncSummary.updatedItem++;
                        }
                    }

                    // SYNC INTERNAL PROCESS
                    for (const processDef of itemDef.internalProcesses || []) {
                        try {
                            const rowHash = String(processDef.row_hash);

                            // PROCESS EXISTING
                            const existingProcess = await entities.pot_po_internal_process.findOne({
                                where: { po_item_id: itemId, so_number: itemDef.so_number, so_item: itemDef.so_item, row_hash: rowHash }
                            });

                            // DOCUMENT NUMBER & SOURCE PLANT
                            let documentNumber = null;
                            let sourcePlant = null;
                            if (processDef.sourcing_type === SOURCING.TP) {
                                documentNumber = processDef.tp_number;
                                sourcePlant = processDef.plant || null;
                            }
                            if (processDef.sourcing_type === SOURCING.PO_STO) {
                                documentNumber = processDef.po_sto_number;
                                sourcePlant = processDef.from_plant || null;
                            }
                            if (processDef.sourcing_type === SOURCING.PR) {
                                documentNumber = processDef.pr_number;
                                sourcePlant = processDef.vendor_name || null;
                            }

                            // QTY ALLOCATED
                            let qty_allocated_final = 0;
                            if (processDef.sourcing_type === SOURCING.TP) {
                                qty_allocated_final = Number(processDef.qty_allocated || 0);
                            }
                            if (processDef.sourcing_type === SOURCING.PO_STO) {
                                qty_allocated_final = Number(processDef.po_sto_qi_to_uu_quantity || 0);
                            }
                            if (processDef.sourcing_type === SOURCING.PR && processDef.sourcing_sub_type === 'PR Direct') {
                                qty_allocated_final = Number(processDef.pr_qi_to_uu_quantity || 0);
                            }
                            if (processDef.sourcing_type === SOURCING.PR && processDef.sourcing_sub_type === 'PR Indirect') {
                                qty_allocated_final = Number(processDef.po_sto_qi_to_uu_quantity || 0);
                            }

                            let processId = null;
                            const processPayload = {
                                so_number: processDef.so_number,
                                so_item: processDef.so_item,
                                so_type: processDef.so_type || null,
                                sourcing_type: processDef.sourcing_type || null,
                                sourcing_sub_type: processDef.sourcing_sub_type || null,
                                document_number: documentNumber || null,
                                plant: processDef.plant || null,
                                sales_office: processDef.sales_office || null,
                                sales_item_category: processDef.sales_item_category || null,
                                sales_item_net_price: Number(processDef.sales_item_net_price || 0),
                                source_plant: sourcePlant || null,
                                from_plant: processDef.from_plant || null,
                                to_plant: processDef.to_plant || null,
                                moda: processDef.moda || null,
                                pr_plant: processDef.pr_plant || null,
                                po_plant: processDef.po_plant || null,
                                material_type: processDef.material_type || null,
                                lab_office: processDef.lab_office || null,
                                po_type: processDef.po_type || null,
                                vendor_code: processDef.vendor_code || null,
                                vendor_name: processDef.vendor_name || null,
                                qty_sales_order: Number(processDef.qty_sales_order || 0),
                                qty_sourcing: Number(processDef.qty_sourcing || 0),
                                qty_allocated: Number(qty_allocated_final || 0),
                                eta_type: processDef.eta_type || ETA_TYPE.NULL,
                                eta_customer_received: processDef.eta_customer_received || null,
                                order_status_id: processDef.status_id || null,

                                // Sourcing Dates
                                sourcing_date: processDef.so_created_date || null,
                                pr_number: processDef.pr_number || null,
                                pr_date: processDef.pr_date || null,
                                pr_quantity: Number(processDef.pr_quantity || 0),
                                pr_type: processDef.pr_type || null,
                                po_number_pr: processDef.po_number_pr || null,
                                po_date_pr: processDef.po_date_pr || null,
                                po_quantity_pr: Number(processDef.po_quantity_pr || 0),
                                po_type_pr: processDef.po_type_pr || null,
                                migo_107_number: processDef.migo107_document || null,
                                migo_107_date: processDef.migo107_date || null,
                                migo_107_quantity: processDef.migo107_quantity || null,
                                migo_109_number: processDef.migo109_document || null,
                                migo_109_date: processDef.migo109_date || null,
                                migo_109_quantity: processDef.migo109_quantity || null,
                                migo_101_gr_date: processDef.migo101_date || null,
                                pr_confirm_to_in_date: processDef.pr_confirm_to_in_date || null,
                                po_sto_number: processDef.po_sto_number || null,
                                po_sto_date: processDef.po_sto_date || null,

                                // PR QI
                                pr_qi_to_block_number: processDef.pr_qi_to_block_document || null,
                                pr_qi_to_block_date: processDef.pr_qi_to_block_date || null,
                                pr_qi_to_block_quantity: processDef.pr_qi_to_block_quantity || null,
                                pr_qi_to_uu_number: processDef.pr_qi_to_uu_document || null,
                                pr_qi_to_uu_date: processDef.pr_qi_to_uu_date || null,
                                pr_qi_to_uu_quantity: processDef.pr_qi_to_uu_quantity || null,

                                // PO STO QI
                                po_sto_qi_to_block_number: processDef.po_sto_qi_to_block_document || null,
                                po_sto_qi_to_block_date: processDef.po_sto_qi_to_block_date || null,
                                po_sto_qi_to_block_quantity: processDef.po_sto_qi_to_block_quantity || null,
                                po_sto_qi_to_uu_number: processDef.po_sto_qi_to_uu_document || null,
                                po_sto_qi_to_uu_date: processDef.po_sto_qi_to_uu_date || null,
                                po_sto_qi_to_uu_quantity: processDef.po_sto_qi_to_uu_quantity || null,

                                // PO STO Delivery/TO
                                po_sto_do_number: processDef.po_sto_do_number || null,
                                po_sto_do_date: processDef.po_sto_do_date || null,
                                po_sto_do_quantity: Number(processDef.po_sto_do_quantity || 0),
                                po_sto_to_number: processDef.po_sto_to_number || null,
                                po_sto_to_date: processDef.po_sto_create_to_date || null,
                                po_sto_confirm_to_in_date: processDef.po_sto_confirm_to_in_date || null,
                                po_sto_confirm_to_out_date: processDef.po_sto_confirm_to_out_date || null,
                                po_sto_spb_number: processDef.po_sto_spb_number || null,
                                po_sto_spb_created_date: processDef.po_sto_spb_created_date || null,
                                po_sto_gi_number: processDef.po_sto_gi_number || null,
                                po_sto_gi_date: processDef.po_sto_gi_date || null,

                                updatedBy: by,
                                updatedAt: now
                            };

                            if (!existingProcess) {
                                // INSERT PROCESS
                                processPayload.po_item_id = itemId;
                                processPayload.row_hash = rowHash;
                                processPayload.createdBy = by; 
                                processPayload.createdAt = now;
                                const insertResult = await entities.pot_po_internal_process.createQueryBuilder()
                                    .insert()
                                    .values(processPayload)
                                    .execute();
                                processId = insertResult.identifiers[0].id;
                                syncSummary.createdInternal++;
                            } else {
                                // UPDATE PROCESS
                                await entities.pot_po_internal_process.createQueryBuilder()
                                    .update()
                                    .set(processPayload)
                                    .where("id = :id", { id: existingProcess.id })
                                    .execute();
                                processId = existingProcess.id;
                                syncSummary.updatedInternal++;
                            }

                            // SYNC STATUS HISTORY
                            for (const historyDef of processDef.status_history || []) {
                                try {
                                    // Status ID
                                    const statusId = historyDef.status_id || statusCodeToId[historyDef.status_code] || null;
                                    if (!statusId) {
                                        continue;
                                    }

                                    // HISTORY EXISTING
                                    const existingHistory = await entities.pot_po_history_status.findOne({
                                        where: { po_internal_process_id: processId, status_id: statusId }
                                    });

                                    const historyPayload = {
                                        status_date: historyDef.date || null,
                                    };

                                    if (!existingHistory) {
                                        // INSERT HISTORY
                                        historyPayload.po_internal_process_id = processId;
                                        historyPayload.status_id = statusId;
                                        historyPayload.createdBy = by;
                                        historyPayload.createdAt = now;
                                        historyPayload.updatedBy = by;
                                        historyPayload.updatedAt = now;
                                        await entities.pot_po_history_status
                                            .createQueryBuilder()
                                            .insert()
                                            .values(historyPayload)
                                            .execute();
                                        syncSummary.createdHistory++;
                                    } else {
                                        // CHECK IF HISTORY CHANGED
                                        let hasChanges = false;
                                        if (moment(historyPayload.status_date).valueOf() !== moment(existingHistory.status_date).valueOf()) hasChanges = true;

                                        if (hasChanges) {
                                            // UPDATE HISTORY
                                            historyPayload.updatedBy = by; 
                                            historyPayload.updatedAt = now;
                                            await entities.pot_po_history_status
                                                .createQueryBuilder()
                                                .update()
                                                .set(historyPayload)
                                                .where("id = :id", { id: existingHistory.id })
                                                .execute();
                                            syncSummary.updatedHistory++;
                                        }
                                    }
                                } catch (historyError) {
                                    syncSummary.errors.push({
                                        type: "HISTORY",
                                        po: poDef.po_number,
                                        so: itemDef.so_number,
                                        so_item: itemDef.so_item,
                                        row_hash: processDef.row_hash,
                                        status_code: historyDef.status_code,
                                        error: historyError.message
                                    });
                                }
                            }
                        } catch (processError) {
                            syncSummary.errors.push({
                                type: "PROCESS",
                                po: poDef.po_number,
                                so: itemDef.so_number,
                                so_item: itemDef.so_item,
                                row_hash: processDef.row_hash,
                                error: processError.message
                            });
                        }
                    }

                    // SYNC DELIVERY PROCESS
                    for (const deliveryDef of itemDef.deliveryProcesses || []) {
                        try {
                            // PROCESS EXISTING
                            const existingDelivery = await entities.pot_po_delivery_process.findOne({
                                where: { po_item_id: itemId, so_number: itemDef.so_number, so_item: itemDef.so_item, do: deliveryDef.delivery_no }
                            });

                            // Cek Data di Tabel Temporary Kurir
                            const existingDeliveryTemp = await entities.pot_kurir_delivery_temp.findOne({
                                where: { do_number: deliveryDef.delivery_no }
                            });
                            let isFromTemp = false;

                            // Cek Flag Cancel GI
                            const hasGiCancel = Number(deliveryDef.has_customer_gi_cancellation_event) === 1;

                            // --------------------------------------------------
                            // DELETE TEMP DATA JIKA GI CANCEL
                            // --------------------------------------------------
                            if (hasGiCancel && existingDeliveryTemp) {
                                await entities.pot_kurir_delivery_temp.createQueryBuilder()
                                    .delete()
                                    .where("do_number = :doNumber", { doNumber: deliveryDef.delivery_no })
                                    .execute();
                            }

                            let deliveryId = null;
                            const deliveryPayload = {
                                sales_item_description: itemDef.part_description || null,
                                superodinate: deliveryDef.superodinate || null,
                                superodinate_description: deliveryDef.superodinate_description || null,
                                requested_delivery_date: deliveryDef.requested_delivery_date || null,
                                restricted_notes: deliveryDef.lab_office || null,
                                net_value: deliveryDef.sales_item_net_value || 0,
                                currency: deliveryDef.sales_item_currency || null,
                                amount_item: deliveryDef.sales_item_net_price || 0,
                                invoice_no: deliveryDef.invoice_no || null,
                                invoice_date: deliveryDef.invoice_date || null,
                                invoice_quantity: deliveryDef.invoice_quantity || null,
                                delivery_date: deliveryDef.delivery_created_date || null,
                                delivery_type: deliveryDef.delivery_type || null,
                                delivery_item: deliveryDef.delivery_item || null,
                                delivery_quantity: deliveryDef.delivery_quantity || null,
                                create_to_date: deliveryDef.create_to_date || null,
                                confirm_to_out_date: deliveryDef.confirm_to_out_date || null,
                                spb: deliveryDef.spb_number || null,
                                spb_number: deliveryDef.spb_number || null,
                                spb_created_date: deliveryDef.spb_created_date || null,
                                gi_number: deliveryDef.gi_number || null,
                                gi_date: deliveryDef.gi_date || null,
                                customer_po_date: deliveryDef.customer_purchase_order_date || null,
                                partial_delivery: deliveryDef.partial_delivery || null,
                                eta_type: deliveryDef.eta_type || ETA_TYPE.NULL,
                                eta_customer_received: deliveryDef.eta_customer_received || null,
                                order_status_id: deliveryDef.status_id || null,
                                updatedBy: by, 
                                updatedAt: now
                            };

                            if (!existingDelivery) {
                                // INSERT PROCESS
                                deliveryPayload.po_item_id = itemId;
                                deliveryPayload.so_number = itemDef.so_number || null;
                                deliveryPayload.so_item = itemDef.so_item || null;
                                deliveryPayload.do = deliveryDef.delivery_no || null;
                                deliveryPayload.delivery_no = deliveryDef.delivery_no || null;
                                deliveryPayload.createdBy = by; 
                                deliveryPayload.createdAt = now;

                                // Cek apakah dari temp dan tidak cancel GI
                                if (existingDeliveryTemp && !hasGiCancel) {
                                    deliveryPayload.shipment_date = existingDeliveryTemp.shipment_date;
                                    deliveryPayload.expedition_pickup_date = existingDeliveryTemp.expedition_pickup_date;
                                    deliveryPayload.order_status_id = statusCodeToId[STATUS.SHIPPED];
                                    isFromTemp = true;
                                }

                                const insertResult = await entities.pot_po_delivery_process.createQueryBuilder()
                                    .insert()
                                    .values(deliveryPayload)
                                    .execute();
                                deliveryId = insertResult.identifiers[0].id;
                                syncSummary.createdDelivery++;

                                // AUTO CREATE HISTORY: SHIPPED (Jika dari Temp)
                                if (isFromTemp) {
                                    const shippedStatusId = statusCodeToId[STATUS.SHIPPED];
                                    if (shippedStatusId) {
                                        const existingShippedHist = await entities.pot_po_history_status.findOne({
                                            where: { po_delivery_process_id: deliveryId, status_id: shippedStatusId }
                                        });
                                        if (!existingShippedHist) {
                                            await entities.pot_po_history_status.createQueryBuilder().insert().values({
                                                po_delivery_process_id: deliveryId,
                                                status_id: shippedStatusId,
                                                status_date: existingDeliveryTemp.shipment_date,
                                                createdBy: by, createdAt: now, updatedBy: by, updatedAt: now
                                            }).execute();
                                            syncSummary.createdDelHistory++;
                                        }
                                    }
                                }
                            } else {
                                // UPDATE PROCESS
                                // Proteksi Delivery Process Status
                                if (!hasGiCancel) {
                                    if (existingDelivery.order_status_id) {
                                        const exSt = statusByIdMap[existingDelivery.order_status_id];
                                        if (exSt && (exSt.status_code === STATUS.SHIPPED || exSt.status_code === STATUS.DELIVERED)) {
                                            deliveryPayload.order_status_id = existingDelivery.order_status_id;
                                        }
                                    }
                                }

                                // Cancel GI
                                if (hasGiCancel) {
                                    // Shipped
                                    deliveryPayload.shipment_date = null;
                                    deliveryPayload.expedition_pickup_date = null;
                                    // Delivered
                                    deliveryPayload.receive_date = null;
                                    deliveryPayload.customer_receive_date = null;
                                    deliveryPayload.customer_receive_name = null;
                                    deliveryPayload.qty_supply = null;
                                    // Status
                                    deliveryPayload.order_status_id = deliveryDef.confirm_to_out_date
                                        ? statusCodeToId[STATUS.READY_AT_WAREHOUSE]
                                        : statusCodeToId[STATUS.PROCESSING];
                                }

                                await entities.pot_po_delivery_process.createQueryBuilder()
                                    .update().set(deliveryPayload)
                                    .where("id = :id", { id: existingDelivery.id })
                                    .execute();
                                deliveryId = existingDelivery.id;
                                syncSummary.updatedDelivery++;
                            }

                            // SYNC DELIVERY STATUS HISTORY
                            for (const historyDef of deliveryDef.status_history || []) {
                                try {
                                    const statusId = historyDef.status_id || statusCodeToId[historyDef.status_code] || null;
                                    if (!statusId) continue;

                                    // HISTORY EXISTING
                                    const existingHistory = await entities.pot_po_history_status.findOne({
                                        where: { po_delivery_process_id: deliveryId, status_id: statusId }
                                    });

                                    const historyPayload = {
                                        status_date: historyDef.date || null,
                                    };

                                    if (!existingHistory) {
                                        // INSERT HISTORY
                                        historyPayload.po_delivery_process_id = deliveryId;
                                        historyPayload.status_id = statusId;
                                        historyPayload.createdBy = by;
                                        historyPayload.createdAt = now;
                                        historyPayload.updatedBy = by;
                                        historyPayload.updatedAt = now;
                                        await entities.pot_po_history_status
                                            .createQueryBuilder()
                                            .insert()
                                            .values(historyPayload)
                                            .execute();
                                        syncSummary.createdDelHistory++;
                                    } else {
                                        // CHECK IF HISTORY CHANGED
                                        let hasChanges = false;
                                        if (moment(historyPayload.status_date).valueOf() !== moment(existingHistory.status_date).valueOf()) hasChanges = true;

                                        if (hasChanges) {
                                            // UPDATE HISTORY
                                            historyPayload.updatedBy = by; 
                                            historyPayload.updatedAt = now;
                                            await entities.pot_po_history_status
                                                .createQueryBuilder()
                                                .update()
                                                .set(historyPayload)
                                                .where("id = :id", { id: existingHistory.id })
                                                .execute();
                                            syncSummary.updatedDelHistory++;
                                        }
                                    }
                                } catch (historyError) {
                                    syncSummary.errors.push({
                                        type: "DELIVERY_HISTORY", 
                                        po: poDef.po_number, 
                                        so: itemDef.so_number, 
                                        so_item: itemDef.so_item,
                                        delivery_no: deliveryDef.delivery_no, 
                                        status_code: historyDef.status_code, 
                                        error: historyError.message
                                    });
                                }
                            }
                        } catch (deliveryError) {
                            syncSummary.errors.push({
                                type: "DELIVERY_PROCESS", 
                                po: poDef.po_number, 
                                so: itemDef.so_number, 
                                so_item: itemDef.so_item,
                                delivery_no: deliveryDef.delivery_no, 
                                error: deliveryError.message
                            });
                        }
                    }
                } catch (itemError) {
                    syncSummary.errors.push({
                        type: "ITEM",
                        po: poDef.po_number,
                        so: itemDef.so_number,
                        so_item: itemDef.so_item,
                        error: itemError.message
                    });
                }
            }
        } catch (poError) {
            syncSummary.errors.push({
                type: "PO",
                po: poDef.po_number,
                error: poError.message
            });
        }
    }

    // Helper: pecah array jadi batch (default 100 per batch)
    function chunkArray(arr, size = 100) {
        const result = [];
        for (let i = 0; i < arr.length; i += size) {
            result.push(arr.slice(i, i + size));
        }
        return result;
    }

    // Helper: fetch dengan In() tapi otomatis di-chunk
    async function findInChunks(repo, field, values) {
        const chunks = chunkArray(values, 100);
        const allResults = [];
        for (const chunk of chunks) {
            const rows = await repo.find({ where: { [field]: In(chunk) } });
            allResults.push(...rows);
        }
        return allResults;
    }

    try {
        // --------------------------------------------------
        // RE-CALCULATE PO STATUS & SUPPLY
        // --------------------------------------------------

        // STEP 1: Ambil semua PO (otomatis di-chunk)
        const poNumbers = poList.map(p => p.po_number).filter(Boolean);
        const pos = await findInChunks(entities.pot_po, 'po_number', poNumbers);
        const poIds = pos.map(p => p.id);

        // STEP 2: Ambil semua item PO (otomatis di-chunk)
        const items = await findInChunks(entities.pot_po_item, 'po_id', poIds);
        const itemIds = items.map(i => i.id);

        // STEP 3: Ambil semua proses (otomatis di-chunk)
        const internalProcs = await findInChunks(entities.pot_po_internal_process, 'po_item_id', itemIds);
        const deliveryProcs = await findInChunks(entities.pot_po_delivery_process, 'po_item_id', itemIds);

        // --------------------------------------------------
        // BAGIAN A: RE-CALCULATE PO STATUS (Item-Level Validation)
        //
        // 1. Hitung Qty Sourcing per Non-Head Item (dengan deduplikasi PR).
        // 2. Tentukan Status per Non-Head Item: 
        //    - Jika Sum Qty Sourcing >= Qty Order Item -> Item Selesai Sourcing.
        //    - Jika tidak -> Item Belum Selesai.
        // 3. Tentukan Status PO:
        //    - Jika ADA item yang belum selesai sourcing -> PO Status = PROCESSING.
        //    - Jika SEMUA item selesai sourcing -> PO Status = Min Sequence dari Delivery Process.
        // --------------------------------------------------

        // Map itemId -> poId
        const poIdByItemId = {};
        for (const item of items) {
            poIdByItemId[item.id] = item.po_id;
        }

        // PENTING: Filter Item Non-Head (Child Items) - Item yang is_sales_item_header = 0
        const nonHeadItems = items.filter(item => {
            return Number(item.is_sales_item_header) === 0;
        });

        // Object penampung kalkulasi per ITEM: { itemId: { totalSourcingQty, qtyOrder, isFullySourced } }
        const itemCalcMap = {};
        for (const item of nonHeadItems) {
            itemCalcMap[item.id] = {
                totalSourcingQty: 0,
                qtyOrder: Number(item.qty_order || 0),
                isFullySourced: false
            };
        }

        // Hitung Total Qty Sourcing per ITEM (dengan deduplikasi PR)
        const calculatedPRs = new Set(); // Key: itemId + "|" + prNumber, Value: true (sudah dihitung)

        for (const proc of internalProcs) {
            if (!proc.po_item_id) continue;
            const itemId = proc.po_item_id;
            
            if (!itemCalcMap[itemId]) continue;

            let qtyToAdd = 0;

            // Logika Deduplikasi Khusus PR
            if (proc.sourcing_type === 'PR' && proc.pr_number) {
                const uniqueKey = `${itemId}|${proc.pr_number}`;
                
                if (!calculatedPRs.has(uniqueKey)) {
                    qtyToAdd = Number(proc.qty_sourcing || 0);
                    calculatedPRs.add(uniqueKey);
                }
            } else {
                // Untuk Non-PR (TP/PO STO), hitung semua baris
                qtyToAdd = Number(proc.qty_sourcing || 0);
            }

            itemCalcMap[itemId].totalSourcingQty += qtyToAdd;
        }

        // Tentukan apakah setiap Item sudah Fully Sourced
        for (const itemId in itemCalcMap) {
            const calc = itemCalcMap[itemId];
            // Jika qty sourcing >= qty order, maka item dianggap selesai sourcing
            if (calc.totalSourcingQty >= calc.qtyOrder) {
                calc.isFullySourced = true;
            }
        }

        // Agregasi ke Level PO & Cari Status Delivery Terendah
        // Object penampung kalkulasi per PO: { poId: { allNonHeadItemsSourced, minStatusSeq, minStatusId } }
        const poCalcMap = {};
        for (const po of pos) {
            poCalcMap[po.id] = {
                allNonHeadItemsSourced: true, // Asumsi awal true, akan jadi false jika ada item yang belum
                minStatusSeq: Infinity, 
                minStatusId: null,
            };
        }

        // Cek Status Sourcing per Item terhadap PO-nya
        for (const itemId in itemCalcMap) {
            const itemCalc = itemCalcMap[itemId];
            const poId = poIdByItemId[itemId];

            if (poId && poCalcMap[poId]) {
                // Jika ada SATU saja item yang belum fully sourced, maka PO belum fully sourced
                if (!itemCalc.isFullySourced) {
                    poCalcMap[poId].allNonHeadItemsSourced = false;
                }
            }
        }

        // Cari Status Terendah (Sequence Terkecil) dari Delivery Process
        for (const proc of deliveryProcs) {
            if (!proc.po_item_id) continue;

            const poId = poIdByItemId[proc.po_item_id];
            if (!poId || !poCalcMap[poId]) continue;

            if (proc.order_status_id) {
                const status = statusByIdMap[proc.order_status_id];
                if (status) {
                    const seq = Number(status.sequence);
                    if (seq < poCalcMap[poId].minStatusSeq) {
                        poCalcMap[poId].minStatusSeq = seq;
                        poCalcMap[poId].minStatusId = status.id;
                    }
                }
            }
        }

        // STEP 4: Tentukan Final Status per PO & Update Database
        for (const po of pos) {
            const calc = poCalcMap[po.id];
            let finalStatusIdForPo = null;

            // LOGIKA UTAMA STATUS PO
            if (!calc.allNonHeadItemsSourced) {
                // Jika ADA item yang belum lengkap sourcing-nya -> Paksa Status PROCESSING
                finalStatusIdForPo = statusCodeToId[STATUS.PROCESSING];
            } else {
                // Jika SEMUA item sudah lengkap sourcing-nya -> Ikuti Status Delivery Terendah
                if (calc.minStatusId) {
                    finalStatusIdForPo = calc.minStatusId;
                } else {
                    // Semua item sourcing lengkap, tapi belum ada delivery process sama sekali
                    finalStatusIdForPo = statusCodeToId[STATUS.PROCESSING];
                }
            }

            // Update PO Header di Database jika status berubah
            if (finalStatusIdForPo !== po.order_status_id) {
                await entities.pot_po.createQueryBuilder()
                    .update()
                    .set({ 
                        order_status_id: finalStatusIdForPo,
                        updatedBy: (req.user && req.user.username) || "system",
                        updatedAt: Date.now()
                    })
                    .where("id = :id", { id: po.id })
                    .execute();
            }
        }

        // --------------------------------------------------
        // BAGIAN B: RE-CALCULATE QTY SUPPLY & PROGRESS SUPPLY
        // --------------------------------------------------

        // STEP 1: Hitung qty_supply per item berdasarkan delivery processes yang valid
        const qtySupplyByItemId = {};

        // Initialize dengan 0 untuk semua items
        for (const item of items) {
            qtySupplyByItemId[item.id] = 0;
        }

        // Accumulate dari delivery processes
        for (const delProc of deliveryProcs) {
            if (!delProc.po_item_id) continue;

            // Tambahkan ke qty_supply item
            const delQty = Number(delProc.qty_supply || 0);
            if (qtySupplyByItemId.hasOwnProperty(delProc.po_item_id)) {
                qtySupplyByItemId[delProc.po_item_id] += delQty;
            }
        }

        // STEP 2: Update qty_supply di setiap PO Item
        for (const item of items) {
            const calculatedQtySupply = qtySupplyByItemId[item.id] || 0;

            // Update hanya jika berbeda
            if (calculatedQtySupply !== Number(item.qty_supply || 0)) {
                await entities.pot_po_item.createQueryBuilder()
                    .update()
                    .set({ 
                        qty_supply: calculatedQtySupply,
                        updatedBy: (req.user && req.user.username) || "system",
                        updatedAt: Date.now()
                    })
                    .where("id = :id", { id: item.id })
                    .execute();
            }
        }

        // STEP 3: Re-calculate qty_supply dan progress_supply di PO level
        // PENTING: Hanya menjumlahkan dari ROOT ITEMS (Item tanpa higher level item)

        // Filter Root Items terlebih dahulu - Item yang tidak memiliki higher level item
        const rootItems = items.filter(item => {
            return Number(item.sales_item_higher_level_item) === 0;
        });

        // Group items by po_id dan sum qty_supply
        const qtySupplyByPoId = {};

        // Gunakan calculated value dari qtySupplyByItemId, bukan dari DB (stale data)
        for (const item of rootItems) {
            const poId = item.po_id;

            if (!qtySupplyByPoId[poId]) {
                qtySupplyByPoId[poId] = 0;
            }

            // Gunakan calculated value yang sudah di-update
            qtySupplyByPoId[poId] += qtySupplyByItemId[item.id] || 0;
        }

        // STEP 4: Update PO dengan qty_supply dan progress_supply yang baru
        for (const po of pos) {
            const calculatedQtySupply = qtySupplyByPoId[po.id] || 0;
            const totalQtyOrder = Number(po.qty_order || 0);

            // Hitung progress supply (percentage)
            let progressSupply = 0;
            if (totalQtyOrder > 0) {
                progressSupply = Math.round((calculatedQtySupply / totalQtyOrder) * 100);
                if (progressSupply > 100) progressSupply = 100; // Cap di 100%
            }

            // Update hanya jika berbeda
            if (
                calculatedQtySupply !== Number(po.qty_supply || 0) || 
                progressSupply !== Number(po.progress_supply || 0)
            ) {
                await entities.pot_po.createQueryBuilder()
                    .update()
                    .set({ 
                        qty_supply: calculatedQtySupply,
                        progress_supply: progressSupply,
                        updatedBy: (req.user && req.user.username) || "system",
                        updatedAt: Date.now()
                    })
                    .where("id = :id", { id: po.id })
                    .execute();
            }
        }
    } catch (error) {
        syncSummary.errors.push({
            type: "PO_RECALCULATION",
            error: error.message
        });
    }

    if (syncSummary.errors.length > 0) {
        console.log(JSON.stringify({ success: false, message: "PO sync failed, please check the errors", errors: syncSummary.errors }, null, 4));
        result.statusCode = 400;
        result.data = { success: false, message: "PO sync failed, please check the errors", errors: syncSummary.errors };
        complete();
        return;
    }

    // ----------------------------------------------------
    // LOG
    // ----------------------------------------------------
    console.log(JSON.stringify({ success: true, message: "PO sync success", syncSummary: syncSummary, data: poList }, null, 4));

    // ----------------------------------------------------
    // RESPONSE
    // ----------------------------------------------------
    result.statusCode = 200;
    result.data = { success: true, message: "PO sync success", syncSummary: syncSummary, data: poList };
    complete();
    return;

} catch (error) {
    console.log(JSON.stringify({ success: false, message: "PO sync failed", error: error.message, stack: error.stack }, null, 4));
    result.statusCode = 500;
    result.data = { success: false, message: "PO sync failed", error: error.message, stack: error.stack };
    complete();
    return;
}