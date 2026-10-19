try {

    // INSERT HISTORY
    const historyPayload = {
        po_delivery_process_id: "9956948B-C79A-F111-B88F-0050568C835B",
        status_id: "42C2CABF-7DB1-F111-B88F-0050568C835B",
        createdBy: "user",
        createdAt: Date.now(),
        updatedBy: "user",
        updatedAt: Date.now()
    };

    const result = await entities.pot_po_history_status
        .createQueryBuilder()
        .insert()
        .values(historyPayload)
        .execute();

    result.data = {
        success : true,
        message : result
    }
    complete()

} catch (error) {

    result.data = {
        message : error
    }
    complete()

}