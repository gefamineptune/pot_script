try {

    // const { delivery_id } = req.query;
    const delivery_id = "11D7B8ED-81BC-F111-B88F-0050568C835B"

    if (!delivery_id) {
        result.data = {
            success: false,
            message: "delivery_id required"
        };

        complete();
        return;
    }


    // Get delivery terlebih dahulu
    const delivery = await entities.pot_po_delivery_process.findOne({
        where: {
            id: delivery_id
        }
    });

    // Validasi delivery
    if (!delivery) {
        result.data = {
            success: false,
            message: "Delivery not found"
        };

        complete();
        return;
    }


    // Setelah delivery didapat, jalankan query lainnya secara paralel
    const [
        tracking,
        selesai_pengiriman_list,
        status_list,
        status_delivery
    ] = await Promise.all([

        // Get tracking
        entities.pot_po_history_status.find({
            where: {
                po_delivery_process_id: delivery_id
            },
            order: {
                status_date: "DESC"
            }
        }),

        // Get data selesai pengiriman
        entities.pot_kurir_selesai_pengiriman.find({
            where: {
                    no_delivery_note: delivery.do
                },
            order: {
                createdAt: "DESC",
        
            }, 
        }),

        // Get master status
        entities.pot_master_order_status.find(),

        // get sattus delivery
        entities.pot_master_order_status.findOne({
            where: {
                id: delivery.order_status_id
            },
        }),
    ]);

    const selesai_pengiriman = selesai_pengiriman_list[0]

    if(selesai_pengiriman){
        const [
            delivery_image_dn,
            delivery_image_bt,
        ] = await Promise.all([

            
            // Get image delivery note
            entities.pot_kurir_selesai_pengiriman_img.find({
                select: [
                    "image",
                    "type"
                ],
                where: {
                    selesai_pengiriman_id : selesai_pengiriman.id,
                    no_delivery_note: delivery.do,
                    type: "dn"
                }
            }),

            // Get image bukti pengiriman
            entities.pot_kurir_selesai_pengiriman_img.find({
                select: [
                    "image",
                    "type"
                ],
                where: {
                    selesai_pengiriman_id : selesai_pengiriman?.id,
                    no_delivery_note: delivery.do,
                    type: "bt"
                }
            }),

        ]);
    }

 


    // Format tracking list
   const tracking_list = tracking
    .filter((item) => {
        const status = status_list.find(
            (s) => s.id === item.status_id
        );

        return status && status.sequence <= status_delivery.sequence;
    })
    .map((item) => {
        const status = status_list.find(
            (s) => s.id === item.status_id
        );

        return {
            id: item.id,
            timestamp: FormatTanggal(
                item.status_date,
                status.status_name
            ),
            expedition: status.status_name === "Delivered"
                            ? selesai_pengiriman?.vendor_name ?? ""
                            : "",
            delivery_note: delivery.do,
            courier_name: status.status_name === "Delivered"
                            ? selesai_pengiriman?.nama_kurir ?? ""
                            : "",
            recipient_name: status.status_name === "Delivered"
                            ? selesai_pengiriman?.nama_penerima ?? ""
                            : "",
            recipient_position: status.status_name === "Delivered"
                            ? selesai_pengiriman?.jabatan_penerima ?? ""
                            : "",
            delivery_image_dn : status.status_name === "Delivered"
                            ? delivery_image_dn ?? []
                            : [],
            delivery_image_bt : status.status_name === "Delivered"
                            ? delivery_image_bt ?? []
                            : [],
            status: status?.status_name ?? null,
            sequence: status?.sequence ?? null
        };
    })
    .sort((a, b) => b.sequence - a.sequence);

    // Response
    result.data = {
        success: true,
        data: {
            part_description: delivery.sales_item_description,
            qty: delivery.qty_supply,
            delivery_note: delivery.do,
            tracking_list: tracking_list,
          }
    };

    complete();

} catch (error) {
    console.log(error)

    result.data = {
        success: false,
        message: error.message || error
    };

    complete();
}



function FormatTanggal(value) {

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return null;
    }

    let date;

    // Support timestamp number / numeric string
    if (
        typeof value === "number" ||
        /^\d+$/.test(String(value))
    ) {
        date = new Date(Number(value));
    } else {
        // Support ISO: 2026-09-17T13:05:00.000Z
        date = new Date(value);
    }

    if (isNaN(date.getTime())) {
        return null;
    }

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

    const tanggal = String(date.getUTCDate()).padStart(2, "0");
    const namaBulan = bulan[date.getUTCMonth()];
    const tahun = date.getUTCFullYear();

    return `${tanggal} ${namaBulan} ${tahun}`;
}