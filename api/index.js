
// api/index.js - Vercel serverless function entry point with debug logging

module.exports = async (req, res) => {
  console.log('=== SERVERLESS FUNCTION INVOKED ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    console.log('OPTIONS request - returning 200');
    res.status(200).end();
    return;
  }

  try {
    console.log('Checking environment variables...');
    
    // Check DATABASE_URL
    if (!process.env.DATABASE_URL) {
      console.error('ERROR: DATABASE_URL is not set');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error: DATABASE_URL is missing',
        debug: 'DATABASE_URL environment variable is not configured'
      });
    }
    console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'SET (length: ' + process.env.DATABASE_URL.length + ')' : 'NOT SET');

    // Check JWT_SECRET
    if (!process.env.JWT_SECRET) {
      console.error('ERROR: JWT_SECRET is not set');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error: JWT_SECRET is missing',
        debug: 'JWT_SECRET environment variable is not configured'
      });
    }
    console.log('JWT_SECRET:', process.env.JWT_SECRET ? 'SET (length: ' + process.env.JWT_SECRET.length + ')' : 'NOT SET');

    console.log('Loading Express app...');
    const app = require('../src/app');
    console.log('Express app loaded successfully');
    
    // Reconstruct the original URL from Vercel's path rewrite
    const path = req.query.path || '';
    if (path) {
      // Remove the path query parameter and reconstruct the URL
      const url = new URL(req.url, `http://${req.headers.host}`);
      url.searchParams.delete('path');
      req.url = `/api/${path}${url.search}`;
      console.log('Reconstructed URL:', req.url);
    }
    
    console.log('Passing request to Express app...');
    return app(req, res);
    
  } catch (error) {
    console.error('=== FATAL ERROR IN SERVERLESS FUNCTION ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    });
  }
};
