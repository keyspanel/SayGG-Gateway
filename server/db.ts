import { Pool } from 'pg';
import config from './config';

/**
 * Connection pool tuned for both long-running (Replit/local) and serverless
 * (Vercel) runtimes:
 *   - max=5 keeps each serverless instance well under managed-Postgres caps
 *     when many cold starts happen at once.
 *   - SSL is enabled when the DATABASE_URL targets a managed provider
 *     (anything that is not localhost / a Unix socket / explicitly sslmode=disable).
 */
const url = config.database.url || '';
const looksLocal = /(^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1|::1)[:/])|(host=\/)/i.test(url);
const sslDisabled = /sslmode=disable/i.test(url);
const useSsl = !!url && !looksLocal && !sslDisabled;

const pool = new Pool({
  connectionString: url,
  max: 5,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

// One-shot connectivity probe; in serverless this only runs on cold starts.
pool
  .query('SELECT 1')
  .then(() => console.log('[gateway] Database connected'))
  .catch((err: Error) => console.error('[gateway] Database connection error:', err.message));

export default pool;
