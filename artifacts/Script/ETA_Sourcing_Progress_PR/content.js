const body = req.body || {};

// const body = {"startDate": "2026-08-11",
//   "materialType": "ZPPE",
//   "plantPR": "JKT",
//   "plantPO": "HDO",
//   "labOffice": "001",
//   "poType": "ZPLP",       // kosongkan kalau PO Type belum diketahui -> pakai Default PO Type
//   "vendorName": "CV. ANUGRAH DAYA MULIA", // kosongkan kalau Vendor belum diketahui -> pakai Default Vendor Name
//   "etaType": "ETA1" // atau "ETA2"
// };

const startDateInput = body.startDate; // format: "YYYY-MM-DD"
const materialType = body.materialType;
const plantPR = body.plantPR;
const plantPO = body.plantPO;
const labOffice = body.labOffice;
const poType = body.poType; // opsional; kalau kosong, pakai row dengan default_po_type = "Y"
const vendorName = body.vendorName; // opsional; kalau kosong, pakai row dengan default_vendor_name = "Y"
const etaType = (body.etaType || "ETA1").toUpperCase(); // default ETA1

/**
 * Tambah working days ke sebuah tanggal (skip Sabtu & Minggu)
 */
function addWorkingDays(date, days) {
    const result = new Date(date);
    let addedDays = 0;

    while (addedDays < days) {
        result.setDate(result.getDate() + 1);

        const dayOfWeek = result.getDay(); // 0 = Minggu, 6 = Sabtu

        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            addedDays++;
        }
    }

    return result;
}

/**
 * Tambah calendar days ke sebuah tanggal (TIDAK skip Sabtu & Minggu)
 */
function addCalendarDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

/**
 * Format Date jadi string "YYYY-MM-DD"
 */
function formatDate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

