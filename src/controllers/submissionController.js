
const { Pool } = require('pg');
const answerGradingService = require('../services/answerGradingService');
const studentExtractionService = require('../services/studentExtractionService');
const studentMatchingService = require('../services/studentMatchingService');
const fileStorage = require('../utils/fileStorage');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Upload answer sheet and create temporary submission
 * Opens verify-grades page where user confirms student, then grading starts
 */
exports.uploadAnswerSheetNew = async (req, res) => {
    try {
        const { assessmentId } = req.params;
        const userId = req.user.id;
        const organisation = req.user.organisation;

        // Check if file was uploaded
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Answer sheet PDF is required'
            });
        }

        // Verify assessment exists and get details
        const assessmentResult = await pool.query(
            `SELECT id, title, class, subject, status FROM assessments
             WHERE id = $1 AND created_by = $2`,
            [assessmentId, userId]
        );

        if (assessmentResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Assessment not found or access denied'
            });
        }

        const assessment = assessmentResult.rows[0];

        // Check if assessment is in correct status
        // Allow uploads for: Ready for Grading, Processing Ans, Ans Pending Approval, Completed
        const allowedStatuses = ['Ready for Grading', 'Processing Ans', 'Ans Pending Approval', 'Completed'];
        if (!allowedStatuses.includes(assessment.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot upload answer sheets. Assessment status is "${assessment.status}". Questions must be approved first.`
            });
        }

        console.log(`📤 Saving answer sheet locally...`);

        // Save PDF locally (like question papers)
        const answerSheetLink = await fileStorage.saveAnswerSheet(
            req.file.buffer,
            assessmentId,
            req.file.originalname
        );

        console.log(`✅ Answer sheet saved at: ${answerSheetLink}`);

        // Create temporary submission record with status "Extracting"
        const submissionResult = await pool.query(
            `INSERT INTO student_submissions (
                assessment_id, answer_sheet_link, status
            ) VALUES ($1, $2, 'Extracting')
            RETURNING id`,
            [assessmentId, answerSheetLink]
        );

        const submissionId = submissionResult.rows[0].id;

        // Extract student information using AI (async, don't wait)
        const assessmentContext = {
            assessmentTitle: assessment.title,
            className: assessment.class,
            subject: assessment.subject
        };

        // Start BOTH extraction and grading in background
        Promise.all([
            // Task 1: Extract student info
            studentExtractionService.extractStudentInfo(answerSheetLink, assessmentContext)
                .then(async (extractedInfo) => {
                    // Find matching students (excluding those with approved submissions for this assessment)
                    const matchingSuggestion = await studentMatchingService.suggestStudentAction(
                        extractedInfo,
                        organisation,
                        assessmentId
                    );
                    
                    // Update submission with extracted info
                    await pool.query(
                        `UPDATE student_submissions
                         SET extracted_student_info = $1
                         WHERE id = $2`,
                        [JSON.stringify({ ...extractedInfo, ...matchingSuggestion }), submissionId]
                    );

                    console.log(`✅ Student extraction completed for submission ${submissionId}`);
                    return true;
                }),
            
            // Task 2: Grade answers
            answerGradingService.gradeAnswerSheet(submissionId, assessmentId, answerSheetLink)
                .then(result => {
                    console.log(`✅ AI grading completed for submission ${submissionId}:`, result);
                    return true;
                })
        ])
        .then(async ([extractionDone, gradingDone]) => {
            // Both tasks completed successfully
            await pool.query(
                `UPDATE student_submissions
                 SET status = 'Ready for Verification'
                 WHERE id = $1`,
                [submissionId]
            );
            console.log(`✅ Submission ${submissionId} ready for verification`);
        })
        .catch(error => {
            console.error(`❌ Processing failed for submission ${submissionId}:`, error);
            pool.query(
                `UPDATE student_submissions SET status = 'Failed' WHERE id = $1`,
                [submissionId]
            );
        });

        // Update assessment status to "Processing Ans" when answer sheet uploaded
        // This happens for: Ready for Grading, Ans Pending Approval, or Completed
        if (assessment.status === 'Ready for Grading' ||
            assessment.status === 'Ans Pending Approval' ||
            assessment.status === 'Completed') {
            await pool.query(
                `UPDATE assessments SET status = 'Processing Ans', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [assessmentId]
            );
            console.log(`✅ Assessment ${assessmentId} status updated from "${assessment.status}" to "Processing Ans"`);
        }

        // Return immediately with submission ID - user goes to verify-grades page
        res.status(201).json({
            success: true,
            message: 'Answer sheet uploaded. Redirecting to verification...',
            submissionId,
            assessmentId,
            redirectUrl: `/verify-grades?id=${submissionId}&assessment=${assessmentId}`
        });

    } catch (error) {
        console.error('Upload answer sheet error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload answer sheet',
            error: error.message
        });
    }
};

