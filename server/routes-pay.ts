import express, { Request, Response } from 'express';
import QRCode from 'qrcode';
import pool from './db';
import {
  loadOrderByToken,
  loadMerchant,
  refreshOrderFromGateway,
  shapeOrder,
  isExpired,
} from './order-pay-helpers';
import { subscribeOrder, publishOrderSnapshot } from './order-events';
import { apiError, apiSuccess, methodNotAllowed } from './api-response';

const router = express.Router();

router.get('/:token', async (req: Request, res: Response) => {
  try {
    let order = await loadOrderByToken(req.params.token);
    if (!order) return apiError(res, 404, 'Payment link not found or invalid', 'PAYMENT_LINK_NOT_FOUND');

    if (order.status === 'pending' && isExpired(order)) {
      await pool.query(`UPDATE gw_orders SET status='expired', updated_at=NOW() WHERE id=$1`, [order.id]);
      order.status = 'expired';
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

router.post('/:token/refresh', async (req: Request, res: Response) => {
  try {
    let order = await loadOrderByToken(req.params.token);
    if (!order) return apiError(res, 404, 'Payment link not found or invalid', 'PAYMENT_LINK_NOT_FOUND');

    const cfg = await loadMerchant(order.user_id);
    if (cfg && order.status === 'pending') {
      order = await refreshOrderFromGateway(order, cfg);
    }
    if (order.status === 'pending' && isExpired(order)) {
      await pool.query(`UPDATE gw_orders SET status='expired', updated_at=NOW() WHERE id=$1`, [order.id]);
      order.status = 'expired';
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
 *
 * - Subscribes to a per-token channel; only this order's snapshots are sent.
 * - First sends the current snapshot immediately so the client never shows stale state.
 * - Keep-alive comment every 25s to keep proxies from idling the connection.
 * - Closes itself once the order reaches a terminal state — the client stops trying to reconnect.
 */
router.get('/:token/stream', async (req: Request, res: Response) => {
  const token = req.params.token;
  const order = await loadOrderByToken(token);
  if (!order) {
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
  if (initial.status === 'pending' && isExpired(initial)) {
    await pool.query(`UPDATE gw_orders SET status='expired', updated_at=NOW() WHERE id=$1`, [initial.id]).catch(() => {});
    initial.status = 'expired';
  }
  const cfg = await loadMerchant(initial.user_id);
  const initialSnap = shapeOrder(initial, cfg);
  send('snapshot', initialSnap);

  // If already terminal, send a close hint and end — no need to keep a connection open.
  if (initialSnap.is_terminal) {
    send('end', { reason: 'terminal' });
    res.end();
    return;
  }

  // Subscribe to live updates.
  const unsubscribe = subscribeOrder(token, (snap) => {
    send('update', snap);
    if (snap.is_terminal) {
      send('end', { reason: 'terminal' });
      try { res.end(); } catch { /* noop */ }
    }
  });

  // Keep-alive ping.
  const ping = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n\n`); } catch { /* noop */ }
  }, 25000);

  const cleanup = () => {
    clearInterval(ping);
    try { unsubscribe(); } catch { /* noop */ }
  };
  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('close', cleanup);
});

router.get('/:token/qr.png', async (req: Request, res: Response) => {
  try {
    const order = await loadOrderByToken(req.params.token);
    if (!order || !order.upi_payload) {
      return res.status(404).json({ success: false, message: 'QR not available', code: 'QR_NOT_AVAILABLE' });
    }
    const size = Math.min(Math.max(parseInt(String(req.query.size || '420'), 10) || 420, 160), 800);
    const buf = await QRCode.toBuffer(order.upi_payload, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: size,
      color: { dark: '#0a0a0f', light: '#ffffff' },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300, immutable');
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
