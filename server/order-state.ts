import pool from './db';
import { logOrderEvent } from './audit';

/**
 * Centralized order-status state machine.
 *
 * One concurrency-safe path for every status flip in the system. Uses a
 * compare-and-set update (`WHERE status IN (allowedFroms)`) so two paths
 * trying to terminalize the same order can never produce an invalid
 * transition or duplicate side-effects.
 */

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';

const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'failed', 'expired', 'cancelled'],
  paid: [],
  failed: [],
  expired: [],
  cancelled: [],
};

export function isTerminal(s: string): boolean {
  return s === 'paid' || s === 'failed' || s === 'expired' || s === 'cancelled';
}

export function canTransition(from: string, to: OrderStatus): boolean {
  const list = ALLOWED[from as OrderStatus];
  return Array.isArray(list) && list.includes(to);
}

export interface TransitionInput {
  orderId: number;
  to: OrderStatus;
  /** Extra columns to update atomically with the status flip. */
  fields?: Record<string, unknown>;
  /** Audit event name (e.g. 'order.verify_paid'). */
  event: string;
  /** Optional user-readable message attached to the audit row. */
  message?: string;
  /** Free-form metadata attached to the audit row (truncated to 4 KB). */
  meta?: Record<string, unknown>;
  /** Optional fingerprint of gateway response, audited only. */
  gatewayResponse?: unknown;
}

export interface TransitionResult {
  changed: boolean;
  status: string;
  row?: any;
  reason?: string;
}

/**
 * Attempt a status transition. If the order is already in `to`, this is a
 * no-op success. If it's in another terminal state, the transition is
 * rejected (no-op) — terminal states are sticky.
 */
export async function transitionOrder(input: TransitionInput): Promise<TransitionResult> {
  const allowedFroms = ALLOWED[input.to] !== undefined
    ? (Object.keys(ALLOWED) as OrderStatus[]).filter((s) => canTransition(s, input.to))
    : [];
  if (!allowedFroms.length) {
    return { changed: false, status: 'unknown', reason: 'invalid_target_status' };
  }

  // Build SET clause
  const sets: string[] = ['status=$1', 'updated_at=NOW()'];
  const params: unknown[] = [input.to];
  let p = 2;

  if (input.to === 'paid' && !(input.fields && 'verified_at' in input.fields)) {
    sets.push('verified_at=NOW()');
  }

  for (const [k, v] of Object.entries(input.fields || {})) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(k)) continue; // hard-stop SQLi via column name
    sets.push(`${k}=$${p}`);
    params.push(v);
    p += 1;
  }

  // WHERE id=$X AND status IN (...allowedFroms)
  const idIdx = p; params.push(input.orderId); p += 1;
  const fromPlaceholders = allowedFroms.map(() => { const s = `$${p}`; p += 1; return s; }).join(',');
  for (const f of allowedFroms) params.push(f);

  const sql = `UPDATE gw_orders SET ${sets.join(', ')}
               WHERE id=$${idIdx} AND status IN (${fromPlaceholders})
               RETURNING *`;

  const r = await pool.query(sql, params);
  if (r.rows[0]) {
    const row = r.rows[0];
    logOrderEvent({
      order_id: row.id,
      user_id: row.user_id,
      event: input.event,
      status_before: allowedFroms.length === 1 ? allowedFroms[0] : 'pending',
      status_after: input.to,
      message: input.message,
      meta: input.meta,
    }).catch(() => {});
    return { changed: true, status: input.to, row };
  }

  // CAS lost: load current state to report meaningfully
  const cur = await pool.query('SELECT id, user_id, status FROM gw_orders WHERE id=$1', [input.orderId]);
  if (!cur.rows[0]) return { changed: false, status: 'missing', reason: 'order_not_found' };
  const status = cur.rows[0].status as string;
  if (status === input.to) return { changed: false, status, reason: 'already_in_target_state' };
  return { changed: false, status, reason: `invalid_transition_from_${status}` };
}

/* -------------------------------------------------------------------------- */
/* Single source of truth for "is this order past its TTL?"                    */
/* -------------------------------------------------------------------------- */

export function isOrderExpiredAt(expiresAt: Date | string | null | undefined, asOf = Date.now()): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < asOf;
}
