
const pool = require('../config/database');

/**
 * Get dashboard statistics
 * GET /api/dashboard/stats
 */
async function getDashboardStats(req, res) {
    try {
        const userId = req.user.id;
        const organisation = req.user.organisation;

        // Get total students
        const studentsResult = await pool.query(
            'SELECT COUNT(*) as count FROM students WHERE organisation = $1',
            [organisation]
        );

        // Get total assessments for this user
        const assessmentsResult = await pool.query(
            'SELECT COUNT(*) as count FROM assessments WHERE created_by = $1',
            [userId]
        );

        // Get pending reviews (assessments with Pending in status)
        const pendingResult = await pool.query(
            `SELECT COUNT(*) as count FROM assessments 
             WHERE created_by = $1 AND status LIKE '%Pending%'`,
            [userId]
        );

        // Get active classes (unique classes from students)
        const classesResult = await pool.query(
            `SELECT COUNT(DISTINCT class) as count FROM students 
             WHERE organisation = $1 AND class IS NOT NULL AND class != ''`,
            [organisation]
        );

        // Get assessments grouped by status
        const statusResult = await pool.query(
            `SELECT status, COUNT(*) as count 
             FROM assessments 
             WHERE created_by = $1 
             GROUP BY status`,
            [userId]
        );

        const assessmentsByStatus = {};
        statusResult.rows.forEach(row => {
            assessmentsByStatus[row.status] = parseInt(row.count);
        });

        // Get students grouped by class
        const studentsByClassResult = await pool.query(
            `SELECT class, COUNT(*) as count 
             FROM students 
             WHERE organisation = $1 AND class IS NOT NULL AND class != ''
             GROUP BY class 
             ORDER BY class`,
            [organisation]
        );

        const studentsByClass = {};
        studentsByClassResult.rows.forEach(row => {
            studentsByClass[row.class] = parseInt(row.count);
        });

        res.json({
            success: true,
            stats: {
                totalStudents: parseInt(studentsResult.rows[0].count),
                totalAssessments: parseInt(assessmentsResult.rows[0].count),
                pendingReviews: parseInt(pendingResult.rows[0].count),
                activeClasses: parseInt(classesResult.rows[0].count),
                assessmentsByStatus,
                studentsByClass
            }
        });

    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch dashboard statistics'
        });
    }
}

/**
 * Get recent activity
 * GET /api/dashboard/recent-activity
 */
async function getRecentActivity(req, res) {
    try {
        const userId = req.user.id;
        const organisation = req.user.organisation;

        // Get recent assessments (last 5)
        const recentAssessmentsResult = await pool.query(
            `SELECT id, title, class, subject, status, created_at 
             FROM assessments 
             WHERE created_by = $1 
             ORDER BY created_at DESC 
             LIMIT 5`,
            [userId]
        );

        // Get recent students (last 5)
        const recentStudentsResult = await pool.query(
            `SELECT student_name, created_at 
             FROM students 
             WHERE organisation = $1 
             ORDER BY created_at DESC 
             LIMIT 5`,
            [organisation]
        );

        // Combine and format activities
        const activities = [];

        // Add assessment activities
        recentAssessmentsResult.rows.forEach(assessment => {
            const timeDiff = getTimeAgo(assessment.created_at);
            activities.push({
                type: 'assessment',
                title: `${assessment.title} assessment created`,
                timestamp: timeDiff,
                date: assessment.created_at
            });
        });

        // Add student activities
        recentStudentsResult.rows.forEach(student => {
            const timeDiff = getTimeAgo(student.created_at);
            activities.push({
                type: 'student',
                title: `${student.student_name} added to students`,
                timestamp: timeDiff,
                date: student.created_at
            });
        });

        // Sort by date and take top 10
        activities.sort((a, b) => new Date(b.date) - new Date(a.date));
        const topActivities = activities.slice(0, 10);

        res.json({
            success: true,
            activities: topActivities,
            recentAssessments: recentAssessmentsResult.rows
        });

    } catch (error) {
        console.error('Error fetching recent activity:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch recent activity'
        });
    }
}

/**
 * Helper function to calculate time ago
 */
function getTimeAgo(date) {
    const now = new Date();
    const past = new Date(date);
    const diffMs = now - past;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } else if (diffHours > 0) {
        return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else if (diffMins > 0) {
        return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    } else {
        return 'Just now';
    }
}

module.exports = {
    getDashboardStats,
    getRecentActivity
};
