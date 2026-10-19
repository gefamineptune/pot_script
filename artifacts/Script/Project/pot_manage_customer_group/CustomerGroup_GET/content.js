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
    const qb = entities.pot_customer_group.createQueryBuilder("cg")
        .leftJoinAndSelect(
            "pot_customer",
            "c",
            "c.customer_group_id = cg.id"
        )
        .select([
            "cg.id",
            "cg.customer_group_name",
            "cg.customer_group_description",
            "cg.createdAt",
            "cg.updatedAt",
            "cg.createdBy",
            "cg.updatedBy"
        ])
        .addSelect("COUNT(c.id)", "countCustomer")
        .groupBy("cg.id")
        .addGroupBy("cg.customer_group_name")
        .addGroupBy("cg.customer_group_description")
        .addGroupBy("cg.createdAt")
        .addGroupBy("cg.updatedAt")
        .addGroupBy("cg.createdBy")
        .addGroupBy("cg.updatedBy")

    // ============================
    // Search
    // ============================
    if (search.trim()) {        
        if (!isNaN(search.trim())) {
            qb.having(
                "COUNT(c.id) = :count", { count: Number(search.trim()) }
            );
        } else {
            qb.where(
                "LOWER(cg.customer_group_name) LIKE LOWER(:keyword)", { keyword: `%${search.trim()}%` }
            );
        }
    }

    // ============================
    // Sorting
    // ============================
    if (sortBy === "countCustomer") {
        qb.orderBy("countCustomer", sortOrder);
    } else {
        qb.orderBy(`cg.${sortBy}`, sortOrder);
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

    recordData.forEach((data, index) => {
        data.countCustomer = Number(raw[index].countCustomer);
        data.updatedAtFormatted = data.updatedAt 
            ? moment(Number(data.updatedAt)).format("D MMMM YYYY HH:mm:ss")
            : "";
    });

    // ============================
    // Total Record
    // ============================
    const countQB = entities.pot_customer_group.createQueryBuilder("cg")
        .leftJoinAndSelect(
            "pot_customer",
            "c",
            "c.customer_group_id = cg.id"
        )
        .select([
            "cg.id",
            "cg.customer_group_name",
            "cg.customer_group_description",
        ])
        .addSelect("COUNT(c.id)", "countCustomer")
        .groupBy("cg.id")
        .addGroupBy("cg.customer_group_name")
        .addGroupBy("cg.customer_group_description")

    if (search.trim()) {        
        if (!isNaN(search.trim())) {
            countQB.having(
                "COUNT(c.id) = :count", { count: Number(search.trim()) }
            );
        } else {
            countQB.where(
                "LOWER(cg.customer_group_name) LIKE LOWER(:keyword)", { keyword: `%${search.trim()}%` }
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