try {

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    // delete data yg expired date nya sudah lewat 2 hari
    await entities.pot_password_reset_token
        .createQueryBuilder()
        .delete()
        .where("expired_at < :twoDaysAgo", {
            twoDaysAgo: twoDaysAgo
        })
        .execute();

    result.data = {
        success : true
    }


    complete()
    return

} catch(error){
    result.data = {
        success : false,
        message : error.errorMessage
    }

    console.log(error)

    complete()
    return
}