import PayPage from './PayPage';

/**
 * Hosted plan-checkout page for platform billing.
 *
 * This is literally the merchant hosted PayPage component, just pointed at
 * the platform-owned billing endpoints (`/api/billing/pay/*`) and the
 * billing-side browser route (`/billing/pay/:token`). All visuals,
 * interactions, SSE auto-verify, "Download QR Code", "Share QR", success
 * redirect, etc. are identical to /pay/:token by construction.
 */
export default function BillingPayPage() {
  return <PayPage basePath="/api/billing/pay" pagePath="/billing/pay" />;
}
