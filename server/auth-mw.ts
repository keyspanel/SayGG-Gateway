import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from './db';
import config from './config';

export const GW_JWT_SECRET = config.auth.jwtSecret + ':gw';

export interface GwUser {
  id: number;
  username: string;
  email: string;
  api_token: string | null;
  status: string;
}

export interface GwSessionRequest extends Request {
  gwUser?: GwUser;
}
export interface GwApiRequest extends Request {
  gwUser?: GwUser;
}

export function signGwToken(user: { id: number; username: string }): string {
  return jwt.sign({ uid: user.id, username: user.username, kind: 'gw' }, GW_JWT_SECRET, { expiresIn: '7d' });
}

async function loadUserById(id: number): Promise<GwUser | null> {
  const r = await pool.query('SELECT id, username, email, api_token, status FROM gw_users WHERE id=$1 LIMIT 1', [id]);
  return r.rows[0] || null;
}

export async function gwSession(req: GwSessionRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const decoded = jwt.verify(header.slice(7), GW_JWT_SECRET) as { uid: number; kind: string };
    if (decoded.kind !== 'gw') throw new Error('bad token');
    const user = await loadUserById(decoded.uid);
    if (!user || user.status !== 'active') {
      res.status(401).json({ error: 'Account inactive' });
      return;
    }
    req.gwUser = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export async function gwApiToken(req: GwApiRequest, res: Response, next: NextFunction): Promise<void> {
  let token: string | null = null;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) token = header.slice(7).trim();
  if (!token && typeof req.headers['x-api-token'] === 'string') token = (req.headers['x-api-token'] as string).trim();
  if (!token && typeof req.query.api_token === 'string') token = (req.query.api_token as string).trim();
  if (!token && req.body && typeof req.body.api_token === 'string') token = String(req.body.api_token).trim();
  if (!token) {
    res.status(401).json({ success: false, error: 'API token required' });
    return;
  }
  try {
    const r = await pool.query(
      'SELECT id, username, email, api_token, status FROM gw_users WHERE api_token=$1 LIMIT 1',
      [token],
    );
    const user = r.rows[0];
    if (!user) {
      res.status(401).json({ success: false, error: 'Invalid API token' });
      return;
    }
    if (user.status !== 'active') {
      res.status(403).json({ success: false, error: 'Account inactive' });
      return;
    }
    req.gwUser = user;
    next();
  } catch {
    res.status(500).json({ success: false, error: 'Internal error' });
  }
}
