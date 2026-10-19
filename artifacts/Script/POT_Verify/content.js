// ==============================
// Config
// ==============================
const axios = modules.axios;
const seq = modules.sequelize;

const DB_HOST = await vault.decrypt("DB-HOST");
const DB_USER = await vault.decrypt("DB-USER");
const DB_PASS = await vault.decrypt("DB-PASS");
const KEYCLOAK_USERINFO_URL = await vault.decrypt("KEYCLOAK-USERINFO-URL-UCA");

try {
    // ============================
    // Request Body
    // ============================
    const { access_token } = req.body;

    // ============================
    // Validation
    // ============================
    if (!access_token) {
        result.statusCode = 400;
        result.data = {
            success: false,
            message: "Token is required",
        };

        complete();
        return;
    }

    // ============================
    // Check Keycloak
    // ============================
    let user_keycloak;
    try {

        user_keycloak = await axios.get(
            KEYCLOAK_USERINFO_URL,
            {
                headers: {
                    Authorization: `Bearer ${access_token}`
                }
            }
        );

    } catch (err) {

        result.statusCode = 400;
        result.data = {
            success: false,
            message: `Get user info failed: ${err.message}`,
            error: err.message
        };

        complete();
        return;

    }

    // log.info(JSON.stringify(user_keycloak.data));

    // ============================
    // Check Employee Data
    // ============================
    const sequelize = new seq("UCA", DB_USER, DB_PASS, {
        host: DB_HOST,                        
        dialect: "mssql",
        logging: false,                       
        dialectOptions: {
            options: {
                encrypt: false,               
                trustServerCertificate: true  
            }
        }
    });

    await sequelize.authenticate();

    const [employeeData] = await sequelize.query(
        `
            SELECT 
                me.me_id,
                me.me_email,
                mepd.mepd_me_id,
                mepd.mepd_bus_area
            FROM dbo.mst_employee me
            INNER JOIN dbo.mst_employee_position_detail mepd 
                ON me.me_id = mepd.mepd_me_id
            WHERE me.me_email = :email
        `,
        { 
            replacements: { 
                email: user_keycloak?.data?.email || "" 
            },
            type: seq.QueryTypes.SELECT
        }
    );

    await sequelize.close();

    const businessArea = employeeData?.mepd_bus_area || "HDO";

    // ============================
    // Response
    // ============================
    result.status = 200;
    result.data = {
        success: true,
        message: "Token Valid",
        data: {
            ...user_keycloak.data,
            businessArea
        }
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