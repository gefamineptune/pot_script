// ==============================
// Config
// ==============================
const seq = modules.sequelize;

const DB_HOST = await vault.decrypt("DB-HOST");
const DB_USER = await vault.decrypt("DB-USER");
const DB_PASS = await vault.decrypt("DB-PASS");

try {

    const sequelize = new seq("DWH_BUSDAT", DB_USER, DB_PASS, {
        host: DB_HOST,                        // Change if needed
        dialect: "mssql",
        logging: false,                       // Set to true if you want SQL logs
        dialectOptions: {
            options: {
                encrypt: false,               // Change to true if using Azure
                trustServerCertificate: true  // Useful for local dev
            }
        }
    });

    await sequelize.authenticate();
 
    const [results] = await sequelize.query(`
        SELECT DISTINCT sales_order_plant AS branch
        FROM dt_gld.do_to_bil_ship 
        WHERE sales_order_plant IS NOT NULL AND LTRIM(RTRIM(sales_order_plant)) != ''
        ORDER BY branch ASC
    `);

    await sequelize.close();

    // ============================
    // Response
    // ============================
    result.status = 200;
    result.data = {
        success: true,
        message: "Success to retrieve data",
        data: results
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
