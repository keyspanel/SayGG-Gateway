import dns from 'dns/promises';
import net from 'net';

/* -------------------------------------------------------------------------- */
/* Order amount policy                                                         */
/* -------------------------------------------------------------------------- */

export const AMOUNT_MIN = 1;          // INR ₹1
export const AMOUNT_MAX = 200_000;    // INR ₹2,00,000 — UPI single-txn ceiling

export interface FieldError { code: 'VALIDATION_ERROR'; message: string; field: string; }

export function parseAmount(raw: unknown): { ok: true; value: number } | { ok: false; err: FieldError } {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
  if (!isFinite(n) || isNaN(n)) {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: 'amount must be a number', field: 'amount' } };
  }
  if (n < AMOUNT_MIN) {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: `amount must be at least ${AMOUNT_MIN}`, field: 'amount' } };
  }
  if (n > AMOUNT_MAX) {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: `amount must not exceed ${AMOUNT_MAX}`, field: 'amount' } };
  }
  // Enforce 2-decimal precision
  const rounded = Math.round(n * 100) / 100;
  if (Math.abs(rounded - n) > 0.0001) {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: 'amount supports up to 2 decimal places', field: 'amount' } };
  }
  return { ok: true, value: rounded };
}

/* -------------------------------------------------------------------------- */
/* Free-form text fields                                                       */
/* -------------------------------------------------------------------------- */

const PRINTABLE_RE = /^[\u0020-\u007E\u00A0-\uFFFF]*$/; // ASCII printable + most unicode, no control chars

function trimToOrNull(raw: unknown, max: number): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.slice(0, max);
}

export function parseClientOrderId(raw: unknown): { ok: true; value: string | null } | { ok: false; err: FieldError } {
  const s = trimToOrNull(raw, 120);
  if (!s) return { ok: true, value: null };
  if (!/^[A-Za-z0-9_\-.:]{1,120}$/.test(s)) {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: 'client_order_id may contain letters, digits, _ - . : (max 120)', field: 'client_order_id' } };
  }
  return { ok: true, value: s };
}

export function parseCustomerReference(raw: unknown): { ok: true; value: string | null } | { ok: false; err: FieldError } {
  const s = trimToOrNull(raw, 200);
  if (!s) return { ok: true, value: null };
  if (!PRINTABLE_RE.test(s)) {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: 'customer_reference contains invalid characters', field: 'customer_reference' } };
  }
  return { ok: true, value: s };
}

export function parseNote(raw: unknown): { ok: true; value: string | null } | { ok: false; err: FieldError } {
  const s = trimToOrNull(raw, 200);
  if (!s) return { ok: true, value: null };
  if (!PRINTABLE_RE.test(s)) {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: 'note contains invalid characters', field: 'note' } };
  }
  return { ok: true, value: s };
}

export function parseIdempotencyKey(raw: unknown): { ok: true; value: string | null } | { ok: false; err: FieldError } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  const s = String(raw).trim();
  if (s.length < 8 || s.length > 80 || !/^[A-Za-z0-9_\-]+$/.test(s)) {
    return {
      ok: false,
      err: { code: 'VALIDATION_ERROR', message: 'Idempotency-Key must be 8-80 chars, [A-Za-z0-9_-]', field: 'idempotency_key' },
    };
  }
  return { ok: true, value: s };
}

/* -------------------------------------------------------------------------- */
/* Public payment-page token                                                   */
/* -------------------------------------------------------------------------- */

export function isValidPublicToken(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  return raw.length >= 16 && raw.length <= 48 && /^[A-Za-z0-9_\-]+$/.test(raw);
}

/* -------------------------------------------------------------------------- */
/* Callback URL — strict parsing + SSRF protection                             */
/* -------------------------------------------------------------------------- */

const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_CALLBACK_URLS === '1';
const ALLOW_HTTP    = process.env.ALLOW_HTTP_CALLBACK_URLS === '1';

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;             // loopback
  if (a === 0) return true;               // "this network"
  if (a === 169 && b === 254) return true;// link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true;              // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lo = ip.toLowerCase();
  if (lo === '::1' || lo === '::') return true;
  if (lo.startsWith('fc') || lo.startsWith('fd')) return true; // unique local
  if (lo.startsWith('fe80')) return true;                       // link-local
  if (lo.startsWith('::ffff:')) {                               // IPv4-mapped
    const v4 = lo.slice(7);
    if (net.isIPv4(v4)) return isPrivateIPv4(v4);
  }
  return false;
}

export interface CallbackUrlValidation {
  ok: boolean;
  url?: string;
  reason?: string;
}

