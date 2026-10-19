const body = req.body || {};
const { Like } = operators;

const search = body.search || "";
const limit = parseInt(body.limit) || 10;
const startIndex = parseInt(body.startIndex) || 0;
const sortingBy = body.sortingBy || "order:ASC";

// Parsing sortingBy menjadi object order
function parseSortingBy(sortingByStr) {
  const order = {};
  if (!sortingByStr) return { order: "ASC" };

  const parts = sortingByStr.split(",");
  parts.forEach((part) => {
    const [column, direction] = part.split(":");
    if (column) {
      order[column.trim()] = (direction || "ASC").trim().toUpperCase();
    }
  });

  return order;
}

// Buat kondisi where untuk search
function buildSearchCondition(searchText) {
  if (!searchText) return {};

  return {
    Plant: Like(`%${searchText}%`), // sesuaikan kolom yang ingin di-search
  };
}

// ===== Samakan bentuk object antara data hasil upload Excel (data_obj) & data dari table =====
// updatedAt SELALU diambil dari table pot_eta_lead_time_tp (bukan dari row itu sendiri),
// baik untuk data yang berasal dari JSON (data_obj) maupun dari table.
function normalizeTPRow(row, tableUpdatedAt, tableCreateddAt) {
  return {
    id: row.id ?? null,
    Plant: row.Plant ?? "",
    CreateTP_CheckStock:
      row.CreateTP_CheckStock ?? row["Create TP - Check Stock"] ?? null,
    order: row.order ?? null,
    createdAt: tableCreateddAt ?? null,
    updatedAt: tableUpdatedAt ?? null,
  };
}

try {
    const order = parseSortingBy(sortingBy);
    const whereCondition = buildSearchCondition(search);

    // ===== 0. Ambil updatedAt dari table pot_eta_lead_time_tp SEKALI SAJA =====
    // (dipakai untuk semua baris, terlepas dari sumber datanya JSON atau table)
    const latestUpdated = await entities.pot_eta_lead_time_tp.find({
        select: ["updatedAt","createdAt"],
        order: { updatedAt: "DESC" },
        skip: 0,
        take: 1,
        cache: false,
    });

    const tableUpdatedAt = latestUpdated[0]?.updatedAt ?? null;
    const tableCreateddAt = latestUpdated[0]?.createdAt ?? null;

    // ===== 1. Cek apakah ada data "not active" untuk eta_lead_type = "tp" (case-insensitive) =====
    const allNotActiveData = await entities.pot_eta_lead_time_not_active.find({
        cache: false,
    });

    const notActiveTP = allNotActiveData.find(
        (item) => item.eta_lead_type && item.eta_lead_type.toString().trim().toLowerCase() === "tp"
    );

    let data;
    let totalCount;

    if (notActiveTP && notActiveTP.data_obj) {

        // ===== 2a. Kalau data not active ditemukan -> pakai data_obj sebagai sumber data =====
        let parsedData = [];

        try {
            parsedData = typeof notActiveTP.data_obj === "string"
                ? JSON.parse(notActiveTP.data_obj)
                : notActiveTP.data_obj;
        } catch (parseError) {
            parsedData = [];
        }

        const normalizedData = Array.isArray(parsedData)
            ? parsedData.map((row) => normalizeTPRow(row, tableUpdatedAt, tableCreateddAt))
            : [];

        // Tetap terapkan search & pagination secara manual supaya behavior-nya
        // konsisten dengan sumber dari table.
        const filteredData = search
            ? normalizedData.filter((row) =>
                  row.Plant.toString().toLowerCase().includes(search.toLowerCase())
              )
            : normalizedData;

        totalCount = filteredData.length;
        data = filteredData.slice(startIndex, startIndex + limit);

    } else {

        // ===== 2b. Kalau tidak ada -> fallback ke data existing pot_eta_lead_time_tp =====
        const rawData = await entities.pot_eta_lead_time_tp.find({
            select: ["id", "Plant", "CreateTP_CheckStock", "order", "createdAt", "updatedAt"],
            where: whereCondition,
            order: order,
            skip: startIndex,
            take: limit,
            cache: false,
        });

        data = rawData.map((row) => normalizeTPRow(row, tableUpdatedAt, tableCreateddAt));

        totalCount = await entities.pot_eta_lead_time_tp.count({
            where: whereCondition,
            cache: false,
        });
    }

    result.data = {
        data: data,
        total: totalCount,
        limit: limit,
        startIndex: startIndex,
        success: true,
        message: "Get data successfully",
    };
}
catch (error) {
    result.data = {
        data: [],
        total: 0,
        limit: limit,
        startIndex: startIndex,
        success: false,
        message: error.message,
    };
}

complete();