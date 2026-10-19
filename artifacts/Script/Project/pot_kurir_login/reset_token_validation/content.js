try {
    const { token } = req.body;
//   const token = "12345"

    if (!token) {
        // result.statusCode = 400;
        result.data = {
            valid : false,  
            message: "token required"
        };
        complete();
        return;
    }

    // Hash token untuk validasi dengan token yang tersimpan di database
    const resetToken = await hashToken(token)


    // cari token di database
    const tokenData = await entities.pot_password_reset_token.findOne({
            where: {
                token : resetToken,
                has_used: false
            }
    });

    // send error kalau token tidak ditemukan
    if (!tokenData) {
        result.data = {
            valid : false,  
            message: "invalid token"
        };
        complete();
        return;
    }

    // cek apakah token sudah expired
    if (new Date(tokenData.expired_at).getTime() <= Date.now()) {
        result.data = {
            message: "Token has expired",
            valid: false
        };

        complete();
        return;
    }


    result.data = {
        valid : true,  
        message: "Token valid",
        data : {
            username : tokenData.username
        }
    };
    
    complete();
    return;


} catch (err) {

    log.error(err);

    result.data = {
        valid : false,
        message: "Terjadi kesalahan.",
        error: err.message
    };

    complete();

}


async function hashToken(token) {

    // Convert string menjadi byte
    const data = new TextEncoder().encode(token);

    // Hash menggunakan SHA-256
    const hashBuffer = await crypto.subtle.digest(
        "SHA-256",
        data
    );

    // Convert hasil hash menjadi Hex
    const hashArray = Array.from(
        new Uint8Array(hashBuffer)
    );

    const hashHex = hashArray
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");

    return hashHex;
}


