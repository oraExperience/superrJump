
const pool = require('../config/database');
const openaiVisionParser = require('./openaiVisionParser');
const googleDriveService = require('./googleDriveService');

/**
 * Grade a student's answer sheet using AI
 * @param {number} submissionId - Student submission ID
 * @param {number} assessmentId - Assessment ID
 * @param {string} answerSheetLink - Link to student's answer sheet PDF
 */
async function gradeAnswerSheet(submissionId, assessmentId, answerSheetLink) {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎯 ANSWER SHEET GRADING - STARTING');
        console.log('='.repeat(80));
        console.log('📝 Submission ID:', submissionId);
        console.log('📋 Assessment ID:', assessmentId);
        console.log('📂 Answer Sheet:', answerSheetLink);
        console.log('⏰ Start Time:', new Date().toISOString());
        console.log('='.repeat(80) + '\n');

        // Update submission status to "Processing"
        console.log('🔄 Updating submission status to "Processing"...');
        await pool.query(
            `UPDATE student_submissions
             SET status = 'Processing', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [submissionId]
        );
        console.log('✅ Status updated');

        // Fetch assessment details
        console.log('\n📋 Fetching assessment details...');
        const assessmentResult = await pool.query(
            `SELECT title, class, subject FROM assessments WHERE id = $1`,
            [assessmentId]
        );

        if (assessmentResult.rows.length === 0) {
            throw new Error('Assessment not found');
        }

        const assessment = assessmentResult.rows[0];

        // Fetch all questions for this assessment
        const questionsResult = await pool.query(
            `SELECT id, question_number, question_text, question_identifier, max_marks, topics
             FROM questions
             WHERE assessment_id = $1
             ORDER BY question_number`,
            [assessmentId]
        );

        const questions = questionsResult.rows;

        if (questions.length === 0) {
            throw new Error('No questions found for this assessment');
        }

        console.log(`📝 Found ${questions.length} questions to grade`);

        // Prepare the grading prompt for AI with assessment context
        const gradingPrompt = buildGradingPrompt(questions, assessment);

        // Call AI service to grade the answer sheet
        console.log(`🤖 Calling AI service to grade answer sheet...`);
        const gradingResults = await callAIGradingService(gradingPrompt, answerSheetLink, questions);

        // Store individual answer grades in the answers table
        let totalMarksObtained = 0;
        let totalMarksPossible = 0;

        for (const question of questions) {
            const answerGrade = gradingResults.find(
                r => r.question_number === question.question_number || r.question_id === question.id
            );

            if (answerGrade) {
                const marksObtained = parseFloat(answerGrade.marks_obtained || 0);
                const maxMarks = parseFloat(question.max_marks);
                const pageNumber = answerGrade.page_number ? parseInt(answerGrade.page_number) : null;

                // Insert answer record
                await pool.query(
                    `INSERT INTO answers (
                        submission_id, question_id,
                        marks_obtained, ai_explanation, page_number
                    ) VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (submission_id, question_id)
                    DO UPDATE SET
                        marks_obtained = EXCLUDED.marks_obtained,
                        ai_explanation = EXCLUDED.ai_explanation,
                        page_number = EXCLUDED.page_number,
                        updated_at = CURRENT_TIMESTAMP`,
                    [
                        submissionId,
                        question.id,
                        marksObtained,
                        answerGrade.explanation || '',
                        pageNumber
                    ]
                );

                totalMarksObtained += marksObtained;
                totalMarksPossible += maxMarks;
            }
        }

        // Calculate percentage for logging
        const percentage = totalMarksPossible > 0
            ? (totalMarksObtained / totalMarksPossible) * 100
            : 0;

        // Update submission status to "Ready for Verification" (teacher needs to verify)
        await pool.query(
            `UPDATE student_submissions
             SET status = 'Ready for Verification',
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [submissionId]
        );

        console.log(`✅ Grading completed: ${totalMarksObtained}/${totalMarksPossible} (${percentage.toFixed(2)}%)`);
        console.log(`📊 Total marks are calculated from answers table, not stored in student_submissions`);

        // Check if any submissions are ready for verification
        const readyForVerificationCheck = await pool.query(
            `SELECT COUNT(*) as count
             FROM student_submissions
             WHERE assessment_id = $1 AND status = 'Ready for Verification'`,
            [assessmentId]
        );

        // If any submissions are ready for verification, update assessment status to "Ans Pending Approval"
        if (parseInt(readyForVerificationCheck.rows[0].count) > 0) {
            await pool.query(
                `UPDATE assessments
                 SET status = 'Ans Pending Approval', updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND status = 'Processing Ans'`,
                [assessmentId]
            );
            console.log(`✅ Assessment ${assessmentId} status updated to "Ans Pending Approval" (submissions ready for teacher verification)`);
        }

        return {
            success: true,
            totalMarksObtained,
            totalMarksPossible,
            percentage,
            answersCount: gradingResults.length
        };

    } catch (error) {
        console.error('❌ Error grading answer sheet:', error);

        // Update submission status to "Failed"
        await pool.query(
            `UPDATE student_submissions
             SET status = 'Failed'
             WHERE id = $1`,
            [submissionId]
        );

        // Check if there are any non-failed submissions and update assessment status accordingly
        console.log('🔄 Checking assessment status after submission failure...');
        const submissionsCheck = await pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE status != 'Failed') as successful_count,
                COUNT(*) as total_count
             FROM student_submissions
             WHERE assessment_id = $1`,
            [assessmentId]
        );

        const { successful_count, total_count } = submissionsCheck.rows[0];
        console.log(`📊 Submissions status: ${successful_count} successful out of ${total_count} total`);

        let newAssessmentStatus;
        if (parseInt(successful_count) > 0) {
            // At least one successful submission exists
            newAssessmentStatus = 'Completed';
            console.log('✅ Setting assessment status to "Completed" (has successful submissions)');
        } else {
            // All submissions have failed
            newAssessmentStatus = 'Ready for Grading';
            console.log('⚠️  Setting assessment status to "Ready for Grading" (all submissions failed)');
        }

        await pool.query(
            `UPDATE assessments
             SET status = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [newAssessmentStatus, assessmentId]
        );
        console.log(`✅ Assessment status updated to: ${newAssessmentStatus}`);

        throw error;
    }
}

