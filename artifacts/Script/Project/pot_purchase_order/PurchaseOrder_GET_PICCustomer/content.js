const query = req.query;
const cust_Id = query?.custId ?? "";

const seq = modules.sequelize;

if (!cust_Id || cust_Id === "") {
    result = {
        success: false,
        message: "Required Customer Id",
    };
    console.log(result);
    complete();
    return;
}

try {
    const getCustSalesMap = await entities.pot_customer_sales_mapping
        .createQueryBuilder("csm")
        .where("csm.customer_id = :cust_id", { cust_id: cust_Id })
        .getMany();

    if (!getCustSalesMap || getCustSalesMap.length === 0) {
        result = {
            success: false,
            message: "Customer sales mapping not found",
        };
        return;
    }

    const listCustId = getCustSalesMap.map(item => item.customer_sales_id).join(", ");

    const DB_HOST = await vault.decrypt("DB-HOST");
    const DB_USER = await vault.decrypt("DB-USER");
    const DB_PASS = await vault.decrypt("DB-PASS");
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

    // SELECT me_id, me_code, me_nrp, me_first_name, me_last_name, me_full_name, me_status, me_gender, me_email, me_phone, me_join_date, me_terminate_date, me_last_updated_password_date, me_isActive, me_type, me_created_by, me_created_date, me_updated_by, me_updated_date, me_version, me_ref_id, me_canLogin, me_prs_uuid_key, me_prs_id
    const getEmpData = await sequelize.query(`
        SELECT me_id, me_nrp, me_full_name
        FROM dbo.mst_employee
        WHERE me_id IN (${listCustId})
    `);
    // , {
    //     replacements: {
    //         custId: listCustId
    //     }
    // });
    await sequelize.close();

    result = {
        success: true,
        message: "Get PIC Customer data success",
        result: getEmpData[0],
        totalData: getEmpData[1]
    };
} catch (err) {
    result = {
        success: false,
        message: err,
    };
    await sequelize.close();
} finally {
    console.log(result);
    complete();
    return;
}
