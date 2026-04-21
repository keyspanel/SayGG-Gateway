import express, { Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from './db';
import { gwSession, GwSessionRequest, signGwToken } from './auth-mw';
import { apiError, apiSuccess, methodNotAllowed } from './api-response';
import { rateLimit, clientIp } from './rate-limit';

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

// Unambiguous base58-style alphabet (no 0, O, I, l, 1)
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const TOKEN_BODY_LEN = 16; // 16 chars * log2(57) ≈ 93 bits entropy
const TOKEN_PREFIX = 'pg_';

function genToken(): string {
  const bytes = crypto.randomBytes(TOKEN_BODY_LEN);
  let out = '';
  for (let i = 0; i < TOKEN_BODY_LEN; i++) {
    out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return TOKEN_PREFIX + out;
}

async function genUniqueToken(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const t = genToken();
    const r = await pool.query('SELECT 1 FROM gw_users WHERE api_token=$1 LIMIT 1', [t]);
    if (!r.rows[0]) return t;
  }
  return TOKEN_PREFIX + crypto.randomBytes(12).toString('hex').slice(0, TOKEN_BODY_LEN);
}

/* -------------------------------------------------------------------------- */
/* Rate limiters                                                               */
/* -------------------------------------------------------------------------- */

const registerLimiter = rateLimit({
  name: 'auth_register',
  windowMs: 60 * 60_000, // 1h
  max: 8,
  message: 'Too many registration attempts. Please try later.',
  code: 'RATE_LIMITED_REGISTER',
});

// Per-IP login limit (loose)
const loginLimiterIp = rateLimit({
  name: 'auth_login_ip',
  windowMs: 15 * 60_000,
  max: 30,
  message: 'Too many login attempts. Please wait a few minutes.',
  code: 'RATE_LIMITED_LOGIN',
});

// Per-(IP, username) limit (tight) — burns an attempt only when wrong creds
const loginFailureStore = new Map<string, number[]>();
const LOGIN_FAIL_WINDOW = 10 * 60_000;
const LOGIN_FAIL_MAX = 6;

function loginFailureKey(ip: string, identifier: string): string {
  return ip + '::' + identifier.toLowerCase();
}
function recordLoginFailure(key: string): void {
  const now = Date.now();
  const arr = loginFailureStore.get(key) || [];
  while (arr.length && arr[0] < now - LOGIN_FAIL_WINDOW) arr.shift();
  arr.push(now);
  loginFailureStore.set(key, arr);
}
function clearLoginFailures(key: string): void {
  loginFailureStore.delete(key);
}
function loginIsLocked(key: string): { locked: boolean; retryAfter?: number } {
  const now = Date.now();
  const arr = loginFailureStore.get(key) || [];
  while (arr.length && arr[0] < now - LOGIN_FAIL_WINDOW) arr.shift();
  if (arr.length >= LOGIN_FAIL_MAX) {
    return { locked: true, retryAfter: Math.ceil((arr[0] + LOGIN_FAIL_WINDOW - now) / 1000) };
  }
  return { locked: false };
}

const tokenGenLimiter = rateLimit({
  name: 'auth_token_gen',
  windowMs: 60 * 60_000,
  max: 10,
  scope: (req) => String((req as GwSessionRequest).gwUser?.id || ''),
  message: 'Too many token generation requests. Please wait.',
  code: 'RATE_LIMITED_TOKEN_GEN',
});

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

router.post('/register', registerLimiter, async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm_password || req.body.confirmPassword || '');

    if (!USERNAME_RE.test(username)) return apiError(res, 400, 'Username must be 3-32 chars (letters, digits, _)', 'VALIDATION_ERROR', { field: 'username' });
    if (email.length > 255 || !EMAIL_RE.test(email)) return apiError(res, 400, 'Invalid email', 'VALIDATION_ERROR', { field: 'email' });
    if (password.length < PASSWORD_MIN) return apiError(res, 400, `Password must be at least ${PASSWORD_MIN} characters`, 'VALIDATION_ERROR', { field: 'password' });
    if (password.length > PASSWORD_MAX) return apiError(res, 400, `Password too long`, 'VALIDATION_ERROR', { field: 'password' });
    if (password !== confirm) return apiError(res, 400, 'Passwords do not match', 'VALIDATION_ERROR', { field: 'confirm_password' });

    const dup = await pool.query(
      'SELECT username, email FROM gw_users WHERE LOWER(username)=LOWER($1) OR LOWER(email)=LOWER($2) LIMIT 1',
      [username, email],
    );
    if (dup.rows[0]) {
      const r = dup.rows[0];
      if (String(r.username).toLowerCase() === username.toLowerCase()) {
        return apiError(res, 409, 'Username already taken', 'USERNAME_EXISTS', { field: 'username' });
      }
      return apiError(res, 409, 'Email already registered', 'EMAIL_EXISTS', { field: 'email' });
    }

    const hash = await bcrypt.hash(password, 10);
    const ins = await pool.query(
      `INSERT INTO gw_users (username, email, password_hash, api_token, api_token_created_at)
       VALUES ($1,$2,$3,NULL,NULL)
       RETURNING id, username`,
      [username, email, hash],
    );
    const user = ins.rows[0];
    await pool.query('INSERT INTO gw_settings (user_id, is_active) VALUES ($1, FALSE) ON CONFLICT (user_id) DO NOTHING', [user.id]);

    const token = signGwToken(user);
    apiSuccess(res, 'Registration successful', { token, username: user.username });
  } catch (e) {
    console.error('[gw/register]', e);
    apiError(res, 500, 'Registration failed', 'REGISTRATION_FAILED');
  }
});

