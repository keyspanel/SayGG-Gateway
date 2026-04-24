import pool from './db';
import { transitionOrder, isOrderExpiredAt } from './order-state';
import { verifyPaytmPayment, classifyVerificationForPoll } from './paytm';
import { sendOrderCallback } from './callback';
import { logOrderEvent } from './audit';
import { publishOrderSnapshot } from './order-events';
import { shapeOrder, loadMerchant } from './order-pay-helpers';

/**
 * Background reconciler.
 *
 * Runs once every RECONCILE_TICK_MS to keep the system honest even when no
 * customer has the hosted page open and no merchant is polling check-order:
 *
 *   1. Expire stale `pending` orders that are past `expires_at`.
 *   2. Re-verify recent `pending` orders against Paytm (cheap pass).
 *   3. Retry due callbacks for `paid` orders whose webhook hasn't been delivered.
 *
 * A single `running` flag prevents overlapping ticks if one happens to run long.
 */

const RECONCILE_TICK_MS = 30_000;
const RECONCILE_VERIFY_MAX = 25;       // orders re-verified per tick
const RECONCILE_CALLBACK_MAX = 25;     // callbacks fired per tick
const RECONCILE_VERIFY_MIN_AGE_MS = 60_000; // don't bother orders younger than 1 min

let running = false;
let timer: NodeJS.Timeout | null = null;

async function expireStalePending(): Promise<number> {
  // Bulk expire — single query, no per-row loop. CAS still applied via WHERE.
  const r = await pool.query(
    `UPDATE gw_orders
       SET status='expired', updated_at=NOW()
     WHERE status='pending' AND expires_at IS NOT NULL AND expires_at < NOW()
     RETURNING id, user_id, public_token`,
  );
  for (const row of r.rows) {
    logOrderEvent({
      order_id: row.id,
      user_id: row.user_id,
      event: 'order.expired',
      status_before: 'pending',
      status_after: 'expired',
      meta: { source: 'reconciler' },
    }).catch(() => {});
    // Push to any open hosted page
    if (row.public_token) {
      const full = await pool.query('SELECT * FROM gw_orders WHERE id=$1', [row.id]).catch(() => null);
      if (full?.rows[0]) {
        const cfg = await loadMerchant(row.user_id).catch(() => null);
        publishOrderSnapshot(row.public_token, shapeOrder(full.rows[0], cfg));
      }
    }
  }
  return r.rowCount || 0;
}

async function verifyRecentPending(): Promise<number> {
  // Pick a small batch of pending orders that are old enough to be worth verifying
  // and not already past expiry (those are handled above).
  const r = await pool.query(
    `SELECT o.id, o.user_id, o.txn_ref, o.amount, o.public_token,
            s.paytm_merchant_id, s.paytm_merchant_key, s.paytm_env
       FROM gw_orders o
       JOIN gw_settings s ON s.user_id=o.user_id
      WHERE o.status='pending'
        AND o.created_at < NOW() - INTERVAL '${Math.floor(RECONCILE_VERIFY_MIN_AGE_MS / 1000)} seconds'
        AND (o.expires_at IS NULL OR o.expires_at > NOW())
        AND s.paytm_merchant_id IS NOT NULL AND s.paytm_merchant_key IS NOT NULL
      ORDER BY o.updated_at ASC
      LIMIT ${RECONCILE_VERIFY_MAX}`,
  );

  let processed = 0;
  for (const o of r.rows) {
    try {
      const verify = await verifyPaytmPayment(
        { merchant_id: o.paytm_merchant_id, merchant_key: o.paytm_merchant_key, env: o.paytm_env || 'production' },
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
          event: 'order.reconciled',
          meta: { source: 'reconciler', decision },
        });
        if (t.changed && t.row) {
          const cfg = await loadMerchant(o.user_id).catch(() => null);
          publishOrderSnapshot(o.public_token, shapeOrder(t.row, cfg));
          sendOrderCallback(o.id).catch(() => {});
        }
      } else if (decision === 'failed') {
        const t = await transitionOrder({
          orderId: o.id,
          to: 'failed',
          fields: { raw_gateway_response: JSON.stringify(verify.raw || {}).slice(0, 4000) },
          event: 'order.reconciled',
          meta: { source: 'reconciler', decision },
        });
        if (t.changed && t.row) {
          const cfg = await loadMerchant(o.user_id).catch(() => null);
          publishOrderSnapshot(o.public_token, shapeOrder(t.row, cfg));
        }
      } else {
        // Touch updated_at so we round-robin through pending orders fairly.
        await pool.query(`UPDATE gw_orders SET updated_at=NOW() WHERE id=$1 AND status='pending'`, [o.id]);
      }
      processed += 1;
    } catch {
      /* transient — try again next tick */
    }
  }
  return processed;
}

async function retryDueCallbacks(): Promise<number> {
  const r = await pool.query(
    `SELECT id FROM gw_orders
      WHERE status='paid' AND callback_url IS NOT NULL AND callback_sent=FALSE
        AND (callback_next_attempt_at IS NULL OR callback_next_attempt_at <= NOW())
        AND callback_attempts < 8
      ORDER BY callback_next_attempt_at NULLS FIRST, id ASC
      LIMIT ${RECONCILE_CALLBACK_MAX}`,
  );
  for (const row of r.rows) {
    sendOrderCallback(row.id).catch(() => {});
  }
  return r.rowCount || 0;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const expired = await expireStalePending().catch(() => 0);
    const verified = await verifyRecentPending().catch(() => 0);
    const callbacks = await retryDueCallbacks().catch(() => 0);
    if (expired || verified || callbacks) {
      console.log(`[reconciler] expired=${expired} verified=${verified} callbacks=${callbacks}`);
    }
  } finally {
    running = false;
  }
}

export function startReconciler(): void {
  if (timer) return;
  // First tick after a short delay so server bootstrap completes cleanly.
  setTimeout(() => { tick().catch(() => {}); }, 5_000);
  timer = setInterval(() => { tick().catch(() => {}); }, RECONCILE_TICK_MS);
  timer.unref?.();
  console.log('[reconciler] started');
}

export function stopReconciler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
