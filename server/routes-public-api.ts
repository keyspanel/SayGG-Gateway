import express, { Response } from 'express';
import pool from './db';
import { gwApiToken, GwApiRequest } from './auth-mw';
import crypto from 'crypto';
import { buildUniqueTxnRef, buildUpiPayload, verifyPaytmPayment, classifyVerificationForPoll } from './paytm';
import { sendOrderCallback } from './callback';
import { publishOrderSnapshot } from './order-events';
import { apiError, apiSuccess, methodNotAllowed } from './api-response';
import {
  parseAmount,
  parseClientOrderId,
  parseCustomerReference,
  parseNote,
  parseCallbackUrlShape,
  parseRedirectUrlShape,
  parseIdempotencyKey,
} from './validation';
import { rateLimit } from './rate-limit';
import { transitionOrder, isOrderExpiredAt } from './order-state';
import { logOrderEvent } from './audit';
import { shapeOrder, loadMerchant } from './order-pay-helpers';

function genPublicToken(): string {
  // url-safe ~22 chars, ~128 bits
  return crypto.randomBytes(16).toString('base64url');
}

function buildPaymentPageUrl(req: { protocol: string; get: (h: string) => string | undefined }, token: string): string {
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const host = req.get('x-forwarded-host') || req.get('host') || '';
  return `${proto}://${host}/pay/${token}`;
}

const router = express.Router();

const ORDER_TTL_MIN = 30;

async function getCreds(userId: number) {
  const r = await pool.query(
    'SELECT paytm_upi_id, paytm_merchant_id, paytm_merchant_key, paytm_env, payee_name, is_active FROM gw_settings WHERE user_id=$1',
    [userId],
  );
  return r.rows[0] || null;
}

/* -------------------------------------------------------------------------- */
/* Rate limiters                                                               */
/* -------------------------------------------------------------------------- */

const createOrderLimiter = rateLimit({
  name: 'create_order',
  windowMs: 60_000,
  max: 60, // 60 orders/min per merchant — generous, kills only abuse
  scope: (req) => String((req as GwApiRequest).gwUser?.id || ''),
  message: 'Too many create-order requests. Please slow down.',
  code: 'RATE_LIMITED_CREATE_ORDER',
});

