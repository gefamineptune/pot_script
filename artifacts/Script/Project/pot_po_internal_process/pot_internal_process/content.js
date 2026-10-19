const body = req.body || {};
const soNumber = body.soNumber;
const soItem = body.soItem;

 //const soNumber = "5210018064";

// Validasi input wajib
    if (!soNumber) {
      result.statusCode = 400;
      result.data = {
        success: false,
        message: "Parameter 'soNumber' wajib diisi pada body request."
      };
      return complete();
    }

const MONTH_ID = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const entity_item = await entities.pot_po_item
  .createQueryBuilder("po_item")
  .where("po_item.so_number = :id", { id: String(soNumber) })
  .andWhere("po_item.so_item = :so_item", { so_item: soItem })
  .getOne();

  //console.log(JSON.stringify(entity_item));

const entity = await entities.pot_po_internal_process
  .createQueryBuilder("internal_process")
  .where("internal_process.po_item_id = TRY_CONVERT(uniqueidentifier, :id)", { id: entity_item.id})
  .getMany();

//console.log(JSON.stringify(entity));

const mapped = await mapInternalProcess(entity);

console.log(JSON.stringify(mapped));

result.statusCode = 200;
    result.data = {
      success: true,
      data_internal_process: mapped
    };

complete();


//----------------------------------------------------
//
//
//
//----------------------------------------------------

async function mapInternalProcess(entity) {
  // entity = hasil getMany(), array of rows
  const results = [];
  let Data_ETA = "";

  for (const row of entity) {
    // Lookup nama status berdasarkan order_status_id
    let orderStatusLabel = row.order_status_id;
    if (row.order_status_id) {
      const statusEntity = await entities.pot_master_order_status.findOne({
        where: { id: row.order_status_id },
      });
      orderStatusLabel = statusEntity?.status_name ?? row.order_status_id;
    }

    if(row.eta_type === "NULL") {
        Data_ETA = "-";
    }
    else if(row.eta_type === "TBA")
    {
      Data_ETA = "TBA";
    }
    else{
      Data_ETA = formatDateID(row.eta_customer_received);
    }


    results.push({
      "Id" : row.id,
      "Sourcing": row.sourcing_type,
      "Doc Sourcing": row.sourcing_type === "TP" ? "-" : row.document_number,
      "From Plant": row.sourcing_type === "TP" ? "-" : row.from_plant,
      "Eta Customer Received": Data_ETA,
      "Qty Sourcing": row.qty_sourcing,
      "Qty Allocated": row.qty_allocated,
      "Order Status": orderStatusLabel,
    });
  }

  return results;
}

function formatDateID(dateInput) {
  if (!dateInput) return "TBA";
  const d = new Date(dateInput);
  const day = d.getUTCDate();
  const month = MONTH_ID[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
}