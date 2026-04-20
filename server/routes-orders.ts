import express, { Response } from 'express';
import pool from './db';
import { gwSession, GwSessionRequest } from './auth-mw';
import { verifyPaytmPayment } from './paytm';
import { sendOrderCallback } from './callback';

const router = express.Router();

router.get('/transactions', gwSession, async (req: GwSessionRequest, res: Response) => {
  const userId = req.gwUser!.id;
  const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);
  const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);
  const status = String(req.query.status || '').trim();
  const q = String(req.query.q || '').trim();

  const where: string[] = ['user_id = $1'];
  const params: any[] = [userId];
  if (status && ['pending', 'paid', 'failed', 'cancelled', 'expired'].includes(status)) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (q) {
    params.push('%' + q + '%');
    where.push(`(txn_ref ILIKE $${params.length} OR client_order_id ILIKE $${params.length} OR customer_reference ILIKE $${params.length} OR gateway_txn_id ILIKE $${params.length} OR gateway_bank_txn_id ILIKE $${params.length})`);
  }

  const sql = `SELECT id, client_order_id, txn_ref, amount, currency, status, customer_reference,
                      callback_url, callback_sent, callback_sent_at, callback_status,
                      gateway_txn_id, gateway_bank_txn_id, created_at, expires_at, verified_at
               FROM gw_orders
               WHERE ${where.join(' AND ')}
               ORDER BY id DESC
               LIMIT ${limit} OFFSET ${offset}`;
  const r = await pool.query(sql, params);
  const c = await pool.query(`SELECT COUNT(*)::int AS n FROM gw_orders WHERE ${where.join(' AND ')}`, params);
  res.json({ items: r.rows, total: c.rows[0].n, limit, offset });
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
    `SELECT id, txn_ref, client_order_id, amount, currency, status, created_at
     FROM gw_orders WHERE user_id=$1 ORDER BY id DESC LIMIT 10`,
    [userId],
  );
  const settings = await pool.query(
    `SELECT is_active, paytm_upi_id, paytm_merchant_id FROM gw_settings WHERE user_id=$1`,
    [userId],
  );
  res.json({
    stats: stats.rows[0],
    recent: recent.rows,
    setup_complete: !!settings.rows[0]?.is_active,
    has_token: !!req.gwUser!.api_token,
  });
});

router.post('/orders/:id/refresh', gwSession, async (req: GwSessionRequest, res: Response) => {
  const orderId = parseInt(req.params.id, 10);
  if (!orderId) return res.status(400).json({ error: 'Invalid id' });
  const userId = req.gwUser!.id;

  const r = await pool.query('SELECT * FROM gw_orders WHERE id=$1 AND user_id=$2', [orderId, userId]);
  const order = r.rows[0];
  if (!order) return res.status(404).json({ error: 'Not found' });
  if (order.status !== 'pending') return res.json({ status: order.status, refreshed: false });

  const s = await pool.query('SELECT paytm_merchant_id, paytm_merchant_key, paytm_env FROM gw_settings WHERE user_id=$1', [userId]);
  const cfg = s.rows[0];
  if (!cfg?.paytm_merchant_id || !cfg?.paytm_merchant_key) return res.status(400).json({ error: 'Gateway not configured' });

  const verify = await verifyPaytmPayment(
    { merchant_id: cfg.paytm_merchant_id, merchant_key: cfg.paytm_merchant_key, env: cfg.paytm_env },
    order.txn_ref,
    parseFloat(order.amount),
  );

  if (verify.paid) {
    await pool.query(
      `UPDATE gw_orders SET status='paid', verified_at=NOW(), gateway_txn_id=$1, gateway_bank_txn_id=$2, raw_gateway_response=$3, updated_at=NOW() WHERE id=$4`,
      [verify.txn_id || null, verify.bank_txn_id || null, JSON.stringify(verify.raw || {}).slice(0, 4000), orderId],
    );
    sendOrderCallback(orderId).catch(() => {});
    return res.json({ status: 'paid', refreshed: true });
  }
  if (verify.failure_type === 'payment_failed' || verify.failure_type === 'amount_mismatch') {
    await pool.query(`UPDATE gw_orders SET status='failed', updated_at=NOW(), raw_gateway_response=$1 WHERE id=$2`,
      [JSON.stringify(verify.raw || {}).slice(0, 4000), orderId]);
    return res.json({ status: 'failed', refreshed: true });
  }
  return res.json({ status: order.status, refreshed: false, detail: verify.detail });
});

export default router;
