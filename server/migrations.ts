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

ALTER TABLE gw_users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user' NOT NULL;
ALTER TABLE gw_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE NOT NULL;
ALTER TABLE gw_users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_gw_users_role ON gw_users(role);

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

-- Method 1 (server) vs Method 2 (hosted) split. Existing rows default to
-- 'hosted' so the legacy hosted pay page keeps working untouched.
ALTER TABLE gw_orders ADD COLUMN IF NOT EXISTS order_mode VARCHAR(20) DEFAULT 'hosted' NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gw_orders_user_mode ON gw_orders(user_id, order_mode);

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

-- ============================================================
-- Plans / SaaS tables
-- ============================================================

CREATE TABLE IF NOT EXISTS gw_platform_settings (
  id SERIAL PRIMARY KEY,
  payee_name TEXT,
  paytm_upi_id TEXT,
  paytm_merchant_id TEXT,
  paytm_merchant_key TEXT,
  paytm_env TEXT DEFAULT 'production',
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gw_plans (
  id SERIAL PRIMARY KEY,
  plan_key VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  method_access VARCHAR(20) NOT NULL,
  duration_days INTEGER NOT NULL,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_price NUMERIC(12,2),
  currency VARCHAR(8) DEFAULT 'INR',
  is_active BOOLEAN DEFAULT TRUE,
  is_featured BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  description TEXT,
  features JSONB DEFAULT '[]'::jsonb,
  limits JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gw_user_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES gw_users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES gw_plans(id) ON DELETE RESTRICT,
  method_access VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'active' NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  purchase_order_id INTEGER,
  granted_by_user_id INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gw_user_subs_user ON gw_user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_gw_user_subs_status ON gw_user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_gw_user_subs_expires ON gw_user_subscriptions(expires_at);
CREATE INDEX IF NOT EXISTS idx_gw_user_subs_plan ON gw_user_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_gw_user_subs_user_active
  ON gw_user_subscriptions(user_id) WHERE status='active';

CREATE TABLE IF NOT EXISTS gw_subscription_orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES gw_users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES gw_plans(id) ON DELETE RESTRICT,
  txn_ref VARCHAR(80) UNIQUE NOT NULL,
  public_token VARCHAR(80) UNIQUE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency VARCHAR(8) DEFAULT 'INR',
  status VARCHAR(20) DEFAULT 'pending' NOT NULL,
  payment_link TEXT,
  upi_payload TEXT,
  gateway_txn_id TEXT,
  gateway_bank_txn_id TEXT,
  bank_rrn TEXT,
  raw_gateway_response JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  activated_subscription_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gw_sub_orders_user ON gw_subscription_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_gw_sub_orders_plan ON gw_subscription_orders(plan_id);
CREATE INDEX IF NOT EXISTS idx_gw_sub_orders_status ON gw_subscription_orders(status);
CREATE INDEX IF NOT EXISTS idx_gw_sub_orders_expires ON gw_subscription_orders(expires_at);
`;

interface PlanSeed {
  plan_key: string;
  name: string;
  method_access: string;
  duration_days: number;
  price: number;
  discount_price: number;
  description: string;
  features: string[];
  sort_order: number;
  is_featured: boolean;
}

const DEFAULT_PLANS: PlanSeed[] = [
  {
    plan_key: 'server_30',
    name: 'Server API',
    method_access: 'server',
    duration_days: 30,
    price: 999,
    discount_price: 799,
    description: 'Method 1 — direct server-to-server API for backend integrations.',
    features: [
      'Server-to-server API',
      'Raw UPI payload',
      'Check order API',
      'Callback webhook',
      'Transactions',
    ],
    sort_order: 10,
    is_featured: false,
  },
  {
    plan_key: 'hosted_30',
    name: 'Hosted Pay Page',
    method_access: 'hosted',
    duration_days: 30,
    price: 1499,
    discount_price: 1199,
    description: 'Method 2 — branded hosted payment links with QR and redirects.',
    features: [
      'Hosted payment page',
      'Payment links',
      'QR checkout',
      'Success redirect',
      'Cancel redirect',
      'Transactions',
    ],
    sort_order: 20,
    is_featured: true,
  },
  {
    plan_key: 'master_30',
    name: 'Master Plan',
    method_access: 'master',
    duration_days: 30,
    price: 2499,
    discount_price: 1999,
    description: 'All access — both Method 1 and Method 2 unlocked together.',
    features: [
      'Server API',
      'Hosted Pay Page',
      'Raw UPI payload',
      'Payment links',
      'Webhooks',
      'Redirects',
      'All features',
    ],
    sort_order: 30,
    is_featured: false,
  },
];

async function seedDefaultPlans(): Promise<void> {
  const r = await pool.query('SELECT COUNT(*)::int AS n FROM gw_plans');
  if (r.rows[0]?.n > 0) return;
  for (const p of DEFAULT_PLANS) {
    await pool.query(
      `INSERT INTO gw_plans (plan_key, name, method_access, duration_days, price, discount_price,
                             currency, is_active, is_featured, sort_order, description, features, limits)
       VALUES ($1,$2,$3,$4,$5,$6,'INR',TRUE,$7,$8,$9,$10::jsonb,'{}'::jsonb)
       ON CONFLICT (plan_key) DO NOTHING`,
      [
        p.plan_key, p.name, p.method_access, p.duration_days,
        p.price.toFixed(2), p.discount_price.toFixed(2),
        p.is_featured, p.sort_order, p.description, JSON.stringify(p.features),
      ],
    );
  }
  console.log('[gateway] default plans seeded');
}

async function ensurePlatformSettingsRow(): Promise<void> {
  const r = await pool.query('SELECT id FROM gw_platform_settings ORDER BY id ASC LIMIT 1');
  if (r.rows[0]) return;
  await pool.query(
    `INSERT INTO gw_platform_settings (payee_name, paytm_env, is_active)
     VALUES (NULL, 'production', FALSE)`,
  );
}

function parseList(env: string | undefined): string[] {
  if (!env) return [];
  return env.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean);
}

async function bootstrapOwners(): Promise<void> {
  const emails = parseList(process.env.OWNER_EMAILS).map((s) => s.toLowerCase());
  const usernames = parseList(process.env.OWNER_USERNAMES).map((s) => s.toLowerCase());

  // Promote any matching configured owner users to role='owner'
  if (emails.length || usernames.length) {
    await pool.query(
      `UPDATE gw_users
          SET role='owner', updated_at=NOW()
        WHERE role <> 'owner'
          AND (LOWER(email) = ANY($1::text[]) OR LOWER(username) = ANY($2::text[]))`,
      [emails, usernames],
    );
  }

  // If no owner exists at all and there's exactly one user, promote that user.
  const ownerR = await pool.query(`SELECT COUNT(*)::int AS n FROM gw_users WHERE role='owner'`);
  if (ownerR.rows[0].n === 0) {
    const userR = await pool.query(`SELECT COUNT(*)::int AS n FROM gw_users`);
    if (userR.rows[0].n === 1) {
      const r = await pool.query(`UPDATE gw_users SET role='owner', updated_at=NOW() WHERE role <> 'owner' RETURNING id, username`);
      if (r.rows[0]) {
        console.log(`[gateway] bootstrapped owner: ${r.rows[0].username} (id=${r.rows[0].id})`);
      }
    }
  }
}

export async function runGatewayMigrations(): Promise<void> {
  try {
    await pool.query(SQL);
    await seedDefaultPlans();
    await ensurePlatformSettingsRow();
    await bootstrapOwners();
    console.log('[gateway] migrations applied');
  } catch (e) {
    console.error('[gateway] migrations failed:', (e as Error).message);
  }
}
