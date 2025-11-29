
const pool = require('../config/database');

/**
 * Find matching students based on extracted information
 * Returns students with confidence scores
 * Excludes students who already have approved submissions for the given assessment
 */
async function findMatchingStudents(extractedInfo, organisation, assessmentId = null) {
    try {
        const { student_name, student_identifier, roll_number, class: className } = extractedInfo;

        // Find potential matches
        const matches = [];

        // Build exclusion clause for students with approved submissions
        let exclusionClause = '';
        if (assessmentId) {
            exclusionClause = `AND id NOT IN (
                SELECT student_id FROM student_submissions
                WHERE assessment_id = ${assessmentId} AND status = 'Approved' AND student_id IS NOT NULL
            )`;
        }

        // Exact match by student_identifier
        if (student_identifier) {
            const exactMatch = await pool.query(
                `SELECT * FROM students
                 WHERE organisation = $1 AND student_identifier = $2 ${exclusionClause}`,
                [organisation, student_identifier]
            );

            if (exactMatch.rows.length > 0) {
                matches.push({
                    ...exactMatch.rows[0],
                    confidence: 1.0,
                    match_reason: 'Exact match by student identifier'
                });
                return matches; // Return immediately on exact match
            }
        }

        // Search by name and class
        if (student_name && className) {
            const nameMatches = await pool.query(
                `SELECT * FROM students
                 WHERE organisation = $1
                 AND student_name ILIKE $2
                 AND class = $3
                 ${exclusionClause}
                 LIMIT 5`,
                [organisation, `%${student_name}%`, className]
            );

            nameMatches.rows.forEach(student => {
                const similarity = calculateNameSimilarity(student_name, student.student_name);
                matches.push({
                    ...student,
                    confidence: similarity,
                    match_reason: `Name similarity: ${(similarity * 100).toFixed(0)}%`
                });
            });
        }

        // Search by roll number in same class
        if (roll_number && className) {
            const rollMatches = await pool.query(
                `SELECT * FROM students
                 WHERE organisation = $1
                 AND roll_number = $2
                 AND class = $3
                 ${exclusionClause}
                 LIMIT 3`,
                [organisation, roll_number, className]
            );

            rollMatches.rows.forEach(student => {
                // Check if already added
                if (!matches.find(m => m.id === student.id)) {
                    matches.push({
                        ...student,
                        confidence: 0.85,
                        match_reason: 'Matched by roll number and class'
                    });
                }
            });
        }

        // Sort by confidence descending
        matches.sort((a, b) => b.confidence - a.confidence);

        return matches.slice(0, 5); // Return top 5 matches

    } catch (error) {
        console.error('Error finding matching students:', error);
        throw error;
    }
}

/**
 * Calculate name similarity score (0-1)
 * Simple implementation - can be enhanced with Levenshtein distance
 */
function calculateNameSimilarity(name1, name2) {
    // Convert to lowercase and remove extra spaces
    const n1 = name1.toLowerCase().trim().replace(/\s+/g, ' ');
    const n2 = name2.toLowerCase().trim().replace(/\s+/g, ' ');

    // Exact match
    if (n1 === n2) return 1.0;

    // Check if one contains the other
    if (n1.includes(n2) || n2.includes(n1)) {
        return 0.9;
    }

    // Split into words and check overlap
    const words1 = n1.split(' ');
    const words2 = n2.split(' ');
    
    let matchingWords = 0;
    words1.forEach(w1 => {
        if (words2.some(w2 => w2.includes(w1) || w1.includes(w2))) {
            matchingWords++;
        }
    });

    // Calculate percentage of matching words
    const maxWords = Math.max(words1.length, words2.length);
    return matchingWords / maxWords;
}

/**
 * Suggest creating a new student or selecting existing
 * @param {Object} extractedInfo - Extracted student information
 * @param {String} organisation - Organisation name
 * @param {Number} assessmentId - Assessment ID to exclude students with approved submissions
 */
async function suggestStudentAction(extractedInfo, organisation, assessmentId = null) {
    try {
        const matches = await findMatchingStudents(extractedInfo, organisation, assessmentId);

        if (matches.length === 0) {
            return {
                action: 'create',
                message: 'No matching students found. Create new student?',
                matches: [],
                extractedInfo
            };
        }

        if (matches[0].confidence >= 0.9) {
            return {
                action: 'select',
                message: 'High confidence match found',
                matches,
                suggestedStudent: matches[0],
                extractedInfo
            };
        }

        return {
            action: 'review',
            message: 'Potential matches found. Please review:',
            matches,
            extractedInfo
        };

    } catch (error) {
        console.error('Error suggesting student action:', error);
        throw error;
    }
}

/**
 * Create student from extracted information
 */
async function createStudentFromExtraction(extractedInfo, organisation, createdBy) {
    try {
        const {
            student_name,
            student_identifier,
            roll_number,
            class: className,
            subject
        } = extractedInfo;

        // Check if student already exists
        if (student_identifier) {
            const existing = await pool.query(
                `SELECT id FROM students 
                 WHERE organisation = $1 AND student_identifier = $2`,
                [organisation, student_identifier]
            );

            if (existing.rows.length > 0) {
                throw new Error('Student with this identifier already exists');
            }
        }

        // Insert new student
        const result = await pool.query(
            `INSERT INTO students (
                organisation, student_identifier, student_name,
                class, roll_number, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [organisation, student_identifier, student_name, className, roll_number, createdBy]
        );

        return result.rows[0];

    } catch (error) {
        console.error('Error creating student from extraction:', error);
        throw error;
    }
}

module.exports = {
    findMatchingStudents,
    suggestStudentAction,
    createStudentFromExtraction,
    calculateNameSimilarity
};
