
const { Pool } = require('pg');
const aiService = require('../services/aiService');
const googleDriveService = require('../services/googleDriveService');
const { deleteAssessmentImages } = require('../services/pdfImageService');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Get all assessments for a user with creator details
exports.getUserAssessments = async (req, res) => {
  try {
    // Get userId from authenticated user (set by JWT middleware)
    const userId = req.user.id;

    const query = `
      SELECT
        a.id,
        a.title,
        a.class,
        a.subject,
        a.status,
        a.created_at,
        u.name as created_by_name,
        COUNT(DISTINCT CASE WHEN s.status != 'Failed' THEN s.id END) as total_submissions,
        COUNT(DISTINCT CASE WHEN s.status = 'Approved' THEN s.id END) as graded_count
      FROM assessments a
      LEFT JOIN users u ON a.created_by = u.id
      LEFT JOIN student_submissions s ON a.id = s.assessment_id
      WHERE a.created_by = $1
      GROUP BY a.id, u.name
      ORDER BY a.created_at DESC
    `;

    const result = await pool.query(query, [userId]);

    res.status(200).json({
      success: true,
      assessments: result.rows
    });

  } catch (error) {
    console.error('Get assessments error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching assessments',
      error: error.message
    });
  }
};

// Get single assessment by ID with full details
exports.getAssessmentById = async (req, res) => {
  try {
    const { id } = req.params;
    // Get userId from authenticated user (set by JWT middleware)
    const userId = req.user.id;

    const query = `
      SELECT
        a.id,
        a.title,
        a.class,
        a.subject,
        a.status,
        a.question_count,
        a.total_marks,
        a.question_paper_link,
        a.created_at,
        u.name as created_by_name
      FROM assessments a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE a.id = $1 AND a.created_by = $2
    `;

    const result = await pool.query(query, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    res.status(200).json({
      success: true,
      assessment: result.rows[0]
    });

  } catch (error) {
    console.error('Get assessment error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching assessment',
      error: error.message
    });
  }
};

// Get student submissions for an assessment
exports.getAssessmentSubmissions = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // First verify the assessment belongs to this user
    const assessmentQuery = `
      SELECT id FROM assessments 
      WHERE id = $1 AND created_by = $2
    `;
    const assessmentResult = await pool.query(assessmentQuery, [id, userId]);

    if (assessmentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    // Fetch all student submissions for this assessment
    // Calculate total_marks_obtained from answers table (not stored in student_submissions)
    const submissionsQuery = `
      SELECT
        ss.id,
        ss.student_id,
        s.student_name,
        s.student_identifier,
        ss.status,
        COALESCE(
          (SELECT SUM(a.marks_obtained)
           FROM answers a
           WHERE a.submission_id = ss.id),
          0
        ) as total_marks_obtained,
        ss.created_at,
        ss.updated_at
      FROM student_submissions ss
      LEFT JOIN students s ON ss.student_id = s.id
      WHERE ss.assessment_id = $1
      ORDER BY s.student_name NULLS LAST
    `;

    const result = await pool.query(submissionsQuery, [id]);

    res.status(200).json({
      success: true,
      submissions: result.rows
    });

  } catch (error) {
    console.error('Get submissions error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching submissions',
      error: error.message
    });
  }
};

