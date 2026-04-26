import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from './db';
import config from './config';
import { apiError } from './api-response';

export const GW_JWT_SECRET = config.auth.jwtSecret + ':gw';

export interface GwUser {
  id: number;
  username: string;
  email: string;
  api_token: string | null;
  status: string;
  role: string;
  is_active: boolean;
  session_epoch: number;
}

export interface GwSessionRequest extends Request {
  gwUser?: GwUser;
}
export interface GwApiRequest extends Request {
  gwUser?: GwUser;
}

// The token embeds an `ep` (epoch) claim that must match the user's
// current `session_epoch` column. Bumping that column invalidates every
// previously-issued token in one shot — the basis of "Sign out everywhere".
export function signGwToken(user: { id: number; username: string; session_epoch?: number }): string {
  return jwt.sign(
    { uid: user.id, username: user.username, kind: 'gw', ep: user.session_epoch ?? 0 },
    GW_JWT_SECRET,
    { expiresIn: '7d' },
  );
}

async function loadUserById(id: number): Promise<GwUser | null> {
  const r = await pool.query(
    `SELECT id, username, email, api_token, status,
            COALESCE(role, 'user') AS role,
            COALESCE(is_active, TRUE) AS is_active,
            COALESCE(session_epoch, 0) AS session_epoch
       FROM gw_users WHERE id=$1 LIMIT 1`,
    [id],
  );
  return r.rows[0] || null;
}

export async function gwSession(req: GwSessionRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    apiError(res, 401, 'Authentication required', 'AUTH_REQUIRED');
    return;
  }
  try {
    const decoded = jwt.verify(header.slice(7), GW_JWT_SECRET) as { uid: number; kind: string; ep?: number };
    if (decoded.kind !== 'gw') throw new Error('bad token');
    const user = await loadUserById(decoded.uid);
    if (!user || user.status !== 'active' || !user.is_active) {
      apiError(res, 401, 'Account inactive', 'ACCOUNT_INACTIVE');
      return;
    }
    // Token epoch must match the user's current epoch. A "Sign out
    // everywhere" bumps the column so older tokens stop working.
    const tokenEp = typeof decoded.ep === 'number' ? decoded.ep : 0;
    if (tokenEp !== user.session_epoch) {
      apiError(res, 401, 'Session was signed out', 'SESSION_REVOKED');
      return;
    }
    req.gwUser = user;
    // Best-effort last_seen update; ignore failures
    pool.query('UPDATE gw_users SET last_seen_at=NOW() WHERE id=$1', [user.id]).catch(() => {});
    next();
  } catch {
    apiError(res, 401, 'Invalid or expired session', 'INVALID_SESSION');
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
    apiError(res, 401, 'API token required', 'API_TOKEN_REQUIRED');
    return;
  }
  try {
    const r = await pool.query(
      `SELECT id, username, email, api_token, status,
              COALESCE(role, 'user') AS role,
              COALESCE(is_active, TRUE) AS is_active
         FROM gw_users WHERE api_token=$1 LIMIT 1`,
      [token],
    );
    const user = r.rows[0];
    if (!user) {
      apiError(res, 401, 'Invalid API token', 'INVALID_API_TOKEN');
      return;
    }
    if (user.status !== 'active' || !user.is_active) {
      apiError(res, 403, 'Account inactive', 'ACCOUNT_INACTIVE');
      return;
    }
    req.gwUser = user;
    next();
  } catch {
    apiError(res, 500, 'Internal error', 'INTERNAL_ERROR');
  }
}
