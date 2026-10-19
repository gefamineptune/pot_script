const no_delivery_note = req.body?.no_delivery_note ?? "";

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
    // MULAI JALANKAN API DI SINI

    const { vendor_code } = req.body;

    // VALIDATE VENDOR CODE
    if (!vendor_code || no_delivery_note === "") {
        result.status = 400;

        result.data = {
            success: false,
            message: "vendor_code and no_delivery_note is required",
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
    const deliveryUrl = `${baseUrl}/sap/zdgt_in/delivery-orders?${params.toString()}`;

    const deliveryBody = JSON.stringify({
        vendor: vendor_code,
    });

    const deliveryOptions = {
        method: "POST",
        headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-CSRF-Token": tokenResult.csrfToken,
            Cookie: tokenResult.cookie,
            "Content-Length": Buffer.byteLength(deliveryBody),
        },
        agent: agent,
    };

    const deliveryResult = await new Promise((resolve, reject) => {
        const request = https.request(deliveryUrl, deliveryOptions, (response) => {
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

        request.write(deliveryBody);
        request.end();
    });

    // 4. PARSE RESPONSE
    let deliveryData = deliveryResult.body;

    try {
        deliveryData = JSON.parse(deliveryResult.body);
    } catch (e) {
        // response bukan JSON
    }

    // 5. VALIDATE DELIVERY RESPONSE
    if (deliveryResult.status < 200 || deliveryResult.status >= 300) {
        result.data = {
            success: false,
            message: "Failed to get delivery orders",
            status: deliveryResult.status,
            data: deliveryData,
        };

        complete();
        return;
    }

    if (!Array.isArray(deliveryData)) {
        result.data = {
            success: false,
            message: "Invalid delivery response format",
            data: deliveryData,
        };

        complete();
        return;
    }

    // 6. GET TEMP & DELIVERED DATA
    const [tempData, deliveredData] = await Promise.all([
        entities.pot_kurir_delivery_temp.find(),
        entities.pot_kurir_selesai_pengiriman.find(),
    ]);

    // 7. CREATE LIST DO FROM SAP
    const sapDoNumbers = new Set(deliveryData.map((item) => String(item.doNumber)));

    // CREATE LIST DO FROM DELIVERED
    const deliveredDoNumbers = new Set(deliveredData.map((item) => String(item.do_number)));

    // 8. DELETE TEMP
    // Hapus temp jika:
    // - tidak ada di SAP
    // - DAN tidak ada di delivered

    const tempToDelete = tempData.filter((temp) => {
        const doNumber = String(temp.do_number);

        const existsInSap = sapDoNumbers.has(doNumber);

        const existsInDelivered = deliveredDoNumbers.has(doNumber);

        return !existsInSap && !existsInDelivered;
    });

    if (tempToDelete.length > 0) {
        await Promise.all(
            tempToDelete.map((temp) => {
                return entities.pot_kurir_delivery_temp.delete(temp.id);
            })
        );
    }

    // 9. GET VALID TEMP DATA
    // Hanya temp yang:
    // - masih ada di SAP
    // - belum delivered

    const validTempData = tempData.filter((temp) => {
        const doNumber = String(temp.do_number);

        const existsInSap = sapDoNumbers.has(doNumber);

        const existsInDelivered = deliveredDoNumbers.has(doNumber);

        return existsInSap && !existsInDelivered;
    });

    // 10. CREATE TEMP MAP
    const tempMap = new Map();

    validTempData.forEach((temp) => {
        tempMap.set(String(temp.do_number), temp);
    });

    // 11. FILTER SAP DATA
    // Jangan tampilkan DO yang sudah delivered

    let filteredDeliveryData = deliveryData.filter((item) => {
        const doNumber = String(item.doNumber);
        const existsInDelivered = deliveredDoNumbers.has(doNumber);
        return !existsInDelivered && item.doNumber === no_delivery_note;
    });

    // 12. MAPPING DELIVERY DATA
    const delivery_list = filteredDeliveryData.map((item) => {
        const doNumber = String(item.doNumber);

        const temp = tempMap.get(doNumber);

        // DO SUDAH DIPROSES / ADA TEMP
        if (temp) {
            return {
                id: temp.id,
                detail_pengiriman: {
                    no_delivery_note: item.doNumber,
                    informasi_pengiriman: {
                        lokasi_pengambilan: item.tnWarehouse, // ?
                        tgl_pengambilan: FormatTanggal(item.shipmentEnd), // ?
                        lokasi_tujuan: temp.sold_to ?? item.soldTo,
                        alamat_pengiriman: item.shipToStreet,
                        no_po: item.custRef,
                        no_so: temp.so_number ?? item.soNumber,
                        no_spb: item.shipmentNumber,
                    },
                },
                status: temp.status ?? "Shipped",
            };
        }

        // DO BELUM DIPROSES

        return {
            detail_pengiriman: {
                no_delivery_note: item.doNumber,
                informasi_pengiriman: {
                    lokasi_pengambilan: item.tnWarehouse, // ?
                    tgl_pengambilan: FormatTanggal(item.shipmentEnd), // ?
                    lokasi_tujuan: item.soldTo,
                    alamat_pengiriman: item.shipToStreet,
                    no_po: item.custRef,
                    no_so: item.soNumber,
                    no_spb: item.shipmentNumber,
                },
            },
            status: "Ready at Warehouse",
        };
    });

    // 13. SUCCESS
    result.data = {
        success: true,
        message: "Berhasil mengambil data delivery orders",
        data: delivery_list[0],
    };

    complete();
    return;
} catch (error) {
    result.data = {
        success: false,
        message: "Failed to get delivery orders",
        data: error.message,
    };

    complete();
    return;
}

function FormatTanggal(dateString) {
    if (!dateString) return "";

    const bulan = [
        "Januari",
        "Februari",
        "Maret",
        "April",
        "Mei",
        "Juni",
        "Juli",
        "Agustus",
        "September",
        "Oktober",
        "November",
        "Desember",
    ];

    const date = new Date(dateString);

    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = bulan[date.getUTCMonth()];
    const year = date.getUTCFullYear();

    return `${day} ${month} ${year}`;
}
