// try {

//     console.log("=== LOGOUT START ===");

//    const  token  = "eyJhbGciOiJIUzUxMiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICIxNjJjMjRiMC0wNDIyLTRjNGUtYjNjNS02NDk0NDBmMGU4NzkifQ.eyJleHAiOjE3ODkwNDM5MDEsImlhdCI6MTc4OTAxNTEwMSwianRpIjoiMDc4NTNiM2ItY2I3Ni00ZWRkLWE3MmYtMTdmY2E3ZGUyNTEwIiwiaXNzIjoiaHR0cHM6Ly9zc29kZXYudHJha251cy5jby5pZC9yZWFsbXMvUE9UIiwiYXVkIjoiaHR0cHM6Ly9zc29kZXYudHJha251cy5jby5pZC9yZWFsbXMvUE9UIiwic3ViIjoiODgwMTQzZWItY2UyMi00MzNkLThiMDYtYmMzN2Y3ZDhjYTE0IiwidHlwIjoiUmVmcmVzaCIsImF6cCI6Im5lcHR1bmUiLCJzaWQiOiIwYzA5MTdhZi05MDM1LTRhODQtYjczMi02MDMxYjcwMGY1NzUiLCJzY29wZSI6ImVtYWlsIGFjciByb2xlcyBiYXNpYyBwcm9maWxlIHdlYi1vcmlnaW5zIn0.CjgCgeGMK6Ksb4-_KRyail-8QeUFkDSinMjBtD5zOawZwPEAsApCnb8ySoF0h3SdgPtS8ync6gK0j6wsq5mY1w";
//     console.log("Token received:", !!token);

//     if (!token) {
//         result.status = 400;
//         result.data = {
//             success: false,
//             message: "Refresh token wajib diisi."
//         };

//         complete();
//         return;
//     }


//     // ======================================================
//     // CONFIG KEYCLOAK
//     // ======================================================
//     const realm = "POT";

//     const baseUrl = await vault.decrypt("KEYCLOAK-URL-POT");
//     const client_id = await vault.decrypt("CLIENT-ID-COURIER-POT");
//     const client_secret = await vault.decrypt("CLIENT-SECRET-COURIER-POT");

//     const tokenUrl =
//         `${baseUrl}/realms/${realm}/protocol/openid-connect/logout`;

//     console.log("Logout URL:", tokenUrl);
//     console.log("Client ID:", client_id);


//     // ======================================================
//     // PREPARE REQUEST
//     // ======================================================
//     const requestBody = new URLSearchParams({
//         refresh_token: token,
//         client_id: client_id,
//         client_secret: client_secret
//     });


//     // ======================================================
//     // MANUAL TIMEOUT
//     // ======================================================
//     const controller = new AbortController();

//     const timeoutId = setTimeout(() => {
//         console.log("Abort logout request because timeout");
//         controller.abort();
//     }, 15000); // 15 detik


//     console.log("Sending logout request to Keycloak...");

//     const startTime = Date.now();

//     let response;

//     try {

//         response = await fetch(tokenUrl, {
//             method: "POST",

//             headers: {
//                 "Content-Type": "application/x-www-form-urlencoded"
//             },

//             body: requestBody,

//             signal: controller.signal
//         });

//     } catch (fetchError) {

//         clearTimeout(timeoutId);

//         console.log("Fetch failed");
//         console.log("Name:", fetchError.name);
//         console.log("Message:", fetchError.message);

//         if (fetchError.name === "AbortError") {

//             result.status = 504;
//             result.data = {
//                 success: false,
//                 message: "Logout request timeout."
//             };

//             complete();
//             return;
//         }

//         throw fetchError;
//     }


//     clearTimeout(timeoutId);

//     const duration = Date.now() - startTime;

//     console.log("Logout response received");
//     console.log("Duration:", duration + " ms");
//     console.log("Status:", response.status);
//     console.log("Status Text:", response.statusText);
//     console.log("Response OK:", response.ok);
//     console.log(
//         "Content-Type:",
//         response.headers.get("content-type")
//     );


//     // ======================================================
//     // READ RESPONSE
//     // ======================================================
//     const responseText = await response.text();

//     console.log("Response:", responseText);


//     let data = null;

//     if (responseText) {
//         try {
//             data = JSON.parse(responseText);
//         } catch (e) {
//             data = responseText;
//         }
//     }


//     // ======================================================
//     // HANDLE ERROR
//     // ======================================================
//     if (!response.ok) {

//         result.status = response.status;

//         result.data = {
//             success: false,
//             message: "Logout request failed.",
//             error: data
//         };

//         complete();
//         return;
//     }


