const rId = req.query?.roleId ?? "";

if (!rId) {
    result = {
        success: false,
        message: "invalid role id",
        roleId: rId
    };

    complete();
    return;
}

try {
    const getRoleData = await entities.pot_role
        .createQueryBuilder("r")
        .where("r.id = :rid", { rid: rId })
        .getOne();

    console.log(getRoleData.role_isactive);

    if (getRoleData.role_isactive === false) {
        result = {
            success: false,
            message: "Role inactive",
        };
        console.log(result);
        complete();
        return;
    }

    const getRoleAccessMenu = await entities.pot_role_access_menu
        .createQueryBuilder("ram")
        .innerJoin("pot_page", "p", "p.id = ram.access_menu_id")
        .leftJoin("pot_page", "par", "par.id = p.parent_page_id")
        .select([
            "p.id", "p.page_name", "ram.access_menu_type", "par.page_name"
        ])
        .where("ram.role_id = :rid", { rid: rId })
        .getRawMany();

    result = {
        success: true,
        message: getRoleAccessMenu,
    };
} catch (err) {
    result = {
        success: false,
        message: err,
    };
}

console.log(result);

complete();
