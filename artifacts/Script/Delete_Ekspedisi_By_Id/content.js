try {
  const { ekspedisi_id } = req.query;


  if (!ekspedisi_id) {
    result.data = { 
        success: false,
        message: "ekspedisi_id is required",
    };
   
    complete();
    return;
  }


  // delete data
  await entities.pot_ekspedisi.remove(
    { id: ekspedisi_id }, // criteria

  );


  result.data = { 
    success: true,
    message: "Data deleted successfully"
    
  };

  complete();

} catch (error) {
  console.error("Error deleting data:", error);
  result.data = { 
    success : false,
    message: error.message
 
  };
  complete();
}
