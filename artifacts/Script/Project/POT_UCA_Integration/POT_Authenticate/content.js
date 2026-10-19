// ==============================
// Config
// ==============================
const axios = modules.axios;

const SECRET_KEY = await vault.decrypt("SECRET-KEY-POT");
const AUTH_URL = await vault.decrypt("AUTH-URL-UCA");
const KEYCLOAK_URL = await vault.decrypt("KEYCLOAK-URL-UCA");

try {
    // ==============================
    // Request Body
    // ==============================
    const body = req.body || {};
    const code = body.code;
    const redirectUri = body.redirectUri;

    if (!code) {
        result.statusCode = 400;
        result.data = {
            success: false,
            message: "Authorization code is required",
        };

        complete();
        return;
    }

    // ==============================
    // Authenticate
    // ==============================
    let authResponse;
    try {

        authResponse = await axios.post(`${AUTH_URL}/auth/external`, {
            applicationCode: "POT",
            secretKey: SECRET_KEY
        });

    } catch (err) {

        result.statusCode = 400;
        result.data = {
            success: false,
            message: `Authenticating to auth service failed: ${err.message}`,
            error: err.message
        };

        complete();
        return;

    }

    // ==============================
    // Sync Role
    // ==============================
    const roleData = await entities.pot_role
        .createQueryBuilder("role")
        .select([
            "role.id AS referenceId",
            "role.role_name AS roleName"
        ])
        .where("role.role_isactive = :isActive", { isActive: true })
        .getRawMany();
    
    const accessToken = authResponse?.data?.data?.accessToken;

    try {

        await axios.post(
            `${AUTH_URL}/auth/insert-role`,
            {roleData},
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

    } catch (err) {

        result.statusCode = 400;
        result.data = {
            success: false,
            message: `Syncing role data failed: ${err.message}`,
            error: err.message
        };

        complete();
        return;

    }

    // ==============================
    // Validate Code
    // ==============================
    let validateResponse;
    try {

        validateResponse = await axios.post(`${KEYCLOAK_URL}/auth/validate`, {
            code,
            clientId: "POT",
            redirectUri
        });

    } catch (err) {

        result.statusCode = 400;
        result.data = {
            success: false,
            message: `Validating authorization code failed: ${err.message}`,
            error: err.message
        };

        complete();
        return;

    }

    // ==============================
    // Response
    // ==============================
    result.status = 200;
    result.data = { success: true, message: "Login Successful", data: validateResponse.data };
    // result.data = validateResponse.data;

    complete();
    return;

} catch (err) {

    // log.error(err);
    
    result.status = err.response?.status || 500;
    result.data = {
        success: false,
        message:
            err.response?.data?.message ||
            err.response?.data?.error ||
            err.message
    };

    complete();
    return;

}