import express, { Response } from 'express';
import pool from './db';
import { gwSession, GwSessionRequest } from './auth-mw';
import { requireOwner, getActiveSubscription, getPlatformSettings, isPlatformConfigured } from './authz';
import { apiError, apiSuccess, methodNotAllowed } from './api-response';
import { verifyPaytmPayment, classifyVerificationForPoll } from './paytm';

const router = express.Router();

// Every route in this router requires owner privileges.
router.use(gwSession, requireOwner);

const PLAN_KEY_RE = /^[a-z0-9_\-]{2,64}$/;
const METHOD_ACCESS = new Set(['server', 'hosted', 'master']);

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

async function safeQuery<T>(sql: string, fallback: T, label: string, params: any[] = []): Promise<T> {
  try {
    const r = await pool.query(sql, params);
    return (r.rows[0] ?? fallback) as T;
  } catch (e) {
    console.error(`[owner overview] query failed (${label}):`, (e as Error).message);
    return fallback;
  }
}
async function safeRows<T>(sql: string, fallback: T[], label: string, params: any[] = []): Promise<T[]> {
  try {
    const r = await pool.query(sql, params);
    return (r.rows ?? fallback) as T[];
  } catch (e) {
    console.error(`[owner overview] query failed (${label}):`, (e as Error).message);
    return fallback;
  }
}

router.get('/overview', async (_req, res: Response) => {
  try {
    const usersDefault  = { total: 0, owners: 0, active: 0 };
    const plansDefault  = { total: 0, active: 0 };
    const subsDefault   = { active: 0, expired: 0 };
    const ordersDefault = {
      total: 0, paid: 0, pending: 0,
      revenue: 0, today_revenue: 0, month_revenue: 0,
    };

    const [users, subs, plans, ordersAgg, merchantTotalRow, platRow, recentUsers, recentOrders] =
      await Promise.all([
        safeQuery(
          `SELECT
             COUNT(*)::int                                            AS total,
             COUNT(*) FILTER (WHERE role='owner')::int                AS owners,
             COUNT(*) FILTER (WHERE COALESCE(is_active,TRUE))::int    AS active
           FROM gw_users`,
          usersDefault, 'users',
        ),
        safeQuery(
          `SELECT
             COUNT(*) FILTER (
               WHERE status='active' AND (expires_at IS NULL OR expires_at > NOW())
             )::int AS active,
             COUNT(*) FILTER (
               WHERE status='expired'
                  OR (status='active' AND expires_at IS NOT NULL AND expires_at <= NOW())
             )::int AS expired
           FROM gw_user_subscriptions`,
          subsDefault, 'subscriptions',
        ),
        safeQuery(
          `SELECT
             COUNT(*)::int                                       AS total,
             COUNT(*) FILTER (WHERE is_active=TRUE)::int         AS active
           FROM gw_plans`,
          plansDefault, 'plans',
        ),
        safeQuery(
          `SELECT
             COUNT(*)::int                                                                AS total,
             COUNT(*) FILTER (WHERE status='paid')::int                                   AS paid,
             COUNT(*) FILTER (WHERE status='pending')::int                                AS pending,
             COALESCE(SUM(amount) FILTER (WHERE status='paid'),0)::float                  AS revenue,
             COALESCE(SUM(amount) FILTER (
               WHERE status='paid' AND paid_at >= date_trunc('day', NOW())
             ),0)::float                                                                  AS today_revenue,
             COALESCE(SUM(amount) FILTER (
               WHERE status='paid' AND paid_at >= date_trunc('month', NOW())
             ),0)::float                                                                  AS month_revenue
           FROM gw_subscription_orders`,
          ordersDefault, 'plan_orders',
        ),
        safeQuery<{ total: number }>(
          `SELECT COUNT(*)::int AS total FROM gw_orders`,
          { total: 0 }, 'merchant_orders',
        ),
        safeQuery<{ id: number; is_active: boolean | null; paytm_upi_id: string | null; paytm_merchant_id: string | null; paytm_merchant_key: string | null; paytm_env: string | null; payee_name: string | null } | { id: 0; is_active: null; paytm_upi_id: null; paytm_merchant_id: null; paytm_merchant_key: null; paytm_env: null; payee_name: null }>(
          `SELECT id, is_active, paytm_upi_id, paytm_merchant_id, paytm_merchant_key, paytm_env, payee_name
             FROM gw_platform_settings ORDER BY id ASC LIMIT 1`,
          { id: 0, is_active: null, paytm_upi_id: null, paytm_merchant_id: null, paytm_merchant_key: null, paytm_env: null, payee_name: null },
          'platform_settings',
        ),
        safeRows(
          `SELECT id, username, email, role, is_active, created_at
             FROM gw_users ORDER BY id DESC LIMIT 5`,
          [], 'recent_users',
        ),
        safeRows(
          `SELECT s.id, s.txn_ref, s.amount, s.status, s.created_at, s.user_id,
                  u.username, p.name AS plan_name, p.plan_key
             FROM gw_subscription_orders s
             JOIN gw_users u ON u.id = s.user_id
             JOIN gw_plans p ON p.id = s.plan_id
            ORDER BY s.id DESC LIMIT 5`,
          [], 'recent_plan_orders',
        ),
      ]);

    const platformConfigured = !!(
      platRow && platRow.id && platRow.paytm_upi_id && platRow.paytm_merchant_id && platRow.paytm_merchant_key
    );

    apiSuccess(res, 'Owner overview loaded', {
      // Object-shaped (current frontend uses these)
      users,
      plans,
      plan_orders: ordersAgg,
      active_subscriptions: subs.active,
      expired_subscriptions: subs.expired,
      merchant_orders_total: merchantTotalRow.total,
      platform_payment_configured: platformConfigured,
      recent_users: recentUsers,
      recent_plan_orders: recentOrders,

      // Flat-shaped mirror (matches the documented owner overview spec)
      total_users:           users.total,
      active_users:          users.active,
      total_plans:           plans.total,
      active_plans:          plans.active,
      pending_plan_orders:   ordersAgg.pending,
      paid_plan_orders:      ordersAgg.paid,
      today_revenue:         ordersAgg.today_revenue,
      month_revenue:         ordersAgg.month_revenue,
      total_revenue:         ordersAgg.revenue,
    });
  } catch (err) {
    console.error('[owner overview] failed', err);
    return apiError(res, 500, 'Unable to load owner overview.', 'OWNER_OVERVIEW_FAILED');
  }
});