// Get student submission details with answers
exports.getStudentSubmission = async (req, res) => {
  try {
    const { assessmentId, studentId } = req.params;
    const userId = req.user.id;

    // Verify assessment belongs to this user
    const assessmentQuery = `
      SELECT
        a.id,
        a.id as display_id,
        a.title,
        a.class as class_name,
        a.subject,
        a.total_marks,
        a.question_paper_link,
        a.created_at as date_created
      FROM assessments a
      WHERE a.id = $1 AND a.created_by = $2
    `;
    const assessmentResult = await pool.query(assessmentQuery, [assessmentId, userId]);

    if (assessmentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    const assessment = assessmentResult.rows[0];

    // Get student submission
    // Calculate total_marks_obtained from answers table (not stored in student_submissions)
    const submissionQuery = `
      SELECT
        ss.id,
        ss.student_id,
        s.student_name,
        ss.status,
        COALESCE(
          (SELECT SUM(a.marks_obtained)
           FROM answers a
           WHERE a.submission_id = ss.id),
          0
        ) as total_marks_obtained,
ss.answer_sheet_link,
ss.created_at,
ss.updated_at
FROM student_submissions ss
      LEFT JOIN students s ON ss.student_id = s.id
      WHERE ss.assessment_id = $1 AND ss.student_id = $2
    `;
    const submissionResult = await pool.query(submissionQuery, [assessmentId, studentId]);

    if (submissionResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Student submission not found'
      });
    }

    const submission = submissionResult.rows[0];

    // Get all answers with questions
    const answersQuery = `
      SELECT
        sa.id as answer_id,
        sa.marks_obtained,
        sa.ai_suggested_marks,
        sa.ai_generated_feedback,
        sa.teacher_comment,
        sa.approved,
        q.id as question_id,
        q.question_number,
        q.question_text,
        q.max_marks as question_max_marks,
        '[Student answer text would be stored here]' as answer_text
      FROM student_answers sa
      JOIN questions q ON sa.question_id = q.id
      WHERE sa.submission_id = $1
      ORDER BY q.question_number
    `;
    const answersResult = await pool.query(answersQuery, [submission.id]);

    res.status(200).json({
      success: true,
      data: {
        assessment: assessment,
        submission: submission,
        answers: answersResult.rows
      }
    });

  } catch (error) {
    console.error('Get student submission error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching student submission',
      error: error.message
    });
  }
};

// Approve a student answer
exports.approveStudentAnswer = async (req, res) => {
  try {
    const { assessmentId, studentId, answerId } = req.params;
    const userId = req.user.id;
    const { marks, comment } = req.body;

    // Verify assessment belongs to this user
    const assessmentCheck = await pool.query(
      'SELECT id FROM assessments WHERE id = $1 AND created_by = $2',
      [assessmentId, userId]
    );

    if (assessmentCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    // Update the answer with approval
    const updateQuery = `
      UPDATE student_answers
      SET
        marks_obtained = $1,
        teacher_comment = $2,
        approved = true,
        updated_at = NOW()
      WHERE id = $3
      AND submission_id = (
        SELECT id FROM student_submissions
        WHERE assessment_id = $4 AND student_id = $5
      )
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [
      marks || 0,
      comment || '',
      answerId,
      assessmentId,
      studentId
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Answer not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Answer approved successfully',
      answer: result.rows[0]
    });

  } catch (error) {
    console.error('Approve answer error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while approving the answer',
      error: error.message
    });
  }
};

// Approve entire submission (all answers)
exports.approveSubmission = async (req, res) => {
  try {
    const { assessmentId, studentId } = req.params;
    const userId = req.user.id;

    // Verify assessment belongs to this user
    const assessmentCheck = await pool.query(
      'SELECT id FROM assessments WHERE id = $1 AND created_by = $2',
      [assessmentId, userId]
    );

    if (assessmentCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    // Update the submission status to "Approved"
    const updateQuery = `
      UPDATE student_submissions
      SET
        status = 'Approved',
        updated_by = $1,
        updated_at = NOW()
      WHERE assessment_id = $2 AND student_id = $3
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [userId, assessmentId, studentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Submission approved successfully',
      submission: result.rows[0]
    });

  } catch (error) {
    console.error('Approve submission error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while approving the submission',
      error: error.message
    });
  }
};

// AI Workflow Endpoints

