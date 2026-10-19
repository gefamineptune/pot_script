const jwt = modules.jsonwebtoken;


// JWT CONFIG
const JWT_CONFIG = {
    algorithm: "HS256",
    secret: await vault.decrypt("JWT-SIGNING-SECRET"),
    issuer: "neptune-dxp-app",
    expiresInSeconds: 28800 // 8 jam
};



// AMBIL DATA DARI REQUEST BODY
const username = req.body.username;


// VALIDASI REQUEST
if (!username) {

    result.status = 400;
    result.data = {
        success: false,
        message: "username is required"
    };

    complete();
    return;
}



// function GENERATE JWT
function generateJWT() {

    const payload = {
        username: username
    };

    return jwt.sign(
        payload,
        JWT_CONFIG.secret,
        {
            algorithm: JWT_CONFIG.algorithm,
            issuer: JWT_CONFIG.issuer,
            expiresIn: JWT_CONFIG.expiresInSeconds
        }
    );
}



// function untuk create token response
async function createTokenResponse() {

    try {

        const token = generateJWT();

        return {
            status: 200,
            body: {
                success: true,
                message: "Create token successful",
                access_token: token,
                token_type: "Bearer",
                expires_in: JWT_CONFIG.expiresInSeconds
            }
        };

    } catch (error) {

        console.error("Generate JWT error:", error);

        return {
            status: 500,
            body: {
                success: false,
                message: "Something went wrong. Please try again."
            }
        };
    }
}



// EXECUTE
const feedback = await createTokenResponse();

result.status = feedback.status;
result.data = feedback.body;

complete();