router.post('/login', loginLimiterIp, async (req, res) => {
  try {
    const identifierRaw = String(req.body.username || '').trim().slice(0, 255);
    const password = String(req.body.password || '').slice(0, PASSWORD_MAX + 1);
    if (!identifierRaw || !password) return apiError(res, 400, 'Username and password required', 'VALIDATION_ERROR');

    const ip = clientIp(req);
    const failKey = loginFailureKey(ip, identifierRaw);
    const lock = loginIsLocked(failKey);
    if (lock.locked) {
      res.setHeader('Retry-After', String(lock.retryAfter || 60));
      return apiError(res, 429, 'Too many failed attempts. Try again later.', 'RATE_LIMITED_LOGIN', { retry_after_seconds: lock.retryAfter });
    }

    // Single, case-insensitive lookup against either username or email
    const r = await pool.query(
      'SELECT id, username, password_hash, status FROM gw_users WHERE LOWER(username)=LOWER($1) OR LOWER(email)=LOWER($1) LIMIT 1',
      [identifierRaw],
    );
    const user = r.rows[0];
    // Constant-ish work whether the user exists or not (avoid trivial enumeration timing)
    const hash = user?.password_hash || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid.';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok) {
      recordLoginFailure(failKey);
      return apiError(res, 401, 'Invalid credentials', 'INVALID_CREDENTIALS');
    }
    if (user.status !== 'active') {
      return apiError(res, 403, 'Account inactive', 'ACCOUNT_INACTIVE');
    }

    clearLoginFailures(failKey);
    const token = signGwToken({ id: user.id, username: user.username });
    apiSuccess(res, 'Login successful', { token, username: user.username });
  } catch (e) {
    console.error('[gw/login]', e);
    apiError(res, 500, 'Login failed', 'LOGIN_FAILED');
  }
});

router.get('/me', gwSession, async (req: GwSessionRequest, res: Response) => {
  const u = req.gwUser!;
  apiSuccess(res, 'Session loaded', { id: u.id, username: u.username, email: u.email, has_token: !!u.api_token });
});

async function generateOrRegenerate(req: GwSessionRequest, res: Response) {
  const userId = req.gwUser!.id;
  const s = await pool.query(
    'SELECT paytm_upi_id, paytm_merchant_id, paytm_merchant_key, is_active FROM gw_settings WHERE user_id=$1',
    [userId],
  );
  const cfg = s.rows[0];
  const missing: string[] = [];
  if (!cfg?.paytm_upi_id) missing.push('paytm_upi_id');
  if (!cfg?.paytm_merchant_id) missing.push('paytm_merchant_id');
  if (!cfg?.paytm_merchant_key) missing.push('paytm_merchant_key');
  if (missing.length || !cfg?.is_active) {
    return apiError(res, 412, 'Save your gateway settings before generating an API token.', 'SETTINGS_MISSING', { missing });
  }
  const newToken = await genUniqueToken();
  await pool.query(
    'UPDATE gw_users SET api_token=$1, api_token_created_at=NOW(), updated_at=NOW() WHERE id=$2',
    [newToken, userId],
  );
  apiSuccess(res, 'API token ready', { api_token: newToken, api_token_created_at: new Date().toISOString() });
}

router.post('/regenerate-token', gwSession, tokenGenLimiter, generateOrRegenerate);
router.post('/generate-token', gwSession, tokenGenLimiter, generateOrRegenerate);

router.get('/token', gwSession, async (req: GwSessionRequest, res: Response) => {
  const r = await pool.query('SELECT api_token, api_token_created_at FROM gw_users WHERE id=$1', [req.gwUser!.id]);
  apiSuccess(res, 'API token loaded', r.rows[0] || {});
});

router.all('/register', methodNotAllowed(['POST']));
router.all('/login', methodNotAllowed(['POST']));
router.all('/me', methodNotAllowed(['GET']));
router.all('/regenerate-token', methodNotAllowed(['POST']));
router.all('/generate-token', methodNotAllowed(['POST']));
router.all('/token', methodNotAllowed(['GET']));

export default router;
