const body = req.body || {};

// const body = {
//     startDate: "2026-08-08",
//     plant: "JKT"
// };

const startDateInput = body.startDate; // format: "YYYY-MM-DD"
const plant = body.plant;

/**
 * Tambah working days ke sebuah tanggal (skip Sabtu & Minggu)
 * @param {Date} date - tanggal awal
 * @param {number} days - jumlah hari kerja yang ditambahkan
 * @returns {Date}
 */
function addWorkingDays(date, days) {
    const result = new Date(date);
    let addedDays = 0;

    while (addedDays < days) {
        result.setDate(result.getDate() + 1);

        const dayOfWeek = result.getDay(); // 0 = Minggu, 6 = Sabtu

        // Skip kalau Sabtu (6) atau Minggu (0)
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            addedDays++;
        }
    }

    return result;
}

/**
 * Format Date jadi string "YYYY-MM-DD"
 */
function formatDate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

try {
    // Validasi input
    if (!startDateInput) {
        result.data = {
            success: false,
            message: "Parameter startDate wajib diisi.",
        };
        complete();
        console.log(JSON.stringify(result));
        return;
    }

    if (!plant) {
        result.data = {
            success: false,
            message: "Parameter plant wajib diisi.",
        };
        complete();
        console.log(JSON.stringify(result));
        return;
    }

    const startDate = new Date(startDateInput);


    //Validasi startdate apakah sudah sesuai formtanya
    if (isNaN(startDate.getTime())) {
        result.data = {
            success: false,
            message: "Format startDate tidak valid."
        };

        console.log(JSON.stringify(result));
        complete();
        return;
    }

    /// ===== 1. Ambil semua data secara paralel =====
    const [
        dataTP,
        dataLTBilling,
        dataLTDelivery
    ] = await Promise.all([
        entities.pot_eta_lead_time_tp.findOne({
            where: {
                Plant: plant
            }
        }),

        entities.pot_eta_lead_time_general.findOne({
            where: {
                lead_time: "LT Billing"
            }
        }),

        entities.pot_eta_lead_time_general.findOne({
            where: {
                lead_time: "LT Delivery"
            }
        })
    ]);

    // ===== 2. Validasi data hasil query=====
    if (!dataTP) {
        result.data = {
            success: false,
            message: `Data ETA Matrix TP untuk plant "${plant}" tidak ditemukan.`,
        };

        console.log(JSON.stringify(result));
        complete();
        return;
    }
    const ltBillingDays = dataLTBilling?.total_days ?? 0;
    const ltDeliveryDays = dataLTDelivery?.total_days ?? 0;

    // ===== 3. Hitung ETA step by step berdasarkan working days =====

    //Formula ETA TP : ETA#1 TP = TP Date + LTM TP + LT Billing + LT Delivery

    // Step 1: Create TP - Check Stock
    const createTPCheckStockDays = dataTP.CreateTP_CheckStock ?? 0;
    const dateCreateTPCheckStock = addWorkingDays(startDate, createTPCheckStockDays);

    // Step 2: LT Billing (dihitung dari tanggal sebelumnya)
    const dateLTBilling = addWorkingDays(dateCreateTPCheckStock, ltBillingDays);

    // Step 3: LT Delivery (dihitung dari tanggal sebelumnya)
    const dateLTDelivery = addWorkingDays(dateLTBilling, ltDeliveryDays);


    // ===== 4. Susun hasil breakdown per tahap =====
    const breakdown = [
        {
            step: "Start Date",
            days: 0,
            date: formatDate(startDate),
        },
        {
            step: "Create TP - Check Stock",
            days: createTPCheckStockDays,
            date: formatDate(dateCreateTPCheckStock),
        },
        {
            step: "LT Billing",
            days: ltBillingDays,
            date: formatDate(dateLTBilling),
        },
        {
            step: "LT Delivery",
            days: ltDeliveryDays,
            date: formatDate(dateLTDelivery),
        },
    ];

    console.log(JSON.stringify(breakdown));



    // ===== 5. Hasil akhir perhitungan seluruh ETA TP =====
    result.data = {
        success: true,
        message: "ETA#1 TP berhasil dihitung.",
        plant: plant,
        startDate: formatDate(startDate),
        estimatedArrival: formatDate(dateLTDelivery),
        breakdown : breakdown,
    };

    console.log(JSON.stringify(result));

}
catch (error) {
    result.data = {
        success: false,
        message: error.message,
    };
    
     console.log(JSON.stringify(result));

}

complete();