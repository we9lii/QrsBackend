const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.js');
const reportRoutes = require('./reports');
const userRoutes = require('./users');
const branchRoutes = require('./branches');
const workflowRoutes = require('./workflows');
const teamRoutes = require('./teams');
const notificationRoutes = require('./notifications');
const fcmRoutes = require('./fcm');
const packageRoutes = require('./packages');
const webpushRoutes = require('./webpush');
const purchaseRoutes = require('./purchases');

router.use(authRoutes);
router.use(reportRoutes);
router.use(userRoutes);
router.use(branchRoutes);
router.use(workflowRoutes);
router.use(teamRoutes);
router.use(notificationRoutes);
router.use(fcmRoutes);
router.use(webpushRoutes);
router.use(packageRoutes);
router.use(purchaseRoutes);

module.exports = router;
