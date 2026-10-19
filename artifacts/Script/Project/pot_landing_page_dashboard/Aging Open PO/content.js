const {selectedCustomerGroup} = req.query;
const {bussiness_area} = req.query;
// const selectedCustomerGroup = "01634200-7191-F111-B88F-0050568C835B";
// const bussiness_area = "SMP"

try {
  // 1. Buat base query
  const query = entities.pot_po
    .createQueryBuilder("po")
    .leftJoin(
      "pot_customer", 
      "customer", 
      "customer.id = po.customer_id"
    )
    .leftJoin(
      "pot_customer_group", 
      "customer_group", 
      "customer_group.id = customer.customer_group_id"
    )
    .select([
            "po.po_receive_date",
            "customer.customer_name",
            "customer_group.customer_group_name",
            "po.id",
            "po.progress_supply"
        ])
    .where("po.progress_supply < 100")
    .andWhere("po.po_receive_date IS NOT NULL");

  // 2. Tambahkan filter dinamis (Tanpa mengurung logika sisanya)
  if (selectedCustomerGroup && selectedCustomerGroup.toLowerCase() !== "") {
    query.andWhere("customer_group.id = :groupId", { groupId: selectedCustomerGroup });
  } 

  if (bussiness_area && bussiness_area.toLowerCase() !== "hdo") {
    query.andWhere("po.sales_office = :sales_office", { sales_office: bussiness_area });
  }


  // 3. Eksekusi query (Di luar blok IF agar berjalan baik untuk "ALL" maupun group spesifik)
  const entity = await query.getRawMany();

  console.log("Data DB : " + JSON.stringify(entity));

  // 4. Olah data
  const resultGrouping = groupByAging(entity);
  console.log(JSON.stringify(resultGrouping, null, 2));

  result.data = resultGrouping;
} catch (error) {
  console.log("error : " + error);
}

complete();

function groupByAging(data, referenceDate = new Date()) {
  const buckets = [
    { name: "0-14",  min: 0,  max: 14,       color: "#613CB0", count: 0 },
    { name: "15-30", min: 15, max: 30,       color: "#EC6337", count: 0 },
    { name: "30-90", min: 31, max: 90,       color: "#4994EC", count: 0 },
    { name: ">90",   min: 91, max: Infinity, color: "#FCEC60", count: 0 }
  ];

  const refTime = referenceDate.getTime();

  data.forEach(item => {
    // Filter: only qty_supply <= 100
    if (item.po_progress_supply === 100) return;

    // Catatan: Pastikan item.customer_po_date terisi dari database
    if (!item.po_po_receive_date) return;

    const poDate = new Date(item.po_po_receive_date);
    if (isNaN(poDate.getTime())) return;

    const diffMs = refTime - poDate.getTime();
    const ageDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (ageDays < 0) return;

    const bucket = buckets.find(b => ageDays >= b.min && ageDays <= b.max);
    if (bucket) bucket.count++;
  });

  return {
    series: [{
      data: buckets.map(b => ({
        name: b.name,
        y: b.count
      }))
    }]
  };
}