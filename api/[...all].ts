/**
 * Vercel catch-all serverless function.
 *
 * Every request to /api/* (other than more-specific files in this directory)
 * is routed here. We delegate to the same Express app the local server uses,
 * so route parity between local dev and production is automatic.
 *
 * Notes:
 * - Migrations run lazily once per cold-started instance (idempotent SQL).
 * - There is no background reconciler in serverless. The same work runs on
 *   the schedule defined in vercel.json -> crons (-> /api/cron/reconcile).
 * - SSE (/api/pay/:token/stream) works but is bounded by `maxDuration` below;
 *   the client also polls /api/pay/:token, so correctness does not depend on
 *   the stream staying open for the full order lifetime.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import app, { ensureMigrations } from '../server/app';

export const config = {
  // Increase if you upgrade to Pro/Enterprise; 60s is the Hobby ceiling.
  maxDuration: 60,
};

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await ensureMigrations();
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      message: 'Database initialization failed',
      code: 'DB_INIT_FAILED',
      error: e?.message || String(e),
    }));
    return;
  }
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
