// ==============================
// Config
// ==============================
const seq = modules.sequelize;

const DB_HOST = await vault.decrypt("DB-HOST");
const DB_USER = await vault.decrypt("DB-USER");
const DB_PASS = await vault.decrypt("DB-PASS");

let sequelize;

try {

    // ==============================
    // 1. Connect to MSSQL
    // ==============================
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

    // ==============================
    // 2. Test Connection
    // ==============================
    await sequelize.authenticate();

    // ==============================
    // 3. Get Vendor Master
    // ==============================
    const [vendorMasterResults] = await sequelize.query(`
        SELECT
            vendor_code,
            vendor_name,
            sector_code
        FROM dt_gld.vendor_master
    `);

    // ==============================
    // 4. Get Existing Vendor
    // ==============================
    const existingVendors = await entities.pot_ekspedisi.find();

    // ==============================
    // 5. Mapping Existing Vendor
    // ==============================
    const vendorMap = {};

    existingVendors.forEach(item => {

        // Kalau vendor_code belum ada di map
        if (!vendorMap[item.vendor_code]) {
            vendorMap[item.vendor_code] = [];
        }

        // Masukkan ke array
        vendorMap[item.vendor_code].push(item);
    });

  
    // 6. Prepare Update
    const updateData = [];
    const now = new Date();

 
    // 7. Compare Vendor Master
    for (const item of vendorMasterResults) {

        // Ambil semua existing vendor
        // dengan vendor_code yang sama
        const existingList = vendorMap[item.vendor_code];

        // Kalau vendor tidak ada di pot_ekspedisi
        // langsung skip
        if (!existingList) {
            continue;
        }

    
        for (const exist of existingList) {

            // Cek apakah ada perubahan
            const isChanged =
                exist.vendor_name !== item.vendor_name ||
                String(exist.sector_code) !== String(item.sector_code);

            // Kalau tidak ada perubahan, skip
            if (!isChanged) {
                continue;
            }

     
            // Update Data
            exist.vendor_name = item.vendor_name;
            exist.sector_code = item.sector_code;
            exist.updatedAt = now;
            exist.updatedBy = "system";
            exist.last_sync = now;

            updateData.push(exist);
        }
    }

    // 8. Bulk Update
    if (updateData.length > 0) {
        await entities.pot_ekspedisi.save(updateData);
    }

 
    // 9. Response
    result.status = 200;

    result.data = {
        success: true,
        message: "Expedition synchronized successfully",
        data: {
            master: vendorMasterResults.length,
            existing: existingVendors.length,
            updated: updateData.length
        }
    };

} catch (err) {

    // ==============================
    // Error
    // ==============================
    log.error(err);

    result.status = err.response?.status || 500;

    result.data = {
        success: false,
        message: "Failed to synchronize Expedition.",
        error: err.message
    };

} finally {

    // ==============================
    // Close MSSQL Connection
    // ==============================
    if (sequelize) {
        await sequelize.close();
    }
}