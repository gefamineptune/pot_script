try{
    const body = req.body;
    const createdBy = body?.createBy ?? req.user.username;

    console.log(createdBy);

   //Hapus seluruh data table TP
    await entities.pot_eta_lead_time_pr
          .createQueryBuilder()
          .delete()
          .execute();

    //Insert data from upload file excel
    const InsertData_TP = await entities.pot_eta_lead_time_pr
                        .createQueryBuilder()
                        .insert()
                        .values(body)
                        .execute();
    
    result.data = { 
      success: true,
      message: "Successfully insert new data.",
      error: ""
    };    

}
catch (error) {
  console.error("Error retrieving data:", error.message);
  result.data = { 
    success: false,
    message: "Failed to retrieve data",
    error: error.message
  };
}
complete();