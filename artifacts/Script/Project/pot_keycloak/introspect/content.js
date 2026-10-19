try {
  // Parameter Awal
  const { access_token } = req.body;

  // Validasi Awal 
  if (!access_token) {
    
    result.data = { message: "access token required" };
    complete();
    return;
  }
  // Config Keycloak 
  const realm = await vault.decrypt("KEYCLOAK-REALM-COURIER");

  const baseUrl = await vault.decrypt("KEYCLOAK-URL-POT");
    const client_id = await vault.decrypt("CLIENT-ID-COURIER-POT")
    const client_secret = await vault.decrypt("CLIENT-SECRET-COURIER-POT")
  const tokenUrl = `${baseUrl}/realms/${realm}/protocol/openid-connect/token/introspect`;

  // Request Token 
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      token : access_token,
      client_id ,
      client_secret
      
    })
  });

  const data = await response.json();

  // Handle Error dari Keycloak 
  if (!response.ok) {
   
    result.data = {
      message: "failed",
      error: data
    };
    complete();
    return;
  }

  //  Response 
  result.statusCode = 200;
  result.data = {
    success : true,
    message : "Get token status successfully",
    data : {
      active : data.active
    }
  };
  complete();

} catch (error) {
  //  Error Handling 
  log.error("Error :", error);


  result.data = {
    message: "Terjadi kesalahan saat mengambil data.",
    error: error.message
  };
  complete();
}