// ==============================
// Config
// ==============================
const axios = modules.axios;

const SECRET_KEY = await vault.decrypt("SECRET-KEY-POT");
const AUTH_URL = await vault.decrypt("AUTH-URL-UCA");
const KEYCLOAK_URL = await vault.decrypt("KEYCLOAK-URL-UCA");

try {
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

    console.log(roleData);
    
    const accessToken = authResponse?.data?.data?.accessToken;

    let syncRole;
    try {

        syncRole = await axios.post(
            `${AUTH_URL}/auth/insert-role`,
            {roleData},
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        console.log(syncRole);

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

    // log.info(JSON.stringify(authResponse.data));
    // log.info(JSON.stringify(syncRole.data));

    // ==============================
    // Response
    // ==============================
    result.status = 200;
    result.data = {
        success: true,
        message: syncRole.data.message || "Sync role success"
    };

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