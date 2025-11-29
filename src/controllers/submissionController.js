
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
 * Upload answer sheet - Automatically detects single or multiple students
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
        const allowedStatuses = ['Ready for Grading', 'Processing Ans', 'Ans Pending Approval', 'Completed'];
        if (!allowedStatuses.includes(assessment.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot upload answer sheets. Assessment status is "${assessment.status}". Questions must be approved first.`
            });
        }

        console.log(`📤 Saving answer sheet locally...`);

        // Save PDF locally
        const answerSheetLink = await fileStorage.saveAnswerSheet(
            req.file.buffer,
            assessmentId,
            req.file.originalname
        );

        console.log(`✅ Answer sheet saved at: ${answerSheetLink}`);
        
        // ALWAYS use multi-student detection (works for both single and multiple students)
        console.log('🔍 Detecting students in PDF (handles single or multiple)...');
        const multiStudentExtractionService = require('../services/multiStudentExtractionService');
        
        const analysisResult = await multiStudentExtractionService.analyzeMultiStudentPDF(
            answerSheetLink,
            {
                title: assessment.title,
                class: assessment.class,
                subject: assessment.subject
            }
        );

        const detectedStudents = analysisResult.students;
        console.log(`✅ Detected ${detectedStudents.length} student(s) in PDF`);

        // Handle based on number of students detected
        if (detectedStudents.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No students detected in the PDF. Please ensure the answer sheet has student information at the top.'
            });
        }

        if (detectedStudents.length === 1) {
            // SINGLE STUDENT - Use existing flow
            console.log('👤 Single student detected - using standard flow');
            const student = detectedStudents[0];

            // Create temporary submission record
            const submissionResult = await pool.query(
                `INSERT INTO student_submissions (
                    assessment_id, answer_sheet_link, status
                ) VALUES ($1, $2, 'Extracting')
                RETURNING id`,
                [assessmentId, answerSheetLink]
            );

            const submissionId = submissionResult.rows[0].id;

            // Start extraction and grading in background
            Promise.all([
                // Update with detected student info
                (async () => {
                    const matchingSuggestion = await studentMatchingService.suggestStudentAction(
                        {
                            student_name: student.student_name,
                            student_identifier: student.student_identifier,
                            roll_number: student.roll_number,
                            class: student.class,
                            subject: student.subject
                        },
                        organisation,
                        assessmentId
                    );
                    
                    await pool.query(
                        `UPDATE student_submissions
                         SET extracted_student_info = $1
                         WHERE id = $2`,
                        [JSON.stringify({ ...student, ...matchingSuggestion }), submissionId]
                    );
                    console.log(`✅ Student info updated for submission ${submissionId}`);
                    return true;
                })(),
                
                // Grade answers
                answerGradingService.gradeAnswerSheet(submissionId, assessmentId, answerSheetLink)
                    .then(result => {
                        console.log(`✅ AI grading completed for submission ${submissionId}`);
                        return true;
                    })
            ])
            .then(async () => {
                await pool.query(
                    `UPDATE student_submissions SET status = 'Ready for Verification' WHERE id = $1`,
                    [submissionId]
                );
                console.log(`✅ Submission ${submissionId} ready for verification`);
            })
            .catch(error => {
                console.error(`❌ Processing failed for submission ${submissionId}:`, error);
                pool.query(`UPDATE student_submissions SET status = 'Failed' WHERE id = $1`, [submissionId]);
            });

            // Update assessment status
            if (assessment.status === 'Ready for Grading' || assessment.status === 'Ans Pending Approval' || assessment.status === 'Completed') {
                await pool.query(
                    `UPDATE assessments SET status = 'Processing Ans', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [assessmentId]
                );
                console.log(`✅ Assessment ${assessmentId} status updated to "Processing Ans"`);
            }

            // Return for single student
            return res.status(201).json({
                success: true,
                message: 'Answer sheet uploaded. Redirecting to verification...',
                submissionId,
                assessmentId,
                redirectUrl: `/verify-grades?id=${submissionId}&assessment=${assessmentId}`
            });
        }

        // MULTIPLE STUDENTS - Auto-create all submissions
        console.log(`👥 Multiple students detected (${detectedStudents.length}) - creating submissions automatically`);
        
        const createdSubmissions = [];
        
        for (const student of detectedStudents) {
            try {
                // Match or create student
                const matchResult = await studentMatchingService.suggestStudentAction(
                    {
                        student_name: student.student_name,
                        student_identifier: student.student_identifier,
                        roll_number: student.roll_number
                    },
                    organisation,
                    assessmentId
                );

                let studentId = null;
                if (matchResult.action === 'select' && matchResult.matches.length > 0) {
                    studentId = matchResult.matches[0].id;
                    console.log(`✓ Matched ${student.student_name} to existing student ID: ${studentId}`);
                } else {
                    console.log(`⚠️ No matching student found for ${student.student_name} - creating submission with NULL student_id (teacher can assign later)`);
                }

                // Create submission (student_id can be null)
                const submission = await pool.query(
                    `INSERT INTO student_submissions (
                        assessment_id, student_id, answer_sheet_link,
                        extracted_student_info, page_numbers, status, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, 'Pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    RETURNING id`,
                    [
                        assessmentId,
                        studentId, // Can be null
                        answerSheetLink,
                        JSON.stringify({ ...student, ...matchResult }), // Store detected info
                        JSON.stringify(student.page_numbers) // Store page numbers as JSONB
                    ]
                );

                const submissionId = submission.rows[0].id;
                createdSubmissions.push({
                    submissionId,
                    student_name: student.student_name,
                    pages: student.page_numbers.join(', ')
                });

                // Start grading
                answerGradingService.gradeAnswerSheet(submissionId, assessmentId, answerSheetLink)
                    .catch(err => console.error(`❌ Grading failed for submission ${submissionId}:`, err));

            } catch (err) {
                console.error(`❌ Error creating submission for ${student.student_name}:`, err);
            }
        }

        // Update assessment status
        await pool.query(
            `UPDATE assessments SET status = 'Processing Ans', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [assessmentId]
        );

        return res.status(201).json({
            success: true,
            message: `Created ${createdSubmissions.length} submission(s) from multi-student PDF`,
            studentsDetected: detectedStudents.length,
            submissionsCreated: createdSubmissions,
            assessmentId
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
                ss.page_numbers,
                ss.extracted_student_info,
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

/**
 * Upload multi-student combined PDF and analyze
 * Phase 1: Analyze PDF and detect students
 * Returns detected students for confirmation
 */
exports.uploadMultiStudentPDF = async (req, res) => {
    try {
        const { assessmentId } = req.params;
        const userId = req.user.id;
        const organisation = req.user.organisation;

        console.log('📚 Multi-student PDF upload started');

        // Check if file was uploaded
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Combined answer sheet PDF is required'
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
        const allowedStatuses = ['Ready for Grading', 'Processing Ans', 'Ans Pending Approval', 'Completed'];
        if (!allowedStatuses.includes(assessment.status)) {
            return res.status(400).json({
                success: false,
                message: `Assessment must be in 'Ready for Grading' status. Current status: ${assessment.status}`
            });
        }

        console.log('📤 Uploading combined PDF to storage...');

        // Upload PDF to storage
        const pdfUrl = await fileStorage.uploadFile(
            req.file.buffer,
            `answer-sheets/${assessmentId}/multi-student-${Date.now()}.pdf`,
            'application/pdf'
        );

        console.log(`✅ PDF uploaded: ${pdfUrl}`);
        console.log('🔍 Starting AI analysis to detect students...');

        // Import the multi-student extraction service
        const multiStudentExtractionService = require('../services/multiStudentExtractionService');

        // Analyze PDF to detect students
        const analysisResult = await multiStudentExtractionService.analyzeMultiStudentPDF(
            pdfUrl,
            {
                title: assessment.title,
                class: assessment.class,
                subject: assessment.subject
            }
        );

        // Validate the analysis results
        const validation = multiStudentExtractionService.validateStudentGroupings(
            analysisResult.students,
            {
                minPagesPerStudent: 1,
                maxPagesPerStudent: 20,
                minConfidence: 0.5
            }
        );

        console.log(`✅ Analysis complete: ${analysisResult.studentsDetected} students detected`);

        // Return analysis results for user confirmation
        res.status(200).json({
            success: true,
            message: `Detected ${analysisResult.studentsDetected} student(s) in the PDF`,
            data: {
                pdfUrl,
                totalPages: analysisResult.totalPages,
                studentsDetected: analysisResult.studentsDetected,
                students: validation.students.map((student, index) => ({
                    index,
                    student_name: student.student_name,
                    student_identifier: student.student_identifier,
                    roll_number: student.roll_number,
                    page_start: student.page_start,
                    page_end: student.page_end,
                    total_pages: student.total_pages,
                    confidence: Math.round(student.avg_confidence * 100)
                })),
                warnings: validation.warnings,
                isValid: validation.isValid
            }
        });

    } catch (error) {
        console.error('❌ Multi-student PDF upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to analyze multi-student PDF',
            error: error.message
        });
    }
};

/**
 * Create submissions from multi-student PDF analysis
 * Phase 2: User confirms detected students, create individual submissions
 */
exports.createMultiStudentSubmissions = async (req, res) => {
    try {
        const { assessmentId } = req.params;
        const { pdfUrl, students } = req.body;
        const userId = req.user.id;
        const organisation = req.user.organisation;

        console.log(`📝 Creating ${students.length} submissions from multi-student PDF`);

        // Verify assessment exists
        const assessmentResult = await pool.query(
            `SELECT id, title FROM assessments WHERE id = $1 AND created_by = $2`,
            [assessmentId, userId]
        );

        if (assessmentResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Assessment not found or access denied'
            });
        }

        const createdSubmissions = [];
        const errors = [];

        // Create submission for each student
        for (const studentData of students) {
            try {
                console.log(`👤 Processing student: ${studentData.student_name} (Pages ${studentData.page_start}-${studentData.page_end})`);

                // Try to match existing student or create new one
                const studentMatchingService = require('../services/studentMatchingService');
                
                const matchResult = await studentMatchingService.suggestStudentAction({
                    student_name: studentData.student_name,
                    student_identifier: studentData.student_identifier,
                    roll_number: studentData.roll_number
                }, organisation);

                let studentId;

                if (matchResult.action === 'select' && matchResult.matches.length > 0) {
                    // Use existing student (first match)
                    studentId = matchResult.matches[0].id;
                    console.log(`✓ Matched to existing student ID: ${studentId}`);
                } else {
                    // Create new student
                    const newStudentResult = await pool.query(
                        `INSERT INTO students (
                            student_identifier, student_name, organisation, 
                            roll_number, created_at, updated_at
                        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        RETURNING id`,
                        [
                            studentData.student_identifier || `TEMP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            studentData.student_name,
                            organisation,
                            studentData.roll_number
                        ]
                    );
                    studentId = newStudentResult.rows[0].id;
                    console.log(`✓ Created new student ID: ${studentId}`);
                }

                // Create submission with page range
                const submissionResult = await pool.query(
                    `INSERT INTO student_submissions (
                        assessment_id, student_id, answer_sheet_link, 
                        source_pdf_link, page_start, page_end,
                        is_multi_student_upload, status,
                        created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    RETURNING id`,
                    [
                        assessmentId,
                        studentId,
                        pdfUrl, // Same PDF for all
                        pdfUrl, // Source PDF
                        studentData.page_start,
                        studentData.page_end,
                        true, // is_multi_student_upload
                        'Pending' // Will be graded automatically
                    ]
                );

                const submissionId = submissionResult.rows[0].id;

                console.log(`✅ Created submission ${submissionId} for student ${studentData.student_name}`);

                // Start AI grading asynchronously
                const answerGradingService = require('../services/answerGradingService');
                answerGradingService.gradeAnswerSheet(submissionId, assessmentId, pdfUrl)
                    .then(result => {
                        console.log(`✅ Grading completed for submission ${submissionId}`);
                    })
                    .catch(error => {
                        console.error(`❌ Grading failed for submission ${submissionId}:`, error);
                    });

                createdSubmissions.push({
                    submissionId,
                    studentId,
                    student_name: studentData.student_name,
                    pages: `${studentData.page_start}-${studentData.page_end}`
                });

            } catch (studentError) {
                console.error(`❌ Error processing student ${studentData.student_name}:`, studentError);
                errors.push({
                    student_name: studentData.student_name,
                    error: studentError.message
                });
            }
        }

        // Update assessment status if needed
        if (createdSubmissions.length > 0) {
            await pool.query(
                `UPDATE assessments SET status = 'Processing Ans', updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND status = 'Ready for Grading'`,
                [assessmentId]
            );
        }

        res.status(201).json({
            success: true,
            message: `Created ${createdSubmissions.length} submission(s) successfully`,
            data: {
                created: createdSubmissions,
                errors: errors.length > 0 ? errors : undefined,
                totalCreated: createdSubmissions.length,
                totalErrors: errors.length
            }
        });

    } catch (error) {
        console.error('❌ Create multi-student submissions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create submissions',
            error: error.message
        });
    }
};



module.exports = exports;
