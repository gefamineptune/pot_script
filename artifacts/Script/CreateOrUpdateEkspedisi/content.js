try {

    const data = req.body;

 
    if (!data) {
        result.data = {
            success: false,
            message: "Ekspedisi data is required"
        };

        complete();
        return;
    }


    // TRANSACTION
    await entities.pot_ekspedisi.manager.transaction(
        async (manager) => {
            // ADD NEW
            if (data.id === "") {

                // Insert ekspedisi
                const ekspedisi = await manager.insert(
                    "pot_ekspedisi",
                    {
                        vendor_name: data.vendor_name,
                        vendor_code: data.vendor_code,
                        email: data.email,
                        username: data.username,
                        sector_code: data.sector_code,
                        ekspedisi_account_id: data.ekspedisi_account_id,
                        password: data.password,
                        status: data.status,
                        createdBy : "user",
                        updatedBy : "user",
                        createdAt : Date.now(),
                        updatedAt : Date.now()
                    }
                );

                // Ambil ID hasil insert
                const ekspedisi_id = ekspedisi.identifiers[0].id;

                // INSERT GUDANG
                if (Array.isArray(data.gudang) && data.gudang.length > 0) {

                    const gudangData = data.gudang.map(item => ({
                        ekspedisi_id: ekspedisi_id,
                        gudang_id: item.gudang_id,
                        createdBy : "user",
                        updatedBy : "user",
                        createdAt : Date.now(),
                        updatedAt : Date.now()
                    }));

                    await manager.insert("pot_ekspedisi_gudang", gudangData);
                }


                result.data = {
                    success: true,
                    message: "Data created successfully",
                    id: ekspedisi_id
                };

            }


            else {

                const ekspedisi_id = data.id;

                // UPDATE EKSPEDISI
                await manager.update(
                    "pot_ekspedisi",  //nama table
                    {
                        id: ekspedisi_id  //consdition
                    },
                    {
                        vendor_name: data.vendor_name,
                        vendor_code: data.vendor_code,
                        email: data.email,
                        username: data.username,
                        sector_code: data.sector_code,
                        ekspedisi_account_id: data.ekspedisi_account_id,
                        password: data.password,
                        status: data.status,
                        createdBy : "user",
                        updatedBy : "user",
                        createdAt : Date.now(),
                        updatedAt : Date.now()
                    }
                );


                // DELETE GUDANG EXISTING
                await manager.delete("pot_ekspedisi_gudang", {ekspedisi_id: ekspedisi_id});

                // INSERT GUDANG TERBARU
                if (
                    Array.isArray(data.gudang) &&
                    data.gudang.length > 0
                ) {

                    const gudangData = data.gudang.map(item => ({
                        ekspedisi_id: ekspedisi_id,
                        gudang_id: item.gudang_id,
                        createdBy : "user",
                        updatedBy : "user",
                        createdAt : Date.now(),
                        updatedAt : Date.now()
                    }));

                    await manager.insert(
                        "pot_ekspedisi_gudang",
                        gudangData
                    );
                }


                result.data = {
                    success: true,
                    message: "Data updated successfully"
                };
            }

        }
    );


    complete();


} catch (error) {

    console.error("Error save ekspedisi:", error);

    result.data = {
        success: false,
        message: error.message || error
    };

    complete();
}