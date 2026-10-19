const vCode = req.body?.ven_code ?? "";

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
    const getEkspedisi_Gudang = await entities.pot_ekspedisi
        .createQueryBuilder("e")
        .where("e.vendor_code = :ven_code", { ven_code: vCode })
        .leftJoinAndSelect("pot_ekspedisi_gudang", "eg", "eg.ekspedisi_id = e.id")
        .leftJoinAndSelect("pot_master_gudang", "g", "eg.gudang_id = g.id")
        .getRawMany();

    if (getEkspedisi_Gudang.length <= 0) {
        result = {
            success: false,
            message: "Vendor not found",
            data: [],
        };

        complete();
        return;
    }

    const resultListGudang = {};
    resultListGudang.listGudang = [...new Set(getEkspedisi_Gudang.map((g) => g.g_gudang_code))];
    resultListGudang.listGudang_string = "";

    for(const g of resultListGudang.listGudang) {
        resultListGudang.listGudang_string += g + ",";
    }
    resultListGudang.listGudang_string = (resultListGudang.listGudang_string).substring(0, resultListGudang.listGudang_string.length - 1)

    result.data = {
        success: true,
        message: "Success get gudang",
        data: resultListGudang,
    };

    complete();
} catch (error) {
    result.data = {
        success: false,
        message: "Failed get gudang",
        data: error.message,
    };

    complete();
}
