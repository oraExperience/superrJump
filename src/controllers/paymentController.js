
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Create Razorpay order (single user subscription only)
exports.createOrder = async (req, res) => {
  try {
    const { plan } = req.body;
    const userId = req.user.id;

    // Define plan pricing (in paise for Razorpay)
    const planPrices = {
      monthly: 100000,  // ₹1,000 in paise
      annual: 1000000   // ₹10,000 in paise
    };

    if (!planPrices[plan]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan selected'
      });
    }

    const amount = planPrices[plan]; // Single user only

    // Create Razorpay order
    const options = {
      amount: amount, // amount in paise
      currency: 'INR',
      receipt: `order_${userId}_${Date.now()}`,
      notes: {
        userId: userId,
        plan: plan,
        userCount: 1 // Always single user
      }
    };

    const order = await razorpay.orders.create(options);

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID
    });
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order',
      error: error.message
    });
  }
};

// Verify payment signature and update subscription
exports.verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      plan
    } = req.body;

    const userId = req.user.id;

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    const isAuthentic = expectedSignature === razorpay_signature;

    if (!isAuthentic) {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed'
      });
    }

    // Calculate subscription end date (end of day at 23:59:59)
    const startDate = new Date();
    const endDate = new Date();
    if (plan === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else if (plan === 'annual') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }
    // Set to end of day (23:59:59)
    endDate.setHours(23, 59, 59, 999);

    // Update user subscription in database
    // Set trial_user = false since they are now a paying customer
    const updateQuery = `
      UPDATE users
      SET
        trial_user = false,
        subscription_start = $1,
        subscription_end = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [
      startDate,   // subscription_start
      endDate,     // subscription_end
      userId       // user id
    ]);

    // Fetch payment details from Razorpay for metadata
    let paymentMetadata = {};
    try {
      const payment = await razorpay.payments.fetch(razorpay_payment_id);
      paymentMetadata = {
        method: payment.method,
        email: payment.email,
        contact: payment.contact,
        amount_paid: payment.amount,
        card_network: payment.card?.network,
        card_last4: payment.card?.last4,
        bank: payment.bank,
        wallet: payment.wallet,
        vpa: payment.vpa,
        captured: payment.captured,
        fee: payment.fee,
        tax: payment.tax,
        created_at: payment.created_at
      };
    } catch (err) {
      console.error('Error fetching payment metadata:', err);
    }

    // Store payment record with metadata
    const paymentQuery = `
      INSERT INTO payments (
        user_id,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        amount,
        currency,
        plan,
        status,
        metadata,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
    `;

    await pool.query(paymentQuery, [
      userId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      plan === 'monthly' ? 100 : 100, // Testing: ₹1 for both plans (in paise)
      'INR',
      plan,
      'success',
      JSON.stringify(paymentMetadata)
    ]);

    res.json({
      success: true,
      message: 'Payment verified and subscription activated',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify payment',
      error: error.message
    });
  }
};

// Get subscription details
exports.getSubscription = async (req, res) => {
  try {
    const userId = req.user.id;

    const query = `
      SELECT
        subscription_start,
        subscription_end,
        trial_user
      FROM users
      WHERE id = $1
    `;

    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const subscription = result.rows[0];
    
    // Determine status based ONLY on trial_user flag and subscription_end date
    const now = new Date();
    const endDate = subscription.subscription_end ? new Date(subscription.subscription_end) : null;
    let actualStatus = 'no_subscription';
    
    if (endDate && endDate > now) {
      // Subscription is active
      if (subscription.trial_user === true) {
        actualStatus = 'trial';  // Still in trial period
      } else {
        actualStatus = 'active';  // Paying customer
      }
    } else if (endDate && endDate <= now) {
      // Subscription has expired
      actualStatus = 'expired';
    }

    res.json({
      success: true,
      subscription: {
        ...subscription,
        subscription_status: actualStatus
      }
    });
  } catch (error) {
    console.error('Error fetching subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription details',
      error: error.message
    });
  }
};

// Record failed payment attempt
exports.recordFailedPayment = async (req, res) => {
  try {
    const { razorpay_order_id, error_data, plan } = req.body;
    const userId = req.user.id;

    const paymentQuery = `
      INSERT INTO payments (
        user_id,
        razorpay_order_id,
        amount,
        currency,
        plan,
        status,
        metadata,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
    `;

    await pool.query(paymentQuery, [
      userId,
      razorpay_order_id,
      plan === 'monthly' ? 100 : 100, // Testing: ₹1 for both plans (in paise)
      'INR',
      plan,
      'failed',
      JSON.stringify(error_data || {})
    ]);

    res.json({
      success: true,
      message: 'Failed payment recorded'
    });
  } catch (error) {
    console.error('Error recording failed payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record payment failure',
      error: error.message
    });
  }
};
