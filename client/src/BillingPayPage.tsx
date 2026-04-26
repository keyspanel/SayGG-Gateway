import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiPost } from './api';
import { CopyButton, PaidStatusVisual, PayQrCanvas, SupportedApps } from './PayPage';

interface PlanOrderView {
  id: number;
  txn_ref: string;
  public_token: string;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled' | string;
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

const REDIRECT_COUNTDOWN_SECONDS = 5;

export default function BillingPayPage() {
  const { token } = useParams();
  const nav = useNavigate();
  const [order, setOrder] = useState<PlanOrderView | null>(null);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const stoppedRef = useRef(false);

  const load = async () => {
    try {
      const o = await apiGet(`/api/billing/pay/${token}`);
      setOrder(o);
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
      }
    } catch { /* keep last known state */ }
    finally { if (manual) setRefreshing(false); }
  };

  useEffect(() => { load(); }, [token]);

  // Auto-poll while pending (4s, paused when tab is hidden).
  useEffect(() => {
    if (!order || order.is_terminal) return;
    let id: number | undefined;
    const start = () => {
      stop();
      id = window.setInterval(() => {
        if (stoppedRef.current || document.hidden) return;
        refresh().catch(() => {});
      }, 4000);
    };
    const stop = () => { if (id !== undefined) { window.clearInterval(id); id = undefined; } };
    const onVis = () => { if (!document.hidden) refresh().catch(() => {}); };
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, [order?.is_terminal, order?.id]);

  // Tick clock for the live countdown.
  useEffect(() => {
    if (!order || order.is_terminal) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [order?.is_terminal, order?.id]);

  if (err) {
    return (
      <div className="pp-shell">
        <div className="pp-card pp-notfound">
          <div className="pp-brand-row">
            <div className="pp-brand-mark">PG</div>
            <div className="pp-brand-name">PayGateway</div>
          </div>
          <h2>Link not available</h2>
          <p>{err}</p>
          <p className="pp-meta">Start a new purchase from the billing page.</p>
          <button className="pp-btn primary" onClick={() => nav('/gateway/billing')}>Back to billing</button>
        </div>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="pp-shell pp-shell--boot">
        <div className="pp-loading" role="status" aria-live="polite">
          <div className="pp-loading-spinner" aria-hidden="true" />
          <span>Loading payment…</span>
        </div>
      </div>
    );
  }

  const expiresMs = order.expires_at ? new Date(order.expires_at).getTime() - now : 0;
  const showCountdown = order.status === 'pending' && order.expires_at && expiresMs > 0;
  const isPending = order.status === 'pending';
  const orderRefId = order.txn_ref;

  const liveLabel = refreshing ? 'Checking…' : 'Live · waiting for payment';
  const liveClass = refreshing ? 'on' : 'live';

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
        <div className="pp-meta-row pp-meta-row--list">
          <div className="pp-meta-item">
            <b>Plan</b>
            <div className="pp-meta-val">
              <span>
                {order.plan_name}
                <span className="gw-muted" style={{ marginLeft: 6, fontSize: 12 }}>
                  · {order.plan.duration_days >= 200 ? '1 year' : `${order.plan.duration_days} days`}
                </span>
              </span>
            </div>
          </div>
          <div className="pp-meta-item">
            <b>Order ID</b>
            <div className="pp-meta-val">
              <span className="pp-meta-mono">{orderRefId}</span>
              <CopyButton value={orderRefId} label="Order ID" />
            </div>
          </div>
          {order.bank_rrn && (
            <div className="pp-meta-item">
              <b>Bank RRN</b>
              <div className="pp-meta-val">
                <span className="pp-meta-mono">{order.bank_rrn}</span>
                <CopyButton value={order.bank_rrn} label="Bank RRN" />
              </div>
            </div>
          )}
          {showCountdown && (
            <div className="pp-meta-item">
              <b>Expires in</b>
              <div className="pp-meta-val">
                <span className="pp-countdown">{formatTimeLeft(expiresMs)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {isPending && order.upi_payload && (
        <div className="pp-card pp-qr-card">
          <div className="pp-qr-wrap">
            <PayQrCanvas payload={order.upi_payload} size={240} />
          </div>
          <ol className="pp-steps">
            <li>Open any UPI app — GPay, PhonePe, Paytm, BHIM.</li>
            <li>Scan the QR with your UPI app.</li>
            <li>Approve <b>₹{order.amount.toFixed(2)}</b>.</li>
            <li>Status updates here automatically.</li>
          </ol>
          <SupportedApps />
          <div className="pp-actions">
            {order.upi_payload && (
              <a className="pp-btn primary" href={order.upi_payload}>
                Pay with UPI app
              </a>
            )}
            <button
              type="button"
              className="pp-btn ghost"
              onClick={() => refresh(true)}
              disabled={refreshing}
            >
              {refreshing ? 'Checking…' : 'I have paid · Check status'}
            </button>
          </div>
          <div className="pp-poll-row">
            <span className={`pp-dot ${liveClass}`} />
            {liveLabel}
            <button className="pp-link" onClick={() => refresh(true)} disabled={refreshing}>Refresh</button>
          </div>
        </div>
      )}

      {order.is_terminal && (
        <div className="pp-card pp-result">
          <BillingStatusVisual order={order} />
          {order.status === 'paid' && (
            <BillingRedirectPanel
              variant="paid"
              onDone={() => nav('/gateway/billing/success', { replace: true })}
            />
          )}
          {(order.status === 'failed' || order.status === 'expired' || order.status === 'cancelled') && (
            <BillingRedirectPanel
              variant="cancel"
              onDone={() => nav('/gateway/billing', { replace: true })}
            />
          )}
        </div>
      )}

      <footer className="pp-foot">
        <span>Secured by <strong>PayGateway</strong></span>
      </footer>
    </div>
  );
}

function BillingStatusVisual({ order }: { order: PlanOrderView }) {
  if (order.status === 'paid') {
    return <PaidStatusVisual order={{ amount: order.amount, verified_at: order.paid_at }} />;
  }
  if (order.status === 'failed') {
    return (
      <div className="pp-status failed">
        <div className="pp-status-icon">
          <svg viewBox="0 0 52 52" width="52" height="52">
            <circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeWidth="3"/>
            <line x1="18" y1="18" x2="34" y2="34" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/>
            <line x1="34" y1="18" x2="18" y2="34" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"/>
          </svg>
        </div>
        <h3>Payment failed</h3>
        <p>If any amount was debited, your bank will auto-reverse it within a few business days.</p>
        <p className="pp-meta">Start a new purchase from the billing page.</p>
      </div>
    );
  }
  if (order.status === 'expired') {
    return (
      <div className="pp-status expired">
        <div className="pp-status-icon">
          <svg viewBox="0 0 52 52" width="52" height="52">
            <circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeWidth="3"/>
            <path d="M26 14 V27 L34 33" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h3>Link expired</h3>
        <p>Start a new purchase from the billing page.</p>
      </div>
    );
  }
  if (order.status === 'cancelled') {
    return (
      <div className="pp-status expired">
        <h3>Cancelled</h3>
        <p>This payment request was cancelled.</p>
      </div>
    );
  }
  return null;
}

/**
 * Auto-redirect card shown after a billing order reaches a terminal state.
 *  - variant 'paid'   → returns to /gateway/billing/success (subscription
 *    activation page).
 *  - variant 'cancel' → returns to /gateway/billing so the user can retry.
 *
 * Counts down from REDIRECT_COUNTDOWN_SECONDS, then fires onDone().
 * The user can jump immediately or pause the auto-redirect.
 */
function BillingRedirectPanel({ variant, onDone }: { variant: 'paid' | 'cancel'; onDone: () => void }) {
  const [remaining, setRemaining] = useState(REDIRECT_COUNTDOWN_SECONDS);
  const [cancelled, setCancelled] = useState(false);
  const [going, setGoing] = useState(false);
  const tickRef = useRef<number | undefined>(undefined);
  const goRef = useRef<number | undefined>(undefined);

  const stopTimers = () => {
    if (tickRef.current !== undefined) { window.clearInterval(tickRef.current); tickRef.current = undefined; }
    if (goRef.current !== undefined) { window.clearTimeout(goRef.current); goRef.current = undefined; }
  };

  const performGo = () => {
    stopTimers();
    setGoing(true);
    onDone();
  };

  useEffect(() => {
    if (cancelled) { stopTimers(); return; }
    setRemaining(REDIRECT_COUNTDOWN_SECONDS);
    tickRef.current = window.setInterval(() => {
      setRemaining((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    goRef.current = window.setTimeout(performGo, REDIRECT_COUNTDOWN_SECONDS * 1000);
    return stopTimers;
  }, [cancelled]);

  const variantClass = variant === 'paid' ? 'pp-redirect--paid' : 'pp-redirect--cancel';
  const title = variant === 'paid' ? 'Payment successful' : 'Payment not completed';
  const sub = variant === 'paid' ? 'Activating your plan' : 'Returning to billing';
  const cta = variant === 'paid' ? 'Continue' : 'Try again';

  if (cancelled) {
    return (
      <div className={`pp-redirect pp-redirect--cancelled ${variantClass}`}>
        <div className="pp-redirect-head">
          <div className="pp-redirect-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M9 12h6" />
            </svg>
          </div>
          <div className="pp-redirect-text">
            <div className="pp-redirect-title">Auto-redirect cancelled</div>
            <div className="pp-redirect-sub">Continue when you're ready.</div>
          </div>
        </div>
        <div className="pp-redirect-actions">
          <button type="button" className="pp-btn primary pp-redirect-cta" onClick={performGo}>
            {cta}
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14" /><path d="M13 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  if (going) {
    return (
      <div className={`pp-redirect pp-redirect--going ${variantClass}`} role="status" aria-live="polite">
        <div className="pp-redirect-head">
          <div className="pp-redirect-spin" aria-hidden="true" />
          <div className="pp-redirect-text">
            <div className="pp-redirect-title">Taking you back…</div>
            <div className="pp-redirect-sub">{sub}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`pp-redirect pp-redirect--live ${variantClass}`}
      role="group"
      style={{ ['--pp-redir-total' as string]: `${REDIRECT_COUNTDOWN_SECONDS}s` }}
    >
      <div className="pp-redirect-head">
        <div className="pp-redirect-ring" aria-hidden="true">
          <svg viewBox="0 0 56 56" width="56" height="56">
            <circle className="pp-redirect-ring-track" cx="28" cy="28" r="24" />
            <circle className="pp-redirect-ring-fill"  cx="28" cy="28" r="24" />
          </svg>
          <span className="pp-redirect-ring-num" aria-live="polite">{remaining}</span>
        </div>
        <div className="pp-redirect-text">
          <div className="pp-redirect-title">
            <span className="pp-redirect-check" aria-hidden="true">
              {variant === 'paid' ? (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              )}
            </span>
            {title}
          </div>
          <div className="pp-redirect-sub">{sub} in {remaining}s</div>
        </div>
      </div>
      <div className="pp-redirect-bar" aria-hidden="true">
        <div className="pp-redirect-bar-fill" />
      </div>
      <div className="pp-redirect-actions">
        <button type="button" className="pp-btn primary pp-redirect-cta" onClick={performGo}>
          {cta}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14" /><path d="M13 5l7 7-7 7" />
          </svg>
        </button>
        <button type="button" className="pp-btn ghost pp-redirect-cancel" onClick={() => { stopTimers(); setCancelled(true); }}>
          Stay on this page
        </button>
      </div>
    </div>
  );
}

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
