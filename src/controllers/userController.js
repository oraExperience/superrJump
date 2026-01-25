
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { generateToken } = require('../middleware/auth');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Login user
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find user by email
    const userQuery = 'SELECT * FROM users WHERE email = $1';
    const userResult = await pool.query(userQuery, [email]);

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = userResult.rows[0];

    // Compare password (column name in DB could be 'password' or 'password_hash')
    const passwordHash = user.password_hash || user.password;
    const isPasswordValid = await bcrypt.compare(password, passwordHash);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Generate JWT token
    const token = generateToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organisation: user.organisation,
      phone: user.phone
    });

    // Return user data (excluding password fields) and token
    const { password_hash, password: _, ...userData } = user;

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token: token,
      user: userData
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during login'
    });
  }
};

// Register new user
exports.register = async (req, res) => {
  try {
    const { name, email, password, organisation, role = 'user', user_image = null } = req.body;

    // Validate input
    if (!name || !email || !password || !organisation) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    // Check if user already exists
    const checkQuery = 'SELECT * FROM users WHERE email = $1';
    const checkResult = await pool.query(checkQuery, [email]);

    if (checkResult.rows.length > 0) {
      return res.status(409).json({ 
        success: false, 
        message: 'User with this email already exists' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user
    const insertQuery = `
      INSERT INTO users (name, email, password, organisation, role, user_image)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, email, organisation, role, user_image, created_at
    `;
    
    const insertResult = await pool.query(insertQuery, [
      name,
      email,
      hashedPassword,
      organisation,
      role,
      user_image
    ]);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: insertResult.rows[0]
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during registration'
    });
  }
};

// Generate random 10-character password
function generateRandomPassword(length = 10) {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

// Register user for free trial (from home page)
exports.registerFreeTrial = async (req, res) => {
  try {
    const { name, email, jobTitle, organisation, countryCode, phone, message } = req.body;

    // Validate input
    if (!name || !email || !organisation) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name, email, and organisation are required' 
      });
    }

    // Check if user already exists
    const checkQuery = 'SELECT * FROM users WHERE email = $1';
    const checkResult = await pool.query(checkQuery, [email]);

    if (checkResult.rows.length > 0) {
      return res.status(409).json({ 
        success: false, 
        message: 'An account with this email already exists. Please sign in instead.' 
      });
    }

    // Generate random password
    const randomPassword = generateRandomPassword(10);
    const hashedPassword = await bcrypt.hash(randomPassword, 10);

    // Calculate trial end date (6 days from now at 23:59:59)
    // Today counts as day 1, so we add 6 more days for a total of 7 days
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 6);
    trialEndDate.setHours(23, 59, 59, 999); // End of day

    // Insert new user with trial details
    const fullPhone = phone ? `${countryCode}${phone}` : null;
    
    const insertQuery = `
      INSERT INTO users (name, email, password, organisation, role, phone, trial_user, subscription_end, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING id, name, email, organisation, role, phone, created_at
    `;
    
    const insertResult = await pool.query(insertQuery, [
      name,
      email,
      hashedPassword,
      organisation,
      'user',  // Default role for free trial users
      fullPhone,
      true,    // trial_user flag = true for new trial users
      trialEndDate // subscription_end = 7 days at 23:59:59
    ]);

    const newUser = insertResult.rows[0];

    // Send welcome email with credentials
    const { sendWelcomeEmail } = require('../services/emailService');
    try {
      await sendWelcomeEmail(email, randomPassword, name);
      console.log(`Welcome email sent to ${email}`);
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
      // Don't fail the registration if email fails
    }

    res.status(201).json({
      success: true,
      message: 'Your free trial account has been created! Check your email for login credentials.',
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        organisation: newUser.organisation
      }
    });

  } catch (error) {
    console.error('Free trial registration error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during registration. Please try again.'
    });
  }
};



// Import email service (using Nodemailer)
const { sendOTPEmail, sendPasswordResetConfirmation } = require('../services/emailService');

