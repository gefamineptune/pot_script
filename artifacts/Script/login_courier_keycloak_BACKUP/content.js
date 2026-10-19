try {
  const { username, password } = req.body;

  if (!username || !password) {
    
    result.data = {
       success : false,
       message: "Username dan password wajib diisi." };
    complete();
    return;
  }

  const realm = await vault.decrypt("KEYCLOAK-REALM-COURIER");
  const baseUrl = await vault.decrypt("KEYCLOAK-URL-POT");
  const client_id = await vault.decrypt("CLIENT-ID-COURIER-POT")
  const client_secret = await vault.decrypt("CLIENT-SECRET-COURIER-POT")

  const tokenUrl = `${baseUrl}/realms/${realm}/protocol/openid-connect/token`;

  // ===== LOGIN =====
  const loginResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
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

  if (!loginResponse.ok) {
    
    result.data = {
      success : false,
      message: "Login gagal. Periksa kembali Username dan Kata Sandi",
      error: data_login
    };
    complete();
    return;
  }

  // ===== INTROSPECT =====
  const introspectUrl = `${baseUrl}/realms/${realm}/protocol/openid-connect/token/introspect`;

  const introspectResponse = await fetch(introspectUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      token: data_login.access_token,
      client_id,
      client_secret
    })
  });

  const data_introspect = await introspectResponse.json();

  if (!introspectResponse.ok) {
    
    result.data = {
      success : false,
      message: "Introspect gagal",
      error: data_introspect
    };
    complete();
    return;
  }

  // ===== RESPONSE =====
  
  result.data = {
          success : true,
          access_token: data_login.access_token,
          refresh_token: data_login.refresh_token,
          username: data_introspect.username,
          first_name: data_introspect.given_name,
          last_name: data_introspect.family_name
  };

  complete();

} catch (error) {
  log.error("Error get token:", error);

 
  result.data = {
    success : false,
    message: "Terjadi kesalahan saat mengambil token.",
    error: error.message
  };
  complete();
}