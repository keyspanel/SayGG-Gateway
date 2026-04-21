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
import { apiErrorHandler, apiNotFound, gatewayNotFound } from './api-response';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

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
app.use('/api', apiNotFound);
app.use(apiErrorHandler);

const clientDist = path.resolve(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`[gateway] Payment Gateway running on port ${config.port}`);
  runGatewayMigrations().catch((e) => console.error('[gateway] migration error', e));
});