/**
 * Build the AI grading prompt
 */
function buildGradingPrompt(questions, assessment) {
    // Build questions list with clear structure
    const questionsText = questions.map((q, idx) => {
        return `Question Number: ${q.question_number}
   Question Identifier: ${q.question_identifier || 'N/A'}
   Question Text: ${q.question_text}
   Max Marks: ${q.max_marks}`;
    }).join('\n\n');

    // Build example response with tuples
    const exampleResponse = questions.slice(0, 2).map(q => {
        return `  [${q.question_number}, 0.0, "Brief grading explanation", 1]`;
    }).join(',\n');

    return `You are an expert teacher grading student answer sheets.

**Assessment Context:**
- Assessment Name: ${assessment.title}
- Class: ${assessment.class}
- Subject: ${assessment.subject}

**Question Paper:**
${questionsText}

**Instructions:**
1. Analyze the student's answer sheet PDF
2. For EACH question, grade and provide brief feedback
3. Verify answers are relevant to ${assessment.subject} for ${assessment.class}

**Grading Criteria:**
- Full marks: Complete, correct answers
- Partial marks: Partially correct answers
- Zero marks: Wrong/missing answers
- marks_obtained MUST NOT exceed Max Marks
- Be fair and consistent

**Output Format (Tuple Array):**
Return as array of tuples (NOT objects) to save tokens:

[
${exampleResponse}
]

Format: [question_number, marks_obtained, explanation, page_number]

**Requirements:**
- Return ONLY the array, no markdown or extra text
- Include ALL ${questions.length} questions
- Use exact question_number from question paper
- marks_obtained: decimal between 0 and Max Marks
- explanation: Brief reason for marks (keep concise)
- page_number: PDF page where answer appears (1-indexed)
- If question not answered: marks = 0`;
}

