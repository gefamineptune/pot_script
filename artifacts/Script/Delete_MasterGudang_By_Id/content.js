try {
  const { gudang_id } = req.query;


  if (!gudang_id) {
    result.data = { 
        success: false,
        message: "gudang_id is required",
    };
   
    complete();
    return;
  }


  // delete data
  await entities.pot_master_gudang.remove(
    { id: gudang_id }, // criteria

  );


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
