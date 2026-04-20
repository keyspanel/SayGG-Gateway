import React, { useEffect, useState } from 'react';
import { gwGet } from './api';
import { StatusBadge } from './Dashboard';

const STATUSES = ['', 'pending', 'paid', 'failed', 'cancelled', 'expired'];
const PAGE_SIZE = 25;

export default function GwTransactions() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = async (off = 0) => {
    setLoading(true); setErr('');
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(off) });
      if (status) params.set('status', status);
      if (q) params.set('q', q);
      const d = await gwGet('/transactions?' + params.toString());
      setItems(d.items); setTotal(d.total); setOffset(off);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(0); }, [status]);

  const refresh = async (id: number) => {
    try {
      await fetch(`/api/gateway/orders/${id}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('gw_session_token')}` },
      });
      load(offset);
    } catch {}
  };

  return (
    <div className="gw-page">
      <div className="gw-card">
        <div className="gw-card-h"><h3>Transactions</h3></div>
        <div className="gw-filters">
          <input placeholder="Search ref, order ID, RRN…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(0)} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s : 'All statuses'}</option>)}
          </select>
          <button className="gw-btn-ghost" onClick={() => load(0)}>Search</button>
        </div>
        {err && <div className="gw-alert error">{err}</div>}
        {loading ? <div className="gw-loading">Loading…</div> :
          items.length === 0 ? <p className="gw-muted">No transactions yet.</p> :
            <div className="gw-txn-grid">
              {items.map((o) => (
                <div className="gw-txn" key={o.id}>
                  <div className="gw-txn-row">
                    <div className="mono small">{o.txn_ref}</div>
                    <StatusBadge status={o.status} />
                  </div>
                  <div className="gw-txn-amt">₹{parseFloat(o.amount).toFixed(2)} <span>{o.currency}</span></div>
                  <div className="gw-txn-meta">
                    <div><b>Order</b> #{o.id}{o.client_order_id ? ` · ${o.client_order_id}` : ''}</div>
                    {o.gateway_txn_id && <div><b>Gateway Txn</b> {o.gateway_txn_id}</div>}
                    {o.gateway_bank_txn_id && <div><b>Bank RRN</b> {o.gateway_bank_txn_id}</div>}
                    {o.customer_reference && <div><b>Customer Ref</b> {o.customer_reference}</div>}
                    <div><b>Created</b> {new Date(o.created_at).toLocaleString()}</div>
                    {o.verified_at && <div><b>Verified</b> {new Date(o.verified_at).toLocaleString()}</div>}
                    {o.callback_url && <div><b>Callback</b> {o.callback_sent ? `sent (${o.callback_status || 'ok'})` : 'not sent'}</div>}
                  </div>
                  {o.status === 'pending' && <button className="gw-btn-ghost sm" onClick={() => refresh(o.id)}>Refresh status</button>}
                </div>
              ))}
            </div>
        }
        <div className="gw-pager">
          <span>{offset + 1}-{Math.min(offset + items.length, total)} of {total}</span>
          <div>
            <button className="gw-btn-ghost sm" disabled={offset === 0} onClick={() => load(Math.max(0, offset - PAGE_SIZE))}>Prev</button>
            <button className="gw-btn-ghost sm" disabled={offset + items.length >= total} onClick={() => load(offset + PAGE_SIZE)}>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
