import { Pool } from 'pg';
import config from './config';

const pool = new Pool({
  connectionString: config.database.url,
});

pool
  .query('SELECT 1')
  .then(() => console.log('[gateway] Database connected'))
  .catch((err: Error) => console.error('[gateway] Database connection error:', err.message));

export default pool;