// Trigger AI question extraction from PDF
exports.triggerQuestionExtraction = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const userId = req.user.id;

    // Verify assessment belongs to user
    const assessmentQuery = `
      SELECT id, title, class, subject, question_paper_link, status
      FROM assessments
      WHERE id = $1 AND created_by = $2
    `;
    const assessmentResult = await pool.query(assessmentQuery, [assessmentId, userId]);

    if (assessmentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    const assessment = assessmentResult.rows[0];

    if (!assessment.question_paper_link) {
      return res.status(400).json({
        success: false,
        message: 'No question paper PDF available'
      });
    }

    // Update status to Processing Ques
    await pool.query(
      'UPDATE assessments SET status = $1 WHERE id = $2',
      ['Processing Ques', assessmentId]
    );

    // Start AI extraction in background (non-blocking)
    processQuestionExtraction(assessmentId, assessment).catch(err => {
      console.error(`Background extraction failed for assessment ${assessmentId}:`, err);
    });

    res.status(200).json({
      success: true,
      message: 'Question extraction started',
      status: 'Processing Ques'
    });

  } catch (error) {
    console.error('Trigger extraction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to trigger question extraction',
      error: error.message
    });
  }
};

// Background process for question extraction
async function processQuestionExtraction(assessmentId, assessment) {
  try {
    console.log(`\n========================================`);
    console.log(`🚀 Starting background extraction for assessment ${assessmentId}`);
    console.log(`========================================\n`);

    // STEP 1: Delete existing questions and images FIRST (before extraction)
    console.log(`🗑️  Deleting existing questions for assessment ${assessmentId}...`);
    
    try {
      await deleteAssessmentImages(assessmentId);
      console.log(`   ✓ Images deleted`);
    } catch (imgError) {
      console.log(`   ⚠️  Image delete failed (non-critical):`, imgError.message);
    }
    
    const deleteResult = await pool.query(`DELETE FROM questions WHERE assessment_id = $1`, [assessmentId]);
    console.log(`   ✓ Deleted ${deleteResult.rowCount} existing questions from database`);

    // STEP 2: Extract questions with images
    const pdfSource = assessment.localFilePath || assessment.question_paper_link;
    console.log(`📄 Extracting questions with images from: ${pdfSource}`);

    // Extract questions using AI (text extraction only, no image cropping)
    const questions = await aiService.extractQuestionsFromPDF(
      pdfSource,
      {
        title: assessment.title,
        class: assessment.class,
        subject: assessment.subject
      }
    );
    
    // STEP 3: Save extracted questions to database (with transaction)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Get the current max question_number for this assessment
      const maxNumberResult = await client.query(
        'SELECT COALESCE(MAX(question_number), 0) as max_num FROM questions WHERE assessment_id = $1',
        [assessmentId]
      );
      let nextQuestionNumber = maxNumberResult.rows[0].max_num + 1;
      
      // Save extracted questions to database (now with image URLs)
      let savedCount = 0;
      let skippedCount = 0;
      
      for (const question of questions) {
        // Validate required fields - skip incomplete questions
        if (!question.question_text || question.question_text.trim() === '') {
          console.log(`⚠️  Skipping question ${question.question_identifier || 'unknown'} - missing question text`);
          skippedCount++;
          continue;
        }
        
        await client.query(
          `INSERT INTO questions (assessment_id, question_number, question_identifier, question_text, max_marks, y_start, y_end, page_number, topics, verified)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)`,
          [
            assessmentId,
            nextQuestionNumber++, // Auto-generated sequential number (1, 2, 3...)
            question.question_identifier || null, // AI-extracted identifier (e.g., "i", "ii", "1a", "Q1")
            question.question_text, // Full question text from AI
            question.marks || 0, // Marks from AI response
            question.y_start || null, // Y coordinate where question starts
            question.y_end || null, // Y coordinate where question ends
            question.page || 1, // Page number in PDF
            JSON.stringify(question.topics || []) // Topics with weightage as JSONB
          ]
        );
        savedCount++;
      }
      
      console.log(`✅ Saved ${savedCount} questions to database`);
      if (skippedCount > 0) {
        console.log(`⚠️  Skipped ${skippedCount} incomplete questions`);
      }
      
      await client.query('COMMIT');
      console.log(`✅ Successfully saved ${questions.length} questions`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Calculate total marks
    const totalMarks = questions.reduce((sum, q) => sum + (parseFloat(q.max_marks) || 0), 0);

    // Update assessment with question count and status
    await pool.query(
      `UPDATE assessments 
       SET status = $1, question_count = $2, total_marks = $3 
       WHERE id = $4`,
      ['Ques Pending Approval', questions.length, totalMarks, assessmentId]
    );

    console.log(`Successfully extracted ${questions.length} questions for assessment ${assessmentId}`);

  } catch (error) {
    console.error(`Extraction process failed for assessment ${assessmentId}:`, error);
    
    // Update status to indicate failure
    await pool.query(
      'UPDATE assessments SET status = $1 WHERE id = $2',
      ['Extraction Failed', assessmentId]
    );
  }
}

// Get all questions for an assessment
exports.getAssessmentQuestions = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const userId = req.user.id;

    // Verify assessment belongs to user
    const assessmentQuery = `
      SELECT id FROM assessments
      WHERE id = $1 AND created_by = $2
    `;
    const assessmentResult = await pool.query(assessmentQuery, [assessmentId, userId]);

    if (assessmentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    // Get all questions
    const questionsQuery = `
      SELECT
        id,
        question_number,
        question_identifier,
        question_text,
        max_marks,
        y_start,
        y_end,
        page_number,
        topics,
        verified,
        created_at
      FROM questions
      WHERE assessment_id = $1
      ORDER BY question_number
    `;
    const questionsResult = await pool.query(questionsQuery, [assessmentId]);

    // Calculate total marks
    const totalMarks = questionsResult.rows.reduce(
      (sum, q) => sum + (parseFloat(q.max_marks) || 0),
      0
    );

    res.status(200).json({
      success: true,
      questions: questionsResult.rows,
      total_marks: totalMarks,
      question_count: questionsResult.rows.length
    });

  } catch (error) {
    console.error('Get questions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch questions',
      error: error.message
    });
  }
};

