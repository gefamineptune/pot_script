try {
    const getETALeadTimeNotActive = await entities.pot_eta_lead_time_not_active
        .createQueryBuilder("na")
        .where("na.eta_lead_type = :type", { type: "pr" })
        .getOne();

    if (!getETALeadTimeNotActive) {
        result = {
            success: false,
            message: "Upload excel file first",
        };
        complete();
        return;
    }

    const dataObjNew = [];

    JSON.parse(getETALeadTimeNotActive.data_obj).forEach((obj, index) => {
        dataObjNew.push({
            material_type: obj["Material Type"],
            plant_pr: obj["Plant PR"],
            lab_office: obj["Lab Office"],
            plant_po: obj["Plant PO"],
            default_plant_po: obj["Default Plant PO"],
            po_type: obj["PO Type"],
            default_po_type: obj["Default PO Type"],
            vendor_code: obj["Vendor Code"],
            default_vendor_code: obj["Default Vendor Code"],
            vendor_name: obj["Vendor Name"],
            default_vendor_name: obj["Default Vendor Name"],
            pr_po: obj["PR - PO"],
            po_migo_107: obj["PO - MIGO 107"],
            migo_107_migo_109: obj["MIGO 107 - MIGO 109"],
            migo_109_confirm_to: obj["MIGO 109 - Confirm TO In"],
            confirm_to_to_confirm_uu: obj["Confirm TO In - TO Confirm UU/Block"],
            order: index + 1,
            createdBy: obj.createdBy,
            updatedBy: obj.updatedBy,
            createdAt: obj.createdAt,
            updatedAt: getETALeadTimeNotActive.active_date,
        });
    });

    await entities.pot_eta_lead_time_pr.createQueryBuilder().delete().execute();

    // Jumlah kolom per row = 21, jadi batas aman per batch = floor(2099 / 21) ≈ 99.
    // Pakai angka bulat yang lebih kecil (misal 90) biar ada buffer aman.
    const BATCH_SIZE = 90;

    for (let i = 0; i < dataObjNew.length; i += BATCH_SIZE) {
        const batch = dataObjNew.slice(i, i + BATCH_SIZE);
        await entities.pot_eta_lead_time_pr
            .createQueryBuilder()
            .insert()
            .values(batch)
            .execute();
    }

    await entities.pot_eta_lead_time_not_active
        .createQueryBuilder()
        .delete()
        .where("eta_lead_type = :type", { type: "pr" })
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