let sequelize;

try {
    const seq = modules.sequelize;

    // Database Connection
    const DB_HOST = await vault.decrypt("DB-HOST");
    const DB_USER = await vault.decrypt("DB-USER");
    const DB_PASS = await vault.decrypt("DB-PASS");

    sequelize = new seq("DWH_BUSDAT", DB_USER, DB_PASS, {
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

    const salesDocumentNo = 5210020186;

    // Get 1 Allocation
    const [allocationResult] = await sequelize.query(`
        SELECT *
        FROM dt_gld.allocation
    `, {
        replacements: {
            salesDocumentNo
        }
    });

  

    // Get DO To Bil Ship
    const [doToBilShip] = await sequelize.query(`
        SELECT *
        FROM dt_gld.do_to_bil_ship

    `, {
        replacements: {
            salesDocumentNo
        }
    });

 

    result.data = {
        success: true,
        data: 
        allocationResult,
        doToBilShip
    };

    complete();
    return;

} catch (error) {

    result.data = {
        success: false,
        message: error.message
    };

    complete();
    return;

} finally {

    if (sequelize) {
        await sequelize.close();
    }
}