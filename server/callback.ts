import https from 'https';
import http from 'http';
import crypto from 'crypto';
import { URL } from 'url';
import pool from './db';
import { safeResolveCallbackUrl } from './validation';
import { logOrderEvent } from './audit';

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
  attempt: number;
}

const MAX_ATTEMPTS = 8;
// Exponential backoff with jitter: 30s, 1m, 2m, 5m, 15m, 30m, 1h, 2h
const BACKOFF_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000, 2 * 60 * 60_000];

function nextDelay(attempt: number): number {
  const idx = Math.min(attempt - 1, BACKOFF_MS.length - 1);
  const base = BACKOFF_MS[Math.max(idx, 0)];
  const jitter = Math.floor(Math.random() * Math.min(base * 0.2, 30_000));
  return base + jitter;
}

function postJson(url: string, body: string, signature: string, attempt: number, timeoutMs = 10_000): Promise<{ status: number; body: string }> {
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
            'User-Agent': 'GatewayCallback/1.1',
            'X-Gateway-Signature': signature,
            'X-Gateway-Attempt': String(attempt),
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

/**
 * Send (or retry) the callback for one order.
 *
 * - Verifies callback URL again right before sending (DNS-resolves and rejects
 *   private/loopback ranges so settings or DNS changes can't enable SSRF).
 * - On success: marks `callback_sent=true`, clears `callback_next_attempt_at`.
 * - On HTTP/network failure: increments `callback_attempts`, schedules
 *   exponential backoff. The reconciler picks it up when due.
 * - Hard caps at MAX_ATTEMPTS to avoid infinite churn on a permanently broken endpoint.
 */
export async function sendOrderCallback(orderId: number): Promise<void> {
  let order: any;
  try {
    const r = await pool.query(
      `SELECT o.id, o.user_id, o.client_order_id, o.txn_ref, o.amount, o.currency, o.status,
              o.gateway_txn_id, o.gateway_bank_txn_id, o.customer_reference,
              o.callback_url, o.callback_sent, o.verified_at, o.callback_attempts,
              u.api_token
       FROM gw_orders o JOIN gw_users u ON u.id = o.user_id
       WHERE o.id=$1`,
      [orderId],
    );
    order = r.rows[0];
    if (!order) return;
    if (!order.callback_url) return;
    if (order.callback_sent) return;
    if (order.status !== 'paid') return;
    if (order.callback_attempts >= MAX_ATTEMPTS) return;
  } catch (e) {
    console.error('[gw/callback] load failed', (e as Error).message);
    return;
  }

  const attempt = (order.callback_attempts || 0) + 1;

  // SSRF re-check just before sending
  const safe = await safeResolveCallbackUrl(order.callback_url);
  if (!safe.ok || !safe.url) {
    await pool.query(
      `UPDATE gw_orders
         SET callback_attempts=$1, callback_status='blocked', callback_last_error=$2,
             callback_next_attempt_at=NULL, updated_at=NOW()
       WHERE id=$3`,
      [MAX_ATTEMPTS, ('blocked: ' + (safe.reason || 'unsafe url')).slice(0, 500), orderId],
    );
    logOrderEvent({
      order_id: orderId,
      user_id: order.user_id,
      event: 'callback.blocked',
      message: safe.reason,
    }).catch(() => {});
    return;
  }

  const payload: CallbackPayload = {
    order_id: order.id,
    client_order_id: order.client_order_id,
    txn_ref: order.txn_ref,
    amount: parseFloat(order.amount),
    currency: order.currency,
    status: order.status,
    gateway_txn_id: order.gateway_txn_id,
    bank_rrn: order.gateway_bank_txn_id,
    customer_reference: order.customer_reference,
    verified_at: order.verified_at ? new Date(order.verified_at).toISOString() : null,
    attempt,
  };
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', order.api_token || '').update(body).digest('hex');

  logOrderEvent({
    order_id: orderId,
    user_id: order.user_id,
    event: 'callback.attempt',
    meta: { attempt, url_host: new URL(safe.url).hostname },
  }).catch(() => {});

  let status = 0;
  let snippet = '';
  let label = 'sent';
  let success = false;
  try {
    const out = await postJson(safe.url, body, signature, attempt);
    status = out.status;
    snippet = out.body;
    success = status >= 200 && status < 300;
    label = success ? 'success' : `http_${status}`;
  } catch (e) {
    label = 'error';
    snippet = (e as Error).message.slice(0, 500);
  }

  if (success) {
    await pool.query(
      `UPDATE gw_orders
         SET callback_sent=TRUE, callback_sent_at=NOW(), callback_status=$1,
             callback_response=$2, callback_attempts=$3, callback_last_error=NULL,
             callback_next_attempt_at=NULL, updated_at=NOW()
       WHERE id=$4 AND callback_sent=FALSE`,
      [label, snippet, attempt, orderId],
    );
    logOrderEvent({
      order_id: orderId,
      user_id: order.user_id,
      event: 'callback.success',
      meta: { attempt, http_status: status },
    }).catch(() => {});
    return;
  }

  // Failure path — schedule next retry (or stop if we're out of attempts)
  const exhausted = attempt >= MAX_ATTEMPTS;
  const nextAt = exhausted ? null : new Date(Date.now() + nextDelay(attempt));
  await pool.query(
    `UPDATE gw_orders
       SET callback_attempts=$1, callback_status=$2, callback_response=$3,
           callback_last_error=$4, callback_next_attempt_at=$5, updated_at=NOW()
     WHERE id=$6 AND callback_sent=FALSE`,
    [attempt, label, snippet, snippet, nextAt, orderId],
  );
  logOrderEvent({
    order_id: orderId,
    user_id: order.user_id,
    event: 'callback.failure',
    message: snippet,
    meta: { attempt, http_status: status, exhausted, next_attempt_at: nextAt?.toISOString() },
  }).catch(() => {});
}
