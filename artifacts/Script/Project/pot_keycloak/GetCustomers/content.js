try {

    
    const realm = await vault.decrypt("KEYCLOAK-REALM-CUSTOMER");
    const baseUrl = await vault.decrypt("KEYCLOAK-URL-POT");
    const client_id = await vault.decrypt("CLIENT-ID-CUSTOMER-POT")
    const client_secret = await vault.decrypt("CLIENT-SECRET-CUSTOMER-POT")
    // const userId = "7a983479-0262-41a4-a841-b85a717675ff"

  
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
  
  

    const response = await fetch(
        `${baseUrl}/admin/realms/${realm}/users`,
        {
        method: "GET",
        headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            "Content-Type": "application/json"
        }
        }
    );

    if (!response.ok) {
        const error = await response.text();

        result.data = {
        success: false,
        message: "Gagal mengambil data user.",
        error: error
        };

        complete();
        return;
    }

    const user = await response.json();

    result.data = {
        success: true,
        message: "Berhasil mengambil data user.",
        data: user
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