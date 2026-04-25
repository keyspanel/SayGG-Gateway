import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { UPI_APPS } from './upi-logos';

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
  redirect_url?: string | null;
  cancel_url?: string | null;
}

/** Seconds the success / cancel page waits before redirecting. */
const REDIRECT_COUNTDOWN_SECONDS = 5;

/** Variants of the post-order redirect card. */
type RedirectVariant = 'paid' | 'cancel';

/**
 * Build the final browser redirect target for a finalized order.
 * Preserves any existing query string on the merchant URL and adds the
 * payment result fields. Only public, non-sensitive parameters are appended:
 * never API tokens, merchant secrets, or Paytm keys.
 *
 * The status param mirrors order.status, so success URLs see status=paid
 * and cancel URLs see status=failed | expired | cancelled.
 */
export function buildRedirectUrl(rawUrl: string, order: PayOrder): string {
  const u = new URL(rawUrl);
  u.searchParams.set('status', order.status);
  u.searchParams.set('txn_ref', order.txn_ref);
  if (order.client_order_id) u.searchParams.set('client_order_id', order.client_order_id);
  u.searchParams.set('amount', order.amount.toFixed(2));
  u.searchParams.set('currency', order.currency);
  return u.toString();
}

type LiveState = 'connecting' | 'live' | 'reconnecting' | 'fallback' | 'closed';

/** Fallback polling cadence used only if the live stream is unavailable. */
function fallbackInterval(elapsedMs: number): number {
  if (elapsedMs < 60_000) return 6000;
  if (elapsedMs < 5 * 60_000) return 10_000;
  return 20_000;
}

/** Safety re-check interval when the live stream IS connected (belt + suspenders). */
const SAFETY_POLL_MS = 45_000;

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

/**
 * Auto-rolling supported-apps strip.
 * - One app visible at a time. Visible duration = ~2s, transition = 500ms.
 * - Outgoing logo slides left + blurs out; incoming slides in from the right
 *   starting blurred and sharpens. CSS keyframes drive the motion; React just
 *   flips the index, so there is no per-frame re-render.
 * - Pauses while the tab is hidden; resumes on visibility.
 * - Tiny pill progress dots show position in the loop.
 * - If a brand SVG ever fails to load, the <img> swaps to a clean letter tile
 *   in the brand's accent color so the user never sees a broken image icon.
 */
const ROLL_INTERVAL_MS = 2000;

