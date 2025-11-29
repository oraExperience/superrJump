
const pool = require('../config/database');

/**
 * Verify an answer and update verified marks
 * PATCH /api/answers/:id/verify
 */
async function verifyAnswer(req, res) {
    try {
        const { id } = req.params;
        const { verified, marks_obtained, ai_explanation, user_feedback } = req.body;
        const userId = req.user.id;

        // Verify user has access to this answer via submission and assessment
        const accessCheck = await pool.query(
            `SELECT a.id, a.submission_id, s.assessment_id, s.status as submission_status
             FROM answers a
             JOIN student_submissions s ON a.submission_id = s.id
             JOIN assessments ass ON s.assessment_id = ass.id
             WHERE a.id = $1 AND ass.created_by = $2`,
            [id, userId]
        );

        if (accessCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Answer not found or access denied'
            });
        }

        const { submission_id, assessment_id, submission_status } = accessCheck.rows[0];

        // Update answer with editable fields
        // - ai_explanation: preserve (use COALESCE to keep existing if not provided)
        // - user_feedback: always update when provided (teacher's feedback)
        await pool.query(
            `UPDATE answers
             SET verified = COALESCE($1, verified),
                 marks_obtained = COALESCE($2, marks_obtained),
                 ai_explanation = COALESCE($3, ai_explanation),
                 user_feedback = COALESCE($4, user_feedback),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $5`,
            [verified, marks_obtained, ai_explanation, user_feedback, id]
        );

        // If an answer is being unverified (verified = false), handle status cascading
        if (verified === false) {
            // Check if any answer in this submission is now unverified
            const unverifiedCheck = await pool.query(
                `SELECT COUNT(*) as unverified_count
                 FROM answers
                 WHERE submission_id = $1 AND verified = false`,
                [submission_id]
            );

            const unverifiedCount = parseInt(unverifiedCheck.rows[0].unverified_count);

            // If any answer is unverified and submission was "Approved", revert to "Verifying"
            if (unverifiedCount > 0 && submission_status === 'Approved') {
                await pool.query(
                    `UPDATE student_submissions
                     SET status = 'Verifying', updated_at = CURRENT_TIMESTAMP
                     WHERE id = $1`,
                    [submission_id]
                );

                console.log(`⚠️ Answer ${id} unverified. Submission ${submission_id} status reverted from "Approved" to "Verifying"`);

                // Check if assessment was "Completed" - if so, revert to "Ans Pending Approval"
                const assessmentCheck = await pool.query(
                    `SELECT status FROM assessments WHERE id = $1`,
                    [assessment_id]
                );

                if (assessmentCheck.rows.length > 0 && assessmentCheck.rows[0].status === 'Completed') {
                    await pool.query(
                        `UPDATE assessments
                         SET status = 'Ans Pending Approval', updated_at = CURRENT_TIMESTAMP
                         WHERE id = $1`,
                        [assessment_id]
                    );

                    console.log(`⚠️ Assessment ${assessment_id} status reverted from "Completed" to "Ans Pending Approval" due to answer unverification`);
                }
            }
        }

        res.json({
            success: true,
            message: 'Answer verified successfully'
        });

    } catch (error) {
        console.error('Error verifying answer:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to verify answer',
            error: error.message
        });
    }
}

/**
 * Get all answers for a submission
 * GET /api/submissions/:submissionId/answers
 */
async function getSubmissionAnswers(req, res) {
    try {
        const { submissionId } = req.params;
        const userId = req.user.id;

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

        // Get all answers with question details
        const result = await pool.query(
            `SELECT
                a.id,
                a.marks_obtained,
                a.ai_explanation,
                a.user_feedback,
                a.page_number,
                a.verified,
                q.question_number,
                q.question_text,
                q.question_identifier,
                q.max_marks
             FROM answers a
             JOIN questions q ON a.question_id = q.id
             WHERE a.submission_id = $1
             ORDER BY q.question_number`,
            [submissionId]
        );

        res.json({
            success: true,
            answers: result.rows
        });

    } catch (error) {
        console.error('Error fetching answers:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch answers',
            error: error.message
        });
    }
}

module.exports = {
    verifyAnswer,
    getSubmissionAnswers
};
