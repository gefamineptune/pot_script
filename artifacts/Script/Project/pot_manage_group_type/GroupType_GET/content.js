try {

    const moment = modules.moment;
    const { In } = operators;

    // ============================
    // Request Body
    // ============================
    let { page, limit, search, sortBy, sortOrder } = req.query;

    // ============================
    // Default Value
    // ============================
    page = parseInt(page || 1);
    limit = parseInt(limit || 10);
    search = search || "";
    sortBy = sortBy || "updatedAt";
    sortOrder = (sortOrder || "DESC").toUpperCase();

    const skip = (page - 1) * limit;

    // ============================
    // Query Builder
    // ============================
    const qb = entities.pot_group_type.createQueryBuilder("gt")
        .leftJoinAndSelect(
            "pot_customer_group",
            "cg",
            "cg.group_type_id = gt.id"
        )
        .select([
            "gt.id",
            "gt.group_type_name",
            "gt.createdAt",
            "gt.updatedAt",
            "gt.createdBy",
            "gt.updatedBy"
        ])
        .addSelect("COUNT(cg.id)", "countCustomerGroup")
        .groupBy("gt.id")
        .addGroupBy("gt.id")
        .addGroupBy("gt.group_type_name")
        .addGroupBy("gt.createdAt")
        .addGroupBy("gt.updatedAt")
        .addGroupBy("gt.createdBy")
        .addGroupBy("gt.updatedBy")

    // ============================
    // Search
    // ============================
    if (search.trim()) {        
        if (!isNaN(search.trim())) {
            qb.having(
                "COUNT(cg.id) = :count", { count: Number(search.trim()) }
            );
        } else {
            qb.where(
                "LOWER(gt.group_type_name) LIKE LOWER(:keyword)", { keyword: `%${search.trim()}%` }
            );
        }
    }

    // ============================
    // Sorting
    // ============================
    if (sortBy === "countCustomerGroup") {
        qb.orderBy("countCustomerGroup", sortOrder);
    } else {
        qb.orderBy(`gt.${sortBy}`, sortOrder);
    }

    // ============================
    // Pagination
    // ============================
    qb.skip(skip);
    qb.take(limit);

    // ============================
    // Execute Query
    // ============================
    const { entities: recordData, raw } = await qb.getRawAndEntities();

    // ============================
    // Build Group Map
    // ============================
    const groupTypeMap = {};

    recordData.forEach((data, index) => {
        data.updatedAtFormatted = data.updatedAt 
            ? moment(Number(data.updatedAt)).format("D MMMM YYYY HH:mm:ss")
            : "";
        data.countCustomerGroup = Number(raw[index].countCustomerGroup);
        data.listCustomerGroup = [];
        groupTypeMap[data.id] = data;
    });

    // ============================
    // Get Customer Group
    // ============================
    if (recordData.length > 0) {

        const customerGroups = await entities.pot_customer_group.find({
            where: {
                group_type_id: In(recordData.map(item => item.id))
            },
            order: {
                customer_group_name: "ASC"
            }
        });

        // ============================
        // Attach Customer Group
        // ============================
        customerGroups.forEach(customerGroup => {

            const group = groupTypeMap[customerGroup.group_type_id];

            if (group) {
                group.listCustomerGroup.push(customerGroup);
            }

        });

    }

    // ============================
    // Total Record
    // ============================
    const countQB = entities.pot_group_type.createQueryBuilder("gt")
        .leftJoinAndSelect(
            "pot_customer_group",
            "cg",
            "cg.group_type_id = gt.id"
        )
        .select([
            "gt.id",
            "gt.group_type_name"
        ])
        .addSelect("COUNT(cg.id)", "countCustomerGroup")
        .groupBy("gt.id")
        .addGroupBy("gt.group_type_name")

    if (search.trim()) {        
        if (!isNaN(search.trim())) {
            countQB.having(
                "COUNT(cg.id) = :count", { count: Number(search.trim()) }
            );
        } else {
            countQB.where(
                "LOWER(gt.group_type_name) LIKE LOWER(:keyword)", { keyword: `%${search.trim()}%` }
            );
        }
    }

    const totalRecord = await countQB.getRawMany();
    const totalPage = Math.ceil(totalRecord.length / limit);

    // const totalRecord = await countQB.getCount();
    // const totalPage = Math.ceil(totalRecord / limit);

    // ============================
    // Response
    // ============================
    result.statusCode = 200;
    result.data = {
        success: true,
        message: "Success to retrieve data",
        data: {
            list: recordData,
            pagination: {
                page: page,
                limit: limit,
                totalRecord: totalRecord.length,
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