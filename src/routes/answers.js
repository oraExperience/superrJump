
const express = require('express');
const router = express.Router();
const answerController = require('../controllers/answerController');
const { authenticateToken } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

/**
 * @route   PATCH /api/answers/:id/verify
 * @desc    Verify an answer and update marks
 * @access  Private
 */
router.patch('/:id/verify', answerController.verifyAnswer);

/**
 * @route   GET /api/submissions/:submissionId/answers
 * @desc    Get all answers for a submission
 * @access  Private
 */
router.get('/submissions/:submissionId/answers', answerController.getSubmissionAnswers);

module.exports = router;
