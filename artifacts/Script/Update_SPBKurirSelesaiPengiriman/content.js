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

    const spbno = req.body?.spbno ?? "";
    const tglkirim = req.body?.tglkirim ?? "";
    const tglterima = req.body?.tglterima ?? "";
    const penerima = req.body?.penerima ?? "";

    // VALIDATE VENDOR CODE
    if (spbno === "" || tglkirim === "" || tglterima === "" || penerima === "") {
        result.status = 400;

        result.data = {
            success: false,
            message: "data is missing",
        };

        complete();
        return;
    }

    // SAP CONFIG
    const baseUrl = await vault.decrypt("BASE-URL-SAP");
    const username = await vault.decrypt("AUTH-USERNAME-SAP");
    const password = await vault.decrypt("AUTH-PASS-SAP");

    const basicAuth = Buffer.from(`${username}:${password}`).toString("base64");

    const params = new URLSearchParams({
        "sap-client": "530",
    });

    const agent = new https.Agent({
        rejectUnauthorized: false,
    });

    // 1. GET CSRF TOKEN + COOKIE
    const tokenUrl = `${baseUrl}/sap/zdgt_in/token?${params.toString()}`;

    const tokenOptions = {
        method: "GET",
        headers: {
            Authorization: `Basic ${basicAuth}`,
            Accept: "application/json",
            "X-CSRF-Token": "Fetch",
        },
        agent: agent,
    };

    const tokenResult = await new Promise((resolve, reject) => {
        const request = https.request(tokenUrl, tokenOptions, (response) => {
            let responseBody = "";

            response.on("data", (chunk) => {
                responseBody += chunk;
            });

            response.on("end", () => {
                const csrfToken = response.headers["x-csrf-token"];

                const setCookie = response.headers["set-cookie"];

                const cookie = Array.isArray(setCookie)
                    ? setCookie.map((item) => item.split(";")[0]).join("; ")
                    : setCookie?.split(";")[0];

                resolve({
                    status: response.statusCode,
                    csrfToken: csrfToken,
                    cookie: cookie,
                    body: responseBody,
                });
            });
        });

        request.on("error", reject);

        request.end();
    });

    // 2. VALIDATE TOKEN RESPONSE

    if (tokenResult.status < 200 || tokenResult.status >= 300) {
        let tokenError = tokenResult.body;

        try {
            tokenError = JSON.parse(tokenResult.body);
        } catch (e) {
            // response bukan JSON
        }

        result.data = {
            success: false,
            message: "Failed to get CSRF token",
            status: tokenResult.status,
            data: tokenError,
        };

        complete();
        return;
    }

    if (!tokenResult.csrfToken) {
        result.data = {
            success: false,
            message: "CSRF token not found",
        };

        complete();
        return;
    }

    if (!tokenResult.cookie) {
        result.data = {
            success: false,
            message: "SAP session cookie not found",
        };

        complete();
        return;
    }

    // 3. GET DELIVERY ORDERS FROM SAP
    const updateSPBUrl = `${baseUrl}/sap/zdgt_in/update-spb?${params.toString()}`;

    const updateSPBBody = JSON.stringify({
        spbno: spbno,
        tglkirim: tglkirim,
        tglterima: tglterima,
        penerima: penerima,
    });

    const updateSPBOptions = {
        method: "POST",
        headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-CSRF-Token": tokenResult.csrfToken,
            Cookie: tokenResult.cookie,
            "Content-Length": Buffer.byteLength(updateSPBBody),
        },
        agent: agent,
    };

    const updateSPBResult = await new Promise((resolve, reject) => {
        const request = https.request(updateSPBUrl, updateSPBOptions, (response) => {
            let responseBody = "";

            response.on("data", (chunk) => {
                responseBody += chunk;
            });

            response.on("end", () => {
                resolve({
                    status: response.statusCode,
                    body: responseBody,
                });
            });
        });

        request.on("error", reject);

        request.write(updateSPBBody);
        request.end();
    });

    // 4. PARSE RESPONSE
    let updateSPBData = updateSPBResult.body;

    try {
        updateSPBData = JSON.parse(updateSPBResult.body);
    } catch (e) {
        // response bukan JSON
    }

    // // 5. VALIDATE DELIVERY RESPONSE
    // if (updateSPBResult.status < 200 || updateSPBResult.status >= 300) {
    //     result.data = {
    //         success: false,
    //         message: "Failed to get delivery orders",
    //         status: updateSPBResult.status,
    //         data: updateSPBData,
    //     };

    //     complete();
    //     return;
    // }

    // if (!Array.isArray(updateSPBData)) {
    //     result.data = {
    //         success: false,
    //         message: "Invalid delivery response format",
    //         data: updateSPBData,
    //     };

    //     complete();
    //     return;
    // }

    result.data = {
        success: true,
        message: "Success update SPB",
        data: updateSPBData,
    };

    complete();
    return;
} catch (error) {
    result.data = {
        success: false,
        message: "Failed update SPB",
        data: error.message,
    };

    complete();
    return;
}


