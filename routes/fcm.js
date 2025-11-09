const express = require('express');
const router = express.Router();
const { saveTokenToDatabase } = require('./pushService');

// POST /api/fcm-token
router.post('/', async (req, res) => {
    const { userId, token } = req.body;

    if (!userId || !token) {
        return res.status(400).json({ message: 'User ID and FCM token are required.' });
    }

    try {
        await saveTokenToDatabase(userId, token);
        res.status(200).json({ message: 'Token registered successfully.' });
    } catch (error) {
        console.error('Error registering FCM token:', error);
        res.status(500).json({ message: 'Failed to register FCM token.' });
    }
});

module.exports = router;
