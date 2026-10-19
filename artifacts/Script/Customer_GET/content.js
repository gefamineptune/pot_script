try {

    const moment = modules.moment;
    const { In } = operators;

    // ============================
    // Request Body
    // ============================
    let { page, limit, search, filter, sortBy, sortOrder } = req.query;

    // ============================
    // Default Value
    // ============================
    page = parseInt(page || 1);
    limit = parseInt(limit || 10);
    search = search || "";
    filter = filter || "";
    sortBy = sortBy || "last_sync";
    sortOrder = (sortOrder || "DESC").toUpperCase();

    const skip = (page - 1) * limit;

    // ============================
    // Query Builder
    // ============================
    const qb = entities.pot_customer.createQueryBuilder("c")
        .leftJoinAndSelect(
            "pot_customer_group",
            "cg",
            "cg.id = c.customer_group_id"
        )
        .select([
            "c.id",
            "c.customer_code",
            "c.customer_name",
            "c.customer_sector",
            "c.customer_group_id",
            "cg.id",
            "cg.customer_group_name",
            "c.createdAt",
            "c.createdBy",
            "c.updatedAt",
            "c.updatedBy",
            "c.last_sync"
        ])

    // ============================
    // Search
    // ============================
    if (search.trim()) {
        qb.where(
            `
            (
                LOWER(c.customer_code) LIKE LOWER(:keyword)
                OR LOWER(c.customer_name) LIKE LOWER(:keyword)
                OR LOWER(c.customer_sector) LIKE LOWER(:keyword)
                OR LOWER(cg.customer_group_name) LIKE LOWER(:keyword)
            )
            `,
            {
                keyword: `%${search.trim()}%`
            }
        );
    }

    // ============================
    // Filter
    // ============================
    if (filter) {        
        qb.andWhere(
            "cg.id = :cgId", { cgId: filter }
        );
    }

    // ============================
    // Sorting
    // ============================
    if (sortBy === "customer_group_name") {
        qb.orderBy(`cg.${sortBy}`, sortOrder);
    } else if (sortBy === "lastSyncFormatted") {
        qb.orderBy(`c.last_sync`, sortOrder);
    } else {
        qb.orderBy(`c.${sortBy}`, sortOrder);
    }

    qb.addOrderBy("c.id", "ASC");

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
    // Build Customer Map
    // ============================
    const customerMap = {};

    recordData.forEach((data, index) => {
        data.updatedAtFormatted = data.updatedAt 
            ? moment(Number(data.updatedAt)).format("D MMMM YYYY HH:mm:ss")
            : "";
        data.lastSyncFormatted = data.last_sync 
            ? moment(Number(data.last_sync)).format("D MMMM YYYY HH:mm:ss")
            : "";
        data.customer_group_name = raw[index].cg_customer_group_name;
        data.listCustomerSales = [];
        customerMap[data.id] = data;
    });

    // ============================
    // Get Customer Sales
    // ============================
    if (recordData.length > 0) {

        const customerSales = await entities.pot_customer_sales_mapping.find({
            select: {
                id: true,
                customer_id: true,
                customer_sales_id: true,
            },
            where: {
                customer_id: In(recordData.map(item => item.id))
            }
        });

        // ============================
        // Attach Customer Sales
        // ============================
        customerSales.forEach(item => {

            const customer = customerMap[item.customer_id];

            if (customer) {
                customer.listCustomerSales.push(item);
            }

        });

    }

    // ============================
    // Total Record
    // ============================
    const countQB = entities.pot_customer.createQueryBuilder("c")
        .leftJoinAndSelect(
            "pot_customer_group",
            "cg",
            "cg.id = c.customer_group_id"
        )
        .select([
            "c.id",
            "c.customer_code",
            "c.customer_name",
            "c.customer_sector",
            "cg.customer_group_name"
        ])

    if (search.trim()) {
        countQB.where(
            `
            (
                LOWER(c.customer_code) LIKE LOWER(:keyword)
                OR LOWER(c.customer_name) LIKE LOWER(:keyword)
                OR LOWER(c.customer_sector) LIKE LOWER(:keyword)
                OR LOWER(cg.customer_group_name) LIKE LOWER(:keyword)
            )
            `,
            {
                keyword: `%${search.trim()}%`
            }
        );
    }
    if (filter) {        
        countQB.andWhere(
            "cg.id = :id", { id: filter }
        );
    }

    const totalRecord = await countQB.getRawMany();
    const totalPage = Math.ceil(totalRecord.length / limit);

    // const totalRecord = await countQB.getCount();
    // const totalPage = Math.ceil(totalRecord / limit);

    // ============================
    // Response
    // ============================
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

    // log.error(err);

    result.data = {
        success: false,
        message: "Failed to retrieve data",
        error: err.message
    };

    complete();
    return;

}