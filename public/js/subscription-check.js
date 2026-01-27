
// Shared utility to check if user has active subscription
async function checkActiveSubscription() {
    try {
        const token = sessionStorage.getItem('token');
        if (!token) {
            window.location.href = '/login';
            return false;
        }

        const response = await fetch('/api/payment/subscription', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            // If API fails, redirect to plans page to be safe
            console.error('Failed to check subscription:', response.status);
            window.location.href = '/plans';
            return false;
        }

        const data = await response.json();
        const subscription = data.subscription;
        
        // Check if subscription is expired
        if (subscription.subscription_end) {
            const endDate = new Date(subscription.subscription_end);
            const now = new Date();
            
            if (endDate <= now) {
                // Subscription expired - redirect to plans page
                window.location.href = '/plans';
                return false;
            }
        }
        
        return true; // Subscription is active
    } catch (error) {
        console.error('Error checking subscription:', error);
        return true; // Allow on error to not block users
    }
}

// Function to wrap button clicks with subscription check
function requireActiveSubscription(originalFunction) {
    return async function(...args) {
        const hasActiveSubscription = await checkActiveSubscription();
        if (hasActiveSubscription) {
            return originalFunction.apply(this, args);
        }
    };
}
