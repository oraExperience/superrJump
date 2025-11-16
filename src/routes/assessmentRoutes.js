
const express = require('express');
const router = express.Router();
const assessmentController = require('../controllers/assessmentController');
const { authenticateToken } = require('../middleware/auth');
const upload = require('../middleware/upload');

// All routes below require authentication
router.use(authenticateToken);

// Get assessment statistics
router.get('/stats', assessmentController.getAssessmentStats);

// Get all assessments for a user
router.get('/', assessmentController.getUserAssessments);

// AI Workflow Routes - Question Extraction and Approval

// Trigger AI question extraction from PDF
router.post('/:assessmentId/extract-questions', assessmentController.triggerQuestionExtraction);

// Get all questions for an assessment
router.get('/:assessmentId/questions', assessmentController.getAssessmentQuestions);

// Approve all questions (lock questions after verification)
router.post('/:assessmentId/approve-questions', assessmentController.approveQuestions);

// Update a specific question
router.put('/:assessmentId/questions/:questionId', assessmentController.updateQuestion);

// Verify a specific question
router.post('/:assessmentId/questions/:questionId/verify', assessmentController.verifyQuestion);

// Add a new question
router.post('/:assessmentId/questions', assessmentController.addQuestion);

// Delete a question
router.delete('/:assessmentId/questions/:questionId', assessmentController.deleteQuestion);

// Student Submission Routes

// Approve a student answer (most specific - must come first)
router.put('/:assessmentId/submissions/:studentId/answers/:answerId', assessmentController.approveStudentAnswer);

// Approve entire submission (all answers)
router.put('/:assessmentId/submissions/:studentId/approve', assessmentController.approveSubmission);

// Get student submission details with answers (must come first - most specific)
router.get('/:assessmentId/submissions/:studentId', assessmentController.getStudentSubmission);

// Get student submissions for an assessment
router.get('/:id/submissions', assessmentController.getAssessmentSubmissions);

// Upload PDF and create assessment with Google Drive integration
// MUST come before /:id route to avoid matching "upload" as an id
router.post('/upload', upload.single('questionPaper'), assessmentController.uploadPDFAndCreateAssessment);

// Create new assessment (without PDF upload - for backward compatibility)
router.post('/', assessmentController.createAssessment);

// Get single assessment by ID (must come after specific routes)
router.get('/:id', assessmentController.getAssessmentById);

// Update assessment
router.put('/:id', assessmentController.updateAssessment);

// Update assessment status
router.put('/:id/status', assessmentController.updateAssessmentStatus);

// Delete assessment
router.delete('/:id', assessmentController.deleteAssessment);

module.exports = router;
