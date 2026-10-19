const body = req.body || {};
const { Like } = operators;

const search = body.search || "";
const limit = parseInt(body.limit) || 10;
const startIndex = parseInt(body.startIndex) || 0;
const sortingBy = body.sortingBy || "material_type:ASC";
const filter_poType = body.filter_poType || "";
const filter_vendorName = body.filter_vendorName || "";

// Kolom-kolom yang bisa di-search
const searchableColumns = [
  "material_type",
  "plant_pr",
  "plant_po",
  "default_plant_po",
  "po_type",
  "default_po_type",
  "vendor_code",
  "default_vendor_code",
  "vendor_name",
  "default_vendor_name",
];

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

/**
 * Gabungkan beberapa "grup OR" menjadi kombinasi AND (cartesian product)
 */
function combineAndOfOr(groups) {
  return groups.reduce((acc, group) => {
    if (acc.length === 0) return group;

    const combined = [];
    acc.forEach((a) => {
      group.forEach((g) => {
        combined.push({ ...a, ...g });
      });
    });
    return combined;
  }, []);
}

// Gabungkan kondisi search (OR antar kolom) dengan filter tambahan (AND, masing-masing bisa OR 2 kolom)
function buildWhereCondition(searchText, poTypeFilter, vendorNameFilter) {

  const groups = [];

  if (searchText) {
    groups.push(
      searchableColumns.map((column) => ({
        [column]: Like(`%${searchText}%`),
      }))
    );
  }

  if (poTypeFilter) {
    groups.push([
      { po_type: poTypeFilter },
      { default_po_type: poTypeFilter },
    ]);
  }

  if (vendorNameFilter) {
    groups.push([
      { vendor_name: vendorNameFilter },
      { default_vendor_name: vendorNameFilter },
    ]);
  }

  if (groups.length === 0) {
    return {};
  }

  return combineAndOfOr(groups);
}

/**
 * Cek apakah row (dari JSON/data_obj) match dengan search & filter,
 * dipakai untuk filtering manual saat data diambil dari pot_eta_lead_time_not_active.
 */
function matchRowManually(row, searchText, poTypeFilter, vendorNameFilter) {
  const matchSearch = !searchText || searchableColumns.some((col) =>
    (row[col] ?? "").toString().toLowerCase().includes(searchText.toLowerCase())
  );

  const matchPOType = !poTypeFilter ||
    row.po_type === poTypeFilter || row.default_po_type === poTypeFilter;

  const matchVendorName = !vendorNameFilter ||
    row.vendor_name === vendorNameFilter || row.default_vendor_name === vendorNameFilter;

  return matchSearch && matchPOType && matchVendorName;
}

// ===== Samakan bentuk object antara data hasil upload Excel (data_obj) & data dari table =====
// updatedAt SELALU diambil dari table pot_eta_lead_time_pr (bukan dari row itu sendiri),
// baik untuk data yang berasal dari JSON (data_obj) maupun dari table.
function normalizePRRow(row, tableUpdatedAt) {
  return {
    material_type: row.material_type ?? row["Material Type"] ?? "",
    plant_pr: row.plant_pr ?? row["Plant PR"] ?? "",
    plant_po: row.plant_po ?? row["Plant PO"] ?? "",
    default_plant_po: row.default_plant_po ?? row["Default Plant PO"] ?? "",
    po_type: row.po_type ?? row["PO Type"] ?? "",
    default_po_type: row.default_po_type ?? row["Default PO Type"] ?? "",
    vendor_code: row.vendor_code ?? row["Vendor Code"] ?? "",
    default_vendor_code: row.default_vendor_code ?? row["Default Vendor Code"] ?? "",
    vendor_name: row.vendor_name ?? row["Vendor Name"] ?? "",
    default_vendor_name: row.default_vendor_name ?? row["Default Vendor Name"] ?? "",
    lab_office: row.lab_office ?? row["Lab Office"] ?? "",
    pr_po: row.pr_po ?? row["PR - PO"] ?? null,
    po_migo_107: row.po_migo_107 ?? row["PO - MIGO 107"] ?? null,
    migo_107_migo_109: row.migo_107_migo_109 ?? row["MIGO 107 - MIGO 109"] ?? null,
    migo_109_confirm_to: row.migo_109_confirm_to ?? row["MIGO 109 - Confirm TO In"] ?? null,
    confirm_to_to_confirm_uu: row.confirm_to_to_confirm_uu ?? row["Confirm TO In - TO Confirm UU/Block"] ?? null,
    order: row.order ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: tableUpdatedAt ?? null,
  };
}

try {
  const order = parseSortingBy(sortingBy);
  const whereCondition = buildWhereCondition(search, filter_poType, filter_vendorName);

  // ===== 0. Ambil updatedAt dari table pot_eta_lead_time_pr SEKALI SAJA =====
  const latestUpdated = await entities.pot_eta_lead_time_pr.find({
      select: ["updatedAt"],
      order: { createdAt: "DESC" },
      skip: 0,
      take: 1,
      cache: false,
  });

  const tableUpdatedAt = latestUpdated[0]?.updatedAt ?? null;

  // ===== 1. Cek apakah ada data "not active" untuk eta_lead_type = "pr" (case-insensitive) =====
  const allNotActiveData = await entities.pot_eta_lead_time_not_active.find({
      cache: false,
  });

  const notActivePR = allNotActiveData.find(
      (item) => item.eta_lead_type && item.eta_lead_type.toString().trim().toLowerCase() === "pr"
  );

  let data;
  let totalCount;

  if (notActivePR && notActivePR.data_obj) {

      // ===== 2a. Kalau data not active ditemukan -> pakai data_obj sebagai sumber data =====
      let parsedData = [];

      try {
          parsedData = typeof notActivePR.data_obj === "string"
              ? JSON.parse(notActivePR.data_obj)
              : notActivePR.data_obj;
      } catch (parseError) {
          parsedData = [];
      }

      const normalizedData = Array.isArray(parsedData)
          ? parsedData.map((row) => normalizePRRow(row, tableUpdatedAt))
          : [];

      // Terapkan search & filter (po_type/vendor_name) secara manual
      const filteredData = normalizedData.filter((row) =>
          matchRowManually(row, search, filter_poType, filter_vendorName)
      );

      totalCount = filteredData.length;
      data = filteredData.slice(startIndex, startIndex + limit);

  } else {

      // ===== 2b. Kalau tidak ada -> fallback ke data existing pot_eta_lead_time_pr =====
      const rawData = await entities.pot_eta_lead_time_pr.find({
          select: [
              "material_type",
              "plant_pr",
              "plant_po",
              "default_plant_po",
              "po_type",
              "default_po_type",
              "vendor_code",
              "default_vendor_code",
              "vendor_name",
              "default_vendor_name",
              "lab_office",
              "pr_po",
              "po_migo_107",
              "migo_107_migo_109",
              "migo_109_confirm_to",
              "confirm_to_to_confirm_uu",
              "order",
              "createdAt", 
              "updatedAt"
          ],
          where: whereCondition,
          order: order,
          skip: startIndex,
          take: limit,
          cache: false,
      });

      data = rawData.map((row) => normalizePRRow(row, tableUpdatedAt));

      totalCount = await entities.pot_eta_lead_time_pr.count({
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