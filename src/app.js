
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

console.log('=== INITIALIZING EXPRESS APP ===');

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

// Serve static files from root directory
app.use(express.static('.'));

// Serve uploaded files (PDFs, etc.)
const path = require('path');
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

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

module.exports = app;
