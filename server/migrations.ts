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

-- Production hardening additions ---------------------------------------------

-- Idempotency-Key support for create-order
ALTER TABLE gw_orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(80);
ALTER TABLE gw_orders ADD COLUMN IF NOT EXISTS idempotency_fingerprint VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gw_orders_idemkey
  ON gw_orders(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Callback retry / backoff bookkeeping
ALTER TABLE gw_orders ADD COLUMN IF NOT EXISTS callback_attempts INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE gw_orders ADD COLUMN IF NOT EXISTS callback_next_attempt_at TIMESTAMPTZ;
ALTER TABLE gw_orders ADD COLUMN IF NOT EXISTS callback_last_error TEXT;

-- Index for the background reconciler (pending orders + due callbacks)
CREATE INDEX IF NOT EXISTS idx_gw_orders_pending_expires
  ON gw_orders(status, expires_at) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_gw_orders_callback_due
  ON gw_orders(callback_next_attempt_at)
  WHERE status='paid' AND callback_url IS NOT NULL AND callback_sent=FALSE;

-- Browser redirect URL after the order is verified as paid (separate from
-- the server-to-server callback_url webhook). Optional, validated at the
-- application layer before insert.
ALTER TABLE gw_orders ADD COLUMN IF NOT EXISTS redirect_url TEXT;

-- Browser redirect URL when the order ends in failed / expired / cancelled.
-- Same validation rules as redirect_url; allows merchants to send the
-- customer back to a retry / cart page on unsuccessful payments.
ALTER TABLE gw_orders ADD COLUMN IF NOT EXISTS cancel_url TEXT;

-- Append-only audit log for order lifecycle visibility
CREATE TABLE IF NOT EXISTS gw_order_events (
  id BIGSERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES gw_orders(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES gw_users(id) ON DELETE CASCADE,
  event VARCHAR(64) NOT NULL,
  status_before VARCHAR(20),
  status_after VARCHAR(20),
  message TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gw_order_events_order ON gw_order_events(order_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_gw_order_events_user_created ON gw_order_events(user_id, created_at DESC);
`;

export async function runGatewayMigrations(): Promise<void> {
  try {
    await pool.query(SQL);
    console.log('[gateway] migrations applied');
  } catch (e) {
    console.error('[gateway] migrations failed:', (e as Error).message);
  }
}
