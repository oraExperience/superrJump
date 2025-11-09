
const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController');

// POST route to submit a new lead
router.post('/submit', leadController.submitLead);

// GET route to fetch all leads (admin)
router.get('/all', leadController.getAllLeads);

module.exports = router;
