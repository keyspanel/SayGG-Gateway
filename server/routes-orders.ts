import express, { Response } from 'express';
import pool from './db';
import { gwSession, GwSessionRequest } from './auth-mw';
import { verifyPaytmPayment, classifyVerificationForPoll } from './paytm';
import { sendOrderCallback } from './callback';
import { apiError, apiSuccess, methodNotAllowed } from './api-response';
import { transitionOrder, isOrderExpiredAt } from './order-state';
import { logOrderEvent } from './audit';
import { publishOrderSnapshot } from './order-events';
import { shapeOrder, loadMerchant } from './order-pay-helpers';

const router = express.Router();

const ALLOWED_STATUS = new Set(['pending', 'paid', 'failed', 'cancelled', 'expired']);
const Q_MAX_LEN = 80;
const LIMIT_MAX = 200;

router.get('/transactions', gwSession, async (req: GwSessionRequest, res: Response) => {
  const userId = req.gwUser!.id;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), LIMIT_MAX);
  const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);
  const status = String(req.query.status || '').trim();
  const q = String(req.query.q || '').trim().slice(0, Q_MAX_LEN);

  const where: string[] = ['user_id = $1'];
  const params: any[] = [userId];
  if (status && ALLOWED_STATUS.has(status)) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (q) {
    // ILIKE escape so % and _ in user input don't blow up the index
    const safe = q.replace(/[\\%_]/g, (c) => '\\' + c);
    params.push('%' + safe + '%');
    where.push(
      `(txn_ref ILIKE $${params.length} ESCAPE '\\' OR client_order_id ILIKE $${params.length} ESCAPE '\\'
        OR customer_reference ILIKE $${params.length} ESCAPE '\\' OR gateway_txn_id ILIKE $${params.length} ESCAPE '\\'
        OR gateway_bank_txn_id ILIKE $${params.length} ESCAPE '\\')`,
    );
  }

  const sql = `SELECT id, client_order_id, txn_ref, amount, currency, status, customer_reference,
                      callback_url, redirect_url, cancel_url, callback_sent, callback_sent_at, callback_status, callback_attempts,
                      gateway_txn_id, gateway_bank_txn_id, created_at, expires_at, verified_at,
                      COALESCE(order_mode, 'hosted') AS order_mode
               FROM gw_orders
               WHERE ${where.join(' AND ')}
               ORDER BY id DESC
               LIMIT ${limit} OFFSET ${offset}`;
  const r = await pool.query(sql, params);
  const c = await pool.query(`SELECT COUNT(*)::int AS n FROM gw_orders WHERE ${where.join(' AND ')}`, params);
  apiSuccess(res, 'Transactions loaded', { items: r.rows, total: c.rows[0].n, limit, offset });
});

