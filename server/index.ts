import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config';
import { runGatewayMigrations } from './migrations';
import authRouter from './routes-auth';
import settingsRouter from './routes-settings';
import ordersRouter from './routes-orders';
import publicApiRouter from './routes-public-api';
import payRouter from './routes-pay';
import ownerRouter from './routes-owner';
import billingRouter from './routes-billing';
import { apiErrorHandler, apiNotFound, gatewayNotFound } from './api-response';
import { startReconciler } from './reconciler';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy so req.ip and X-Forwarded-For work behind Replit's edge.
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

// Health
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'payment-gateway' });
});

// Mount API routers (kept under /api/gateway/* for backwards compat with docs/clients)
app.use('/api/gateway/auth', authRouter);
app.use('/api/gateway/settings', settingsRouter);
app.use('/api/gateway', ordersRouter);
app.use('/api/gateway', publicApiRouter);
app.all('/api/gateway', gatewayNotFound);
app.use('/api/gateway', gatewayNotFound);
app.use('/api/pay', payRouter);
app.use('/api/owner', ownerRouter);
app.use('/api/billing', billingRouter);
app.use('/api', apiNotFound);
app.use(apiErrorHandler);

const clientDist = path.resolve(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(config.port, '0.0.0.0', async () => {
  console.log(`[gateway] Payment Gateway running on port ${config.port}`);
  try {
    await runGatewayMigrations();
    startReconciler();
  } catch (e) {
    console.error('[gateway] startup error', e);
  }
});
