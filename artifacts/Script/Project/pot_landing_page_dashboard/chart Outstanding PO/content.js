const { selectedCustomerGroup } = req.query || {};
const {bussiness_area} = req.query;
// const selectedCustomerGroup = "1A7209AB-0A9D-F111-B88F-0050568C835B";


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
    .select("customer.customer_name", "customer_name")
    .addSelect("COUNT(po.id)", "total")
    .where("po.progress_supply < 100")

    // .andWhere("po.po_receive_date IS NOT NULL")
    .andWhere("customer.customer_name IS NOT NULL")

    .groupBy("customer.customer_name")
    .orderBy("total", "DESC")
    .limit(5);

if (selectedCustomerGroup && selectedCustomerGroup.toLowerCase() !== "all") {
    query.andWhere("customer_group.id = :groupId", { groupId: selectedCustomerGroup });
}

if (bussiness_area && bussiness_area.toLowerCase() !== "hdo") {
    query.andWhere("po.sales_office = :sales_office", { sales_office: bussiness_area });
  }

const raw = await query.getRawMany();

const colors = ["#3E97E8", "#FF7A45", "#2FC3B5", "#FFC107", "#0F6C6D"];

const categories = raw.map(row =>
  row.customer_name.replace(/\s+/g, "\n")
);

const seriesData = raw.map((row, i) => ({
  y: parseInt(row.total, 10),
  color: colors[i % colors.length]
}));

result = { categories, seriesData };

console.log(JSON.stringify({ categories, seriesData }));