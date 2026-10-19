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

// MULAI CODE
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
    const vendorCode = req.body?.vendor_code ?? "";
    if (vendorCode === "") { 
        result.data = {
            success: false,
            message: "Vendor code required!",
        };

        complete();
        return;
    }
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const getDataSelesaiPengiriman = await entities.pot_kurir_selesai_pengiriman
        .createQueryBuilder("sp")
        .where("sp.sold_date >= :thirtyDaysAgo", { thirtyDaysAgo: thirtyDaysAgo.toISOString() })
        .andWhere("sp.vendor_code = :venCode", { venCode: vendorCode })
        .select(["sp.no_delivery_note", "sp.sold_to", "sp.sold_date", "sp.id"])
        .getMany();

    let resultData = [];

    getDataSelesaiPengiriman.forEach((item) => {
        resultData.push({
            id: item.id,
            no_delivery_note: item.no_delivery_note,
            tujuan: item.sold_to,
            tgl_diterima: FormatDateTime(item.sold_date),
        });
    });

    // SUCCESS
    result.data = {
        success: true,
        message: "Get data success",
        data: resultData,
    };
    complete();
    return;
} catch (error) {
    result.data = {
        success: false,
        message: "Get data failed",
        data: error.message,
    };
    complete();
    return;
}

function FormatDateTime(dateTime) {
    const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jakarta",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });

    const parts = formatter.formatToParts(new Date(dateTime));
    const values = {};
    for (const part of parts) {
        values[part.type] = part.value;
    }

    const formatted = `${values.day} ${values.month} ${values.year} ${values.hour}:${values.minute}:${values.second}`;
    return formatted;
}