/** Structural-only check (used at create-order time, no DNS). */
export function parseCallbackUrlShape(raw: unknown): { ok: true; value: string | null } | { ok: false; err: FieldError } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  const s = String(raw).trim().slice(0, 500);
  let u: URL;
  try { u = new URL(s); } catch {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: 'callback_url is not a valid URL', field: 'callback_url' } };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: 'callback_url must be http(s)', field: 'callback_url' } };
  }
  if (u.protocol === 'http:' && !ALLOW_HTTP) {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: 'callback_url must use https', field: 'callback_url' } };
  }
  if (u.username || u.password) {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: 'callback_url must not embed credentials', field: 'callback_url' } };
  }
  // Reject obviously-internal hostnames at creation time too
  const host = u.hostname.toLowerCase();
  if (!ALLOW_PRIVATE) {
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
      return { ok: false, err: { code: 'VALIDATION_ERROR', message: 'callback_url host is not allowed', field: 'callback_url' } };
    }
    if (net.isIP(host)) {
      const priv = net.isIPv4(host) ? isPrivateIPv4(host) : isPrivateIPv6(host);
      if (priv) return { ok: false, err: { code: 'VALIDATION_ERROR', message: 'callback_url host is not allowed', field: 'callback_url' } };
    }
  }
  // Normalize: strip trailing slash on root path only
  return { ok: true, value: u.toString() };
}

/* -------------------------------------------------------------------------- */
/* Browser redirect URLs — success (redirect_url) and failure (cancel_url).   */
/* Both share the same SSRF / scheme / credential / private-IP guards but    */
/* report errors against their own field name so the merchant sees a clear   */
/* validation message.                                                        */
/* -------------------------------------------------------------------------- */

const ALLOW_PRIVATE_REDIRECT = process.env.ALLOW_PRIVATE_REDIRECT_URLS === '1';
const ALLOW_HTTP_REDIRECT    = process.env.ALLOW_HTTP_REDIRECT_URLS === '1';
const IS_PROD                = process.env.NODE_ENV === 'production';

/**
 * Internal: validate a customer-facing browser redirect URL.
 *
 * Rules (identical for redirect_url and cancel_url):
 *  - Optional (empty/null/undefined → null).
 *  - Must be an absolute http(s) URL, max 500 chars.
 *  - Production requires https unless ALLOW_HTTP_REDIRECT_URLS=1.
 *  - No embedded credentials, no javascript:/data:/file:/mailto:/tel:/etc.
 *  - No localhost, .localhost, .internal, .local, or private/loopback/
 *    link-local/reserved IPs unless ALLOW_PRIVATE_REDIRECT_URLS=1.
 */
function parseBrowserUrlShape(
  raw: unknown,
  field: 'redirect_url' | 'cancel_url',
): { ok: true; value: string | null } | { ok: false; err: FieldError } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  const s = String(raw).trim();
  if (!s) return { ok: true, value: null };
  if (s.length > 500) {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: `${field} must be 500 characters or fewer`, field } };
  }
  let u: URL;
  try { u = new URL(s); } catch {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: `${field} is not a valid absolute URL`, field } };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: `${field} must use http or https`, field } };
  }
  // In production, https is required unless ALLOW_HTTP_REDIRECT_URLS=1
  // explicitly opts in. In non-production environments http is permitted so
  // local merchant integrations and end-to-end tests can run unblocked.
  if (u.protocol === 'http:' && IS_PROD && !ALLOW_HTTP_REDIRECT) {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: `${field} must use https`, field } };
  }
  if (u.username || u.password) {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: `${field} must not embed credentials`, field } };
  }
  const host = u.hostname.toLowerCase();
  if (!ALLOW_PRIVATE_REDIRECT) {
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.internal') ||
      host.endsWith('.local')
    ) {
      return { ok: false, err: { code: 'VALIDATION_ERROR', message: `${field} host is not allowed`, field } };
    }
    if (net.isIP(host)) {
      const priv = net.isIPv4(host) ? isPrivateIPv4(host) : isPrivateIPv6(host);
      if (priv) return { ok: false, err: { code: 'VALIDATION_ERROR', message: `${field} host is not allowed`, field } };
    }
  }
  // Re-cap normalized length after URL.toString() may have re-encoded.
  const normalized = u.toString();
  if (normalized.length > 500) {
    return { ok: false, err: { code: 'VALIDATION_ERROR', message: `${field} must be 500 characters or fewer`, field } };
  }
  return { ok: true, value: normalized };
}

/** Browser redirect URL used after the order is verified as paid. */
export function parseRedirectUrlShape(raw: unknown) {
  return parseBrowserUrlShape(raw, 'redirect_url');
}

/** Browser redirect URL used when the order ends in failed/expired/cancelled. */
export function parseCancelUrlShape(raw: unknown) {
  return parseBrowserUrlShape(raw, 'cancel_url');
}

/** Full SSRF check including DNS resolution — call right before delivery. */
export async function safeResolveCallbackUrl(rawUrl: string): Promise<CallbackUrlValidation> {
  const shape = parseCallbackUrlShape(rawUrl);
  if (!shape.ok) return { ok: false, reason: shape.err.message };
  if (!shape.value) return { ok: false, reason: 'empty url' };

  if (ALLOW_PRIVATE) return { ok: true, url: shape.value };

  const u = new URL(shape.value);
  const host = u.hostname;

  // If host is already a literal IP, the shape check already validated it.
  if (net.isIP(host)) return { ok: true, url: shape.value };

  try {
    const records = await dns.lookup(host, { all: true });
    for (const r of records) {
      const priv = r.family === 4 ? isPrivateIPv4(r.address) : isPrivateIPv6(r.address);
      if (priv) return { ok: false, reason: 'host resolves to private network' };
    }
  } catch {
    return { ok: false, reason: 'host could not be resolved' };
  }
  return { ok: true, url: shape.value };
}
