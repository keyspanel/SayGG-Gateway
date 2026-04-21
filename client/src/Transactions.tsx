import React, { useEffect, useState } from 'react';
import { gwGet, gwPost } from './api';
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
  const [refreshing, setRefreshing] = useState<number | null>(null);

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
  useEffect(() => { load(0); /* eslint-disable-next-line */ }, [status]);

  const refresh = async (id: number) => {
    setRefreshing(id);
    try {
      await gwPost(`/orders/${id}/refresh`);
      await load(offset);
    } catch {}
    finally { setRefreshing(null); }
  };

  return (
    <div className="gw-page">
      <div className="gw-page-h">
        <div>
          <h2>Transactions</h2>
          <p>Search, filter and inspect every order processed by your gateway.</p>
        </div>
      </div>

      <div className="gw-filters">
        <input placeholder="Search ref, order ID, RRN…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(0)} />
        <div className="gw-select-wrap">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All statuses'}</option>)}
          </select>
        </div>
        <button className="gw-btn-primary" onClick={() => load(0)}>Search</button>
      </div>

      {err && <div className="gw-alert error"><span>{err}</span></div>}

      {loading ? (
        <div className="gw-loading">Loading transactions…</div>
      ) : items.length === 0 ? (
        <div className="gw-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          <h3>No transactions found</h3>
          <p>Try adjusting your search or filters, or create a test order via the API.</p>
        </div>
      ) : (
        <div className="gw-txn-grid">
          {items.map((o) => (
            <div className="gw-txn" key={o.id}>
              <div className="gw-txn-row">
                <div className="gw-txn-ref" title={o.txn_ref}>{o.txn_ref}</div>
                <StatusBadge status={o.status} />
              </div>
              <div className="gw-txn-amt">₹{parseFloat(o.amount).toFixed(2)} <span>{o.currency}</span></div>
              <div className="gw-txn-meta">
                <div><b>Txn ID</b><span className="val">{o.txn_ref}</span></div>
                <div><b>Order ID</b><span className="val plain">{o.client_order_id ? o.client_order_id : `#${o.id}`}</span></div>
                {o.gateway_txn_id && <div><b>Gateway</b><span className="val">{o.gateway_txn_id}</span></div>}
                {o.gateway_bank_txn_id && <div><b>Bank RRN</b><span className="val">{o.gateway_bank_txn_id}</span></div>}
                {o.customer_reference && <div><b>Customer</b><span className="val plain">{o.customer_reference}</span></div>}
                <div><b>Created</b><span className="val plain">{new Date(o.created_at).toLocaleString()}</span></div>
                {o.verified_at && <div><b>Verified</b><span className="val plain">{new Date(o.verified_at).toLocaleString()}</span></div>}
              </div>
              {o.callback_url && (
                <div className={`gw-txn-callback${o.callback_status === 'success' ? ' ok' : ''}`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {o.callback_sent
                      ? <polyline points="20 6 9 17 4 12"/>
                      : <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>
                    }
                  </svg>
                  Callback {o.callback_sent ? `sent · ${o.callback_status || 'ok'}` : 'pending'}
                </div>
              )}
              {o.status === 'pending' && (
                <button className="gw-btn-ghost sm" style={{ alignSelf: 'flex-start' }} disabled={refreshing === o.id} onClick={() => refresh(o.id)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                  {refreshing === o.id ? 'Checking…' : 'Refresh status'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {total > 0 && !loading && (
        <div className="gw-pager">
          <span>Showing {offset + 1}–{Math.min(offset + items.length, total)} of {total}</span>
          <div>
            <button className="gw-btn-ghost sm" disabled={offset === 0} onClick={() => load(Math.max(0, offset - PAGE_SIZE))}>← Prev</button>
            <button className="gw-btn-ghost sm" disabled={offset + items.length >= total} onClick={() => load(offset + PAGE_SIZE)}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
