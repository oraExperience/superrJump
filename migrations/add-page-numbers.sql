
-- Migration: Add page numbers tracking for multi-student PDFs
-- Stores which pages from the answer_sheet_link belong to this student

-- Add page_numbers column as JSONB array
ALTER TABLE student_submissions 
ADD COLUMN IF NOT EXISTS page_numbers JSONB DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN student_submissions.page_numbers IS 'Array of page numbers from answer_sheet_link that belong to this student (e.g., [1] or [2,3,4]). NULL means all pages belong to student.';

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_student_submissions_page_numbers 
ON student_submissions USING GIN (page_numbers) 
WHERE page_numbers IS NOT NULL;
