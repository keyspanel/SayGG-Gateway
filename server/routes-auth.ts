import express, { Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from './db';
import { gwSession, GwSessionRequest, signGwToken } from './auth-mw';
import { apiError, apiSuccess, methodNotAllowed } from './api-response';

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  // Fallback: extra entropy if the unlikely happens
  return TOKEN_PREFIX + crypto.randomBytes(12).toString('hex').slice(0, TOKEN_BODY_LEN);
}

router.post('/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm_password || req.body.confirmPassword || '');

    if (!USERNAME_RE.test(username)) return apiError(res, 400, 'Username must be 3-32 chars (letters, digits, _)', 'VALIDATION_ERROR', { field: 'username' });
    if (!EMAIL_RE.test(email)) return apiError(res, 400, 'Invalid email', 'VALIDATION_ERROR', { field: 'email' });
    if (password.length < 8) return apiError(res, 400, 'Password must be at least 8 characters', 'VALIDATION_ERROR', { field: 'password' });
    if (password !== confirm) return apiError(res, 400, 'Passwords do not match', 'VALIDATION_ERROR', { field: 'confirm_password' });

    const dup = await pool.query(
      'SELECT username, email FROM gw_users WHERE username=$1 OR email=$2 LIMIT 1',
      [username, email],
    );
    if (dup.rows[0]) {
      const r = dup.rows[0];
      if (r.username === username) return apiError(res, 409, 'Username already taken', 'USERNAME_EXISTS', { field: 'username' });
      return apiError(res, 409, 'Email already registered', 'EMAIL_EXISTS', { field: 'email' });
    }

    const hash = await bcrypt.hash(password, 10);
    // No API token at registration. User must save settings, then generate.
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

router.post('/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!username || !password) return apiError(res, 400, 'Username and password required', 'VALIDATION_ERROR');

    const r = await pool.query(
      'SELECT id, username, password_hash, status FROM gw_users WHERE username=$1 OR email=$1 LIMIT 1',
      [username.toLowerCase()],
    );
    let user = r.rows[0];
    if (!user) {
      const r2 = await pool.query('SELECT id, username, password_hash, status FROM gw_users WHERE username=$1 LIMIT 1', [username]);
      user = r2.rows[0];
    }
    if (!user) return apiError(res, 401, 'Invalid credentials', 'INVALID_CREDENTIALS');
    if (user.status !== 'active') return apiError(res, 403, 'Account inactive', 'ACCOUNT_INACTIVE');

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return apiError(res, 401, 'Invalid credentials', 'INVALID_CREDENTIALS');

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

router.post('/regenerate-token', gwSession, generateOrRegenerate);
router.post('/generate-token', gwSession, generateOrRegenerate);

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
