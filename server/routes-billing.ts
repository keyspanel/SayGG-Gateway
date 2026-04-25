import express, { Request, Response } from 'express';
import crypto from 'crypto';
import pool from './db';
import { gwSession, GwSessionRequest } from './auth-mw';
import { apiError, apiSuccess, methodNotAllowed } from './api-response';
import { getActiveSubscription, getPlatformSettings, isPlatformConfigured, isOwner } from './authz';
import { buildUniqueTxnRef, buildUpiPayload } from './paytm';
import { rateLimit } from './rate-limit';
import { isValidPublicToken } from './validation';
import { refreshSubscriptionOrder } from './billing-verify';

const router = express.Router();

const SUB_TTL_MIN = 30;

function genPublicToken(): string {
  return 'BILL_' + crypto.randomBytes(16).toString('base64url');
}

function shapePlan(p: any) {
  return {
    id: p.id,
    plan_key: p.plan_key,
    name: p.name,
    method_access: p.method_access,
    duration_days: p.duration_days,
    price: parseFloat(p.price),
    discount_price: p.discount_price !== null ? parseFloat(p.discount_price) : null,
    effective_price: parseFloat(p.discount_price ?? p.price),
    currency: p.currency,
    is_active: !!p.is_active,
    is_featured: !!p.is_featured,
    sort_order: p.sort_order,
    description: p.description,
    features: Array.isArray(p.features) ? p.features : (typeof p.features === 'string' ? JSON.parse(p.features) : []),
  };
}

