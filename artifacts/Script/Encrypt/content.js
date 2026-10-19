try {

    const {text} = req.body;

    // Secret Key 32 byte (256-bit) dalam format Hex.
    const SECRET_KEY = await vault.decrypt("SECRET-KEY-ENCRYPTION-POT")


    // const text = "Password123";

  
    // Convert Secret Key (Hex String) menjadi Uint8Array
    const keyBytes = Uint8Array.from(
        SECRET_KEY.match(/.{2}/g).map(byte => parseInt(byte, 16))
    );

  
    // Import Secret Key ke Web Crypto API
    const key = await crypto.subtle.importKey(

        // Format key yang diberikan berupa byte biasa.
        "raw",

        // Byte hasil konversi di atas.
        keyBytes,

        // Algoritma yang digunakan.
        {
            name: "AES-GCM"
        },

        // false artinya key tidak bisa diexport lagi.
        false,

        // Key ini hanya boleh digunakan untuk Encrypt.
        ["encrypt"]

    );

    
    // Generate IV (Initialization Vector)
    const iv = crypto.getRandomValues(new Uint8Array(12));

   
    // Encrypt 
    const encrypted = await crypto.subtle.encrypt(

        {
            // Algoritma
            name: "AES-GCM",

            // IV yang tadi dibuat
            iv
        },

        // Secret Key
        key,

        // plain text harus diubah menjadi byte.
        new TextEncoder().encode(text)

    );

   
    // Convert IV menjadi Hex String
    // Contoh: Uint8Array[18,255,100] menjadi "12ff64"
    const ivHex = Array.from(iv)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");

    
    // Convert Cipher menjadi Hex String
    const cipherHex = Array.from(new Uint8Array(encrypted))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");

   
    // Gabungkan IV + Cipher
    const encryptedString = ivHex + ":" + cipherHex;

    console.log(encryptedString);

    result.data = {
        success: true,

        // Hasil encrypt 
        encrypted: encryptedString
    };

    complete();

} catch (err) {


    result.data = {
        success: false,
        error: err.message
    };

    complete();

}