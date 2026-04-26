import { Pool } from 'pg';
import config from './config';

const useSsl = String(process.env.DATABASE_SSL || '').toLowerCase() === 'true';

const pool = new Pool({
  connectionString: config.database.url,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

pool
  .query('SELECT 1')
  .then(() => console.log('[gateway] Database connected'))
  .catch((err: Error) => console.error('[gateway] Database connection error:', err.message));

export default pool;
