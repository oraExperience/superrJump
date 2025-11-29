
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
      organisation: user.organisation
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
