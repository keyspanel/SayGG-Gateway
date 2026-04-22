/**
 * Local / Replit entry point.
 *
 * On Vercel this file is NOT used — Vercel calls `api/[...all].ts` per
 * request. Here we do everything Vercel handles automatically in production:
 *   - listen on a TCP port
 *   - serve the built Vite client + SPA fallback
 *   - run database migrations once at boot
 *   - start the in-process reconciler timer
 */
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config';
import app, { ensureMigrations } from './app';
import { startReconciler } from './reconciler';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Static client + SPA fallback (Vercel serves these from the CDN in prod).
const clientDist = path.resolve(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(config.port, '0.0.0.0', async () => {
  console.log(`[gateway] Payment Gateway running on port ${config.port}`);
  try {
    await ensureMigrations();
    startReconciler();
  } catch (e) {
    console.error('[gateway] startup error', e);
  }
});
