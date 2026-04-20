import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { gwGet } from './api';
import { useGwAuth } from './AuthCtx';

export default function GwDashboard() {
  const { user } = useGwAuth();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { gwGet('/dashboard').then(setData).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="gw-alert error">{err}</div>;
  if (!data) return <div className="gw-loading">Loading…</div>;
  const s = data.stats;

  return (
    <div className="gw-page">
      <div className="gw-welcome">
        <div>
          <h2>Welcome back, {user?.username}</h2>
          <p>Here's a quick look at your gateway activity.</p>
        </div>
        <div className="gw-status-pills">
          <span className={`gw-pill ${data.has_token ? 'ok' : 'warn'}`}>API token: {data.has_token ? 'Active' : 'Missing'}</span>
          <span className={`gw-pill ${data.setup_complete ? 'ok' : 'warn'}`}>Gateway: {data.setup_complete ? 'Configured' : 'Not configured'}</span>
        </div>
      </div>

      <div className="gw-stats">
        <Stat label="Total orders" value={s.total} />
        <Stat label="Paid" value={s.paid} accent="ok" />
        <Stat label="Pending" value={s.pending} accent="warn" />
        <Stat label="Failed" value={s.failed} accent="bad" />
        <Stat label="Revenue" value={`₹${(s.revenue || 0).toFixed(2)}`} />
      </div>

      <div className="gw-shortcuts">
        <Link to="/gateway/settings" className="gw-shortcut"><strong>UPI Settings</strong><span>Configure your Paytm credentials</span></Link>
        <Link to="/gateway/docs" className="gw-shortcut"><strong>API Docs</strong><span>Get your token & integration guide</span></Link>
        <Link to="/gateway/transactions" className="gw-shortcut"><strong>Transactions</strong><span>View your full order history</span></Link>
      </div>

      <div className="gw-card">
        <div className="gw-card-h"><h3>Latest transactions</h3><Link to="/gateway/transactions">View all</Link></div>
        {data.recent.length === 0 ? <p className="gw-muted">No transactions yet.</p> :
          <div className="gw-table">
            <div className="gw-tr head"><span>Txn Ref</span><span>Order ID</span><span>Amount</span><span>Status</span><span>Created</span></div>
            {data.recent.map((o: any) => (
              <div className="gw-tr" key={o.id}>
                <span className="mono">{o.txn_ref}</span>
                <span>{o.client_order_id || `#${o.id}`}</span>
                <span>₹{parseFloat(o.amount).toFixed(2)}</span>
                <span><StatusBadge status={o.status} /></span>
                <span>{new Date(o.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        }
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: any; accent?: string }) {
  return (
    <div className={`gw-stat ${accent || ''}`}>
      <div className="gw-stat-v">{value}</div>
      <div className="gw-stat-l">{label}</div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const cls = ({ paid: 'ok', pending: 'warn', failed: 'bad', cancelled: 'bad', expired: 'mute' } as any)[status] || 'mute';
  return <span className={`gw-badge ${cls}`}>{status}</span>;
}