/* -------------------------------------------------------------------------- */
/* Plans                                                                       */
/* -------------------------------------------------------------------------- */

router.get('/plans', async (_req, res: Response) => {
  const r = await pool.query(`SELECT * FROM gw_plans ORDER BY sort_order ASC, id ASC`);
  apiSuccess(res, 'Plans loaded', { items: r.rows });
});

function readPlanBody(body: any) {
  const errs: string[] = [];
  const plan_key = String(body.plan_key || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const method_access = String(body.method_access || '').trim().toLowerCase();
  const duration_days = parseInt(String(body.duration_days), 10);
  const price = parseFloat(String(body.price));
  const dpRaw = body.discount_price === '' || body.discount_price == null ? null : parseFloat(String(body.discount_price));
  const description = body.description == null ? null : String(body.description).trim().slice(0, 1000);
  const is_active = body.is_active === undefined ? true : !!body.is_active;
  const is_featured = !!body.is_featured;
  const sort_order = Number.isFinite(parseInt(String(body.sort_order), 10)) ? parseInt(String(body.sort_order), 10) : 0;
  const features = Array.isArray(body.features) ? body.features.map((s: any) => String(s).slice(0, 200)).slice(0, 30) : [];

  if (!PLAN_KEY_RE.test(plan_key)) errs.push('plan_key must be 2-64 chars, lowercase a-z 0-9 _ -');
  if (!name || name.length > 120) errs.push('name 1-120 chars');
  if (!METHOD_ACCESS.has(method_access)) errs.push('method_access must be server | hosted | master');
  if (!Number.isInteger(duration_days) || duration_days < 1 || duration_days > 3650) errs.push('duration_days 1-3650');
  if (!isFinite(price) || price < 0) errs.push('price must be >= 0');
  if (dpRaw !== null && (!isFinite(dpRaw) || dpRaw < 0)) errs.push('discount_price must be >= 0');
  return {
    errs,
    plan_key, name, method_access, duration_days, price,
    discount_price: dpRaw, description, is_active, is_featured, sort_order, features,
  };
}

router.post('/plans', async (req, res: Response) => {
  const p = readPlanBody(req.body || {});
  if (p.errs.length) return apiError(res, 400, p.errs.join('; '), 'VALIDATION_ERROR', { errors: p.errs });
  try {
    const r = await pool.query(
      `INSERT INTO gw_plans (plan_key, name, method_access, duration_days, price, discount_price, currency,
                             is_active, is_featured, sort_order, description, features, limits)
       VALUES ($1,$2,$3,$4,$5,$6,'INR',$7,$8,$9,$10,$11::jsonb,'{}'::jsonb)
       RETURNING *`,
      [p.plan_key, p.name, p.method_access, p.duration_days, p.price.toFixed(2),
       p.discount_price !== null ? p.discount_price.toFixed(2) : null,
       p.is_active, p.is_featured, p.sort_order, p.description, JSON.stringify(p.features)],
    );
    apiSuccess(res, 'Plan created', r.rows[0], 201);
  } catch (e: any) {
    if (e?.code === '23505') return apiError(res, 409, 'plan_key already exists', 'VALIDATION_ERROR', { field: 'plan_key' });
    throw e;
  }
});

router.put('/plans/:id', async (req, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return apiError(res, 400, 'Invalid id', 'VALIDATION_ERROR');
  const p = readPlanBody(req.body || {});
  if (p.errs.length) return apiError(res, 400, p.errs.join('; '), 'VALIDATION_ERROR', { errors: p.errs });
  try {
    const r = await pool.query(
      `UPDATE gw_plans SET
         plan_key=$2, name=$3, method_access=$4, duration_days=$5, price=$6, discount_price=$7,
         is_active=$8, is_featured=$9, sort_order=$10, description=$11, features=$12::jsonb, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id, p.plan_key, p.name, p.method_access, p.duration_days, p.price.toFixed(2),
       p.discount_price !== null ? p.discount_price.toFixed(2) : null,
       p.is_active, p.is_featured, p.sort_order, p.description, JSON.stringify(p.features)],
    );
    if (!r.rows[0]) return apiError(res, 404, 'Plan not found', 'PLAN_NOT_FOUND');
    apiSuccess(res, 'Plan updated', r.rows[0]);
  } catch (e: any) {
    if (e?.code === '23505') return apiError(res, 409, 'plan_key already exists', 'VALIDATION_ERROR', { field: 'plan_key' });
    throw e;
  }
});

router.delete('/plans/:id', async (req, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return apiError(res, 400, 'Invalid id', 'VALIDATION_ERROR');
  // Soft delete (deactivate) so existing subscriptions referencing it stay valid.
  const r = await pool.query(`UPDATE gw_plans SET is_active=FALSE, updated_at=NOW() WHERE id=$1 RETURNING id`, [id]);
  if (!r.rows[0]) return apiError(res, 404, 'Plan not found', 'PLAN_NOT_FOUND');
  apiSuccess(res, 'Plan deactivated', { id });
});

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

router.get('/users', async (req, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
  const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);
  const q = String(req.query.q || '').trim().slice(0, 80);
  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (q) {
    const safe = q.replace(/[\\%_]/g, (c) => '\\' + c);
    params.push('%' + safe + '%');
    where.push(`(LOWER(username) ILIKE LOWER($${params.length}) ESCAPE '\\' OR LOWER(email) ILIKE LOWER($${params.length}) ESCAPE '\\')`);
  }
  const rows = await pool.query(
    `SELECT u.id, u.username, u.email, u.role, u.is_active, u.status, u.created_at, u.last_seen_at,
            u.api_token IS NOT NULL AS has_token,
            (SELECT json_build_object('plan_key', p.plan_key, 'plan_name', p.name, 'method_access', s.method_access,
                                      'expires_at', s.expires_at, 'starts_at', s.starts_at, 'status', s.status)
               FROM gw_user_subscriptions s
               JOIN gw_plans p ON p.id=s.plan_id
              WHERE s.user_id=u.id AND s.status='active' AND (s.expires_at IS NULL OR s.expires_at > NOW())
              ORDER BY s.expires_at DESC NULLS LAST LIMIT 1) AS active_subscription,
            (SELECT COUNT(*)::int FROM gw_orders o WHERE o.user_id=u.id) AS orders_count,
            (SELECT json_build_object(
                      'full_name', bp.full_name,
                      'email', bp.email,
                      'phone', bp.phone,
                      'country', bp.country,
                      'address_line1', bp.address_line1,
                      'address_line2', bp.address_line2,
                      'city', bp.city,
                      'state', bp.state,
                      'postal_code', bp.postal_code,
                      'tax_id', bp.tax_id,
                      'updated_at', bp.updated_at)
               FROM gw_billing_profiles bp WHERE bp.user_id=u.id) AS billing_profile
       FROM gw_users u
      WHERE ${where.join(' AND ')}
      ORDER BY u.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const c = await pool.query(`SELECT COUNT(*)::int AS n FROM gw_users u WHERE ${where.join(' AND ')}`, params);
  apiSuccess(res, 'Users loaded', { items: rows.rows, total: c.rows[0].n, limit, offset });
});

router.patch('/users/:id', async (req: GwSessionRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return apiError(res, 400, 'Invalid id', 'VALIDATION_ERROR');

  const body = req.body || {};
  const sets: string[] = [];
  const params: any[] = [];
  let p = 1;

  if (body.role !== undefined) {
    const role = String(body.role).toLowerCase();
    if (!['owner', 'user'].includes(role)) return apiError(res, 400, 'role must be owner|user', 'VALIDATION_ERROR', { field: 'role' });
    if (role !== 'owner' && id === req.gwUser!.id) {
      return apiError(res, 400, 'You cannot demote yourself', 'VALIDATION_ERROR');
    }
    sets.push(`role=$${p++}`); params.push(role);
  }
  if (body.is_active !== undefined) {
    if (id === req.gwUser!.id && !body.is_active) {
      return apiError(res, 400, 'You cannot deactivate yourself', 'VALIDATION_ERROR');
    }
    sets.push(`is_active=$${p++}`); params.push(!!body.is_active);
  }
  if (!sets.length) return apiError(res, 400, 'No fields to update', 'VALIDATION_ERROR');

  params.push(id);
  const r = await pool.query(
    `UPDATE gw_users SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${p} RETURNING id, username, email, role, is_active`,
    params,
  );
  if (!r.rows[0]) return apiError(res, 404, 'User not found', 'NOT_FOUND');
  apiSuccess(res, 'User updated', r.rows[0]);
});

/* -------------------------------------------------------------------------- */
/* Subscriptions (grant / extend / revoke)                                     */
/* -------------------------------------------------------------------------- */

router.post('/users/:id/subscriptions', async (req: GwSessionRequest, res: Response) => {
  const userId = parseInt(req.params.id, 10);
  if (!userId) return apiError(res, 400, 'Invalid id', 'VALIDATION_ERROR');
  const planId = parseInt(String(req.body?.plan_id), 10);
  if (!planId) return apiError(res, 400, 'plan_id required', 'VALIDATION_ERROR', { field: 'plan_id' });
  const days = req.body?.days_override !== undefined ? parseInt(String(req.body.days_override), 10) : null;
  const notes = req.body?.notes ? String(req.body.notes).slice(0, 500) : null;

  const u = await pool.query('SELECT id FROM gw_users WHERE id=$1', [userId]);
  if (!u.rows[0]) return apiError(res, 404, 'User not found', 'NOT_FOUND');
  const p = await pool.query('SELECT id, plan_key, method_access, duration_days FROM gw_plans WHERE id=$1', [planId]);
  if (!p.rows[0]) return apiError(res, 404, 'Plan not found', 'PLAN_NOT_FOUND');

  const duration = days && Number.isInteger(days) && days > 0 ? days : p.rows[0].duration_days;
  const r = await pool.query(
    `INSERT INTO gw_user_subscriptions (user_id, plan_id, method_access, status, starts_at, expires_at, granted_by_user_id, notes)
     VALUES ($1,$2,$3,'active',NOW(),NOW() + ($4 || ' days')::interval, $5, $6)
     RETURNING *`,
    [userId, planId, p.rows[0].method_access, String(duration), req.gwUser!.id, notes],
  );
  apiSuccess(res, 'Subscription granted', r.rows[0], 201);
});

router.post('/subscriptions/:id/extend', async (req, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return apiError(res, 400, 'Invalid id', 'VALIDATION_ERROR');
  const days = parseInt(String(req.body?.days), 10);
  if (!Number.isInteger(days) || days < 1 || days > 3650) return apiError(res, 400, 'days 1-3650', 'VALIDATION_ERROR');
  const r = await pool.query(
    `UPDATE gw_user_subscriptions
        SET expires_at = COALESCE(expires_at, NOW()) + ($2 || ' days')::interval,
            status='active', updated_at=NOW()
      WHERE id=$1 RETURNING *`,
    [id, String(days)],
  );
  if (!r.rows[0]) return apiError(res, 404, 'Subscription not found', 'NOT_FOUND');
  apiSuccess(res, 'Subscription extended', r.rows[0]);
});

router.delete('/subscriptions/:id', async (req, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return apiError(res, 400, 'Invalid id', 'VALIDATION_ERROR');
  const r = await pool.query(
    `UPDATE gw_user_subscriptions SET status='revoked', updated_at=NOW() WHERE id=$1 RETURNING *`,
    [id],
  );
  if (!r.rows[0]) return apiError(res, 404, 'Subscription not found', 'NOT_FOUND');
  apiSuccess(res, 'Subscription revoked', r.rows[0]);
});

/* -------------------------------------------------------------------------- */
/* Plan orders (subscription purchase orders)                                  */
/* -------------------------------------------------------------------------- */

router.get('/plan-orders', async (req, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
  const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);
  const status = String(req.query.status || '').trim();
  const params: any[] = [];
  const where: string[] = ['1=1'];
  if (status && ['pending', 'paid', 'failed', 'expired', 'cancelled'].includes(status)) {
    params.push(status); where.push(`s.status=$${params.length}`);
  }
  const r = await pool.query(
    `SELECT s.id, s.txn_ref, s.amount, s.currency, s.status, s.created_at, s.expires_at, s.paid_at,
            s.gateway_txn_id, s.bank_rrn, s.user_id, s.plan_id, u.username, u.email,
            p.plan_key, p.name AS plan_name, p.method_access
       FROM gw_subscription_orders s
       JOIN gw_users u ON u.id=s.user_id
       JOIN gw_plans p ON p.id=s.plan_id
      WHERE ${where.join(' AND ')}
      ORDER BY s.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const c = await pool.query(`SELECT COUNT(*)::int AS n FROM gw_subscription_orders s WHERE ${where.join(' AND ')}`, params);
  apiSuccess(res, 'Plan orders loaded', { items: r.rows, total: c.rows[0].n, limit, offset });
});

router.post('/plan-orders/:id/refresh', async (req, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return apiError(res, 400, 'Invalid id', 'VALIDATION_ERROR');
  // Reuse billing helper to verify
  const { refreshSubscriptionOrder } = await import('./billing-verify');
  const r = await refreshSubscriptionOrder(id);
  if (!r.ok) return apiError(res, r.status || 500, r.message || 'Refresh failed', r.code || 'INTERNAL_SERVER_ERROR');
  apiSuccess(res, 'Plan order refreshed', r.data!);
});

router.post('/plan-orders/:id/cancel', async (req, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return apiError(res, 400, 'Invalid id', 'VALIDATION_ERROR');
  const r = await pool.query(
    `UPDATE gw_subscription_orders SET status='cancelled', updated_at=NOW()
      WHERE id=$1 AND status='pending' RETURNING *`,
    [id],
  );
  if (!r.rows[0]) return apiError(res, 409, 'Order is not pending or not found', 'INVALID_TRANSITION');
  apiSuccess(res, 'Plan order cancelled', r.rows[0]);
});

/* -------------------------------------------------------------------------- */
/* Platform settings (owner UPI used for plan purchases)                       */
/* -------------------------------------------------------------------------- */

function maskKey(key: string | null | undefined): string {
  if (!key) return '';
  if (key.length <= 6) return '••••••';
  return key.slice(0, 3) + '••••••' + key.slice(-3);
}

router.get('/platform-settings', async (_req, res: Response) => {
  const s = await getPlatformSettings();
  // plan_platform_fee may not be on the cached settings interface; read directly.
  let fee = 0;
  try {
    const r = await pool.query(`SELECT plan_platform_fee FROM gw_platform_settings ORDER BY id ASC LIMIT 1`);
    const v = r.rows[0]?.plan_platform_fee;
    fee = v == null ? 0 : Math.max(0, parseFloat(v) || 0);
  } catch {}
  apiSuccess(res, 'Platform settings loaded', {
    payee_name: s?.payee_name || '',
    paytm_upi_id: s?.paytm_upi_id || '',
    paytm_merchant_id: s?.paytm_merchant_id || '',
    paytm_merchant_key_masked: maskKey(s?.paytm_merchant_key || null),
    has_key: !!s?.paytm_merchant_key,
    paytm_env: s?.paytm_env || 'production',
    is_active: !!s?.is_active,
    plan_platform_fee: fee,
  });
});

const UPI_RE = /^[\w.\-]{2,64}@[\w.\-]{2,64}$/;

router.put('/platform-settings', async (req, res: Response) => {
  const body = req.body || {};
  const upi = String(body.paytm_upi_id || '').trim();
  const mid = String(body.paytm_merchant_id || '').trim();
  const mkeyRaw = String(body.paytm_merchant_key || '').trim();
  const env = String(body.paytm_env || 'production').trim();
  const payee = String(body.payee_name || '').trim();

  if (!upi || !UPI_RE.test(upi)) return apiError(res, 400, 'Valid UPI ID required (e.g. name@bank)', 'VALIDATION_ERROR', { field: 'paytm_upi_id' });
  if (!mid || mid.length > 128) return apiError(res, 400, 'Merchant ID required', 'VALIDATION_ERROR', { field: 'paytm_merchant_id' });
  if (!['production', 'staging'].includes(env)) return apiError(res, 400, 'Invalid env', 'VALIDATION_ERROR', { field: 'paytm_env' });
  if (payee.length > 120) return apiError(res, 400, 'Payee name too long', 'VALIDATION_ERROR', { field: 'payee_name' });

  // Optional plan_platform_fee — defaults to 0, must be a non-negative number.
  let fee = 0;
  if (body.plan_platform_fee !== undefined && body.plan_platform_fee !== null && String(body.plan_platform_fee) !== '') {
    const n = parseFloat(String(body.plan_platform_fee));
    if (!isFinite(n) || n < 0) return apiError(res, 400, 'Fee must be a non-negative number', 'VALIDATION_ERROR', { field: 'plan_platform_fee' });
    if (n > 100000) return apiError(res, 400, 'Fee is unreasonably high (max 100000)', 'VALIDATION_ERROR', { field: 'plan_platform_fee' });
    fee = Math.round(n * 100) / 100;
  }

  const ex = await getPlatformSettings();
  let finalKey = mkeyRaw;
  if (!finalKey) finalKey = ex?.paytm_merchant_key || '';
  if (!finalKey) return apiError(res, 400, 'Merchant key required', 'VALIDATION_ERROR', { field: 'paytm_merchant_key' });
  const isActive = !!(upi && mid && finalKey);

  if (ex) {
    await pool.query(
      `UPDATE gw_platform_settings SET
         payee_name=$1, paytm_upi_id=$2, paytm_merchant_id=$3, paytm_merchant_key=$4,
         paytm_env=$5, is_active=$6, plan_platform_fee=$7, updated_at=NOW() WHERE id=$8`,
      [payee || null, upi, mid, finalKey, env, isActive, fee.toFixed(2), ex.id],
    );
  } else {
    await pool.query(
      `INSERT INTO gw_platform_settings (payee_name, paytm_upi_id, paytm_merchant_id, paytm_merchant_key, paytm_env, is_active, plan_platform_fee)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [payee || null, upi, mid, finalKey, env, isActive, fee.toFixed(2)],
    );
  }
  apiSuccess(res, 'Platform settings saved', { is_active: isActive, plan_platform_fee: fee });
});

/* -------------------------------------------------------------------------- */

router.all('/overview', methodNotAllowed(['GET']));
router.all('/plans', methodNotAllowed(['GET', 'POST']));
router.all('/plans/:id', methodNotAllowed(['PUT', 'DELETE']));
router.all('/users', methodNotAllowed(['GET']));
router.all('/users/:id', methodNotAllowed(['PATCH']));
router.all('/users/:id/subscriptions', methodNotAllowed(['POST']));
router.all('/subscriptions/:id/extend', methodNotAllowed(['POST']));
router.all('/subscriptions/:id', methodNotAllowed(['DELETE']));
router.all('/plan-orders', methodNotAllowed(['GET']));
router.all('/plan-orders/:id/refresh', methodNotAllowed(['POST']));
router.all('/plan-orders/:id/cancel', methodNotAllowed(['POST']));
router.all('/platform-settings', methodNotAllowed(['GET', 'PUT']));

export default router;
