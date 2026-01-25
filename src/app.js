
// Only load dotenv in local development, not in Vercel
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

console.log('=== INITIALIZING EXPRESS APP ===');
console.log('Environment:', process.env.NODE_ENV);
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('JWT_SECRET exists:', !!process.env.JWT_SECRET);

console.log('Loading routes...');
const leadRoutes = require('./routes/leadRoutes');
console.log('leadRoutes loaded');
const userRoutes = require('./routes/userRoutes');
console.log('userRoutes loaded');
const assessmentRoutes = require('./routes/assessmentRoutes');
console.log('assessmentRoutes loaded');
const mappingRoutes = require('./routes/mappingRoutes');
console.log('mappingRoutes loaded');
const submissionRoutes = require('./routes/submissions');
console.log('submissionRoutes loaded');
const studentRoutes = require('./routes/students');
console.log('studentRoutes loaded');
const answerRoutes = require('./routes/answers');
console.log('answerRoutes loaded');
const dashboardRoutes = require('./routes/dashboardRoutes');
console.log('dashboardRoutes loaded');
const proxyRoutes = require('./routes/proxyRoutes');
console.log('proxyRoutes loaded');
const contactRoutes = require('./routes/contactRoutes');
console.log('contactRoutes loaded');
const paymentRoutes = require('./routes/paymentRoutes');
console.log('paymentRoutes loaded');

console.log('Creating Express app...');
const app = express();
console.log('Express app created');

// Middleware setup
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Disable ETag generation
app.set('etag', false);

// Middleware to disable caching for API routes
app.use('/api', (req, res, next) => {
  delete req.headers['if-modified-since'];
  delete req.headers['if-none-match'];
  
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Last-Modified': '',
    'ETag': ''
  });
  next();
});

// Serve static files from public directory
const path = require('path');
app.use(express.static(path.join(__dirname, '../public')));

// Also serve from root for backward compatibility
app.use(express.static(path.join(__dirname, '..')));

// Serve uploaded files (PDFs, etc.)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Mount API routes
app.use('/api/leads', leadRoutes);
app.use('/api/users', userRoutes);
app.use('/api/assessments', assessmentRoutes);
app.use('/api/mappings', mappingRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/answers', answerRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/proxy', proxyRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api', submissionRoutes);

// Security Headers Middleware
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  // HSTS (HTTP Strict Transport Security)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  
  next();
});

// SSR route for home page (SEO optimized)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/home.html'), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
    }
  });
});

app.get('/home', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/home.html'), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
    }
  });
});

// Health check endpoints for UptimeRobot monitoring
// Simple root-level health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'SuperrJump',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Detailed API health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'SuperrJump API',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
    }
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({ message: 'SuperrJump API server is running' });
});

// Root route handler - redirect to home page
app.get('/', (req, res) => {
  res.redirect('/home');
});

// Redirect .html URLs to clean URLs
app.get('/*.html', (req, res) => {
  const cleanUrl = req.path.replace('.html', '');
  res.redirect(301, cleanUrl);
});

// Clean URL routes (without .html extension)
app.get('/home', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/home.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.get('/forgot-password', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/forgot-password.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

app.get('/assessments', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/assessments.html'));
});

app.get('/students', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/students.html'));
});

app.get('/student-submissions', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/student-submissions.html'));
});

app.get('/assessment-details', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/assessment-details.html'));
});

app.get('/create-assessment', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/create-assessment.html'));
});

app.get('/student-review', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/student-review.html'));
});

app.get('/verify-questions', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/verify-questions.html'));
});

app.get('/verify-grades', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/verify-grades.html'));
});

app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/profile.html'));
});

app.get('/plans', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/plans.html'));
});

app.get('/payment', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/payment.html'));
});

app.get('/payment-callback', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/payment-callback.html'));
});

// 404 Handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// 404 Handler for other routes
app.use((req, res) => {
  res.status(404).send('Page not found');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

module.exports = app;
