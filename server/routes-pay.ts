import express, { Request, Response } from 'express';
import QRCode from 'qrcode';
import {
  loadOrderByToken,
  loadMerchant,
  refreshOrderFromGateway,
  shapeOrder,
} from './order-pay-helpers';
import { subscribeOrder, publishOrderSnapshot } from './order-events';
import { apiError, apiSuccess, methodNotAllowed } from './api-response';
import { rateLimit, tryAcquireConcurrent, releaseConcurrent, clientIp } from './rate-limit';
import { isValidPublicToken } from './validation';
import { transitionOrder, isOrderExpiredAt } from './order-state';
import { logOrderEvent } from './audit';

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* Rate limiters for the public hosted page                                   */
/* -------------------------------------------------------------------------- */

const payGetLimiter = rateLimit({
  name: 'pay_get',
  windowMs: 60_000,
  max: 120, // 2/sec per IP
  message: 'Too many requests. Please slow down.',
  code: 'RATE_LIMITED_PAY',
});
const payRefreshLimiter = rateLimit({
  name: 'pay_refresh',
  windowMs: 60_000,
  max: 30, // 1 every 2s per IP
  message: 'Too many refresh requests. Please wait.',
  code: 'RATE_LIMITED_PAY_REFRESH',
});
const sseConnectLimiter = rateLimit({
  name: 'pay_sse_connect',
  windowMs: 60_000,
  max: 30,
  message: 'Too many connection attempts. Please wait.',
  code: 'RATE_LIMITED_PAY_STREAM',
});
const qrLimiter = rateLimit({
  name: 'pay_qr',
  windowMs: 60_000,
  max: 60,
  message: 'Too many QR requests. Please wait.',
  code: 'RATE_LIMITED_PAY_QR',
});

const SSE_PER_IP_MAX = 6;

/* -------------------------------------------------------------------------- */
/* Token guard                                                                 */
/* -------------------------------------------------------------------------- */

