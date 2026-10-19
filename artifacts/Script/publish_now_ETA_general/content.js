try {
    const getETALeadTimeNotActive = await entities.pot_eta_lead_time_not_active
        .createQueryBuilder("na")
        .where("na.eta_lead_type = :type", { type: "general" })
        .getOne();

    if (!getETALeadTimeNotActive) {
        result = {
            success: false,
            message: "Upload excel file first",
        };
        complete()
        return;
    }
    
    const getCreateData = [];

    JSON.parse(getETALeadTimeNotActive.data_obj).forEach(item => {
        getCreateData.push({
            lead_time: item["Lead Time"],
            total_days: item["Total Days"],
            createdBy: item.createBy,
            updatedBy: item.createBy,
            createdAt: item.createAt
        })
    })

    await entities.pot_eta_lead_time_general.createQueryBuilder().delete().execute();

    await entities.pot_eta_lead_time_general
        .createQueryBuilder()
        .insert()
        .values(getCreateData)
        .execute();

    await entities.pot_eta_lead_time_not_active
        .createQueryBuilder()
        .delete()
        .where("eta_lead_type = :type", { type: "general" })
        .execute();

    result = {
        success: true,
        message: "Data successfully activate to system",
    };
} catch (err) {
    result = {
        success: false,
        message: err,
    };
} finally {
    console.log(result);
    complete();
}
