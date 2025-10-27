const express = require('express');
const router = express.Router();
const db = require('../db.js');

// We will require 'web-push' after installation.
let webpush;
try {
  webpush = require('web-push');
} catch (e) {
  console.warn('web-push module not installed yet. Install it to enable sending notifications.');
}

// Configure VAPID if available in env
const VAPID_PUBLIC = process.env.WEB_PUSH_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.WEB_PUSH_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.WEB_PUSH_SUBJECT || process.env.VAPID_SUBJECT || 'mailto:admin@qssun.solar';

function configureVapid() {
  if (webpush && VAPID_PUBLIC && VAPID_PRIVATE) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  }
}
configureVapid();

// POST /api/webpush/subscribe
// Accepts either { userId, subscription } or { userId, endpoint, keys, raw }
router.post('/webpush/subscribe', async (req, res) => {
  const { userId } = req.body || {};
  const subscription = req.body.subscription || null;
  const endpoint = subscription?.endpoint || req.body.endpoint;
  const keys = subscription?.keys || req.body.keys || {};
  const p256dh = keys?.p256dh || null;
  const auth = keys?.auth || null;
  const json = req.body.raw || (subscription ? JSON.stringify(subscription) : null);

  if (!userId || !endpoint) {
    return res.status(400).json({ message: 'userId and endpoint are required.' });
  }

  try {
    // Ensure table exists with correct schema
    await db.query(
      `CREATE TABLE IF NOT EXISTS web_push_subscriptions (
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
    );

    // Defensive: add missing columns if table pre-exists with older schema
    try {
      const [cols] = await db.query('SHOW COLUMNS FROM web_push_subscriptions');
      const names = new Set(cols.map(c => c.Field));
      if (!names.has('keys_auth')) {
        await db.query('ALTER TABLE web_push_subscriptions ADD COLUMN keys_auth VARCHAR(255) NULL');
      }
      if (!names.has('keys_p256dh')) {
        await db.query('ALTER TABLE web_push_subscriptions ADD COLUMN keys_p256dh VARCHAR(255) NULL');
      }
      if (!names.has('raw')) {
        await db.query('ALTER TABLE web_push_subscriptions ADD COLUMN raw TEXT NULL');
      }
    } catch (e) {
      console.warn('SHOW COLUMNS/ALTER TABLE failed:', e?.message || e);
    }

    // Ensure unique index uses endpoint(191) to avoid key length issues on utf8mb4
    try { await db.query('ALTER TABLE web_push_subscriptions DROP INDEX uniq_user_endpoint'); } catch (_) {}
    try { await db.query('ALTER TABLE web_push_subscriptions ADD UNIQUE INDEX uniq_user_endpoint (user_id, endpoint(191))'); } catch (_) {}

    await db.query(
      `INSERT INTO web_push_subscriptions (user_id, endpoint, keys_auth, keys_p256dh, raw)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE keys_auth = VALUES(keys_auth), keys_p256dh = VALUES(keys_p256dh), raw = VALUES(raw), updated_at = CURRENT_TIMESTAMP`,
      [userId, endpoint, auth, p256dh, json]
    );

    return res.status(200).json({ message: 'Subscription saved.' });
  } catch (error) {
    console.error('Error saving web push subscription:', error);
    return res.status(500).json({ message: 'Failed to save subscription.' });
  }
});

// POST /api/webpush/send
// Body: { userId: string, title?: string, body?: string, link?: string }
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
      `SELECT endpoint, keys_auth, keys_p256dh, raw FROM web_push_subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`,
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