try {
  const { username, newPassword } = req.body;

  if (!username || !newPassword) {
    // result.statusCode = 400;
    result.data = {
      message: "Username dan password baru wajib diisi."
    };
    complete();
    return;
  }

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
    // result.statusCode = 500;
    result.data = {
      success : false,
      message: "Gagal mengambil admin token.",
      error: tokenData
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

  console.log(userResponse)

  const users = await userResponse.json();

  if (!userResponse.ok) {
    // result.statusCode = 500;
    result.data = {
      success : false,
      message: "Gagal mencari user.",
      error: users
    };
    complete();
    return;
  }

  if (!users.length) {
    // result.statusCode = 200;
    result.data = {
      success : false,
      message: "User tidak ditemukan."
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
      error
    };
    complete();
    return;
  }

  // result.statusCode = 200;
  result.data = {
    success : true,
    message: "Password berhasil diubah."
  };

  complete();

} catch (err) {

  log.error(err);

  // result.statusCode = 500;
  result.data = {
    success : false,
    message: "Terjadi kesalahan.",
    error: err.message
  };

  complete();

}