import express, { Response } from 'express';
import pool from './db';
import { gwApiToken, GwApiRequest } from './auth-mw';
import { buildUniqueTxnRef, buildUpiPayload, verifyPaytmPayment } from './paytm';
import { sendOrderCallback } from './callback';
import { apiError, apiSuccess, methodNotAllowed } from './api-response';

const router = express.Router();

const ORDER_TTL_MIN = 30;

async function getCreds(userId: number) {
  const r = await pool.query(
    'SELECT paytm_upi_id, paytm_merchant_id, paytm_merchant_key, paytm_env, payee_name, is_active FROM gw_settings WHERE user_id=$1',
    [userId],
  );
  return r.rows[0] || null;
}

router.post('/create-order', gwApiToken, async (req: GwApiRequest, res: Response) => {
  try {
    const user = req.gwUser!;
    const amount = parseFloat(String(req.body.amount));
    const currency = String(req.body.currency || 'INR').toUpperCase();
    const customer_reference = req.body.customer_reference ? String(req.body.customer_reference).slice(0, 200) : null;
    const client_order_id = req.body.client_order_id ? String(req.body.client_order_id).slice(0, 120) : null;
    const callback_url = req.body.callback_url ? String(req.body.callback_url).slice(0, 500) : null;
    const note = req.body.note ? String(req.body.note).slice(0, 200) : null;

    if (!amount || isNaN(amount) || amount <= 0) {
      return apiError(res, 400, 'amount must be a positive number', 'VALIDATION_ERROR', { field: 'amount' });
    }
    if (currency !== 'INR') {
      return apiError(res, 400, 'Only INR currency supported', 'VALIDATION_ERROR', { field: 'currency' });
    }
    if (callback_url && !/^https?:\/\//i.test(callback_url)) {
      return apiError(res, 400, 'callback_url must start with http:// or https://', 'VALIDATION_ERROR', { field: 'callback_url' });
    }

    const cfg = await getCreds(user.id);
    if (!cfg || !cfg.is_active || !cfg.paytm_upi_id || !cfg.paytm_merchant_id || !cfg.paytm_merchant_key) {
      return apiError(res, 412, 'Gateway not configured. Save UPI settings first.', 'SETTINGS_MISSING');
    }

    if (client_order_id) {
      const dup = await pool.query(
        'SELECT id, txn_ref, status FROM gw_orders WHERE user_id=$1 AND client_order_id=$2 LIMIT 1',
        [user.id, client_order_id],
      );
      if (dup.rows[0]) {
        const o = dup.rows[0];
        return apiError(res, 409, 'client_order_id already exists', 'ORDER_ALREADY_EXISTS', { order_id: o.id, txn_ref: o.txn_ref, status: o.status });
      }
    }

    const txnRef = buildUniqueTxnRef(user.id);
    const upiPayload = buildUpiPayload({
      upi_id: cfg.paytm_upi_id,
      payee_name: cfg.payee_name || 'Merchant',
      amount,
      txn_ref: txnRef,
      note: note || 'Payment',
    });

    const ins = await pool.query(
      `INSERT INTO gw_orders (user_id, client_order_id, txn_ref, amount, currency, status, note, customer_reference, callback_url, upi_payload, payment_link, expires_at)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$9, NOW() + INTERVAL '${ORDER_TTL_MIN} minutes')
       RETURNING id, created_at, expires_at`,
      [user.id, client_order_id, txnRef, amount.toFixed(2), currency, note, customer_reference, callback_url, upiPayload],
    );
    const orderId = ins.rows[0].id;

    apiSuccess(res, 'Order created', {
      order_id: orderId,
      txn_ref: txnRef,
      client_order_id,
      amount,
      currency,
      status: 'pending',
      payment_link: upiPayload,
      upi_payload: upiPayload,
      created_at: ins.rows[0].created_at,
      expires_at: ins.rows[0].expires_at,
      callback_url: callback_url || undefined,
    });
  } catch (e) {
    console.error('[gw/create-order]', e);
    apiError(res, 500, 'Failed to create order', 'CREATE_ORDER_FAILED');
  }
});

router.post('/check-order', gwApiToken, checkOrder);
router.get('/check-order', gwApiToken, checkOrder);

