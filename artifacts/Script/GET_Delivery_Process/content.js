let sequelize;

try {

    const { so_number, so_item } = req.query;


    // 1. VALIDATE PARAMETER
    if (!so_number) {

        result.data = {
            success: false,
            message: "so_number required"
        };

        complete();
        return;
    }


    if (!so_item) {

        result.data = {
            success: false,
            message: "so_item required"
        };

        complete();
        return;
    }


    // 2. GET DELIVERY PROCESS
    const [deliveryProcessData, statusMaster] = await Promise.all([
        entities.pot_po_delivery_process.find({
            where: {
                so_number: so_number,
                so_item: so_item
            }
        }),

        entities.pot_master_order_status.find({})
    ]);


    let table_delivery = []


    // 3. INSERT DELIVERY DATA
    deliveryProcessData.forEach((delivered) => {

        // Cari status
        const status = statusMaster.find((item) => {
            return String(item.id) === delivered.order_status_id;

        });


        table_delivery.push({

            id:
                delivered.id,

            do_number:
                delivered.do,

            spb:
                delivered.spb,

            shipment_date:
                FormatTanggal(delivered.shipment_date) ?? "-",

            qty_supply:
                delivered.qty_supply ?? null,
            
            eta_received:
                FormatTanggal(delivered.eta_customer_received) ?? "-",

            receive_date:
                FormatTanggal(delivered.receive_date) ?? "-",

            status:
                status.status_name

        });

    });



    // 4. SUCCESS
    result.data = {
        success: true,
        data:
            table_delivery
    };


    complete();
    return;


} catch (error) {

    result.data = {
        success: false,
        message:
            error.message || error
    };

    complete();
    return;


} finally {

    if (sequelize) {

        await sequelize.close();

    }

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
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December"
    ];

    const tanggal = String(date.getUTCDate()).padStart(2, "0");
    const namaBulan = bulan[date.getUTCMonth()];
    const tahun = date.getUTCFullYear();

    return `${tanggal} ${namaBulan} ${tahun}`;
}