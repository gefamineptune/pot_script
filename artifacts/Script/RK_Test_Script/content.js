// let listAuditTrailId = [];

// const getPODel_Proc = await entities.pot_po_delivery_process.createQueryBuilder("dp").getMany();

// for (const item of getPODel_Proc) {
//     const getSelesaiKirim = await entities.pot_kurir_selesai_pengiriman
//         .createQueryBuilder("sp")
//         .where("sp.no_delivery_note = :do", { do: item.do })
//         .getOne() || {};

//     const insertedItem = await entities.pot_audit_trail_selesai_pengiriman
//         .createQueryBuilder()
//         .insert()
//         .values({
//             po_item_id: item.po_item_id,
//             so_number: item.so_number,
//             so_item: item.so_item,
//             do: item.do,
//             spb: getSelesaiKirim.no_spb,
//             shipment_date: getSelesaiKirim.shipment_date,
//             qty_supply: item.qty_supply,
//             receive_date: item.receive_date,
//             delivery_note: item.delivery_note,
//             order_status_id: item.order_status_id,
//             sales_item_description: item.sales_item_description,
//             superodinate: item.superodinate,
//             superodinate_description: item.superodinate_description,
//             requested_delivery_date: item.requested_delivery_date,
//             restricted_notes: item.restricted_notes,
//             net_price: item.net_price,
//             net_value: item.net_value,
//             currency: item.currency,
//             amount_item: item.amount_item,
//             qty_invoiced_lm: item.qty_invoiced_lm,
//             qty_invoiced_tm: item.qty_invoiced_tm,
//             qty_ready: item.qty_ready,
//             qty_transfer_tm: item.qty_transfer_tm,
//             qty_transfer_nm: item.qty_transfer_nm,
//             qty_indent_tm: item.qty_indent_tm,
//             qty_indent_nm: item.qty_indent_nm,
//             qty_os: item.qty_os,
//             amt_invoiced_lm: item.amt_invoiced_lm,
//             amt_invoiced_tm: item.amt_invoiced_tm,
//             amt_ready: item.amt_ready,
//             amt_transfer_tm: item.amt_transfer_tm,
//             amt_transfer_nm: item.amt_transfer_nm,
//             amt_indent_tm: item.amt_indent_tm,
//             amt_indent_nm: item.amt_indent_nm,
//             amt_os: item.amt_os,
//             delivery_no: item.delivery_no,
//             delivery_type: item.delivery_type,
//             delivery_item: item.delivery_item,
//             delivery_date: item.delivery_date,
//             delivery_quantity: item.delivery_quantity,
//             create_to_date: item.create_to_date,
//             confirm_to_out_date: item.confirm_to_out_date,
//             spb_number: item.spb_number,
//             spb_created_date: item.spb_created_date,
//             gi_number: item.gi_number,
//             gi_date: item.gi_date,
//             shipment_cost_number: item.shipment_cost_number,
//             shipment_cost_date: item.shipment_cost_date,
//             expedition_pickup_date: item.expedition_pickup_date,
//             invoice_no: item.invoice_no,
//             invoice_quantity: item.invoice_quantity,
//             invoice_date: item.invoice_date,
//             customer_po_date: item.customer_po_date,
//             customer_receive_date: getSelesaiKirim.sold_date,
//             customer_receive_name: getSelesaiKirim.nama_penerima,
//             do_spb_return_date: item.do_spb_return_date,
//             aging_so: item.aging_so,
//             partial_delivery: item.partial_delivery,
//             eta_type: item.eta_type,
//             eta_customer_received: item.eta_customer_received,
//             no_po: getSelesaiKirim.no_po || "",
//             sold_to: getSelesaiKirim.sold_to || "",
//             alamat_pengiriman: getSelesaiKirim.alamat_pengiriman || "",
//             shipment_location: getSelesaiKirim.shipment_location || "",
//             nama_kurir: getSelesaiKirim.nama_kurir || "",
//             jabatan_penerima: getSelesaiKirim.jabatan_penerima || "",
//             vendor_name: getSelesaiKirim.vendor_name || "",
//             vendor_code: getSelesaiKirim.vendor_code || "",
//             createdBy: "User",
//             updatedBy: "User",
//         })
//         .execute();

//     console.log(insertedItem);
//     listAuditTrailId.push(insertedItem.identifiers[0].id)
// }

// console.log(listAuditTrailId);

const getEkspedisi_Gudang = await entities.pot_ekspedisi
    .createQueryBuilder("e")
    .where("e.vendor_code = :ven_code", { ven_code: "3111111436" })
    .leftJoinAndSelect("pot_ekspedisi_gudang", "eg", "eg.ekspedisi_id = e.id")
    .leftJoinAndSelect("pot_master_gudang", "g", "eg.gudang_id = g.id")
    .getRawMany();

if(getEkspedisi_Gudang.length <= 0) {
    result = {
        success: false,
        message: "Vendor not found",
        data: [],
    };

    console.log(result);

    complete();
    return;
}

const resultListGudang = [...new Set(getEkspedisi_Gudang.map((g) => g.g_gudang_code))];

// console.log(getEkspedisi_Gudang);
console.log(resultListGudang);
complete();
