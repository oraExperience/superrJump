
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticateToken } = require('../middleware/auth');

// All payment routes require authentication
router.post('/create-order', authenticateToken, paymentController.createOrder);
router.post('/verify', authenticateToken, paymentController.verifyPayment);
router.post('/record-failed', authenticateToken, paymentController.recordFailedPayment);
router.get('/subscription', authenticateToken, paymentController.getSubscription);

module.exports = router;
