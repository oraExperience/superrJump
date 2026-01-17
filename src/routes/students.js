const express = require('express');
const router = express.Router();
const multer = require('multer');
const studentsController = require('../controllers/studentsController');
const auth = require('../middleware/auth');

/**
 * @route   GET /api/students/sample-file
 * @desc    Download sample XLSX file
 * @access  Public
 */
router.get('/sample-file', studentsController.downloadSample);

// All routes require authentication
router.use(auth.authenticateToken);

/**
 * @route   GET /api/students
 * @desc    Get all students for organisation
 * @access  Private
 */
router.get('/', studentsController.getAllStudents);

/**
 * @route   GET /api/students/search
 * @desc    Search students by query
 * @access  Private
 */
router.get('/search', studentsController.searchStudents);

/**
 * @route   GET /api/students/:id/submissions
 * @desc    Get all submissions for a specific student
 * @access  Private
 */
router.get('/:id/submissions', studentsController.getStudentSubmissions);

/**
 * @route   GET /api/students/:id/topic-analysis
 * @desc    Get topic-level performance analysis for a student
 * @access  Private
 */
router.get('/:id/topic-analysis', studentsController.getTopicAnalysis);

/**
 * @route   GET /api/students/:id/improvement-plan
 * @desc    Get improvement plan for a student
 * @access  Private
 */
router.get('/:id/improvement-plan', studentsController.getImprovementPlan);

/**
 * @route   GET /api/students/:id
 * @desc    Get single student by ID
 * @access  Private
 */
router.get('/:id', studentsController.getStudent);

/**
 * @route   POST /api/students
 * @desc    Create a new student
 * @access  Private
 */
router.post('/', studentsController.createStudent);

/**
 * @route   PATCH /api/students/:id
 * @desc    Update student details
 * @access  Private
 */
router.patch('/:id', studentsController.updateStudent);

/**
 * @route   DELETE /api/students/:id
 * @desc    Delete a student
 * @access  Private
 */
router.delete('/:id', studentsController.deleteStudent);

/**
 * @route   POST /api/students/bulk-upload
 * @desc    Bulk upload students via XLSX
 * @access  Private
 */
const upload = multer({ storage: multer.memoryStorage() });
router.post('/bulk-upload', upload.single('file'), studentsController.bulkUploadStudents);



module.exports = router;