try {
    // Validasi input
    if (!startDateInput) {
        result.data = { success: false, message: "Parameter startDate wajib diisi." };
        complete();
        console.log(JSON.stringify(result));
        return;
    }

    if (!materialType || !plantPR || !plantPO) {
        result.data = { success: false, message: "Parameter materialType, plantPR, dan plantPO wajib diisi." };
        complete();
        console.log(JSON.stringify(result));
        return;
    }

    if (etaType !== "ETA1" && etaType !== "ETA2") {
        result.data = { success: false, message: "Parameter etaType harus bernilai 'ETA1' atau 'ETA2'." };
        complete();
        console.log(JSON.stringify(result));
        return;
    }

    const startDate = new Date(startDateInput);

    // ===== 1. Ambil data dari pot_eta_lead_time_pr berdasarkan Material Type, Plant PR & Plant PO =====
    const whereCondition = {
        material_type: materialType,
        plant_pr: plantPR,
        plant_po: plantPO,
    };

    if (labOffice) {
        whereCondition.lab_office = labOffice;
    }

    // PO Type: kalau caller sudah tahu PO Type aktual, cari persis.
    // Kalau belum (PO belum dibuat), pakai baris yang ditandai Default PO Type = "Y".
    if (poType) {
        whereCondition.po_type = poType;
    } else {
        whereCondition.default_po_type = "Y";
    }

    // Vendor Name: sama logikanya dengan PO Type di atas.
    if (vendorName) {
        whereCondition.vendor_name = vendorName;
    } else {
        whereCondition.default_vendor_name = "Y";
    }

    // ===== 2. Ambil semua data secara paralel =====
    const [
        dataPR,
        dataLTBilling,
        dataLTDelivery
    ] = await Promise.all([
        entities.pot_eta_lead_time_pr.findOne({
            where: whereCondition,
        }),

        entities.pot_eta_lead_time_general.findOne({
            where: {
                lead_time: "LT Billing"
            }
        }),

        entities.pot_eta_lead_time_general.findOne({
            where: {
                lead_time: "LT Delivery"
            }
        })
    ]);

    // ===== 3. Validasi data hasil query =====
    if (!dataPR) {
        result.data = {
            success: false,
            message: `Data ETA Matrix PR untuk "${materialType}" - "${plantPR}" - "${plantPO}" tidak ditemukan.`,
        };
        complete();
        console.log(JSON.stringify(result));
        return;
    }

    const ltBillingDays = dataLTBilling?.total_days ?? 0;
    const ltDeliveryDays = dataLTDelivery?.total_days ?? 0;

    // ===== 4. Hitung breakdown sesuai etaType =====
    const breakdown = [];
    let currentDate = new Date(startDate);

    if (etaType === "ETA1") {

        // ===== ETA#1 = PR Date + LTM PR (5 tahap) + LT Billing + LT Delivery =====
        breakdown.push({
            step: "Start Date (PR Date)",
            type: "-",
            days: 0,
            date: formatDate(currentDate),
        });

        // Tahap 1: PR Date - PO (working days)
        currentDate = addWorkingDays(currentDate, dataPR.pr_po ?? 0);
        breakdown.push({
            step: "PO (Tgl PO)",
            type: "Working Days",
            days: dataPR.pr_po ?? 0,
            date: formatDate(currentDate),
        });

        // Tahap 2: PO - MIGO 107 (working days)
        currentDate = addWorkingDays(currentDate, dataPR.po_migo_107 ?? 0);
        breakdown.push({
            step: "MIGO 107 (Tgl GR)",
            type: "Working Days",
            days: dataPR.po_migo_107 ?? 0,
            date: formatDate(currentDate),
        });

    } else if (etaType === "ETA2") {

        // ===== ETA#2 = MIGO 107 Date + [MIGO107-MIGO109] + [MIGO109-ConfirmTOIn] + [ConfirmTOIn-UU/BlockStock] + LT Billing + LT Delivery =====
        breakdown.push({
            step: "Start Date (MIGO 107 Date)",
            type: "-",
            days: 0,
            date: formatDate(currentDate),
        });
        // ETA2 mulai langsung dari step "MIGO107 - MIGO109", 2 tahap awal (PO, MIGO 107) di-skip
        // karena starting point-nya sudah di tanggal MIGO 107 (GR).
    }

    // ===== Tahap bersama (dipakai baik ETA1 maupun ETA2) =====

    // Tahap: MIGO 107 - MIGO 109 (working days)
    currentDate = addWorkingDays(currentDate, dataPR.migo_107_migo_109 ?? 0);
    breakdown.push({
        step: "MIGO 109",
        type: "Working Days",
        days: dataPR.migo_107_migo_109 ?? 0,
        date: formatDate(currentDate),
    });

    // Tahap: MIGO 109 - Confirm TO In (working days)
    currentDate = addWorkingDays(currentDate, dataPR.migo_109_confirm_to ?? 0);
    breakdown.push({
        step: "Confirm TO In",
        type: "Working Days",
        days: dataPR.migo_109_confirm_to ?? 0,
        date: formatDate(currentDate),
    });

    // Tahap: Confirm TO In - TO Confirm UU/Block (working days)
    currentDate = addWorkingDays(currentDate, dataPR.confirm_to_to_confirm_uu ?? 0);
    breakdown.push({
        step: "TO Confirm UU/Block",
        type: "Working Days",
        days: dataPR.confirm_to_to_confirm_uu ?? 0,
        date: formatDate(currentDate),
    });

    // Tahap: LT Billing (working days)
    currentDate = addWorkingDays(currentDate, ltBillingDays);
    breakdown.push({
        step: "LT Billing",
        type: "Working Days",
        days: ltBillingDays,
        date: formatDate(currentDate),
    });

    // Tahap: LT Delivery (working days)
    currentDate = addWorkingDays(currentDate, ltDeliveryDays);
    breakdown.push({
        step: "LT Delivery",
        type: "Working Days",
        days: ltDeliveryDays,
        date: formatDate(currentDate),
    });

    // ===== 5. Hasil akhir =====
    result.data = {
        success: true,
        message: `${etaType} PR berhasil dihitung.`,
        etaType: etaType,
        materialType: materialType,
        plantPR: plantPR,
        plantPO: plantPO,
        labOffice: labOffice ?? "",
        poType: dataPR.po_type,
        poTypeIsDefault: dataPR.default_po_type === "Y",
        vendorName: dataPR.vendor_name,
        vendorNameIsDefault: dataPR.default_vendor_name === "Y",
        startDate: formatDate(startDate),
        estimatedArrival: formatDate(currentDate),
        breakdown: breakdown,
    };

    console.log(JSON.stringify(result));

}
catch (error) {
    result.data = {
        success: false,
        message: error.message,
    };
    console.log(JSON.stringify(result));
}

complete();