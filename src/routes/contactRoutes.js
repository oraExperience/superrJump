
const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');
const { authenticateToken } = require('../middleware/auth');

// Contact inquiry endpoint (requires authentication)
router.post('/inquiry', authenticateToken, contactController.sendInquiry);

module.exports = router;
