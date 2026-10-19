const no_delivery_note = req.body?.no_delivery_note ?? "";
const u_name = req.body?.username ?? "";

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
    // VALIDATE VENDOR CODE
    if (u_name === "" || no_delivery_note === "") {
        result.status = 400;

        result.data = {
            success: false,
            message: "Username and do number is required",
        };

        complete();
        return;
    }

    const getDeliveryTempData = await entities.pot_kurir_delivery_temp
        .createQueryBuilder("dot")
        .where("dot.do_number = :doNum", { doNum: no_delivery_note })
        .andWhere("dot.username_submit = :uName", { uName: u_name })
        .getOne();

    // 13. SUCCESS
    result.data = {
        success: getDeliveryTempData !== null,
        message: getDeliveryTempData !== null ? "Data ditemukan" : "Data tidak ditemukan",
        res: getDeliveryTempData
    };

    complete();
    return;
} catch (error) {
    result.data = {
        success: false,
        message: "Failed to get delivery orders",
    };

    complete();
    return;
}
