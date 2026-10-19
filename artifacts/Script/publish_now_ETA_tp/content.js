try {
    const getETALeadTimeNotActive = await entities.pot_eta_lead_time_not_active
        .createQueryBuilder("na")
        .where("na.eta_lead_type = :type", { type: "tp" })
        .getOne();

    if (!getETALeadTimeNotActive) {
        result = {
            success: false,
            message: "Upload excel file first",
        };
        complete()
        return;
    }
    const dataObjNew = [];

    JSON.parse(getETALeadTimeNotActive.data_obj).forEach((obj, index) => {
        dataObjNew.push({
            Plant: obj.Plant,
            CreateTP_CheckStock: obj["Create TP - Check Stock"],
            order: index + 1,
            createdBy: obj.createdBy,
            updatedBy: obj.updatedBy,
            createdAt: obj.createdAt,
            updatedAt: getETALeadTimeNotActive.active_date,
        });
    });

    await entities.pot_eta_lead_time_tp.createQueryBuilder().delete().execute();

    await entities.pot_eta_lead_time_tp
        .createQueryBuilder()
        .insert()
        .values(dataObjNew)
        .execute();

    await entities.pot_eta_lead_time_not_active
        .createQueryBuilder()
        .delete()
        .where("eta_lead_type = :type", { type: "tp" })
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
