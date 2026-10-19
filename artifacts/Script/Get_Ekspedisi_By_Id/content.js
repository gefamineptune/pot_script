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

    const [ekspedisi, gudang] = await Promise.all([

    // Get ekspedisi
    entities.pot_ekspedisi.findOne({
        where: {
            id: ekspedisi_id
        }
    }),

    // Get gudang
    entities.pot_ekspedisi_gudang
        .createQueryBuilder("eg")
        .leftJoin(
            "pot_master_gudang",
            "gudang",
            "gudang.id = eg.gudang_id"
        )
        .select([
            "eg.gudang_id AS gudang_id",
            "CONCAT(gudang.gudang_code, ' - ', gudang.description) AS gudang_display"
        ])
        .where("eg.ekspedisi_id = :ekspedisi_id", {
            ekspedisi_id: ekspedisi_id
        })
        .getRawMany()

    ]);


    const dataEkspedisi = {
        id : ekspedisi.id,
        vendor_code : ekspedisi.vendor_code,
        ekspedisi_account_id : ekspedisi.ekspedisi_account_id,
        username : ekspedisi.username,
        email : ekspedisi.email,
        status : ekspedisi.status,
        encryptedPassword : ekspedisi.password,
        updatedAt : ekspedisi.updatedAt,
        gudang 

    }



    result.data = { 
        success: true,
        message: "Berhasil mengambil data ekspedisi",
        data : dataEkspedisi
        
    };

  complete();

} catch (error) {
  console.error("Error retrieving data:", error);
  result.data = { 
    success : false,
    message: error.message
 
  };
  complete();
}