const checkOrderLimiter = rateLimit({
  name: 'check_order',
  windowMs: 60_000,
  max: 240, // 4/sec per merchant
  scope: (req) => String((req as GwApiRequest).gwUser?.id || ''),
  message: 'Too many check-order requests. Please slow down.',
  code: 'RATE_LIMITED_CHECK_ORDER',
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function fingerprintRequest(parts: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function shapeOrderForApi(o: any) {
  return {
    order_id: o.id,
    txn_ref: o.txn_ref,
    client_order_id: o.client_order_id,
    amount: parseFloat(o.amount),
    currency: o.currency,
    status: o.status,
    payment_link: o.upi_payload,
    upi_payload: o.upi_payload,
    public_token: o.public_token,
    qr_image_url: o.public_token ? `/api/pay/${o.public_token}/qr.png` : undefined,
    created_at: o.created_at,
    expires_at: o.expires_at,
    callback_url: o.callback_url || undefined,
    redirect_url: o.redirect_url || undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* POST /create-order                                                          */
/* -------------------------------------------------------------------------- */

router.post('/create-order', gwApiToken, createOrderLimiter, async (req: GwApiRequest, res: Response) => {
  try {
    const user = req.gwUser!;

    // ---- Input validation ----
    const amountP = parseAmount(req.body.amount);
    if (!amountP.ok) return apiError(res, 400, amountP.err.message, amountP.err.code, { field: amountP.err.field });

    const currency = String(req.body.currency || 'INR').toUpperCase();
    if (currency !== 'INR') return apiError(res, 400, 'Only INR currency supported', 'VALIDATION_ERROR', { field: 'currency' });

    const cliP = parseClientOrderId(req.body.client_order_id);
    if (!cliP.ok) return apiError(res, 400, cliP.err.message, cliP.err.code, { field: cliP.err.field });

    const custP = parseCustomerReference(req.body.customer_reference);
    if (!custP.ok) return apiError(res, 400, custP.err.message, custP.err.code, { field: custP.err.field });

    const noteP = parseNote(req.body.note);
    if (!noteP.ok) return apiError(res, 400, noteP.err.message, noteP.err.code, { field: noteP.err.field });

    const cbP = parseCallbackUrlShape(req.body.callback_url);
    if (!cbP.ok) return apiError(res, 400, cbP.err.message, cbP.err.code, { field: cbP.err.field });

    const rdP = parseRedirectUrlShape(req.body.redirect_url);
    if (!rdP.ok) return apiError(res, 400, rdP.err.message, rdP.err.code, { field: rdP.err.field });

    const idemRaw = (req.headers['idempotency-key'] as string | undefined) ?? req.body.idempotency_key;
    const idemP = parseIdempotencyKey(idemRaw);
    if (!idemP.ok) return apiError(res, 400, idemP.err.message, idemP.err.code, { field: idemP.err.field });

    const amount = amountP.value;
    const client_order_id = cliP.value;
    const customer_reference = custP.value;
    const note = noteP.value;
    const callback_url = cbP.value;
    const redirect_url = rdP.value;
    const idempotencyKey = idemP.value;

    const cfg = await getCreds(user.id);
    if (!cfg || !cfg.is_active || !cfg.paytm_upi_id || !cfg.paytm_merchant_id || !cfg.paytm_merchant_key) {
      return apiError(res, 412, 'Gateway not configured. Save UPI settings first.', 'SETTINGS_MISSING');
    }

    // ---- Idempotency: same key + same fingerprint = return existing order ----
    // redirect_url is part of the fingerprint so reusing the same key with a
    // different success-redirect target is treated as IDEMPOTENCY_CONFLICT.
    const fingerprint = fingerprintRequest({ amount, currency, client_order_id, callback_url, redirect_url, customer_reference, note });

    if (idempotencyKey) {
      const existing = await pool.query(
        `SELECT * FROM gw_orders WHERE user_id=$1 AND idempotency_key=$2 LIMIT 1`,
        [user.id, idempotencyKey],
      );
      const ex = existing.rows[0];
      if (ex) {
        if (ex.idempotency_fingerprint && ex.idempotency_fingerprint !== fingerprint) {
          return apiError(res, 409, 'Idempotency-Key was reused with a different request body', 'IDEMPOTENCY_CONFLICT', {
            order_id: ex.id, txn_ref: ex.txn_ref,
          });
        }
        return apiSuccess(res, 'Order returned (idempotent replay)', shapeOrderForApi(ex));
      }
    }

    // ---- Duplicate client_order_id check (kept for backwards compat) ----
    if (client_order_id) {
      const dup = await pool.query(
        'SELECT id, txn_ref, status FROM gw_orders WHERE user_id=$1 AND client_order_id=$2 LIMIT 1',
        [user.id, client_order_id],
      );
      if (dup.rows[0]) {
        const o = dup.rows[0];
        return apiError(res, 409, 'client_order_id already exists', 'ORDER_ALREADY_EXISTS', {
          order_id: o.id, txn_ref: o.txn_ref, status: o.status,
        });
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

    // Hard-to-guess public token for the hosted page
    let publicToken = genPublicToken();
    for (let i = 0; i < 4; i++) {
      const exists = await pool.query('SELECT 1 FROM gw_orders WHERE public_token=$1 LIMIT 1', [publicToken]);
      if (!exists.rows[0]) break;
      publicToken = genPublicToken();
    }

    let ins;
    try {
      ins = await pool.query(
        `INSERT INTO gw_orders
           (user_id, client_order_id, txn_ref, amount, currency, status, note, customer_reference,
            callback_url, redirect_url, upi_payload, payment_link, public_token, expires_at,
            idempotency_key, idempotency_fingerprint)
         VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$10,$11,
                 NOW() + INTERVAL '${ORDER_TTL_MIN} minutes',
                 $12,$13)
         RETURNING *`,
        [user.id, client_order_id, txnRef, amount.toFixed(2), currency, note, customer_reference,
         callback_url, redirect_url, upiPayload, publicToken, idempotencyKey, idempotencyKey ? fingerprint : null],
      );
    } catch (e: any) {
      // Unique-violation race — another concurrent request inserted first.
      if (e?.code === '23505') {
        if (idempotencyKey) {
          const r2 = await pool.query(
            `SELECT * FROM gw_orders WHERE user_id=$1 AND idempotency_key=$2 LIMIT 1`,
            [user.id, idempotencyKey],
          );
          if (r2.rows[0]) return apiSuccess(res, 'Order returned (idempotent replay)', shapeOrderForApi(r2.rows[0]));
        }
        if (client_order_id) {
          const r3 = await pool.query(
            `SELECT id, txn_ref, status FROM gw_orders WHERE user_id=$1 AND client_order_id=$2 LIMIT 1`,
            [user.id, client_order_id],
          );
          if (r3.rows[0]) {
            const o = r3.rows[0];
            return apiError(res, 409, 'client_order_id already exists', 'ORDER_ALREADY_EXISTS', {
              order_id: o.id, txn_ref: o.txn_ref, status: o.status,
            });
          }
        }
      }
      throw e;
    }
    const order = ins.rows[0];
    logOrderEvent({
      order_id: order.id,
      user_id: user.id,
      event: 'order.created',
      status_after: 'pending',
      meta: { has_callback: !!callback_url, has_redirect: !!redirect_url, idempotent: !!idempotencyKey },
    }).catch(() => {});

    apiSuccess(res, 'Order created', {
      ...shapeOrderForApi(order),
      payment_page_url: buildPaymentPageUrl(req, publicToken),
    });
  } catch (e) {
    console.error('[gw/create-order]', e);
    apiError(res, 500, 'Failed to create order', 'CREATE_ORDER_FAILED');
  }
});

/* -------------------------------------------------------------------------- */
/* GET/POST /check-order                                                       */
/* -------------------------------------------------------------------------- */

router.post('/check-order', gwApiToken, checkOrderLimiter, checkOrder);
router.get('/check-order', gwApiToken, checkOrderLimiter, checkOrder);

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
      r = await pool.query('SELECT * FROM gw_orders WHERE txn_ref=$1 AND user_id=$2', [String(txn_ref).slice(0, 64), user.id]);
    } else if (client_order_id) {
      r = await pool.query('SELECT * FROM gw_orders WHERE client_order_id=$1 AND user_id=$2', [String(client_order_id).slice(0, 120), user.id]);
    } else {
      return apiError(res, 400, 'Provide order_id, txn_ref or client_order_id', 'VALIDATION_ERROR', {
        accepted_fields: ['order_id', 'txn_ref', 'client_order_id'],
      });
    }
    let order = r.rows[0];
    if (!order) return apiError(res, 404, 'Order not found', 'ORDER_NOT_FOUND');

    // Pending → re-verify via gateway, possibly transition through state machine.
    if (order.status === 'pending') {
      const cfg = await getCreds(user.id);
      if (cfg?.paytm_merchant_id && cfg?.paytm_merchant_key) {
        try {
          const verify = await verifyPaytmPayment(
            { merchant_id: cfg.paytm_merchant_id, merchant_key: cfg.paytm_merchant_key, env: cfg.paytm_env },
            order.txn_ref,
            parseFloat(order.amount),
          );
          logOrderEvent({ order_id: order.id, user_id: user.id, event: 'order.verify_attempt', meta: { source: 'check-order' } }).catch(() => {});
          const decision = classifyVerificationForPoll(verify);
          if (decision === 'paid') {
            const t = await transitionOrder({
              orderId: order.id,
              to: 'paid',
              fields: {
                gateway_txn_id: verify.txn_id || null,
                gateway_bank_txn_id: verify.bank_txn_id || null,
                raw_gateway_response: JSON.stringify(verify.raw || {}).slice(0, 4000),
              },
              event: 'order.verify_paid',
              meta: { source: 'check-order' },
            });
            if (t.changed && t.row) {
              order = t.row;
              sendOrderCallback(order.id).catch(() => {});
            }
          } else if (decision === 'failed') {
            const t = await transitionOrder({
              orderId: order.id,
              to: 'failed',
              fields: { raw_gateway_response: JSON.stringify(verify.raw || {}).slice(0, 4000) },
              event: 'order.verify_failed',
              meta: { source: 'check-order' },
            });
            if (t.changed && t.row) order = t.row;
          }
        } catch {
          /* network/gateway hiccup — never terminalize, just keep waiting */
        }
      }
      // Expiry catch-up
      if (order.status === 'pending' && isOrderExpiredAt(order.expires_at)) {
        const t = await transitionOrder({
          orderId: order.id,
          to: 'expired',
          event: 'order.expired',
          meta: { source: 'check-order' },
        });
        if (t.changed && t.row) order = t.row;
      }
    }

    // Retry callback if paid but not yet successfully delivered
    if (order.status === 'paid' && order.callback_url && !order.callback_sent) {
      sendOrderCallback(order.id).catch(() => {});
    }

    // Push to any open hosted page
    const cfgForShape = await loadMerchant(user.id).catch(() => null);
    publishOrderSnapshot(order.public_token, shapeOrder(order, cfgForShape));

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
      callback_attempts: order.callback_attempts || 0,
    });
  } catch (e) {
    console.error('[gw/check-order]', e);
    apiError(res, 500, 'Failed to check order', 'CHECK_ORDER_FAILED');
  }
}

router.all('/create-order', methodNotAllowed(['POST']));
router.all('/check-order', methodNotAllowed(['GET', 'POST']));

export default router;
