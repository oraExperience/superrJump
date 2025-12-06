
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Get all class-subject mappings for authenticated user
exports.getUserMappings = async (req, res) => {
  try {
    // Get userId from authenticated user (set by JWT middleware)
    const userId = req.user.id;

    const query = `
      SELECT
        id,
        class,
        subject,
        is_active,
        created_at,
        created_by,
        updated_at,
        updated_by
      FROM user_class_subject_mappings
      WHERE user_id = $1 AND is_active = TRUE
      ORDER BY class, subject
    `;

    const result = await pool.query(query, [userId]);

    // Group by class and subject for easier frontend consumption
    const mappings = result.rows;
    
    // Get unique classes
    const classes = [...new Set(mappings.map(m => m.class))].sort();
    
    // Get unique subjects
    const subjects = [...new Set(mappings.map(m => m.subject))].sort();
    
    // Create a map of class -> subjects
    const classSubjectMap = {};
    mappings.forEach(m => {
      if (!classSubjectMap[m.class]) {
        classSubjectMap[m.class] = [];
      }
      if (!classSubjectMap[m.class].includes(m.subject)) {
        classSubjectMap[m.class].push(m.subject);
      }
    });

    res.status(200).json({
      success: true,
      mappings: mappings,
      classes: classes,
      subjects: subjects,
      classSubjectMap: classSubjectMap
    });

  } catch (error) {
    console.error('Get mappings error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching mappings',
      error: error.message
    });
  }
};

// Check if user has permission for specific class-subject combination
exports.checkPermission = async (req, res) => {
  try {
    const userId = req.user.id;
    const { class: className, subject } = req.query;

    if (!className || !subject) {
      return res.status(400).json({
        success: false,
        message: 'Class and subject are required'
      });
    }

    const query = `
      SELECT id
      FROM user_class_subject_mappings
      WHERE user_id = $1 AND class = $2 AND subject = $3 AND is_active = TRUE
    `;

    const result = await pool.query(query, [userId, className, subject]);

    res.status(200).json({
      success: true,
      hasPermission: result.rows.length > 0
    });

  } catch (error) {
    console.error('Check permission error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while checking permission',
      error: error.message
    });
  }
};

// Validate user has permission for class-subject (used internally)
exports.validatePermission = async (userId, className, subject) => {
  const query = `
    SELECT id
    FROM user_class_subject_mappings
    WHERE user_id = $1 AND class = $2 AND subject = $3 AND is_active = TRUE
  `;

  const result = await pool.query(query, [userId, className, subject]);
  return result.rows.length > 0;
};

// Add new class-subject mapping
exports.addMapping = async (req, res) => {
  try {
    const userId = req.user.id;
    const { class: className, subject } = req.body;

    if (!className || !subject) {
      return res.status(400).json({
        success: false,
        message: 'Class and subject are required'
      });
    }

    // Check if mapping already exists
    const checkQuery = `
      SELECT id, is_active
      FROM user_class_subject_mappings
      WHERE user_id = $1 AND class = $2 AND subject = $3
    `;
    const existing = await pool.query(checkQuery, [userId, className, subject]);

    if (existing.rows.length > 0) {
      // If exists but inactive, reactivate it
      if (!existing.rows[0].is_active) {
        const updateQuery = `
          UPDATE user_class_subject_mappings
          SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP, updated_by = $1
          WHERE id = $2
          RETURNING *
        `;
        const result = await pool.query(updateQuery, [userId, existing.rows[0].id]);
        return res.status(200).json({
          success: true,
          message: 'Mapping reactivated successfully',
          mapping: result.rows[0]
        });
      } else {
        return res.status(400).json({
          success: false,
          message: 'This class-subject mapping already exists'
        });
      }
    }

    // Insert new mapping
    const insertQuery = `
      INSERT INTO user_class_subject_mappings (user_id, class, subject, created_by, updated_by)
      VALUES ($1, $2, $3, $1, $1)
      RETURNING *
    `;
    const result = await pool.query(insertQuery, [userId, className, subject]);

    res.status(201).json({
      success: true,
      message: 'Mapping added successfully',
      mapping: result.rows[0]
    });

  } catch (error) {
    console.error('Add mapping error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while adding mapping',
      error: error.message
    });
  }
};

// Delete class-subject mapping (soft delete)
exports.deleteMapping = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Mapping ID is required'
      });
    }

    // Verify mapping belongs to user
    const checkQuery = `
      SELECT id FROM user_class_subject_mappings
      WHERE id = $1 AND user_id = $2 AND is_active = TRUE
    `;
    const existing = await pool.query(checkQuery, [id, userId]);

    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Mapping not found'
      });
    }

    // Soft delete (set is_active to false)
    const deleteQuery = `
      UPDATE user_class_subject_mappings
      SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP, updated_by = $1
      WHERE id = $2
      RETURNING *
    `;
    const result = await pool.query(deleteQuery, [userId, id]);

    res.status(200).json({
      success: true,
      message: 'Mapping deleted successfully',
      mapping: result.rows[0]
    });

  } catch (error) {
    console.error('Delete mapping error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting mapping',
      error: error.message
    });
  }
};

module.exports = exports;
