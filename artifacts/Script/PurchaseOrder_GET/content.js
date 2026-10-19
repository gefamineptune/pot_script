const moment = modules.moment;
// moment.locale('en');
const { In } = operators;

try {

    // ------------------------------
    // Request Param
    // ------------------------------
    let param = req.query;

    // ---------------------------------
    // Default Value
    // ---------------------------------
    const page = parseInt(param.page || 1);
    const limit = parseInt(param.limit || 10);
    const search = param.search || "";
    const sortBy = param.sortBy || "updatedAt";
    const sortOrder = (param.sortOrder || "DESC").toUpperCase();

    const skip = (page - 1) * limit;
    
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

    // ---------------------------------
    // Apply Search & Filter
    // ---------------------------------
    applyFilters(qb);

    // ---------------------------------
    // Sorting
    // ---------------------------------
    if (sortBy === "customer_name") {
        qb.orderBy(`c.${sortBy}`, sortOrder);
    } else if (sortBy === "order_status") {
        qb.orderBy(`os.status_name`, sortOrder);
    } else {
        qb.orderBy(`po.${sortBy}`, sortOrder);
    }

    qb.addOrderBy("po.id", "ASC");

    // ---------------------------------
    // Pagination
    // ---------------------------------
    qb.skip(skip);
    qb.take(limit);

    // ---------------------------------
    // Execute Query
    // ---------------------------------
    const { entities: recordData, raw } = await qb.getRawAndEntities();

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
        data.branch_id = raw[index].po_branch_id || "-";

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

    // ---------------------------------
    // Total Record
    // ---------------------------------
    const countQB = entities.pot_po.createQueryBuilder("po")
        .leftJoin("pot_customer", "c", "c.id = po.customer_id")
        .leftJoin("pot_customer_group", "cg", "cg.id = po.customer_group_id")
        .leftJoin("pot_group_type", "gt", "gt.id = po.group_type_id")
        .leftJoin("pot_master_order_status", "os", "os.id = po.order_status_id");

    // ---------------------------------
    // Apply Search & Filter
    // ---------------------------------
    applyFilters(countQB);

    const totalRecord = await countQB.getCount();
    const totalPage = Math.ceil(totalRecord / limit);

    // ---------------------------------
    // Response
    // ---------------------------------
    result.statusCode = 200;
    result.data = {
        success: true,
        message: "Success to retrieve data",
        data: {
            list: recordData,
            pagination: {
                page: page,
                limit: limit,
                totalRecord: totalRecord,
                totalPage: totalPage,
                hasNext: page < totalPage,
                hasPrevious: page > 1
            },
            sorting: {
                sortBy,
                sortOrder
            }
        }
    };

    complete();
    return;

} catch (err) {
    result.statusCode = 500;
    result.data = {
        success: false,
        message: "Failed to retrieve data",
        error: err.message
    };

    complete();
    return;
}