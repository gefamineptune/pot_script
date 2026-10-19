try {

    const {id} = req.query;
    //  const id = '23606E96-BEA2-F111-B88F-0050568C835B';

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
        .select([
            "internal.id AS id",
            "internal.po_item_id AS po_item_id",
            "item.part_description AS part_description",
            "internal.qty_sourcing AS qty_sourcing",
            "internal.qty_allocated AS qty_allocated",
            "internal.sourcing_type AS sourcing_type"
        ])
        .where("internal.id = :id", {
            id
        })
        .getRawOne();




    const tracking_list = await entities.pot_po_delivery_tracking_status
        .createQueryBuilder("tracking")
        .leftJoin(
            "pot_master_order_status",
            "status",
            "status.id = tracking.order_status_id"
        )
        .leftJoin(
            "pot_po_internal_process",
            "internal",
            "internal.id = tracking.document_id"
        )
        .select([
            "tracking.id AS id",
            "tracking.timestamp AS timestamp",
            "status.status_name AS status"
        ])
        .where(
            "TRY_CONVERT(uniqueidentifier, tracking.document_id) = :id",
            { id }
        )
        .orderBy("tracking.timestamp", "DESC")
        .getRawMany();


    // Format timestamp pada setiap tracking.
    tracking_list.forEach(item => {
        item.timestamp = FormatTanggal(item.timestamp);
    });

    console.log(JSON.stringify("Tracker : " + tracking_list));

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


function FormatTanggal(timestamp) {

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

    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");

    return `${day} ${month} ${year} ${hour}:${minute}`;
}