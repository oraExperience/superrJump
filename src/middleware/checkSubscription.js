
const pool = require('../config/database');

/**
 * Middleware to check if user has an active subscription
 * Blocks access if subscription has expired
 */
async function checkActiveSubscription(req, res, next) {
    try {
        // Get user ID from the authenticated token
        const userId = req.user?.id;
        
        if (!userId) {
            return res.status(401).json({
                error: 'User authentication required',
                requiresSubscription: true
            });
        }

        // Query user's subscription details
        console.log('Checking subscription for user:', userId);
        const result = await pool.query(
            'SELECT subscription_end, trial_user FROM users WHERE id = $1',
            [userId]
        );
        const rows = result.rows;
        console.log('Query result rows:', rows);

        if (rows.length === 0) {
            return res.status(404).json({ 
                error: 'User not found',
                requiresSubscription: true 
            });
        }

        const user = rows[0];
        
        // Check if subscription has ended
        if (user.subscription_end) {
            const subscriptionEnd = new Date(user.subscription_end);
            const now = new Date();

            if (subscriptionEnd <= now) {
                // Subscription expired
                return res.status(403).json({
                    error: user.trial_user 
                        ? 'Your 7-day free trial has expired. Please subscribe to continue using SuperrJump.'
                        : 'Your subscription has expired. Please renew to continue using SuperrJump.',
                    expired: true,
                    requiresSubscription: true,
                    subscriptionEnd: subscriptionEnd.toISOString()
                });
            }
        }

        // Subscription is active, proceed
        next();
    } catch (error) {
        console.error('Error checking subscription:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            userId: req.user?.id
        });
        res.status(500).json({ 
            error: 'Failed to verify subscription status',
            requiresSubscription: true,
            details: error.message
        });
    }
}

module.exports = checkActiveSubscription;
