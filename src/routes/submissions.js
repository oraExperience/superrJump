
const express = require('express');
const router = express.Router();
const multer = require('multer');
const submissionController = require('../controllers/submissionController');
const { authenticateToken } = require('../middleware/auth');
const checkActiveSubscription = require('../middleware/checkSubscription');

// Configure multer for file upload (memory storage)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    },
    fileFilter: (req, file, cb) => {
        // Only accept PDF files
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

// New flow: Upload answer sheet and redirect to verify-grades
// Protected: Requires active subscription
router.post(
    '/assessments/:assessmentId/submissions/upload',
    authenticateToken,
    checkActiveSubscription,
    upload.single('answer_sheet'),
    submissionController.uploadAnswerSheetNew
);

// Confirm student and start grading (from verify-grades page)
// NOT protected - This is a continuation of an already uploaded answer sheet
router.post(
    '/submissions/:submissionId/confirm-student',
    authenticateToken,
    submissionController.confirmStudentAndStartGrading
);

// Multi-student PDF upload routes
// Protected: Requires active subscription (actual file upload)
router.post(
    '/assessments/:assessmentId/submissions/upload-multi',
    authenticateToken,
    checkActiveSubscription,
    upload.single('answer_sheet'),
    submissionController.uploadMultiStudentPDF
);

// Create multi-student submissions (no file upload, just DB records)
// NOT protected - just creates submission records
router.post(
    '/assessments/:assessmentId/submissions/create-multi',
    authenticateToken,
    submissionController.createMultiStudentSubmissions
);

// LEGACY: Old upload flow for backward compatibility
// Protected: Requires active subscription
router.post(
    '/assessments/:assessmentId/submissions',
    authenticateToken,
    checkActiveSubscription,
    upload.single('answer_sheet'),
    submissionController.uploadAnswerSheet
);

// Get all submissions for an assessment
router.get(
    '/assessments/:assessmentId/submissions',
    authenticateToken,
    submissionController.getSubmissions
);

// Get detailed grades for a specific submission
router.get(
    '/submissions/:submissionId',
    authenticateToken,
    submissionController.getSubmissionDetails
);

// Get detailed question-level analysis for a submission
router.get(
    '/submissions/:submissionId/questions',
    authenticateToken,
    require('../controllers/studentsController').getSubmissionQuestions
);

// Update submission status
router.patch(
    '/submissions/:submissionId/status',
    authenticateToken,
    submissionController.updateSubmissionStatus
);

// Delete a submission
router.delete(
    '/submissions/:submissionId',
    authenticateToken,
    submissionController.deleteSubmission
);

module.exports = router;
