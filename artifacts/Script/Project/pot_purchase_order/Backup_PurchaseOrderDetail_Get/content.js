function FormatDate_PO(date) {
    if (date === null || !date) {
        return "-";
    }
    const d = new Date(date);

    const months = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];

    return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const poId = req.query?.po_id ?? "4ACD41F6-80AF-F111-B88F-0050568C835B";

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
        .select([
            "po.id AS id",
            "c.customer_name AS customer_name",
            "po.po_number AS po_number",
            "po.po_receive_date AS po_receive_date",
            "po.progress_supply AS progress_supply",
            "po.eta_full_supply AS eta_full_supply",
            "po.updatedAt AS updatedAt",
        ])
        .getRawOne();

    console.log(getPurchaseOrder);
    let resultData = getPurchaseOrder;
    resultData.eta_full_supply_formatted = FormatDate_PO(getPurchaseOrder.eta_full_supply);
    resultData.po_receive_date_formatted = FormatDate_PO(getPurchaseOrder.po_receive_date);

    const getPurchaseOrderItem = await entities.pot_po_item
        .createQueryBuilder("poi")
        .where("poi.po_id = :id", { id: poId })
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
