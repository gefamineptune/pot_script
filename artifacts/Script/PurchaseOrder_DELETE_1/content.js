// try {
//     const { In } = operators;

//     const TARGET_PO_NUMBERS = [
//         "PSP 25H 5066",
//     ];

//     // --------------------------------------------------
//     // 1. FIND PO BERDASARKAN HARDCODE PO NUMBER
//     // --------------------------------------------------
//     const purchaseOrders = await entities.pot_po.find({
//         select: {
//             id: true,
//             po_number: true
//         },
//         where: {
//             po_number: In(TARGET_PO_NUMBERS)
//         }
//     });

//     if (!purchaseOrders || purchaseOrders.length === 0) {
//         result.statusCode = 200;
//         result.data = {
//             success: true,
//             message: "Tidak ada Purchase Order untuk dihapus",
//             data: []
//         };
//         complete();
//         return;
//     }

//     const results = [];

//     // --------------------------------------------------
//     // 2. LOOP SETIAP PO UNTUK DIHAPUS BESERTA RELASINYA
//     // --------------------------------------------------
//     for (const po of purchaseOrders) {
//         const poNumber = po.po_number;
//         const purchaseOrderId = po.id;

//         try {
//             // --------------------------------------------------
//             // A. Find PO Items
//             // --------------------------------------------------
//             const purchaseOrderItems = await entities.pot_po_item.find({
//                 select: { id: true },
//                 where: { po_id: purchaseOrderId }
//             });
//             const itemIds = purchaseOrderItems.map(item => item.id);

//             let deletedInternalProcessHistory = 0;
//             let deletedInternalProcess = 0;
//             let deletedDeliveryProcessHistory = 0;
//             let deletedDeliveryProcess = 0;       
//             let deletedItems = 0;

//             if (itemIds.length > 0) {
//                 // --------------------------------------------------
//                 // A.1. Find Internal Process IDs (untuk dihapus history-nya)
//                 // --------------------------------------------------
//                 const internalProcesses = await entities.pot_po_internal_process
//                     .createQueryBuilder()
//                     .select("id")
//                     .where("po_item_id IN (:...ids)", { ids: itemIds })
//                     .getRawMany();
                
//                 const internalProcessIds = internalProcesses.map(ip => ip.id);

//                 // --------------------------------------------------
//                 // A.2. DELETE INTERNAL PROCESS HISTORY
//                 // --------------------------------------------------
//                 if (internalProcessIds.length > 0) {
//                     const deleteHistoryResult = await entities.pot_po_history_status
//                         .createQueryBuilder()
//                         .delete()
//                         .from("pot_po_history_status")
//                         .where("po_internal_process_id IN (:...ids)", { ids: internalProcessIds })
//                         .execute();
                    
//                     deletedInternalProcessHistory = deleteHistoryResult.affected || 0;
//                 }

//                 // --------------------------------------------------
//                 // A.3. DELETE INTERNAL PROCESS
//                 // --------------------------------------------------
//                 const deleteProcessResult = await entities.pot_po_internal_process
//                     .createQueryBuilder()
//                     .delete()
//                     .from("pot_po_internal_process")
//                     .where("po_item_id IN (:...ids)", { ids: itemIds })
//                     .execute();
                
//                 deletedInternalProcess = deleteProcessResult.affected || 0;

//                 // --------------------------------------------------
//                 // A.4. Find Delivery Process IDs (LEVEL ITEM)
//                 // --------------------------------------------------
//                 const deliveryProcesses = await entities.pot_po_delivery_process
//                     .createQueryBuilder()
//                     .select("id")
//                     .where("po_item_id IN (:...ids)", { ids: itemIds })
//                     .getRawMany();
                
//                 const deliveryProcessIds = deliveryProcesses.map(dp => dp.id);

//                 // --------------------------------------------------
//                 // A.5. DELETE DELIVERY PROCESS HISTORY
//                 // --------------------------------------------------
//                 if (deliveryProcessIds.length > 0) {
//                     const deleteDeliveryHistoryResult = await entities.pot_po_history_status
//                         .createQueryBuilder()
//                         .delete()
//                         .from("pot_po_history_status")
//                         .where("po_delivery_process_id IN (:...ids)", { ids: deliveryProcessIds })
//                         .execute();
                    
//                     deletedDeliveryProcessHistory = deleteDeliveryHistoryResult.affected || 0;
//                 }

//                 // --------------------------------------------------
//                 // A.6. DELETE DELIVERY PROCESS
//                 // --------------------------------------------------
//                 const deleteDeliveryResult = await entities.pot_po_delivery_process
//                     .createQueryBuilder()
//                     .delete()
//                     .from("pot_po_delivery_process")
//                     .where("po_item_id IN (:...ids)", { ids: itemIds })
//                     .execute();
                
//                 deletedDeliveryProcess = deleteDeliveryResult.affected || 0;
//             }

//             // --------------------------------------------------
//             // B. DELETE PURCHASE ORDER ITEMS
//             // --------------------------------------------------
//             const deleteItemResult = await entities.pot_po_item
//                 .createQueryBuilder()
//                 .delete()
//                 .from("pot_po_item")
//                 .where("po_id = :purchaseOrderId", { purchaseOrderId })
//                 .execute();
            
//             deletedItems = deleteItemResult.affected || 0;

//             // --------------------------------------------------
//             // C. DELETE PURCHASE ORDER
//             // --------------------------------------------------
//             const deletePOResult = await entities.pot_po
//                 .createQueryBuilder()
//                 .delete()
//                 .from("pot_po")
//                 .where("id = :id", { id: purchaseOrderId })
//                 .execute();

//             results.push({
//                 success: true,
//                 message: "Purchase Order dan seluruh relasinya berhasil dihapus",
//                 poNumber: poNumber,
//                 purchaseOrderId: purchaseOrderId,
//                 deletedInternalProcessHistory: deletedInternalProcessHistory,
//                 deletedInternalProcess: deletedInternalProcess,
//                 deletedDeliveryProcessHistory: deletedDeliveryProcessHistory, // <-- BARU
//                 deletedDeliveryProcess: deletedDeliveryProcess,               // <-- BARU
//                 deletedItems: deletedItems,
//                 deletedPurchaseOrder: deletePOResult.affected || 0
//             });

//         } catch (innerErr) {
//             log.error(`Gagal menghapus PO ${poNumber}:`, innerErr);
//             results.push({
//                 success: false,
//                 poNumber: poNumber,
//                 purchaseOrderId: purchaseOrderId,
//                 message: innerErr.message
//             });
//         }
//     }

//     console.log("Hasil Eksekusi Hapus Semua PO:", results);

//     // --------------------------------------------------
//     // 3. RESPONSE
//     // --------------------------------------------------
//     const anySuccess = results.some(r => r.success);
//     const successCount = results.filter(r => r.success).length;

//     result.statusCode = anySuccess ? 200 : 404;
//     result.data = {
//         success: anySuccess,
//         message: `${successCount} dari ${results.length} PO berhasil dihapus beserta item, internal process, delivery process, dan history-nya.`,
//         data: results
//     };

//     complete();
//     return;

// } catch (err) {
//     log.error("Fatal error dalam script hapus semua PO:", err);

//     result.statusCode = 500;
//     result.data = {
//         success: false,
//         message: "Gagal menghapus Purchase Order",
//         error: err.message
//     };

//     complete();
//     return;
// }