// Update a question
exports.updateQuestion = async (req, res) => {
  try {
    const { assessmentId, questionId } = req.params;
    const { question_text, max_marks, verified } = req.body;
    const userId = req.user.id;

    // Verify assessment belongs to user and is not approved yet
    const assessmentQuery = `
      SELECT id, status FROM assessments
      WHERE id = $1 AND created_by = $2
    `;
    const assessmentResult = await pool.query(assessmentQuery, [assessmentId, userId]);

    if (assessmentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    const assessment = assessmentResult.rows[0];
    // Allow editing for: Ques Pending Approval, Processing Ques, Ready for Grading
    // Prevent editing for: In Progress, Completed (when grading has started or finished)
    if (assessment.status !== 'Ques Pending Approval' &&
        assessment.status !== 'Processing Ques' &&
        assessment.status !== 'Ready for Grading') {
      return res.status(400).json({
        success: false,
        message: 'Questions cannot be edited after grading has started'
      });
    }

    // Update question (including verified status if provided)
    const updateQuery = `
      UPDATE questions
      SET question_text = COALESCE($1, question_text),
          max_marks = COALESCE($2, max_marks),
          verified = COALESCE($3, verified)
      WHERE id = $4 AND assessment_id = $5
      RETURNING *
    `;
    const result = await pool.query(updateQuery, [question_text, max_marks, verified, questionId, assessmentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    // Recalculate total marks
    const totalQuery = `
      SELECT SUM(max_marks) as total FROM questions WHERE assessment_id = $1
    `;
    const totalResult = await pool.query(totalQuery, [assessmentId]);
    const totalMarks = totalResult.rows[0].total || 0;

    // Update assessment total marks
    await pool.query(
      'UPDATE assessments SET total_marks = $1 WHERE id = $2',
      [totalMarks, assessmentId]
    );

    res.status(200).json({
      success: true,
      question: result.rows[0],
      total_marks: totalMarks
    });

  } catch (error) {
    console.error('Update question error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update question',
      error: error.message
    });
  }
};

// Add a new question
exports.addQuestion = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const { question_number, question_text, max_marks } = req.body;
    const userId = req.user.id;

    // Verify assessment belongs to user
    const assessmentQuery = `
      SELECT id, status FROM assessments
      WHERE id = $1 AND created_by = $2
    `;
    const assessmentResult = await pool.query(assessmentQuery, [assessmentId, userId]);

    if (assessmentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    const assessment = assessmentResult.rows[0];
    if (assessment.status !== 'Ques Pending Approval' && assessment.status !== 'Processing Ques') {
      return res.status(400).json({
        success: false,
        message: 'Questions cannot be added after approval'
      });
    }

    // Insert new question
    const insertQuery = `
      INSERT INTO questions (assessment_id, question_number, question_text, max_marks, verified)
      VALUES ($1, $2, $3, $4, false)
      RETURNING *
    `;
    const result = await pool.query(insertQuery, [assessmentId, question_number, question_text, max_marks]);

    // Update question count and total marks
    const countQuery = `SELECT COUNT(*) as count, SUM(max_marks) as total FROM questions WHERE assessment_id = $1`;
    const countResult = await pool.query(countQuery, [assessmentId]);
    
    await pool.query(
      'UPDATE assessments SET question_count = $1, total_marks = $2 WHERE id = $3',
      [countResult.rows[0].count, countResult.rows[0].total || 0, assessmentId]
    );

    res.status(201).json({
      success: true,
      question: result.rows[0],
      total_marks: countResult.rows[0].total || 0
    });

  } catch (error) {
    console.error('Add question error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add question',
      error: error.message
    });
  }
};

