const getLeadTimeNotActive = await entities.pot_eta_lead_time_not_active
    .createQueryBuilder("na")
    .where("na.eta_lead_type = :type", { type: "posto" })
    .getOne();
if (!getLeadTimeNotActive) {
    result = await entities.pot_eta_lead_time_po_sto.createQueryBuilder("po").getMany();

    console.log(result);
    complete();
} else if (
    !getLeadTimeNotActive.active_date ||
    getLeadTimeNotActive.active_date === null ||
    new Date(getLeadTimeNotActive.active_date).getTime() > new Date().getTime()
) {
    const getLastUpdate = await entities.pot_eta_lead_time_po_sto.createQueryBuilder("po").getOne();
    const dataObj = (JSON.parse(getLeadTimeNotActive.data_obj)).map(item => ({
        ...item,
        updatedAt: Number(getLastUpdate.updatedAt)
    }));
    result = dataObj;
    console.log(result);
    complete();
} else {
    const dataObj = (JSON.parse(getLeadTimeNotActive.data_obj)).map(item => ({
        ...item,
        updatedAt: getLeadTimeNotActive.active_date
    }));

    await entities.pot_eta_lead_time_po_sto.createQueryBuilder().delete().execute();

    await entities.pot_eta_lead_time_po_sto
        .createQueryBuilder()
        .insert()
        .values(dataObj)
        .execute();

    await entities.pot_eta_lead_time_not_active
        .createQueryBuilder()
        .delete()
        .where("eta_lead_type = :type", { type: "posto" })
        .execute();

    result = await entities.pot_eta_lead_time_po_sto.createQueryBuilder("po").getMany();

    console.log(result);
    complete();
}