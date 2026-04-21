import { EventEmitter } from 'events';
import {
  loadMerchant,
  loadOrderByToken,
  refreshOrderFromGateway,
  shapeOrder,
} from './order-pay-helpers';

/**
 * Per-order pub/sub for the hosted payment page.
 *
 * - One EventEmitter per public_token, lazily created when first subscriber arrives.
 * - One server-side verification poller per token, shared across all subscribers
 *   of the same order. Stops as soon as the last subscriber leaves OR the order
 *   reaches a terminal state. This gives us "near-instant" updates without
 *   broadcasting anything to clients that aren't actively watching.
 * - Auth is per-token: only callers that already know the ~22-char public_token
 *   can subscribe, and they only see updates for that one order.
 */

type Snapshot = ReturnType<typeof shapeOrder>;
export type OrderUpdateListener = (snap: Snapshot) => void;

const SERVER_POLL_MS = 2500;          // aggressive server-side re-verify
const SERVER_POLL_FIRST_MS = 1200;    // first tick fires fast
const SERVER_POLL_MAX_AGE_MS = 35 * 60 * 1000; // safety cap; orders TTL is 30m

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
  if (ch?.poller) {
    clearInterval(ch.poller);
    ch.poller = undefined;
  }
}

function dropChannel(token: string) {
  const ch = channels.get(token);
  if (!ch) return;
  stopPoller(token);
  ch.emitter.removeAllListeners();
  channels.delete(token);
}

async function tick(token: string) {
  const ch = channels.get(token);
  if (!ch) return;

  // Safety cap: don't poll forever for an abandoned order.
  if (Date.now() - ch.startedAt > SERVER_POLL_MAX_AGE_MS) {
    stopPoller(token);
    return;
  }

  try {
    const order = await loadOrderByToken(token);
    if (!order) { stopPoller(token); return; }

    const cfg = await loadMerchant(order.user_id);

    // If already terminal, push once (so any newly connected client sees it),
    // then stop the poller — it's done.
    if (order.status !== 'pending') {
      const snap = shapeOrder(order, cfg);
      if (ch.lastStatus !== order.status) {
        ch.lastStatus = order.status;
        ch.emitter.emit('update', snap);
      }
      stopPoller(token);
      return;
    }

    const refreshed = await refreshOrderFromGateway(order, cfg);
    if (refreshed.status !== ch.lastStatus) {
      ch.lastStatus = refreshed.status;
      ch.emitter.emit('update', shapeOrder(refreshed, cfg));
    }
    if (refreshed.status !== 'pending') {
      stopPoller(token);
    }
  } catch {
    /* swallow — never terminalize on transient errors */
  }
}

function ensurePoller(token: string) {
  const ch = channels.get(token);
  if (!ch || ch.poller) return;
  ch.poller = setInterval(() => { tick(token).catch(() => {}); }, SERVER_POLL_MS);
  setTimeout(() => { tick(token).catch(() => {}); }, SERVER_POLL_FIRST_MS);
}

/**
 * Subscribe to live updates for one order. Returns an unsubscribe fn.
 * Idempotent — duplicate subscribers from the same client are fine.
 */
export function subscribeOrder(token: string, listener: OrderUpdateListener): () => void {
  const ch = getOrCreate(token);
  ch.emitter.on('update', listener);
  ch.refcount += 1;
  ensurePoller(token);

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

/**
 * Externally-triggered publish — call this from any code path that
 * persists a status change for the order (e.g. /refresh, /check-order)
 * so any subscribed hosted page sees the new state instantly.
 */
export function publishOrderSnapshot(token: string | null | undefined, snap: Snapshot): void {
  if (!token) return;
  const ch = channels.get(token);
  if (!ch) return;
  if (ch.lastStatus === snap.status) return;
  ch.lastStatus = snap.status;
  ch.emitter.emit('update', snap);
  if (snap.is_terminal) stopPoller(token);
}

/** Optional: useful if we ever want to expose stats. */
export function activeOrderChannels(): number {
  return channels.size;
}
