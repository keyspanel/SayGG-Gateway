import express, { Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from './db';
import { gwSession, GwSessionRequest, signGwToken } from './auth-mw';
import { apiError, apiSuccess, methodNotAllowed } from './api-response';

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function genToken(): string {
  return 'gw_' + crypto.randomBytes(32).toString('hex');
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
    const apiToken = genToken();
    const ins = await pool.query(
      `INSERT INTO gw_users (username, email, password_hash, api_token, api_token_created_at)
       VALUES ($1,$2,$3,$4,NOW())
       RETURNING id, username`,
      [username, email, hash, apiToken],
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

router.post('/regenerate-token', gwSession, async (req: GwSessionRequest, res: Response) => {
  const newToken = genToken();
  await pool.query(
    'UPDATE gw_users SET api_token=$1, api_token_created_at=NOW(), updated_at=NOW() WHERE id=$2',
    [newToken, req.gwUser!.id],
  );
  apiSuccess(res, 'API token regenerated', { api_token: newToken });
});

router.get('/token', gwSession, async (req: GwSessionRequest, res: Response) => {
  const r = await pool.query('SELECT api_token, api_token_created_at FROM gw_users WHERE id=$1', [req.gwUser!.id]);
  apiSuccess(res, 'API token loaded', r.rows[0] || {});
});

router.all('/register', methodNotAllowed(['POST']));
router.all('/login', methodNotAllowed(['POST']));
router.all('/me', methodNotAllowed(['GET']));
router.all('/regenerate-token', methodNotAllowed(['POST']));
router.all('/token', methodNotAllowed(['GET']));

export default router;
