import { Request, Response, NextFunction } from 'express';
import { apiError } from './api-response';

/**
 * Lightweight in-memory sliding-window rate limiter.
 *
 * Single-process only — fine for this gateway's footprint. If we ever scale
 * horizontally we'd swap the backing store for Redis behind the same API.
 */

interface Bucket {
  hits: number[]; // unix-ms timestamps within the window
}

const stores = new Map<string, Map<string, Bucket>>();

function getStore(name: string): Map<string, Bucket> {
  let s = stores.get(name);
  if (!s) { s = new Map(); stores.set(name, s); }
  return s;
}

function getClientIp(req: Request): string {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  if (Array.isArray(xf) && xf[0]) return xf[0];
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export interface RateLimitOpts {
  name: string;
  windowMs: number;
  max: number;
  /** Build the key. Defaults to the client IP. */
  keyer?: (req: Request) => string;
  /** Optional: a second key dimension (e.g. user id) combined with primary. */
  scope?: (req: Request) => string | undefined;
  message?: string;
  code?: string;
}

export function rateLimit(opts: RateLimitOpts) {
  const store = getStore(opts.name);
  return (req: Request, res: Response, next: NextFunction) => {
    const baseKey = opts.keyer ? opts.keyer(req) : getClientIp(req);
    const scopeKey = opts.scope ? opts.scope(req) : undefined;
    const key = scopeKey ? `${baseKey}::${scopeKey}` : baseKey;

    const now = Date.now();
    const cutoff = now - opts.windowMs;
    let bucket = store.get(key);
    if (!bucket) { bucket = { hits: [] }; store.set(key, bucket); }
    // Drop old hits
    while (bucket.hits.length && bucket.hits[0] < cutoff) bucket.hits.shift();

    if (bucket.hits.length >= opts.max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.hits[0] + opts.windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      apiError(
        res,
        429,
        opts.message || 'Too many requests. Please slow down.',
        opts.code || 'RATE_LIMITED',
        { retry_after_seconds: retryAfterSec },
      );
      return;
    }

    bucket.hits.push(now);
    next();
  };
}

/** Periodically prune empty buckets so the maps don't leak. */
setInterval(() => {
  const now = Date.now();
  for (const store of stores.values()) {
    for (const [k, b] of store.entries()) {
      // 1h grace; if the bucket has no recent hits, drop it
      if (!b.hits.length || b.hits[b.hits.length - 1] < now - 60 * 60 * 1000) {
        store.delete(k);
      }
    }
  }
}, 5 * 60 * 1000).unref?.();

/* ------------------------------------------------------------------ */
/* Concurrent-connection cap (used by SSE).                            */
/* ------------------------------------------------------------------ */

const concurrencyStores = new Map<string, Map<string, number>>();

export function tryAcquireConcurrent(name: string, key: string, max: number): boolean {
  let store = concurrencyStores.get(name);
  if (!store) { store = new Map(); concurrencyStores.set(name, store); }
  const cur = store.get(key) || 0;
  if (cur >= max) return false;
  store.set(key, cur + 1);
  return true;
}

export function releaseConcurrent(name: string, key: string): void {
  const store = concurrencyStores.get(name);
  if (!store) return;
  const cur = store.get(key) || 0;
  if (cur <= 1) store.delete(key);
  else store.set(key, cur - 1);
}

export const clientIp = getClientIp;
