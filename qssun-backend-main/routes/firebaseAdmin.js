const admin = require('firebase-admin');

function initializeFirebase() {
    if (admin.apps.length > 0) {
        return;
    }

    try {
        const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
        if (!serviceAccountKey) {
            console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT_KEY is not set. Skipping Firebase Admin initialization for local/dev.');
            return; // Do not block the server when Firebase is not configured
        }

        const serviceAccount = JSON.parse(serviceAccountKey);

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });

        console.log('✅ Firebase Admin SDK initialized successfully.');

    } catch (error) {
        console.error('❌ Firebase Admin SDK initialization failed:', error.message);
        console.warn('Continuing without Firebase Admin (non-critical for basic API).');
    }
}

module.exports = {
    initializeFirebase,
    admin // Export the initialized admin object
};