// Delete a question
exports.deleteQuestion = async (req, res) => {
  try {
    const { assessmentId, questionId } = req.params;
    const userId = req.user.id;

    // Verify assessment belongs to user
    const assessmentQuery = `
      SELECT id, status FROM assessments
      WHERE id = $1 AND created_by = $2
    `;
    const assessmentResult = await pool.query(assessmentQuery, [assessmentId, userId]);

    if (assessmentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    const assessment = assessmentResult.rows[0];
    if (assessment.status !== 'Ques Pending Approval' && assessment.status !== 'Processing Ques') {
      return res.status(400).json({
        success: false,
        message: 'Questions cannot be deleted after approval'
      });
    }

    // Delete question
    const deleteQuery = `
      DELETE FROM questions
      WHERE id = $1 AND assessment_id = $2
      RETURNING *
    `;
    const result = await pool.query(deleteQuery, [questionId, assessmentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    // Update question count and total marks
    const countQuery = `SELECT COUNT(*) as count, SUM(max_marks) as total FROM questions WHERE assessment_id = $1`;
    const countResult = await pool.query(countQuery, [assessmentId]);
    
    await pool.query(
      'UPDATE assessments SET question_count = $1, total_marks = $2 WHERE id = $3',
      [countResult.rows[0].count, countResult.rows[0].total || 0, assessmentId]
    );

    res.status(200).json({
      success: true,
      message: 'Question deleted successfully',
      total_marks: countResult.rows[0].total || 0
    });

  } catch (error) {
    console.error('Delete question error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete question',
      error: error.message
    });
  }
};

// Verify a single question
exports.verifyQuestion = async (req, res) => {
  try {
    const { assessmentId, questionId } = req.params;
    const userId = req.user.id;

    // Verify assessment belongs to user
    const assessmentQuery = `
      SELECT id FROM assessments
      WHERE id = $1 AND created_by = $2
    `;
    const assessmentResult = await pool.query(assessmentQuery, [assessmentId, userId]);

    if (assessmentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    // Mark question as verified
    await pool.query(
      'UPDATE questions SET verified = true WHERE id = $1 AND assessment_id = $2',
      [questionId, assessmentId]
    );

    res.status(200).json({
      success: true,
      message: 'Question verified successfully'
    });

  } catch (error) {
    console.error('Verify question error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify question',
      error: error.message
    });
  }
};

// Approve all questions and lock them
exports.approveQuestions = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const userId = req.user.id;

    // Verify assessment belongs to user
    const assessmentQuery = `
      SELECT id, status, question_count FROM assessments
      WHERE id = $1 AND created_by = $2
    `;
    const assessmentResult = await pool.query(assessmentQuery, [assessmentId, userId]);

    if (assessmentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found'
      });
    }

    const assessment = assessmentResult.rows[0];
    
    if (assessment.question_count === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot approve assessment with no questions'
      });
    }

    // Verify all questions have marks
    const invalidQuery = `
      SELECT COUNT(*) as count FROM questions 
      WHERE assessment_id = $1 AND (max_marks IS NULL OR max_marks <= 0)
    `;
    const invalidResult = await pool.query(invalidQuery, [assessmentId]);
    
    if (invalidResult.rows[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: 'All questions must have valid marks before approval'
      });
    }

    // Mark all questions as verified
    await pool.query(
      `UPDATE questions
       SET verified = true
       WHERE assessment_id = $1`,
      [assessmentId]
    );

    // Update assessment status to Ready for submissions
    const updateQuery = `
      UPDATE assessments 
      SET status = 'Ready for Grading'
      WHERE id = $1
      RETURNING *
    `;
    const result = await pool.query(updateQuery, [assessmentId]);

    res.status(200).json({
      success: true,
      message: 'Questions approved successfully',
      assessment: result.rows[0]
    });

  } catch (error) {
    console.error('Approve questions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve questions',
      error: error.message
    });
  }
};



