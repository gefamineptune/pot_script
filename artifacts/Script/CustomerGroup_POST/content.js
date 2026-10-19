try {
    const { Not } = operators;

    // ============================
    // Request Body
    // ============================
    let { id, customer_group_name, customer_group_description, by } = req.body;

    by = by || req.user.username || "system";

    // ============================
    // Validation
    // ============================
    if (!customer_group_name || !customer_group_name.trim()) {
        result.statusCode = 400;
        result.data = {
            success: false,
            message: "Customer Group Name is required",
        };

        complete();
        return;
    }

    // ============================
    // Check Unique Customer Group
    // ============================
    const where = {
        customer_group_name: customer_group_name.trim(),
    };

    // Jika update, exclude data dengan id sendiri
    if (id) {
        where.id = Not(id);
    }

    const existingCustomerGroup = await entities.pot_customer_group.findOne({
        where: where,
    });

    if (existingCustomerGroup) {
        result.statusCode = 200;
        result.data = {
            success: false,
            message: "Customer Group has been used. Please input another name",
        };

        complete();
        return;
    }

    // ============================
    // Create Customer Group
    // ============================
    if (!id) {
        await entities.pot_customer_group
            .createQueryBuilder()
            .insert()
            .values({
                customer_group_name: customer_group_name.trim(),
                customer_group_description: customer_group_description.trim(),
                createdBy: by,
                createdAt: Date.now(),
                updatedBy: by,
                updatedAt: Date.now(),
            })
            .execute();
    }

    // ============================
    // Update Customer Group
    // ============================
    else {
        await entities.pot_customer_group
            .createQueryBuilder()
            .update()
            .set({
                customer_group_name: customer_group_name.trim(),
                customer_group_description: customer_group_description.trim(),
                updatedBy: by,
                updatedAt: Date.now(),
            })
            .where("id = :id", { id })
            .execute();
    }

    // ============================
    // Response
    // ============================
    result.statusCode = 200;
    result.data = {
        success: true,
        message: id ? "Update Customer Group Success" : "Create Customer Group Success",
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
