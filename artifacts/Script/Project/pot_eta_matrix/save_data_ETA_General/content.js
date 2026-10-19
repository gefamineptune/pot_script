try {
    const body = req.body;
    const dataItems = Array.isArray(body) ? body : (body?.data ?? []);

    const createdBy = dataItems[0]?.createBy ?? req.user.username;
    const createdAt = dataItems[0]?.createAt ?? new Date().getTime();

    // Hapus seluruh data lama di table
    await entities.pot_eta_lead_time_general
        .createQueryBuilder()
        .delete()
        .execute();

    const now = new Date();

    // Siapkan data baru untuk di-insert
    const insertValues = dataItems
        .filter((item) => item["Lead Time"]) // skip kalau tidak ada key "Lead Time"
        .map((item) => ({
            lead_time: item["Lead Time"],
            total_days: item["Total Days"],
            createdBy: item?.createBy ?? createdBy,
            updatedBy: item?.createBy ?? createdBy,
        }));

    // Insert semua data baru sekaligus
    if (insertValues.length > 0) {
        await entities.pot_eta_lead_time_general
            .createQueryBuilder()
            .insert()
            .values(insertValues)
            .execute();
    }

    console.log(JSON.stringify(insertValues));

    result.data = {
        success: true,
        message: "Successfully insert new data.",
        detail: insertValues,
        error: "",
    };

}
catch (error) {
    console.error("Error retrieving data:", error.message);
    result.data = {
        success: false,
        message: "Failed to retrieve data",
        error: error.message
    };
}
complete();