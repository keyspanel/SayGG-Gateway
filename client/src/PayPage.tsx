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
            <li>Scan the QR with your UPI app, or download it to share.</li>
            <li>Approve <b>₹{order.amount.toFixed(2)}</b>.</li>
            <li>Status updates here automatically.</li>
          </ol>
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
        </div>
      )}

      <footer className="pp-foot">
        <span>Secured by <strong>PayGateway</strong></span>
        <span>Ref <code>{order.txn_ref}</code></span>
      </footer>
    </div>
  );
}
