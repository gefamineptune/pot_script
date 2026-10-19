function FormatDate_PO(date) {
    if (date === null || !date) {
        return "-";
    }

    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Jakarta",
        day: "numeric",
        month: "long",
        year: "numeric"
    }).formatToParts(new Date(date));

    let day;
    let month;
    let year;

    parts.forEach(function (part) {
        if (part.type === "day") day = part.value;
        if (part.type === "month") month = part.value;
        if (part.type === "year") year = part.value;
    });

    return `${day} ${month} ${year}`;
}

const poId = req.query?.po_id ?? "";

if (poId === "") {
    result = {
        success: false,
        message: "PO ID required",
    };
    complete();
    console.log(result);
    return;
}

try {
    const getPurchaseOrder = await entities.pot_po
        .createQueryBuilder("po")
        .where("po.id = :id", { id: poId })
        .leftJoin("pot_customer", "c", "po.customer_id = c.id")
        // .leftJoin("pot_master_gudang", "b", "po.branch_id = b.gudang_code")
        .select([
            "po.id AS id",
            "c.customer_name AS customer_name",
            "po.po_number AS po_number",
            "po.po_receive_date AS po_receive_date",
            "po.progress_supply AS progress_supply",
            "po.eta_full_supply AS eta_full_supply",
            "po.eta_type AS eta_type",
            "po.updatedAt AS updatedAt",
            "po.branch_id AS branch_id",
            // "b.description AS branch_desc",
        ])
        .getRawOne();

    
    let resultData = getPurchaseOrder;
    if(resultData.eta_type === "NULL") {
        resultData.eta_full_supply_formatted = "-"
    } else if(resultData.eta_type === "TBA") {
        resultData.eta_full_supply_formatted = "TBA"
    } else {
        resultData.eta_full_supply_formatted = FormatDate_PO(getPurchaseOrder.eta_full_supply);
    }
    resultData.po_receive_date_formatted = FormatDate_PO(getPurchaseOrder.po_receive_date);
    // resultData.branch_desc = getPurchaseOrder.branch_desc === "" ? "-" : getPurchaseOrder.branch_desc;

    const getPurchaseOrderItem = await entities.pot_po_item
        .createQueryBuilder("poi")
        .where("poi.po_id = :id", { id: poId })
        .orderBy("poi.so_number", "ASC")
        .addOrderBy("poi.so_item", "ASC")
        .getMany();

    resultData.po_items = getPurchaseOrderItem;

    result = {
        success: true,
        message: getPurchaseOrder,
    };
} catch (err) {
    result = {
        success: false,
        message: err,
    };
} finally {
    complete();
    console.log(result);
}