/**
 * Confirm student for submission
 * Called from verify-grades page after user confirms student match
 * Grading is already done at this point
 */
exports.confirmStudentAndStartGrading = async (req, res) => {
    try {
        const { submissionId } = req.params;
        const { student_id } = req.body;
        const userId = req.user.id;

        // Validate input
        if (!student_id) {
            return res.status(400).json({
                success: false,
                message: 'student_id is required'
            });
        }

        // Get submission details
        const submissionCheck = await pool.query(
            `SELECT s.id, s.assessment_id, s.answer_sheet_link, s.status
             FROM student_submissions s
             JOIN assessments a ON s.assessment_id = a.id
             WHERE s.id = $1 AND a.created_by = $2`,
            [submissionId, userId]
        );

        if (submissionCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Submission not found or access denied'
            });
        }

        const submission = submissionCheck.rows[0];

        // Verify student exists and belongs to organisation
        const studentCheck = await pool.query(
            `SELECT id, student_name FROM students
             WHERE id = $1 AND organisation = $2`,
            [student_id, req.user.organisation]
        );

        if (studentCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        const student = studentCheck.rows[0];

        console.log(`👤 Confirming student ${student.student_name} for submission ${submissionId}`);

        // Check if this student already has an approved submission for this assessment
        const duplicateCheck = await pool.query(
            `SELECT id, student_id FROM student_submissions
             WHERE assessment_id = $1 AND student_id = $2 AND status = 'Approved' AND id != $3`,
            [submission.assessment_id, student_id, submissionId]
        );

        if (duplicateCheck.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: `This student already has an approved submission for this assessment. Each student can only have one approved submission per assessment.`
            });
        }

        // Update submission with confirmed student
        // Status should already be "Ready for Verification" from the upload process
        await pool.query(
            `UPDATE student_submissions
             SET student_id = $1, status = 'Verifying'
             WHERE id = $2`,
            [student_id, submissionId]
        );

        res.status(200).json({
            success: true,
            message: 'Student confirmed. Ready for verification.',
            submission: {
                id: submissionId,
                student_id,
                student_name: student.student_name,
                status: 'Verifying'
            }
        });

    } catch (error) {
        console.error('Confirm student error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to confirm student',
            error: error.message
        });
    }
};

/**
 * Upload answer sheet and create submission (LEGACY - for backward compatibility)
 */
exports.uploadAnswerSheet = async (req, res) => {
    try {
        const { assessmentId } = req.params;
        const { student_id, student_name } = req.body;
        const userId = req.user.id;

        // Validate input
        if (!student_id || !student_name) {
            return res.status(400).json({
                success: false,
                message: 'Student ID and name are required'
            });
        }

        // Check if file was uploaded
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Answer sheet PDF is required'
            });
        }

        // Verify assessment exists and user has access
        const assessmentCheck = await pool.query(
            `SELECT id, status, title FROM assessments WHERE id = $1 AND created_by = $2`,
            [assessmentId, userId]
        );

        if (assessmentCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Assessment not found or access denied'
            });
        }

        const assessment = assessmentCheck.rows[0];

        // Check if assessment is in correct status
        // Allow uploads for: Ready for Grading, Processing Ans, Ans Pending Approval, Completed
        const allowedStatuses = ['Ready for Grading', 'Processing Ans', 'Ans Pending Approval', 'Completed'];
        if (!allowedStatuses.includes(assessment.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot upload answer sheets. Assessment status is "${assessment.status}". Questions must be approved first.`
            });
        }

        console.log(`📤 Uploading answer sheet for ${student_name} (${student_id})`);

        // Upload PDF to Google Drive
        const answerSheetFileName = `${assessment.title}_${student_id}_${student_name}_${Date.now()}.pdf`;
        const answerSheetLink = await googleDriveService.uploadFile(
            req.file.buffer,
            answerSheetFileName,
            'application/pdf'
        );

        console.log(`✅ Answer sheet uploaded to: ${answerSheetLink}`);

        // Create or update student submission
        const submissionResult = await pool.query(
            `INSERT INTO student_submissions (
                assessment_id, student_id, answer_sheet_link, status
            ) VALUES ($1, $2, $3, 'Pending')
            ON CONFLICT (assessment_id, student_id)
            DO UPDATE SET
                answer_sheet_link = EXCLUDED.answer_sheet_link,
                status = 'Pending',
                updated_at = CURRENT_TIMESTAMP
            RETURNING id`,
            [assessmentId, student_id, answerSheetLink]
        );

        const submissionId = submissionResult.rows[0].id;

        // Update assessment status to "Processing Ans" when answer sheet uploaded
        // This happens for: Ready for Grading, Ans Pending Approval, or Completed
        if (assessment.status === 'Ready for Grading' ||
            assessment.status === 'Ans Pending Approval' ||
            assessment.status === 'Completed') {
            await pool.query(
                `UPDATE assessments SET status = 'Processing Ans', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [assessmentId]
            );
            console.log(`✅ Assessment ${assessmentId} status updated from "${assessment.status}" to "Processing Ans"`);
        }

        // Start AI grading asynchronously
        console.log(`🤖 Starting AI grading for submission ${submissionId}...`);
        answerGradingService.gradeAnswerSheet(submissionId, assessmentId, answerSheetLink)
            .then(result => {
                console.log(`✅ AI grading completed for submission ${submissionId}:`, result);
            })
            .catch(error => {
                console.error(`❌ AI grading failed for submission ${submissionId}:`, error);
            });

        res.status(201).json({
            success: true,
            message: 'Answer sheet uploaded successfully. AI grading in progress...',
            submission: {
                id: submissionId,
                student_id,
                student_name,
                status: 'Pending'
            }
        });

    } catch (error) {
        console.error('Upload answer sheet error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload answer sheet',
            error: error.message
        });
    }
};

