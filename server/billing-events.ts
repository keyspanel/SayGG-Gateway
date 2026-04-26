/**
 * Per-billing-order pub/sub for the hosted plan-pay page.
 *
 * Mirrors `order-events.ts` but for `gw_subscription_orders` so the same
 * Server-Sent-Events flow used by the merchant hosted page works for
 * platform plan checkouts too. One channel per public_token, one shared
 * server-side verifier per channel, ref-counted so it stops as soon as the
 * last subscriber disconnects or the order reaches a terminal state.
 *
 * Token namespaces never collide (merchant tokens are random base64url,
 * billing tokens always carry the `BILL_` prefix), so this can safely run
 * alongside the merchant order-events module.
 */

import { EventEmitter } from 'events';
import pool from './db';
import { refreshSubscriptionOrder } from './billing-verify';

type Snapshot = Record<string, any>;
export type BillingUpdateListener = (snap: Snapshot) => void;

const SERVER_POLL_MS = 2500;
const SERVER_POLL_FIRST_MS = 1200;
const SERVER_POLL_MAX_AGE_MS = 35 * 60 * 1000;

interface Channel {
  emitter: EventEmitter;
  refcount: number;
  poller?: NodeJS.Timeout;
  startedAt: number;
  lastStatus?: string;
}

const channels = new Map<string, Channel>();

function getOrCreate(token: string): Channel {
  let ch = channels.get(token);
  if (!ch) {
    const em = new EventEmitter();
    em.setMaxListeners(0);
    ch = { emitter: em, refcount: 0, startedAt: Date.now() };
    channels.set(token, ch);
  }
  return ch;
}

function stopPoller(token: string) {
  const ch = channels.get(token);
  if (ch?.poller) { clearInterval(ch.poller); ch.poller = undefined; }
}

function dropChannel(token: string) {
  const ch = channels.get(token);
  if (!ch) return;
  stopPoller(token);
  ch.emitter.removeAllListeners();
  channels.delete(token);
}

async function loadOrderRow(token: string) {
  const r = await pool.query(
    `SELECT s.*, p.plan_key, p.name AS plan_name, p.method_access, p.duration_days,
            ps.payee_name AS platform_payee_name
       FROM gw_subscription_orders s
       JOIN gw_plans p ON p.id=s.plan_id
       LEFT JOIN gw_platform_settings ps ON TRUE
      WHERE s.public_token=$1
      ORDER BY ps.id ASC
      LIMIT 1`,
    [token],
  );
  return r.rows[0] || null;
}

async function tick(token: string, shape: (row: any) => Snapshot) {
  const ch = channels.get(token);
  if (!ch) return;

  if (Date.now() - ch.startedAt > SERVER_POLL_MAX_AGE_MS) {
    stopPoller(token);
    return;
  }

  try {
    const row = await loadOrderRow(token);
    if (!row) { stopPoller(token); return; }

    if (row.status !== 'pending') {
      const snap = shape(row);
      if (ch.lastStatus !== row.status) {
        ch.lastStatus = row.status;
        ch.emitter.emit('update', snap);
      }
      stopPoller(token);
      return;
    }

    // Re-verify against the gateway. This will also activate the user's
    // subscription if the gateway now reports a successful payment.
    await refreshSubscriptionOrder(row.id);

    const fresh = await loadOrderRow(token);
    if (!fresh) { stopPoller(token); return; }
    if (fresh.status !== ch.lastStatus) {
      ch.lastStatus = fresh.status;
      ch.emitter.emit('update', shape(fresh));
    }
    if (fresh.status !== 'pending') stopPoller(token);
  } catch {
    /* swallow — never terminalize on transient errors */
  }
}

function ensurePoller(token: string, shape: (row: any) => Snapshot) {
  const ch = channels.get(token);
  if (!ch || ch.poller) return;
  ch.poller = setInterval(() => { tick(token, shape).catch(() => {}); }, SERVER_POLL_MS);
  setTimeout(() => { tick(token, shape).catch(() => {}); }, SERVER_POLL_FIRST_MS);
}

export function subscribeBillingOrder(
  token: string,
  shape: (row: any) => Snapshot,
  listener: BillingUpdateListener,
): () => void {
  const ch = getOrCreate(token);
  ch.emitter.on('update', listener);
  ch.refcount += 1;
  ensurePoller(token, shape);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const cur = channels.get(token);
    if (!cur) return;
    cur.emitter.off('update', listener);
    cur.refcount -= 1;
    if (cur.refcount <= 0) dropChannel(token);
  };
}

export function publishBillingSnapshot(token: string | null | undefined, snap: Snapshot): void {
  if (!token) return;
  const ch = channels.get(token);
  if (!ch) return;
  if (ch.lastStatus === snap.status) return;
  ch.lastStatus = snap.status;
  ch.emitter.emit('update', snap);
  if (snap.is_terminal) stopPoller(token);
}
