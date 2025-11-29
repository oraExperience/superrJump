
const pool = require('../config/database');
const xlsx = require('xlsx');

// Helper functions for validation
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function isValidPhone(phone) {
    // Check for country code (starts with +) and followed by 10-15 digits
    const phoneRegex = /^\+\d{10,15}$/;
    return phoneRegex.test(phone);
}

/**
 * Create a new student
 * POST /api/students
 */
async function createStudent(req, res) {
    try {
        const {
            student_identifier,
            student_name,
            class: className,
            section,
            roll_number,
            email,
            phone,
            parent_name,
            parent_phone
        } = req.body;

        const userId = req.user.id;
        const organisation = req.user.organisation;

        // Validate required fields
        if (!student_identifier || !student_name) {
            return res.status(400).json({
                error: 'student_identifier and student_name are required'
            });
        }

        // Validate email if provided
        if (email && !isValidEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        // Validate phone if provided
        if (phone && !isValidPhone(phone)) {
            return res.status(400).json({ error: 'Invalid phone number. Must start with + and have 10-15 digits.' });
        }

        // Validate parent phone if provided
        if (parent_phone && !isValidPhone(parent_phone)) {
            return res.status(400).json({ error: 'Invalid parent phone number. Must start with + and have 10-15 digits.' });
        }

        // Check if student already exists
        const existingStudent = await pool.query(
            `SELECT id FROM students 
             WHERE organisation = $1 AND student_identifier = $2`,
            [organisation, student_identifier]
        );

        if (existingStudent.rows.length > 0) {
            return res.status(409).json({
                error: 'Student with this identifier already exists in your organisation'
            });
        }

        // Insert new student
        const result = await pool.query(
            `INSERT INTO students (
                organisation, student_identifier, student_name,
                class, section, roll_number, email, phone, parent_name, parent_phone, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *`,
            [organisation, student_identifier, student_name, className, section, roll_number, email, phone, parent_name, parent_phone, userId]
        );

        res.status(201).json({
            success: true,
            student: result.rows[0]
        });

    } catch (error) {
        console.error('Error creating student:', error);
        res.status(500).json({ error: 'Failed to create student' });
    }
}

/**
 * Search students by query and filters
 * GET /api/students/search?query=ravi&class=10
 */
async function searchStudents(req, res) {
    try {
        const { query, class: className, section } = req.query;
        const organisation = req.user.organisation;

        let sql = `
            SELECT id, student_identifier, student_name, class, section, 
                   roll_number, email, phone, parent_name, parent_phone, created_at
            FROM students
            WHERE organisation = $1
        `;
        const params = [organisation];
        let paramCount = 1;

        // Add search query filter
        if (query) {
            paramCount++;
            sql += ` AND (
                student_name ILIKE $${paramCount} OR 
                student_identifier ILIKE $${paramCount} OR
                roll_number ILIKE $${paramCount}
            )`;
            params.push(`%${query}%`);
        }

        // Add class filter
        if (className) {
            paramCount++;
            sql += ` AND class = $${paramCount}`;
            params.push(className);
        }

        // Add section filter
        if (section) {
            paramCount++;
            sql += ` AND section = $${paramCount}`;
            params.push(section);
        }

        sql += ` ORDER BY student_name LIMIT 50`;

        const result = await pool.query(sql, params);

        res.json({
            success: true,
            students: result.rows,
            count: result.rows.length
        });

    } catch (error) {
        console.error('Error searching students:', error);
        res.status(500).json({ error: 'Failed to search students' });
    }
}

/**
 * Get a single student by ID
 * GET /api/students/:id
 */
async function getStudent(req, res) {
    try {
        const { id } = req.params;
        const organisation = req.user.organisation;

        const result = await pool.query(
            `SELECT * FROM students 
             WHERE id = $1 AND organisation = $2`,
            [id, organisation]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }

        res.json({
            success: true,
            student: result.rows[0]
        });

    } catch (error) {
        console.error('Error fetching student:', error);
        res.status(500).json({ error: 'Failed to fetch student' });
    }
}

/**
 * Update a student
 * PATCH /api/students/:id
 */
async function updateStudent(req, res) {
    try {
        const { id } = req.params;
        const organisation = req.user.organisation;
        const {
            student_name,
            class: className,
            section,
            roll_number,
            email,
            phone,
            parent_name,
            parent_phone
        } = req.body;

        // Verify student belongs to organisation
        const studentCheck = await pool.query(
            `SELECT id FROM students WHERE id = $1 AND organisation = $2`,
            [id, organisation]
        );

        if (studentCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }

        // Build update query dynamically
        const updates = [];
        const params = [];
        let paramCount = 0;

        if (student_name !== undefined) {
            paramCount++;
            updates.push(`student_name = $${paramCount}`);
            params.push(student_name);
        }
        if (className !== undefined) {
            paramCount++;
            updates.push(`class = $${paramCount}`);
            params.push(className);
        }
        if (section !== undefined) {
            paramCount++;
            updates.push(`section = $${paramCount}`);
            params.push(section);
        }
        if (roll_number !== undefined) {
            paramCount++;
            updates.push(`roll_number = $${paramCount}`);
            params.push(roll_number);
        }
        if (email !== undefined) {
            if (email && !isValidEmail(email)) {
                return res.status(400).json({ error: 'Invalid email format' });
            }
            paramCount++;
            updates.push(`email = $${paramCount}`);
            params.push(email);
        }
        if (phone !== undefined) {
            if (phone && !isValidPhone(phone)) {
                return res.status(400).json({ error: 'Invalid phone number. Must start with + and have 10-15 digits.' });
            }
            paramCount++;
            updates.push(`phone = $${paramCount}`);
            params.push(phone);
        }
        if (parent_name !== undefined) {
            paramCount++;
            updates.push(`parent_name = $${paramCount}`);
            params.push(parent_name);
        }
        if (parent_phone !== undefined) {
            if (parent_phone && !isValidPhone(parent_phone)) {
                return res.status(400).json({ error: 'Invalid parent phone number. Must start with + and have 10-15 digits.' });
            }
            paramCount++;
            updates.push(`parent_phone = $${paramCount}`);
            params.push(parent_phone);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        paramCount++;
        params.push(id);

        const sql = `
            UPDATE students 
            SET ${updates.join(', ')}
            WHERE id = $${paramCount}
            RETURNING *
        `;

        const result = await pool.query(sql, params);

        res.json({
            success: true,
            student: result.rows[0]
        });

    } catch (error) {
        console.error('Error updating student:', error);
        res.status(500).json({ error: 'Failed to update student' });
    }
}

/**
 * Delete a student
 * DELETE /api/students/:id
 */
async function deleteStudent(req, res) {
    try {
        const { id } = req.params;
        const organisation = req.user.organisation;

        // Check if student has any submissions
        const submissionsCheck = await pool.query(
            `SELECT COUNT(*) as count FROM student_submissions 
             WHERE student_id = $1`,
            [id]
        );

        if (parseInt(submissionsCheck.rows[0].count) > 0) {
            return res.status(400).json({
                error: 'Cannot delete student with existing submissions. Please delete submissions first.'
            });
        }

        // Delete the student
        const result = await pool.query(
            `DELETE FROM students 
             WHERE id = $1 AND organisation = $2
             RETURNING id`,
            [id, organisation]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }

        res.json({
            success: true,
            message: 'Student deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting student:', error);
        res.status(500).json({ error: 'Failed to delete student' });
    }
}

/**
 * Get all students for the organisation
 * GET /api/students
 */
async function getAllStudents(req, res) {
    try {
        const organisation = req.user.organisation;
        const { class: className, section, limit = 100, offset = 0 } = req.query;

        let sql = `
            SELECT id, student_identifier, student_name, class, section,
                   roll_number, email, phone, parent_name, parent_phone, created_at
            FROM students
            WHERE organisation = $1
        `;
        const params = [organisation];
        let paramCount = 1;

        if (className) {
            paramCount++;
            sql += ` AND class = $${paramCount}`;
            params.push(className);
        }

        if (section) {
            paramCount++;
            sql += ` AND section = $${paramCount}`;
            params.push(section);
        }

        sql += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(parseInt(limit));
        params.push(parseInt(offset));

        const result = await pool.query(sql, params);

        res.json({
            success: true,
            students: result.rows,
            count: result.rows.length
        });

    } catch (error) {
        console.error('Error fetching students:', error);
        res.status(500).json({ error: 'Failed to fetch students' });
    }
}

async function bulkUploadStudents(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const organisation = req.user.organisation;
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);

        const results = {
            successCount: 0,
            errorCount: 0,
            errors: []
        };

        for (const [index, row] of data.entries()) {
            const rowNumber = index + 2; // 1-based index + header row
            const {

                'Student Name': studentName,
                'Student ID': studentIdentifier,
                'Class': className,
                'Roll Number': rollNumber,
                'Email': email,
                'Phone': phone,
                'Parent Name': parentName,
                'Parent Phone': parentPhone
            } = row;

            // Basic Validation
            if (!studentName || !studentIdentifier) {
                results.errorCount++;
                results.errors.push({
                    row: rowNumber,
                    error: 'Missing required fields (Student Name or Student ID)',
                    data: row
                });
                continue;
            }

            // Validate Email
            if (email && !isValidEmail(email)) {
                results.errorCount++;
                results.errors.push({
                    row: rowNumber,
                    error: 'Invalid email format',
                    data: row
                });
                continue;
            }

            // Process Phone - add +91 if not present
            let processedPhone = null;
            if (phone) {
                const phoneStr = phone.toString().trim();
                // If it's just 10 digits, add +91
                if (/^\d{10}$/.test(phoneStr)) {
                    processedPhone = '+91' + phoneStr;
                } else if (isValidPhone(phoneStr)) {
                    processedPhone = phoneStr;
                } else {
                    results.errorCount++;
                    results.errors.push({
                        row: rowNumber,
                        error: 'Invalid phone number. Must be 10 digits.',
                        data: row
                    });
                    continue;
                }
            }

            // Process Parent Phone - add +91 if not present
            let processedParentPhone = null;
            if (parentPhone) {
                const phoneStr = parentPhone.toString().trim();
                // If it's just 10 digits, add +91
                if (/^\d{10}$/.test(phoneStr)) {
                    processedParentPhone = '+91' + phoneStr;
                } else if (isValidPhone(phoneStr)) {
                    processedParentPhone = phoneStr;
                } else {
                    results.errorCount++;
                    results.errors.push({
                        row: rowNumber,
                        error: 'Invalid parent phone number. Must be 10 digits.',
                        data: row
                    });
                    continue;
                }
            }

            try {
                // Check if student exists
                const existingStudent = await pool.query(
                    `SELECT id FROM students WHERE student_identifier = $1 AND organisation = $2`,
                    [studentIdentifier, organisation]
                );

                if (existingStudent.rows.length > 0) {
                    // Update existing student
                    await pool.query(
                        `UPDATE students
                         SET student_name = $1, class = $2, roll_number = $3, email = $4, phone = $5, parent_name = $6, parent_phone = $7, updated_at = CURRENT_TIMESTAMP
                         WHERE id = $8`,
                        [studentName, className, rollNumber, email, processedPhone, parentName, processedParentPhone, existingStudent.rows[0].id]
                    );
                } else {
                    // Create new student
                    await pool.query(
                        `INSERT INTO students (student_name, student_identifier, class, roll_number, email, phone, parent_name, parent_phone, organisation)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                        [studentName, studentIdentifier, className, rollNumber, email, processedPhone, parentName, processedParentPhone, organisation]
                    );
                }
                results.successCount++;
            } catch (dbError) {
                results.errorCount++;
                results.errors.push({
                    row: rowNumber,
                    error: dbError.message,
                    data: row
                });
            }
        }

        // Generate Error File if there are errors
        let errorFileBase64 = null;
        if (results.errorCount > 0) {
            const errorWs = xlsx.utils.json_to_sheet(results.errors.map(e => ({
                ...e.data,
                'Error Message': e.error
            })));
            const errorWb = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(errorWb, errorWs, "Errors");
            const errorBuffer = xlsx.write(errorWb, { type: 'buffer', bookType: 'xlsx' });
            errorFileBase64 = errorBuffer.toString('base64');
        }

        res.json({
            success: true,
            summary: {
                total: data.length,
                success: results.successCount,
                failed: results.errorCount
            },
            errorFile: errorFileBase64
        });

    } catch (error) {
        console.error('Error processing bulk upload:', error);
        res.status(500).json({ error: 'Failed to process bulk upload' });
    }
}

async function downloadSample(req, res) {
    try {
        const headers = [
            {
                'Student Name': 'John Doe',
                'Student ID': 'STU001',
                'Class': '10A',
                'Roll Number': '101',
                'Email': 'john@example.com',
                'Phone': '9876543210',
                'Parent Name': 'Robert Doe',
                'Parent Phone': '9876543211'
            },
            {
                'Student Name': 'Jane Smith',
                'Student ID': 'STU002',
                'Class': '10B',
                'Roll Number': '102',
                'Email': 'jane@example.com',
                'Phone': '9123456789',
                'Parent Name': 'Mary Smith',
                'Parent Phone': '9123456788'
            }
        ];

        const ws = xlsx.utils.json_to_sheet(headers);
        const wb = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(wb, ws, "Students");

        const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=students_sample.xlsx');
        res.send(buffer);

    } catch (error) {
        console.error('Error generating sample file:', error);
        res.status(500).json({ error: 'Failed to generate sample file' });
    }
}

/**
 * Get all submissions for a specific student
 * GET /api/students/:id/submissions
 */
async function getStudentSubmissions(req, res) {
    try {
        const { id } = req.params;
        const organisation = req.user.organisation;

        // Verify student belongs to organisation
        const studentCheck = await pool.query(
            `SELECT id, student_name FROM students
             WHERE id = $1 AND organisation = $2`,
            [id, organisation]
        );

        if (studentCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Student not found'
            });
        }

        // Fetch all submissions for this student with assessment details
        // Calculate marks from answers table and percentage
        const result = await pool.query(
            `SELECT
                ss.id,
                ss.assessment_id,
                a.title as assessment_title,
                a.class,
                a.subject,
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
                ss.created_at
             FROM student_submissions ss
             JOIN assessments a ON ss.assessment_id = a.id
             WHERE ss.student_id = $1 AND a.created_by = $2
             ORDER BY ss.created_at DESC`,
            [id, req.user.id]
        );

        // Calculate class rank for each submission
        const submissionsWithRank = await Promise.all(result.rows.map(async (submission) => {
            // Only calculate rank for approved submissions
            if (submission.status === 'Approved' && submission.percentage > 0) {
                const rankQuery = await pool.query(
                    `WITH ranked_submissions AS (
                        SELECT
                            ss.id,
                            RANK() OVER (ORDER BY
                                CASE
                                    WHEN a.total_marks > 0
                                    THEN (COALESCE((SELECT SUM(ans.marks_obtained) FROM answers ans WHERE ans.submission_id = ss.id), 0) / a.total_marks * 100)
                                    ELSE 0
                                END DESC
                            ) as rank
                        FROM student_submissions ss
                        JOIN assessments a ON ss.assessment_id = a.id
                        WHERE ss.assessment_id = $1 AND ss.status = 'Approved'
                    )
                    SELECT rank FROM ranked_submissions WHERE id = $2`,
                    [submission.assessment_id, submission.id]
                );
                
                submission.class_rank = rankQuery.rows.length > 0 ? rankQuery.rows[0].rank : null;
            } else {
                submission.class_rank = null;
            }
            return submission;
        }));

        res.json({
            success: true,
            submissions: submissionsWithRank
        });

    } catch (error) {
        console.error('Error fetching student submissions:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch student submissions'
        });
    }
}

module.exports = {
    createStudent,
    searchStudents,
    getStudent,
    updateStudent,
    deleteStudent,
    getAllStudents,
    bulkUploadStudents,
    downloadSample,
    getStudentSubmissions
};
