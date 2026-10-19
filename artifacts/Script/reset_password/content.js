try {
    const { username, newPassword, token } = req.body;
    //   const token = "12345"

    // cek username dan password
    if (!username || !newPassword) {
            result.data = {
                success : false,  
                message: "Username & password required",
                tokenValid : false
            };
            complete();
            return;
        }

    // cek token
    if (!token) {
        result.data = {
            success : false,  
            message: "Token required",
            tokenValid : false
        };
        complete();
        return;
    }

    // Hash token untuk validasi dengan token yang tersimpan di database
    const resetToken = await hashToken(token)


    // cari token di database
    const data = await entities.pot_password_reset_token.findOne({
            where: {
                username,
                token : resetToken,
                has_used: false
            }
    });

    // cek apakah token sudah expired
    if (new Date(data.expired_at).getTime() <= Date.now()) {
        result.data = {
            success: false,
            message: "Token has expired",
            tokenValid: false
        };

        complete();
        return;
    }


    // kalau token valid, baru lanjut reset password

    const realm = await vault.decrypt("KEYCLOAK-REALM-COURIER");
    const baseUrl = await vault.decrypt("KEYCLOAK-URL-POT");
    const client_id = await vault.decrypt("CLIENT-ID-COURIER-POT")
    const client_secret = await vault.decrypt("CLIENT-SECRET-COURIER-POT")


    // 1. Ambil Admin Token
    const tokenResponse = await fetch(
        `${baseUrl}/realms/${realm}/protocol/openid-connect/token`,
        {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id,        
            client_secret
        })
        }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
        result.data = {
            success : false,
            message: "Gagal mengambil token",
            error: tokenData,
            tokenValid : true
        };
        complete();
        return;
    }

    const adminToken = tokenData.access_token;


    // 2. Cari User berdasarkan username

    const userResponse = await fetch(
        `${baseUrl}/admin/realms/${realm}/users?username=${encodeURIComponent(username)}`,
        {
        headers: {
            Authorization: `Bearer ${adminToken}`
        }
        }
    );



    const users = await userResponse.json();

    if (!userResponse.ok) {

        result.data = {
            success : false,
            message: "Gagal mencari user.",
            error: users,
            tokenValid : true
        };
        complete();
        return;
    }

    if (!users.length) {
        // result.statusCode = 200;
        result.data = {
            success : false,
            message: "User tidak ditemukan.",
            tokenValid : true
        };
        complete();
        return;
    }

    const userId = users[0].id;


    // 3. Reset Password
    const resetResponse = await fetch(
        `${baseUrl}/admin/realms/${realm}/users/${userId}/reset-password`,
        {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${adminToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            type: "password",
            value: newPassword,
            temporary: false
        })
        }
    );

    if (!resetResponse.ok) {
        const error = await resetResponse.text();

        // result.statusCode = 500;
        result.data = {
            success: false,
            message: "Reset password gagal.",
            error : error,
            tokenValid : true
        };
        complete();
        return;
    }


    await entities.pot_password_reset_token.update(
        {
            id: data.id
        },
        {
            has_used: true
        }
    );

    // result.statusCode = 200;
    result.data = {
        success : true,
        message: "Password berhasil diubah.",
        tokenValid : true
    };

    complete();

} catch (err) {

  log.error(err);

  result.data = {
    success : false,
    message: "Terjadi kesalahan.",
    error: err.message,
    tokenValid : false
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


