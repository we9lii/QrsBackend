const admin = require('./firebaseAdmin').admin; // Ensure we get the initialized admin object
const db = require('../db.js');
const fetch = require('node-fetch');

/**
 * Saves or updates a user's FCM token in the database.
 * Uses an UPSERT to avoid duplicate key errors and noisy logs.
 * @param {string} userId The ID of the user.
 * @param {string} token The FCM token from the device.
 */
async function saveTokenToDatabase(userId, token) {
    try {
        await db.query(
            `INSERT INTO fcm_tokens (user_id, token, updated_at)
             VALUES (?, ?, NOW())
             ON DUPLICATE KEY UPDATE updated_at = NOW()`,
            [userId, token]
        );
        console.log(`FCM token saved/updated for user ${userId}`);
    } catch (error) {
        console.error(`Error saving FCM token for user ${userId}:`, error);
        throw error;
    }
}

/**
 * Sends a push notification to a specific user.
 * @param {string} userId The ID of the user to notify.
 * @param {string} title The title of the notification.
 * @param {string} body The body text of the notification.
 * @param {object} data The data payload to send with the notification (e.g., for navigation).
 */
async function sendPushNotification(userId, title, body, data = {}) {
    try {
        const [rows] = await db.query('SELECT token FROM fcm_tokens WHERE user_id = ?', [userId]);
        
        if (rows.length === 0) {
            console.log(`No FCM tokens found for user ${userId}. Skipping push notification.`);
            return;
        }

        const tokens = rows.map(row => row.token);
        // Fallback: use FCM legacy server key if Admin SDK is not initialized
        if (!(admin && admin.apps && admin.apps.length > 0)) {
            const serverKey = process.env.FCM_SERVER_KEY;
            if (!serverKey) {
                console.warn('FCM_SERVER_KEY not configured and Firebase Admin not initialized. Skipping push notification.');
                return;
            }
            await sendViaLegacyFCM(tokens, title, body, data, userId);
            return;
        }

        const message = {
            notification: { title, body },
            data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' }, // Standard field for Capacitor
            tokens: tokens,
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        
        console.log(`Push notification sent to user ${userId}. Success: ${response.successCount}, Failure: ${response.failureCount}`);

        if (response.failureCount > 0) {
            const failures = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    failures.push(handleFailedToken(tokens[idx], resp.error));
                }
            });
            await Promise.all(failures);
        }

    } catch (error) {
        console.error(`Error sending push notification to user ${userId}:`, error);
    }
}

async function sendViaLegacyFCM(tokens, title, body, data, userId) {
    try {
        const payload = {
            registration_ids: tokens,
            notification: { title, body },
            data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' }
        };

        const res = await fetch('https://fcm.googleapis.com/fcm/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `key=${process.env.FCM_SERVER_KEY}`
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Legacy FCM request failed: ${text}`);
        }

        const result = await res.json();
        console.log(`Legacy FCM sent to user ${userId}. Success: ${result.success}, Failure: ${result.failure}`);

        if (result.failure > 0 && Array.isArray(result.results)) {
            const failures = [];
            result.results.forEach((item, idx) => {
                if (item && item.error) {
                    const mapped = mapLegacyErrorCode(item.error);
                    failures.push(handleFailedToken(tokens[idx], { code: mapped, message: item.error }));
                }
            });
            await Promise.all(failures);
        }
    } catch (error) {
        console.error(`Error sending legacy FCM to user ${userId}:`, error);
    }
}

function mapLegacyErrorCode(error) {
    switch (error) {
        case 'InvalidRegistration': return 'messaging/invalid-registration-token';
        case 'NotRegistered': return 'messaging/registration-token-not-registered';
        default: return error || 'unknown';
    }
}async function handleFailedToken(token, error) {
    console.warn(`Failed to send to token: ${token}`, error.message);
    const invalidTokenCodes = [
        'messaging/invalid-registration-token',
        'messaging/registration-token-not-registered'
    ];
    if (invalidTokenCodes.includes(error.code)) {
        try {
            await db.query('DELETE FROM fcm_tokens WHERE token = ?', [token]);
            console.log(`Removed invalid FCM token: ${token}`);
        } catch (dbError) {
            console.error(`Error removing invalid FCM token ${token}:`, dbError);
        }
    }
}

module.exports = {
    saveTokenToDatabase,
    sendPushNotification,
};