async function checkOrder(req: GwApiRequest, res: Response) {
  try {
    const user = req.gwUser!;
    const order_id = req.body?.order_id ?? req.query.order_id;
    const txn_ref = req.body?.txn_ref ?? req.query.txn_ref;
    const client_order_id = req.body?.client_order_id ?? req.query.client_order_id;

    let r;
    if (order_id) {
      r = await pool.query('SELECT * FROM gw_orders WHERE id=$1 AND user_id=$2', [parseInt(String(order_id), 10) || 0, user.id]);
    } else if (txn_ref) {
      r = await pool.query('SELECT * FROM gw_orders WHERE txn_ref=$1 AND user_id=$2', [String(txn_ref), user.id]);
    } else if (client_order_id) {
      r = await pool.query('SELECT * FROM gw_orders WHERE client_order_id=$1 AND user_id=$2', [String(client_order_id), user.id]);
    } else {
      return apiError(res, 400, 'Provide order_id, txn_ref or client_order_id', 'VALIDATION_ERROR', {
        accepted_fields: ['order_id', 'txn_ref', 'client_order_id'],
      });
    }
    let order = r.rows[0];
    if (!order) return apiError(res, 404, 'Order not found', 'ORDER_NOT_FOUND');

    if (order.status === 'pending' && order.expires_at && new Date(order.expires_at).getTime() < Date.now()) {
      // mark expired but still try verification first
    }

    if (order.status === 'pending') {
      const cfg = await getCreds(user.id);
      if (cfg?.paytm_merchant_id && cfg?.paytm_merchant_key) {
        const verify = await verifyPaytmPayment(
          { merchant_id: cfg.paytm_merchant_id, merchant_key: cfg.paytm_merchant_key, env: cfg.paytm_env },
          order.txn_ref,
          parseFloat(order.amount),
        );
        if (verify.paid) {
          await pool.query(
            `UPDATE gw_orders SET status='paid', verified_at=NOW(), gateway_txn_id=$1, gateway_bank_txn_id=$2, raw_gateway_response=$3, updated_at=NOW() WHERE id=$4`,
            [verify.txn_id || null, verify.bank_txn_id || null, JSON.stringify(verify.raw || {}).slice(0, 4000), order.id],
          );
          sendOrderCallback(order.id).catch(() => {});
          const r2 = await pool.query('SELECT * FROM gw_orders WHERE id=$1', [order.id]);
          order = r2.rows[0];
        } else if (verify.failure_type === 'payment_failed' || verify.failure_type === 'amount_mismatch') {
          await pool.query(`UPDATE gw_orders SET status='failed', updated_at=NOW(), raw_gateway_response=$1 WHERE id=$2`,
            [JSON.stringify(verify.raw || {}).slice(0, 4000), order.id]);
          order.status = 'failed';
        } else if (order.expires_at && new Date(order.expires_at).getTime() < Date.now()) {
          await pool.query(`UPDATE gw_orders SET status='expired', updated_at=NOW() WHERE id=$1`, [order.id]);
          order.status = 'expired';
        }
      }
    }

    // Retry callback if paid but not yet successfully delivered
    if (order.status === 'paid' && order.callback_url && !order.callback_sent) {
      sendOrderCallback(order.id).catch(() => {});
    }

    apiSuccess(res, 'Order status loaded', {
      order_id: order.id,
      client_order_id: order.client_order_id,
      txn_ref: order.txn_ref,
      amount: parseFloat(order.amount),
      currency: order.currency,
      status: order.status,
      gateway_txn_id: order.gateway_txn_id,
      bank_rrn: order.gateway_bank_txn_id,
      customer_reference: order.customer_reference,
      created_at: order.created_at,
      expires_at: order.expires_at,
      verified_at: order.verified_at,
      payment_received: order.status === 'paid',
      callback_sent: !!order.callback_sent,
      callback_status: order.callback_status,
    });
  } catch (e) {
    console.error('[gw/check-order]', e);
    apiError(res, 500, 'Failed to check order', 'CHECK_ORDER_FAILED');
  }
}

router.all('/create-order', methodNotAllowed(['POST']));
router.all('/check-order', methodNotAllowed(['GET', 'POST']));

export default router;
