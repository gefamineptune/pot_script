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

    const { In } = operators;


  
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

    // --------------------------------------------------
    // Get Order Status
    // --------------------------------------------------
    const statusList = await entities.pot_master_order_status.find();
    const statusCodeToId = {};
    const statusByIdMap = {};
    statusList.forEach(status => {
        statusCodeToId[status.status_code] = status.id;
        statusByIdMap[status.id] = status;
    });


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

        let po_list = []

        // kalau data di dwh available, update data dwh
        for (const deliveryProcess of deliveryProcessList) {

            // Cari PO Item
            const poItem = await entities.pot_po_item.findOne({
                where: {
                    id: deliveryProcess.po_item_id,
                }
            });

            // cari po
            const po = await entities.pot_po.findOne({
                where: {
                    id: poItem.po_id
                }
            });

            po_list.push(po)
            

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


            // Update History Status
            const existingHistory = await entities.pot_po_history_status.findOne({
                where: { po_delivery_process_id: deliveryProcess.id, status_id: masterStatus.id },
            });


            if (!existingHistory) {
                // INSERT HISTORY
                 await entities.pot_po_history_status.insert({
                    po_delivery_process_id: deliveryProcess.id,
                    status_date: new Date(),
                    status_id: masterStatus.id
                });
            } else {
                // UPDATE HISTORY
                await entities.pot_po_history_status.update(
                    {
                        id: existingHistory.id
                    },
                    {
                        status_date: new Date()
                    }
                );
            }
           
        }



        // INSERT DELIVERY TEMP
        await entities.pot_kurir_delivery_temp.insert({
            do_number: do_number,
            vendor_code,
            shipment_date: new Date(),
            soldTo: soldTo,
            username_submit: username_submit
        });


        if(po_list){

            // Helper: pecah array jadi batch (default 100 per batch)
            function chunkArray(arr, size = 100) {
                const result = [];
                for (let i = 0; i < arr.length; i += size) {
                    result.push(arr.slice(i, i + size));
                }
                return result;
            }

            // Helper: fetch dengan In() tapi otomatis di-chunk
                async function findInChunks(repo, field, values) {
                    const chunks = chunkArray(values, 100);
                    const allResults = [];
                    for (const chunk of chunks) {
                        const rows = await repo.find({ where: { [field]: In(chunk) } });
                        allResults.push(...rows);
                    }
                    return allResults;
                }
        
            
            // --------------------------------------------------
            // RE-CALCULATE PO STATUS berdasarkan final status dari table internal dan delivery process
            //
            // 1. Hitung Total Qty Sourcing (SUM qty_sourcing dari SEMUA Internal Process dalam 1 PO).
            // 2. Bandingkan dengan Qty Order di Level PO (po.qty_order).
            // 3. Jika Total Sourcing < Qty Order PO -> Status PO Max PROCESSING.
            // 4. Jika Total Sourcing = Qty Order PO -> Status PO = Min Sequence / Terendah dari Delivery Process.
            // --------------------------------------------------
    

            // STEP 1: Ambil semua item PO (otomatis di-chunk)
            const poIds = po_list.map(p => p.id);
            const items = await findInChunks(entities.pot_po_item, 'po_id', poIds);
            const itemIds = items.map(i => i.id);

            // STEP 3: Ambil semua proses (otomatis di-chunk)
            const internalProcs = await findInChunks(entities.pot_po_internal_process, 'po_item_id', itemIds);
            const deliveryProcs = await findInChunks(entities.pot_po_delivery_process, 'po_item_id', itemIds);

            // --------------------------------------------------
            // BAGIAN A: RE-CALCULATE PO STATUS (Item-Level Validation)
            //
            // 1. Hitung Qty Sourcing per Non-Head Item (dengan deduplikasi PR).
            // 2. Tentukan Status per Non-Head Item: 
            //    - Jika Sum Qty Sourcing >= Qty Order Item -> Item Selesai Sourcing.
            //    - Jika tidak -> Item Belum Selesai.
            // 3. Tentukan Status PO:
            //    - Jika ADA item yang belum selesai sourcing -> PO Status = PROCESSING.
            //    - Jika SEMUA item selesai sourcing -> PO Status = Min Sequence dari Delivery Process.
            // --------------------------------------------------
            

            // Map itemId -> poId
            const poIdByItemId = {};
            for (const item of items) {
                poIdByItemId[item.id] = item.po_id;
            }

            // PENTING: Filter Item Non-Head (Child Items) - Item yang is_sales_item_header = 0
            const nonHeadItems = items.filter(item => {
                return Number(item.is_sales_item_header) === 0;
            });

            // Object penampung kalkulasi per ITEM: { itemId: { totalSourcingQty, qtyOrder, isFullySourced } }
            const itemCalcMap = {};
            for (const item of nonHeadItems) {
                itemCalcMap[item.id] = {
                    totalSourcingQty: 0,
                    qtyOrder: Number(item.qty_order || 0),
                    isFullySourced: false
                };
            }

            // Hitung Total Qty Sourcing per ITEM (dengan deduplikasi PR)
            const calculatedPRs = new Set(); // Key: itemId + "|" + prNumber, Value: true (sudah dihitung)

            for (const proc of internalProcs) {
                if (!proc.po_item_id) continue;
                const itemId = proc.po_item_id;
                
                if (!itemCalcMap[itemId]) continue;

                let qtyToAdd = 0;

                // Logika Deduplikasi Khusus PR
                if (proc.sourcing_type === 'PR' && proc.pr_number) {
                    const uniqueKey = `${itemId}|${proc.pr_number}`;
                    
                    if (!calculatedPRs.has(uniqueKey)) {
                        qtyToAdd = Number(proc.qty_sourcing || 0);
                        calculatedPRs.add(uniqueKey);
                    }
                } else {
                    // Untuk Non-PR (TP/PO STO), hitung semua baris
                    qtyToAdd = Number(proc.qty_sourcing || 0);
                }

                itemCalcMap[itemId].totalSourcingQty += qtyToAdd;
            }

            // Tentukan apakah setiap Item sudah Fully Sourced
            for (const itemId in itemCalcMap) {
                const calc = itemCalcMap[itemId];
                // Jika qty sourcing >= qty order, maka item dianggap selesai sourcing
                if (calc.totalSourcingQty >= calc.qtyOrder) {
                    calc.isFullySourced = true;
                }
            }

            // Agregasi ke Level PO & Cari Status Delivery Terendah
            // Object penampung kalkulasi per PO: { poId: { allNonHeadItemsSourced, minStatusSeq, minStatusId } }
            const poCalcMap = {};
            for (const po of po_list) {
                poCalcMap[po.id] = {
                    allNonHeadItemsSourced: true, // Asumsi awal true, akan jadi false jika ada item yang belum
                    minStatusSeq: Infinity, 
                    minStatusId: null,
                };
            }

            // Cek Status Sourcing per Item terhadap PO-nya
            for (const itemId in itemCalcMap) {
                const itemCalc = itemCalcMap[itemId];
                const poId = poIdByItemId[itemId];

                if (poId && poCalcMap[poId]) {
                    // Jika ada SATU saja item yang belum fully sourced, maka PO belum fully sourced
                    if (!itemCalc.isFullySourced) {
                        poCalcMap[poId].allNonHeadItemsSourced = false;
                    }
                }
            }

            // Cari Status Terendah (Sequence Terkecil) dari Delivery Process
            for (const proc of deliveryProcs) {
                if (!proc.po_item_id) continue;

                const poId = poIdByItemId[proc.po_item_id];
                if (!poId || !poCalcMap[poId]) continue;

                if (proc.order_status_id) {
                    const status = statusByIdMap[proc.order_status_id];
                    if (status) {
                        const seq = Number(status.sequence);
                        if (seq < poCalcMap[poId].minStatusSeq) {
                            poCalcMap[poId].minStatusSeq = seq;
                            poCalcMap[poId].minStatusId = status.id;
                        }
                    }
                }
            }

            // STEP 4: Tentukan Final Status per PO & Update Database
            for (const po of po_list) {
                const calc = poCalcMap[po.id];
                let finalStatusIdForPo = null;

                // LOGIKA UTAMA STATUS PO
                if (!calc.allNonHeadItemsSourced) {
                    // Jika ADA item yang belum lengkap sourcing-nya -> Paksa Status PROCESSING
                    finalStatusIdForPo = statusCodeToId["PROCESSING"];
                } else {
                    // Jika SEMUA item sudah lengkap sourcing-nya -> Ikuti Status Delivery Terendah
                    if (calc.minStatusId) {
                        finalStatusIdForPo = calc.minStatusId;
                    } else {
                        // Semua item sourcing lengkap, tapi belum ada delivery process sama sekali
                        finalStatusIdForPo = statusCodeToId["PROCESSING"];
                    }
                }

                // Update PO Header di Database jika status berubah
                if (finalStatusIdForPo !== po.order_status_id) {
                    await entities.pot_po.createQueryBuilder()
                        .update()
                        .set({ 
                            order_status_id: finalStatusIdForPo,
                            updatedBy: (req.user && req.user.username) || "system",
                            updatedAt: Date.now()
                        })
                        .where("id = :id", { id: po.id })
                        .execute();
                }
            }
        }
    
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


