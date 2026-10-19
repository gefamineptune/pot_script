

// function untuk extract token
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


// MULAI CODE
try {

    const https = modules.https;
    const jwt = modules.jsonwebtoken;

 
    // JWT CONFIG
    const JWT_CONFIG = {
        algorithm: "HS256",
        secret: await vault.decrypt("JWT-SIGNING-SECRET"),
        issuer: "neptune-dxp-app"
    };


    // GET jwt token HEADER
   const jwtToken = req.headers["x-jwt-token"];
   const data = JSON.stringify(req.headers);

    // Extract JWT token
    const token = extractToken(jwtToken);

    if (!token) {
        result.status = 401;
        result.data = {
            success: false,
            message: "Unauthorized",
          
        };

        complete();
        return;
    }



    // VERIFY JWT
    let payload;

    try {

        payload = jwt.verify(
            token,
            JWT_CONFIG.secret,
            {
                algorithms: [JWT_CONFIG.algorithm],
                issuer: JWT_CONFIG.issuer
            }
        );

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




    // TOKEN VALID
    // MULAI JALANKAN API DI SINI

 
    const { vendor_code } = req.body;
    const { In } = operators;

    // VALIDATE VENDOR CODE
    if (!vendor_code) {

        result.status = 400;

        result.data = {
            success: false,
            message: "vendor_code is required"
        };

        complete();
        return;
    }

    // SAP CONFIG
    const baseUrl = await vault.decrypt("BASE-URL-SAP");
    const username = await vault.decrypt("AUTH-USERNAME-SAP");
    const password = await vault.decrypt("AUTH-PASS-SAP");

    const basicAuth = Buffer
        .from(`${username}:${password}`)
        .toString("base64");

    const params = new URLSearchParams({
        "sap-client": "530"
    });

    const agent = new https.Agent({
        rejectUnauthorized: false
    });



    // 1. GET CSRF TOKEN + COOKIE
    const tokenUrl =
        `${baseUrl}/sap/zdgt_in/token?${params.toString()}`;

    const tokenOptions = {
        method: "GET",
        headers: {
            "Authorization": `Basic ${basicAuth}`,
            "Accept": "application/json",
            "X-CSRF-Token": "Fetch"
        },
        agent: agent
    };


    const tokenResult = await new Promise((resolve, reject) => {

        const request = https.request(
            tokenUrl,
            tokenOptions,
            (response) => {

                let responseBody = "";

                response.on("data", (chunk) => {
                    responseBody += chunk;
                });

                response.on("end", () => {

                    const csrfToken =
                        response.headers["x-csrf-token"];

                    const setCookie =
                        response.headers["set-cookie"];

                    const cookie = Array.isArray(setCookie)
                        ? setCookie
                            .map(item => item.split(";")[0])
                            .join("; ")
                        : setCookie?.split(";")[0];

                    resolve({
                        status: response.statusCode,
                        csrfToken: csrfToken,
                        cookie: cookie,
                        body: responseBody
                    });

                });

            }
        );

        request.on("error", reject);

        request.end();
    });



    // 2. VALIDATE TOKEN RESPONSE

    if (
        tokenResult.status < 200 ||
        tokenResult.status >= 300
    ) {

        let tokenError = tokenResult.body;

        try {
            tokenError = JSON.parse(tokenResult.body);
        } catch (e) {
            // response bukan JSON
        }

        result.data = {
            success: false,
            message: "Failed to get CSRF token",
            status: tokenResult.status,
            data: tokenError
        };

        complete();
        return;
    }


    if (!tokenResult.csrfToken) {

        result.data = {
            success: false,
            message: "CSRF token not found"
        };

        complete();
        return;
    }


    if (!tokenResult.cookie) {

        result.data = {
            success: false,
            message: "SAP session cookie not found"
        };

        complete();
        return;
    }

    // Tambahan: Get list plant
    const getEkspedisi_Gudang = await entities.pot_ekspedisi
        .createQueryBuilder("e")
        .where("e.vendor_code = :ven_code", { ven_code: vendor_code })
        .leftJoinAndSelect("pot_ekspedisi_gudang", "eg", "eg.ekspedisi_id = e.id")
        .leftJoinAndSelect("pot_master_gudang", "g", "eg.gudang_id = g.id")
        .getRawMany();

    const deliveryOrderBodyTemp = {
        vendor: vendor_code
    }

    if (getEkspedisi_Gudang.length > 0) {
        deliveryOrderBodyTemp.plant = [...new Set(getEkspedisi_Gudang.map((g) => g.g_gudang_code))];
    }

    // 3. GET DELIVERY ORDERS FROM SAP
    const deliveryUrl =
        `${baseUrl}/sap/zdgt_in/delivery-orders?${params.toString()}`;

    const deliveryBody = JSON.stringify(deliveryOrderBodyTemp);

    const deliveryOptions = {
        method: "POST",
        headers: {
            "Authorization": `Basic ${basicAuth}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-CSRF-Token": tokenResult.csrfToken,
            "Cookie": tokenResult.cookie,
            "Content-Length": Buffer.byteLength(deliveryBody)
        },
        agent: agent
    };


    const deliveryResult = await new Promise(
        (resolve, reject) => {

            const request = https.request(
                deliveryUrl,
                deliveryOptions,
                (response) => {

                    let responseBody = "";

                    response.on("data", (chunk) => {
                        responseBody += chunk;
                    });

                    response.on("end", () => {

                        resolve({
                            status: response.statusCode,
                            body: responseBody
                        });

                    });

                }
            );

            request.on("error", reject);

            request.write(deliveryBody);
            request.end();

        }
    );



    // 4. PARSE RESPONSE
    let deliveryData = deliveryResult.body;

    try {
        deliveryData = JSON.parse(deliveryResult.body);
    } catch (e) {
        // response bukan JSON
    }



    // 5. VALIDATE DELIVERY RESPONSE
    if (
        deliveryResult.status < 200 ||
        deliveryResult.status >= 300
    ) {

        result.data = {
            success: false,
            message: "Failed to get delivery orders",
            status: deliveryResult.status,
            data: deliveryData
        };

        complete();
        return;
    }


    if (!Array.isArray(deliveryData)) {

        result.data = {
            success: false,
            message: "Invalid delivery response format",
            data: deliveryData
        };

        complete();
        return;
    }


    // 6. GET TEMP DATA + MASTER STATUS
    const [
        tempData,
        statusList,
        delivered
    ] = await Promise.all([

        // Hanya ambil TEMP berdasarkan vendor
        entities.pot_kurir_delivery_temp.find({
            where: {
                vendor_code: vendor_code
            }
        }),

        // Ambil semua master status
        entities.pot_master_order_status.find(),

        // Hanya ambil delivered berdasarkan vendor
        entities.pot_kurir_selesai_pengiriman.find({
            where: {
                vendor_code: vendor_code
            }
        })

    ]);


    // VALIDASI STATUS SHIPPED
    const shippedStatus = statusList.find(
        status => status.status_code === "SHIPPED"
    );

    if (!shippedStatus) {

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
    const statusCodeToId = {};
    const statusByIdMap = {};

    statusList.forEach(status => {
        statusCodeToId[status.status_code] = status.id;
        statusByIdMap[status.id] = status;
    });


 
    // 7. CREATE LIST DO FROM SAP
    const sapDoNumbers = new Set(
        deliveryData.map((item) =>
            String(item.doNumber)
        )
    );



    // 8. CEK TEMP YANG SUDAH TIDAK ADA DI SAP
    const tempToDelete = tempData.filter((temp) => {

        const doNumber = String(temp.do_number);

        return !sapDoNumbers.has(doNumber);

    });

 

    // 9. ROLLBACK TEMP YANG DO-NYA TIDAK ADA DI SAP
    let po_list = []

    for (const temp of tempToDelete) {

        const doNumber = temp.do_number;


   
        // 9.1 HAPUS TEMP
        await entities.pot_kurir_delivery_temp.delete(
            temp.id
        );


      
        // 9.2 CARI DELIVERY PROCESS
        const deliveryProcessList =
            await entities.pot_po_delivery_process.find({
                where: {
                    do: doNumber
                }
            });


        // Kalau Delivery Process tidak ada
        // cukup lanjut ke temp berikutnya
        if (
            !deliveryProcessList ||
            deliveryProcessList.length === 0
        ) {
            continue;
        }


        // 9.3 LOOP DELIVERY PROCESS
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


            // HAPUS HISTORY SHIPPED
            await entities.pot_po_history_status.delete({
                po_delivery_process_id: deliveryProcess.id,
                status_id: shippedStatus.id
            });


            // AMBIL HISTORY TERAKHIR
            const lastHistory = await entities.pot_po_history_status
                .createQueryBuilder("history")
                .join(
                    "pot_master_order_status",
                    "status",
                    "status.id = history.status_id"
                )
                .select([
                    "history.id AS id",
                    "history.status_id AS status_id",
                    "history.status_date AS status_date",
                    "status.sequence AS sequence"
                ])
                .where(
                    "history.po_delivery_process_id = :deliveryProcessId",
                    {
                        deliveryProcessId: deliveryProcess.id
                    }
                )
                .orderBy(
                    "status.sequence",
                    "DESC"
                )
                .getRawOne();


  
            // UPDATE DELIVERY PROCESS
            // Kalau masih ada history sebelumnya
            if (lastHistory) {

                await entities.pot_po_delivery_process.update(
                    {
                        id: deliveryProcess.id
                    },
                    {
                        order_status_id:
                            lastHistory.status_id,

                        shipment_date: null
                    }
                );

            } else {

                // Kalau history sebelumnya tidak ada, kosongkan shipment date.
                await entities.pot_po_delivery_process.update(
                    {
                        id: deliveryProcess.id
                    },
                    {
                        shipment_date: null
                    }
                );

            }

        }

    }


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



    // 10. CREATE TEMP MAP
    // Hanya TEMP yang DO-nya masih ada di SAP 
    const validTempData = tempData.filter((temp) => {

        const doNumber =
            String(temp.do_number);

        return sapDoNumbers.has(doNumber);

    });


    const tempMap = new Map();

    validTempData.forEach((temp) => {

        tempMap.set(
            String(temp.do_number),
            temp
        );

    });


    // =====================================================
    // 11. MAPPING DELIVERY DATA
    // =====================================================
    const delivery_list = [];

    for (const item of deliveryData) {

        const isDelivered = delivered.some(
            (element) =>
                String(element.no_delivery_note) ===
                String(item.doNumber)
        );

        // Sudah delivered → jangan tampilkan
        if (isDelivered) {
            continue;
        }

        const doNumber = String(item.doNumber);
        const temp = tempMap.get(doNumber);

        // Sudah diproses / ada di temp
        if (temp) {

            delivery_list.push({
                do_number: item.doNumber,
                so_number: temp.so_number ?? item.soNumber,
                tujuan: temp.sold_to ?? item.soldTo,
                tanggal_pengiriman:
                    temp.shipment_date
                        ? FormatTanggal(temp.shipment_date)
                        : FormatTanggal(item.shipmentDate),
                status: "Shipped"
            });

            continue;
        }

        // Belum diproses
        delivery_list.push({
            do_number: item.doNumber,
            so_number: item.soNumber,
            tujuan: item.soldTo,
            tanggal_pengiriman: FormatTanggal(item.shipmentDate),
            status: "Ready at Warehouse"
        });
    }

    result.data = {
        success: true,
        message: "Berhasil mengambil data delivery orders",
        data: delivery_list
    };
    complete();
    return;

} catch (error) {


    result.data = {
        success: false,
        message: "Failed to get delivery orders",
        data: error.message
    };

    complete();
    return;
}



function FormatTanggal(dateString) {

    if (!dateString) return "";

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

    const date = new Date(dateString);

    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = bulan[date.getUTCMonth()];
    const year = date.getUTCFullYear();

    return `${day} ${month} ${year}`;
}