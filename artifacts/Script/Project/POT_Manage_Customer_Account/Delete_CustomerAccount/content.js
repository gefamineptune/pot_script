try {
  const { user_id } = req.query;


  if (!user_id) {
    result.data = { 
        success: false,
        message: "user_id is required",
    };
   
    complete();
    return;
  }


  // delete data
  await entities.pot_customer_account.remove(
    { id: user_id }, // criteria

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