// Generate 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send OTP for password reset
exports.sendResetOTP = async (req, res) => {
  try {
    const { email } = req.body;

    // Validate input
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Check if user exists
    const userQuery = 'SELECT id, name, email FROM users WHERE email = $1';
    const userResult = await pool.query(userQuery, [email]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email address'
      });
    }

    const user = userResult.rows[0];

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    // Store OTP in database
    const updateQuery = `
      UPDATE users
      SET reset_otp = $1,
          reset_otp_expires = $2,
          reset_otp_attempts = 0
      WHERE email = $3
    `;
    await pool.query(updateQuery, [otp, expiresAt, email]);

    // Send OTP email
    try {
      await sendOTPEmail(email, otp, user.name);
      
      res.status(200).json({
        success: true,
        message: 'OTP sent successfully to your email',
        email: email
      });
    } catch (emailError) {
      console.error('Email sending error:', emailError);
      
      // Clear OTP from database if email fails
      await pool.query('UPDATE users SET reset_otp = NULL, reset_otp_expires = NULL WHERE email = $1', [email]);
      
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTP email. Please try again.'
      });
    }

  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while sending OTP'
    });
  }
};

// Verify OTP
exports.verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Validate input
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required'
      });
    }

    // Get user with OTP details
    const userQuery = `
      SELECT id, email, reset_otp, reset_otp_expires, reset_otp_attempts
      FROM users
      WHERE email = $1
    `;
    const userResult = await pool.query(userQuery, [email]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = userResult.rows[0];

    // Check if OTP exists
    if (!user.reset_otp || !user.reset_otp_expires) {
      return res.status(400).json({
        success: false,
        message: 'No OTP request found. Please request a new OTP.'
      });
    }

    // Check if OTP has expired
    if (new Date() > new Date(user.reset_otp_expires)) {
      // Clear expired OTP
      await pool.query('UPDATE users SET reset_otp = NULL, reset_otp_expires = NULL WHERE email = $1', [email]);
      
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.'
      });
    }

    // Check attempts limit (max 5 attempts)
    if (user.reset_otp_attempts >= 5) {
      // Clear OTP after too many attempts
      await pool.query('UPDATE users SET reset_otp = NULL, reset_otp_expires = NULL, reset_otp_attempts = 0 WHERE email = $1', [email]);
      
      return res.status(429).json({
        success: false,
        message: 'Too many failed attempts. Please request a new OTP.'
      });
    }

    // Verify OTP
    if (user.reset_otp !== otp) {
      // Increment failed attempts
      await pool.query('UPDATE users SET reset_otp_attempts = reset_otp_attempts + 1 WHERE email = $1', [email]);
      
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP. Please try again.',
        attemptsRemaining: 5 - (user.reset_otp_attempts + 1)
      });
    }

    // OTP is valid - don't clear it yet, we'll clear it after password reset
    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      email: email
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while verifying OTP'
    });
  }
};

// Reset password after OTP verification
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    // Validate input
    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, OTP, and new password are required'
      });
    }

    // Validate password strength (minimum 6 characters)
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Get user with OTP details
    const userQuery = `
      SELECT id, name, email, reset_otp, reset_otp_expires
      FROM users
      WHERE email = $1
    `;
    const userResult = await pool.query(userQuery, [email]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = userResult.rows[0];

    // Verify OTP one more time
    if (!user.reset_otp || user.reset_otp !== otp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP. Please verify OTP again.'
      });
    }

    // Check if OTP has expired
    if (new Date() > new Date(user.reset_otp_expires)) {
      await pool.query('UPDATE users SET reset_otp = NULL, reset_otp_expires = NULL WHERE email = $1', [email]);
      
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear OTP fields
    const updateQuery = `
      UPDATE users
      SET password = $1,
          reset_otp = NULL,
          reset_otp_expires = NULL,
          reset_otp_attempts = 0
      WHERE email = $2
    `;
    await pool.query(updateQuery, [hashedPassword, email]);

    // Send confirmation email (non-blocking)
    sendPasswordResetConfirmation(email, user.name).catch(err => {
      console.error('Failed to send confirmation email:', err);
    });

    res.status(200).json({
      success: true,
      message: 'Password reset successfully. You can now login with your new password.'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while resetting password'
    });
  }
};
