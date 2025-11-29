
const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authenticateToken } = require('../middleware/auth');

// All dashboard routes require authentication
router.use(authenticateToken);

// Get dashboard statistics
router.get('/stats', dashboardController.getDashboardStats);

// Get recent activity
router.get('/recent-activity', dashboardController.getRecentActivity);

module.exports = router;
