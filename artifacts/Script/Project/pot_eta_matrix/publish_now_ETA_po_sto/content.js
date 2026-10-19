try {
    const getETALeadTimeNotActive = await entities.pot_eta_lead_time_not_active
        .createQueryBuilder("na")
        .where("na.eta_lead_type = :type", { type: "posto" })
        .getOne();

    if (!getETALeadTimeNotActive) {
        result = {
            success: false,
            message: "Upload excel file first",
        };
        complete();
        return;
    }

    await entities.pot_eta_lead_time_po_sto.createQueryBuilder().delete().execute();

    await entities.pot_eta_lead_time_po_sto
        .createQueryBuilder()
        .insert()
        .values(JSON.parse(getETALeadTimeNotActive.data_obj))
        .execute();

    await entities.pot_eta_lead_time_not_active
        .createQueryBuilder()
        .delete()
        .where("eta_lead_type = :type", { type: "posto" })
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