/**
 * Get all submissions for an assessment
 */
exports.getSubmissions = async (req, res) => {
    try {
        const { assessmentId } = req.params;
        const userId = req.user.id;

        // Verify user has access to this assessment
        const accessCheck = await pool.query(
            `SELECT id FROM assessments WHERE id = $1 AND created_by = $2`,
            [assessmentId, userId]
        );

        if (accessCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Assessment not found or access denied'
            });
        }

        // Fetch all submissions
        // Calculate marks from answers table instead of storing redundantly
        const result = await pool.query(
            `SELECT
                ss.id,
                ss.student_id,
                s.student_name,
                ss.answer_sheet_link,
                ss.status,
                COALESCE(
                  (SELECT SUM(a.marks_obtained)
                   FROM answers a
                   WHERE a.submission_id = ss.id),
                  0
                ) as total_marks_obtained,
                (SELECT total_marks FROM assessments WHERE id = ss.assessment_id) as total_marks_possible,
                CASE
                  WHEN (SELECT total_marks FROM assessments WHERE id = ss.assessment_id) > 0
                  THEN ROUND(
                    (COALESCE((SELECT SUM(a.marks_obtained) FROM answers a WHERE a.submission_id = ss.id), 0) /
                     (SELECT total_marks FROM assessments WHERE id = ss.assessment_id) * 100)::numeric,
                    2
                  )
                  ELSE 0
                END as percentage,
                ss.created_at,
                ss.updated_at
             FROM student_submissions ss
             LEFT JOIN students s ON ss.student_id = s.id
             WHERE ss.assessment_id = $1
             ORDER BY created_at DESC`,
            [assessmentId]
        );

        res.status(200).json({
            success: true,
            submissions: result.rows
        });

    } catch (error) {
        console.error('Get submissions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch submissions',
            error: error.message
        });
    }
};

/**
 * Get detailed grades for a specific submission
 */
