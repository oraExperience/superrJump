
-- Students Table (Master data)
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    organisation VARCHAR(255) NOT NULL,
    student_identifier VARCHAR(100) NOT NULL,
    student_name VARCHAR(255) NOT NULL,
    class VARCHAR(100),
    section VARCHAR(50),
    roll_number VARCHAR(50),
    email VARCHAR(255),
    phone VARCHAR(20),
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organisation, student_identifier)
);

-- Student Submissions Table
CREATE TABLE IF NOT EXISTS student_submissions (
    id SERIAL PRIMARY KEY,
    assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    answer_sheet_link TEXT NOT NULL,
    extracted_student_info JSONB,
    status VARCHAR(50) DEFAULT 'Pending',
    total_marks_obtained DECIMAL(10, 2) DEFAULT 0,
    total_marks_possible DECIMAL(10, 2) DEFAULT 0,
    percentage DECIMAL(5, 2) DEFAULT 0,
    grading_started_at TIMESTAMP,
    grading_completed_at TIMESTAMP,
    verified_by INTEGER REFERENCES users(id),
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(assessment_id, student_id)
);

-- Answers Table (Question-wise marks and AI explanations)
CREATE TABLE IF NOT EXISTS answers (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES student_submissions(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    marks_obtained DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ai_explanation TEXT,
    user_feedback TEXT,
    page_number INTEGER,
    verified BOOLEAN DEFAULT FALSE,
    verified_marks DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(submission_id, question_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_students_organisation ON students(organisation);
CREATE INDEX IF NOT EXISTS idx_students_identifier ON students(student_identifier);
CREATE INDEX IF NOT EXISTS idx_students_name ON students(student_name);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class);
CREATE INDEX IF NOT EXISTS idx_students_org_name ON students(organisation, student_name);
CREATE INDEX IF NOT EXISTS idx_student_submissions_assessment ON student_submissions(assessment_id);
CREATE INDEX IF NOT EXISTS idx_student_submissions_student ON student_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_student_submissions_status ON student_submissions(status);
CREATE INDEX IF NOT EXISTS idx_answers_submission ON answers(submission_id);
CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);
CREATE INDEX IF NOT EXISTS idx_answers_verified ON answers(verified);

-- Update trigger for student_submissions
CREATE OR REPLACE FUNCTION update_student_submission_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_student_submission_timestamp
    BEFORE UPDATE ON student_submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_student_submission_timestamp();

-- Update trigger for answers
CREATE OR REPLACE FUNCTION update_answer_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_answer_timestamp
    BEFORE UPDATE ON answers
    FOR EACH ROW
    EXECUTE FUNCTION update_answer_timestamp();
