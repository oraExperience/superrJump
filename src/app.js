
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

app.get('/assessments', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/assessments.html'));
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

app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/profile.html'));
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
