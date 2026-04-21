import pool from './db';
import { verifyPaytmPayment, classifyVerificationForPoll } from './paytm';
import { sendOrderCallback } from './callback';

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
  return !!o.expires_at && new Date(o.expires_at).getTime() < Date.now();
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
    is_expired: isExpired(o),
    bank_rrn: o.gateway_bank_txn_id,
  };
}

/**
 * Re-verify a pending order against Paytm and persist any state change.
 * Returns the latest order row. Never terminalizes on transient errors.
 */
export async function refreshOrderFromGateway(o: OrderRow, cfg: MerchantCfg | null): Promise<OrderRow> {
  if (o.status !== 'pending') return o;

  if (!cfg?.paytm_merchant_id || !cfg?.paytm_merchant_key) {
    if (isExpired(o)) {
      await pool.query(`UPDATE gw_orders SET status='expired', updated_at=NOW() WHERE id=$1`, [o.id]);
      const r2 = await pool.query<OrderRow>(`SELECT * FROM gw_orders WHERE id=$1`, [o.id]);
      return r2.rows[0] || o;
    }
    return o;
  }

  try {
    const verify = await verifyPaytmPayment(
      { merchant_id: cfg.paytm_merchant_id, merchant_key: cfg.paytm_merchant_key, env: cfg.paytm_env || 'production' },
      o.txn_ref,
      parseFloat(o.amount),
    );
    const decision = classifyVerificationForPoll(verify);

    if (decision === 'paid') {
      await pool.query(
        `UPDATE gw_orders SET status='paid', verified_at=NOW(), gateway_txn_id=$1, gateway_bank_txn_id=$2, raw_gateway_response=$3, updated_at=NOW() WHERE id=$4 AND status='pending'`,
        [verify.txn_id || null, verify.bank_txn_id || null, JSON.stringify(verify.raw || {}).slice(0, 4000), o.id],
      );
      sendOrderCallback(o.id).catch(() => {});
    } else if (decision === 'failed') {
      await pool.query(
        `UPDATE gw_orders SET status='failed', updated_at=NOW(), raw_gateway_response=$1 WHERE id=$2 AND status='pending'`,
        [JSON.stringify(verify.raw || {}).slice(0, 4000), o.id],
      );
    } else if (isExpired(o)) {
      await pool.query(`UPDATE gw_orders SET status='expired', updated_at=NOW() WHERE id=$1 AND status='pending'`, [o.id]);
    }
    const r2 = await pool.query<OrderRow>(`SELECT * FROM gw_orders WHERE id=$1`, [o.id]);
    return r2.rows[0] || o;
  } catch {
    if (isExpired(o)) {
      await pool.query(`UPDATE gw_orders SET status='expired', updated_at=NOW() WHERE id=$1 AND status='pending'`, [o.id]);
      const r2 = await pool.query<OrderRow>(`SELECT * FROM gw_orders WHERE id=$1`, [o.id]);
      return r2.rows[0] || o;
    }
    return o;
  }
}
