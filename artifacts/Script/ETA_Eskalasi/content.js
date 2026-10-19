const body = req.body || {};

const poNumber = body.poNumber; // identifier untuk filter data historical yang relevan

try {

    // Validasi input
    if (!poNumber) {
        result.data = {
            success: false,
            message: "Parameter poNumber wajib diisi.",
        };
        complete();
        return;
    }

    // ===== Ambil seluruh riwayat historical untuk PO ini, urut berdasarkan timestamp =====
    const historicalList = await entities.historical_sourcing_pr.find({
        where: {
            po_number: poNumber,
        },
        order: {
            timestamp_data: "ASC",
        },
    });

    // ===== Cek data dengan action "Menerima Invoice" ATAU tcode_sap "MIGO 107" =====
    const dataMIGO107 = historicalList.find(
        (item) => item.action === "Menerima Invoice" || item.tcode_sap === "MIGO 107"
    );

    // Cek apakah data ditemukan DAN timestamp_data-nya terisi (bukan null/kosong)
    const isEmpty = (val) => val === undefined || val === null || val === "";

    const hasValidTimestamp = dataMIGO107 && !isEmpty(dataMIGO107.timestamp_data);

    const etaStatus = hasValidTimestamp ? "ETA dalam proses perhitungan" : "TBA";

    result.data = {
        success: true,
        message: "Get ETA status successfully",
        poNumber: poNumber,
        etaStatus: etaStatus,
        historical: historicalList,
    };

}
catch (error) {
    result.data = {
        success: false,
        message: error.message,
    };
}

complete();