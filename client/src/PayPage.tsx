import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { UPI_APPS } from './upi-logos';

/**
 * usePayPageAntiCopyProtection
 *
 * Mounts capture-phase listeners on `document` that block the casual ways a
 * customer can copy / save / drag / context-menu content on the hosted pay
 * page. This is NOT DRM and cannot prevent screenshots, DevTools inspection,
 * or network inspection — it just removes the obvious browser-provided
 * "Open image / Copy image / Download image / Share image" affordances on
 * UPI logos and the QR.
 *
 * Listeners are registered in the capture phase so they fire before any
 * inner element handlers, and they are torn down on unmount so the rest of
 * the app (dashboard, settings, etc.) is unaffected.
 */
function usePayPageAntiCopyProtection(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const block = (e: Event) => {
      e.preventDefault();
      return false;
    };

    const blockAux = (e: MouseEvent) => {
      // Suppress middle-click / right-aux-click which some browsers map to
      // "open image in new tab" or save shortcuts.
      if (e.button !== 0) e.preventDefault();
    };

    // Long-press on touch: we let real interactive controls keep working
    // (buttons, links, inputs) but cancel the default for media targets so
    // browsers like Chrome / Samsung Internet do not raise the image popup.
    const blockTouchLongPress = (e: TouchEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('button, a, input, textarea, select, [role="button"], [data-allow-touch="1"]')) return;
      if (t.closest('img, canvas, svg, .pp-touch-shield, .pp-protected-media, .pp-apps-bg')) {
        // Only prevent if the event is cancelable; passive listeners can't.
        if (e.cancelable) e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', block, true);
    document.addEventListener('copy', block, true);
    document.addEventListener('cut', block, true);
    document.addEventListener('paste', block, true);
    document.addEventListener('dragstart', block, true);
    document.addEventListener('selectstart', block, true);
    document.addEventListener('auxclick', blockAux, true);
    document.addEventListener('touchstart', blockTouchLongPress, { capture: true, passive: false });

    return () => {
      document.removeEventListener('contextmenu', block, true);
      document.removeEventListener('copy', block, true);
      document.removeEventListener('cut', block, true);
      document.removeEventListener('paste', block, true);
      document.removeEventListener('dragstart', block, true);
      document.removeEventListener('selectstart', block, true);
      document.removeEventListener('auxclick', blockAux, true);
      document.removeEventListener('touchstart', blockTouchLongPress, true);
    };
  }, [enabled]);
}

/**
 * ProtectedMedia
 *
 * Decorative image rendered as a CSS background-image div instead of a
 * regular `<img>`. This prevents the native browser long-press menu
 * ("Open image / Copy image / Download image / Share image") that mobile
 * browsers raise on `<img>` elements, while still letting us render brand
 * SVGs at any size with sharp scaling.
 */
