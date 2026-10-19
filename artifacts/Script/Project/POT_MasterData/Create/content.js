try {
  const  gudang_code = "BDG";
  const description = "Bandung"
  const status = true



  // delete data
  const result = await entities.pot_master_gudang.insert(
    { gudang_code,
    description,
    status },

  );

  console.log(result)


  result.data = { 
    success: true,
    message: "Data deleted successfully"
    
  };

  complete();

} catch (error) {
  console.error("Error inserting data:", error);
  result.data = { 
    success : false,
    message: error.message
 
  };
  complete();
}