/**
 * Call AI service to grade the answer sheet
 */
async function callAIGradingService(prompt, answerSheetPdfUrl, questions) {
    try {
        // HARDCODED RESPONSE FOR TESTING
        // Set to false to use real AI
        const USE_HARDCODED_RESPONSE = false;

        if (USE_HARDCODED_RESPONSE) {
            console.log(`⚠️  Using hardcoded grading response for testing`);
            
            // Simulate AI processing delay
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Generate hardcoded results for all questions
            const gradingResults = questions.map((q, index) => {
                const maxMarks = parseFloat(q.max_marks);
                // Alternate between full marks, partial marks, and low marks
                let marksObtained;
                if (index % 3 === 0) {
                    marksObtained = maxMarks; // Full marks
                } else if (index % 3 === 1) {
                    marksObtained = maxMarks * 0.7; // 70%
                } else {
                    marksObtained = maxMarks * 0.4; // 40%
                }

                return {
                    question_number: q.question_number,
                    marks_obtained: parseFloat(marksObtained.toFixed(2)),
                    explanation: `This is a hardcoded explanation for question ${q.question_number}. The student's answer was evaluated and marks were awarded accordingly.`,
                    page_number: Math.floor(index / 3) + 1 // Distribute across pages
                };
            });

            console.log(`✅ AI grading completed (hardcoded) for ${gradingResults.length} questions`);
            return gradingResults;
        }

        // Original AI grading code
        const response = await openaiVisionParser.parseWithVision([answerSheetPdfUrl], prompt);

        // Parse the JSON response
        let gradingResults;
        try {
            // Extract JSON from markdown code blocks if present
            const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/) ||
                            response.match(/```\n?([\s\S]*?)\n?```/) ||
                            response.match(/\[[\s\S]*\]/);
            
            const jsonString = jsonMatch ? jsonMatch[1] || jsonMatch[0] : response;
            const parsed = JSON.parse(jsonString);

            if (!Array.isArray(parsed)) {
                throw new Error('AI response is not an array');
            }

            // Convert tuples to objects
            gradingResults = parsed.map(item => {
                if (Array.isArray(item)) {
                    // Tuple format: [question_number, marks_obtained, explanation, page_number]
                    const [question_number, marks_obtained, explanation, page_number] = item;
                    return {
                        question_number: parseInt(question_number),
                        marks_obtained: parseFloat(marks_obtained),
                        explanation: explanation || '',
                        page_number: page_number ? parseInt(page_number) : null
                    };
                } else {
                    // Legacy object format (backward compatibility)
                    return {
                        question_number: parseInt(item.question_number),
                        marks_obtained: parseFloat(item.marks_obtained || 0),
                        explanation: item.explanation || '',
                        page_number: item.page_number ? parseInt(item.page_number) : null
                    };
                }
            });

        } catch (parseError) {
            console.error('❌ Failed to parse AI grading response:', parseError);
            console.error('Raw response:', response);
            throw new Error('Failed to parse AI grading results: ' + parseError.message);
        }

        console.log(`✅ AI grading completed for ${gradingResults.length} questions`);
        return gradingResults;

    } catch (error) {
        console.error('❌ AI grading service error:', error);
        throw error;
    }
}

/**
 * Get detailed grading results for a submission
 */
async function getSubmissionGrades(submissionId) {
    try {
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

        return result.rows;
    } catch (error) {
        console.error('❌ Error fetching submission grades:', error);
        throw error;
    }
}

module.exports = {
    gradeAnswerSheet,
    getSubmissionGrades
};
