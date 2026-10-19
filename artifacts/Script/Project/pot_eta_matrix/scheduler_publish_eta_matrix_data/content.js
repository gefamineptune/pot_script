const getETALeadTimeNotActive = await entities.pot_eta_lead_time_not_active
    .createQueryBuilder()
    .getMany();

if (!getETALeadTimeNotActive || getETALeadTimeNotActive.length === 0) {
    complete();
}

// getETALeadTimeNotActive.forEach(async (item, index) => {
for (const [index, item] of getETALeadTimeNotActive.entries()) {
    console.log(index + " : " + item.eta_lead_type);
    if (item.active_date && new Date(item.active_date).getTime() <= new Date().getTime()) {
        const dataObj = JSON.parse(item.data_obj).map((obj) => ({
            ...obj,
            updatedAt: item.active_date,
        }));
        switch (item.eta_lead_type) {
            case "general":
                let getCreateData = [];

                dataObj.forEach((item) => {
                    getCreateData.push({
                        lead_time: item["Lead Time"],
                        total_days: item["Total Days"],
                        createdBy: item.createBy,
                        updatedBy: item.createBy,
                        createdAt: item.createAt,
                        updatedAt: item.updatedAt,
                    });
                });

                try {
                    await entities.pot_eta_lead_time_general
                        .createQueryBuilder()
                        .delete()
                        .execute();

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
                    console.log("Activated");
                } catch (err) {
                    console.log(err);
                }
                break;
            case "tp":
                try {
                    await entities.pot_eta_lead_time_tp.createQueryBuilder().delete().execute();
                    const dataObjNew = JSON.parse(item.data_obj).map((obj, index) => ({
                        Plant: obj.Plant,
                        CreateTP_CheckStock: obj["Create TP - Check Stock"],
                        order: index + 1,
                        createdBy: obj.createdBy ?? "User",
                        updatedBy: obj.updatedBy ?? "User",
                        createdAt: obj.createdAt,
                        updatedAt: item.active_date,
                    }));

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
                    console.log("Activated");
                } catch (err) {
                    console.log(err);
                }
                break;
            case "posto":
                try {
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

                    console.log("Activated");
                } catch (err) {
                    console.log(err);
                }
                break;
            case "pr":
                try {
                    await entities.pot_eta_lead_time_pr.createQueryBuilder().delete().execute();

                    const dataObjPR = JSON.parse(item.data_obj).map((obj, index) => ({
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
                        createdBy: obj.createdBy ?? "User",
                        updatedBy: obj.updatedBy ?? "User",
                        createdAt: obj.createdAt,
                        updatedAt: item.active_date,
                    }));

                    
                    const numColumns = Object.keys(dataObjPR[0] || {}).length; // 20 kolom
                    const BATCH_SIZE = Math.floor(2000 / numColumns); // buffer aman dari 2100

                    for (let i = 0; i < dataObjPR.length; i += BATCH_SIZE) {
                        const batch = dataObjPR.slice(i, i + BATCH_SIZE);
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

                    console.log("Activated");
                } catch (err) {
                    console.log(err);
                }

                break;
        }
    } else {
        console.log("Not active yet");
    }
}
// });
console.log("Success");

complete();
