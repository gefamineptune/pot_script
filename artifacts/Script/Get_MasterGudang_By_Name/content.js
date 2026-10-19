try {

  let {maxRecord} = req.query;
  let {startIndex} = req.query;
  let {keyword} = req.query;

  // let maxRecord = 5;
  // let startIndex = 0
  // let keyword = null;

    if(!startIndex){
        startIndex = 0
    }

    maxRecord = parseInt(maxRecord)
    startIndex = parseInt(startIndex)


    
    
    // ambil master data 
    const master_gudang = await entities.pot_master_gudang.find()

    let filtered = master_gudang

    if (keyword){
        filtered = master_gudang.filter(item =>
        item.gudang_code?.toLowerCase().includes(keyword.toLowerCase()) ||
        item.description?.toLowerCase().includes(keyword.toLowerCase()));
    }

    const dataGudang = filtered.slice(
        startIndex,
        startIndex + maxRecord
    );


    const totalRecord = filtered.length
    
    const totalPage = Math.ceil(totalRecord / maxRecord);

    result.data = { 
        success : true,
        message: "Get data master gudang",
        data : {
            dataGudang,
            totalPage,
            startIndex,
        
        }
    };

    // console.log(result.data)
    // console.log(dataGudang)

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
