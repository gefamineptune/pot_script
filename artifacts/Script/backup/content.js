try {

    //const {id} = req.query;
    const id = "AFF020B2-77B1-F111-B88F-0050568C835B";

    if (!id) {
        result.data = {
            success: false,
            message: "id required"
        };
        complete();
        return;
    }

    const internal = await entities.pot_po_internal_process
        .createQueryBuilder("internal")
        .leftJoin(
            "pot_po_item",
            "item",
            "item.id = internal.po_item_id"
        )
        .leftJoin(
            "pot_master_order_status",
            "status",
            "status.id = internal.order_status_id"
        )
        .select([
            "internal.id AS id",
            "internal.po_item_id AS po_item_id",
            "item.part_description AS part_description",
            "internal.qty_sourcing AS qty_sourcing",
            "internal.qty_allocated AS qty_allocated",
            "internal.sourcing_type AS sourcing_type",
            "status.sequence AS status_sequence" 
        ])
        .where("internal.id = :id", { id })
        .getRawOne();

    //console.log(JSON.stringify(internal));

    const tracking_list_raw = await entities.pot_po_history_status
        .createQueryBuilder("history")
        .leftJoin(
            "pot_master_order_status",
            "status",
            "status.id = history.status_id"
        )
        .select([
            "history.id AS id",
            "history.status_date AS timestamp",
            "status.status_name AS status",
            "status.sequence AS sequence" 
        ])
        .where("history.po_internal_process_id = :id", { id: id })
        .orderBy("status.sequence", "DESC")
        .getRawMany();

    //console.log("Data : " + JSON.stringify(tracking_list_raw));

    // Filter: hanya tampilkan history yang sequence-nya <= sequence status saat ini
    const currentSequence = internal?.status_sequence ?? null;

    const tracking_list = currentSequence !== null
        ? tracking_list_raw.filter(item => item.sequence !== null && item.sequence <= currentSequence)
        : tracking_list_raw;

   // Format timestamp pada setiap tracking.
    tracking_list.forEach(item => {
        item.timestamp = FormatTanggal(item.timestamp, item.status);
    });

    result.data = {
        success: true,
        data: {
            part_description: internal?.part_description ?? null,
            qty_sourcing: internal?.qty_sourcing ?? null,
            qty_allocated: internal?.qty_allocated ?? null,
            sourcing_type: internal?.sourcing_type ?? null,
            tracking_list: tracking_list
        }
    };

    console.log(JSON.stringify(result));
    complete();
    return;

} catch (error) {
    result.data = {
        success: false,
        message: error.message || error
    };
    console.log(error.message);
    complete();
}

function FormatTanggal(timestamp, status) {

    const date = new Date(timestamp);

    const bulan = [
        "Januari",
        "Februari",
        "Maret",
        "April",
        "Mei",
        "Juni",
        "Juli",
        "Agustus",
        "September",
        "Oktober",
        "November",
        "Desember"
    ];
    

    const day = String(date.getDate()).padStart(2, "0");
    const month = bulan[date.getMonth()];
    const year = date.getFullYear();

    if (status === "PO Received") {
        return `${day} ${month} ${year}`;
    }

    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");

    return `${day} ${month} ${year} ${hour}:${minute}`;
}