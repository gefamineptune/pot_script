// ------------------------------
// Config
// ------------------------------
const seq = modules.sequelize;

const DB_HOST = await vault.decrypt("DB-HOST");
const DB_USER = await vault.decrypt("DB-USER");
const DB_PASS = await vault.decrypt("DB-PASS");

try {

    // ------------------------------
    // Request Query
    // ------------------------------
    let { columns, filters } = req.query;

    // Whitelist kolom yang boleh di-select / difilter
    const ALLOWED_COLUMNS = [
        "me_id",
        // "me_code",
        "me_nrp",
        // "me_first_name",
        // "me_last_name",
        "me_full_name",
        // "me_status",
        // "me_gender",
        // "me_email",
        // "me_phone",
        // "me_join_date",
        // "me_terminate_date",
        // "me_last_updated_password_date",
        // "me_isActive",
        // "me_type",
        // "me_created_by",
        // "me_created_date",
        // "me_updated_by",
        // "me_updated_date",
        // "me_version",
        // "me_ref_id",
        // "me_canLogin",
        // "me_prs_uuid_key",
        // "me_prs_id"
    ];

    // ------------------------------
    // Select Column (opsional, default: semua kolom)
    // Contoh: ?columns=me_id,me_full_name
    // Atau  : ?columns=["me_id","me_full_name"]
    // ------------------------------
    let selectedColumns = ALLOWED_COLUMNS; // default
    if (columns) {
        const requested = Array.isArray(columns)
            ? columns
            : String(columns).split(",").map(c => c.trim());

        const valid = requested.filter(c => ALLOWED_COLUMNS.includes(c));
        if (valid.length > 0) selectedColumns = valid;
    }

    // ------------------------------
    // Filter per Column (opsional, mendukung banyak value -> IN)
    // Contoh: ?filters={"me_id":[1,2,3],"me_full_name":"ARIYANTO"}
    // Atau  : ?filters={"me_id":"1,2,3"}
    // ------------------------------
    let filterObj = {};
    if (filters) {
        try {
            filterObj = typeof filters === "string" ? JSON.parse(filters) : filters;
        } catch (e) {
            filterObj = {};
        }
    }

    const whereClauses = [];
    const replacements = {};

    Object.entries(filterObj).forEach(([col, val], idx) => {
        if (!ALLOWED_COLUMNS.includes(col)) return;
        if (val === undefined || val === null || val === "") return;

        // Normalisasi value jadi array
        let values;
        if (Array.isArray(val)) {
            values = val;
        } else {
            values = String(val).split(",").map(v => v.trim());
        }
        values = values.filter(v => v !== "" && v !== null && v !== undefined);
        if (values.length === 0) return;

        if (values.length === 1) {
            // Single value -> pakai '='
            const paramName = `filter_${idx}`;
            whereClauses.push(`${col} = :${paramName}`);
            replacements[paramName] = values[0];
        } else {
            // Multi value -> pakai IN (...)
            const paramNames = values.map((v, i) => `filter_${idx}_${i}`);
            paramNames.forEach((p, i) => {
                replacements[p] = values[i];
            });
            whereClauses.push(`${col} IN (${paramNames.map(p => `:${p}`).join(", ")})`);
        }
    });

    const whereSQL = whereClauses.length > 0
        ? `WHERE ${whereClauses.join(" AND ")}`
        : "";

    // ------------------------------
    // Connect to MSSQL
    // ------------------------------
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

    // ------------------------------
    // Query
    // ------------------------------
    const query = `
        SELECT ${selectedColumns.join(", ")}
        FROM dbo.mst_employee
        ${whereSQL}
    `;

    const results = await sequelize.query(query, {
        replacements,
        type: sequelize.QueryTypes.SELECT
    });

    // ------------------------------
    // Close connection
    // ------------------------------
    await sequelize.close();

    // ------------------------------
    // Response
    // ------------------------------
    result.statusCode = 200;
    result.data = {
        success: true,
        message: "Success to retrieve data",
        data: results
    };

    complete();
    return;

} catch (err) {

    result.statusCode = err.response?.status || 500;
    result.data = {
        success: false,
        message: "Failed to retrieve data",
        error:
            err.response?.data?.message ||
            err.response?.data?.error ||
            err.message
    };

    complete();
    return;

}