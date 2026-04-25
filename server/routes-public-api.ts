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
  parseCancelUrlShape,
  parseIdempotencyKey,
} from './validation';
import { rateLimit } from './rate-limit';
import { transitionOrder, isOrderExpiredAt } from './order-state';
import { logOrderEvent } from './audit';
import { shapeOrder, loadMerchant } from './order-pay-helpers';
import { canAccessMethod, OrderMode } from './authz';

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

/**
 * Shape an order for the JSON API response.
 *
 * Server-mode orders return raw UPI payload only — no hosted page URL,
 * no public_token, no redirect/cancel URLs. Those are Hosted Page fields.
 *
 * Hosted-mode orders return payment_page_url, public_token, qr_image_url,
 * redirect_url, cancel_url — but never expose the raw UPI payload (the
 * merchant doesn't render the QR themselves; our hosted page does).
 */
function shapeOrderForApi(o: any, baseReq?: { protocol: string; get: (h: string) => string | undefined }) {
  const mode: OrderMode = (o.order_mode === 'server' ? 'server' : 'hosted');

  if (mode === 'server') {
    return {
      order_id: o.id,
      txn_ref: o.txn_ref,
      client_order_id: o.client_order_id || undefined,
      amount: parseFloat(o.amount),
      currency: o.currency,
      status: o.status,
      mode,
      payment_link: o.upi_payload,
      upi_payload: o.upi_payload,
      callback_url: o.callback_url || undefined,
      created_at: o.created_at,
      expires_at: o.expires_at,
    };
  }

  // hosted — never expose raw upi_payload
  const paymentPageUrl = baseReq && o.public_token ? buildPaymentPageUrl(baseReq, o.public_token) : undefined;
  return {
    order_id: o.id,
    txn_ref: o.txn_ref,
    client_order_id: o.client_order_id || undefined,
    amount: parseFloat(o.amount),
    currency: o.currency,
    status: o.status,
    mode,
    public_token: o.public_token,
    payment_page_url: paymentPageUrl,
    qr_image_url: o.public_token ? `/api/pay/${o.public_token}/qr.png?size=2048` : undefined,
    redirect_url: o.redirect_url || undefined,
    cancel_url: o.cancel_url || undefined,
    callback_url: o.callback_url || undefined,
    created_at: o.created_at,
    expires_at: o.expires_at,
  };
}

/* -------------------------------------------------------------------------- */
/* POST /create-order                                                          */
/* -------------------------------------------------------------------------- */

router.post('/create-order', gwApiToken, createOrderLimiter, async (req: GwApiRequest, res: Response) => {
  try {
    const user = req.gwUser!;

    // ---- mode (server | hosted) ----
    const rawMode = String(req.body.mode || '').trim().toLowerCase();
    if (!rawMode) {
      return apiError(res, 400, 'mode is required (use "server" or "hosted")', 'ORDER_MODE_REQUIRED', { field: 'mode' });
    }
    if (rawMode !== 'server' && rawMode !== 'hosted') {
      return apiError(res, 400, 'mode must be "server" or "hosted"', 'VALIDATION_ERROR', { field: 'mode' });
    }
    const mode: OrderMode = rawMode;

    // Enforce plan access (owner is exempt inside canAccessMethod).
    const access = await canAccessMethod(user, mode);
    if (!access.allowed) {
      return apiError(res, 403, access.reason || 'Feature not available on your plan.', access.code || 'PLAN_FEATURE_LOCKED');
    }

    // Hosted-only fields (redirect_url, cancel_url) are blocked when mode="server".
    // These are browser redirect URLs that only make sense on the hosted checkout page.
    // Reject them regardless of plan so the API is always consistent.
    if (mode === 'server') {
      const hasRedirect = req.body.redirect_url !== undefined && req.body.redirect_url !== null && req.body.redirect_url !== '';
      const hasCancel   = req.body.cancel_url   !== undefined && req.body.cancel_url   !== null && req.body.cancel_url   !== '';
      if (hasRedirect || hasCancel) {
        return apiError(
          res, 403,
          'redirect_url and cancel_url are available only with Hosted Pay Page plans.',
          'PLAN_FEATURE_LOCKED',
          { blocked_fields: [...(hasRedirect ? ['redirect_url'] : []), ...(hasCancel ? ['cancel_url'] : [])] },
        );
      }
    }

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

    const cnP = parseCancelUrlShape(req.body.cancel_url);
    if (!cnP.ok) return apiError(res, 400, cnP.err.message, cnP.err.code, { field: cnP.err.field });

    const idemRaw = (req.headers['idempotency-key'] as string | undefined) ?? req.body.idempotency_key;
    const idemP = parseIdempotencyKey(idemRaw);
    if (!idemP.ok) return apiError(res, 400, idemP.err.message, idemP.err.code, { field: idemP.err.field });

    const amount = amountP.value;
    const client_order_id = cliP.value;
    const customer_reference = custP.value;
    const note = noteP.value;
    const callback_url = cbP.value;
    const redirect_url = rdP.value;
    const cancel_url = cnP.value;
    const idempotencyKey = idemP.value;

    const cfg = await getCreds(user.id);
    if (!cfg || !cfg.is_active || !cfg.paytm_upi_id || !cfg.paytm_merchant_id || !cfg.paytm_merchant_key) {
      return apiError(res, 412, 'Gateway not configured. Save UPI settings first.', 'SETTINGS_MISSING');
    }

    // ---- Idempotency: same key + same fingerprint = return existing order ----
    // redirect_url and cancel_url are part of the fingerprint so reusing the
    // same key with a different post-payment redirect target is treated as
    // IDEMPOTENCY_CONFLICT (avoids silently routing customers somewhere new).
    const fingerprint = fingerprintRequest({ amount, currency, client_order_id, callback_url, redirect_url, cancel_url, customer_reference, note });

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
            callback_url, redirect_url, cancel_url, upi_payload, payment_link, public_token, expires_at,
            idempotency_key, idempotency_fingerprint, order_mode)
         VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11,$11,$12,
                 NOW() + INTERVAL '${ORDER_TTL_MIN} minutes',
                 $13,$14,$15)
         RETURNING *`,
        [user.id, client_order_id, txnRef, amount.toFixed(2), currency, note, customer_reference,
         callback_url, redirect_url, cancel_url, upiPayload, publicToken, idempotencyKey, idempotencyKey ? fingerprint : null, mode],
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
      meta: { mode, has_callback: !!callback_url, has_redirect: !!redirect_url, has_cancel: !!cancel_url, idempotent: !!idempotencyKey },
    }).catch(() => {});

    apiSuccess(res, 'Order created', shapeOrderForApi(order, req));
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
      mode: (order.order_mode === 'server' ? 'server' : 'hosted'),
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
