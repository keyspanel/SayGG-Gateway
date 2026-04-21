import pool from './db';

/**
 * Append-only audit log for order lifecycle events.
 * All inserts are fire-and-forget so audit failures never break a request.
 */
export interface OrderEventInput {
  order_id: number;
  user_id: number;
  event: string;
  status_before?: string | null;
  status_after?: string | null;
  message?: string | null;
  meta?: Record<string, unknown> | null;
}

const KNOWN_EVENTS = new Set([
  'order.created',
  'order.verify_attempt',
  'order.verify_paid',
  'order.verify_failed',
  'order.expired',
  'order.cancelled',
  'order.refresh_manual',
  'order.refresh_hosted',
  'order.reconciled',
  'callback.scheduled',
  'callback.attempt',
  'callback.success',
  'callback.failure',
  'callback.blocked',
  'sse.connect',
  'sse.disconnect',
]);

export async function logOrderEvent(e: OrderEventInput): Promise<void> {
  try {
    if (!KNOWN_EVENTS.has(e.event)) return;
    await pool.query(
      `INSERT INTO gw_order_events (order_id, user_id, event, status_before, status_after, message, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        e.order_id,
        e.user_id,
        e.event,
        e.status_before || null,
        e.status_after || null,
        e.message ? String(e.message).slice(0, 500) : null,
        e.meta ? JSON.stringify(e.meta).slice(0, 4000) : null,
      ],
    );
  } catch {
    /* never throw from audit */
  }
}
