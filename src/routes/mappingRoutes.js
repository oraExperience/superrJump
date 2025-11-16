
const express = require('express');
const router = express.Router();
const mappingController = require('../controllers/mappingController');
const { authenticateToken } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// Get user's class-subject mappings
router.get('/', mappingController.getUserMappings);

// Check if user has permission for specific class-subject
router.get('/check', mappingController.checkPermission);

module.exports = router;
