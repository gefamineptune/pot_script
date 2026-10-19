try {

    const data = await entities.pot_po.createQueryBuilder("po")
        .select("po.branch_id", "branch") // Mengubah alias menjadi 'branch'
        .distinct(true)
        .where("po.branch_id IS NOT NULL")
        .orderBy("branch", "ASC") // Sorting berdasarkan alias
        .getRawMany();

    // ---------------------------------
    // Response
    // ---------------------------------
    result.status = 200;
    result.data = {
        success: true,
        message: "Success to retrieve data",
        data
    };

    complete();
    return;

} catch (err) {
    result.status = err.response?.status || 500;
    result.data = {
        success: false,
        message: err.message
    };

    complete();
    return;
}