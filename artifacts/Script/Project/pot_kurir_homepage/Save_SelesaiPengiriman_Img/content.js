const body = req.body;

const selesai_pengiriman_id = body?.selesai_pengiriman_id
const no_delivery_note = body?.no_delivery_note ?? "";
const listImg_DN = body?.listImg_DN ?? [];
const listImg_BT = body?.listImg_BT ?? [];
const by = body?.bby ?? "User";

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
    var listValueImg = [];

    listImg_DN.forEach((img) => {
        listValueImg.push({
            selesai_pengiriman_id : selesai_pengiriman_id,
            no_delivery_note: no_delivery_note,
            image: img,
            type: "dn",
            createdBy: by,
            updatedBy: by,
        });
    });

    listImg_BT.forEach((img) => {
        listValueImg.push({
            selesai_pengiriman_id : selesai_pengiriman_id,
            no_delivery_note: no_delivery_note,
            image: img,
            type: "bt",
            createdBy: by,
            updatedBy: by,
        });
    });

    const resultData = await entities.pot_kurir_selesai_pengiriman_img
        .createQueryBuilder()
        .insert()
        .values(listValueImg)
        .execute();

    result.data = {
        success: true,
        message: "Success save kurir selesai kirim image",
        data: resultData,
    };
    complete();
} catch (error) {
    result.data = {
        success: false,
        message: "Failed save kurir selesai pengiriman image",
        data: error.message,
    };
    complete();
}
