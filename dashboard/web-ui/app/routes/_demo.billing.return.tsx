/**
 * Stripe Billing Portal Return Page (Demo)
 * 
 * This page is shown when Stripe redirects back from the billing portal.
 * It closes the popup window and notifies the parent window to refresh.
 */

import { useEffect } from 'react';

export default function BillingReturn() {
  useEffect(() => {
    // Notify parent window that billing portal was closed
    if (window.opener) {
      // Send message to parent to refresh billing data
      window.opener.postMessage({ type: 'STRIPE_PORTAL_CLOSED' }, window.location.origin);
      // Close this popup window
      window.close();
    } else {
      // If no opener (shouldn't happen), redirect to billing page
      window.location.href = '/demo/billing';
    }
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <div className="text-center">
        <div className="text-lg font-bold text-slate-700 mb-2">Completing...</div>
        <div className="text-sm text-slate-500">Please wait while we update your billing information.</div>
      </div>
    </div>
  );
}
