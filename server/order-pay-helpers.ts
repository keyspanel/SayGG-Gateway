import pool from './db';
import { verifyPaytmPayment, classifyVerificationForPoll } from './paytm';
import { sendOrderCallback } from './callback';
import { transitionOrder, isOrderExpiredAt } from './order-state';
import { logOrderEvent } from './audit';

export interface OrderRow {
  id: number;
  user_id: number;
  status: string;
  amount: string;
  currency: string;
  txn_ref: string;
  client_order_id: string | null;
  upi_payload: string | null;
  payment_link: string | null;
  created_at: Date;
  expires_at: Date | null;
  verified_at: Date | null;
  callback_url: string | null;
  redirect_url: string | null;
  callback_sent: boolean;
  gateway_txn_id: string | null;
  gateway_bank_txn_id: string | null;
  public_token: string | null;
  note: string | null;
}

export interface MerchantCfg {
  paytm_upi_id: string | null;
  paytm_merchant_id: string | null;
  paytm_merchant_key: string | null;
  paytm_env: string | null;
  payee_name: string | null;
}

export async function loadOrderByToken(token: string): Promise<OrderRow | null> {
  if (!token || token.length < 16 || token.length > 48) return null;
  if (!/^[A-Za-z0-9_\-]+$/.test(token)) return null;
  const r = await pool.query<OrderRow>(
    `SELECT * FROM gw_orders WHERE public_token=$1 LIMIT 1`,
    [token],
  );
  return r.rows[0] || null;
}

export async function loadMerchant(userId: number): Promise<MerchantCfg | null> {
  const r = await pool.query<MerchantCfg>(
    `SELECT paytm_upi_id, paytm_merchant_id, paytm_merchant_key, paytm_env, payee_name
       FROM gw_settings WHERE user_id=$1`,
    [userId],
  );
  return r.rows[0] || null;
}

export function isExpired(o: OrderRow): boolean {
  return isOrderExpiredAt(o.expires_at);
}

export function shapeOrder(o: OrderRow, cfg: MerchantCfg | null) {
  return {
    public_token: o.public_token,
    txn_ref: o.txn_ref,
    client_order_id: o.client_order_id,
    amount: parseFloat(o.amount),
    currency: o.currency,
    status: o.status,
    note: o.note,
    payee_name: cfg?.payee_name || 'Merchant',
    upi_payload: o.upi_payload,
    created_at: o.created_at,
    expires_at: o.expires_at,
    verified_at: o.verified_at,
    is_terminal: ['paid', 'failed', 'expired', 'cancelled'].includes(o.status),
    is_expired: isOrderExpiredAt(o.expires_at),
    bank_rrn: o.gateway_bank_txn_id,
    // Browser redirect target after a verified-paid status. Intentionally
    // exposed on the public hosted-page snapshot so the React page can
    // perform the post-payment redirect. callback_url stays server-only.
    redirect_url: o.redirect_url,
  };
}

/**
 * Re-verify a pending order against Paytm and persist any state change
 * via the central state machine (CAS-safe, audited, callback-triggering).
 * Returns the latest order row. Never terminalizes on transient errors.
 */
export async function refreshOrderFromGateway(o: OrderRow, cfg: MerchantCfg | null): Promise<OrderRow> {
  if (o.status !== 'pending') return o;

  if (!cfg?.paytm_merchant_id || !cfg?.paytm_merchant_key) {
    if (isExpired(o)) {
      const t = await transitionOrder({ orderId: o.id, to: 'expired', event: 'order.expired', meta: { source: 'refresh_no_creds' } });
      if (t.changed && t.row) return t.row as OrderRow;
    }
    return o;
  }

  try {
    logOrderEvent({ order_id: o.id, user_id: o.user_id, event: 'order.verify_attempt', meta: { source: 'refresh' } }).catch(() => {});
    const verify = await verifyPaytmPayment(
      { merchant_id: cfg.paytm_merchant_id, merchant_key: cfg.paytm_merchant_key, env: cfg.paytm_env || 'production' },
      o.txn_ref,
      parseFloat(o.amount),
    );
    const decision = classifyVerificationForPoll(verify);

    if (decision === 'paid') {
      const t = await transitionOrder({
        orderId: o.id,
        to: 'paid',
        fields: {
          gateway_txn_id: verify.txn_id || null,
          gateway_bank_txn_id: verify.bank_txn_id || null,
          raw_gateway_response: JSON.stringify(verify.raw || {}).slice(0, 4000),
        },
        event: 'order.verify_paid',
        meta: { source: 'refresh' },
      });
      if (t.changed && t.row) {
        sendOrderCallback(o.id).catch(() => {});
        return t.row as OrderRow;
      }
      const r2 = await pool.query<OrderRow>(`SELECT * FROM gw_orders WHERE id=$1`, [o.id]);
      return r2.rows[0] || o;
    }
    if (decision === 'failed') {
      const t = await transitionOrder({
        orderId: o.id,
        to: 'failed',
        fields: { raw_gateway_response: JSON.stringify(verify.raw || {}).slice(0, 4000) },
        event: 'order.verify_failed',
        meta: { source: 'refresh' },
      });
      if (t.changed && t.row) return t.row as OrderRow;
    }
    if (isExpired(o)) {
      const t = await transitionOrder({ orderId: o.id, to: 'expired', event: 'order.expired', meta: { source: 'refresh' } });
      if (t.changed && t.row) return t.row as OrderRow;
    }
    const r2 = await pool.query<OrderRow>(`SELECT * FROM gw_orders WHERE id=$1`, [o.id]);
    return r2.rows[0] || o;
  } catch {
    if (isExpired(o)) {
      const t = await transitionOrder({ orderId: o.id, to: 'expired', event: 'order.expired', meta: { source: 'refresh_error' } });
      if (t.changed && t.row) return t.row as OrderRow;
    }
    return o;
  }
}
