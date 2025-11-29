
const jwt = require('jsonwebtoken');

// Secret key for JWT (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// Middleware to verify JWT token
exports.authenticateToken = (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (req.path.includes('/image')) {
      console.log(`🔐 Auth check for image: ${req.path}`);
      console.log(`   Authorization header: ${authHeader ? 'Present' : 'Missing'}`);
      console.log(`   Token: ${token ? token.substring(0, 20) + '...' : 'None'}`);
    }

    if (!token) {
      console.log(`   ❌ No token provided`);
      return res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
    }

    // Verify token
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        if (req.path.includes('/image')) {
          console.log(`   ❌ Token verification failed: ${err.message}`);
        }
        return res.status(403).json({
          success: false,
          message: 'Invalid or expired token'
        });
      }

      if (req.path.includes('/image')) {
        console.log(`   ✅ Token valid, user: ${JSON.stringify(user)}`);
      }

      // Add user info to request object
      req.user = user;
      next();
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Authentication error',
      error: error.message
    });
  }
};

// Generate JWT token
exports.generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organisation: user.organisation
    },
    JWT_SECRET,
    { expiresIn: '24h' } // Token expires in 24 hours
  );
};
