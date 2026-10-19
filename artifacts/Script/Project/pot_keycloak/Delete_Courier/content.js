try {
    const {user_id} = req.query;
    
    const realm = await vault.decrypt("KEYCLOAK-REALM-COURIER");
    const baseUrl = await vault.decrypt("KEYCLOAK-URL-POT");
    const client_id = await vault.decrypt("CLIENT-ID-COURIER-POT")
    const client_secret = await vault.decrypt("CLIENT-SECRET-COURIER-POT")
    // const userId = "7a983479-0262-41a4-a841-b85a717675ff"


    if(!user_id){
        result.data = {
        success: false,
        message: "User id required."
        };

        complete();
        return;
    }
  
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
  
  
    // 2. Ambil user berdasarkan ID
    const response = await fetch(
        `${baseUrl}/admin/realms/${realm}/users/${user_id}`,
        {
        method: "DELETE",
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
        message: "Gagal menghapus data user.",
        error: error
        };

        complete();
        return;
    }


    result.data = {
        success: true,
        message: "Berhasil menghapus data user."
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