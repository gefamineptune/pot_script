const moment = modules.moment;
const XLSX = modules.xlsxjsstyle;
const { In } = operators;

try {

    // ------------------------------
    // Request Param
    // ------------------------------
    let param = req.query;

    const search = param.search || "";
    const progressSupply = param.progressSupply || "";
    const soCreatedDateStart = param.poReceiveDate_start || "";
    const soCreatedDateEnd = param.poReceiveDate_end || "";
    const branchId = param.branchId || "";
    const orderStatusId = param.orderStatusId || "";
    const customerId = param.customerId || "";
    const customerGroupId = param.customerGroupId || "";
    const groupTypeId = param.groupTypeId || "";

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

    // ---------------------------------
    // Helper: Apply Search & Filter
    // ---------------------------------
    function applyFilters(queryBuilder) {
        let isFirstCondition = true;

        // Helper untuk menangani where/andWhere secara dinamis
        function addCondition(condition, params = {}) {
            if (isFirstCondition) {
                queryBuilder.where(condition, params);
                isFirstCondition = false;
            } else {
                queryBuilder.andWhere(condition, params);
            }
        }

        // Search
        if (search.trim()) {
            addCondition(
                `
                (
                    LOWER(po.po_number) LIKE LOWER(:keyword)
                    OR LOWER(c.customer_name) LIKE LOWER(:keyword)
                    OR CAST(po.total_item AS VARCHAR) LIKE :keyword
                    OR CAST(po.qty_order AS VARCHAR) LIKE :keyword
                    OR CAST(po.qty_supply AS VARCHAR) LIKE :keyword
                    OR LOWER(FORMAT(po.po_receive_date, 'dd MMMM yyyy', 'en-US')) LIKE LOWER(:keyword)
                    OR LOWER(FORMAT(po.eta_full_supply, 'dd MMMM yyyy', 'en-US')) LIKE LOWER(:keyword)
                    OR LOWER(os.status_name) LIKE LOWER(:keyword)
                    OR CAST(po.branch_id AS VARCHAR) LIKE :keyword
                )
                `,
                {
                    keyword: `${search.trim()}%`
                }
            );
        }

        // Filter
        if (progressSupply && progressSupply === "open") {
            // addCondition("po.progress_supply < :progress_supply", { progress_supply: 100 });
            addCondition("po.order_status_id != :statusId", { statusId: statusCodeToId['DELIVERED'] });
        }
        if (progressSupply && progressSupply === "close") {
            // addCondition("po.progress_supply = :progress_supply", { progress_supply: 100 });
            addCondition("po.order_status_id = :statusId", { statusId: statusCodeToId['DELIVERED'] });
        }
        if (branchId) {
            addCondition("po.branch_id = :branchId", { branchId });
        }
        if (orderStatusId) {
            addCondition("os.id = :orderStatusId", { orderStatusId });
        }
        if (customerId) {
            addCondition("po.customer_id = :customerId", { customerId });
        }
        if (customerGroupId) {
            addCondition("cg.id = :customerGroupId", { customerGroupId });
        }
        if (groupTypeId) {
            addCondition("gt.id = :groupTypeId", { groupTypeId });
        }

        // Filter periode SO Created Date
        if (soCreatedDateStart && soCreatedDateEnd) {
            const subQuery = queryBuilder.subQuery()
                .select("1")
                .from("pot_po_item", "poi")
                .where("poi.po_id = po.id")
                .andWhere("poi.so_date BETWEEN :startDate AND :endDate");
            
            addCondition(`EXISTS (${subQuery.getQuery()})`, {
                startDate: `${soCreatedDateStart} 00:00:00`,
                endDate: `${soCreatedDateEnd} 23:59:59`,
                ...subQuery.getParameters()
            });
        } else if (soCreatedDateStart) {
            const subQuery = queryBuilder.subQuery()
                .select("1")
                .from("pot_po_item", "poi")
                .where("poi.po_id = po.id")
                .andWhere("poi.so_date BETWEEN :startDate AND :endDate");
            
            addCondition(`EXISTS (${subQuery.getQuery()})`, {
                startDate: `${soCreatedDateStart} 00:00:00`,
                endDate: `${soCreatedDateStart} 23:59:59`,
                ...subQuery.getParameters()
            });
        }

        return queryBuilder;
    }

    // ---------------------------------
    // Query Builder
    // ---------------------------------
    const qb = entities.pot_po.createQueryBuilder("po")
        .leftJoinAndSelect("pot_customer", "c", "c.id = po.customer_id")
        .leftJoinAndSelect("pot_customer_group", "cg", "cg.id = po.customer_group_id")
        .leftJoinAndSelect("pot_group_type", "gt", "gt.id = po.group_type_id")
        .leftJoinAndSelect("pot_master_order_status", "os", "os.id = po.order_status_id")
        .select([
            "po.id", "po.po_number", "po.po_receive_date", "po.progress_supply",
            "po.customer_id", "c.customer_code", "c.customer_name", "po.customer_group_id", "cg.customer_group_name",
            "po.group_type_id", "gt.group_type_name", "po.branch_id", "po.total_item",
            "po.qty_order", "po.qty_supply", "po.eta_full_supply", "po.order_status_id",
            "os.status_code", "os.status_name", "po.createdAt", "po.createdBy", "po.updatedAt", "po.updatedBy"
        ]);

    // ---------------------------------
    // Apply Search, Filter & Order
    // ---------------------------------
    applyFilters(qb);
    qb.orderBy("po.po_number", "DESC");

    // ---------------------------------
    // Execute Query
    // ---------------------------------
    const { entities: recordData, raw } = await qb.getRawAndEntities();

    // ------------------------------------------------------------------------
    // Fetch Related Data
    // ------------------------------------------------------------------------
    const purchaseOrderIds = recordData.map(po => po.id);
    let purchaseOrderItems = [];
    let internalProcesses = [];
    let deliveryProcesses = [];

    if (purchaseOrderIds.length > 0) {
        purchaseOrderItems = await entities.pot_po_item.find({
            where: { po_id: In(purchaseOrderIds) },
            order: {
                so_number: "ASC",
                so_item: "ASC" 
            }
        });

        const purchaseOrderItemIds = purchaseOrderItems.map(item => item.id);
        if (purchaseOrderItemIds.length > 0) {
            internalProcesses = await entities.pot_po_internal_process.find({
                where: { po_item_id: In(purchaseOrderItemIds) }
            });
            deliveryProcesses = await entities.pot_po_delivery_process.find({
                where: { po_item_id: In(purchaseOrderItemIds) }
            });
        }
    }

    // ------------------------------------------------------------------------
    // Map Data
    // ------------------------------------------------------------------------
    const internalProcessMap = {};
    internalProcesses.forEach(process => {
        if (!internalProcessMap[process.po_item_id]) internalProcessMap[process.po_item_id] = [];
        internalProcessMap[process.po_item_id].push(process);
    });

    const deliveryProcessMap = {};
    deliveryProcesses.forEach(process => {
        if (!deliveryProcessMap[process.po_item_id]) deliveryProcessMap[process.po_item_id] = [];
        deliveryProcessMap[process.po_item_id].push(process);
    });

    const purchaseOrderItemMap = {};
    purchaseOrderItems.forEach(item => {
        item.po_internal_processes = internalProcessMap[item.id] || [];
        item.po_delivery_processes = deliveryProcessMap[item.id] || [];
        
        if (!purchaseOrderItemMap[item.po_id]) purchaseOrderItemMap[item.po_id] = [];
        purchaseOrderItemMap[item.po_id].push(item);
    });

    recordData.forEach((data, index) => {
        data.customer_code = raw[index].c_customer_code;
        data.customer_name = raw[index].c_customer_name;
        data.customer_group_name = raw[index].cg_customer_group_name;
        data.group_type_name = raw[index].gt_group_type_name;
        data.order_status_name = raw[index].os_status_name;

        data.po_receive_date_formatted = data.po_receive_date 
            ? moment(data.po_receive_date).format("DD MMMM YYYY") 
            : "-";
        
        if (data.eta_type === "NULL" || !data.eta_full_supply) {
            data.eta_full_supply_formatted = "-";
        } else if (data.eta_type === "TBA") {
            data.eta_full_supply_formatted = "TBA";
        } else {
            data.eta_full_supply_formatted = data.eta_full_supply
                ? moment(data.eta_full_supply).format("DD MMMM YYYY")
                : "-";
        }

        data.po_items = purchaseOrderItemMap[data.id] || [];
    });

    // Helper format tanggal & nilai aman
    const fmt = (d) => {
        if (!d) return "-";
        const parsed = moment(d);
        return parsed.isValid() ? parsed.format("DD MMMM YYYY") : "-";
    };
    const val = (v) => {
        if (v === null || v === undefined || v === "") return "-";
        return v;
    };

    // --------------------------------------------------------------------
    // BUILD EXCEL WORKBOOK (xlsx-js-style)
    // --------------------------------------------------------------------
    const headerStyle = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "4472C4" } },
        alignment: { vertical: "center", horizontal: "center" },
    };

    function applyHeaderStyle(ws, colCount) {
        for (let c = 0; c < colCount; c++) {
            const cellRef = XLSX.utils.encode_cell({ r: 0, c });
            if (ws[cellRef]) ws[cellRef].s = headerStyle;
        }
    }

    // ======================================================================
    // SHEET 1: Customer Report
    // ======================================================================
    const customerReportHeader = [
        "PO", "Tgl PO", "Plant", "Material", "Material Desc",
        "Qty Order", "Qty Supply", "Tgl Kirim", "Tgl Diterima", "ETA"
    ];
    const customerReportRows = [];

    recordData.forEach(po => {
        (po.po_items || []).forEach(item => {
            const deliveries = item.po_delivery_processes || [];
            
            // Ambil Tgl Kirim dan Tgl Diterima yang paling terbaru
            let latestTglKirim = null;
            let latestTglDiterima = null;

            deliveries.forEach(d => {
                const tglKirim = d.shipment_date;
                const tglDiterima = d.customer_receive_date;
                
                if (tglKirim && (!latestTglKirim || new Date(tglKirim) > new Date(latestTglKirim))) {
                    latestTglKirim = tglKirim;
                }
                if (tglDiterima && (!latestTglDiterima || new Date(tglDiterima) > new Date(latestTglDiterima))) {
                    latestTglDiterima = tglDiterima;
                }
            });

            customerReportRows.push([
                po.po_number,
                po.po_receive_date_formatted,
                val(item.plant),
                val(item.part_number),
                val(item.part_description),
                val(item.qty_order),
                val(item.qty_supply),
                fmt(latestTglKirim),
                fmt(latestTglDiterima),
                po.eta_full_supply_formatted
            ]);
        });
    });

    const wsCustomerReport = XLSX.utils.aoa_to_sheet([customerReportHeader, ...customerReportRows]);
    wsCustomerReport['!cols'] = customerReportHeader.map(() => ({ wch: 22 }));
    applyHeaderStyle(wsCustomerReport, customerReportHeader.length);

    // ======================================================================
    // SHEET 2: Progress Sourcing
    // ======================================================================
    const progressSourcingHeader = [
        "Sales Office", "Sales Office Name", "Type PO", "Sales Order No.", "SO Type",
        "Created Date", "Request Delivery Date", "Item Category", "Item Number", "Material No.",
        "Material Type", "Material Name", "Restricted Notes", "Quantity SO", "Quantity Apps", "Amount Per Item",
        "S Stock", "Qty Sourcing", "PR", "PR Date", "Qty PR", "PR Type", "PO", "PO Date",
        "Qty PO", "PO Type", "Plant PR", "Plant PO", "No 107", "Qty 107", "Qty OS Principal",
        "Tgl 107", "No 109", "109", "Qty OS WRS", "Tgl 109", "No TP QI to UU/Block", "G",
        "NG", "Qty OS G", "Tgl TP QI UU", "PO STO", "PO STO Date", "DO STO", "Qty DO STO", "Tgl DO PO STO", 
        "TO PO STO", "TO Out Confirm", "Create SPB", "Moda Shipment SPB", "Tanggal GI", "Tanggal GR",
        "TO In Confirm", "TP Block QI to UU", "G", "NG", "Qty OS G", "Tgl TP QI UU", "Category PR",
        "Category Sourcing", "Tipe Sourcing", "Progress Status", "ETA Customer", "TM/NM Delivery"
    ];
    const progressSourcingRows = [];

    // Helper Date untuk Sheet 2
    const s2_currentMonthStart = moment().startOf('month');
    const s2_currentMonthEnd = moment().endOf('month');
    const s2_nextMonthStart = moment().add(1, 'month').startOf('month');
    const s2_nextMonthEnd = moment().add(1, 'month').endOf('month');
    const s2_prevMonthStart = moment().subtract(1, 'month').startOf('month');
    const s2_prevMonthEnd = moment().subtract(1, 'month').endOf('month');

    recordData.forEach(po => {
        (po.po_items || []).forEach(item => {
            const internalProcesses = item.po_internal_processes || [];

            // Hanya proses jika ada internal process
            if (internalProcesses.length === 0) {
                return; // Skip item ini jika tidak ada internal process
            }

            internalProcesses.forEach(p => {
                const migo_107_qtyOsPrincipal = p 
                    ? Number(p.po_quantity_pr) - Number(p.migo_107_quantity) 
                    : "-";
                const migo_109_qtyOsWRS = p 
                    ? Number(p.po_quantity_pr) - Number(p.migo_109_quantity) 
                    : "-";
                const pr_qtyOsG = p 
                    ? Number(p.migo_109_quantity) - Number(p.pr_qi_to_uu_quantity)
                    : "-";
                const po_sto_qtyOsG = p 
                    ? Number(p.migo_109_quantity) - Number(p.po_sto_qi_to_uu_quantity)
                    : "-";

                // Type PO Berdasarkan Created Date SO
                let typePO = "POCO"; // Default value
                if (item.so_date) {
                    const soDate = moment(item.so_date);
                    if (soDate.isValid()) {
                        // Cek apakah SO dibuat di bulan berjalan (This Month)
                        const isCurrentMonth = soDate.isBetween(s2_currentMonthStart, s2_currentMonthEnd, null, '[]');
                        if (isCurrentMonth) {
                            typePO = "PRTM"; // Partial/PR This Month
                        } else {
                            typePO = "POCO"; // Purchase Order Carry Over / Previous Month
                        }
                    }
                }

                // TM/NM Delivery
                let tmNmDelivery = "-";
                if (p && p.eta_customer_received) {
                    const etaDate = moment(p.eta_customer_received);
                    if (etaDate.isValid()) {
                        if (etaDate.isBetween(s2_prevMonthStart, s2_prevMonthEnd, null, '[]')) {
                            tmNmDelivery = "LM";
                        } else if (etaDate.isBetween(s2_currentMonthStart, s2_currentMonthEnd, null, '[]')) {
                            tmNmDelivery = "TM";
                        } else if (etaDate.isBetween(s2_nextMonthStart, s2_nextMonthEnd, null, '[]')) {
                            tmNmDelivery = "NM";
                        } else {
                            // Jika ETA jauh di masa lalu atau masa depan, bisa diisi "-" atau tanggal aslinya
                            tmNmDelivery = "-"; 
                        }
                    }
                }

                progressSourcingRows.push([
                    // -- Sales Office / Sales Office Name / Type PO
                    val(item.sales_office), 
                    val(item.sales_office_name), 
                    val(typePO),

                    // -- Sales Order No. / SO Type / Created Date / Request Delivery Date
                    val(item.so_number), 
                    val(item.so_type), 
                    fmt(item.so_date), 
                    fmt(item.requested_delivery_date),

                    // -- Item Category / Item Number / Material No. / Material Type / Material Name / Restricted Notes
                    val(item.sales_item_category), 
                    val(item.so_item), 
                    val(item.part_number), 
                    val(item.material_type), 
                    val(item.part_description), 
                    val(p ? p.lab_office : null),

                    // -- Quantity SO / Quantity Apps / Amount Per Item / S Stock / Qty Sourcing
                    val(item.so_quantity), 
                    val(item.qty_order), 
                    val(item.sales_item_net_price), 
                    val(item.so_number) + "-" + val(item.so_item), 
                    val(p ? p.qty_sourcing : null),

                    // -- PR / PR Date / Qty PR / PR Type
                    val(p ? p.pr_number : null),
                    fmt(p ? p.pr_date : null),
                    p ? (p.pr_number ? val(p.pr_quantity) : "-") : "-",
                    val(p ? p.pr_type : null),

                    // -- PO / PO Date / Qty PO / PO Type
                    val(p ? p.po_number_pr : null),
                    fmt(p ? p.po_date_pr : null),
                    p ? (p.po_number_pr ? val(p.po_quantity_pr) : "-") : "-",
                    val(p ? p.po_type_pr : null),

                    // -- Plant PR / Plant PO
                    val(p ? p.pr_plant : null),
                    val(p ? p.po_plant : null),

                    // -- No 107 / Qty 107 / Qty OS Principal / Tgl 107
                    val(p ? p.migo_107_number : null), 
                    val(p ? p.migo_107_quantity : null),  
                    p ? (p.migo_107_number && migo_107_qtyOsPrincipal >= 0 ? migo_107_qtyOsPrincipal : "-") : "-",
                    fmt(p ? p.migo_107_date : null),

                    // -- No 109 / 109 / Qty OS WRS / Tgl 109
                    val(p ? p.migo_109_number : null), 
                    val(p ? p.migo_109_quantity : null),
                    p ? (p.migo_109_number && migo_109_qtyOsWRS >= 0 ? migo_109_qtyOsWRS : "-") : "-",
                    fmt(p ? p.migo_109_date : null),

                    // -- No TP QI to UU/Block / G / NG / Qty OS G / Tgl TP QI UU
                    val(p ? p.pr_qi_to_uu_number : null), 
                    val(p ? p.pr_qi_to_uu_quantity : null), 
                    val(p ? p.pr_qi_to_block_quantity : null), 
                    p ? (p.pr_qi_to_uu_number && pr_qtyOsG >= 0 ? pr_qtyOsG : "-") : "-",
                    fmt(p ? p.pr_qi_to_uu_date : null),

                    // -- PO STO / PO STO Date / DO STO / Qty DO STO / Tgl DO PO STO
                    val(p ? p.po_sto_number : null),
                    fmt(p ? p.po_sto_date : null),
                    val(p ? p.po_sto_do_number : null),
                    p ? (p.po_sto_do_number ? val(p.po_sto_do_quantity) : "-") : "-",
                    fmt(p ? p.po_sto_do_date : null),

                    // -- TO PO STO / TO Out Confirm / Create SPB / Moda Shipment SPB
                    fmt(p ? p.po_sto_to_number : null),
                    fmt(p ? p.po_sto_confirm_to_out_date : null),
                    fmt(p ? p.po_sto_spb_created_date : null),
                    val(p ? p.moda : null),

                    // -- Tanggal GI / Tanggal GR / TO In Confirm
                    fmt(p ? p.po_sto_gi_date : null),
                    fmt(p ? p.migo_101_gr_date : null),
                    fmt(p ? p.po_sto_confirm_to_in_date : null),

                    // -- TP Block QI to UU / G / NG / Qty OS G / Tgl TP QI UU / Category PR
                    val(p ? p.po_sto_qi_to_uu_number : null), 
                    val(p ? p.po_sto_qi_to_uu_quantity : null), 
                    val(p ? p.po_sto_qi_to_block_quantity : null), 
                    (p && p.po_sto_qi_to_uu_number && po_sto_qtyOsG >= 0) ? po_sto_qtyOsG : "-",
                    fmt(p ? p.po_sto_qi_to_uu_date : null),
                    val(p ? p.sourcing_sub_type : null),

                    // -- Category Sourcing / Tipe Sourcing / Progress Status / ETA Customer / TM/NM Delivery
                    val(p ? p.sourcing_type : null),
                    val(p ? p.sourcing_sub_type : null),
                    p ? val(statusByIdMap[p.order_status_id]?.status_name || "-") : "-",
                    fmt(p ? p.eta_customer_received : null),
                    tmNmDelivery,
                ]);
            });
        });
    });

    const wsProgressSourcing = XLSX.utils.aoa_to_sheet([progressSourcingHeader, ...progressSourcingRows]);
    wsProgressSourcing['!cols'] = progressSourcingHeader.map(() => ({ wch: 22 }));
    applyHeaderStyle(wsProgressSourcing, progressSourcingHeader.length);

    // ======================================================================
    // SHEET 3: Supply Status
    // ======================================================================
    const supplyStatusHeader = [
        "Plant", "Sales Office", "Sales Office Name", "Type PO", "PSS Name", "Customer PO No.",
        "Customer PO Date", "Customer PO Receive Date", "Customer Code", "Customer Name", "Customer Group",
        "Sales Order No.", "SO Type", "Created Date",
        "Request Delivery Date", "Item Category", "Item Number", "Material No.", "Material Type",
        "Material Name", "Restricted Notes", "Quantity Order", "Net Value", "Currency",
        "Amount Per Item", "Qty Invoiced LM", "Qty Invoiced TM", "Qty Ready", "Qty Transfer TM",
        "Qty Transfer NM", "Qty Indent TM", "Qty Indent NM", "Qty OS", "Amt Invoiced LM", "Amt Invoiced TM",
        "Amt Ready", "Amt Transfer TM", "Amt Transfer NM", "Amt Indent TM", "Amt Indent NM", "Amt OS", "ETA Customer",
        "Delivery No.", "Delivery Type", "Delivery Item No.", "Delivery Date", "Create TO", "Confirm TO",
        "SPB No.", "SPB Date", "GI No.", "GI Date", "Expedition Pick-up Date", "Invoice No.", "Invoice Qty.",
        "Invoice Date", "Customer Receive Date", "Penerima", "Aging SO", "Partial Delivery"
    ];
    const supplyStatusRows = [];

    // Helper untuk batas bulan
    const currentMonthStart = moment().startOf('month');
    const currentMonthEnd = moment().endOf('month');
    const nextMonthStart = moment().add(1, 'month').startOf('month');
    const nextMonthEnd = moment().add(1, 'month').endOf('month');

    recordData.forEach(po => {
        (po.po_items || []).forEach(item => {
            const deliveries = item.po_delivery_processes || [];
            const internalProcesses = item.po_internal_processes || [];

            // 1. Hitung Metrik Level Item
            let qtyInvoicedLM = 0;
            let qtyInvoicedTM = 0;

            deliveries.forEach(d => {
                if (d.invoice_date) {
                    const invDate = moment(d.invoice_date);
                    const invQty = Number(d.invoice_quantity) || 0;
                    if (invDate.isBefore(currentMonthStart)) {
                        qtyInvoicedLM += invQty;
                    } else if (invDate.isSameOrBefore(currentMonthEnd)) {
                        qtyInvoicedTM += invQty;
                    }
                }
            });

            // Deduplikasi PR & Kalkulasi Allocation
            let totalAllocated = 0;
            let qtyTransferTM = 0;
            let qtyTransferNM = 0;
            let qtyIndentTM = 0;
            let qtyIndentNM = 0;

            // Set untuk tracking PR unik per item
            const calculatedPRs = new Set();

            internalProcesses.forEach(p => {
                const pQtySourcing = Number(p.qty_sourcing) || 0;
                const pQtyAllocated = Number(p.qty_allocated) || 0;

                // Tambahkan ke Total Allocated (untuk Qty Ready)
                // Asumsi: qty_allocated tidak terduplikasi atau merepresentasikan alokasi fisik yang valid
                totalAllocated += pQtyAllocated;

                // Hitung sisa yang belum dialokasi/UU (Unallocated Forecast)
                const unallocatedQty = Math.max(0, pQtySourcing - pQtyAllocated);
                if (unallocatedQty <= 0) return;

                const etaDate = p.eta_customer_received ? moment(p.eta_customer_received) : null;
                if (!etaDate || !etaDate.isValid()) return;

                const isCurrentMonth = etaDate.isBetween(currentMonthStart, currentMonthEnd, null, '[]');
                const isNextMonth = etaDate.isBetween(nextMonthStart, nextMonthEnd, null, '[]');

                if (p.sourcing_type === 'PO STO') {
                    if (isCurrentMonth) qtyTransferTM += unallocatedQty;
                    if (isNextMonth) qtyTransferNM += unallocatedQty;
                } else if (p.sourcing_type === 'PR') {
                    if (isCurrentMonth) qtyIndentTM += unallocatedQty;
                    if (isNextMonth) qtyIndentNM += unallocatedQty;
                }
            });

            // Qty Ready berbasis Allocation Table
            // Definisi: "hasil sourcing -> qty pindah hilang apabila di billing"
            const qtyReady = Math.max(0, totalAllocated - qtyInvoicedLM - qtyInvoicedTM);

            // Qty OS = Quantity Order - (yang sudah di-supply: invoiced + ready)
            // Qty OS menggunakan item.qty_order
            const baseQuantity = Number(item.qty_order) || 0;
            const qtySupplied = qtyInvoicedLM + qtyInvoicedTM + qtyReady;
            const qtyOS = Math.max(0, baseQuantity - qtySupplied);

            // Hitung Amount per Item
            const amountPerItem = Number(item.sales_item_net_price) || 0;
            const amtInvoicedLM = amountPerItem * qtyInvoicedLM;
            const amtInvoicedTM = amountPerItem * qtyInvoicedTM;
            const amtReady = amountPerItem * qtyReady;
            const amtTransferTM = amountPerItem * qtyTransferTM;
            const amtTransferNM = amountPerItem * qtyTransferNM;
            const amtIndentTM = amountPerItem * qtyIndentTM;
            const amtIndentNM = amountPerItem * qtyIndentNM;
            const amtOS = amountPerItem * qtyOS;

            // Type PO Berdasarkan Created Date SO
            let typePO = "POCO"; // Default value
            if (item.so_date) {
                const soDate = moment(item.so_date);
                if (soDate.isValid()) {
                    // Cek apakah SO dibuat di bulan berjalan (This Month)
                    const isCurrentMonth = soDate.isBetween(currentMonthStart, currentMonthEnd, null, '[]');
                    if (isCurrentMonth) {
                        typePO = "PRTM"; // Partial/PR This Month
                    } else {
                        typePO = "POCO"; // Purchase Order Carry Over / Previous Month
                    }
                }
            }

            // Iterasi berdasarkan delivery. Jika tidak ada delivery, iterasi 1x dengan d = null
            // agar item yang belum delivery tetap muncul di report.
            const deliveriesToIterate = deliveries.length > 0 ? deliveries : [null];

            deliveriesToIterate.forEach(d => {
                // Aging SO berhenti jika Qty OS = 0
                let agingSO = "-";
                if (qtyOS > 0 && item.so_date) {
                    const soDate = moment(item.so_date);
                    if (soDate.isValid()) {
                        agingSO = moment().diff(soDate, 'days');
                    }
                }

                supplyStatusRows.push([
                    // Plant / Sales Office / Sales Office Name / Type PO / PSS Name
                    val(item.plant), 
                    val(item.sales_office), 
                    val(item.sales_office_name),  
                    val(typePO), 
                    val(item.pss_name),

                    // Customer PO No. / PO Date / PO Receive Date / Customer Code / Customer Name
                    val(po.po_number), 
                    fmt(item.customer_po_date),
                    fmt(po.po_receive_date), 
                    val(po.customer_code), 
                    val(po.customer_name),

                    // Customer Group / Sales Order No. / SO Type
                    val(po.customer_group_name),
                    val(item.so_number), 
                    val(item.so_type),

                    // Created Date / Request Delivery Date / Item Category / Item Number
                    fmt(item.so_date),
                    fmt(item.requested_delivery_date),
                    val(item.sales_item_category), 
                    val(item.so_item),

                    // Material No. / Material Type / Material Name / Restricted Notes / Quantity Order
                    val(item.part_number), 
                    val(item.product), 
                    val(item.part_description), 
                    val(d ? d.restricted_notes : null),
                    val(item.qty_order),

                    // Net Value / Currency / Amount Per Item
                    val(item.sales_item_net_value), 
                    val(item.sales_item_currency), 
                    val(amountPerItem),

                    // Qty Invoiced LM / Qty Invoiced TM / Qty Ready / Qty Transfer TM / Qty Transfer NM / Qty Indent TM / Qty Indent NM / Qty OS
                    val(qtyInvoicedLM), 
                    val(qtyInvoicedTM), 
                    val(qtyReady), 
                    val(qtyTransferTM), 
                    val(qtyTransferNM), 
                    val(qtyIndentTM), 
                    val(qtyIndentNM), 
                    val(qtyOS),

                    // Amt Invoiced LM / Amt Invoiced TM / Amt Ready / Amt Transfer TM / Amt Transfer NM / Amt Indent TM / Amt Indent NM / Amt OS
                    val(amtInvoicedLM), 
                    val(amtInvoicedTM), 
                    val(amtReady), 
                    val(amtTransferTM),
                    val(amtTransferNM), 
                    val(amtIndentTM), 
                    val(amtIndentNM), 
                    val(amtOS),

                    // ETA Customer Received
                    fmt(d ? d.eta_customer_received : null),

                    // Delivery No. / Delivery Type / Delivery Item No. / Delivery Date
                    val(d ? (d.delivery_no || d.do) : null),
                    val(d ? d.delivery_type : null),
                    val(d ? d.delivery_item : null),
                    fmt(d ? d.delivery_date : null),

                    // Create TO Date / Confirm TO Out Date / SPB Number / SPB Created Date / GI Number / GI Date
                    fmt(d ? d.create_to_date : null),
                    fmt(d ? d.confirm_to_out_date : null),
                    val(d ? d.spb_number : null),
                    fmt(d ? d.spb_created_date : null),
                    val(d ? d.gi_number : null),
                    fmt(d ? d.gi_date : null),

                    // Expedition Pickup Date / Invoice Number / Invoice Qty / Invoice Date
                    fmt(d ? d.expedition_pickup_date : null),
                    val(d ? d.invoice_no : null),
                    val(d ? d.invoice_quantity : null),
                    fmt(d ? d.invoice_date : null),

                    // Customer Receive Date / Customer Receive Name / Aging SO / Partial Delivery
                    fmt(d ? d.customer_receive_date : null),
                    val(d ? d.customer_receive_name : null),
                    val(agingSO),
                    val(d ? d.partial_delivery : null),
                ]);
            });
        });
    });

    const wsSupplyStatus = XLSX.utils.aoa_to_sheet([supplyStatusHeader, ...supplyStatusRows]);
    wsSupplyStatus['!cols'] = supplyStatusHeader.map(() => ({ wch: 22 }));
    applyHeaderStyle(wsSupplyStatus, supplyStatusHeader.length);

    // --------------------------------------------------------------------
    // Build Workbook & Return
    // --------------------------------------------------------------------
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsCustomerReport, "Customer Report");
    XLSX.utils.book_append_sheet(wb, wsProgressSourcing, "Progress Sourcing");
    XLSX.utils.book_append_sheet(wb, wsSupplyStatus, "Supply Status");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const base64Data = buffer.toString("base64");
    const fileName = `Purchase_Order_${moment().format("YYYYMMDD_HHmmss")}.xlsx`;

    result.statusCode = 200;
    result.data = {
        success: true,
        message: "Success to export data",
        data: {
            fileName: fileName,
            fileBase64: base64Data,
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        }
    };

    complete();
    return;

} catch (err) {
    result.statusCode = 500;
    result.data = {
        success: false,
        message: "Failed to export data",
        error: err.message
    };
    complete();
    return;
}