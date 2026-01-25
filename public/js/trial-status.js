
// Shared script to update Upgrade button with trial end date
(async function() {
    try {
        const token = sessionStorage.getItem('token');
        if (!token) return;

        const response = await fetch('/api/payment/subscription', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) return;

        const data = await response.json();
        const subscription = data.subscription;
        
        const endDate = subscription.subscription_end ? new Date(subscription.subscription_end) : null;
        const now = new Date();
        
        if (!endDate || endDate <= now) return;
        
        // Calculate days remaining
        const daysRemaining = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
        
        // Only show date badge if subscription/trial ends within 15 days
        if (daysRemaining <= 15) {
            const formattedDate = endDate.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
            
            // Find Upgrade buttons in header only (exclude sidebar menu items)
            const upgradeButtons = document.querySelectorAll('a[href="/plans"]:not(nav a)');
            upgradeButtons.forEach(button => {
                // Check if badge already exists or if it's in a sidebar
                if (button.querySelector('.trial-end-badge')) return;
                if (button.closest('nav')) return; // Skip sidebar navigation links
                
                // Create date badge
                const badge = document.createElement('span');
                badge.className = 'trial-end-badge absolute -top-2 -right-2 bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap shadow-md';
                badge.textContent = formattedDate;
                
                // Make button relative positioned if not already
                button.style.position = 'relative';
                button.appendChild(badge);
            });
        }
    } catch (error) {
        console.error('Error fetching trial status:', error);
    }
})();
