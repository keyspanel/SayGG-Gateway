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
      await gwPost(`/orders/${id}/refresh`);
      load(offset);
    } catch {}
  };

  return (
    <div className="gw-page">
      <div className="gw-card" style={{padding: 0, overflow: 'visible', background: 'transparent', border: 'none'}}>
        <div className="gw-card-h" style={{padding: '0 8px'}}>
          <h3 style={{fontSize: '24px'}}>Transactions</h3>
        </div>
        
        <div className="gw-filters">
          <input placeholder="Search ref, order ID, RRN…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(0)} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All statuses'}</option>)}
          </select>
          <button className="gw-btn-primary" onClick={() => load(0)}>Search</button>
        </div>

        {err && <div className="gw-alert error">{err}</div>}
        
        {loading ? <div className="gw-loading">Loading transactions…</div> :
          items.length === 0 ? (
            <div className="gw-card" style={{textAlign: 'center', padding: '48px 24px'}}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--gw-text-mute)', marginBottom: '16px'}}><rect x="2" y="4" width="20" height="16" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
              <h3 style={{fontSize: '18px', marginBottom: '8px', fontWeight: 600}}>No transactions found</h3>
              <p className="gw-muted">Try adjusting your search or filters.</p>
            </div>
          ) : (
            <div className="gw-txn-grid">
              {items.map((o) => (
                <div className="gw-txn" key={o.id}>
                  <div className="gw-txn-row">
                    <div className="mono small" style={{color: 'var(--gw-primary)'}}>{o.txn_ref}</div>
                    <StatusBadge status={o.status} />
                  </div>
                  <div className="gw-txn-amt">₹{parseFloat(o.amount).toFixed(2)} <span>{o.currency}</span></div>
                  <div className="gw-txn-meta">
                    <div><b>Order ID</b> {o.client_order_id ? o.client_order_id : `#${o.id}`}</div>
                    {o.gateway_txn_id && <div><b>Gateway Txn</b> <span className="mono">{o.gateway_txn_id}</span></div>}
                    {o.gateway_bank_txn_id && <div><b>Bank RRN</b> <span className="mono">{o.gateway_bank_txn_id}</span></div>}
                    {o.customer_reference && <div><b>Customer Ref</b> {o.customer_reference}</div>}
                    <div><b>Created</b> {new Date(o.created_at).toLocaleString()}</div>
                    {o.verified_at && <div><b>Verified</b> {new Date(o.verified_at).toLocaleString()}</div>}
                  </div>
                  {o.callback_url && (
                    <div style={{fontSize: '12px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px', color: o.callback_status === 'success' ? 'var(--gw-ok)' : 'var(--gw-text-mute)'}}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      Callback {o.callback_sent ? `sent (${o.callback_status || 'ok'})` : 'not sent'}
                    </div>
                  )}
                  {o.status === 'pending' && (
                    <button className="gw-btn-ghost sm" style={{marginTop: '8px', alignSelf: 'flex-start'}} onClick={() => refresh(o.id)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight: '6px'}}><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                      Refresh status
                    </button>
                  )}
                </div>
              ))}
            </div>
          )
        }
        
        {total > 0 && (
          <div className="gw-pager">
            <span>Showing {offset + 1}-{Math.min(offset + items.length, total)} of {total}</span>
            <div>
              <button className="gw-btn-ghost sm" disabled={offset === 0} onClick={() => load(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
              <button className="gw-btn-ghost sm" disabled={offset + items.length >= total} onClick={() => load(offset + PAGE_SIZE)}>Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
