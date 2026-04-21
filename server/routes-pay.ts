import express, { Request, Response } from 'express';
import QRCode from 'qrcode';
import pool from './db';
import { verifyPaytmPayment, classifyVerificationForPoll } from './paytm';
import { sendOrderCallback } from './callback';
import { apiError, apiSuccess, methodNotAllowed } from './api-response';

const router = express.Router();

interface OrderRow {
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

interface MerchantCfg {
  paytm_upi_id: string | null;
  paytm_merchant_id: string | null;
  paytm_merchant_key: string | null;
  paytm_env: string | null;
  payee_name: string | null;
}

async function loadOrderByToken(token: string): Promise<OrderRow | null> {
  if (!token || token.length < 16 || token.length > 48) return null;
  const r = await pool.query<OrderRow>(
    `SELECT * FROM gw_orders WHERE public_token=$1 LIMIT 1`,
    [token],
  );
  return r.rows[0] || null;
}

async function loadMerchant(userId: number): Promise<MerchantCfg | null> {
  const r = await pool.query<MerchantCfg>(
    `SELECT paytm_upi_id, paytm_merchant_id, paytm_merchant_key, paytm_env, payee_name
       FROM gw_settings WHERE user_id=$1`,
    [userId],
  );
  return r.rows[0] || null;
}

function isExpired(o: OrderRow): boolean {
  return !!o.expires_at && new Date(o.expires_at).getTime() < Date.now();
}

async function maybeRefreshFromGateway(o: OrderRow, cfg: MerchantCfg): Promise<OrderRow> {
  if (o.status !== 'pending') return o;
  if (!cfg.paytm_merchant_id || !cfg.paytm_merchant_key) {
    // No creds to verify with — only expiry can finalize the order.
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
        `UPDATE gw_orders SET status='paid', verified_at=NOW(), gateway_txn_id=$1, gateway_bank_txn_id=$2, raw_gateway_response=$3, updated_at=NOW() WHERE id=$4`,
        [verify.txn_id || null, verify.bank_txn_id || null, JSON.stringify(verify.raw || {}).slice(0, 4000), o.id],
      );
      sendOrderCallback(o.id).catch(() => {});
    } else if (decision === 'failed') {
      // Only true terminal failure (e.g. amount mismatch with a confirmed
      // TXN_SUCCESS for the wrong amount). Pending verification, network
      // errors, no_record, etc. are NEVER terminalized here.
      await pool.query(
        `UPDATE gw_orders SET status='failed', updated_at=NOW(), raw_gateway_response=$1 WHERE id=$2`,
        [JSON.stringify(verify.raw || {}).slice(0, 4000), o.id],
      );
    } else if (isExpired(o)) {
      await pool.query(`UPDATE gw_orders SET status='expired', updated_at=NOW() WHERE id=$1`, [o.id]);
    }
    // Otherwise: stay pending. The user may still pay; we'll check again next poll.
    const r2 = await pool.query<OrderRow>(`SELECT * FROM gw_orders WHERE id=$1`, [o.id]);
    return r2.rows[0] || o;
  } catch {
    // Network/gateway hiccup — stay pending, never failed.
    if (isExpired(o)) {
      await pool.query(`UPDATE gw_orders SET status='expired', updated_at=NOW() WHERE id=$1`, [o.id]);
      const r2 = await pool.query<OrderRow>(`SELECT * FROM gw_orders WHERE id=$1`, [o.id]);
      return r2.rows[0] || o;
    }
    return o;
  }
}

function shape(o: OrderRow, cfg: MerchantCfg | null) {
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

router.get('/:token', async (req: Request, res: Response) => {
  try {
    let order = await loadOrderByToken(req.params.token);
    if (!order) return apiError(res, 404, 'Payment link not found or invalid', 'PAYMENT_LINK_NOT_FOUND');

    if (order.status === 'pending' && isExpired(order)) {
      await pool.query(`UPDATE gw_orders SET status='expired', updated_at=NOW() WHERE id=$1`, [order.id]);
      order.status = 'expired';
    }
    const cfg = await loadMerchant(order.user_id);
    return apiSuccess(res, 'Order loaded', shape(order, cfg));
  } catch (e) {
    console.error('[pay/get]', e);
    return apiError(res, 500, 'Failed to load payment link', 'INTERNAL_SERVER_ERROR');
  }
});

router.post('/:token/refresh', async (req: Request, res: Response) => {
  try {
    let order = await loadOrderByToken(req.params.token);
    if (!order) return apiError(res, 404, 'Payment link not found or invalid', 'PAYMENT_LINK_NOT_FOUND');

    const cfg = await loadMerchant(order.user_id);
    if (cfg && order.status === 'pending') {
      order = await maybeRefreshFromGateway(order, cfg);
    }
    if (order.status === 'pending' && isExpired(order)) {
      await pool.query(`UPDATE gw_orders SET status='expired', updated_at=NOW() WHERE id=$1`, [order.id]);
      order.status = 'expired';
    }
    return apiSuccess(res, 'Status refreshed', shape(order, cfg));
  } catch (e) {
    console.error('[pay/refresh]', e);
    return apiError(res, 500, 'Failed to refresh status', 'INTERNAL_SERVER_ERROR');
  }
});

router.get('/:token/qr.png', async (req: Request, res: Response) => {
  try {
    const order = await loadOrderByToken(req.params.token);
    if (!order || !order.upi_payload) {
      return res.status(404).json({ success: false, message: 'QR not available', code: 'QR_NOT_AVAILABLE' });
    }
    const size = Math.min(Math.max(parseInt(String(req.query.size || '420'), 10) || 420, 160), 800);
    const buf = await QRCode.toBuffer(order.upi_payload, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: size,
      color: { dark: '#0a0a0f', light: '#ffffff' },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300, immutable');
    return res.send(buf);
  } catch (e) {
    console.error('[pay/qr]', e);
    return res.status(500).json({ success: false, message: 'Failed to render QR', code: 'QR_RENDER_FAILED' });
  }
});

router.all('/:token', methodNotAllowed(['GET']));
router.all('/:token/refresh', methodNotAllowed(['POST']));
router.all('/:token/qr.png', methodNotAllowed(['GET']));

export default router;
