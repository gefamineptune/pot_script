try {

    const { Not } = operators;

    // ============================
    // Request Body
    // ============================
    let { id, groupTypeName, selectedCustomerGroup, by } = req.body;

    by = by || req.user.username || "system";

    // ============================
    // Validation
    // ============================
    if (!groupTypeName || !groupTypeName.trim()) {
        result.statusCode = 400;
        result.data = {
            success: false,
            message: "Group Type is required",
        };

        complete();
        return;
    }

    // ============================
    // Check Unique Group Type
    // ============================
    const where = {
        group_type_name: groupTypeName.trim()
    };

    if (id) {
        where.id = Not(id);
    }

    const existingGroupType = await entities.pot_group_type.findOne({
        where: where
    });

    if (existingGroupType) {
        result.statusCode = 200;
        result.data = {
            success: false,
            message: "Group Type has been used. Please input another name",
        };

        complete();
        return;
    }

    // ============================
    // Create Group Type
    // ============================
    let groupTypeId = id;

    if (!groupTypeId) {
        const insertResult = await entities.pot_group_type
            .createQueryBuilder()
            .insert()
            .values({
                group_type_name: groupTypeName,
                createdBy: by,
                createdAt: Date.now(),
                updatedBy: by,
                updatedAt: Date.now()
            })
            .execute();

        groupTypeId = insertResult.identifiers[0].id;
    }

    // ============================
    // Update Group Type
    // ============================
    else {
        await entities.pot_group_type
            .createQueryBuilder()
            .update()
            .set({
                group_type_name: groupTypeName,
                updatedBy: by,
                updatedAt: Date.now()
            })
            .where("id = :id", { id: groupTypeId })
            .execute();

        // ============================
        // Remove Old Mapping
        // ============================
        await entities.pot_customer_group
            .createQueryBuilder()
            .update()
            .set({
                group_type_id: null,
                updatedBy: by,
                updatedAt: Date.now()
            })
            .where("group_type_id = :id", { id: groupTypeId })
            .execute();
    }

    // ============================
    // Save Selected Customer Group
    // ============================
    const customerGroupIds = selectedCustomerGroup.map(item => item.id);
    
    if (
        Array.isArray(selectedCustomerGroup) &&
        selectedCustomerGroup.length > 0
    ) {
        await entities.pot_customer_group
            .createQueryBuilder()
            .update()
            .set({
                group_type_id: groupTypeId,
                updatedBy: by,
                updatedAt: Date.now()
            })
            .where("id IN (:...ids)", {
                ids: customerGroupIds
            })
            .execute();
    }

    // ============================
    // Response
    // ============================
    result.statusCode = 200;
    result.data = {
        success: true,
        message: id ? "Update Group Type Success" : "Create Group Type Success"
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