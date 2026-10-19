try {

    let { maxRecord, startIndex, keyword, sortBy, sortOrder } = req.query;

    // Default pagination
    maxRecord = parseInt(maxRecord) || 10;
    startIndex = parseInt(startIndex) || 0;

    // Get data secara paralel
    const [ekspedisiData, gudangData, gudangMaster] = await Promise.all([
        entities.pot_ekspedisi.find(),
        entities.pot_ekspedisi_gudang.find(),
        entities.pot_master_gudang.find()
    ]);

    let data = [];

    ekspedisiData.forEach((item) => {

        // Cari semua mapping gudang untuk ekspedisi ini
        const gudangMapping = gudangData.filter(
            (g) => g.ekspedisi_id === item.id
        );

        // Ambil gudang_code dari master gudang
        const gudangDisplay = gudangMapping
            .map((g) => {

                const master = gudangMaster.find(
                    (m) => m.id === g.gudang_id
                );

                return master?.gudang_code;

            })
            .filter(Boolean)
            .join(", ");

        data.push({
            id: item.id,
            vendor_code: item.vendor_code,
            vendor_name: item.vendor_name,
            gudang_code: gudangDisplay,
            status_account: item.status,
            ekspedisi_account_id  : item.ekspedisi_account_id
        });

    });

    // sorting data
    data.sort((a, b) => {
        const valueA = a[sortBy];
        const valueB = b[sortBy];

        if (valueA == null) return 1;
        if (valueB == null) return -1;

        if (typeof valueA === "string" && typeof valueB === "string") {
            return sortOrder === "DESC"
                ? valueB.localeCompare(valueA)
                : valueA.localeCompare(valueB);
        }

        return sortOrder === "DESC"
            ? valueB - valueA
            : valueA - valueB;
    });

    // Filter Keyword
    let filtered = data;

    if (keyword) {

        const search = keyword.toLowerCase();

        filtered = data.filter((item) =>
            item.vendor_name?.toLowerCase().includes(search) ||
            item.vendor_code?.toLowerCase().includes(search) ||
            item.gudang?.toLowerCase().includes(search)
        );
    }

    // Pagination
    const ekspedisi = filtered.slice(
        startIndex,
        startIndex + maxRecord
    );

    const totalRecord = filtered.length;
    const totalPage = Math.ceil(totalRecord / maxRecord);

    result.data = {
        success: true,
        message: "Berhasil mengambil data ekspedisi",
        data: {
            ekspedisi,
            totalRecord,
            totalPage,
            startIndex
        }
    };

    complete();
    return;

} catch (error) {

    console.error("Error retrieving data:", error);

    result.data = {
        success: false,
        message: "Failed to retrieve data",
        error: error.message
    };

    complete();
    return;
}