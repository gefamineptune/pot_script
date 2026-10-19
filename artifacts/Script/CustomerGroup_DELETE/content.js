try {

    // ============================
    // Request Body
    // ============================
    let { id } = req.body;

    // ============================
    // Validation
    // ============================
    if (!id) {
        result.statusCode = 400;
        result.data = {
            success: false,
            message: "Customer Group ID is required",
        };

        complete();
        return;
    }

    // ============================
    // Check Customer Group
    // ============================
    const record = await entities.pot_customer_group.findOne({
        where: {
            id: id
        }
    });

    if (!record) {
        result.statusCode = 400;
        result.data = {
            success: false,
            message: "Customer Group not found",
        };

        complete();
        return;
    }

    // ============================
    // Check data from other table
    // ============================
    const totalCustomer = await entities.pot_customer.count({
        where: {
            customer_group_id: id
        }
    });

    if (totalCustomer > 0) {
        result.statusCode = 400;
        result.data = {
            success: false,
            message: "Data tidak dapat dihapus karena masih terdapat data yang terkait dengan data ini",
        };

        complete();
        return;
    }

    // ============================
    // Delete Customer Group
    // ============================
    await entities.pot_customer_group
        .createQueryBuilder()
        .delete()
        .where("id = :id", { id })
        .execute();

    // ============================
    // Response
    // ============================
    result.statusCode = 200;
    result.data = {
        success: true,
        message: "Delete Customer Group Success"
    };

    complete();
    return;

} catch (err) {

    result.statusCode = 500;
    result.data = {
        success: false,
        message: err.message,
        error: err.message
    };

    complete();
    return;

}