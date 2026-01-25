
const emailService = require('../services/emailService');

/**
 * Send contact inquiry email
 */
exports.sendInquiry = async (req, res) => {
  try {
    const { message, source, userEmail, userName, userOrganization } = req.body;

    // Validate required fields
    if (!message || !source) {
      return res.status(400).json({ 
        error: 'Message and source are required' 
      });
    }

    // Get user info from authenticated request
    const authenticatedUser = req.user;

    // Send inquiry email to admin
    await emailService.sendInquiryToAdmin({
      message,
      source,
      userEmail: userEmail || authenticatedUser.email,
      userName: userName || authenticatedUser.name,
      userRole: authenticatedUser.role,
      userPhone: authenticatedUser.phone,
      userOrganization: userOrganization || authenticatedUser.organisation || 'Not specified',
      userId: authenticatedUser.id
    });

    res.status(200).json({ 
      message: 'Inquiry sent successfully' 
    });

  } catch (error) {
    console.error('Error sending inquiry:', error);
    res.status(500).json({ 
      error: 'Failed to send inquiry',
      details: error.message 
    });
  }
};
