
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
        console.log(`🎯 Starting AI grading for submission ${submissionId}`);

        // Update submission status to "Processing"
        await pool.query(
            `UPDATE student_submissions
             SET status = 'Processing', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [submissionId]
        );

        // Fetch assessment details
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

        // Check if ALL submissions for this assessment are now graded
        const allSubmissionsCheck = await pool.query(
            `SELECT COUNT(*) as total,
                    COUNT(CASE WHEN status IN ('Ready for Verification', 'Verifying', 'Approved') THEN 1 END) as graded
             FROM student_submissions
             WHERE assessment_id = $1`,
            [assessmentId]
        );

        const { total, graded } = allSubmissionsCheck.rows[0];

        // If all submissions are graded, update assessment status to "Ans Pending Approval"
        if (parseInt(total) > 0 && parseInt(total) === parseInt(graded)) {
            await pool.query(
                `UPDATE assessments
                 SET status = 'Ans Pending Approval', updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1 AND status = 'Processing Ans'`,
                [assessmentId]
            );
            console.log(`✅ All submissions graded for assessment ${assessmentId}. Status updated to "Ans Pending Approval"`);
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

    // Build example response with actual question numbers
    const exampleResponse = questions.slice(0, 2).map(q => {
        return `  {
    "question_number": ${q.question_number},
    "marks_obtained": 0.0,
    "explanation": "Your grading explanation here",
    "page_number": 1
  }`;
    }).join(',\n');

    return `You are an expert teacher grading student answer sheets.

**Assessment Context:**
- Assessment Name: ${assessment.title}
- Class: ${assessment.class}
- Subject: ${assessment.subject}

This context helps you verify that the student's answers are relevant to the correct subject and class level.

**Question Paper:**
${questionsText}

**Instructions:**
1. Analyze the student's answer sheet PDF carefully
2. Verify that the answers are relevant to ${assessment.subject} for ${assessment.class}
3. For EACH question above, provide:
   - question_number: MUST match the question number from the question paper (e.g., ${questions[0].question_number}, ${questions[1]?.question_number || questions[0].question_number}, etc.)
   - marks_obtained: Marks awarded (can be decimal, e.g., 2.5). MUST be between 0 and the Max Marks shown above
   - explanation: Brief explanation of why marks were awarded or deducted
   - page_number: The page number in the PDF where this answer appears (starting from 1)

**Grading Criteria:**
- Award full marks for complete, correct answers
- Award partial marks for partially correct answers
- Award zero marks for wrong or missing answers
- Be fair and consistent in grading
- marks_obtained MUST NOT exceed the Max Marks for each question
- Consider the class level (${assessment.class}) and subject (${assessment.subject}) when evaluating answers

**Output Format (JSON Array):**
Return ONLY a JSON array with one object per question. Example structure:

[
${exampleResponse}
]

**Critical Requirements:**
- Return ONLY the JSON array, no additional text or markdown
- Include ALL ${questions.length} questions from the question paper
- Use the exact question_number values shown in the question paper above
- Ensure marks_obtained <= Max Marks for each question
- Include page_number for each answer (the page in the PDF where the answer is written)
- If a question is not answered, set marks_obtained to 0`;
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
            gradingResults = JSON.parse(jsonString);

            if (!Array.isArray(gradingResults)) {
                throw new Error('AI response is not an array');
            }

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