// Create new assessment


// Upload PDF and create assessment with local file storage
exports.uploadPDFAndCreateAssessment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, class: className, subject } = req.body;

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No PDF file uploaded'
      });
    }

    console.log('📄 Processing PDF upload:', req.file.originalname);

    // Validate required fields
    if (!title || !className || !subject) {
      return res.status(400).json({
        success: false,
        message: 'Title, class, and subject are required'
      });
    }

    // Create assessment record first (without PDF link)
    const insertQuery = `
      INSERT INTO assessments (title, class, subject, status, created_by, created_at)
      VALUES ($1, $2, $3, 'Processing Ques', $4, NOW())
      RETURNING *
    `;
    
    const result = await pool.query(insertQuery, [title, className, subject, userId]);
    const assessment = result.rows[0];

    console.log(`✅ Assessment created: ID ${assessment.id}`);

    // Process PDF locally in background
    processLocalPDF(assessment.id, req.file.path, {
      id: assessment.id,
      title: title,
      originalName: req.file.originalname
    }).catch(err => {
      console.error(`Failed to process PDF for assessment ${assessment.id}:`, err);
    });

    res.status(201).json({
      success: true,
      message: 'Assessment created. PDF processing in progress...',
      assessment: assessment
    });

  } catch (error) {
    console.error('Upload PDF error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create assessment',
      error: error.message
    });
  }
};

