import https from 'https';
import http from 'http';
import crypto from 'crypto';
import { URL } from 'url';
import pool from './db';

export interface CallbackPayload {
  order_id: number;
  client_order_id: string | null;
  txn_ref: string;
  amount: number;
  currency: string;
  status: string;
  gateway_txn_id: string | null;
  bank_rrn: string | null;
  customer_reference: string | null;
  verified_at: string | null;
}

function postJson(url: string, body: string, signature: string, timeoutMs = 10000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + (u.search || ''),
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'User-Agent': 'GatewayCallback/1.0',
            'X-Gateway-Signature': signature,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8').slice(0, 1000) }),
          );
        },
      );
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error('callback timeout')));
      req.write(body);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

export async function sendOrderCallback(orderId: number): Promise<void> {
  try {
    const r = await pool.query(
      `SELECT o.id, o.user_id, o.client_order_id, o.txn_ref, o.amount, o.currency, o.status,
              o.gateway_txn_id, o.gateway_bank_txn_id, o.customer_reference,
              o.callback_url, o.callback_sent, o.verified_at,
              u.api_token
       FROM gw_orders o JOIN gw_users u ON u.id = o.user_id
       WHERE o.id=$1`,
      [orderId],
    );
    const o = r.rows[0];
    if (!o) return;
    if (!o.callback_url) return;
    if (o.callback_sent) return;
    if (o.status !== 'paid') return;

    const payload: CallbackPayload = {
      order_id: o.id,
      client_order_id: o.client_order_id,
      txn_ref: o.txn_ref,
      amount: parseFloat(o.amount),
      currency: o.currency,
      status: o.status,
      gateway_txn_id: o.gateway_txn_id,
      bank_rrn: o.gateway_bank_txn_id,
      customer_reference: o.customer_reference,
      verified_at: o.verified_at ? new Date(o.verified_at).toISOString() : null,
    };
    const body = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', o.api_token || '').update(body).digest('hex');

    let status = 0;
    let snippet = '';
    let label = 'sent';
    try {
      const out = await postJson(o.callback_url, body, signature);
      status = out.status;
      snippet = out.body;
      label = status >= 200 && status < 300 ? 'success' : `http_${status}`;
    } catch (e) {
      label = 'error';
      snippet = (e as Error).message.slice(0, 500);
    }

    const success = label === 'success';
    await pool.query(
      `UPDATE gw_orders
       SET callback_sent=$1, callback_sent_at=NOW(), callback_status=$2, callback_response=$3, updated_at=NOW()
       WHERE id=$4`,
      [success, label, snippet, orderId],
    );
  } catch (e) {
    console.error('[gw/callback] failed', (e as Error).message);
  }
}