function ProtectedMedia({
  src,
  label,
  className,
  style,
}: {
  src: string;
  label: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={['pp-protected-media', className].filter(Boolean).join(' ')}
      role="img"
      aria-label={label}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      style={{
        backgroundImage: `url("${src}")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        backgroundSize: 'contain',
        ...style,
      }}
    />
  );
}

/**
 * PayQrCanvas
 *
 * Renders the UPI QR onto a `<canvas>` element from the upi:// payload
 * client-side. A `<canvas>` is not an image, so mobile browsers do not
 * offer "Save image" / "Open image in new tab" on long-press, and there is
 * no public image URL the customer can copy out of the DOM. A transparent
 * touch shield sits on top so any pointer gesture is captured by an inert
 * div instead of bubbling to a media element.
 *
 * The QR remains fully visible and scannable by any UPI app.
 */
function PayQrCanvas({ payload, size }: { payload: string; size: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!ref.current || !payload) return;
    QRCode.toCanvas(ref.current, payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: size,
      color: { dark: '#0a0a0f', light: '#ffffff' },
    }).then(() => { if (!cancelled) setError(false); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [payload, size]);

  return (
    <div className="pp-qr-protected" style={{ width: size, height: size }}>
      <canvas
        ref={ref}
        className="pp-qr-canvas"
        width={size}
        height={size}
        role="img"
        aria-label="UPI payment QR code"
      />
      <div
        className="pp-touch-shield"
        aria-hidden="true"
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      />
      {error && (
        <div className="pp-qr-fallback" role="status">QR unavailable</div>
      )}
    </div>
  );
}

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
  // Probe the asset via a detached Image() so we can show the brand-color
  // letter fallback if the SVG fails — without ever rendering an actual
  // <img> element in the DOM (which would re-enable the long-press image
  // popup we are trying to suppress).
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const probe = new window.Image();
    probe.onload = () => { if (!cancelled) setFailed(false); };
    probe.onerror = () => { if (!cancelled) setFailed(true); };
    probe.src = app.logo;
    return () => { cancelled = true; };
  }, [app.logo]);

  if (failed) {
    return (
      <div className="pp-apps-fallback" style={{ background: app.accent }} role="img" aria-label={app.alt}>
        {app.name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <ProtectedMedia
      src={app.logo}
      label={app.alt}
      className="pp-apps-bg"
      style={{ width: 40, height: 40 }}
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

/**
 * CopyButton
 *
 * Small inline icon button that copies its `value` to the user's clipboard.
 * Designed to sit next to short identifiers like Order ID, Note, and Ref on
 * the hosted pay page.
 *
 * Mobile-friendly notes:
 *  - Tap target is min 28×28 with no hover dependency.
 *  - `data-allow-touch="1"` opts the button out of the page-wide
 *    long-press / context-menu blockers in usePayPageAntiCopyProtection,
 *    so a tap reliably triggers onClick instead of being preventDefault'd.
 *  - The copy itself uses navigator.clipboard.writeText (which does NOT
 *    fire a 'copy' event, so the global capture-phase 'copy' blocker does
 *    not interfere). A textarea+execCommand fallback handles older WebViews.
 *  - Briefly swaps to a checkmark + "Copied" tooltip so the user gets
 *    feedback even without a separate toast.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
  }, []);

  const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!value) return;
    let ok = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, value.length);
        document.execCommand('copy');
        document.body.removeChild(ta);
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1400);
    }
  };

  return (
    <button
      type="button"
      className={`pp-copy-btn${copied ? ' is-copied' : ''}`}
      onClick={handleCopy}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? 'Copied' : `Copy ${label}`}
      data-allow-touch="1"
    >
      {copied ? (
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V6a2 2 0 0 1 2-2h9" />
        </svg>
      )}
      <span className="pp-copy-btn-sr">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

/**
 * CountUpAmount
 *
 * Animates a numeric value from 0 → `value` over `duration` ms using
 * requestAnimationFrame and an ease-out-cubic curve. Shown to two decimals
 * to match the payment amount format. Stops cleanly on unmount and won't
 * mis-render if the prop changes mid-flight (it just retargets to the
 * latest value).
 */
function CountUpAmount({ value, duration = 950 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const to = Math.max(0, value || 0);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{display.toFixed(2)}</>;
}

/**
 * PaidStatusVisual
 *
 * Premium "Payment received" celebration. Built as layered, GPU-friendly
 * CSS animations so it works reliably across modern mobile browsers
 * without JS animation libraries:
 *
 *  1. Aurora — large radial-gradient orb with filter:blur scales in then
 *     breathes gently behind everything.
 *  2. Ripple rings — three concentric circles expand outward on a loop,
 *     staggered for a sonar / tap-feedback effect.
 *  3. Disc — gradient success disc pops in with an overshoot bezier,
 *     starting blurred and snapping into focus.
 *  4. Checkmark — SVG ring stroke draws around the disc, then the tick
 *     itself draws on top using stroke-dashoffset animations.
 *  5. Sparks — eight tiny dots fly outward radially with blur trails.
 *  6. Text reveal — title, amount and RRN fade in one after another with
 *     a blur-defocus + slide-up motion ("frosted glass" reveal).
 *  7. Amount — value counts up from 0 to the final amount with easing.
 *
 * `prefers-reduced-motion` short-circuits the looping/breathing parts but
 * still shows the final state, so accessibility users still get a clear
 * confirmation without movement.
 */
function PaidStatusVisual({ order }: { order: PayOrder }) {
  // Confetti burst — 14 pieces with 3 shapes & a refined palette so the
  // celebration reads as premium, not loud. Each piece has its own angle,
  // distance, rotation, delay and duration so the burst feels organic
  // instead of mechanically symmetrical.
  const palette = [
    '#10b981', '#34d399', '#6ee7b7',
    '#fbbf24', '#60a5fa', '#f472b6', '#a78bfa',
  ];
  const confettiCount = 14;
  const confettiPieces = Array.from({ length: confettiCount }).map((_, i) => {
    const baseAngle = (360 / confettiCount) * i;
    // Tilt every other piece slightly so the burst doesn't feel too even.
    const angle = baseAngle + (i % 2 === 0 ? 8 : -6);
    return {
      angle,
      color: palette[i % palette.length],
      distance: 95 + (i % 5) * 22,            // 95 – 183 px
      delay: 60 + (i % 7) * 30,               // 60 – 240 ms
      rotation: (i % 2 === 0 ? 1 : -1) * (220 + ((i * 47) % 260)),
      duration: 1100 + (i % 4) * 140,         // 1100 – 1520 ms
      size: 6 + (i % 3) * 2,                  //  6 / 8 / 10 px
      shape: i % 3,                           // 0 sq · 1 rounded · 2 dot
    };
  });

  return (
    <div className="pp-paid" role="status" aria-live="polite" aria-label="Payment received">
      <div className="pp-paid-stage" aria-hidden="true">
        <span className="pp-paid-aurora" />
        <span className="pp-paid-aurora pp-paid-aurora--alt" />
        <span className="pp-paid-glow-ring" />
        <span className="pp-paid-ring pp-paid-ring--1" />
        <span className="pp-paid-ring pp-paid-ring--2" />
        <span className="pp-paid-ring pp-paid-ring--3" />
        <span className="pp-paid-disc">
          <span className="pp-paid-disc-shine" />
          <svg className="pp-paid-check" viewBox="0 0 60 60" width="56" height="56">
            <circle className="pp-paid-check-ring" cx="30" cy="30" r="25.5" />
            <path className="pp-paid-check-tick" d="M17 31 L26.5 41 L44 22" />
          </svg>
        </span>
        {confettiPieces.map((c, i) => (
          <span
            key={i}
            className={`pp-paid-confetti pp-paid-confetti--s${c.shape}`}
            style={{
              ['--a' as string]: `${c.angle}deg`,
              ['--dist' as string]: `${c.distance}px`,
              ['--rot' as string]: `${c.rotation}deg`,
              ['--dur' as string]: `${c.duration}ms`,
              ['--delay' as string]: `${c.delay}ms`,
              ['--size' as string]: `${c.size}px`,
              background: c.color,
            }}
          />
        ))}
      </div>
      <h3 className="pp-paid-title">Payment received</h3>
      <p className="pp-paid-amount">
        <span className="pp-paid-amount-cur">₹</span>
        <span className="pp-paid-amount-val"><CountUpAmount value={order.amount} /></span>
        <span className="pp-paid-amount-tag">confirmed</span>
      </p>
      {order.verified_at && (
        <p className="pp-paid-meta">
          Confirmed at {new Date(order.verified_at).toLocaleString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            day: '2-digit',
            month: 'short',
          })}
        </p>
      )}
    </div>
  );
}

function StatusVisual({ order }: { order: PayOrder }) {
  if (order.status === 'paid') {
    return <PaidStatusVisual order={order} />;
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
  const [sharing, setSharing] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [live, setLive] = useState<LiveState>('connecting');

  const startedAtRef = useRef<number>(Date.now());
  const orderRef = useRef<PayOrder | null>(null);
  orderRef.current = order;

  // Hosted-page anti-copy / anti-long-press protection. Mounts capture-phase
  // listeners while the pay page is on screen, removes them on unmount.
  usePayPageAntiCopyProtection(true);

  // Long-press handling for the on-page QR. Both a quick tap and a sustained
  // long-press trigger the rich download (same flow as the "Download QR
  // Code" button). The QR wrapper is marked role="button" so the global
  // anti-long-press hook whitelists it and lets these gestures through.
  const lpTimerRef = useRef<number | undefined>(undefined);
  const lpFiredRef = useRef<boolean>(false);
  const lpStartXY = useRef<{ x: number; y: number } | null>(null);
  const LP_MS = 450;
  const LP_MOVE_PX = 10;

  // ── Performance cache for the branded QR card ──────────────────────────
  // The QR PNG is fetched and decoded as soon as the order is loaded so the
  // Download / Share buttons don't wait on a server round-trip. The fully
  // rendered JPEG card is also cached after the first build and reused —
  // both buttons hit the cache after the first interaction.
  const qrImgRef = useRef<HTMLImageElement | null>(null);
  const qrFetchPromiseRef = useRef<Promise<HTMLImageElement> | null>(null);
  const cardBlobRef = useRef<{ blob: Blob; orderRefLabel: string; tokenKey: string } | null>(null);

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

  /**
   * Pre-fetch the QR PNG and decode it the moment the order's public_token
   * is known, so that when the user taps Download / Share the canvas can be
   * drawn synchronously with no network or decode latency. Cached card blob
   * is also reset whenever the order's public_token changes.
   *
   * NOTE: This hook MUST be declared above the early-return branches below
   * (loading / error). Hooks must run in the same order on every render —
   * placing it after the returns would change the hook count once `loading`
   * flips false and React would crash or briefly blank the page.
   */
  useEffect(() => {
    const tk = order?.public_token;
    if (!tk) return;
    cardBlobRef.current = null; // new order ⇒ stale card
    qrImgRef.current = null;
    qrFetchPromiseRef.current = (async () => {
      const res = await fetch(`/api/pay/${tk}/qr.png?size=2048`);
      if (!res.ok) throw new Error(`QR fetch HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('QR decode failed'));
        i.src = objUrl;
      });
      qrImgRef.current = img;
      // Keep the object URL alive — image relies on it for decoding.
      return img;
    })().catch((e) => {
      console.warn('[pay] QR prefetch failed', e);
      throw e;
    });
  }, [order?.public_token]);

  if (loading) {
    return (
      <div className="pp-shell pp-shell--boot">
        <div className="pp-loading" role="status" aria-live="polite">
          <div className="pp-loading-spinner" aria-hidden="true" />
          <span>Loading payment…</span>
        </div>
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
   * Render the branded QR receipt card to a canvas and return it as a JPEG
   * Blob. Used by both Download and Share.
   *
   * Performance: the QR image is taken from the prefetch cache (no network
   * wait), and the fully built card blob is cached on the first call so
   * repeat clicks (e.g. Download then Share) are instant.
   *
   * Quality: drawn in a 1080×1620 logical coordinate space and scaled 3×
   * onto a 3240×4860 backing store — still well above 4K UHD (3840×2160) —
   * with high-quality image smoothing and bold font weights so all text and
   * the embedded QR are razor-sharp. Output is JPEG at quality 0.94, which
   * looks visually identical to PNG for a card like this but is roughly
   * one-quarter the file size. The QR remains scannable thanks to error
   * correction H + a 4-module quiet zone.
   */
  const buildQrCardBlob = async (): Promise<{ blob: Blob; orderRefLabel: string }> => {
    if (!order) throw new Error('order missing');

    // Reuse a previously-rendered card for this same order ⇒ instant.
    const cached = cardBlobRef.current;
    if (cached && cached.tokenKey === order.public_token) {
      return { blob: cached.blob, orderRefLabel: cached.orderRefLabel };
    }

    // Use the prefetched, decoded QR image when available; otherwise wait
    // for the in-flight prefetch to finish. Only fall back to a fresh
    // fetch if no prefetch has been kicked off (defensive).
    let qrImg = qrImgRef.current;
    if (!qrImg) {
      if (qrFetchPromiseRef.current) {
        qrImg = await qrFetchPromiseRef.current;
      } else {
        const res = await fetch(`/api/pay/${order.public_token}/qr.png?size=2048`);
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        qrImg = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = objUrl;
        });
        qrImgRef.current = qrImg;
      }
    }

    const W = 1080;
    const H = 1620;
    const SCALE = 3; // → 3240 × 4860 (above 4K UHD)
    const canvas = document.createElement('canvas');
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(SCALE, SCALE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Better text rendering hints when supported.
    (ctx as any).textRendering = 'geometricPrecision';

      const FONT_STACK = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

      // Background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);

      // Header band
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, W, 180);

      // Brand mark
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 40px ${FONT_STACK}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('PG', 64, 90);
      ctx.font = `600 28px ${FONT_STACK}`;
      ctx.fillStyle = '#cfd2dc';
      ctx.fillText('PayGateway · Secure UPI', 134, 90);

      // Merchant name
      ctx.fillStyle = '#0a0a0f';
      ctx.textBaseline = 'top';
      ctx.font = `800 60px ${FONT_STACK}`;
      ctx.fillText(order.payee_name || 'Merchant', 64, 226);

      // Subtitle
      ctx.fillStyle = '#5b6172';
      ctx.font = `600 30px ${FONT_STACK}`;
      ctx.fillText('Scan to pay with any UPI app', 64, 310);

      // Amount
      ctx.fillStyle = '#0a0a0f';
      ctx.font = `900 96px ${FONT_STACK}`;
      ctx.fillText(`₹${order.amount.toFixed(2)}`, 64, 370);
      ctx.fillStyle = '#5b6172';
      ctx.font = `600 28px ${FONT_STACK}`;
      ctx.fillText(order.currency || 'INR', 64, 484);

      // QR plate
      const qrSize = 720;
      const qrX = (W - qrSize) / 2;
      const qrY = 560;
      ctx.fillStyle = '#eef0f5';
      ctx.fillRect(qrX - 18, qrY - 18, qrSize + 36, qrSize + 36);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(qrX, qrY, qrSize, qrSize);
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

      // Detail rows
      const detailY = qrY + qrSize + 60;
      const orderRefLabel = order.client_order_id || order.txn_ref;
      const lines: Array<[string, string]> = [['Order', orderRefLabel]];
      if (order.note) lines.push(['Note', order.note]);
      if (order.expires_at) {
        const exp = new Date(order.expires_at);
        lines.push(['Expires', exp.toLocaleString()]);
      }
      lines.push(['Reference', order.txn_ref]);

      let ly = detailY;
      for (const [label, value] of lines) {
        ctx.fillStyle = '#8b91a3';
        ctx.font = `600 26px ${FONT_STACK}`;
        ctx.fillText(label, 64, ly);
        ctx.fillStyle = '#0a0a0f';
        ctx.font = `700 30px ${FONT_STACK}`;
        const maxChars = 38;
        const v = value.length > maxChars ? value.slice(0, maxChars - 1) + '…' : value;
        ctx.fillText(v, 240, ly - 2);
        ly += 58;
      }

      // Footer band
      ctx.fillStyle = '#eef0f5';
      ctx.fillRect(0, H - 80, W, 80);
      ctx.fillStyle = '#5b6172';
      ctx.font = `600 24px ${FONT_STACK}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('Secured by PayGateway', 64, H - 40);
      ctx.textAlign = 'right';
      ctx.fillText(order.txn_ref, W - 64, H - 40);
      ctx.textAlign = 'left';

    const orderRefLabelOut = order.client_order_id || order.txn_ref;
    const jpegBlob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        0.94,
      );
    });

    cardBlobRef.current = {
      blob: jpegBlob,
      orderRefLabel: orderRefLabelOut,
      tokenKey: order.public_token,
    };
    return { blob: jpegBlob, orderRefLabel: orderRefLabelOut };
  };

  /**
   * Download the branded QR receipt card as a 4K PNG. The card includes
   * the merchant name, amount, scan instruction, embedded QR, and order
   * details (order ID, note, expiry, reference) — everything the customer
   * needs to recognise and pay.
   */
  const downloadQr = async () => {
    if (!order || downloading) return;
    setDownloading(true);
    try {
      const { blob, orderRefLabel } = await buildQrCardBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `PayGateway-QR-${orderRefLabel}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      alert('Could not prepare QR download. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  /**
   * Share the branded QR via the device's native share sheet (WhatsApp,
   * Telegram, Mail, etc.) using Web Share Level 2 with files. Falls back
   * to URL share, then to copying the payment page URL.
   */
  const shareQr = async () => {
    if (!order || sharing) return;
    setSharing(true);
    setShareMsg(null);
    const payUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/pay/${order.public_token}`
      : '';
    const shareTitle = `Payment to ${order.payee_name || 'Merchant'}`;
    const shareText = `Pay ₹${order.amount.toFixed(2)} to ${order.payee_name || 'Merchant'} via UPI.${payUrl ? `\n${payUrl}` : ''}`;

    try {
      const nav: any = navigator;

      // 1) Native share with image file (WhatsApp, Telegram, Mail, ...)
      if (typeof nav.share === 'function') {
        try {
          const { blob, orderRefLabel } = await buildQrCardBlob();
          const file = new File([blob], `PayGateway-QR-${orderRefLabel}.jpg`, { type: 'image/jpeg' });
          const payload: any = { files: [file], title: shareTitle, text: shareText };
          if (typeof nav.canShare !== 'function' || nav.canShare(payload)) {
            await nav.share(payload);
            setShareMsg('Shared');
            return;
          }
        } catch (err: any) {
          // user-cancel: bail silently; otherwise fall through
          if (err?.name === 'AbortError') return;
        }

        // 2) Native share with URL only
        try {
          await nav.share({ title: shareTitle, text: shareText, url: payUrl || undefined });
          setShareMsg('Shared');
          return;
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
        }
      }

      // 3) Clipboard fallback
      if (payUrl && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payUrl);
        setShareMsg('Link copied');
        return;
      }

      setShareMsg('Sharing not supported on this device');
    } catch {
      setShareMsg('Could not share. Try Download instead.');
    } finally {
      setSharing(false);
      setTimeout(() => setShareMsg(null), 2200);
    }
  };

  // Cancel any in-flight long-press timer + reset gesture state.
  const cancelLongPress = () => {
    if (lpTimerRef.current !== undefined) {
      window.clearTimeout(lpTimerRef.current);
      lpTimerRef.current = undefined;
    }
    lpStartXY.current = null;
  };

  const handleQrPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    cancelLongPress();
    lpFiredRef.current = false;
    lpStartXY.current = { x: e.clientX, y: e.clientY };
    lpTimerRef.current = window.setTimeout(() => {
      lpFiredRef.current = true;
      lpTimerRef.current = undefined;
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

  const orderRefId = order.client_order_id || order.txn_ref;
  const isPending = order.status === 'pending';

  let liveLabel: string;
  let liveClass: string;
  if (checking) { liveLabel = 'Checking…'; liveClass = 'on'; }
  else if (live === 'live') { liveLabel = 'Live · waiting for payment'; liveClass = 'live'; }
  else if (live === 'connecting') { liveLabel = 'Connecting…'; liveClass = 'on'; }
  else if (live === 'reconnecting') { liveLabel = 'Reconnecting…'; liveClass = 'warn'; }
  else if (live === 'fallback') { liveLabel = 'Backup mode · checking periodically'; liveClass = 'warn'; }
  else { liveLabel = 'Waiting for payment'; liveClass = ''; }

  return (
    <div
      className="pp-shell pp-protected-page"
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
      onPaste={(e) => e.preventDefault()}
    >
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
            <b>Order ID</b>
            <div className="pp-meta-val">
              <span className="pp-meta-mono">{orderRefId}</span>
              <CopyButton value={orderRefId} label="Order ID" />
            </div>
          </div>
          {order.note && (
            <div className="pp-meta-item">
              <b>Note</b>
              <div className="pp-meta-val">
                <span>{order.note}</span>
                <CopyButton value={order.note} label="Note" />
              </div>
            </div>
          )}
          <div className="pp-meta-item">
            <b>Ref</b>
            <div className="pp-meta-val">
              <span className="pp-meta-mono">{order.txn_ref}</span>
              <CopyButton value={order.txn_ref} label="Reference" />
            </div>
          </div>
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
          <div
            className={`pp-qr-wrap pp-qr-wrap--interactive${downloading ? ' is-busy' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={downloading ? 'Preparing QR download' : 'Tap or long-press to download payment QR'}
            aria-busy={downloading || undefined}
            title="Tap or long-press to download QR"
            onClick={handleQrClick}
            onKeyDown={handleQrKeyDown}
            onPointerDown={handleQrPointerDown}
            onPointerMove={handleQrPointerMove}
            onPointerUp={handleQrPointerEnd}
            onPointerCancel={handleQrPointerEnd}
            onPointerLeave={handleQrPointerEnd}
            onContextMenu={(e) => e.preventDefault()}
          >
            <PayQrCanvas payload={order.upi_payload} size={240} />
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
              onClick={() => void downloadQr()}
              disabled={downloading}
            >
              {downloading ? 'Preparing…' : 'Download QR Code'}
            </button>
            <button
              type="button"
              className="pp-btn ghost"
              onClick={() => void shareQr()}
              disabled={sharing}
              aria-label="Share QR via WhatsApp, Telegram, email or another app"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              {sharing ? 'Opening…' : 'Share QR'}
            </button>
          </div>
          {shareMsg && <div className="pp-share-toast" role="status">{shareMsg}</div>}
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
          {/* Order ID / Note / Ref are intentionally NOT repeated here —
              they live in the always-visible summary card above so we have
              a single, stable receipt-style block that doesn't duplicate
              metadata across two places. */}
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
      </footer>
    </div>
  );
}
