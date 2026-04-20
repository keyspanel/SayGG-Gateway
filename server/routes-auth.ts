import express, { Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from './db';
import { gwSession, GwSessionRequest, signGwToken } from './auth-mw';

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

    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username must be 3-32 chars (letters, digits, _)' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (password !== confirm) return res.status(400).json({ error: 'Passwords do not match' });

    const dup = await pool.query(
      'SELECT username, email FROM gw_users WHERE username=$1 OR email=$2 LIMIT 1',
      [username, email],
    );
    if (dup.rows[0]) {
      const r = dup.rows[0];
      if (r.username === username) return res.status(409).json({ error: 'Username already taken' });
      return res.status(409).json({ error: 'Email already registered' });
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
    res.json({ token, username: user.username });
  } catch (e) {
    console.error('[gw/register]', e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const r = await pool.query(
      'SELECT id, username, password_hash, status FROM gw_users WHERE username=$1 OR email=$1 LIMIT 1',
      [username.toLowerCase()],
    );
    let user = r.rows[0];
    if (!user) {
      const r2 = await pool.query('SELECT id, username, password_hash, status FROM gw_users WHERE username=$1 LIMIT 1', [username]);
      user = r2.rows[0];
    }
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.status !== 'active') return res.status(403).json({ error: 'Account inactive' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signGwToken({ id: user.id, username: user.username });
    res.json({ token, username: user.username });
  } catch (e) {
    console.error('[gw/login]', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', gwSession, async (req: GwSessionRequest, res: Response) => {
  const u = req.gwUser!;
  res.json({ id: u.id, username: u.username, email: u.email, has_token: !!u.api_token });
});

router.post('/regenerate-token', gwSession, async (req: GwSessionRequest, res: Response) => {
  const newToken = genToken();
  await pool.query(
    'UPDATE gw_users SET api_token=$1, api_token_created_at=NOW(), updated_at=NOW() WHERE id=$2',
    [newToken, req.gwUser!.id],
  );
  res.json({ api_token: newToken });
});

router.get('/token', gwSession, async (req: GwSessionRequest, res: Response) => {
  const r = await pool.query('SELECT api_token, api_token_created_at FROM gw_users WHERE id=$1', [req.gwUser!.id]);
  res.json(r.rows[0] || {});
});

export default router;
