-- Migration from old quota system to wallet model
-- This script handles the transition from the old schema to the new wallet-based schema

-- 1. Drop the old usage_logs table (we'll recreate it with proper structure)
DROP TABLE IF EXISTS usage_logs;

-- 2. Drop other old tables that are no longer needed
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS sessions;

-- 3. Drop webhook_logs if it exists (will be recreated with proper structure)
DROP TABLE IF EXISTS webhook_logs;

-- 4. Now apply the new wallet schema
-- This will create all the new tables with proper structure

-- Processed events for idempotency
CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Plan catalog
CREATE TABLE IF NOT EXISTS plans (
  plan_id TEXT PRIMARY KEY,
  monthly_quota_tokens INTEGER NOT NULL CHECK (monthly_quota_tokens >= 0),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Wallet balance per subject
CREATE TABLE IF NOT EXISTS wallets (
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user','organization')),
  subject_id   TEXT NOT NULL,
  balance_tokens INTEGER NOT NULL DEFAULT 0,  -- Allow negative balance for accurate billing
  frozen         INTEGER NOT NULL DEFAULT 0 CHECK (frozen IN (0, 1)),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (subject_type, subject_id)
);

-- Wallet ledger with enhanced structure
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user','organization')),
  subject_id   TEXT NOT NULL,
  amount_tokens INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('mint', 'use', 'refund', 'adjust')),
  
  -- Reference to source
  reference_type TEXT, -- 'payment', 'usage', 'refund', 'manual'
  reference_id TEXT,   -- payment_id, usage_log_id, refund_id, etc.
  
  -- For payment events
  plan_id TEXT,
  external_event_id TEXT,
  
  -- Human-readable description
  description TEXT,
  
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (plan_id) REFERENCES plans(plan_id) ON DELETE SET NULL
);

-- Create indexes for wallet_ledger
CREATE INDEX IF NOT EXISTS idx_ledger_subject ON wallet_ledger(subject_type, subject_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ledger_external ON wallet_ledger(external_event_id) WHERE external_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_event_type ON wallet_ledger(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_reference ON wallet_ledger(reference_type, reference_id) WHERE reference_id IS NOT NULL;

-- Entitlements
CREATE TABLE IF NOT EXISTS entitlements (
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user','organization')),
  subject_id   TEXT NOT NULL,
  plan_id      TEXT,
  max_concurrent_sessions INTEGER DEFAULT 1,
  rate_limit_rpm INTEGER DEFAULT 60,
  features TEXT,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (subject_type, subject_id),
  FOREIGN KEY (plan_id) REFERENCES plans(plan_id) ON DELETE SET NULL
);

-- NEW: Usage logs for detailed API usage tracking
CREATE TABLE IF NOT EXISTS usage_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user','organization')),
  subject_id TEXT NOT NULL,
  
  -- API details
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  endpoint TEXT,
  method TEXT,
  
  -- Token usage
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  
  -- Request metadata
  session_id TEXT,
  request_id TEXT,
  response_id TEXT,
  event_type TEXT,
  
  -- Additional details
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  
  -- Reference to wallet ledger entry
  ledger_id TEXT,
  FOREIGN KEY (ledger_id) REFERENCES wallet_ledger(id) ON DELETE SET NULL
);

-- Create indexes for usage_logs
CREATE INDEX IF NOT EXISTS idx_usage_subject ON usage_logs(subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_logs(provider, model, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_logs(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_ledger ON usage_logs(ledger_id) WHERE ledger_id IS NOT NULL;

-- Recreate webhook_logs with proper structure
CREATE TABLE IF NOT EXISTS webhook_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  clerk_user_id TEXT,
  raw_payload TEXT NOT NULL,
  headers TEXT,
  webhook_signature TEXT,
  ip_address TEXT,
  processing_status TEXT DEFAULT 'pending',
  processed_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_id ON webhook_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_clerk_user_id ON webhook_logs(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at DESC);

-- Insert/update plans with proper values
INSERT INTO plans(plan_id, monthly_quota_tokens, price_cents) VALUES
  ('free_plan',                0,    0),      -- 0 tokens, free
  ('starter_plan',     10000000, 1000),      -- 10M tokens, $10
  ('essentials_plan',  20000000, 2000),      -- 20M tokens, $20
  ('pro_plan',         50000000, 5000),      -- 50M tokens, $50
  ('business_plan',   100000000, 10000),     -- 100M tokens, $100
  ('enterprise_plan', 500000000, 50000),     -- 500M tokens, $500
  ('unlimited_plan',  999999999, 99999)      -- Effectively unlimited
ON CONFLICT(plan_id) DO UPDATE SET 
  monthly_quota_tokens = excluded.monthly_quota_tokens, 
  price_cents = excluded.price_cents,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');

-- Create helper view
CREATE VIEW IF NOT EXISTS wallet_summary AS
SELECT 
  w.subject_type,
  w.subject_id,
  w.balance_tokens,
  w.frozen,
  e.plan_id,
  p.monthly_quota_tokens,
  p.price_cents,
  w.updated_at
FROM wallets w
LEFT JOIN entitlements e ON w.subject_type = e.subject_type AND w.subject_id = e.subject_id
LEFT JOIN plans p ON e.plan_id = p.plan_id;

-- Migrate existing users to wallets (with 0 balance, they'll get tokens when they pay)
INSERT OR IGNORE INTO wallets (subject_type, subject_id, balance_tokens)
SELECT 'user', clerk_id, 0 FROM users;

-- Set all users to free plan by default
INSERT OR IGNORE INTO entitlements (subject_type, subject_id, plan_id)
SELECT 'user', clerk_id, 'free_plan' FROM users;