// Function untuk extract token
function extractToken(authorizationHeader) {

    if (!authorizationHeader) {
        return null;
    }

    const parts = authorizationHeader.split(" ");

    if (
        parts.length !== 2 ||
        parts[0].toLowerCase() !== "bearer"
    ) {
        return null;
    }

    return parts[1];
}

try {
    const jwt = modules.jsonwebtoken;

    // =========================
    // JWT CONFIG
    // =========================
    const JWT_CONFIG = {
        algorithm: "HS256",
        secret: await vault.decrypt("JWT-SIGNING-SECRET"),
        issuer: "neptune-dxp-app"
    };


    // =========================
    // GET JWT TOKEN HEADER
    // =========================
    const jwtToken = req.headers["x-jwt-token"];

    // contoh header:
    // x-jwt-token: Bearer eyJhbGciOiJIUzI1NiIs...

    const token = extractToken(jwtToken);


    if (!token) {

        result.status = 401;

        result.data = {
            success: false,
            message: "Unauthorized"
        };

        complete();
        return;
    }


    // =========================
    // VERIFY JWT
    // =========================
    try {

        jwt.verify(token, JWT_CONFIG.secret, {
            algorithms: [JWT_CONFIG.algorithm],
            issuer: JWT_CONFIG.issuer
        });

    } catch (error) {

        result.status = 401;

        result.data = {
            success: false,
            message:
                error.name === "TokenExpiredError"
                    ? "Token has expired"
                    : "Invalid token"
        };

        complete();
        return;
    }

    
    // Token valid
    // Mulai Code di sini
    const { url } = req.query;
   

    if (!url) {
        result.status = 400;
        result.data = {
            success: false,
            message: "URL required"
        };

        complete();
        return;
    }

    const https = modules.https;

    const html = await new Promise((resolve, reject) => {

        https.get(url, (res) => {

            let data = "";

            res.on("data", (chunk) => {
                data += chunk;
            });

            res.on("end", () => {
                resolve(data);
            });

        }).on("error", (error) => {
            reject(error);
        });

    });

    // AMBIL TITLE
    const titleMatch = html.match(
        /<title[^>]*>(.*?)<\/title>/i
    );

    if (!titleMatch) {
        result.status = 404;
        result.data = {
            success: false,
            message: "DO Number tidak ditemukan"
        };

        complete();
        return;
    }

    const doNumber = titleMatch[1].trim();

    console.log("DO Number:", doNumber);



    // VALIDASI DO NUMBER
    if (!/^\d+$/.test(doNumber)) {
        result.status = 400;
        result.data = {
            success: false,
            message: "Format DO Number tidak valid"
        };

        complete();
        return;
    }


    result.status = 200;
    result.data = {
        success: true,
        data : {
            do_number: doNumber
        }
    };

    complete();
} catch (error) {

    console.error("QR Request Error:", error);

    result.data = {
        success: false,
        message: error.message
    };

    complete();
}