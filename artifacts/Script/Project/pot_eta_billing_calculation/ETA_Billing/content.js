// ETA Update Billing = Confirm TO Out Date + LT Billing + LT Delivery

const moment = modules.moment;
const { Equal, In } = operators;

function addDays(date, days, type) {

    let result = new Date(date);
    days = Number(days) || 0;

    // ============================
    // Calendar Days
    // ============================
    if (type === "calendar") {

        result.setDate(result.getDate() + days);

        // Jika hasil jatuh weekend,
        // geser ke weekday berikutnya
        while (result.getDay() === 0 || result.getDay() === 6) {
            result.setDate(result.getDate() + 1);
        }

        return result;
    }

    // ============================
    // Working Days
    // ============================
    if (type === "working") {

        let remainingDays = days;

        while (remainingDays > 0) {

            result.setDate(result.getDate() + 1);

            const day = result.getDay();

            // Senin - Jumat
            if (day !== 0 && day !== 6) {
                remainingDays--;
            }
        }

        return result;
    }

    throw new Error("Invalid day type: " + type);
}

try {

    // ============================
    // Request Body
    // ============================
    const body = req.body || {};
    const confirmToOutDate = body.confirmToOutDate || "2026-08-02T00:00:00Z";

    if (!confirmToOutDate) {
        result.statusCode = 400;
        result.data = {
            success: false,
            message: "Confirm TO Out Date is required",
        };

        complete();
        return;
    }

    // Validasi apakah value merupakan tanggal yang valid
    const parsedDate = Date.parse(confirmToOutDate);

    if (isNaN(parsedDate)) {
        result.statusCode = 400;
        result.data = {
            success: false,
            message: "Confirm TO Out Date must be a valid date",
        };

        complete();
        return;
    }

    // ============================
    // Get Lead Time
    // ============================
    const leadTimes = await entities.pot_eta_lead_time_general.find({
        select: {
            lead_time: true,
            total_days: true
        },
        where: {
            lead_time: In(["LT Billing", "LT Delivery"])
        }
    });

    const lt_billing = leadTimes.find(x => x.lead_time === "LT Billing")?.total_days || 0;
    const lt_delivery = leadTimes.find(x => x.lead_time === "LT Delivery")?.total_days || 0;

    // ============================
    // Total Lead Time
    // ============================
    const totalLeadTime = Number(lt_billing) + Number(lt_delivery);

    // ============================
    // Calculate ETA
    // ============================
    const etaUpdateBilling = addDays(confirmToOutDate, totalLeadTime, "working");

    console.log(
        "ETA Update Billing: " +
        moment(new Date(confirmToOutDate)).format("dddd, DD MMMM YYYY") +
        " + " +
        lt_billing +
        " + " +
        lt_delivery +
        " = " +
        moment(etaUpdateBilling).format("dddd, DD MMMM YYYY")
    );
    
    // ============================
    // Response
    // ============================
    result.status = 200;
    result.data = {
        success: true,
        message: "Success to Update ETA",
        data: {
            confirm_to_out_date: moment(new Date(confirmToOutDate)).format("dddd, DD MMMM YYYY"),
            lt_billing,
            lt_delivery,
            eta_update_billing: moment(etaUpdateBilling).format("dddd, DD MMMM YYYY")
        }
    };

    complete();
    return;

} catch (err) {

    result.statusCode = 500;
    result.data = {
        success: false,
        message: "Failed to Update ETA",
        error: err.message
    };

    complete();
    return;

}