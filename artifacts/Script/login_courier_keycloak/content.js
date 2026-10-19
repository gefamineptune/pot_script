try {

    const {username, password, visitor_id} = req.body;

    // CONFIG LOGIN ATTEMPT
    const MAX_ATTEMPT = 5;
    const LOCK_MINUTES = 5;
    const LOCK_DURATION = LOCK_MINUTES * 60 * 1000;
 
    // 1. VALIDASI INPUT
   if (!username || !password) {
        result.data = {
            success: false,
            locked: false,
            message: "Username dan password wajib diisi."
        };
        complete();
        return;
    }


    if (!visitor_id) {
        result.data = {
            success: false,
            locked: false,
            message: "Visitor ID tidak ditemukan."
        };
        complete();
        return;
    }



    // 2. GET LOGIN ATTEMPT BERDASARKAN VISITOR
    let loginAttempt =
        await entities.pot_login_attempt.findOne({
            where: {
                user_id: visitor_id
            }
        });


    const now = Date.now();


    // 3. CEK APAKAH VISITOR MASIH TERKUNCI
    if (
        loginAttempt &&
        loginAttempt.locked_until &&
        new Date(loginAttempt.locked_until).getTime() > now
    ) {

        const lockedUntil = new Date(loginAttempt.locked_until).getTime();
        const remainingSeconds = Math.ceil((lockedUntil - now) / 1000);

        result.data = {
            success: false,
            locked: true,
            remaining_attempt: 0,
            remaining_seconds: remainingSeconds,
            message:
                "Terlalu banyak kesalahan percobaan login. " +
                "Silahkan tunggu 5 menit untuk melakukan login kembali"
        };

        complete();
        return;
    }



    // 4. JIKA LOCK SUDAH EXPIRED
    // RESET COUNTER
    if (
        loginAttempt &&
        loginAttempt.locked_until &&
        new Date(loginAttempt.locked_until).getTime() <= now
    ) {

        await entities.pot_login_attempt.update(
            {
                id: loginAttempt.id
            },
            {
                failed_attempt: 0,
                locked_until: null
            }
        );


        // update variable local
        loginAttempt.failed_attempt = 0;
        loginAttempt.locked_until = null;
    }


 
    // 5. KEYCLOAK CONFIG
    // HANYA UNTUK VALIDASI LOGIN

    const realm = await vault.decrypt("KEYCLOAK-REALM-COURIER");

    const baseUrl =
        await vault.decrypt("KEYCLOAK-URL-POT");

    const client_id =
        await vault.decrypt("CLIENT-ID-COURIER-POT");

    const client_secret =
        await vault.decrypt("CLIENT-SECRET-COURIER-POT");


    const tokenUrl =
        `${baseUrl}/realms/${realm}` +
        `/protocol/openid-connect/token`;



    // 6. LOGIN KE KEYCLOAK
    const loginResponse = await fetch(tokenUrl, {

        method: "POST",

        headers: {
            "Content-Type":
                "application/x-www-form-urlencoded"
        },

        body: new URLSearchParams({
            grant_type: "password",
            client_id,
            client_secret,
            username,
            password
        })
    });


    const data_login = await loginResponse.json();



    // 7. LOGIN GAGAL
    if (!loginResponse.ok) {

        let failedAttempt = 1;

        // VISITOR SUDAH PERNAH GAGAL LOGIN
        if (loginAttempt) {

            failedAttempt = Number(loginAttempt.failed_attempt || 0) + 1;

            // UPDATE FAILED ATTEMP
            await entities.pot_login_attempt.update(
                {
                    id: loginAttempt.id
                },
                {
                    failed_attempt: failedAttempt
                }
            );

        } else {

            // PERTAMA KALI GAGAL
            const newAttempt =
                await entities.pot_login_attempt.insert({
                    user_id: visitor_id,
                    failed_attempt: 1,
                    locked_until: null
                });

        }



        // 8. SUDAH GAGAL 5 KALI
        if (failedAttempt >= MAX_ATTEMPT) {

            const lockedUntil =
                new Date(
                    Date.now() + LOCK_DURATION
                );


            // Kalau record sebelumnya sudah ada
            if (loginAttempt) {

                await entities.pot_login_attempt.update(
                    {
                        id: loginAttempt.id
                    },
                    {
                        failed_attempt: MAX_ATTEMPT,
                        locked_until: lockedUntil
                    }
                );

            }


            result.data = {
                success: false,
                locked: true,
                remaining_attempt: 0,
                message:
                    "Terlalu banyak kesalahan percobaan login. " +
                    "Silahkan tunggu 5 menit untuk melakukan login kembali"
            };

            complete();
            return;
        }



        // 9. BELUM MENCAPAI 5 KALI
        result.data = {
            success: false,
            locked: false,
            remaining_attempt:
                MAX_ATTEMPT - failedAttempt,

            message:
                "Username atau Password salah. Silahkan input data yang benar!"
        };

        complete();
        return;
    }


    // 10. LOGIN BERHASIL
    // RESET FAILED ATTEMPT
    if (loginAttempt) {

        await entities.pot_login_attempt.update(
            {
                id: loginAttempt.id
            },
            {
                failed_attempt: 0,
                locked_until: null
            }
        );
    }


    // 11. RESPONSE LOGIN BERHASIL
    result.data = {
        success: true,
        username,
        access_token: data_login.access_token,
        refresh_token: data_login.refresh_token
    };


    complete();


} catch (error) {

    log.error(
        "Error login:",
        error
    );


    result.data = {
        success: false,
        message:
            "Terjadi kesalahan saat melakukan login.",
        error: error.message
    };


    complete();
}