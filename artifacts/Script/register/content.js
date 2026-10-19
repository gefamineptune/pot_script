try {
    const {username} = req.body;
    const {firstName} = req.body;
    const {lastName} = req.body;
    const {email} = req.body;
    const {password} = req.body;
    const {access_token} = req.body

  const realm = await vault.decrypt("KEYCLOAK-REALM-COURIER");
  

  const baseUrl = await vault.decrypt("KEYCLOAK-URL-POT");
  const client_id = await vault.decrypt("CLIENT-ID-COURIER-POT")
  const client_secret = await vault.decrypt("CLIENT-SECRET-COURIER-POT")


  // ============= Create User =============
  const createUserUrl = `${baseUrl}/admin/realms/${realm}/users`;

  const userRes = await fetch(createUserUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${access_token}`
    },
    body: JSON.stringify({
      username,
      enabled: true,
      email,
      firstName,
      lastName,
      credentials: [
        {
          type: "password",
          value: password,
          temporary: false
        }
      ]
    })
  });

  //  Handle Create User Response 
  if (!userRes.ok) {
    const err = await userRes.json().catch(() => ({}));

 
    result.data = {
      success : false,
      message: "Gagal create user",
      error: err
    };
    complete();
    return;
  }

  //  Success 
  result.statusCode = 200;
  result.data = {
    success: true,
    message: "User berhasil dibuat"
  };
  complete();

} catch (error) {

  log.error("Error:", error);

  result.data = {
    success : false,
    message: "Terjadi kesalahan",
    error: error.message
  };
  complete();
}