try {

    const {text} = req.body;

    const SECRET_KEY = await vault.decrypt("SECRET-KEY-ENCRYPTION-POT")

    // const encryptedString = "48f3925f823b5877377574da:e7b13adbb8e0ad634924d73d4d0869a07225ea5e5ab63aeabf77b7";


    // Pisahkan IV dan Cipher
    const [ivHex, cipherHex] = text.split(":");


    // Convert Secret Key dari Hex menjadi Uint8Array
    const keyBytes = Uint8Array.from(
        SECRET_KEY.match(/.{2}/g).map(byte => parseInt(byte, 16))
    );

  
    // Convert IV dari Hex menjadi Uint8Array
    const iv = Uint8Array.from(
        ivHex.match(/.{2}/g).map(byte => parseInt(byte, 16))
    );


    // Convert Cipher dari Hex menjadi Uint8Array
    const cipherBytes = Uint8Array.from(
        cipherHex.match(/.{2}/g).map(byte => parseInt(byte, 16))
    );


    // Import Secret Key
    const key = await crypto.subtle.importKey(

        // Format key berupa byte biasa.
        "raw",

        // Byte Secret Key.
        keyBytes,

        // Algoritma yang digunakan.
        {
            name: "AES-GCM"
        },

        // Key tidak boleh diexport kembali.
        false,

        // Key hanya digunakan untuk decrypt.
        ["decrypt"]

    );


    // Decrypt
    const decrypted = await crypto.subtle.decrypt(

        {
            name: "AES-GCM",
            iv
        },

        key,

        // Cipher Text
        cipherBytes

    );


    // Convert Byte menjadi String
    const decryptedText = new TextDecoder().decode(decrypted);

    // console.log("ini : ",password);

    result.data = {
        success: true,
        decrypted : decryptedText
    };

    complete();

} catch (err) {

    result.data = {
        success: false,
        error: err.message
    };

    complete();

}