// Background function to process PDF locally and trigger extraction
async function processLocalPDF(assessmentId, tempFilePath, metadata) {
  const fs = require('fs');
  const path = require('path');
  
  try {
    console.log(`📁 Processing PDF locally for assessment ${assessmentId}`);

    // Create permanent storage directory if it doesn't exist
    const permanentDir = path.join(__dirname, '../../uploads/assessments');
    if (!fs.existsSync(permanentDir)) {
      fs.mkdirSync(permanentDir, { recursive: true });
    }

    // Generate permanent filename
    const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const sanitizedTitle = (metadata.title || 'Assessment')
      .replace(/[^a-z0-9]/gi, '_')
      .substring(0, 50);
    const extension = path.extname(metadata.originalName || '.pdf');
    const permanentFilename = `Assessment_${assessmentId}_${sanitizedTitle}_${timestamp}${extension}`;
    const permanentPath = path.join(permanentDir, permanentFilename);

    // Move file from temp to permanent location
    try {
      fs.renameSync(tempFilePath, permanentPath);
      console.log(`✅ PDF saved to: ${permanentPath}`);
      
      // Verify file exists at new location
      if (!fs.existsSync(permanentPath)) {
        throw new Error(`File not found after move: ${permanentPath}`);
      }
      
      // Create local URL for the file
      const localUrl = `/uploads/assessments/${permanentFilename}`;
      
      // Update assessment with PDF link
      await pool.query(
        'UPDATE assessments SET question_paper_link = $1 WHERE id = $2',
        [localUrl, assessmentId]
      );

      console.log(`✅ Assessment ${assessmentId} updated with local link: ${localUrl}`);
    } catch (moveError) {
      console.error(`❌ Failed to move/save PDF file:`, moveError);
      throw new Error(`PDF file operation failed: ${moveError.message}`);
    }

    // Now trigger AI extraction with local file path
    const assessment = await pool.query(
      'SELECT id, title, class, subject, question_paper_link, status FROM assessments WHERE id = $1',
      [assessmentId]
    );

    if (assessment.rows.length > 0) {
      // Pass the actual file path for AI processing
      const assessmentWithPath = {
        ...assessment.rows[0],
        localFilePath: permanentPath
      };
      await processQuestionExtraction(assessmentId, assessmentWithPath);
    }

  } catch (error) {
    console.error(`❌ Error processing PDF for assessment ${assessmentId}:`, error);
    
    // Clean up temp file if it still exists
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        console.log(`🗑️ Cleaned up temp file: ${tempFilePath}`);
      }
    } catch (cleanupErr) {
      console.warn('Warning: Could not cleanup temp file:', cleanupErr.message);
    }
    
    // Update status to indicate failure with error details
    try {
      await pool.query(
        'UPDATE assessments SET status = $1 WHERE id = $2',
        ['Upload Failed', assessmentId]
      );
      console.log(`⚠️ Assessment ${assessmentId} status updated to 'Upload Failed'`);
    } catch (dbErr) {
      console.error('Failed to update assessment status:', dbErr);
    }
  }
}

// Create new assessment (original endpoint - kept for backward compatibility)
exports.createAssessment = async (req, res) => {
  try {
    const { title, class: className, subject } = req.body;
    const userId = req.user.id; // Get from JWT token

    if (!title || !className || !subject || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Title, class, subject, and user ID are required'
      });
    }

    // Check if user has permission for this class-subject combination
    const permissionQuery = `
      SELECT id FROM user_class_subject_mappings
      WHERE user_id = $1 AND class = $2 AND subject = $3 AND is_active = TRUE
    `;
    const permissionResult = await pool.query(permissionQuery, [userId, className, subject]);
    
    if (permissionResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to create assessments for this class and subject combination'
      });
    }

    const query = `
      INSERT INTO assessments (
        title, 
        class, 
        subject, 
        created_by, 
        status
      )
      VALUES ($1, $2, $3, $4, 'Processing Ques')
      RETURNING *
    `;

    const result = await pool.query(query, [title, className, subject, userId]);

    res.status(201).json({
      success: true,
      message: 'Assessment created successfully',
      assessment: result.rows[0]
    });

  } catch (error) {
    console.error('Create assessment error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while creating assessment',
      error: error.message
    });
  }
};

// Update assessment
exports.updateAssessment = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, class: className, subject, status, questionCount, totalMarks, userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramCount++}`);
      values.push(title);
    }
    if (className !== undefined) {
      updates.push(`class = $${paramCount++}`);
      values.push(className);
    }
    if (subject !== undefined) {
      updates.push(`subject = $${paramCount++}`);
      values.push(subject);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(status);
    }
    if (questionCount !== undefined) {
      updates.push(`question_count = $${paramCount++}`);
      values.push(questionCount);
    }
    if (totalMarks !== undefined) {
      updates.push(`total_marks = $${paramCount++}`);
      values.push(totalMarks);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updates.push(`updated_by = $${paramCount++}`);
    values.push(userId);
    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    values.push(id);
    values.push(userId);

    const query = `
      UPDATE assessments
      SET ${updates.join(', ')}
      WHERE id = $${paramCount++} AND created_by = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found or unauthorized'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Assessment updated successfully',
      assessment: result.rows[0]
    });

  } catch (error) {
    console.error('Update assessment error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while updating assessment',
      error: error.message
    });
  }
};

