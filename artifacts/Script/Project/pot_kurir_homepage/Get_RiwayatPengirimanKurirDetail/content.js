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
    const id = req.body?.id ?? "";

    if (id === "") {
        result.data = {
            success: false,
            message: "ID required",
            data: [],
        };
    }

    const getSelesaiPengiriman_data = await entities.pot_kurir_selesai_pengiriman
        .createQueryBuilder("sp")
        .where("sp.id = :id_sp", { id_sp: id })
        .getOne();

    const getSelesaiPengiriman_img = await entities.pot_kurir_selesai_pengiriman_img
        .createQueryBuilder("spi")
        .where("spi.no_delivery_note = :do_num", { do_num: getSelesaiPengiriman_data.no_delivery_note })
        .getMany();

    const listImg_dn = getSelesaiPengiriman_img.flatMap((img) =>
        img.type === "dn" ? [img.image] : []
    );
    const listImg_bt = getSelesaiPengiriman_img.flatMap((img) =>
        img.type === "bt" ? [img.image] : []
    );

    // SUCCESS
    if (!getSelesaiPengiriman_data) {
        result.data = {
            success: false,
            message: "Data not found",
            data: [],
        };
        complete();
        return;
    }

    result.data = {
        success: true,
        message: "Get data success",
        data: {
            // riwayat_ekspedisi: {
            //     no_delivery_note: getSelesaiPengiriman_data.no_delivery_note,
            //     informasi_pengiriman: {
            //         lokasi_pengiriman: getSelesaiPengiriman_data.shipment_location,
            //         tgl_pengiriman: FormatDateTime(getSelesaiPengiriman_data.shipment_date),
            //         lokasi_tujuan: getSelesaiPengiriman_data.sold_to,
            //         tgl_tujuan: FormatDateTime(getSelesaiPengiriman_data.sold_date),
            //     },
            //     bukti_pengiriman: {
            //         nama_kurir: getSelesaiPengiriman_data.nama_kurir,
            //         nama_penerima: getSelesaiPengiriman_data.nama_penerima,
            //         jabatan_penerima: getSelesaiPengiriman_data.jabatan_penerima,
            //         delivery_note: listImg_dn,
            //         bukti_penerimaan: listImg_bt,
            //     },
            // },
            id: getSelesaiPengiriman_data.id,
            detail_pengiriman: {
                id: getSelesaiPengiriman_data.id,
                no_delivery_note: getSelesaiPengiriman_data.no_delivery_note,
                informasi_pengiriman: {
                    lokasi_pengambilan: getSelesaiPengiriman_data.shipment_location,
                    tgl_pengambilan: getSelesaiPengiriman_data.shipment_date,
                    lokasi_tujuan: getSelesaiPengiriman_data.sold_to,
                    alamat_pengiriman: getSelesaiPengiriman_data.alamat_pengiriman,
                    no_po: getSelesaiPengiriman_data.no_po,
                    no_so: getSelesaiPengiriman_data.so_number,
                    no_spb: getSelesaiPengiriman_data.no_spb,
                },
                bukti_pengiriman: {
                    nama_kurir: getSelesaiPengiriman_data.nama_kurir,
                    nama_penerima: getSelesaiPengiriman_data.nama_penerima,
                    jabatan_penerima: getSelesaiPengiriman_data.jabatan_penerima,
                    delivery_note: listImg_dn,
                    bukti_penerimaan: listImg_bt,
                },
            },
        },
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
