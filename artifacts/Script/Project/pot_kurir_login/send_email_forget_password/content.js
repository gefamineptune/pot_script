try {

    const { username } = req.body;
    // const username = "citra123"

    if (!username) {
        result.data = {
            success: false,
            message: "Username is required"
        };

        complete();
        return;
    }

    // Generate random token
    const bytes = new Uint8Array(32);

    crypto.getRandomValues(bytes);

    const token = Array.from(bytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");

    //encrypt token 
    const encryptedToken = await hashToken(token);

    const expiredAt = new Date(
        Date.now() + (5 * 60 * 1000)
    );

    // get ekspedisi account berdasarkan username
    const ekspedisi_account = await entities.pot_ekspedisi.findOne({
        where: { username }
    });

    if(!ekspedisi_account){
        result.data = {
        success: false,
        message: "username not found"
    };

    complete();
    return
    }

    // Save reset token
    await entities.pot_password_reset_token.insert({
        username: username,
        token: encryptedToken,
        expired_at: expiredAt,
        has_used: false
    });


    // Send Email
    const link = await vault.decrypt("POT-LINK-RESET-PASS")

    await sendEmail({
        to: ekspedisi_account.email,
        subject: "Reset Password",
        templateId: "3F7EAAD8-B0AD-F111-B88F-0050568C835B",
        primitives: {
            link: link + token,
            username: username,
            nama_perusahaan: "Traktor Nusantara"
        }
    });

    result.data = {
        success: true,
        message : "Send email reset password successfully",
        data: token
    };

    complete();

} catch (error) {

    log.error("Encryption error:", error);

    result.data = {
        success: false,
        error: error.message
    };

    complete();
}



// Function untuk hash text
async function hashToken(token) {

    // Convert string menjadi byte
    const data = new TextEncoder().encode(token);

    // Hash menggunakan SHA-256
    const hashBuffer = await crypto.subtle.digest(
        "SHA-256",
        data
    );

    // Convert hasil hash menjadi Hex
    const hashArray = Array.from(
        new Uint8Array(hashBuffer)
    );

    const hashHex = hashArray
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");

    return hashHex;
}