try {

    // ============================
    // Request Body
    // ============================
    let { id, customerGroupId, selectedCustomerSales, by } = req.body;

    by = by || req.user.username || "system";

    let customerId = id;

    if (!customerId) {
        throw new Error("Customer ID is required.");
    }

    // ============================
    // Update Customer
    // ============================
    await entities.pot_customer
        .createQueryBuilder()
        .update()
        .set({
            customer_group_id: customerGroupId,
            updatedBy: by,
            updatedAt: Date.now()
        })
        .where("id = :id", { id: customerId })
        .execute();

    // ============================
    // Delete Customer Sales
    // ============================
    await entities.pot_customer_sales_mapping
        .createQueryBuilder()
        .delete()
        .where("customer_id = :id", { id: customerId })
        .execute();

    // ============================
    // Save Selected Customer Sales
    // ============================
    if (
        Array.isArray(selectedCustomerSales) &&
        selectedCustomerSales.length > 0
    ) {
        const values = selectedCustomerSales.map(item => ({
            customer_id: customerId,
            customer_sales_id: item.me_id,
            createdBy: by,
            createdAt: Date.now(),
            updatedBy: by,
            updatedAt: Date.now()
        }));

        await entities.pot_customer_sales_mapping
            .createQueryBuilder()
            .insert()
            .values(values)
            .execute();
    }

    // ============================
    // Response
    // ============================
    result.data = {
        success: true,
        message: "Update Customer Success"
    };

} catch (err) {

    // log.error(err);

    result.data = {
        success: false,
        message: err.message
    };

}