exports.getSubmissionDetails = async (req, res) => {
    try {
        const { submissionId } = req.params;
        const userId = req.user.id;

        // Fetch submission with access check
        // Calculate marks from answers table instead of storing redundantly
        const submissionResult = await pool.query(
            `SELECT
                ss.id,
                ss.assessment_id,
                ss.student_id,
                st.student_name,
                ss.answer_sheet_link,
                ss.status,
                COALESCE(
                  (SELECT SUM(ans.marks_obtained)
                   FROM answers ans
                   WHERE ans.submission_id = ss.id),
                  0
                ) as total_marks_obtained,
                a.total_marks as total_marks_possible,
                CASE
                  WHEN a.total_marks > 0
                  THEN ROUND(
                    (COALESCE((SELECT SUM(ans.marks_obtained) FROM answers ans WHERE ans.submission_id = ss.id), 0) /
                     a.total_marks * 100)::numeric,
                    2
                  )
                  ELSE 0
                END as percentage,
                ss.created_at,
                ss.updated_at,
                a.title as assessment_title,
                a.class,
                a.subject
             FROM student_submissions ss
             JOIN assessments a ON ss.assessment_id = a.id
             LEFT JOIN students st ON ss.student_id = st.id
             WHERE ss.id = $1 AND a.created_by = $2`,
            [submissionId, userId]
        );

        if (submissionResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Submission not found or access denied'
            });
        }

        const submission = submissionResult.rows[0];

        // Fetch detailed answers/grades
        const grades = await answerGradingService.getSubmissionGrades(submissionId);

        res.status(200).json({
            success: true,
            submission,
            grades
        });

    } catch (error) {
        console.error('Get submission details error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch submission details',
            error: error.message
        });
    }
};

/**
 * Update submission status (approve/reject)
 */
exports.updateSubmissionStatus = async (req, res) => {
    try {
        const { submissionId } = req.params;
        const { status } = req.body;
        const userId = req.user.id;

        // Validate status
        const validStatuses = ['Approved', 'Rejected', 'Pending'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Must be one of: Approved, Rejected, Pending'
            });
        }

        // Verify access
        const accessCheck = await pool.query(
            `SELECT s.id 
             FROM student_submissions s
             JOIN assessments a ON s.assessment_id = a.id
             WHERE s.id = $1 AND a.created_by = $2`,
            [submissionId, userId]
        );

        if (accessCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Submission not found or access denied'
            });
        }

        // Get assessment_id and student_id for this submission
        const submissionResult = await pool.query(
            `SELECT assessment_id, student_id FROM student_submissions WHERE id = $1`,
            [submissionId]
        );
        const { assessment_id: assessmentId, student_id } = submissionResult.rows[0];

        // If approving, check if this student already has another approved submission
        if (status === 'Approved' && student_id) {
            const duplicateCheck = await pool.query(
                `SELECT id FROM student_submissions
                 WHERE assessment_id = $1 AND student_id = $2 AND status = 'Approved' AND id != $3`,
                [assessmentId, student_id, submissionId]
            );

            if (duplicateCheck.rows.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `This student already has an approved submission for this assessment. Each student can only have one approved submission per assessment.`
                });
            }
        }

        // Update status
        await pool.query(
            `UPDATE student_submissions
             SET status = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [status, submissionId]
        );

        // If status is "Approved", check if ALL submissions for this assessment are now approved
        if (status === 'Approved') {
            const allSubmissionsCheck = await pool.query(
                `SELECT COUNT(*) as total,
                        COUNT(CASE WHEN status = 'Approved' THEN 1 END) as approved
                 FROM student_submissions
                 WHERE assessment_id = $1`,
                [assessmentId]
            );

            const { total, approved } = allSubmissionsCheck.rows[0];

            // If all submissions are approved, update assessment status to "Completed"
            if (parseInt(total) > 0 && parseInt(total) === parseInt(approved)) {
                await pool.query(
                    `UPDATE assessments
                     SET status = 'Completed', updated_at = CURRENT_TIMESTAMP
                     WHERE id = $1`,
                    [assessmentId]
                );
                console.log(`✅ All submissions approved for assessment ${assessmentId}. Status updated to "Completed"`);
            }
        }

        res.status(200).json({
            success: true,
            message: `Submission status updated to ${status}`
        });

    } catch (error) {
        console.error('Update submission status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update submission status',
            error: error.message
        });
    }
};

/**
 * Delete a submission
 */
exports.deleteSubmission = async (req, res) => {
    try {
        const { submissionId } = req.params;
        const userId = req.user.id;

        // Verify access and get submission details
        const submissionResult = await pool.query(
            `SELECT s.id, s.answer_sheet_link
             FROM student_submissions s
             JOIN assessments a ON s.assessment_id = a.id
             WHERE s.id = $1 AND a.created_by = $2`,
            [submissionId, userId]
        );

        if (submissionResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Submission not found or access denied'
            });
        }

        // Delete submission (answers will be deleted automatically via CASCADE)
        await pool.query(
            `DELETE FROM student_submissions WHERE id = $1`,
            [submissionId]
        );

        res.status(200).json({
            success: true,
            message: 'Submission deleted successfully'
        });

    } catch (error) {
        console.error('Delete submission error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete submission',
            error: error.message
        });
    }
};

module.exports = exports;