function shapeSubscriptionOrder(o: any, includeUpi = false) {
  const isTerminal = ['paid', 'failed', 'expired', 'cancelled'].includes(o.status);
  const out: any = {
    id: o.id,
    txn_ref: o.txn_ref,
    public_token: o.public_token,
    amount: parseFloat(o.amount),
    currency: o.currency,
    status: o.status,
    plan_id: o.plan_id,
    plan_key: o.plan_key,
    plan_name: o.plan_name,
    expires_at: o.expires_at,
    paid_at: o.paid_at,
    created_at: o.created_at,
    is_terminal: isTerminal,
    activated_subscription_id: o.activated_subscription_id,
    bank_rrn: o.bank_rrn || o.gateway_bank_txn_id,
  };
  if (includeUpi) {
    out.upi_payload = o.upi_payload;
    out.payment_link = o.payment_link || o.upi_payload;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Public: list plans                                                          */
/* -------------------------------------------------------------------------- */

router.get('/plans', async (_req: Request, res: Response) => {
  const r = await pool.query(`SELECT * FROM gw_plans WHERE is_active=TRUE ORDER BY sort_order ASC, id ASC`);
  apiSuccess(res, 'Plans loaded', { items: r.rows.map(shapePlan) });
});

/* -------------------------------------------------------------------------- */
/* Authenticated: my subscriptions + history                                   */
/* -------------------------------------------------------------------------- */

router.get('/me', gwSession, async (req: GwSessionRequest, res: Response) => {
  const user = req.gwUser!;
  const sub = await getActiveSubscription(user.id);
  const history = await pool.query(
    `SELECT s.id, s.plan_id, s.method_access, s.status, s.starts_at, s.expires_at, s.created_at,
            p.plan_key, p.name AS plan_name
       FROM gw_user_subscriptions s
       JOIN gw_plans p ON p.id=s.plan_id
      WHERE s.user_id=$1
      ORDER BY s.id DESC LIMIT 20`,
    [user.id],
  );
  const orders = await pool.query(
    `SELECT s.id, s.txn_ref, s.amount, s.currency, s.status, s.public_token, s.created_at, s.paid_at,
            p.plan_key, p.name AS plan_name
       FROM gw_subscription_orders s
       JOIN gw_plans p ON p.id=s.plan_id
      WHERE s.user_id=$1
      ORDER BY s.id DESC LIMIT 20`,
    [user.id],
  );
  apiSuccess(res, 'Billing summary loaded', {
    is_owner: isOwner(user),
    active_subscription: sub,
    history: history.rows,
    recent_orders: orders.rows,
  });
});

/* -------------------------------------------------------------------------- */
/* Purchase: create a subscription order                                       */
/* -------------------------------------------------------------------------- */

const purchaseLimiter = rateLimit({
  name: 'billing_purchase',
  windowMs: 60_000,
  max: 10,
  scope: (req) => String((req as GwSessionRequest).gwUser?.id || ''),
  message: 'Too many purchase attempts. Please slow down.',
  code: 'RATE_LIMITED',
});

router.post('/purchase', gwSession, purchaseLimiter, async (req: GwSessionRequest, res: Response) => {
  const user = req.gwUser!;
  const planId = parseInt(String(req.body?.plan_id), 10);
  if (!planId) return apiError(res, 400, 'plan_id required', 'VALIDATION_ERROR', { field: 'plan_id' });

  const p = await pool.query('SELECT * FROM gw_plans WHERE id=$1', [planId]);
  const plan = p.rows[0];
  if (!plan) return apiError(res, 404, 'Plan not found', 'PLAN_NOT_FOUND');
  if (!plan.is_active) return apiError(res, 400, 'This plan is not currently available', 'PLAN_INACTIVE');

  const platform = await getPlatformSettings();
  if (!isPlatformConfigured(platform)) {
    return apiError(res, 503, 'Owner has not configured platform UPI yet. Try again later.', 'PLATFORM_PAYMENT_NOT_CONFIGURED');
  }

  // Reuse any existing pending order for the same plan in the last hour to
  // avoid spawning duplicate links if the user clicks multiple times.
  const existing = await pool.query(
    `SELECT s.*, p.plan_key, p.name AS plan_name
       FROM gw_subscription_orders s
       JOIN gw_plans p ON p.id=s.plan_id
      WHERE s.user_id=$1 AND s.plan_id=$2 AND s.status='pending'
        AND s.expires_at > NOW()
      ORDER BY s.id DESC LIMIT 1`,
    [user.id, planId],
  );
  if (existing.rows[0]) {
    return apiSuccess(res, 'Existing pending order returned', shapeSubscriptionOrder(existing.rows[0], true));
  }

  const amount = parseFloat(plan.discount_price ?? plan.price);
  if (!isFinite(amount) || amount < 0) return apiError(res, 500, 'Plan price is invalid', 'INTERNAL_ERROR');

  const txnRef = buildUniqueTxnRef('B' + user.id);
  const upiPayload = buildUpiPayload({
    upi_id: platform!.paytm_upi_id!,
    payee_name: platform!.payee_name || 'Platform',
    amount,
    txn_ref: txnRef,
    note: `${plan.name} (${plan.plan_key})`,
  });

  let token = genPublicToken();
  for (let i = 0; i < 4; i++) {
    const ex = await pool.query('SELECT 1 FROM gw_subscription_orders WHERE public_token=$1 LIMIT 1', [token]);
    if (!ex.rows[0]) break;
    token = genPublicToken();
  }

  const ins = await pool.query(
    `INSERT INTO gw_subscription_orders (user_id, plan_id, txn_ref, public_token, amount, currency, status,
                                         payment_link, upi_payload, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$7,NOW() + ($8 || ' minutes')::interval)
     RETURNING *`,
    [user.id, plan.id, txnRef, token, amount.toFixed(2), plan.currency || 'INR', upiPayload, String(SUB_TTL_MIN)],
  );
  const order = { ...ins.rows[0], plan_key: plan.plan_key, plan_name: plan.name };
  apiSuccess(res, 'Plan order created', shapeSubscriptionOrder(order, true), 201);
});

/* -------------------------------------------------------------------------- */
/* Public hosted plan-pay page (by token)                                      */
/* -------------------------------------------------------------------------- */

const billGetLimiter = rateLimit({
  name: 'bill_get', windowMs: 60_000, max: 120,
  message: 'Too many requests', code: 'RATE_LIMITED',
});
const billRefreshLimiter = rateLimit({
  name: 'bill_refresh', windowMs: 60_000, max: 30,
  message: 'Too many refresh requests', code: 'RATE_LIMITED',
});

function billTokenGuard(req: Request, res: Response, next: express.NextFunction) {
  const t = req.params.token || '';
  // Same charset rules as merchant tokens but slightly longer prefix allowed.
  if (!isValidPublicToken(t.replace(/^BILL_/, ''))) {
    apiError(res, 404, 'Plan payment link not found', 'PAYMENT_NOT_FOUND');
    return;
  }
  next();
}

async function loadPlanOrderByToken(token: string) {
  const r = await pool.query(
    `SELECT s.*, p.plan_key, p.name AS plan_name, p.method_access, p.duration_days,
            ps.payee_name AS platform_payee_name
       FROM gw_subscription_orders s
       JOIN gw_plans p ON p.id=s.plan_id
       LEFT JOIN gw_platform_settings ps ON TRUE
      WHERE s.public_token=$1
      ORDER BY ps.id ASC
      LIMIT 1`,
    [token],
  );
  return r.rows[0] || null;
}

router.get('/pay/:token', billTokenGuard, billGetLimiter, async (req: Request, res: Response) => {
  let order = await loadPlanOrderByToken(req.params.token);
  if (!order) return apiError(res, 404, 'Plan payment link not found', 'PAYMENT_NOT_FOUND');

  // Auto-expire passive
  if (order.status === 'pending' && order.expires_at && new Date(order.expires_at).getTime() < Date.now()) {
    await pool.query(`UPDATE gw_subscription_orders SET status='expired', updated_at=NOW() WHERE id=$1 AND status='pending'`, [order.id]);
    order = await loadPlanOrderByToken(req.params.token);
  }

  apiSuccess(res, 'Plan order loaded', {
    ...shapeSubscriptionOrder(order, true),
    plan: { plan_key: order.plan_key, name: order.plan_name, method_access: order.method_access, duration_days: order.duration_days },
    payee_name: order.platform_payee_name || 'Platform',
  });
});

router.post('/pay/:token/refresh', billTokenGuard, billRefreshLimiter, async (req: Request, res: Response) => {
  const order = await loadPlanOrderByToken(req.params.token);
  if (!order) return apiError(res, 404, 'Plan payment link not found', 'PAYMENT_NOT_FOUND');

  await refreshSubscriptionOrder(order.id);
  const fresh = await loadPlanOrderByToken(req.params.token);
  if (!fresh) return apiError(res, 404, 'Plan payment link not found', 'PAYMENT_NOT_FOUND');
  apiSuccess(res, 'Plan order refreshed', {
    ...shapeSubscriptionOrder(fresh, true),
    plan: { plan_key: fresh.plan_key, name: fresh.plan_name, method_access: fresh.method_access, duration_days: fresh.duration_days },
    payee_name: fresh.platform_payee_name || 'Platform',
  });
});

/* -------------------------------------------------------------------------- */
/* Auth: my single purchase by id                                              */
/* -------------------------------------------------------------------------- */

router.get('/purchase/:id', gwSession, async (req: GwSessionRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return apiError(res, 400, 'Invalid id', 'VALIDATION_ERROR');
  const r = await pool.query(
    `SELECT s.*, p.plan_key, p.name AS plan_name
       FROM gw_subscription_orders s JOIN gw_plans p ON p.id=s.plan_id
      WHERE s.id=$1 AND s.user_id=$2`,
    [id, req.gwUser!.id],
  );
  if (!r.rows[0]) return apiError(res, 404, 'Purchase not found', 'NOT_FOUND');
  apiSuccess(res, 'Purchase loaded', shapeSubscriptionOrder(r.rows[0], true));
});

router.all('/plans', methodNotAllowed(['GET']));
router.all('/me', methodNotAllowed(['GET']));
router.all('/purchase', methodNotAllowed(['POST']));
router.all('/purchase/:id', methodNotAllowed(['GET']));
router.all('/pay/:token', methodNotAllowed(['GET']));
router.all('/pay/:token/refresh', methodNotAllowed(['POST']));

export default router;