router.get('/dashboard', gwSession, async (req: GwSessionRequest, res: Response) => {
  const userId = req.gwUser!.id;
  const stats = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status='paid')::int AS paid,
       COUNT(*) FILTER (WHERE status='pending')::int AS pending,
       COUNT(*) FILTER (WHERE status IN ('failed','cancelled','expired'))::int AS failed,
       COALESCE(SUM(amount) FILTER (WHERE status='paid'),0)::float AS revenue
     FROM gw_orders WHERE user_id=$1`,
    [userId],
  );
  const recent = await pool.query(
    `SELECT id, txn_ref, client_order_id, amount, currency, status, created_at,
            COALESCE(order_mode, 'hosted') AS order_mode
     FROM gw_orders WHERE user_id=$1 ORDER BY id DESC LIMIT 10`,
    [userId],
  );
  const settings = await pool.query(
    `SELECT is_active, paytm_upi_id, paytm_merchant_id FROM gw_settings WHERE user_id=$1`,
    [userId],
  );
  apiSuccess(res, 'Dashboard loaded', {
    stats: stats.rows[0],
    recent: recent.rows,
    setup_complete: !!settings.rows[0]?.is_active,
    has_token: !!req.gwUser!.api_token,
  });
});

router.post('/orders/:id/refresh', gwSession, async (req: GwSessionRequest, res: Response) => {
  const orderId = parseInt(req.params.id, 10);
  if (!orderId) return apiError(res, 400, 'Invalid id', 'VALIDATION_ERROR', { field: 'id' });
  const userId = req.gwUser!.id;

  const r = await pool.query('SELECT * FROM gw_orders WHERE id=$1 AND user_id=$2', [orderId, userId]);
  let order = r.rows[0];
  if (!order) return apiError(res, 404, 'Order not found', 'ORDER_NOT_FOUND');
  if (order.status !== 'pending') {
    return apiSuccess(res, 'Order already finalized', { status: order.status, refreshed: false });
  }

  const s = await pool.query('SELECT paytm_merchant_id, paytm_merchant_key, paytm_env FROM gw_settings WHERE user_id=$1', [userId]);
  const cfg = s.rows[0];
  if (!cfg?.paytm_merchant_id || !cfg?.paytm_merchant_key) return apiError(res, 412, 'Gateway not configured', 'SETTINGS_MISSING');

  logOrderEvent({ order_id: orderId, user_id: userId, event: 'order.refresh_manual' }).catch(() => {});

  let verify;
  try {
    verify = await verifyPaytmPayment(
      { merchant_id: cfg.paytm_merchant_id, merchant_key: cfg.paytm_merchant_key, env: cfg.paytm_env },
      order.txn_ref,
      parseFloat(order.amount),
    );
  } catch {
    if (isOrderExpiredAt(order.expires_at)) {
      const t = await transitionOrder({ orderId, to: 'expired', event: 'order.expired', meta: { source: 'manual_refresh' } });
      if (t.changed && t.row) order = t.row;
    }
    return apiSuccess(res, 'Order still pending (gateway transient error)', { status: order.status, refreshed: false });
  }

  const decision = classifyVerificationForPoll(verify);
  if (decision === 'paid') {
    const t = await transitionOrder({
      orderId,
      to: 'paid',
      fields: {
        gateway_txn_id: verify.txn_id || null,
        gateway_bank_txn_id: verify.bank_txn_id || null,
        raw_gateway_response: JSON.stringify(verify.raw || {}).slice(0, 4000),
      },
      event: 'order.verify_paid',
      meta: { source: 'manual_refresh' },
    });
    if (t.changed && t.row) {
      sendOrderCallback(orderId).catch(() => {});
      const cfgShape = await loadMerchant(userId).catch(() => null);
      publishOrderSnapshot(t.row.public_token, shapeOrder(t.row, cfgShape));
    }
    return apiSuccess(res, 'Order refreshed', { status: 'paid', refreshed: t.changed });
  }
  if (decision === 'failed') {
    const t = await transitionOrder({
      orderId,
      to: 'failed',
      fields: { raw_gateway_response: JSON.stringify(verify.raw || {}).slice(0, 4000) },
      event: 'order.verify_failed',
      meta: { source: 'manual_refresh' },
    });
    if (t.changed && t.row) {
      const cfgShape = await loadMerchant(userId).catch(() => null);
      publishOrderSnapshot(t.row.public_token, shapeOrder(t.row, cfgShape));
    }
    return apiSuccess(res, 'Order refreshed', { status: 'failed', refreshed: t.changed });
  }
  if (isOrderExpiredAt(order.expires_at)) {
    const t = await transitionOrder({ orderId, to: 'expired', event: 'order.expired', meta: { source: 'manual_refresh' } });
    if (t.changed && t.row) {
      const cfgShape = await loadMerchant(userId).catch(() => null);
      publishOrderSnapshot(t.row.public_token, shapeOrder(t.row, cfgShape));
    }
    return apiSuccess(res, 'Order refreshed', { status: 'expired', refreshed: t.changed });
  }
  return apiSuccess(res, 'Order still pending', { status: 'pending', refreshed: false, detail: verify.detail });
});

router.all('/transactions', methodNotAllowed(['GET']));
router.all('/dashboard', methodNotAllowed(['GET']));
router.all('/orders/:id/refresh', methodNotAllowed(['POST']));

export default router;
