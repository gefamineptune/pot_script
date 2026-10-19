try {
    let {user_id} = req.body;
    const {username} = req.body;
    const {password} = req.body;
    const {status} = req.body;
    const {email} = req.body;

    // let user_id = "07770a41-53a7-46ee-80b9-38d696694033"
    // const username = "adam"
    // const password = "123"

    
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
    const access_token = tokenData.access_token;


    // UPDATE USER
    if (user_id) {

        // Update user 
        const updateResponse = await fetch(
            `${baseUrl}/admin/realms/${realm}/users/${user_id}`,
            {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${access_token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username,
                    enabled : status,
                    email
                })
            }
        );

        if (!updateResponse.ok) {
            const err = await updateResponse.json().catch(() => ({}));

            result.data = {
                success: false,
                message: err.errorMessage,
                error: err
            };

            complete();
            return;
        }

        // Reset password jika ada password baru
        if (password) {

            const resetResponse = await fetch(
                `${baseUrl}/admin/realms/${realm}/users/${user_id}/reset-password`,
                {
                    method: "PUT",
                    headers: {
                        Authorization: `Bearer ${access_token}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        type: "password",
                        value: password,
                        temporary: false
                    })
                }
            );

            if (!resetResponse.ok) {

                const error = await resetResponse.text();

                result.data = {
                    success: false,
                    message: error.errorMessage,
                    
                };

                complete();
                return;
            }
        }

    }

    // CREATE USER
    else {

        const createResponse = await fetch(
            `${baseUrl}/admin/realms/${realm}/users`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${access_token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username,
                    enabled: status,
                    emailVerified: true,
                    email,
                    credentials: [
                        {
                            type: "password",
                            value: password,
                            temporary: false
                        }
                    ]
                })
            }
        );

        if (!createResponse.ok) {

            const err = await createResponse.json().catch(() => ({}));

            result.data = {
                success: false,
                message: err.errorMessage,
                error: err
            };

            complete();
            return;
        }

        // Ambil ID user yang baru dibuat
        const res = await fetch(
            `${baseUrl}/admin/realms/${realm}/users?username=${encodeURIComponent(username)}&exact=true`,
            {
                headers: {
                    Authorization: `Bearer ${access_token}`
                }
            }
        );

        const users = await res.json();

        user_id = users[0].id;
    }

    // Success
    result.data = {
        success: true,
        message: "Berhasil.",
        data: {
            user_id
        }
    };

    complete();

} catch (err) {

  log.error(err);

  result.data = {
    success: false,
    message: "Terjadi kesalahan.",
    error: err.message
  };

  complete();
}