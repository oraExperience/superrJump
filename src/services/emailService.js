
const { Resend } = require('resend');
const nodemailer = require('nodemailer');

// Helper to get email template HTML
const getEmailTemplate = (content) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Lexend', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; background-color: #ffffff; }
        .container { max-width: 600px; margin: 40px auto; background: white; padding: 40px 30px; }
        .logo-section { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 40px; text-align: center; }
        .logo { width: 48px; height: 48px; }
        .brand-name { font-size: 32px; font-weight: 800; color: #000000; letter-spacing: -0.5px; }
        .content { max-width: 500px; margin: 0 auto; }
        .greeting { font-size: 20px; font-weight: 700; margin-bottom: 20px; color: #000000; }
        .message { font-size: 16px; line-height: 1.6; color: #000000; margin-bottom: 30px; }
        .otp-box { background: white; border: 3px solid #2A6EBB; border-radius: 12px; padding: 35px 20px; text-align: center; margin: 30px 0; }
        .otp-code { font-size: 48px; font-weight: 800; color: #2A6EBB; letter-spacing: 12px; margin: 10px 0; font-family: 'Courier New', monospace; word-break: break-all; }
        .otp-expire { font-size: 14px; color: #000000; margin-top: 10px; }
        .success-box { background: #f0f8ff; border: 3px solid #2A6EBB; border-radius: 12px; padding: 30px 20px; text-align: center; margin: 30px 0; }
        .success-icon { font-size: 48px; margin-bottom: 15px; }
        .success-text { font-size: 18px; font-weight: 700; color: #2A6EBB; }
        .footer-text { font-size: 16px; color: #000000; margin-top: 30px; }
        .footer { background: white; padding: 20px; text-align: center; font-size: 13px; color: #000000; border-top: 1px solid #e0e0e0; }
        @media only screen and (max-width: 600px) {
            .container { margin: 20px; padding: 30px 20px; }
            .logo { width: 40px; height: 40px; }
            .brand-name { font-size: 24px; }
            .logo-section { margin-bottom: 30px; }
            .greeting { font-size: 18px; }
            .message { font-size: 15px; }
            .otp-box, .success-box { padding: 25px 15px; margin: 20px 0; }
            .otp-code { font-size: 36px; letter-spacing: 8px; }
            .otp-expire { font-size: 13px; }
            .success-text { font-size: 16px; }
            .footer-text { font-size: 15px; }
            .footer { font-size: 12px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo-section">
            <img src="https://superrjump.vercel.app/logo.png" alt="SuperrJump" class="logo" />
            <div class="brand-name">SuperrJump</div>
        </div>
        
        <div class="content">
            ${content}
            
            <p class="footer-text">
                Best regards,<br>
                <strong>The SuperrJump Team</strong>
            </p>
        </div>
        
        <div class="footer">
            <p>&copy; 2024 SuperrJump. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
`;

// Initialize transporters
let transporter = null;
let resend = null;

const emailPassword = process.env.EMAIL_APP_PASSWORD || process.env.EMAIL_PASSWORD;

if (process.env.EMAIL_USER && emailPassword) {
    // Option 1: Gmail/SMTP (Recommended for production without custom domain)
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: emailPassword
        }
    });
    console.log('✅ Email Service: Using Gmail SMTP');
} else if (process.env.RESEND_API_KEY) {
    // Option 2: Resend
    resend = new Resend(process.env.RESEND_API_KEY);
    console.log('✅ Email Service: Using Resend');
} else {
    console.warn('⚠️ No email configuration found. Emails will not be sent.');
}

/**
 * Send OTP email for password reset
 * @param {string} email - Recipient email address
 * @param {string} otp - 6-digit OTP code
 * @param {string} userName - User's name
 * @returns {Promise<Object>} Email response
 */
async function sendOTPEmail(email, otp, userName = 'User') {
    try {
        const html = getEmailTemplate(`
            <div class="greeting">Hi ${userName},</div>
            <p class="message">Use this verification code to reset your password:</p>
            <div class="otp-box">
                <div class="otp-code">${otp}</div>
                <div class="otp-expire">Valid for 10 minutes</div>
            </div>
        `);

        if (transporter) {
            const info = await transporter.sendMail({
                from: `"SuperrJump" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: 'Password Reset - OTP Verification',
                html: html
            });
            console.log('OTP email sent via SMTP:', info.messageId);
            return { success: true, messageId: info.messageId };
        } 
        else if (resend) {
            // Check if we have a custom domain configured, otherwise fall back to onboarding
            const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev';
            
            const response = await resend.emails.send({
                from: fromEmail,
                to: email,
                subject: 'Password Reset - OTP Verification',
                html: html
            });
            console.log('OTP email sent via Resend:', response.id);
            return { success: true, messageId: response.id };
        }
        else {
            throw new Error('No email service configured');
        }
    } catch (error) {
        console.error('Error sending OTP email:', error);
        throw new Error(`Failed to send OTP email: ${error.message}`);
    }
}

/**
 * Send password reset confirmation email
 * @param {string} email - Recipient email address
 * @param {string} userName - User's name
 * @returns {Promise<Object>} Response
 */
async function sendPasswordResetConfirmation(email, userName = 'User') {
    try {
        const html = getEmailTemplate(`
            <div class="greeting">Hi ${userName},</div>
            <p class="message">Your password has been successfully reset. You can now log in with your new password.</p>
            <div class="success-box">
                <div class="success-icon">✓</div>
                <div class="success-text">Password Reset Successful</div>
            </div>
            <p class="message">If you didn't make this change, please contact our support team immediately.</p>
        `);

        if (transporter) {
            const info = await transporter.sendMail({
                from: `"SuperrJump" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: 'Password Reset Successful',
                html: html
            });
            console.log('Confirmation email sent via SMTP:', info.messageId);
            return { success: true, messageId: info.messageId };
        }
        else if (resend) {
            const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev';
            
            const response = await resend.emails.send({
                from: fromEmail,
                to: email,
                subject: 'Password Reset Successful',
                html: html
            });
            console.log('Confirmation email sent via Resend:', response.id);
            return { success: true, messageId: response.id };
        }
        else {
            return { success: false, error: 'No email service configured' };
        }
    } catch (error) {
        console.error('Error sending confirmation email:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendOTPEmail,
    sendPasswordResetConfirmation,
};
