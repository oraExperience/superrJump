
const emailjs = require('@emailjs/nodejs');

// Initialize EmailJS with your credentials
emailjs.init({
  publicKey: process.env.EMAILJS_PUBLIC_KEY,
  privateKey: process.env.EMAILJS_PRIVATE_KEY,
});

/**
 * Send OTP email for password reset using EmailJS
 * @param {string} email - Recipient email address
 * @param {string} otp - 6-digit OTP code
 * @param {string} userName - User's name
 * @returns {Promise<Object>} EmailJS response
 */
async function sendOTPEmail(email, otp, userName = 'User') {
  try {
    const templateParams = {
      to_email: email,
      user_name: userName,
      otp_code: otp,
      email: email, // For reply-to
    };

    const response = await emailjs.send(
      process.env.EMAILJS_SERVICE_ID,
      process.env.EMAILJS_TEMPLATE_ID,
      templateParams
    );

    console.log('OTP email sent successfully via EmailJS:', response);
    return { success: true, data: response };
  } catch (error) {
    console.error('Error sending OTP email via EmailJS:', error);
    throw new Error('Failed to send OTP email');
  }
}

/**
 * Send password reset confirmation email
 * @param {string} email - Recipient email address
 * @param {string} userName - User's name
 * @returns {Promise<Object>} Response
 */
async function sendPasswordResetConfirmation(email, userName = 'User') {
  // For now, we'll skip confirmation emails since we only have one template
  // You can create a second template for confirmation later
  console.log('Password reset confirmation - Email:', email, 'User:', userName);
  return { success: true, message: 'Confirmation email skipped (no template configured)' };
}

module.exports = {
  sendOTPEmail,
  sendPasswordResetConfirmation,
};
