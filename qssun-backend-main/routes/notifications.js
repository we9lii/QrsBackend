const express = require('express');
const router = express.Router();
const db = require('../db.js');

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

module.exports = router;