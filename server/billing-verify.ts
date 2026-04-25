/**
 * Subscription order verification + activation.
 *
 * Mirrors the merchant order verification flow but uses the platform-owned
 * Paytm credentials (gw_platform_settings) instead of merchant credentials,
 * and on `paid` activates a gw_user_subscriptions row for the buyer.
 */

import pool from './db';
import { verifyPaytmPayment, classifyVerificationForPoll } from './paytm';
import { getPlatformSettings } from './authz';

export interface RefreshResult {
  ok: boolean;
  status?: number;
  message?: string;
  code?: string;
  data?: any;
}

export async function refreshSubscriptionOrder(orderId: number): Promise<RefreshResult> {
  const r = await pool.query(`SELECT s.*, p.duration_days, p.method_access, p.plan_key
                                FROM gw_subscription_orders s
                                JOIN gw_plans p ON p.id=s.plan_id
                               WHERE s.id=$1`, [orderId]);
  const order = r.rows[0];
  if (!order) return { ok: false, status: 404, message: 'Plan order not found', code: 'PAYMENT_NOT_FOUND' };
  if (order.status !== 'pending') {
    return { ok: true, data: { id: order.id, status: order.status, refreshed: false } };
  }

  const cfg = await getPlatformSettings();
  if (!cfg || !cfg.paytm_merchant_id || !cfg.paytm_merchant_key) {
    // Cannot verify — leave pending unless expired
    if (order.expires_at && new Date(order.expires_at).getTime() < Date.now()) {
      const r2 = await pool.query(
        `UPDATE gw_subscription_orders SET status='expired', updated_at=NOW()
          WHERE id=$1 AND status='pending' RETURNING *`,
        [order.id],
      );
      return { ok: true, data: { id: order.id, status: r2.rows[0]?.status || order.status, refreshed: !!r2.rows[0] } };
    }
    return { ok: true, data: { id: order.id, status: 'pending', refreshed: false } };
  }

  let verify;
  try {
    verify = await verifyPaytmPayment(
      { merchant_id: cfg.paytm_merchant_id, merchant_key: cfg.paytm_merchant_key, env: (cfg.paytm_env as any) || 'production' },
      order.txn_ref,
      parseFloat(order.amount),
    );
  } catch {
    return { ok: true, data: { id: order.id, status: 'pending', refreshed: false } };
  }
  const decision = classifyVerificationForPoll(verify);

  if (decision === 'paid') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const upd = await client.query(
        `UPDATE gw_subscription_orders
            SET status='paid', paid_at=NOW(), updated_at=NOW(),
                gateway_txn_id=$2, gateway_bank_txn_id=$3, bank_rrn=$3,
                raw_gateway_response=$4::jsonb
          WHERE id=$1 AND status='pending'
          RETURNING *`,
        [order.id, verify.txn_id || null, verify.bank_txn_id || null, JSON.stringify(verify.raw || {}).slice(0, 8000)],
      );
      const fresh = upd.rows[0] || order;
      let activatedSubId = order.activated_subscription_id || null;
      if (upd.rows[0] && !activatedSubId) {
        const sub = await client.query(
          `INSERT INTO gw_user_subscriptions
             (user_id, plan_id, method_access, status, starts_at, expires_at, purchase_order_id, granted_by_user_id, notes)
           VALUES ($1,$2,$3,'active',NOW(),NOW() + ($4 || ' days')::interval, $5, NULL, 'Auto-activated via plan order')
           RETURNING id`,
          [order.user_id, order.plan_id, order.method_access, String(order.duration_days), order.id],
        );
        activatedSubId = sub.rows[0].id;
        await client.query(
          `UPDATE gw_subscription_orders SET activated_subscription_id=$1, updated_at=NOW() WHERE id=$2`,
          [activatedSubId, order.id],
        );
      }
      await client.query('COMMIT');
      return {
        ok: true,
        data: { id: order.id, status: 'paid', refreshed: !!upd.rows[0], activated_subscription_id: activatedSubId, ...fresh },
      };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      return { ok: false, status: 500, message: 'Activation failed', code: 'INTERNAL_SERVER_ERROR' };
    } finally {
      client.release();
    }
  }

  if (decision === 'failed') {
    const upd = await pool.query(
      `UPDATE gw_subscription_orders SET status='failed', updated_at=NOW(),
              raw_gateway_response=$2::jsonb
        WHERE id=$1 AND status='pending' RETURNING *`,
      [order.id, JSON.stringify(verify.raw || {}).slice(0, 8000)],
    );
    return { ok: true, data: { id: order.id, status: 'failed', refreshed: !!upd.rows[0] } };
  }

  // Expiry catch-up
  if (order.expires_at && new Date(order.expires_at).getTime() < Date.now()) {
    const upd = await pool.query(
      `UPDATE gw_subscription_orders SET status='expired', updated_at=NOW()
        WHERE id=$1 AND status='pending' RETURNING *`,
      [order.id],
    );
    return { ok: true, data: { id: order.id, status: upd.rows[0]?.status || 'pending', refreshed: !!upd.rows[0] } };
  }

  return { ok: true, data: { id: order.id, status: 'pending', refreshed: false } };
}
