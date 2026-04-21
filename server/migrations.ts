import pool from './db';

const SQL = `
CREATE TABLE IF NOT EXISTS gw_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(64) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  api_token VARCHAR(96) UNIQUE,
  api_token_created_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'active' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gw_users_api_token ON gw_users(api_token);

CREATE TABLE IF NOT EXISTS gw_settings (
  user_id INTEGER PRIMARY KEY REFERENCES gw_users(id) ON DELETE CASCADE,
  paytm_upi_id VARCHAR(255),
  paytm_merchant_id VARCHAR(128),
  paytm_merchant_key VARCHAR(255),
  paytm_env VARCHAR(20) DEFAULT 'production' NOT NULL,
  payee_name VARCHAR(120),
  is_active BOOLEAN DEFAULT FALSE NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS gw_orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES gw_users(id) ON DELETE CASCADE,
  client_order_id VARCHAR(120),
  txn_ref VARCHAR(64) UNIQUE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency VARCHAR(8) DEFAULT 'INR' NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' NOT NULL,
  note TEXT,
  customer_reference VARCHAR(255),
  callback_url TEXT,
  callback_sent BOOLEAN DEFAULT FALSE NOT NULL,
  callback_sent_at TIMESTAMPTZ,
  callback_status VARCHAR(40),
  callback_response TEXT,
  upi_payload TEXT,
  payment_link TEXT,
  gateway_txn_id VARCHAR(128),
  gateway_bank_txn_id VARCHAR(128),
  raw_gateway_response TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gw_orders_user ON gw_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_gw_orders_status ON gw_orders(status);
CREATE INDEX IF NOT EXISTS idx_gw_orders_client ON gw_orders(user_id, client_order_id);

ALTER TABLE gw_orders ADD COLUMN IF NOT EXISTS public_token VARCHAR(48);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gw_orders_public_token ON gw_orders(public_token);
`;

export async function runGatewayMigrations(): Promise<void> {
  try {
    await pool.query(SQL);
    console.log('[gateway] migrations applied');
  } catch (e) {
    console.error('[gateway] migrations failed:', (e as Error).message);
  }
}
