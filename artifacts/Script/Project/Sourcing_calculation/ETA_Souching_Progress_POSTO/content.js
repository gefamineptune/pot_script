const body = req.body || {};

// const body = {
//   "startDate": "2026-08-11",
//   "fromPlant": "MLG",
//   "toPlant": "CIV",
//   "moda": "Fuso",
//   "modaDefault": "N",
//   "etaType": "ETA1" // atau "ETA2"
// };

const startDateInput = body.startDate; // format: "YYYY-MM-DD"
const fromPlant = body.fromPlant;
const toPlant = body.toPlant;
const moda = body.moda;
const modaDefault = body.modaDefault;
const etaType = (body.etaType || "ETA1").toUpperCase(); // default ETA1

/**
 * Tambah working days ke sebuah tanggal (skip Sabtu & Minggu)
 */
function addWorkingDays(date, days) {
    const result = new Date(date);
    let addedDays = 0;

    while (addedDays < days) {
        result.setDate(result.getDate() + 1);

        const dayOfWeek = result.getDay(); // 0 = Minggu, 6 = Sabtu

        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            addedDays++;
        }
    }

    return result;
}

/**
 * Tambah calendar days ke sebuah tanggal (TIDAK skip Sabtu & Minggu)
 */
function addCalendarDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
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
        result.data = { success: false, message: "Parameter startDate wajib diisi." };
        complete();
        console.log(JSON.stringify(result));
        return;
    }

    if (!fromPlant || !toPlant) {
        result.data = { success: false, message: "Parameter fromPlant dan toPlant wajib diisi." };
        complete();
        console.log(JSON.stringify(result));
        return;
    }

    if (etaType !== "ETA1" && etaType !== "ETA2") {
        result.data = { success: false, message: "Parameter etaType harus bernilai 'ETA1' atau 'ETA2'." };
        complete();
        console.log(JSON.stringify(result));
        return;
    }

    const startDate = new Date(startDateInput);

    // ===== 1. Ambil data dari pot_eta_lead_time_po_sto berdasarkan From Plant & To Plant =====
    const whereCondition = {
        from_plant: fromPlant,
        to_plant: toPlant,
    };

    if (moda) {
        whereCondition.moda = moda;
    }

    // ===== 2. Ambil semua data secara paralel =====
    const [
        dataPOSTO,
        dataLTBilling,
        dataLTDelivery
    ] = await Promise.all([
        entities.pot_eta_lead_time_po_sto.findOne({
            where: whereCondition,
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

    // ===== 3. Validasi data hasil query =====
    if (!dataPOSTO) {
        result.data = {
            success: false,
            message: `Data ETA Matrix PO STO untuk rute "${fromPlant}" - "${toPlant}" tidak ditemukan.`,
        };
        complete();
        console.log(JSON.stringify(result));
        return;
    }

    const ltBillingDays = dataLTBilling?.total_days ?? 0;
    const ltDeliveryDays = dataLTDelivery?.total_days ?? 0;

    // ===== 4. Hitung breakdown sesuai etaType =====
    const breakdown = [];
    let currentDate = new Date(startDate);

    if (etaType === "ETA1") {

        // ===== ETA#1 = POSTO Date + LTM POSTO (7 tahap) + LT Billing + LT Delivery =====
        breakdown.push({
            step: "Start Date (PO STO Date)",
            type: "-",
            days: 0,
            date: formatDate(currentDate),
        });

        // Tahap 1: PO STO Date - TO POSTO (working days)
        currentDate = addWorkingDays(currentDate, dataPOSTO.po_sto_to_po_sto ?? 0);
        breakdown.push({
            step: "TO POSTO",
            type: "Working Days",
            days: dataPOSTO.po_sto_to_po_sto ?? 0,
            date: formatDate(currentDate),
        });

        // Tahap 2: TO POSTO - TO Out Confirm (working days)
        currentDate = addWorkingDays(currentDate, dataPOSTO.po_sto_to_out_confirm ?? 0);
        breakdown.push({
            step: "TO Out Confirm",
            type: "Working Days",
            days: dataPOSTO.po_sto_to_out_confirm ?? 0,
            date: formatDate(currentDate),
        });

        // Tahap 3: TO Out Confirm - Create SPB (working days)
        currentDate = addWorkingDays(currentDate, dataPOSTO.out_confirm_to_create_spb ?? 0);
        breakdown.push({
            step: "Create SPB",
            type: "Working Days",
            days: dataPOSTO.out_confirm_to_create_spb ?? 0,
            date: formatDate(currentDate),
        });

    } else if (etaType === "ETA2") {

        // ===== ETA#2 = SPB Created Date + [Create SPB - GI] + [Tgl Kirim - Tgl MIGO101] + [TglMIGO101 - ConfirmTOIn] + [ConfirmTOIn - TOConfirm UU/Block] + LT Billing + LT Delivery =====
        breakdown.push({
            step: "Start Date (SPB Created Date)",
            type: "-",
            days: 0,
            date: formatDate(currentDate),
        });
        // ETA2 mulai langsung dari step "Create SPB - GI", 3 tahap awal (TO POSTO, TO Out Confirm, Create SPB) di-skip
        // karena starting point-nya sudah di tanggal SPB dibuat.
    }

    // ===== Tahap bersama (dipakai baik ETA1 maupun ETA2) =====

    // Tahap: Create SPB - GI (working days)
    currentDate = addWorkingDays(currentDate, dataPOSTO.create_spb_to_gi ?? 0);
    breakdown.push({
        step: "GI (Tgl Kirim)",
        type: "Working Days",
        days: dataPOSTO.create_spb_to_gi ?? 0,
        date: formatDate(currentDate),
    });

    // Tahap: GI (Tgl Kirim) - GR (Tgl MIGO 101) -> CALENDAR DAYS
    currentDate = addCalendarDays(currentDate, dataPOSTO.gi_to_gr ?? 0);
    breakdown.push({
        step: "GR (Tgl MIGO 101)",
        type: "Calendar Days",
        days: dataPOSTO.gi_to_gr ?? 0,
        date: formatDate(currentDate),
    });

    // Tahap: GR (Tgl MIGO 101) - TO In Confirm (working days)
    currentDate = addWorkingDays(currentDate, dataPOSTO.gr_to_in_confirm ?? 0);
    breakdown.push({
        step: "TO In Confirm",
        type: "Working Days",
        days: dataPOSTO.gr_to_in_confirm ?? 0,
        date: formatDate(currentDate),
    });

    // Tahap: Confirm TO In - TO Confirm UU/Block (working days)
    currentDate = addWorkingDays(currentDate, dataPOSTO.in_confirm_to_confirm_uu ?? 0);
    breakdown.push({
        step: "TO Confirm UU/Block",
        type: "Working Days",
        days: dataPOSTO.in_confirm_to_confirm_uu ?? 0,
        date: formatDate(currentDate),
    });

    // Tahap: LT Billing (working days)
    currentDate = addWorkingDays(currentDate, ltBillingDays);
    breakdown.push({
        step: "LT Billing",
        type: "Working Days",
        days: ltBillingDays,
        date: formatDate(currentDate),
    });

    // Tahap: LT Delivery (working days)
    currentDate = addWorkingDays(currentDate, ltDeliveryDays);
    breakdown.push({
        step: "LT Delivery",
        type: "Working Days",
        days: ltDeliveryDays,
        date: formatDate(currentDate),
    });

    // ===== 5. Hasil akhir =====
    result.data = {
        success: true,
        message: `${etaType} PO STO berhasil dihitung.`,
        etaType: etaType,
        fromPlant: fromPlant,
        toPlant: toPlant,
        moda: moda ?? "",
        modaDefault: modaDefault ?? "",
        startDate: formatDate(startDate),
        estimatedArrival: formatDate(currentDate),
        breakdown: breakdown,
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