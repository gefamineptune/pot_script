const body = req.body || {};
const { Like } = operators;

const search = body.search || "";
const limit = parseInt(body.limit) || 10;
const startIndex = parseInt(body.startIndex) || 0;
const sortingBy = body.sortingBy || "lead_time:ASC";

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
        lead_time: Like(`%${searchText}%`), // sesuaikan kolom yang ingin di-search
    };
}

async function GetLeadTimeGeneralActive() {
    try {
        const order = parseSortingBy(sortingBy);
        const whereCondition = buildSearchCondition(search);

        const data = await entities.pot_eta_lead_time_general.find({
            select: ["id", "lead_time", "total_days", "updatedAt", "createdAt"],
            where: whereCondition,
            order: order,
            skip: startIndex,
            take: limit,
            cache: false,
        });

        const totalCount = await entities.pot_eta_lead_time_general.count({
            where: whereCondition,
            cache: false,
        });

        result.data = {
            data: data,
            total: totalCount,
            limit: limit,
            startIndex: startIndex,
            success: true,
            message: "Get data successfully",
        };
    } catch (error) {
        result.data = {
            data: [],
            total: 0,
            limit: limit,
            startIndex: startIndex,
            success: false,
            message: error.message,
        };
    }

    console.log(result);
    complete();
}

function FilterSortPaginationData(dataObj) {
    // filter
    let returnData = dataObj;
    returnData = returnData.filter((matrix) => {
        if (!search || search.trim() === "") return true;
        return (
            String(matrix?.lead_time || "").toLowerCase().includes(search.toLowerCase()) ||
            String(matrix?.total_days || "").toLowerCase().includes(search.toLowerCase())
        );
    });

    // sort
    if (sortingBy) {
        const order = parseSortingBy(sortingBy);

        returnData.sort((a, b) => {
            for (const [field, direction] of Object.entries(order)) {
                let result;
                if (typeof a[field] === "string") {
                    result = a[field].localeCompare(b[field]);
                } else {
                    result = a[field] - b[field];
                }

                if (result !== 0) {
                    return direction === "ASC" ? result : -result;
                }
            }
        });
    }

    // pagination
    returnData = returnData.slice(startIndex, startIndex + limit);

    return returnData;
}

const getLeadTimeNotActive = await entities.pot_eta_lead_time_not_active
    .createQueryBuilder("na")
    .where("na.eta_lead_type = :type", { type: "general" })
    .getOne();

if (!getLeadTimeNotActive) {
    GetLeadTimeGeneralActive();
} else if (
    !getLeadTimeNotActive.active_date ||
    getLeadTimeNotActive.active_date === null ||
    new Date(getLeadTimeNotActive.active_date).getTime() > new Date().getTime()
) {
    const getLastUpdate = await entities.pot_eta_lead_time_general.createQueryBuilder("g").getOne();
    const getCreateData = [];

    JSON.parse(getLeadTimeNotActive.data_obj).forEach((item) => {
        getCreateData.push({
            lead_time: item["Lead Time"],
            total_days: item["Total Days"],
            updatedAt: Number(getLastUpdate.updatedAt),
            createdAt: item.createAt,
        });
    });

    const resultFilterSortPagination = FilterSortPaginationData(getCreateData);
    result = {
        data: {
            data: resultFilterSortPagination,
            total: resultFilterSortPagination.length,
            limit: limit,
            startIndex: startIndex,
            success: true,
            message: 'Get data successfully'
        }
    };
    console.log(result);
    complete();
} else {
    const getCreateData = [];

    JSON.parse(getLeadTimeNotActive.data_obj).forEach((item) => {
        getCreateData.push({
            lead_time: item["Lead Time"],
            total_days: item["Total Days"],
            createdBy: item.createBy,
            updatedBy: item.createBy,
            createdAt: item.createAt,
            updatedAt: getLeadTimeNotActive.active_date,
        });
    });

    await entities.pot_eta_lead_time_general.createQueryBuilder().delete().execute();

    await entities.pot_eta_lead_time_general
        .createQueryBuilder()
        .insert()
        .values(getCreateData)
        .execute();

    await entities.pot_eta_lead_time_not_active
        .createQueryBuilder()
        .delete()
        .where("eta_lead_type = :type", { type: "general" })
        .execute();

    GetLeadTimeGeneralActive();

    console.log(result);
    complete();
}