// Update assessment status
exports.updateAssessmentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, userId } = req.body;

    if (!status || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Status and user ID are required'
      });
    }

    const query = `
      UPDATE assessments
      SET 
        status = $1, 
        updated_by = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND created_by = $4
      RETURNING *
    `;

    const result = await pool.query(query, [status, userId, id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found or unauthorized'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Assessment status updated',
      assessment: result.rows[0]
    });

  } catch (error) {
    console.error('Update assessment status error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while updating assessment status',
      error: error.message
    });
  }
};

// Delete assessment
exports.deleteAssessment = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.query.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const query = `
      DELETE FROM assessments
      WHERE id = $1 AND created_by = $2
      RETURNING id, title
    `;

    const result = await pool.query(query, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assessment not found or unauthorized'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Assessment deleted successfully',
      assessment: result.rows[0]
    });

  } catch (error) {
    console.error('Delete assessment error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting assessment',
      error: error.message
    });
  }
};

// Get assessment statistics
exports.getAssessmentStats = async (req, res) => {
  try {
    const userId = req.query.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const query = `
      SELECT 
        COUNT(*) as total_assessments,
        COUNT(CASE WHEN status = 'Pending Verification' THEN 1 END) as pending_verification,
        COUNT(CASE WHEN status = 'Pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'In Progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN status = 'Completed' THEN 1 END) as completed
      FROM assessments
      WHERE created_by = $1
    `;

    const result = await pool.query(query, [userId]);

    res.status(200).json({
      success: true,
      stats: result.rows[0]
    });

  } catch (error) {
    console.error('Get assessment stats error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching assessment statistics',
      error: error.message
    });
  }
};

// Get question image (cropped from PDF)
exports.getQuestionImage = async (req, res) => {
  try {
    const { assessmentId, questionId } = req.params;
    console.log(`\n🖼️  Image request: assessment=${assessmentId}, question=${questionId}`);
    console.log(`   User from token: ${JSON.stringify(req.user)}`);
    
    const userId = req.user.id;

    // Get question details with assessment info
    const query = `
      SELECT q.y_start, q.y_end, q.page_number, a.question_paper_link, a.created_by
      FROM questions q
      JOIN assessments a ON q.assessment_id = a.id
      WHERE q.id = $1 AND q.assessment_id = $2
    `;
    const result = await pool.query(query, [questionId, assessmentId]);

    if (result.rows.length === 0) {
      console.log(`   ❌ Question not found`);
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    const question = result.rows[0];
    console.log(`   Question data: created_by=${question.created_by} (${typeof question.created_by}), userId=${userId} (${typeof userId})`);

    // Verify user has access to this assessment
    if (parseInt(question.created_by) !== parseInt(userId)) {
      console.log(`   ❌ Access DENIED: ${parseInt(question.created_by)} !== ${parseInt(userId)}`);
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    console.log(`   ✅ Access granted`);

    // Get the full page image
    const { getPdfPageImage } = require('../services/pdfPageService');
    const imageBuffer = await getPdfPageImage(
      question.question_paper_link,
      question.page_number || 1
    );

    // Send image
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    res.send(imageBuffer);

  } catch (error) {
    console.error('Get question image error:', error);
    
    // Check if it's a file not found error
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: 'PDF file not found. The question paper may have been deleted or is missing.',
        error: error.message,
        hint: 'Please re-upload the question paper or contact support.'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'An error occurred while generating question image',
      error: error.message
    });
  }
};

module.exports = exports;