//     // ======================================================
//     // SUCCESS
//     // ======================================================
//     result.status = 200;

//     result.data = {
//         success: true,
//         message: "Logout successful."
//     };

//     complete();


// } catch (error) {

//     console.log("=== LOGOUT ERROR ===");
//     console.log("Error Name:", error.name);
//     console.log("Error Message:", error.message);
//     console.log("Error Stack:", error.stack);

//     log.error("Logout error:", error);

//     result.status = 500;

//     result.data = {
//         success: false,
//         message: "Terjadi kesalahan saat logout.",
//         error: error.message
//     };

//     complete();
// }



try {

    // ======================================================
    // PARAMETER AWAL
    // ======================================================
    const { token } = req.body;

    console.log("=== LOGOUT START ===");
    console.log("Refresh token received:", !!token);


    // ======================================================
    // VALIDASI AWAL
    // ======================================================
    if (!token) {

        result.status = 400;
        result.data = {
            success: false,
            message: "Refresh token wajib diisi."
        };

        complete();
        return;
    }


    // ======================================================
    // CONFIG KEYCLOAK
    // ======================================================
    const realm = await vault.decrypt("KEYCLOAK-REALM-COURIER");

    const baseUrl = await vault.decrypt("KEYCLOAK-URL-POT");
    const client_id = await vault.decrypt("CLIENT-ID-COURIER-POT");
    const client_secret = await vault.decrypt("CLIENT-SECRET-COURIER-POT");

    const logoutUrl =
        `${baseUrl}/realms/${realm}/protocol/openid-connect/logout`;

    console.log("Logout URL:", logoutUrl);
    console.log("Client ID:", client_id);


    // ======================================================
    // PREPARE REQUEST BODY
    // ======================================================
    const requestBody = new URLSearchParams({
        refresh_token: token,
        client_id: client_id,
        client_secret: client_secret
    });


    // ======================================================
    // SET TIMEOUT
    // ======================================================
    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
        console.log("Logout request timeout. Aborting request...");
        controller.abort();
    }, 15000);


    // ======================================================
    // REQUEST LOGOUT
    // ======================================================
    console.log("Sending logout request to Keycloak...");

    let response;

    try {

        response = await fetch(logoutUrl, {
            method: "POST",

            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },

            body: requestBody,

            signal: controller.signal
        });

    } catch (fetchError) {

        clearTimeout(timeoutId);

        console.log("Fetch logout failed");
        console.log("Error name:", fetchError.name);
        console.log("Error message:", fetchError.message);

        if (fetchError.name === "AbortError") {

            result.status = 504;
            result.data = {
                success: false,
                message: "Logout timeout. Keycloak tidak memberikan response."
            };

            complete();
            return;
        }

        throw fetchError;
    }


    clearTimeout(timeoutId);


    // ======================================================
    // RESPONSE INFO
    // ======================================================
    console.log("Logout response received");
    console.log("Status:", response.status);
    console.log("Status Text:", response.statusText);
    console.log("Response OK:", response.ok);
    console.log(
        "Content-Type:",
        response.headers.get("content-type")
    );


    // ======================================================
    // READ RESPONSE
    // Jangan langsung response.json()
    // karena response error bisa HTML
    // ======================================================
    const responseText = await response.text();

    console.log("Response body length:", responseText.length);


    // ======================================================
    // PARSE RESPONSE
    // ======================================================
    let data = null;

    if (responseText) {

        try {

            data = JSON.parse(responseText);

        } catch (parseError) {

            console.log("Response bukan JSON");

            data = responseText;
        }

    }


    // ======================================================
    // HANDLE ERROR RESPONSE
    // ======================================================
    if (!response.ok) {

        console.log(
            `Logout Keycloak gagal. Status: ${response.status}`
        );

        result.status = response.status;

        result.data = {
            success: false,
            message: "Request logout ke Keycloak gagal.",
            status: response.status,
            error: data
        };

        complete();
        return;
    }


    // ======================================================
    // SUCCESS
    // Keycloak logout biasanya return 204 No Content
    // ======================================================
    console.log("Logout Keycloak berhasil");
    console.log("=== LOGOUT END ===");

    result.status = 200;
    result.data = {
        success: true,
        message: "Logout berhasil.",
        keycloak_status: response.status
    };

    complete();


} catch (error) {

    // ======================================================
    // GLOBAL ERROR HANDLING
    // ======================================================
    console.log("=== LOGOUT ERROR ===");
    console.log("Error name:", error.name);
    console.log("Error message:", error.message);

    log.error("Error logout Keycloak:", error);

    result.status = 500;
    result.data = {
        success: false,
        message: "Terjadi kesalahan saat logout.",
        error: error.message
    };

    complete();
}