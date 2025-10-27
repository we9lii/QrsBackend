const express = require('express');
const router = express.Router();
const db = require('../db.js');
const { sendPushNotification } = require('./pushService');
let webpush;
try { webpush = require('web-push'); } catch (_) { webpush = null; }
const VAPID_PUBLIC = process.env.WEB_PUSH_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.WEB_PUSH_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.WEB_PUSH_SUBJECT || process.env.VAPID_SUBJECT || 'mailto:admin@qssun.solar';
if (webpush && VAPID_PUBLIC && VAPID_PRIVATE) {
  try { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE); } catch (_) {}
}

// GET /api/notifications/:userId - Fetch notifications for a user
router.get('/notifications/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const [rows] = await db.query(
            `SELECT id, message, link, is_read, created_at
             FROM notifications 
             WHERE user_id = ? 
             ORDER BY created_at DESC 
             LIMIT 50`, [userId]
        );
        const notifications = rows.map(n => ({ 
            id: n.id.toString(),
            message: n.message,
            link: n.link,
            isRead: !!n.is_read,
            createdAt: n.created_at,
        }));
        res.json(notifications);
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ message: 'Failed to fetch notifications.' });
    }
});

// POST /api/notifications/read/:userId - Mark all as read
router.post('/notifications/read/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        await db.query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [userId]);
        res.status(200).json({ message: 'Notifications marked as read.' });
    } catch (error) {
        console.error('Error marking notifications as read:', error);
        res.status(500).json({ message: 'Failed to mark notifications as read.' });
    }
});

// POST /api/notifications/send - Send notification to a user or all
router.post('/notifications/send', async (req, res) => {
  const { title = 'إشعار', message, type = 'all', targetUserId, link = '/' } = req.body || {};

  if (!message) {
    return res.status(400).json({ message: 'message is required.' });
  }

  try {
    // Removed table creation to avoid DDL issues on some environments
    // Assume notifications table exists as per schema initialization

    let recipientIds = [];
    if (type === 'user') {
      if (!targetUserId) {
        return res.status(400).json({ message: 'targetUserId is required for type=user.' });
      }
      recipientIds = [String(targetUserId)];
    } else {
      const [users] = await db.query('SELECT id FROM users');
      recipientIds = users.map(u => String(u.id));
    }

    // Dispatch: in-app DB insert + FCM + WebPush
    for (const uid of recipientIds) {
      try {
        await db.query('INSERT INTO notifications (user_id, message, link, is_read) VALUES (?, ?, ?, 0)', [uid, message, link]);
      } catch (e) {
        console.warn('Failed to insert notification for user', uid, e?.message || e);
      }

      // FCM (mobile app)
      try {
        await sendPushNotification(uid, title, message, { link });
      } catch (e) {
        console.warn('FCM send failed for user', uid, e?.message || e);
      }

      // WebPush (PWA/web)
      if (webpush && VAPID_PUBLIC && VAPID_PRIVATE) {
        try {
          const [rows] = await db.query(
            'SELECT endpoint, keys_auth, keys_p256dh, raw FROM web_push_subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
            [uid]
          );
          if (rows && rows.length > 0) {
            const r = rows[0];
            let subscription;
            try {
              subscription = r.raw ? JSON.parse(r.raw) : { endpoint: r.endpoint, keys: { auth: r.keys_auth, p256dh: r.keys_p256dh } };
            } catch (_) {
              subscription = { endpoint: r.endpoint, keys: { auth: r.keys_auth, p256dh: r.keys_p256dh } };
            }
            const payload = JSON.stringify({ title, body: message, link });
            await webpush.sendNotification(subscription, payload);
          }
        } catch (err) {
          console.warn(`WebPush send failed for user ${uid}:`, err?.message || err);
        }
      }
    }

    return res.status(200).json({ message: 'Notifications dispatched.', count: recipientIds.length });
  } catch (error) {
    console.error('Error in POST /notifications/send:', error);
    return res.status(500).json({ message: 'Failed to send notifications.' });
  }
});

module.exports = router;