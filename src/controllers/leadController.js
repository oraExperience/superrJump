
const pool = require('../config/database');

/**
 * Submit a new lead
 */
const submitLead = async (req, res) => {
  try {
    const { name, email, jobTitle, organisation, countryCode, phone, message } = req.body;

    // Validate required fields
    if (!name || !email || !jobTitle || !organisation || !phone || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    // Validate email format
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid email format' 
      });
    }

    // Validate phone number (should be 10 digits)
    if (phone.length !== 10 || !/^\d+$/.test(phone)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number must be exactly 10 digits' 
      });
    }

    // Validate message length
    if (message.length < 10) {
      return res.status(400).json({ 
        success: false, 
        message: 'Message must be at least 10 characters' 
      });
    }

    // Combine country code and phone number
    const fullPhone = (countryCode || '+91') + phone;

    // Insert into database (PostgreSQL syntax)
    const query = `
      INSERT INTO leads (name, email, job_title, organisation, phone, message, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING id
    `;

    const values = [name, email, jobTitle, organisation, fullPhone, message];
    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Lead submitted successfully',
      leadId: result.rows[0].id
    });

  } catch (error) {
    console.error('Error submitting lead:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Get all leads (for admin purposes)
 */
const getAllLeads = async (req, res) => {
  try {
    const query = 'SELECT * FROM leads ORDER BY created_at DESC';
    const result = await pool.query(query);

    res.json({
      success: true,
      count: result.rows.length,
      leads: result.rows
    });

  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  submitLead,
  getAllLeads
};
