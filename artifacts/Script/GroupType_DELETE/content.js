try {

    // ============================
    // Request Body
    // ============================
    const { id } = req.body;

    // ============================
    // Validation
    // ============================
    if (!id) {
        result.statusCode = 400;
        result.data = {
            success: false,
            message: "Group Type ID is required",
        };

        complete();
        return;
    }

    // ============================
    // Check Group Type
    // ============================
    const record = await entities.pot_group_type.findOne({
        where: {
            id: id
        }
    });

    if (!record) {
        result.statusCode = 400;
        result.data = {
            success: false,
            message: "Group Type not found",
        };

        complete();
        return;
    }

    // ============================
    // Check data from other table
    // ============================
    const totalCustomerGroup = await entities.pot_customer_group.count({
        where: {
            group_type_id: id
        }
    });

    if (totalCustomerGroup > 0) {
        result.statusCode = 400;
        result.data = {
            success: false,
            message: "Data tidak dapat dihapus karena masih terdapat data yang terkait dengan data ini",
        };

        complete();
        return;
    }

    // ============================
    // Remove Mapping Customer Group
    // ============================
    await entities.pot_customer_group
        .createQueryBuilder()
        .update()
        .set({
            group_type_id: null,
            updatedAt: Date.now()
        })
        .where("group_type_id = :id", { id })
        .execute();

    // ============================
    // Delete Group Type
    // ============================
    await entities.pot_group_type
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
        message: "Delete Group Type Success"
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