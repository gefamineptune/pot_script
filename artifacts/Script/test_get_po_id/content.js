// const no_delivery_note = "3210026059";
// const no_delivery_note = "3210026057";
const no_delivery_note = "3210026061";

const getPODeliveryProcess = await entities.pot_po_delivery_process
    .createQueryBuilder("podp")
    .select(["podp.delivery_quantity", "podp.po_item_id"])
    .where("podp.do = :doNumber", { doNumber: no_delivery_note })
    .getMany();

const sumDeliveryQuantity = getPODeliveryProcess.reduce((accumulator, currentObj) => {
    return accumulator + currentObj.delivery_quantity;
}, 0);

let listPOItemId = "('";

for (const item of getPODeliveryProcess) {
    listPOItemId = listPOItemId + item.po_item_id.toString() + "','";
}

listPOItemId = listPOItemId.substring(0, listPOItemId.length - 2) + ")";

const getListPOId = await entities.pot_po_item
    .createQueryBuilder("poi")
    .select(["poi.po_id AS id"])
    .where("poi.id IN " + listPOItemId)
    .getRawMany();

console.log(getPODeliveryProcess);
console.log(sumDeliveryQuantity);
console.log(listPOItemId);
getListPOId.push({ id: "104A4A70-6EB1-F111-B88F-0050568C835B" });
console.log(getListPOId);
const pos = getListPOId.filter(
    (obj, index, self) => index === self.findIndex((item) => item.id === obj.id)
);

console.log(pos);
complete();
