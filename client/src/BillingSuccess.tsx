import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useGwAuth } from './AuthCtx';

export default function BillingSuccess() {
  const { refresh, user } = useGwAuth();
  useEffect(() => { refresh().catch(() => {}); }, []);

  const sub = user?.active_subscription;

  return (
    <div className="gw-page">
      <div className="gw-card feature" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, lineHeight: 1, color: 'var(--gw-ok, #16a34a)' }}>✓</div>
        <h2 style={{ marginTop: 8 }}>Plan activated</h2>
        {sub ? (
          <p className="gw-muted">
            <strong>{sub.plan_name}</strong> is now active{sub.expires_at ? ` until ${new Date(sub.expires_at).toLocaleString()}` : ''}.
          </p>
        ) : (
          <p className="gw-muted">Your subscription is now active.</p>
        )}
        <div className="gw-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
          <Link to="/gateway/settings" className="gw-btn-primary">Set up UPI</Link>
          <Link to="/gateway" className="gw-btn-ghost">Go to dashboard</Link>
        </div>
      </div>
    </div>
  );
}
