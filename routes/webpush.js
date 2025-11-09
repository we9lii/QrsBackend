const express = require('express');
const router = express.Router();
const db = require('../db.js');

let webpush;
try {
  webpush = require('web-push');
} catch (e) {
  console.warn('web-push module not installed yet. Install it to enable sending notifications.');
}

const VAPID_PUBLIC = process.env.WEB_PUSH_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.WEB_PUSH_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.WEB_PUSH_SUBJECT || process.env.VAPID_SUBJECT || 'mailto:admin@qssun.solar';

function configureVapid() {
  if (webpush && VAPID_PUBLIC && VAPID_PRIVATE) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  }
}
configureVapid();

// Ensure table exists and required columns present
async function ensureTable() {
  const createSQL = `
    CREATE TABLE IF NOT EXISTS web_push_subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      endpoint VARCHAR(1024) NOT NULL,
      keys_auth VARCHAR(255) NULL,
      keys_p256dh VARCHAR(255) NULL,
      raw TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_endpoint (user_id, endpoint(191)),
      INDEX(user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await db.query(createSQL);

  // Check and add missing columns in a portable way
  const checkAndAdd = async (colName, colDef) => {
    const [rows] = await db.query(`SHOW COLUMNS FROM web_push_subscriptions LIKE '${colName}'`);
    if (!rows || rows.length === 0) {
      await db.query(`ALTER TABLE web_push_subscriptions ADD COLUMN ${colDef}`);
    }
  };
  await checkAndAdd('keys_auth', 'keys_auth VARCHAR(255) NULL');
  await checkAndAdd('keys_p256dh', 'keys_p256dh VARCHAR(255) NULL');
  await checkAndAdd('raw', 'raw TEXT NULL');
}

// POST /api/webpush/subscribe
router.post('/webpush/subscribe', async (req, res) => {
  const { userId, subscription } = req.body || {};
  if (!userId || !subscription || !subscription.endpoint) {
    return res.status(400).json({ message: 'userId and subscription.endpoint are required.' });
  }
  try {
    await ensureTable();

    const endpoint = subscription.endpoint;
    const keys = subscription.keys || {};
    const p256dh = keys.p256dh || null;
    const auth = keys.auth || null;
    const json = JSON.stringify(subscription);

    const insertSQL = `
      INSERT INTO web_push_subscriptions (user_id, endpoint, keys_auth, keys_p256dh, raw)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        endpoint = VALUES(endpoint),
        keys_auth = VALUES(keys_auth),
        keys_p256dh = VALUES(keys_p256dh),
        raw = VALUES(raw),
        updated_at = CURRENT_TIMESTAMP
    `;
    await db.query(insertSQL, [userId, endpoint, auth, p256dh, json]);

    return res.status(200).json({ message: 'Subscription saved.' });
  } catch (error) {
    console.error('Error saving web push subscription:', error);
    return res.status(500).json({ message: 'Failed to save subscription.' });
  }
});

// POST /api/webpush/send
router.post('/webpush/send', async (req, res) => {
  if (!webpush) {
    return res.status(500).json({ message: 'web-push not installed on server.' });
  }
  const { userId, title = 'إشعار', body = 'لديك إشعار جديد', link = '/' } = req.body || {};
  if (!userId) return res.status(400).json({ message: 'userId is required.' });
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return res.status(500).json({ message: 'VAPID keys missing. Set WEB_PUSH_PUBLIC_KEY/WEB_PUSH_PRIVATE_KEY.' });
  }
  try {
    const [rows] = await db.query(
      'SELECT endpoint, keys_auth, keys_p256dh, raw FROM web_push_subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
      [userId]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ message: 'No web push subscription found for user.' });
    }
    const subRow = rows[0];
    let subscription;
    try {
      subscription = subRow.raw ? JSON.parse(subRow.raw) : { endpoint: subRow.endpoint, keys: { auth: subRow.keys_auth, p256dh: subRow.keys_p256dh } };
    } catch (_) {
      subscription = { endpoint: subRow.endpoint, keys: { auth: subRow.keys_auth, p256dh: subRow.keys_p256dh } };
    }

    const payload = JSON.stringify({ title, body, link });
    await webpush.sendNotification(subscription, payload);
    return res.status(200).json({ message: 'Notification sent.' });
  } catch (error) {
    console.error('Error sending web push:', error);
    return res.status(500).json({ message: 'Failed to send notification.' });
  }
});

module.exports = router;
