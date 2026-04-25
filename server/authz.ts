import { NextFunction, Response } from 'express';
import pool from './db';
import { apiError } from './api-response';
import { GwSessionRequest, GwApiRequest, GwUser } from './auth-mw';

export type MethodFeature = 'server' | 'hosted' | 'master';
export type OrderMode = 'server' | 'hosted';

export interface ActiveSubscription {
  id: number;
  plan_id: number;
  plan_key: string;
  plan_name: string;
  method_access: MethodFeature;
  status: string;
  starts_at: Date;
  expires_at: Date | null;
  days_left: number | null;
}

export function isOwner(user: { role?: string | null } | null | undefined): boolean {
  return !!user && user.role === 'owner';
}

export async function getActiveSubscription(userId: number): Promise<ActiveSubscription | null> {
  const r = await pool.query(
    `SELECT s.id, s.plan_id, s.method_access, s.status, s.starts_at, s.expires_at,
            p.plan_key, p.name AS plan_name
       FROM gw_user_subscriptions s
       JOIN gw_plans p ON p.id = s.plan_id
      WHERE s.user_id = $1
        AND s.status = 'active'
        AND s.starts_at <= NOW()
        AND (s.expires_at IS NULL OR s.expires_at > NOW())
      ORDER BY s.expires_at DESC NULLS LAST, s.id DESC
      LIMIT 1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const expires = row.expires_at ? new Date(row.expires_at) : null;
  const daysLeft = expires
    ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;
  return {
    id: row.id,
    plan_id: row.plan_id,
    plan_key: row.plan_key,
    plan_name: row.plan_name,
    method_access: row.method_access,
    status: row.status,
    starts_at: new Date(row.starts_at),
    expires_at: expires,
    days_left: daysLeft,
  };
}

export interface EffectiveAccess {
  is_owner: boolean;
  active_subscription: ActiveSubscription | null;
  access: { server: boolean; hosted: boolean; master: boolean };
}

export async function getEffectiveAccess(user: GwUser): Promise<EffectiveAccess> {
  if (isOwner(user)) {
    return {
      is_owner: true,
      active_subscription: null,
      access: { server: true, hosted: true, master: true },
    };
  }
  const sub = await getActiveSubscription(user.id);
  if (!sub) {
    return { is_owner: false, active_subscription: null, access: { server: false, hosted: false, master: false } };
  }
  const m = sub.method_access;
  return {
    is_owner: false,
    active_subscription: sub,
    access: {
      server: m === 'server' || m === 'master',
      hosted: m === 'hosted' || m === 'master',
      master: m === 'master',
    },
  };
}

export interface AccessCheck {
  allowed: boolean;
  reason?: string;
  code?: 'PLAN_REQUIRED' | 'PLAN_EXPIRED' | 'PLAN_FEATURE_LOCKED';
}

export async function canAccessMethod(user: GwUser, mode: OrderMode): Promise<AccessCheck> {
  if (isOwner(user)) return { allowed: true };
  const sub = await getActiveSubscription(user.id);
  if (!sub) {
    // Distinguish "never had a plan" vs "had one that expired".
    const ever = await pool.query(
      `SELECT 1 FROM gw_user_subscriptions WHERE user_id=$1 LIMIT 1`,
      [user.id],
    );
    if (ever.rows[0]) {
      return { allowed: false, code: 'PLAN_EXPIRED', reason: 'Your plan has expired. Renew to continue.' };
    }
    return { allowed: false, code: 'PLAN_REQUIRED', reason: 'Choose a plan to continue.' };
  }
  const m = sub.method_access;
  if (m === 'master') return { allowed: true };
  if (m === mode) return { allowed: true };
  const label = mode === 'hosted' ? 'Hosted Pay Page' : 'Server API';
  return {
    allowed: false,
    code: 'PLAN_FEATURE_LOCKED',
    reason: `Your current plan does not include ${label}.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Express middleware                                                          */
/* -------------------------------------------------------------------------- */

export function requireOwner(req: GwSessionRequest, res: Response, next: NextFunction): void {
  const u = req.gwUser;
  if (!u) {
    apiError(res, 401, 'Authentication required', 'AUTH_REQUIRED');
    return;
  }
  if (!isOwner(u)) {
    apiError(res, 403, 'Owner access required', 'OWNER_ONLY');
    return;
  }
  next();
}

export function requireActiveSubscription(req: GwSessionRequest | GwApiRequest, res: Response, next: NextFunction): void {
  const u = req.gwUser;
  if (!u) {
    apiError(res, 401, 'Authentication required', 'AUTH_REQUIRED');
    return;
  }
  if (isOwner(u)) { next(); return; }
  getActiveSubscription(u.id)
    .then((sub) => {
      if (!sub) {
        apiError(res, 402, 'Choose a plan to continue.', 'PLAN_REQUIRED');
        return;
      }
      next();
    })
    .catch(() => {
      apiError(res, 500, 'Plan check failed', 'INTERNAL_SERVER_ERROR');
    });
}

export function requireFeature(feature: MethodFeature) {
  return (req: GwSessionRequest | GwApiRequest, res: Response, next: NextFunction): void => {
    const u = req.gwUser;
    if (!u) {
      apiError(res, 401, 'Authentication required', 'AUTH_REQUIRED');
      return;
    }
    if (isOwner(u)) { next(); return; }
    getActiveSubscription(u.id)
      .then((sub) => {
        if (!sub) {
          apiError(res, 402, 'Choose a plan to continue.', 'PLAN_REQUIRED');
          return;
        }
        const m = sub.method_access;
        const ok = feature === 'master'
          ? m === 'master'
          : (m === 'master' || m === feature);
        if (!ok) {
          const label = feature === 'hosted' ? 'Hosted Pay Page' : feature === 'server' ? 'Server API' : 'this feature';
          apiError(res, 403, `Your current plan does not include ${label}.`, 'PLAN_FEATURE_LOCKED');
          return;
        }
        next();
      })
      .catch(() => {
        apiError(res, 500, 'Plan check failed', 'INTERNAL_SERVER_ERROR');
      });
  };
}

/* -------------------------------------------------------------------------- */
/* Platform settings (owner UPI used for plan purchases)                       */
/* -------------------------------------------------------------------------- */

export interface PlatformSettings {
  id: number;
  payee_name: string | null;
  paytm_upi_id: string | null;
  paytm_merchant_id: string | null;
  paytm_merchant_key: string | null;
  paytm_env: string | null;
  is_active: boolean;
}

export async function getPlatformSettings(): Promise<PlatformSettings | null> {
  const r = await pool.query<PlatformSettings>(
    `SELECT id, payee_name, paytm_upi_id, paytm_merchant_id, paytm_merchant_key,
            paytm_env, is_active
       FROM gw_platform_settings ORDER BY id ASC LIMIT 1`,
  );
  return r.rows[0] || null;
}

export function isPlatformConfigured(s: PlatformSettings | null): boolean {
  return !!(s && s.is_active && s.paytm_upi_id && s.paytm_merchant_id && s.paytm_merchant_key);
}
