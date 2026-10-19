const body = req.body;
const { In } = operators;
const now = Date.now();

const no_delivery_note = body?.no_delivery_note ?? "";
const so_number = body?.so_number ?? "";
const nama_kurir = body?.nama_kurir ?? "";
const nama_penerima = body?.nama_penerima ?? "";
const jabatan_penerima = body?.jabatan_penerima ?? "";
const shipment_location = body?.shipment_location ?? "";
const shipment_date = body?.shipment_date ?? "";
const sold_to = body?.sold_to ?? "";
const sold_date = body?.sold_date ?? new Date().toISOString();
const vendor_name = body?.vendor_name ?? "";
const vendor_code = body?.vendor_code ?? "";
const po_id = body?.po_id ?? "";
const alamat_pengiriman = body?.alamat_pengiriman ?? "";
const no_spb = body?.no_spb ?? "";
const no_po = body?.no_po ?? "";
const by = body?.bby ?? "User";

// ----------------------------------------------------
// CONFIG
// ----------------------------------------------------
const STATUS = {
    PO_RECEIVED: "PO_RECEIVED",
    PROCESSING: "PROCESSING",
    READY_AT_WAREHOUSE: "READY_AT_WAREHOUSE",
    SHIPPED: "SHIPPED",
    DELIVERED: "DELIVERED",
};

const SOURCING = { PR: "PR", PO_STO: "PO STO", TP: "TP" };

const ETA_TYPE = {
    ETA1_PR: "ETA1_PR",
    ETA2_PR: "ETA2_PR",
    ETA3_PR: "ETA3_PR",
    ETA1_PO_STO: "ETA1_PO_STO",
    ETA2_PO_STO: "ETA2_PO_STO",
    ETA_TP: "ETA_TP",
    ETA_BILLING: "ETA_BILLING",
    TBA: "TBA",
    NULL: "NULL",
};

// function untuk extract token
function extractToken(authorizationHeader) {
    if (!authorizationHeader) {
        return null;
    }

    const parts = authorizationHeader.split(" ");

    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
        return null;
    }

    return parts[1];
}

