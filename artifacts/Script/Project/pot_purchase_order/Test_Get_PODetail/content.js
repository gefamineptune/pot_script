const moment = modules.moment;
const { In } = operators;

const poId = req.query?.po_id ?? "64FD3918-34B6-F111-B88F-0050568C835B";

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
    function JoinWithPOItem(queryBuilder) {
        queryBuilder.where("po.id = :id", { id: poId })
        
        const subQuery = queryBuilder.subQuery()
            .select("1")
            .from("pot_po_item", "poi")
            .where("poi.po_id = po.id")

        queryBuilder.where(`EXISTS (${subQuery.getQuery()})`, { ...subQuery.getParameters() });

        return queryBuilder;
    }

    const qb = entities.pot_po.createQueryBuilder("po")
        .leftJoinAndSelect("pot_customer", "c", "c.id = po.customer_id")
        .leftJoinAndSelect("pot_customer_group", "cg", "cg.id = po.customer_group_id")
        .leftJoinAndSelect("pot_group_type", "gt", "gt.id = po.group_type_id")
        .leftJoinAndSelect("pot_master_order_status", "os", "os.id = po.order_status_id")
        .select([
            "po.id",
            "po.po_number",
            "po.po_receive_date",
            "po.progress_supply",
            "po.customer_id",
            "c.customer_name",
            "po.customer_group_id",
            "cg.customer_group_name",
            "po.group_type_id",
            "gt.group_type_name",
            "po.branch_id",
            "po.total_item",
            "po.qty_order",
            "po.qty_supply",
            "po.eta_type",
            "po.eta_full_supply",
            "po.order_status_id",
            "os.status_code",
            "os.status_name",
            "po.updatedAt",
            "po.updatedBy"
        ])

    JoinWithPOItem(qb);

    const { entities: recordData, raw } = await qb.getRawAndEntities();

    console.log(recordData);
    console.log("===================================================");

    // ------------------------------------------------------------------------
    // Mapping Data Purchase Order
    // ------------------------------------------------------------------------
    recordData.forEach((data, index) => {

        // ----------------------------------------
        // Mapping
        // ----------------------------------------
        data.customer_name = raw[index].c_customer_name || "-";
        data.customer_group_name = raw[index].cg_customer_group_name;
        data.group_type_name = raw[index].gt_group_type_name;
        data.order_status = raw[index].os_status_name;

        // PO Receive Date
        data.po_receive_date_formatted = data.po_receive_date
            ? moment(data.po_receive_date).format("DD MMMM YYYY")
            : "-";

        // SET PO ETA
        if (data.eta_type === "NULL") {
            data.eta_full_supply_formatted = "-";
        } else if (data.eta_type === "TBA") {
            data.eta_full_supply_formatted = "TBA";
        } else {
            data.eta_full_supply_formatted = data.eta_full_supply
                ? moment(data.eta_full_supply).format("DD MMMM YYYY")
                : "-";
        }
    });

    console.log(recordData);
    console.log("===================================================");

    // const getPurchaseOrderItem = await entities.pot_po_item
    //     .createQueryBuilder("poi")
    //     .where("poi.po_id = :id", { id: poId })
    //     .getMany();

    // resultData.po_items = getPurchaseOrderItem;

    result = {
        success: true,
        message: recordData,
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
