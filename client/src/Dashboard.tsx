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
  if (!data) return <div className="gw-loading">Loading dashboard…</div>;

  const s = data.stats;
  const setupComplete = !!data.setup_complete;
  const hasToken = !!data.has_token;

  return (
    <div className="gw-page">
      <div className="gw-welcome">
        <div>
          <h2>Welcome back, {user?.username}</h2>
          <p>Here's a quick look at your gateway activity.</p>
        </div>
        <div className="gw-status-pills">
          <span className={`gw-pill ${setupComplete ? 'ok' : 'warn'}`}>
            Gateway: {setupComplete ? 'Configured' : 'Setup required'}
          </span>
          <span className={`gw-pill ${hasToken ? 'ok' : 'warn'}`}>
            API token: {hasToken ? 'Active' : 'Not generated'}
          </span>
        </div>
      </div>

      {(!setupComplete || !hasToken) && (
        <div className="gw-card">
          <div className="gw-card-h">
            <h3>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Get started
            </h3>
          </div>
          <div className="gw-setup">
            <div className={`gw-setup-row${setupComplete ? ' done' : ''}`}>
              <div className="gw-setup-dot">{setupComplete ? '✓' : '1'}</div>
              <div className="gw-setup-text">
                <strong>Save your Paytm UPI settings</strong>
                <span>Add your UPI ID, Merchant ID and Merchant Key to activate the gateway.</span>
              </div>
              <Link to="/gateway/settings">{setupComplete ? 'Edit' : 'Configure →'}</Link>
            </div>
            <div className={`gw-setup-row${hasToken ? ' done' : ''}`}>
              <div className="gw-setup-dot">{hasToken ? '✓' : '2'}</div>
              <div className="gw-setup-text">
                <strong>Generate your API token</strong>
                <span>Required to authenticate Create Order and Check Order requests.</span>
              </div>
              <Link to="/gateway/docs">{hasToken ? 'View' : 'Generate →'}</Link>
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
          <strong>UPI Settings</strong>
          <span>Configure your Paytm credentials and gateway environment.</span>
        </Link>
        <Link to="/gateway/transactions" className="gw-shortcut">
          <strong>Transactions</strong>
          <span>Search, filter and refresh your full order history.</span>
        </Link>
        <Link to="/gateway/docs" className="gw-shortcut">
          <strong>API Docs</strong>
          <span>Token, endpoints, code samples and callback signatures.</span>
        </Link>
      </div>

      <div className="gw-card">
        <div className="gw-card-h">
          <h3>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Latest transactions
          </h3>
          <Link to="/gateway/transactions">View all</Link>
        </div>
        {data.recent.length === 0 ? (
          <div className="gw-empty">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
            <h3>No transactions yet</h3>
            <p>Once orders start flowing in, they'll appear here.</p>
          </div>
        ) : (
          <div className="gw-table">
            <div className="gw-tr head">
              <span>Txn Ref</span><span>Order ID</span><span>Amount</span><span>Status</span><span>Created</span>
            </div>
            {data.recent.map((o: any) => (
              <div className="gw-tr" key={o.id}>
                <span data-label="Txn Ref" className="mono small">{o.txn_ref}</span>
                <span data-label="Order ID">{o.client_order_id || `#${o.id}`}</span>
                <span data-label="Amount" style={{ fontWeight: 700 }}>₹{parseFloat(o.amount).toFixed(2)}</span>
                <span data-label="Status"><StatusBadge status={o.status} /></span>
                <span data-label="Created" className="gw-muted">{new Date(o.created_at).toLocaleString()}</span>
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
