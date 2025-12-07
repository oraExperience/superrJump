
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// Login route
router.post('/login', userController.login);

// Register route
router.post('/register', userController.register);

// Forgot password routes
router.post('/forgot-password/send-otp', userController.sendResetOTP);
router.post('/forgot-password/verify-otp', userController.verifyOTP);
router.post('/forgot-password/reset-password', userController.resetPassword);

module.exports = router;
