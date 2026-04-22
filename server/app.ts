import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import { runGatewayMigrations } from './migrations';
import authRouter from './routes-auth';
import settingsRouter from './routes-settings';
import ordersRouter from './routes-orders';
import publicApiRouter from './routes-public-api';
import payRouter from './routes-pay';
import { apiErrorHandler, apiNotFound, gatewayNotFound } from './api-response';
import { runReconcileTick } from './reconciler';

/**
 * Builds the Express app used by both the local server (server/index.ts) and
 * the Vercel serverless function (api/[...all].ts).
 *
 * No app.listen, no static asset serving, no background timers — those concerns
 * are handled per-environment by the entry that imports this module.
 */
function buildApp(): Express {
  const app = express();

  // Trust the platform proxy (Vercel / Replit) so req.ip + X-Forwarded-* work.
  app.set('trust proxy', 1);

  app.use(cors());
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: true, limit: '256kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'payment-gateway' });
  });

  // Vercel Cron endpoint — replaces the in-process reconciler on serverless.
  // Vercel sends `Authorization: Bearer ${CRON_SECRET}` automatically when
  // the CRON_SECRET env var is configured in the project. When unset, the
  // endpoint is open (useful for local curl testing only).
  app.all('/api/cron/reconcile', async (req: Request, res: Response) => {
    const expected = process.env.CRON_SECRET;
    if (expected) {
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${expected}`) {
        return res.status(401).json({ ok: false, error: 'unauthorized' });
      }
    }
    try {
      const out = await runReconcileTick();
      return res.json({ ok: true, ...out });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: e?.message || 'reconcile failed' });
    }
  });

  // API routers — kept under /api/gateway/* and /api/pay/* for compat.
  app.use('/api/gateway/auth', authRouter);
  app.use('/api/gateway/settings', settingsRouter);
  app.use('/api/gateway', ordersRouter);
  app.use('/api/gateway', publicApiRouter);
  app.all('/api/gateway', gatewayNotFound);
  app.use('/api/gateway', gatewayNotFound);
  app.use('/api/pay', payRouter);
  app.use('/api', apiNotFound);
  app.use(apiErrorHandler);

  return app;
}

const app = buildApp();
export default app;

/**
 * Idempotently runs database migrations the first time it is awaited per
 * Node instance. Safe to call on every serverless cold start because:
 *   - the underlying SQL uses CREATE TABLE IF NOT EXISTS / ALTER ... IF NOT EXISTS
 *   - the in-memory promise dedupes concurrent invocations
 *   - on failure the cached promise is reset so the next request retries
 */
let migrationsPromise: Promise<void> | null = null;
export function ensureMigrations(): Promise<void> {
  if (!migrationsPromise) {
    migrationsPromise = runGatewayMigrations().catch((err: unknown) => {
      migrationsPromise = null;
      throw err;
    });
  }
  return migrationsPromise;
}