try {
    const https = modules.https;
    const jwt = modules.jsonwebtoken;

    // JWT CONFIG
    const JWT_CONFIG = {
        algorithm: "HS256",
        secret: await vault.decrypt("JWT-SIGNING-SECRET"),
        issuer: "neptune-dxp-app",
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
        console.log(result);
        complete();
        return;
    }

    // VERIFY JWT
    let payload;

    try {
        payload = jwt.verify(token, JWT_CONFIG.secret, {
            algorithms: [JWT_CONFIG.algorithm],
            issuer: JWT_CONFIG.issuer,
        });
    } catch (error) {
        result.status = 401;
        result.data = {
            success: false,
            message: error.name === "TokenExpiredError" ? "Token has expired" : "Invalid token",
        };

        complete();
        return;
    }

    // TOKEN VALID
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
    // Get Order Status
    // --------------------------------------------------
    const statusList = await entities.pot_master_order_status.find();
    const statusCodeToId = {};
    const statusByIdMap = {};
    statusList.forEach((status) => {
        statusCodeToId[status.status_code] = status.id;
        statusByIdMap[status.id] = status;
    });

    const insertedData = await entities.pot_kurir_selesai_pengiriman
        .createQueryBuilder()
        .insert()
        .values({
            no_delivery_note: no_delivery_note,
            so_number: so_number,
            nama_kurir: nama_kurir,
            nama_penerima: nama_penerima,
            jabatan_penerima: jabatan_penerima,
            shipment_location: shipment_location,
            shipment_date: shipment_date,
            sold_to: sold_to,
            sold_date: sold_date,
            vendor_name: vendor_name,
            vendor_code: vendor_code,
            po_id: po_id,
            alamat_pengiriman: alamat_pengiriman,
            no_spb: no_spb,
            no_po: no_po,
            createdBy: by,
            updatedBy: by,
        })
        .execute();

    const insertedId = insertedData.identifiers[0].id;

    const getMasterOrderStatus = await entities.pot_master_order_status
        .createQueryBuilder("mos")
        .where("mos.status_name = :statName", { statName: "Delivered" })
        .getOne();

    const getPODeliveryProcess = await entities.pot_po_delivery_process
        .createQueryBuilder()
        .where("do = :doNumber", { doNumber: no_delivery_note })
        .getMany();

    // loop update delivery and history status
    for (const item of getPODeliveryProcess) {
        // Update Delivery Process
        await entities.pot_po_delivery_process
            .createQueryBuilder()
            .update()
            .set({
                qty_supply: item.delivery_quantity,
                receive_date: sold_date,
                order_status_id: getMasterOrderStatus.id, // "9656948B-C79A-F111-B88F-0050568C835B",
                customer_receive_date: sold_date,
                customer_receive_name: nama_penerima,
                updatedBy: by,
            })
            .where("id = :id", { id: item.id })
            .execute();

        // Update History Status
        const existingHistory = await entities.pot_po_history_status.findOne({
            where: { po_delivery_process_id: item.id, status_id: getMasterOrderStatus.id },
        });

        const historyPayload = {
            status_date: sold_date || null,
        };

        if (!existingHistory) {
            // INSERT HISTORY
            historyPayload.po_delivery_process_id = item.id;
            historyPayload.status_id = getMasterOrderStatus.id;
            historyPayload.createdBy = by;
            historyPayload.createdAt = now;
            historyPayload.updatedBy = by;
            historyPayload.updatedAt = now;
            await entities.pot_po_history_status
                .createQueryBuilder()
                .insert()
                .values(historyPayload)
                .execute();
        } else {
            // UPDATE HISTORY
            historyPayload.updatedBy = by;
            historyPayload.updatedAt = now;
            await entities.pot_po_history_status
                .createQueryBuilder()
                .update()
                .set(historyPayload)
                .where("id = :id", { id: existingHistory.id })
                .execute();
        }
    }

    await entities.pot_kurir_delivery_temp
        .createQueryBuilder()
        .delete()
        .where("do_number = :doNumber", { doNumber: no_delivery_note })
        .execute();

    const poItemId = getPODeliveryProcess.map((p) => p.po_item_id);

    const getListPOId = await findInChunks(entities.pot_po_item, "id", poItemId);

    const listPOId = getListPOId.map((p) => p.po_id);

    try {
        // --------------------------------------------------
        // RE-CALCULATE PO STATUS berdasarkan final status dari table internal dan delivery process
        //
        // 1. Hitung Total Qty Sourcing (SUM qty_sourcing dari SEMUA Internal Process dalam 1 PO).
        // 2. Bandingkan dengan Qty Order di Level PO (po.qty_order).
        // 3. Jika Total Sourcing < Qty Order PO -> Status PO Max PROCESSING.
        // 4. Jika Total Sourcing = Qty Order PO -> Status PO = Min Sequence / Terendah dari Delivery Process.
        // --------------------------------------------------
        // STEP 1: Ambil semua PO (otomatis di-chunk)
        const pos = await findInChunks(entities.pot_po, "id", listPOId);
        const poIds = pos.map((p) => p.id);

        // STEP 2: Ambil semua item PO (otomatis di-chunk)
        const items = await findInChunks(entities.pot_po_item, "po_id", poIds);
        const itemIds = items.map((i) => i.id);

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
        for (const po of pos) {
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
        for (const po of pos) {
            const calc = poCalcMap[po.id];
            let finalStatusIdForPo = null;

            // LOGIKA UTAMA STATUS PO
            if (!calc.allNonHeadItemsSourced) {
                // Jika ADA item yang belum lengkap sourcing-nya -> Paksa Status PROCESSING
                finalStatusIdForPo = statusCodeToId[STATUS.PROCESSING];
            } else {
                // Jika SEMUA item sudah lengkap sourcing-nya -> Ikuti Status Delivery Terendah
                if (calc.minStatusId) {
                    finalStatusIdForPo = calc.minStatusId;
                } else {
                    // Semua item sourcing lengkap, tapi belum ada delivery process sama sekali
                    finalStatusIdForPo = statusCodeToId[STATUS.PROCESSING];
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

        // --------------------------------------------------
        // BAGIAN B: RE-CALCULATE QTY SUPPLY & PROGRESS SUPPLY
        // --------------------------------------------------

        // STEP 1: Hitung qty_supply per item berdasarkan delivery processes yang valid
        const qtySupplyByItemId = {};

        // Initialize dengan 0 untuk semua items
        for (const item of items) {
            qtySupplyByItemId[item.id] = 0;
        }

        // Accumulate dari delivery processes
        for (const delProc of deliveryProcs) {
            if (!delProc.po_item_id) continue;

            // Tambahkan ke qty_supply item
            const delQty = Number(delProc.qty_supply || 0);
            if (qtySupplyByItemId.hasOwnProperty(delProc.po_item_id)) {
                qtySupplyByItemId[delProc.po_item_id] += delQty;
            }
        }

        // STEP 2: Update qty_supply di setiap PO Item
        for (const item of items) {
            const calculatedQtySupply = qtySupplyByItemId[item.id] || 0;

            // Update hanya jika berbeda
            if (calculatedQtySupply !== Number(item.qty_supply || 0)) {
                await entities.pot_po_item.createQueryBuilder()
                    .update()
                    .set({ 
                        qty_supply: calculatedQtySupply,
                        updatedBy: (req.user && req.user.username) || "system",
                        updatedAt: Date.now()
                    })
                    .where("id = :id", { id: item.id })
                    .execute();
            }
        }

        // STEP 3: Re-calculate qty_supply dan progress_supply di PO level
        // PENTING: Hanya menjumlahkan dari ROOT ITEMS (Item tanpa higher level item)

        // Filter Root Items terlebih dahulu - Item yang tidak memiliki higher level item
        const rootItems = items.filter(item => {
            return Number(item.sales_item_higher_level_item) === 0;
        });

        // Group items by po_id dan sum qty_supply
        const qtySupplyByPoId = {};

        // Gunakan calculated value dari qtySupplyByItemId, bukan dari DB (stale data)
        for (const item of rootItems) {
            const poId = item.po_id;

            if (!qtySupplyByPoId[poId]) {
                qtySupplyByPoId[poId] = 0;
            }

            // Gunakan calculated value yang sudah di-update
            qtySupplyByPoId[poId] += qtySupplyByItemId[item.id] || 0;
        }

        // STEP 4: Update PO dengan qty_supply dan progress_supply yang baru
        for (const po of pos) {
            const calculatedQtySupply = qtySupplyByPoId[po.id] || 0;
            const totalQtyOrder = Number(po.qty_order || 0);

            // Hitung progress supply (percentage)
            let progressSupply = 0;
            if (totalQtyOrder > 0) {
                progressSupply = Math.round((calculatedQtySupply / totalQtyOrder) * 100);
                if (progressSupply > 100) progressSupply = 100; // Cap di 100%
            }

            // Update hanya jika berbeda
            if (
                calculatedQtySupply !== Number(po.qty_supply || 0) || 
                progressSupply !== Number(po.progress_supply || 0)
            ) {
                await entities.pot_po.createQueryBuilder()
                    .update()
                    .set({ 
                        qty_supply: calculatedQtySupply,
                        progress_supply: progressSupply,
                        updatedBy: (req.user && req.user.username) || "system",
                        updatedAt: Date.now()
                    })
                    .where("id = :id", { id: po.id })
                    .execute();
            }
        }

        result.data = {
            success: true,
            message: "Success save kurir selesai kirim",
            data : {
                id : insertedId
            }
        };
        console.log(result);
        complete();
    } catch (error) {
        result.data = {
            success: false,
            message: "Failed save kurir selesai pengiriman",
            data: error.message,
        };
        console.log(result);
        complete();
    }
} catch (error) {
    result.data = {
        success: false,
        message: "Failed save kurir selesai pengiriman",
        data: error.message,
    };
    console.log(result);
    complete();
}
