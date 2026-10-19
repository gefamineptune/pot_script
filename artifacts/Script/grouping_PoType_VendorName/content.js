function getUniqueSorted(arr) {
    const uniqueValues = [...new Set(arr.filter(v => v !== null && v !== undefined && v !== ""))];
    return uniqueValues.sort((a, b) => a.localeCompare(b));
}

try {
    const dataPOType = await entities.pot_eta_lead_time_pr
        .createQueryBuilder("t")
        .select("DISTINCT t.po_type", "po_type")
        .getRawMany();

    const dataDefaultPOType = await entities.pot_eta_lead_time_pr
        .createQueryBuilder("t")
        .select("DISTINCT t.default_po_type", "default_po_type")
        .getRawMany();

    const dataVendorName = await entities.pot_eta_lead_time_pr
        .createQueryBuilder("t")
        .select("DISTINCT t.vendor_name", "vendor_name")
        .getRawMany();

    const dataDefaultVendorName = await entities.pot_eta_lead_time_pr
        .createQueryBuilder("t")
        .select("DISTINCT t.default_vendor_name", "default_vendor_name")
        .getRawMany();

    // Gabungkan po_type + default_po_type, ambil unique & sort ascending
    const mergedPOType = getUniqueSorted([
        ...dataPOType.map((item) => item.po_type),
        ...dataDefaultPOType.map((item) => item.default_po_type),
    ]);

    // Gabungkan vendor_name + default_vendor_name, ambil unique & sort ascending
    const mergedVendorName = getUniqueSorted([
        ...dataVendorName.map((item) => item.vendor_name),
        ...dataDefaultVendorName.map((item) => item.default_vendor_name),
    ]);

    result.data = {
        poType: mergedPOType.map((value) => ({ po_type: value })),
        vendorName: mergedVendorName.map((value) => ({ vendor_name: value })),
        success: true,
        message: "Get filter options successfully",
    };

    console.log(JSON.stringify(result));
}
catch (error) {
    result.data = {
        poType: [],
        vendorName: [],
        success: false,
        message: error.message,
    };
}

complete();