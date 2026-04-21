import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

interface PayOrder {
  public_token: string;
  txn_ref: string;
  client_order_id: string | null;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled' | string;
  note: string | null;
  payee_name: string;
  upi_payload: string | null;
  created_at: string;
  expires_at: string | null;
  verified_at: string | null;
  is_terminal: boolean;
  is_expired: boolean;
  bank_rrn: string | null;
}

function pollIntervalFor(elapsedMs: number): number {
  if (elapsedMs < 60_000) return 5000;
  if (elapsedMs < 5 * 60_000) return 8000;
  if (elapsedMs < 15 * 60_000) return 15000;
  return 30000;
}

async function fetchOrder(token: string, refresh = false): Promise<{ ok: boolean; status: number; data?: PayOrder; message?: string }> {
  try {
    const res = await fetch(`/api/pay/${token}${refresh ? '/refresh' : ''}`, {
      method: refresh ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, message: body?.message || 'Unable to load payment link' };
    return { ok: true, status: res.status, data: body.data as PayOrder };
  } catch (e: any) {
    return { ok: false, status: 0, message: e?.message || 'Network error' };
  }
}

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function StatusVisual({ order }: { order: PayOrder }) {
  if (order.status === 'paid') {
    return (
      <div className="pp-status paid">
        <div className="pp-status-icon">
          <svg viewBox="0 0 52 52" width="52" height="52" aria-hidden="true">
            <circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeWidth="3" />
            <path d="M14 27 L23 36 L39 18" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h3>Payment received</h3>
        <p>₹{order.amount.toFixed(2)} confirmed.</p>
        {order.bank_rrn && <p className="pp-meta">Bank RRN <code>{order.bank_rrn}</code></p>}
      </div>
    );
  }
  if (order.status === 'failed') {
    return (
      <div className="pp-status failed">
        <div className="pp-status-icon">
          <svg viewBox="0 0 52 52" width="52" height="52"><circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeWidth="3"/><line x1="18" y1="18" x2="34" y2="34" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/><line x1="34" y1="18" x2="18" y2="34" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/></svg>
        </div>
        <h3>Payment failed</h3>
        <p>If any amount was debited, your bank will auto-reverse it within a few business days.</p>
        <p className="pp-meta">Request a fresh payment link to retry.</p>
      </div>
    );
  }
  if (order.status === 'expired') {
    return (
      <div className="pp-status expired">
        <div className="pp-status-icon">
          <svg viewBox="0 0 52 52" width="52" height="52"><circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeWidth="3"/><path d="M26 14 V27 L34 33" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
        <h3>Link expired</h3>
        <p>Request a fresh payment link from the merchant.</p>
      </div>
    );
  }
  if (order.status === 'cancelled') {
    return (
      <div className="pp-status expired">
        <h3>Cancelled</h3>
        <p>The merchant cancelled this payment request.</p>
      </div>
    );
  }
  return null;
}

export default function PayPage() {
  const { token } = useParams<{ token: string }>();
  const [order, setOrder] = useState<PayOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const startedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const r = await fetchOrder(token);
      if (cancelled) return;
      if (!r.ok || !r.data) setError(r.message || 'Unable to load payment link');
      else setOrder(r.data);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const pollOnce = useCallback(async () => {
    if (!token) return;
    setChecking(true);
    const r = await fetchOrder(token, true);
    if (r.ok && r.data) setOrder(r.data);
    setChecking(false);
  }, [token]);

  useEffect(() => {
    if (!order || order.is_terminal) return;
    if (order.status !== 'pending') return;
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      if (cancelled) return;
      if (!document.hidden) {
        await pollOnce();
      }
      if (cancelled) return;
      const elapsed = Date.now() - startedAtRef.current;
      timer = window.setTimeout(tick, pollIntervalFor(elapsed));
    };
    timer = window.setTimeout(tick, pollIntervalFor(Date.now() - startedAtRef.current));
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [order, pollOnce]);

  if (loading) {
    return (
      <div className="pp-shell">
        <div className="pp-loading">Loading…</div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="pp-shell">
        <div className="pp-card pp-notfound">
          <div className="pp-brand-row">
            <div className="pp-brand-mark">PG</div>
            <div className="pp-brand-name">PayGateway</div>
          </div>
          <h2>Link not found</h2>
          <p>{error || 'This payment link is invalid or removed.'}</p>
          <p className="pp-meta">Request a fresh link from the merchant.</p>
        </div>
      </div>
    );
  }

  const expiresMs = order.expires_at ? new Date(order.expires_at).getTime() - now : 0;
  const showCountdown = order.status === 'pending' && order.expires_at && expiresMs > 0;

  const copyUpi = async () => {
    if (!order.upi_payload) return;
    try { await navigator.clipboard.writeText(order.upi_payload); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  const orderRef = order.client_order_id || order.txn_ref;
  const isPending = order.status === 'pending';

  return (
    <div className="pp-shell">
      <header className="pp-top">
        <div className="pp-brand-row">
          <div className="pp-brand-mark">PG</div>
          <div className="pp-brand-text">
            <div className="pp-brand-name">{order.payee_name}</div>
            <div className="pp-brand-sub">Secure UPI checkout</div>
          </div>
        </div>
        <div className={`pp-pill ${order.status}`}>
          <span className="pp-pill-dot" />
          {order.status === 'pending' ? 'Pending' :
            order.status === 'paid' ? 'Paid' :
            order.status === 'failed' ? 'Failed' :
            order.status === 'expired' ? 'Expired' :
            order.status === 'cancelled' ? 'Cancelled' : order.status}
        </div>
      </header>

      <div className="pp-card pp-summary">
        <div className="pp-amount-row">
          <span>Amount due</span>
          <strong>₹{order.amount.toFixed(2)} <small>{order.currency}</small></strong>
        </div>
        <div className="pp-meta-row">
          <div><b>Order</b><span>{orderRef}</span></div>
          {order.note && <div><b>Note</b><span>{order.note}</span></div>}
          {showCountdown && (
            <div><b>Expires in</b><span className="pp-countdown">{formatTimeLeft(expiresMs)}</span></div>
          )}
        </div>
      </div>

      {isPending && (
        <div className="pp-card pp-qr-card">
          <div className="pp-qr-wrap">
            <img
              className="pp-qr-img"
              src={`/api/pay/${order.public_token}/qr.png?size=520`}
              alt="UPI payment QR"
              width={240}
              height={240}
            />
          </div>
          <ol className="pp-steps">
            <li>Open any UPI app — GPay, PhonePe, Paytm, BHIM.</li>
            <li>Scan the QR or tap the button below on a phone.</li>
            <li>Approve <b>₹{order.amount.toFixed(2)}</b>.</li>
            <li>Status updates here automatically.</li>
          </ol>
          <div className="pp-actions">
            {order.upi_payload && (
              <a href={order.upi_payload} className="pp-btn primary">Pay with UPI app</a>
            )}
            <button className="pp-btn ghost" onClick={copyUpi}>{copied ? 'Copied ✓' : 'Copy link'}</button>
          </div>
          <div className="pp-poll-row">
            <span className={`pp-dot${checking ? ' on' : ''}`} />
            {checking ? 'Checking…' : 'Waiting for payment'}
            <button className="pp-link" onClick={pollOnce} disabled={checking}>Refresh</button>
          </div>
        </div>
      )}

      {order.is_terminal && (
        <div className="pp-card pp-result">
          <StatusVisual order={order} />
          <div className="pp-meta-row">
            <div><b>Order</b><span>{orderRef}</span></div>
            <div><b>Amount</b><span>₹{order.amount.toFixed(2)}</span></div>
            {order.verified_at && <div><b>Confirmed</b><span>{new Date(order.verified_at).toLocaleString()}</span></div>}
          </div>
        </div>
      )}

      <footer className="pp-foot">
        <span>Secured by <strong>PayGateway</strong></span>
        <span>Ref <code>{order.txn_ref}</code></span>
      </footer>
    </div>
  );
}
