try {
    const body = req.body;
    const rId = body?.id ?? "";
    const rName = body?.role_name ?? "";
    const rIsActive = body?.role_isactive ?? true;
    const createdBy = body?.createBy ?? req.user.username;

    var resultAPIRole;

    if (!rId) {
        resultAPIRole = await entities.pot_role
            .createQueryBuilder()
            .insert()
            .values({
                role_name: rName,
                role_isactive: rIsActive,
                createdBy: createdBy,
                updatedBy: createdBy,
            })
            .execute();
    } else {
        resultAPIRole = await entities.pot_role
            .createQueryBuilder()
            .update()
            .set({
                role_name: rName,
                role_isactive: rIsActive,
                createdBy: createdBy,
                updatedBy: createdBy,
            })
            .where("id = :id", { id: rId })
            .execute();
    }

    console.log(resultAPIRole.raw[0]);

    result.data = {
        success: true,
        message: {
            id: resultAPIRole.raw[0].id,
            message: "Success create role",
        },
    };

    complete();
} catch (error) {
    console.error("Error inserting data:", error);
    result.data = {
        success: false,
        message: error.message,
    };
    complete();
}
