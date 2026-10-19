try {

    const { delivery_id } = req.query;
    // const delivery_id = "11D7B8ED-81BC-F111-B88F-0050568C835B"

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

    let delivery_image_bt
    let delivery_image_dn
    
    if(selesai_pengiriman){
        
        [
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

    result.data = {
        success: false,
        message: error.message || error
    };

    complete();
}



// try {

//     const { delivery_id } = req.query;
//     // const delivery_id = "BDCC41F6-80AF-F111-B88F-0050568C835B"

//     if (!delivery_id) {
//         result.data = {
//             success: false,
//             message: "delivery_id required"
//         };

//         complete();
//         return;
//     }


//     // Get delivery terlebih dahulu
//     const delivery = await entities.pot_po_delivery_process.findOne({
//         where: {
//             id: delivery_id
//         }
//     });

//     // Validasi delivery
//     if (!delivery) {
//         result.data = {
//             success: false,
//             message: "Delivery not found"
//         };

//         complete();
//         return;
//     }


//     // Setelah delivery didapat, jalankan query lainnya secara paralel
//     const [
//         tracking,
//         selesai_pengiriman,
//         delivery_image_dn,
//         delivery_image_bt,
//         status_list
//     ] = await Promise.all([

//         // Get tracking
//         entities.pot_po_history_status.find({
//             where: {
//                 po_delivery_process_id: delivery_id
//             },
//             order: {
//                 status_date: "DESC"
//             }
//         }),

//         // Get data selesai pengiriman
//         entities.pot_kurir_selesai_pengiriman.findOne({
//             where: {
//                 no_delivery_note: delivery.do
//             }
//         }),

//         // Get image delivery note
//         entities.pot_kurir_selesai_pengiriman_img.find({
//             select: [
//                 "image",
//                 "type"
//             ],
//             where: {
//                 no_delivery_note: delivery.do,
//                 type: "dn"
//             }
//         }),

//         // Get image bukti pengiriman
//         entities.pot_kurir_selesai_pengiriman_img.find({
//             select: [
//                 "image",
//                 "type"
//             ],
//             where: {
//                 no_delivery_note: delivery.do,
//                 type: "bt"
//             }
//         }),

//         // Get master status
//         entities.pot_master_order_status.find()
//     ]);

//     console.log(tracking)


//     // Format tracking list
//     const tracking_list = tracking
//         .map((item) => {
//             const status = status_list.find(
//                 (s) => s.id === item.status_id
//             );

//             return {
//                 id: item.id,
//                 timestamp: FormatTanggal(item.status_date, status.status_name),
//                 expedition: selesai_pengiriman?.vendor_name ?? "",
//                 delivery_note: delivery.do,
//                 courier_name: selesai_pengiriman?.nama_kurir,
//                 recipient_name: selesai_pengiriman?.nama_penerima,
//                 recipient_position: selesai_pengiriman?.jabatan_penerima,
//                 delivery_image_dn,
//                 delivery_image_bt,
//                 status: status?.status_name ?? null,
//                 sequence: status?.sequence ?? null
//             };
//         })
//         .sort((a, b) => b.sequence - a.sequence);

//     // Response
//     result.data = {
//         success: true,
//         data: {
//             part_description: delivery.sales_item_description,
//             qty: delivery.qty_supply,
//             delivery_note: delivery.do,
//             tracking_list: tracking_list,
//           }
//     };

//     complete();

// } catch (error) {

//     result.data = {
//         success: false,
//         message: error.message || error
//     };

//     complete();
// }


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


