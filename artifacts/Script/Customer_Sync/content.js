// ==============================
// Config
// ==============================
const seq = modules.sequelize;
const { In } = operators;

const DB_HOST = await vault.decrypt("DB-HOST");
const DB_USER = await vault.decrypt("DB-USER");
const DB_PASS = await vault.decrypt("DB-PASS");

// Helper function untuk memecah array menjadi batch kecil (Chunking)
// Ini untuk menghindari error "maximum of N parameters" di MSSQL
const chunkArray = (array, size) => {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
};

const BATCH_SIZE = 100;

try {
    // 1. Connect to MSSQL
    const sequelize = new seq("DWH_BUSDAT", DB_USER, DB_PASS, {
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

    // 2. Test connection
    await sequelize.authenticate();
 
    // 3. Run SELECT query
    const [results] = await sequelize.query(`
        SELECT 
            customer_code,
            customer_name,
            customer_industry_text
        FROM dt_gld.customer_master
    `);

    // 4. Close connection
    await sequelize.close();

    // ============================
    // Result Customer Master
    // ============================
    const customerMasterResults = Array.isArray(results) ? results : [];

    // =====================================
    // Existing Customer di Neptune
    // =====================================
    const existingCustomers = await entities.pot_customer.find();

    // Mapping existing customer by customer_code (Normalisasi ke Uppercase & Trim untuk keamanan)
    const customerMap = {};
    existingCustomers.forEach(item => {
        const code = item.customer_code ? String(item.customer_code).trim().toUpperCase() : "";
        if (code) {
            customerMap[code] = item;
        }
    });

    // =====================================
    // Prepare Insert & Update
    // =====================================
    const insertData = [];
    const updateData = [];
    const idsToUpdateLastSyncOnly = [];  // Track IDs yang hanya perlu update last_sync

    for (const item of customerMasterResults) {

        // Normalisasi data untuk menghindari tipe data undefined/object yang menyebabkan error "Invalid string"
        const customerCode = item.customer_code ? String(item.customer_code).trim().toUpperCase() : "";
        if (!customerCode) continue;

        const customerName = item.customer_name ? String(item.customer_name).trim() : "";
        const customerSector = item.customer_industry_text ? String(item.customer_industry_text).trim() : null;

        const exist = customerMap[customerCode];
        if (exist) {
            let hasChanges = false;

            if (exist.customer_name !== customerName) {
                exist.customer_name = customerName;
                hasChanges = true;
            }
            if (exist.customer_sector !== customerSector) {
                exist.customer_sector = customerSector;
                hasChanges = true;
            }

            if (hasChanges) {
                // Ada perubahan data → update updatedAt, updatedBy, dan last_sync
                exist.updatedAt = Date.now();
                exist.updatedBy = "system";
                exist.last_sync = Date.now();
                updateData.push(exist);
            } else {
                // Tidak ada perubahan data → hanya update last_sync saja
                idsToUpdateLastSyncOnly.push(exist.id);
            }
        } else {
            insertData.push({
                customer_code: customerCode,
                customer_name: customerName,
                customer_sector: customerSector,
                customer_group_id: null,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                createdBy: "system",
                updatedBy: "system",
                last_sync: Date.now()
            });
        }
    }

    // =====================================
    // Bulk Insert (Dengan Chunking)
    // =====================================
    if (insertData.length > 0) {
        const chunks = chunkArray(insertData, BATCH_SIZE);
        for (const chunk of chunks) {
            await entities.pot_customer.save(chunk);
        }
    }

    // =====================================
    // Bulk Update Data + last_sync (Dengan Chunking)
    // =====================================
    if (updateData.length > 0) {
        const chunks = chunkArray(updateData, BATCH_SIZE);
        for (const chunk of chunks) {
            await entities.pot_customer.save(chunk);
        }
    }

    // =====================================
    // Bulk Update last_sync SAJA (tanpa sentuh updatedAt/updatedBy)
    // =====================================
    if (idsToUpdateLastSyncOnly.length > 0) {
        const idChunks = chunkArray(idsToUpdateLastSyncOnly, BATCH_SIZE);
        const now = Date.now();
        for (const chunk of idChunks) {
            await entities.pot_customer
                .createQueryBuilder()
                .update()
                .set({ last_sync: now })
                .where("id IN (:...ids)", { ids: chunk })
                .execute();
        }
    }

    // =====================================
    // Delete Customer & Child (Dengan Chunking)
    // =====================================
    const masterCustomerCodesSet = new Set(
        customerMasterResults.map(x => x.customer_code ? String(x.customer_code).trim().toUpperCase() : "")
    );

    const customersToDelete = existingCustomers.filter(item => {
        const code = item.customer_code ? String(item.customer_code).trim().toUpperCase() : "";
        return code && !masterCustomerCodesSet.has(code);
    });

    if (customersToDelete.length > 0) {
        const allDeletedIds = customersToDelete.map(item => item.id);
        const idChunks = chunkArray(allDeletedIds, BATCH_SIZE);

        for (const chunk of idChunks) {
            // 1. Hapus child terlebih dahulu (per batch)
            await entities.pot_customer_sales_mapping.delete({
                customer_id: In(chunk)
            });

            // CATATAN: Jika ada tabel child lain, tambahkan di sini:
            // await entities.nama_tabel_child_lain.delete({ customer_id: In(chunk) });

            // 2. Hapus parent (per batch)
            await entities.pot_customer.delete({
                id: In(chunk)
            });
        }
    }

    console.log({
        success: true,
        message: "Customer synchronized successfully",
        inserted: insertData.length,
        updated: updateData.length,
        updated_last_sync_only: idsToUpdateLastSyncOnly.length,
        deleted: customersToDelete.length
    });

    // ============================
    // Response
    // ============================
    result.status = 200;
    result.data = {
        success: true,
        message: "Customer synchronized successfully",
        data: {
            inserted: insertData.length,
            updated: updateData.length,
            updated_last_sync_only: idsToUpdateLastSyncOnly.length,
            deleted: customersToDelete.length
        }
    };

} catch (err) {
    console.log({
        success: false,
        message: "Failed to synchronize customer.",
        error: err.message
    });
    result.status = err.response?.status || 500;
    result.data = {
        success: false,
        message: "Failed to synchronize customer.",
        error: err.message
    };
}