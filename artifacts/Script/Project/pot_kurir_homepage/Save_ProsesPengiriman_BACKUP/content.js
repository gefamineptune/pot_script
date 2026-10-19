// Function untuk extract token
function extractToken(authorizationHeader) {

    if (!authorizationHeader) {
        return null;
    }

    const parts = authorizationHeader.split(" ");

    if (
        parts.length !== 2 ||
        parts[0].toLowerCase() !== "bearer"
    ) {
        return null;
    }

    return parts[1];
}


try {

    const jwt = modules.jsonwebtoken;

    // =========================
    // JWT CONFIG
    // =========================
    const JWT_CONFIG = {
        algorithm: "HS256",
        secret: await vault.decrypt("JWT-SIGNING-SECRET"),
        issuer: "neptune-dxp-app"
    };


    // =========================
    // GET JWT TOKEN HEADER
    // =========================
    const jwtToken = req.headers["x-jwt-token"];

    // contoh header:
    // x-jwt-token: Bearer eyJhbGciOiJIUzI1NiIs...

    const token = extractToken(jwtToken);


    if (!token) {

        result.status = 401;

        result.data = {
            success: false,
            message: "Unauthorized"
        };

        complete();
        return;
    }


    // =========================
    // VERIFY JWT
    // =========================
    try {

        jwt.verify(token, JWT_CONFIG.secret, {
            algorithms: [JWT_CONFIG.algorithm],
            issuer: JWT_CONFIG.issuer
        });

    } catch (error) {

        result.status = 401;

        result.data = {
            success: false,
            message:
                error.name === "TokenExpiredError"
                    ? "Token has expired"
                    : "Invalid token"
        };

        complete();
        return;
    }



    // GET REQUEST BODY
    const {
        do_number,
        soldTo,
        vendor_code,
        username_submit
    } = req.body;


  
    // VALIDASI PARAMETER
    if (!do_number || !username_submit) {

        result.status = 400;

        result.data = {
            success: false,
            message: "do_number & username required"
        };

        complete();
        return;
    }


  
    // GET MASTER STATUS
    // DAN DELIVERY PROCESS
    const [
        masterStatus,
        deliveryProcessList,
        temp
    ] = await Promise.all([

        entities.pot_master_order_status.findOne({
            where: {
                status_code: "SHIPPED"
            }
        }),

        entities.pot_po_delivery_process.find({
            where: {
                do: do_number
            }
        }),

        entities.pot_kurir_delivery_temp.findOne({
            where: {
                do_number: do_number
            }
        })

    ]);



    // VALIDASI MASTER STATUS
    if (!masterStatus) {
        result.status = 404;
        result.data = {
            success: false,
            message: "Status SHIPPED not found"
        };

        complete();
        return;
    }


    // cek apakah data sudah ada di table temporary
    if(temp){
        result.data = {
            success : true,
            message : "Data pengiriman sudah ada"
        }

        complete()
        return

    }



    // VALIDASI DELIVERY PROCESS
    if (!deliveryProcessList || deliveryProcessList.length === 0) {
        
        // kalau data di dwh tidak ada, langsung INSERT DELIVERY TEMP
        await entities.pot_kurir_delivery_temp.insert({
            do_number: do_number,
            vendor_code,
            shipment_date: new Date(),
            soldTo: soldTo,
            username_submit: username_submit
        });



        result.status = 200;

        result.data = {
            success: true,
            message: "Berhasil"
        };

        complete();
        return

    } else {

        // kalau data di dwh available, update data dwh
        for (const deliveryProcess of deliveryProcessList) {

            // Cari PO Item berdasarkan SO Number + SO Item
            const poItem = await entities.pot_po_item.findOne({
                where: {
                    so_number: deliveryProcess.so_number,
                    so_item: deliveryProcess.so_item
                }
            });


        
            // UPDATE PO & PO ITEM
            if (poItem) {

                // Update PO
                if (poItem.po_id) {

                    await entities.pot_po.update(
                        {
                            id: poItem.po_id
                            
                        },
                        {
                            order_status_id: masterStatus.id
                        },
                        
                    );

                }


                // Update PO Item
                await entities.pot_po_item.update(
                    {
                        
                            id: poItem.id
                        
                    },
                    {
                        order_status_id: masterStatus.id
                    },
                    
                );

            }


        
            // UPDATE DELIVERY PROCESS
            await entities.pot_po_delivery_process.update(
                {
                   
                        id: deliveryProcess.id
                    
                },
                
                {
                    shipment_date : new Date(),
                    expedition_pickup_date : new Date(),
                    order_status_id: masterStatus.id
                },
                
            );



            // INSERT HISTORY STATUS
            await entities.pot_po_history_status.insert({
                po_delivery_process_id: deliveryProcess.id,
                status_date: new Date(),
                status_id: masterStatus.id
            });

        }



        // INSERT DELIVERY TEMP
        await entities.pot_kurir_delivery_temp.insert({
            do_number: do_number,
            vendor_code,
            shipment_date: new Date(),
            soldTo: soldTo,
            username_submit: username_submit
        });


    
        // SUCCESS RESPONSE
        result.status = 200;

        result.data = {
            success: true,
            message: "Berhasil"
        };

        complete();
    }


} catch (error) {

    result.status = 500;

    result.data = {
        success: false,
        message: error.message || error.toString()
    };

    complete();
}