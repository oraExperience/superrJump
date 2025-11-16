
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

module.exports = exports;
