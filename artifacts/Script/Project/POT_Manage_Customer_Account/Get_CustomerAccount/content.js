try {

    let {maxRecord} = req.query;
    let {startIndex} = req.query;
    let {keyword} = req.query;
    let {customer_group_id} = req.query;
    let {sortBy} = req.query;
    let {sortOrder} = req.query;

    // let maxRecord = 5;
    // let startIndex = 0
    // let keyword = null;
    // let customer_group_id

    if(!startIndex){
        startIndex = 0
    }

    maxRecord = parseInt(maxRecord)
    startIndex = parseInt(startIndex)


    // const response = await apis.GET_CustomerMaster(opts);
    // console.log(response.data)
    
    // ambil data customer account 
    const query = entities.pot_customer_account
        .createQueryBuilder("customer_account")
        .leftJoin(
            "pot_customer_group",
            "customer_group",
            "customer_group.id = NULLIF(customer_account.customer_group_id, '')"
        )
        .select([
            "customer_account.id AS id",
            "customer_account.name AS name",
            "customer_account.customer_id AS customer_id",
            "customer_account.customer_name AS customer_name",
            "customer_account.customer_group_id AS customer_group_id",
            "customer_group.customer_group_name AS customer_group_name",
            "customer_account.status AS status",
            "customer_account.account_level AS account_level",
            "customer_account.customer_account_id AS customer_account_id",
            "customer_account.password AS password",
            "customer_account.updatedAt AS updatedAt"
        ]);

    if (customer_group_id) {
        query.where(
            "customer_account.customer_group_id = :customer_group_id",
            {
                customer_group_id
            }
        );
    }

    const data = await query.getRawMany();
 

    let filtered = data

    if (keyword){
        filtered = data.filter(item =>
        item.customer_name?.toLowerCase().includes(keyword.toLowerCase()) ||
        item.customer_group_name?.toLowerCase().includes(keyword.toLowerCase()) ||
        item.name?.toLowerCase().includes(keyword.toLowerCase()))
    }


     // sorting data
    filtered.sort((a, b) => {
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


    const customerAccount = filtered.slice(
        startIndex,
        startIndex + maxRecord
    );


    const totalRecord = filtered.length
    
    const totalPage = Math.ceil(totalRecord / maxRecord);

    result.data = { 
        success : true,
        message: "Berhasil mengambil data customer account",
        data : {
            customerAccount,
            totalPage,
            startIndex,
        
        }
    };

    // console.log(result.data)
    // console.log(ekspedisi)

    complete();
    return

} catch (error) {
  console.error("Error retrieving data:", error);
  result.data = { 
    success: false,
    message: "Failed to retrieve data",
    error: error.message
  };
  complete()
  return
}
