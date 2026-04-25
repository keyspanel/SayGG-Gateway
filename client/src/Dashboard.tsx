import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { gwGet } from './api';
import { useGwAuth } from './AuthCtx';

export default function GwDashboard() {
  const { user } = useGwAuth();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');

  useEffect(() => { gwGet('/dashboard').then(setData).catch((e) => setErr(e.message)); }, []);

  if (err) return <div className="gw-page"><div className="gw-alert error"><span>{err}</span></div></div>;
  if (!data) return <div className="gw-loading">Loading…</div>;

  const s = data.stats;
  const setupComplete = !!data.setup_complete;
  const hasToken = !!data.has_token;
  const sub = user?.active_subscription;
  const planLocked = !user?.is_owner && !sub;

  return (
    <div className="gw-page">
      <div className="gw-page-h">
        <div>
          <h2>Overview</h2>
          <p>Real-time view of your gateway.</p>
        </div>
        <div className="gw-status-pills">
          {!user?.is_owner && (
            <span className={`gw-pill ${sub ? 'ok' : 'warn'}`}>
              {sub ? `Plan: ${sub.plan_name}` : 'No active plan'}
            </span>
          )}
          <span className={`gw-pill ${setupComplete ? 'ok' : 'warn'}`}>
            {setupComplete ? 'Setup complete' : 'Setup required'}
          </span>
          <span className={`gw-pill ${hasToken ? 'ok' : 'warn'}`}>
            {hasToken ? 'Token ready' : 'No token'}
          </span>
        </div>
      </div>

      {planLocked && (
        <div className="gw-card feature gw-lock-card">
          <div className="gw-card-h">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Choose a plan to start
            </h3>
          </div>
          <p>UPI setup, API tokens, and order creation unlock once you have an active plan.</p>
          <div className="gw-actions">
            <Link to="/gateway/billing" className="gw-btn-primary">View plans →</Link>
          </div>
        </div>
      )}

      {!planLocked && (!setupComplete || !hasToken) && (
        <div className="gw-card">
          <div className="gw-card-h">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Get started
            </h3>
          </div>
          <div className="gw-setup">
            <div className={`gw-setup-row${setupComplete ? ' done' : ''}`}>
              <div className="gw-setup-dot">{setupComplete ? '✓' : '1'}</div>
              <div className="gw-setup-text">
                <strong>Connect Paytm UPI</strong>
                <span>Add your UPI ID, Merchant ID and Key.</span>
              </div>
              <Link to="/gateway/settings">{setupComplete ? 'Edit' : 'Set up →'}</Link>
            </div>
            <div className={`gw-setup-row${hasToken ? ' done' : ''}`}>
              <div className="gw-setup-dot">{hasToken ? '✓' : '2'}</div>
              <div className="gw-setup-text">
                <strong>Create your API token</strong>
                <span>Required to call the gateway API.</span>
              </div>
              <Link to="/gateway/docs">{hasToken ? 'View' : 'Create →'}</Link>
            </div>
          </div>
        </div>
      )}

      <div className="gw-stats">
        <Stat label="Total" value={s.total} />
        <Stat label="Paid" value={s.paid} accent="ok" />
        <Stat label="Pending" value={s.pending} accent="warn" />
        <Stat label="Failed" value={s.failed} accent="bad" />
        <Stat label="Revenue" value={`₹${(s.revenue || 0).toFixed(2)}`} wide />
      </div>

      <div className="gw-shortcuts">
        <Link to="/gateway/settings" className="gw-shortcut">
          <strong>UPI Setup</strong>
          <span>Paytm credentials and environment.</span>
        </Link>
        <Link to="/gateway/transactions" className="gw-shortcut">
          <strong>Transactions</strong>
          <span>Search and inspect orders.</span>
        </Link>
        <Link to="/gateway/docs" className="gw-shortcut">
          <strong>API Reference</strong>
          <span>Token, endpoints and examples.</span>
        </Link>
        <Link to="/gateway/billing" className="gw-shortcut">
          <strong>Billing</strong>
          <span>Plans, current subscription and invoices.</span>
        </Link>
      </div>

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Recent orders
          </h3>
          <Link to="/gateway/transactions">View all</Link>
        </div>
        {data.recent.length === 0 ? (
          <div className="gw-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
            <h3>No orders yet</h3>
            <p>New orders will appear here.</p>
          </div>
        ) : (
          <div className="gw-table">
            <div className="gw-tr head">
              <span>Txn Ref</span><span>Order ID</span><span>Mode</span><span>Amount</span><span>Status</span><span>Created</span>
            </div>
            {data.recent.map((o: any) => (
              <div className="gw-tr" key={o.id}>
                <span data-label="Txn Ref" className="mono small">{o.txn_ref}</span>
                <span data-label="Order ID">{o.client_order_id || `#${o.id}`}</span>
                <span data-label="Mode"><ModeBadge mode={o.order_mode || 'hosted'} /></span>
                <span data-label="Amount" style={{ fontWeight: 700 }}>₹{parseFloat(o.amount).toFixed(2)}</span>
                <span data-label="Status"><StatusBadge status={o.status} /></span>
                <span data-label="Created" className="gw-muted" style={{ fontSize: 12, margin: 0 }}>{new Date(o.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent, wide }: { label: string; value: any; accent?: string; wide?: boolean }) {
  return (
    <div className={`gw-stat ${accent || ''}${wide ? ' wide' : ''}`}>
      <div className="gw-stat-l">{label}</div>
      <div className="gw-stat-v">{value}</div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const cls = ({ paid: 'ok', pending: 'warn', failed: 'bad', cancelled: 'bad', expired: 'mute' } as any)[status] || 'mute';
  return <span className={`gw-badge ${cls}`}>{status}</span>;
}

export function ModeBadge({ mode }: { mode: string }) {
  const cls = mode === 'server' ? 'mode-server' : 'mode-hosted';
  return <span className={`gw-badge ${cls}`} title={mode === 'server' ? 'Method 1 — JSON only' : 'Method 2 — hosted page'}>{mode}</span>;
}
