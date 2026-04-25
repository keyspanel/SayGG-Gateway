import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { apiGet, apiPost } from './api';

interface PlanOrderView {
  id: number;
  txn_ref: string;
  public_token: string;
  amount: number;
  currency: string;
  status: string;
  upi_payload?: string;
  payment_link?: string;
  expires_at: string | null;
  paid_at: string | null;
  created_at: string;
  is_terminal: boolean;
  activated_subscription_id: number | null;
  bank_rrn: string | null;
  plan_id: number;
  plan_key: string;
  plan_name: string;
  plan: { plan_key: string; name: string; method_access: string; duration_days: number };
  payee_name: string;
}

export default function BillingPayPage() {
  const { token } = useParams();
  const nav = useNavigate();
  const [order, setOrder] = useState<PlanOrderView | null>(null);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [now, setNow] = useState(Date.now());
  const stoppedRef = useRef(false);

  const load = async () => {
    try {
      const o = await apiGet(`/api/billing/pay/${token}`);
      setOrder(o);
      if (o.upi_payload) {
        try {
          const url = await QRCode.toDataURL(o.upi_payload, { width: 320, margin: 2, errorCorrectionLevel: 'M' });
          setQrDataUrl(url);
        } catch {}
      }
      return o;
    } catch (e: any) {
      setErr(e.message || 'Could not load this payment link.');
      return null;
    }
  };

  const refresh = async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const o = await apiPost(`/api/billing/pay/${token}/refresh`);
      setOrder(o);
      if (o.status === 'paid') {
        stoppedRef.current = true;
        setTimeout(() => nav('/gateway/billing/success', { replace: true }), 800);
      }
    } catch {}
    finally { if (manual) setRefreshing(false); }
  };

  useEffect(() => { load(); }, [token]);

  // Auto-poll every 5s while pending
  useEffect(() => {
    if (!order || order.is_terminal) return;
    const id = setInterval(() => {
      if (stoppedRef.current) return;
      refresh().catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [order?.is_terminal, order?.id]);

  // Tick clock for countdown
  useEffect(() => {
    if (!order || order.is_terminal) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [order?.is_terminal, order?.id]);

  if (err) {
    return (
      <div className="bp-shell">
        <div className="bp-card">
          <h2>Link not available</h2>
          <p className="gw-muted">{err}</p>
          <a href="/gateway/billing" className="gw-btn-primary">Back to billing</a>
        </div>
      </div>
    );
  }
  if (!order) return <div className="gw-fullboot" aria-label="Loading" />;

  const expSecs = order.expires_at ? Math.max(0, Math.floor((new Date(order.expires_at).getTime() - now) / 1000)) : null;

  return (
    <div className="bp-shell">
      <div className="bp-card">
        <div className="bp-h">
          <div className="bp-brand">PG</div>
          <div>
            <div className="bp-h-t">{order.plan_name}</div>
            <div className="gw-muted bp-h-s">{order.plan.duration_days} days · {order.plan.method_access === 'master' ? 'all features' : `${order.plan.method_access} only`}</div>
          </div>
        </div>

        <div className="bp-amt">
          ₹{order.amount.toFixed(2)} <span>{order.currency}</span>
        </div>

        <Status order={order} />

        {order.status === 'pending' && (
          <>
            <div className="bp-qr">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="UPI QR" width={280} height={280} />
              ) : (
                <div className="bp-qr-placeholder">Generating QR…</div>
              )}
            </div>
            <p className="bp-muted">Scan with any UPI app, or tap the button below on mobile.</p>
            <div className="bp-actions">
              {order.upi_payload && (
                <a className="gw-btn-primary" href={order.upi_payload}>Pay with UPI app</a>
              )}
              <button className="gw-btn-ghost" disabled={refreshing} onClick={() => refresh(true)}>
                {refreshing ? 'Checking…' : 'I have paid · Check status'}
              </button>
            </div>
            {expSecs != null && (
              <div className="bp-exp">
                {expSecs > 0 ? <>Expires in <b>{fmtTime(expSecs)}</b></> : <>This link has expired.</>}
              </div>
            )}
          </>
        )}

        {order.status === 'paid' && (
          <div className="bp-paid">
            <div className="bp-tick">✓</div>
            <h3>Payment received</h3>
            <p className="gw-muted">Activating your plan…</p>
          </div>
        )}

        {(order.status === 'failed' || order.status === 'cancelled' || order.status === 'expired') && (
          <div className="bp-failed">
            <h3>{order.status === 'expired' ? 'Link expired' : order.status === 'cancelled' ? 'Cancelled' : 'Payment failed'}</h3>
            <p className="gw-muted">Start a new purchase from the billing page.</p>
            <a href="/gateway/billing" className="gw-btn-primary">Back to billing</a>
          </div>
        )}

        <div className="bp-meta">
          <div><b>Reference</b><span className="mono">{order.txn_ref}</span></div>
          <div><b>Payee</b><span>{order.payee_name}</span></div>
        </div>
      </div>
    </div>
  );
}

function Status({ order }: { order: PlanOrderView }) {
  const map: Record<string, { cls: string; label: string }> = {
    pending: { cls: 'warn', label: 'Awaiting payment' },
    paid: { cls: 'ok', label: 'Paid' },
    failed: { cls: 'bad', label: 'Failed' },
    cancelled: { cls: 'bad', label: 'Cancelled' },
    expired: { cls: 'mute', label: 'Expired' },
  };
  const m = map[order.status] || { cls: 'mute', label: order.status };
  return <div className="bp-status"><span className={`gw-badge ${m.cls}`}>{m.label}</span></div>;
}

function fmtTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