function AppLogoImg({ app }: { app: typeof UPI_APPS[number] }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="pp-apps-fallback" style={{ background: app.accent }} aria-hidden="true">
        {app.name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={app.logo}
      alt={app.alt}
      width={40}
      height={40}
      loading="eager"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

function SupportedApps() {
  const [idx, setIdx] = useState(0);
  const total = UPI_APPS.length;

  useEffect(() => {
    let id: number | undefined;
    const start = () => {
      stop();
      id = window.setInterval(() => {
        setIdx((i) => (i + 1) % total);
      }, ROLL_INTERVAL_MS);
    };
    const stop = () => {
      if (id !== undefined) { clearInterval(id); id = undefined; }
    };
    const onVis = () => {
      if (document.hidden) stop();
      else start();
    };
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [total]);

  // Preload all logo assets once so transitions never reveal a flash of nothing.
  useEffect(() => {
    UPI_APPS.forEach((a) => {
      const i = new Image();
      i.src = a.logo;
    });
  }, []);

  const app = UPI_APPS[idx];

  return (
    <div className="pp-apps">
      <div className="pp-apps-head">
        <span className="pp-apps-title">Supported UPI apps</span>
        <span className="pp-apps-sub">Scan with any of these</span>
      </div>
      <div className="pp-apps-stage" aria-live="polite" aria-atomic="true">
        {/* key forces a fresh mount → CSS enter animation re-runs each tick */}
        <div className="pp-apps-item" key={idx}>
          <div className="pp-apps-logo">
            <AppLogoImg app={app} />
          </div>
          <div className="pp-apps-name">{app.name}</div>
        </div>
      </div>
      <div className="pp-apps-dots" aria-hidden="true">
        {UPI_APPS.map((_, i) => (
          <span key={i} className={`pp-apps-dot${i === idx ? ' on' : ''}`} />
        ))}
      </div>
    </div>
  );
}

/**
 * Per-variant copy and primary-CTA labels for the post-order redirect card.
 * Centralised here so the "paid" and "cancel" surfaces stay in lock-step
 * and we never accidentally show success copy on a failed order.
 */
const REDIRECT_COPY: Record<RedirectVariant, {
  ariaLabel: string;
  title: string;          // shown next to the countdown ring
  subTo: string;          // "Redirecting to <host> in 5s"
  subToBare: string;      // when host couldn't be derived
  ctaLabel: string;       // primary CTA when countdown is live
  ctaCancelled: string;   // primary CTA after user clicks "Stay on this page"
  goingTitle: string;     // title shown while window.location.assign() is firing
  cancelledTitle: string; // title shown after user pauses the auto-redirect
  cancelledSub: (host: string) => React.ReactNode;
}> = {
  paid: {
    ariaLabel: 'Redirecting to merchant after successful payment',
    title: 'Payment successful',
    subTo: 'Redirecting to',
    subToBare: 'Redirecting to merchant',
    ctaLabel: 'Redirect now',
    ctaCancelled: 'Continue to merchant',
    goingTitle: 'Taking you back…',
    cancelledTitle: 'Auto-redirect cancelled',
    cancelledSub: (host: string) => host
      ? <>You can continue to <b>{host}</b> when you're ready.</>
      : <>You can continue to the merchant when you're ready.</>,
  },
  cancel: {
    ariaLabel: 'Returning to merchant after unsuccessful payment',
    title: 'Payment not completed',
    subTo: 'Returning to',
    subToBare: 'Returning to merchant',
    ctaLabel: 'Try again',
    ctaCancelled: 'Return to merchant',
    goingTitle: 'Taking you back…',
    cancelledTitle: 'Auto-return paused',
    cancelledSub: (host: string) => host
      ? <>You can head back to <b>{host}</b> to retry when you're ready.</>
      : <>You can head back to the merchant to retry when you're ready.</>,
  },
};

/**
 * Auto-redirect card shown when an order reaches a terminal state AND the
 * matching merchant URL is present:
 *   variant === 'paid'   → fires when status === 'paid' and redirect_url is set
 *   variant === 'cancel' → fires when status ∈ {failed,expired,cancelled} and cancel_url is set
 *
 * Counts down from REDIRECT_COUNTDOWN_SECONDS, then navigates the customer
 * to the merchant URL. The customer can jump immediately or pause the
 * auto-redirect with "Stay on this page".
 *
 * The parent component is responsible for the status guard — RedirectPanel
 * itself trusts whatever variant + URL it's handed and just runs the timer.
 */
function RedirectPanel({ order, variant, rawUrl }: { order: PayOrder; variant: RedirectVariant; rawUrl: string }) {
  const [remaining, setRemaining] = useState<number>(REDIRECT_COUNTDOWN_SECONDS);
  const [cancelled, setCancelled] = useState<boolean>(false);
  const [redirected, setRedirected] = useState<boolean>(false);
  const tickRef = useRef<number | undefined>(undefined);
  const goRef = useRef<number | undefined>(undefined);

  const copy = REDIRECT_COPY[variant];

  // Compute the safe target URL once. If buildRedirectUrl throws (e.g. the
  // backend somehow stored a malformed URL), we render an inline fallback
  // message instead of redirecting anywhere.
  const targetUrl = (() => {
    if (!rawUrl) return null;
    try { return buildRedirectUrl(rawUrl, order); }
    catch { return null; }
  })();

  const stopTimers = useCallback(() => {
    if (tickRef.current !== undefined) { window.clearInterval(tickRef.current); tickRef.current = undefined; }
    if (goRef.current !== undefined) { window.clearTimeout(goRef.current); goRef.current = undefined; }
  }, []);

  const performRedirect = useCallback(() => {
    if (!targetUrl) return;
    stopTimers();
    setRedirected(true);
    // Use assign so the merchant page becomes the next history entry; the
    // customer can still use Back if they want to return.
    window.location.assign(targetUrl);
  }, [targetUrl, stopTimers]);

  useEffect(() => {
    if (!targetUrl || cancelled) { stopTimers(); return; }
    setRemaining(REDIRECT_COUNTDOWN_SECONDS);
    tickRef.current = window.setInterval(() => {
      setRemaining((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    goRef.current = window.setTimeout(() => {
      performRedirect();
    }, REDIRECT_COUNTDOWN_SECONDS * 1000);
    return () => stopTimers();
  }, [targetUrl, cancelled, performRedirect, stopTimers]);

  if (!targetUrl) return null;

  // Display-only host for trust signal ("Returning to merchant.com").
  // We never show query params or paths — only the bare hostname.
  let destHost = '';
  try { destHost = new URL(targetUrl).hostname.replace(/^www\./, ''); } catch { destHost = ''; }

  // Variant marker is also used by CSS to flip the palette (green for
  // success, red/warm for cancel) without duplicating any layout rules.
  const variantClass = variant === 'paid' ? 'pp-redirect--paid' : 'pp-redirect--cancel';

  if (cancelled) {
    return (
      <div className={`pp-redirect pp-redirect--cancelled ${variantClass}`} role="group" aria-label={copy.cancelledTitle}>
        <div className="pp-redirect-head">
          <div className="pp-redirect-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M9 12h6" />
            </svg>
          </div>
          <div className="pp-redirect-text">
            <div className="pp-redirect-title">{copy.cancelledTitle}</div>
            <div className="pp-redirect-sub">{copy.cancelledSub(destHost)}</div>
          </div>
        </div>
        <div className="pp-redirect-actions">
          <button type="button" className="pp-btn primary pp-redirect-cta" onClick={performRedirect}>
            {copy.ctaCancelled}
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14" /><path d="M13 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  if (redirected) {
    return (
      <div className={`pp-redirect pp-redirect--going ${variantClass}`} role="status" aria-live="polite">
        <div className="pp-redirect-head">
          <div className="pp-redirect-spin" aria-hidden="true" />
          <div className="pp-redirect-text">
            <div className="pp-redirect-title">{copy.goingTitle}</div>
            <div className="pp-redirect-sub">
              {destHost ? <>Opening <b>{destHost}</b></> : <>Opening merchant page</>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Live countdown view. The animated ring is driven by a single CSS
  // animation whose duration matches REDIRECT_COUNTDOWN_SECONDS so the
  // ring depletes smoothly while the digit ticks once per second.
  return (
    <div
      className={`pp-redirect pp-redirect--live ${variantClass}`}
      role="group"
      aria-label={copy.ariaLabel}
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
            {copy.title}
          </div>
          <div className="pp-redirect-sub">
            {destHost
              ? <>{copy.subTo} <b>{destHost}</b> in {remaining}s</>
              : <>{copy.subToBare} in {remaining}s</>}
          </div>
        </div>
      </div>
      <div className="pp-redirect-bar" aria-hidden="true">
        <div className="pp-redirect-bar-fill" />
      </div>
      <div className="pp-redirect-actions">
        <button type="button" className="pp-btn primary pp-redirect-cta" onClick={performRedirect}>
          {copy.ctaLabel}
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
  const [downloading, setDownloading] = useState(false);
  const [live, setLive] = useState<LiveState>('connecting');

  const startedAtRef = useRef<number>(Date.now());
  const orderRef = useRef<PayOrder | null>(null);
  orderRef.current = order;

  // Long-press handling for the on-page QR. We treat both a quick tap and a
  // sustained long-press the same way: trigger the rich PNG download. The
  // native browser image menu (Open / Copy / Download / Share) is suppressed
  // so the customer never sees the raw QR endpoint URL.
  const lpTimerRef = useRef<number | undefined>(undefined);
  const lpFiredRef = useRef<boolean>(false);
  const lpStartXY = useRef<{ x: number; y: number } | null>(null);
  const LP_MS = 450;        // how long the press must be held to count as long-press
  const LP_MOVE_PX = 10;    // cancel long-press if the finger drifts more than this

  // Apply a snapshot, but never let a stale "pending" overwrite a confirmed terminal state.
  const applySnapshot = useCallback((next: PayOrder) => {
    setOrder((prev) => {
      if (prev?.is_terminal && !next.is_terminal) return prev;
      if (prev && prev.status === next.status && prev.verified_at === next.verified_at) return prev;
      return next;
    });
  }, []);

  // Initial load.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const r = await fetchOrder(token);
      if (cancelled) return;
      if (!r.ok || !r.data) setError(r.message || 'Unable to load payment link');
      else applySnapshot(r.data);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token, applySnapshot]);

  // 1Hz tick for the countdown only.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Manual / fallback re-verify against the gateway.
  const refreshOnce = useCallback(async () => {
    if (!token) return;
    setChecking(true);
    const r = await fetchOrder(token, true);
    if (r.ok && r.data) applySnapshot(r.data);
    setChecking(false);
  }, [token, applySnapshot]);

  /**
   * Realtime: subscribe to the per-order SSE stream.
   * - On message → instant state update.
   * - On error → mark "reconnecting"; EventSource auto-retries.
   * - If retries keep failing, a parallel fallback poller keeps things moving.
   * - Closes itself once the order is terminal.
   */
  useEffect(() => {
    if (!token) return;
    if (orderRef.current?.is_terminal) { setLive('closed'); return; }

    let es: EventSource | null = null;
    let closed = false;
    let errorCount = 0;
    let fallbackTimer: number | undefined;
    let safetyTimer: number | undefined;

    const stopFallback = () => {
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = undefined; }
    };
    const stopSafety = () => {
      if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = undefined; }
    };

    const startFallback = () => {
      stopFallback();
      const tick = async () => {
        if (closed) return;
        if (orderRef.current?.is_terminal) return;
        if (!document.hidden) await refreshOnce();
        if (closed || orderRef.current?.is_terminal) return;
        const elapsed = Date.now() - startedAtRef.current;
        fallbackTimer = window.setTimeout(tick, fallbackInterval(elapsed));
      };
      fallbackTimer = window.setTimeout(tick, fallbackInterval(Date.now() - startedAtRef.current));
    };

    const startSafety = () => {
      stopSafety();
      const tick = async () => {
        if (closed) return;
        if (orderRef.current?.is_terminal) return;
        if (!document.hidden) await refreshOnce();
        if (closed || orderRef.current?.is_terminal) return;
        safetyTimer = window.setTimeout(tick, SAFETY_POLL_MS);
      };
      safetyTimer = window.setTimeout(tick, SAFETY_POLL_MS);
    };

    const handleSnapshot = (raw: string) => {
      try {
        const data = JSON.parse(raw) as PayOrder;
        applySnapshot(data);
        if (data.is_terminal) {
          stopFallback();
          stopSafety();
          setLive('closed');
        }
      } catch { /* ignore malformed frames */ }
    };

    try {
      setLive('connecting');
      es = new EventSource(`/api/pay/${token}/stream`);

      es.addEventListener('snapshot', (ev: MessageEvent) => {
        errorCount = 0;
        setLive('live');
        stopFallback();
        startSafety();
        handleSnapshot(ev.data);
      });
      es.addEventListener('update', (ev: MessageEvent) => {
        errorCount = 0;
        setLive('live');
        handleSnapshot(ev.data);
      });
      es.addEventListener('end', () => {
        try { es?.close(); } catch { /* noop */ }
        stopFallback();
        stopSafety();
        setLive('closed');
      });
      es.onerror = () => {
        errorCount += 1;
        // Browser will auto-reconnect on its own. After repeated failures,
        // engage the fallback poller so the user still gets updates.
        if (es && es.readyState === EventSource.CLOSED) {
          if (errorCount >= 3) {
            setLive('fallback');
            startFallback();
          } else {
            setLive('reconnecting');
          }
        } else {
          setLive('reconnecting');
          if (errorCount >= 3 && !fallbackTimer) startFallback();
        }
      };
    } catch {
      setLive('fallback');
      startFallback();
    }

    return () => {
      closed = true;
      stopFallback();
      stopSafety();
      try { es?.close(); } catch { /* noop */ }
    };
  }, [token, refreshOnce, applySnapshot]);

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

  /**
   * Render a professional QR card to a canvas and trigger a PNG download.
   * The card embeds the same QR served at /api/pay/:token/qr.png plus
   * order details (merchant, amount, order id, note, expiry, reference).
   * Pure client-side: no extra server route, no extra dependency.
   */
  const downloadQr = async () => {
    if (!order || downloading) return;
    setDownloading(true);
    try {
      // Pull a high-resolution QR for crisp printing.
      const qrRes = await fetch(`/api/pay/${order.public_token}/qr.png?size=720`);
      const qrBlob = await qrRes.blob();
      const qrUrl = URL.createObjectURL(qrBlob);
      const qrImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = qrUrl;
      });

      // Card geometry — designed for a clean, share-friendly portrait card.
      const W = 1080;
      const H = 1620;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;

      // Background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);

      // Soft accent header band
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, W, 180);

      // Brand mark
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 36px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('PG', 64, 90);
      ctx.font = '500 28px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#cfd2dc';
      ctx.fillText('PayGateway · Secure UPI', 130, 90);

      // Merchant
      ctx.fillStyle = '#0a0a0f';
      ctx.textBaseline = 'top';
      ctx.font = '700 56px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(order.payee_name || 'Merchant', 64, 230);

      ctx.fillStyle = '#5b6172';
      ctx.font = '500 30px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('Scan to pay with any UPI app', 64, 308);

      // Amount block
      ctx.fillStyle = '#0a0a0f';
      ctx.font = '800 92px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(`₹${order.amount.toFixed(2)}`, 64, 372);
      ctx.fillStyle = '#5b6172';
      ctx.font = '500 28px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(order.currency || 'INR', 64, 482);

      // QR with thin border
      const qrSize = 720;
      const qrX = (W - qrSize) / 2;
      const qrY = 560;
      ctx.fillStyle = '#eef0f5';
      ctx.fillRect(qrX - 16, qrY - 16, qrSize + 32, qrSize + 32);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(qrX, qrY, qrSize, qrSize);
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

      // Detail block
      const detailY = qrY + qrSize + 60;
      ctx.fillStyle = '#0a0a0f';
      ctx.font = '600 30px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      const orderRefLabel = order.client_order_id || order.txn_ref;
      const lines: Array<[string, string]> = [
        ['Order', orderRefLabel],
      ];
      if (order.note) lines.push(['Note', order.note]);
      if (order.expires_at) {
        const exp = new Date(order.expires_at);
        lines.push(['Expires', exp.toLocaleString()]);
      }
      lines.push(['Reference', order.txn_ref]);

      let ly = detailY;
      for (const [label, value] of lines) {
        ctx.fillStyle = '#8b91a3';
        ctx.font = '500 26px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(label, 64, ly);
        ctx.fillStyle = '#0a0a0f';
        ctx.font = '600 30px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        // Truncate very long values to keep the card clean.
        const maxChars = 38;
        const v = value.length > maxChars ? value.slice(0, maxChars - 1) + '…' : value;
        ctx.fillText(v, 240, ly - 2);
        ly += 56;
      }

      // Footer
      ctx.fillStyle = '#eef0f5';
      ctx.fillRect(0, H - 80, W, 80);
      ctx.fillStyle = '#5b6172';
      ctx.font = '500 24px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('Secured by PayGateway', 64, H - 40);
      ctx.textAlign = 'right';
      ctx.fillText(order.txn_ref, W - 64, H - 40);
      ctx.textAlign = 'left';

      const pngBlob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
      });
      const url = URL.createObjectURL(pngBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payment-qr-${orderRefLabel}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        URL.revokeObjectURL(qrUrl);
      }, 1000);
    } catch (e) {
      // Surface a soft alert; the QR is still visible on-page.
      alert('Could not prepare QR download. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const orderRefId = order.client_order_id || order.txn_ref;
  const isPending = order.status === 'pending';

  // Cancel any pending long-press timer + reset gesture state.
  const cancelLongPress = () => {
    if (lpTimerRef.current !== undefined) {
      window.clearTimeout(lpTimerRef.current);
      lpTimerRef.current = undefined;
    }
    lpStartXY.current = null;
  };

  const handleQrPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only react to primary pointer (left click / first finger / pen tip).
    if (e.button !== undefined && e.button !== 0) return;
    cancelLongPress();
    lpFiredRef.current = false;
    lpStartXY.current = { x: e.clientX, y: e.clientY };
    lpTimerRef.current = window.setTimeout(() => {
      lpFiredRef.current = true;
      lpTimerRef.current = undefined;
      // Fire the same rich download flow as the button.
      void downloadQr();
    }, LP_MS);
  };

  const handleQrPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = lpStartXY.current;
    if (!start) return;
    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);
    if (dx > LP_MOVE_PX || dy > LP_MOVE_PX) cancelLongPress();
  };

  const handleQrPointerEnd = () => cancelLongPress();

  const handleQrClick = () => {
    // If the long-press already fired, swallow the synthesized click so we
    // don't trigger the download a second time.
    if (lpFiredRef.current) {
      lpFiredRef.current = false;
      return;
    }
    void downloadQr();
  };

  const handleQrKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void downloadQr();
    }
  };

  let liveLabel: string;
  let liveClass: string;
  if (checking) { liveLabel = 'Checking…'; liveClass = 'on'; }
  else if (live === 'live') { liveLabel = 'Live · waiting for payment'; liveClass = 'live'; }
  else if (live === 'connecting') { liveLabel = 'Connecting…'; liveClass = 'on'; }
  else if (live === 'reconnecting') { liveLabel = 'Reconnecting…'; liveClass = 'warn'; }
  else if (live === 'fallback') { liveLabel = 'Backup mode · checking periodically'; liveClass = 'warn'; }
  else { liveLabel = 'Waiting for payment'; liveClass = ''; }

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
          <div><b>Order</b><span>{orderRefId}</span></div>
          {order.note && <div><b>Note</b><span>{order.note}</span></div>}
          {showCountdown && (
            <div><b>Expires in</b><span className="pp-countdown">{formatTimeLeft(expiresMs)}</span></div>
          )}
        </div>
      </div>

      {isPending && (
        <div className="pp-card pp-qr-card">
          <div
            className={`pp-qr-wrap${downloading ? ' is-busy' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={downloading ? 'Preparing QR download' : 'Tap or long-press to download payment QR'}
            aria-busy={downloading || undefined}
            title="Tap or long-press to download"
            onClick={handleQrClick}
            onKeyDown={handleQrKeyDown}
            onPointerDown={handleQrPointerDown}
            onPointerMove={handleQrPointerMove}
            onPointerUp={handleQrPointerEnd}
            onPointerCancel={handleQrPointerEnd}
            onPointerLeave={handleQrPointerEnd}
            onContextMenu={(e) => e.preventDefault()}
          >
            <img
              className="pp-qr-img"
              src={`/api/pay/${order.public_token}/qr.png?size=520`}
              alt="UPI payment QR"
              width={240}
              height={240}
              draggable={false}
              onContextMenu={(e) => e.preventDefault()}
              onDragStart={(e) => e.preventDefault()}
            />
            <span className="pp-qr-badge" aria-hidden="true">
              {downloading ? (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-9-9" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 4v12" />
                  <path d="M6 12l6 6 6-6" />
                  <path d="M5 20h14" />
                </svg>
              )}
            </span>
          </div>
          <ol className="pp-steps">
            <li>Open any UPI app — GPay, PhonePe, Paytm, BHIM.</li>
            <li>Scan the QR with your UPI app, or download it to share.</li>
            <li>Approve <b>₹{order.amount.toFixed(2)}</b>.</li>
            <li>Status updates here automatically.</li>
          </ol>
          <SupportedApps />
          <div className="pp-actions">
            <button
              type="button"
              className="pp-btn primary"
              onClick={downloadQr}
              disabled={downloading}
            >
              {downloading ? 'Preparing…' : 'Download QR Code'}
            </button>
          </div>
          <div className="pp-poll-row">
            <span className={`pp-dot ${liveClass}`} />
            {liveLabel}
            <button className="pp-link" onClick={refreshOnce} disabled={checking}>Refresh</button>
          </div>
        </div>
      )}

      {order.is_terminal && (
        <div className="pp-card pp-result">
          <StatusVisual order={order} />
          <div className="pp-meta-row">
            <div><b>Order</b><span>{orderRefId}</span></div>
            <div><b>Amount</b><span>₹{order.amount.toFixed(2)}</span></div>
            {order.verified_at && <div><b>Confirmed</b><span>{new Date(order.verified_at).toLocaleString()}</span></div>}
          </div>
          {/* Auto-redirect after the backend confirms the order is terminal
              and the matching merchant URL was set on create-order:
                - paid              → redirect_url
                - failed/expired/cancelled → cancel_url
              RedirectPanel unmounts and clears its timers if the order ever
              changes status, so we never redirect to the wrong destination. */}
          {order.status === 'paid' && order.redirect_url && (
            <RedirectPanel order={order} variant="paid" rawUrl={order.redirect_url} />
          )}
          {(order.status === 'failed' || order.status === 'expired' || order.status === 'cancelled') && order.cancel_url && (
            <RedirectPanel order={order} variant="cancel" rawUrl={order.cancel_url} />
          )}
        </div>
      )}

      <footer className="pp-foot">
        <span>Secured by <strong>PayGateway</strong></span>
        <span>Ref <code>{order.txn_ref}</code></span>
      </footer>
    </div>
  );
}
