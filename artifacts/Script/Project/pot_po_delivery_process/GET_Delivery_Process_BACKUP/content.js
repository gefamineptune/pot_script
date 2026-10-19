let sequelize;

try {

    const { so_number, so_item } = req.query;


    // ==============================
    // 1. VALIDATE PARAMETER
    // ==============================
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



    // ==============================
    // 2. DATABASE CONNECTION GOLD
    // ==============================
    const seq = modules.sequelize;

    const DB_HOST = await vault.decrypt("DB-HOST");
    const DB_USER = await vault.decrypt("DB-USER");
    const DB_PASS = await vault.decrypt("DB-PASS");


    sequelize = new seq(
        "DWH_BUSDAT",
        DB_USER,
        DB_PASS,
        {
            host: DB_HOST,
            dialect: "mssql",
            logging: false,
            dialectOptions: {
                options: {
                    encrypt: false,
                    trustServerCertificate: true
                }
            }
        }
    );


    await sequelize.authenticate();



    // ==============================
    // 3. GET TEMP DELIVERY PROCESS
    // ==============================
    const tempData =
        await entities.pot_kurir_delivery_temp.find({
            where: {
                so_number: so_number
            }
        });



    // ==============================
    // 4. GET DELIVERED DATA
    // ==============================
    const deliveredData =
        await entities.pot_kurir_selesai_pengiriman.find({
            where: {
                so_number: so_number
            }
        });



    // ==============================
    // 5. GET DATA GOLD
    // ==============================
    const [goldResult] = await sequelize.query(`
        SELECT
            sales_document_no,
            sales_document_item,
            delivery_no,
            shipment_no,
            delivery_quantity
        FROM dt_gld.do_to_bil_ship
        WHERE sales_document_no = :so_number
        AND sales_document_item = :so_item
    `, {
        replacements: {
            so_number: so_number,
            so_item: so_item
        }
    });


    const goldData = goldResult || [];



    // ==============================
    // 6. TABLE DELIVERY
    // ==============================
    let table_delivery = [];



    // ==============================
    // 7. CREATE DELIVERED DO SET
    // ==============================
    // Untuk pengecekan agar data temp
    // yang sudah delivered tidak muncul lagi

    const deliveredDoNumbers = new Set(

        deliveredData.map((item) =>
            String(item.no_delivery_note)
        )

    );



    // ==============================
    // 8. INSERT DELIVERED DATA
    // ==============================
    deliveredData.forEach((delivered) => {

        const doNumber =
            String(delivered.no_delivery_note);


        // Cari data GOLD berdasarkan DO
        const gold = goldData.find((item) => {

            return String(item.delivery_no) === doNumber;

        });


        table_delivery.push({

            // id:
            //     delivered.id,

            // so_number:
            //     delivered.so_number,

            // so_item:
            //     so_item,

            do_number:
                delivered.no_delivery_note,

            spb:
                gold?.shipment_no ?? null,

            shipment_date:
                FormatTanggal(delivered.shipment_date ?? "-"),

            qty_supply:
                gold?.delivery_quantity ?? null,

            receive_date:
                FormatTanggal(delivered.createdAt ?? "-"),

            status:
                "Delivered"

        });

    });



    // ==============================
    // 9. INSERT TEMP DATA
    // ==============================
    tempData.forEach((temp) => {

        const doNumber =
            String(temp.do_number);


        // ==========================
        // CEK APAKAH SUDAH DELIVERED
        // ==========================
        const existsInDelivered =
            deliveredDoNumbers.has(doNumber);


        // Kalau sudah delivered,
        // jangan masukkan temp lagi
        if (existsInDelivered) {
            return;
        }



        // ==========================
        // CARI DATA GOLD
        // ==========================
        const gold = goldData.find((item) => {

            return String(item.delivery_no) === doNumber;

        });



        // ==========================
        // PUSH TEMP
        // ==========================
        table_delivery.push({

            // id:
            //     temp.id,

            // so_number:
            //     temp.so_number,

            // so_item:
            //     so_item,

            do_number:
                temp.do_number,

            spb:
                gold?.shipment_no ?? null,

            shipment_date:
                FormatTanggal(temp.shipment_date ?? "-"),

            qty_supply:
                gold?.delivery_quantity ?? null,

            receive_date:
                "-",

            status:
                temp.status ?? "Shipped"

        });

    });



    // ==============================
    // 10. SUCCESS
    // ==============================
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