function tokenGuard(req: Request, res: Response, next: express.NextFunction) {
  if (!isValidPublicToken(req.params.token)) {
    apiError(res, 404, 'Payment link not found or invalid', 'PAYMENT_LINK_NOT_FOUND');
    return;
  }
  next();
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

router.get('/:token', tokenGuard, payGetLimiter, async (req: Request, res: Response) => {
  try {
    let order = await loadOrderByToken(req.params.token);
    if (!order) return apiError(res, 404, 'Payment link not found or invalid', 'PAYMENT_LINK_NOT_FOUND');

    // Server-mode orders intentionally do not have a hosted page — the
    // merchant is responsible for rendering their own UI from the API
    // response. Hide the order entirely behind the same 404 to avoid
    // leaking that the token exists.
    if ((order as any).order_mode === 'server') {
      return apiError(res, 404, 'Payment link not found or invalid', 'PAYMENT_LINK_NOT_FOUND');
    }

    if (order.status === 'pending' && isOrderExpiredAt(order.expires_at)) {
      const t = await transitionOrder({
        orderId: order.id,
        to: 'expired',
        event: 'order.expired',
        meta: { source: 'pay_get' },
      });
      if (t.changed && t.row) order = t.row;
    }
    const cfg = await loadMerchant(order.user_id);
    const snap = shapeOrder(order, cfg);
    publishOrderSnapshot(order.public_token, snap);
    return apiSuccess(res, 'Order loaded', snap);
  } catch (e) {
    console.error('[pay/get]', e);
    return apiError(res, 500, 'Failed to load payment link', 'INTERNAL_SERVER_ERROR');
  }
});

router.post('/:token/refresh', tokenGuard, payRefreshLimiter, async (req: Request, res: Response) => {
  try {
    let order = await loadOrderByToken(req.params.token);
    if (!order) return apiError(res, 404, 'Payment link not found or invalid', 'PAYMENT_LINK_NOT_FOUND');
    if ((order as any).order_mode === 'server') {
      return apiError(res, 404, 'Payment link not found or invalid', 'PAYMENT_LINK_NOT_FOUND');
    }

    const cfg = await loadMerchant(order.user_id);
    if (cfg && order.status === 'pending') {
      logOrderEvent({ order_id: order.id, user_id: order.user_id, event: 'order.refresh_hosted' }).catch(() => {});
      order = await refreshOrderFromGateway(order, cfg);
    }
    if (order.status === 'pending' && isOrderExpiredAt(order.expires_at)) {
      const t = await transitionOrder({
        orderId: order.id,
        to: 'expired',
        event: 'order.expired',
        meta: { source: 'pay_refresh' },
      });
      if (t.changed && t.row) order = t.row;
    }
    const snap = shapeOrder(order, cfg);
    publishOrderSnapshot(order.public_token, snap);
    return apiSuccess(res, 'Status refreshed', snap);
  } catch (e) {
    console.error('[pay/refresh]', e);
    return apiError(res, 500, 'Failed to refresh status', 'INTERNAL_SERVER_ERROR');
  }
});

/**
 * Server-Sent Events stream for one hosted payment page.
 * Per-IP concurrent-connection cap + per-IP connect-rate cap.
 */
router.get('/:token/stream', tokenGuard, sseConnectLimiter, async (req: Request, res: Response) => {
  const token = req.params.token;
  const ip = clientIp(req);

  if (!tryAcquireConcurrent('pay_sse', ip, SSE_PER_IP_MAX)) {
    return apiError(res, 429, 'Too many open connections from this client.', 'SSE_TOO_MANY', { retry_after_seconds: 30 });
  }

  const order = await loadOrderByToken(token);
  if (!order || (order as any).order_mode === 'server') {
    releaseConcurrent('pay_sse', ip);
    return apiError(res, 404, 'Payment link not found or invalid', 'PAYMENT_LINK_NOT_FOUND');
  }

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch { /* connection probably gone */ }
  };

  // Initial snapshot — auto-expire if needed before sending.
  let initial = order;
  if (initial.status === 'pending' && isOrderExpiredAt(initial.expires_at)) {
    const t = await transitionOrder({
      orderId: initial.id,
      to: 'expired',
      event: 'order.expired',
      meta: { source: 'sse_open' },
    });
    if (t.changed && t.row) initial = t.row;
  }
  const cfg = await loadMerchant(initial.user_id);
  const initialSnap = shapeOrder(initial, cfg);
  send('snapshot', initialSnap);

  if (initialSnap.is_terminal) {
    send('end', { reason: 'terminal' });
    res.end();
    releaseConcurrent('pay_sse', ip);
    return;
  }

  logOrderEvent({ order_id: initial.id, user_id: initial.user_id, event: 'sse.connect' }).catch(() => {});

  let cleaned = false;
  const unsubscribe = subscribeOrder(token, (snap) => {
    send('update', snap);
    if (snap.is_terminal) {
      send('end', { reason: 'terminal' });
      try { res.end(); } catch { /* noop */ }
    }
  });

  const ping = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n\n`); } catch { /* noop */ }
  }, 25_000);

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(ping);
    try { unsubscribe(); } catch { /* noop */ }
    releaseConcurrent('pay_sse', ip);
    logOrderEvent({ order_id: initial.id, user_id: initial.user_id, event: 'sse.disconnect' }).catch(() => {});
  };
  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('close', cleanup);
});

/**
 * Sizes allowed for the public QR PNG endpoint. Plain black-and-white QRs
 * with high error correction so the downloaded image stays scannable on
 * print, projection, and screen.
 *
 * 4K (4096) is supported but falls back to 2K if rendering fails or runs
 * out of memory under load — 2K still scans cleanly from a phone.
 */
const ALLOWED_QR_SIZES = [512, 1024, 1080, 2048, 4096] as const;
type QrSize = typeof ALLOWED_QR_SIZES[number];
const DEFAULT_QR_SIZE: QrSize = 2048;
const FALLBACK_QR_SIZE: QrSize = 2048;

function pickQrSize(raw: unknown): QrSize {
  const n = parseInt(String(raw ?? ''), 10);
  return (ALLOWED_QR_SIZES as readonly number[]).includes(n) ? (n as QrSize) : DEFAULT_QR_SIZE;
}

async function renderQrPng(payload: string, width: QrSize): Promise<Buffer> {
  return QRCode.toBuffer(payload, {
    type: 'png',
    errorCorrectionLevel: 'H',
    margin: 4,
    width,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}

router.get('/:token/qr.png', tokenGuard, qrLimiter, async (req: Request, res: Response) => {
  try {
    const order = await loadOrderByToken(req.params.token);
    if (!order || !order.upi_payload) {
      return res.status(404).json({ success: false, message: 'QR not available', code: 'QR_NOT_AVAILABLE' });
    }
    // Server-mode QR is exposed for merchants who want the raw QR; we still
    // serve it. (The hosted HTML page itself is what's gated above.)

    const requested = pickQrSize(req.query.size);
    let size: QrSize = requested;
    let buf: Buffer;
    try {
      buf = await renderQrPng(order.upi_payload, size);
    } catch (renderErr) {
      // Graceful fallback (e.g. memory pressure at 4K under load).
      if (size > FALLBACK_QR_SIZE) {
        console.warn('[pay/qr] high-res render failed, falling back', { requested, fallback: FALLBACK_QR_SIZE, err: (renderErr as Error)?.message });
        size = FALLBACK_QR_SIZE;
        buf = await renderQrPng(order.upi_payload, size);
      } else {
        throw renderErr;
      }
    }

    const safeRef = String(order.txn_ref || order.public_token).replace(/[^A-Za-z0-9_-]/g, '');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="PayGateway-QR-${safeRef}-${size}.png"`);
    return res.send(buf);
  } catch (e) {
    console.error('[pay/qr]', e);
    return res.status(500).json({ success: false, message: 'Failed to render QR', code: 'QR_RENDER_FAILED' });
  }
});

router.all('/:token', methodNotAllowed(['GET']));
router.all('/:token/refresh', methodNotAllowed(['POST']));
router.all('/:token/stream', methodNotAllowed(['GET']));
router.all('/:token/qr.png', methodNotAllowed(['GET']));

export default router;
