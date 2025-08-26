-- Sokuji D1 Database Schema
-- Complete database schema including wallet system and enhanced usage tracking
-- Apply with: wrangler d1 execute <DB_NAME> --file=./schema/database.sql

PRAGMA foreign_keys = ON;

-- ============================================
-- BASIC TABLES
-- ============================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  image_url TEXT,
  subscription TEXT DEFAULT 'fallback',
  token_quota INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- WALLET SYSTEM TABLES
-- ============================================

-- Idempotency for webhooks
CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Plan catalog (align plan_id with your Clerk plan/price id)
CREATE TABLE IF NOT EXISTS plans (
  plan_id TEXT PRIMARY KEY,
  monthly_quota_tokens INTEGER NOT NULL CHECK (monthly_quota_tokens >= 0),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Wallet balance per subject (user or organization)
CREATE TABLE IF NOT EXISTS wallets (
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user','organization')),
  subject_id   TEXT NOT NULL,
  balance_tokens INTEGER NOT NULL DEFAULT 0 CHECK (balance_tokens >= 0 OR frozen = 1), -- Allow negative only if frozen
  frozen         INTEGER NOT NULL DEFAULT 0 CHECK (frozen IN (0, 1)),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (subject_type, subject_id)
);

-- Wallet ledger (auditable history, also used for idempotency of mints)
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user','organization')),
  subject_id   TEXT NOT NULL,
  amount_tokens INTEGER NOT NULL, -- +mint / -use / -refund
  event_type TEXT NOT NULL CHECK (event_type IN ('mint', 'use', 'refund', 'adjust')),
  
  -- Reference to source
  reference_type TEXT, -- 'payment', 'usage', 'refund', 'manual'
  reference_id TEXT,   -- payment_id, usage_log_id, refund_id, etc.
  
  -- For payment events
  plan_id TEXT,
  external_event_id TEXT,         -- unique for idempotency (Clerk event ID)
  
  -- Human-readable description
  description TEXT,
  
  metadata TEXT,                   -- JSON for additional context
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (plan_id) REFERENCES plans(plan_id) ON DELETE SET NULL
);

-- Entitlements (current plan for feature gating; balance is independent)
CREATE TABLE IF NOT EXISTS entitlements (
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user','organization')),
  subject_id   TEXT NOT NULL,
  plan_id      TEXT,
  -- Additional feature flags
  max_concurrent_sessions INTEGER DEFAULT 1,
  rate_limit_rpm INTEGER DEFAULT 60,  -- requests per minute
  features TEXT,                       -- JSON array of enabled features
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (subject_type, subject_id),
  FOREIGN KEY (plan_id) REFERENCES plans(plan_id) ON DELETE SET NULL
);

-- ============================================
-- USAGE TRACKING TABLES
-- ============================================

-- Enhanced usage logs table with pricing information
CREATE TABLE IF NOT EXISTS usage_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user','organization')),
  subject_id TEXT NOT NULL,
  
  -- API details
  provider TEXT NOT NULL, -- 'openai', 'gemini', etc.
  model TEXT NOT NULL, -- 'gpt-4o-realtime-preview', etc.
  endpoint TEXT, -- '/v1/chat/completions', '/v1/realtime', etc.
  method TEXT, -- 'POST', 'WS', etc.
  
  -- Raw token usage
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  
  -- Adjusted tokens for billing (with pricing ratios applied)
  adjusted_input_tokens INTEGER,
  adjusted_output_tokens INTEGER,
  adjusted_total_tokens INTEGER,
  
  -- Pricing ratios used
  input_ratio REAL,
  output_ratio REAL,
  
  -- Modality type
  modality TEXT, -- 'text' or 'audio'
  
  -- Request metadata
  session_id TEXT,
  request_id TEXT,
  response_id TEXT,
  event_type TEXT, -- 'response.done', 'conversation.item.input_audio_transcription.completed', etc.
  
  -- Link to wallet ledger
  ledger_id TEXT,
  
  -- Additional metadata (JSON)
  metadata TEXT,
  
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  
  FOREIGN KEY (ledger_id) REFERENCES wallet_ledger(id) ON DELETE SET NULL
);

-- ============================================
-- WEBHOOK TRACKING TABLE
-- ============================================

-- Webhook logs table - records all incoming Clerk webhook events
CREATE TABLE IF NOT EXISTS webhook_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Event identification
  event_id TEXT UNIQUE NOT NULL,        -- Clerk event ID for idempotency
  event_type TEXT NOT NULL,             -- Event type (user.created, session.ended, etc.)
  
  -- User association
  clerk_user_id TEXT,                   -- User ID from webhook (nullable for non-user events)
  
  -- Raw data storage
  raw_payload TEXT NOT NULL,            -- Complete webhook payload JSON
  headers TEXT,                         -- Request headers JSON for debugging
  
  -- Processing tracking
  processed_at DATETIME,                -- When event processing completed
  processing_status TEXT DEFAULT 'pending' CHECK(processing_status IN ('pending', 'success', 'failed')),
  error_message TEXT,                   -- Error details if processing failed
  retry_count INTEGER DEFAULT 0,        -- Number of retry attempts
  
  -- Metadata
  webhook_signature TEXT,               -- Clerk signature for verification audit
  ip_address TEXT,                      -- Source IP for security tracking
  
  -- Timestamps
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Wallet indexes
CREATE INDEX IF NOT EXISTS idx_ledger_subject ON wallet_ledger(subject_type, subject_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ledger_external ON wallet_ledger(external_event_id) WHERE external_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_event_type ON wallet_ledger(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_reference ON wallet_ledger(reference_type, reference_id) WHERE reference_id IS NOT NULL;

-- Usage logs indexes
CREATE INDEX IF NOT EXISTS idx_usage_logs_subject ON usage_logs(subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_provider ON usage_logs(provider);
CREATE INDEX IF NOT EXISTS idx_usage_logs_model ON usage_logs(model);
CREATE INDEX IF NOT EXISTS idx_usage_logs_session_id ON usage_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_event_type ON usage_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_logs_modality ON usage_logs(modality);
CREATE INDEX IF NOT EXISTS idx_usage_logs_ledger_id ON usage_logs(ledger_id);

-- Webhook logs indexes
CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_id ON webhook_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_type ON webhook_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_clerk_user_id ON webhook_logs(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_processing_status ON webhook_logs(processing_status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_processed_at ON webhook_logs(processed_at);

-- ============================================
-- SEED DATA
-- ============================================

-- Seed plans (matching your Clerk plan slugs)
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

-- ============================================
-- VIEWS FOR ANALYSIS (Optional)
-- ============================================

-- View to easily see token adjustments
CREATE VIEW IF NOT EXISTS usage_with_adjustments AS
SELECT 
  ul.id,
  ul.subject_type,
  ul.subject_id,
  ul.provider,
  ul.model,
  ul.modality,
  ul.event_type,
  ul.total_tokens as raw_total_tokens,
  ul.input_tokens as raw_input_tokens,
  ul.output_tokens as raw_output_tokens,
  ul.adjusted_total_tokens,
  ul.adjusted_input_tokens,
  ul.adjusted_output_tokens,
  ul.input_ratio,
  ul.output_ratio,
  ROUND((ul.adjusted_total_tokens - ul.total_tokens) * 100.0 / ul.total_tokens, 2) as adjustment_percentage,
  ul.created_at
FROM usage_logs ul
WHERE ul.adjusted_total_tokens IS NOT NULL;

-- View to see daily token usage with adjustments
CREATE VIEW IF NOT EXISTS daily_usage_summary AS
SELECT 
  DATE(created_at) as usage_date,
  subject_type,
  subject_id,
  provider,
  model,
  modality,
  COUNT(*) as request_count,
  SUM(total_tokens) as raw_tokens_total,
  SUM(adjusted_total_tokens) as adjusted_tokens_total,
  AVG(input_ratio) as avg_input_ratio,
  AVG(output_ratio) as avg_output_ratio,
  ROUND((SUM(adjusted_total_tokens) - SUM(total_tokens)) * 100.0 / SUM(total_tokens), 2) as adjustment_percentage
FROM usage_logs
WHERE adjusted_total_tokens IS NOT NULL
GROUP BY DATE(created_at), subject_type, subject_id, provider, model, modality;

-- View to see profitability by model
CREATE VIEW IF NOT EXISTS model_profitability AS
SELECT 
  provider,
  model,
  modality,
  COUNT(*) as total_requests,
  SUM(total_tokens) as total_raw_tokens,
  SUM(adjusted_total_tokens) as total_adjusted_tokens,
  AVG(input_ratio) as avg_input_ratio,
  AVG(output_ratio) as avg_output_ratio,
  ROUND((SUM(adjusted_total_tokens) * 10.0 / 1000000), 2) as revenue_usd,
  ROUND((SUM(adjusted_total_tokens) - SUM(total_tokens)) * 10.0 / 1000000, 2) as profit_margin_usd
FROM usage_logs
WHERE adjusted_total_tokens IS NOT NULL
GROUP BY provider, model, modality
ORDER BY total_adjusted_tokens DESC;

-- View to see wallet summary with current balance and usage
CREATE VIEW IF NOT EXISTS wallet_summary AS
SELECT 
  w.subject_type,
  w.subject_id,
  w.balance_tokens,
  w.frozen,
  e.plan_id,
  e.max_concurrent_sessions,
  e.rate_limit_rpm,
  e.features,
  (
    SELECT COALESCE(ABS(SUM(amount_tokens)), 0)
    FROM wallet_ledger
    WHERE subject_type = w.subject_type 
      AND subject_id = w.subject_id
      AND event_type = 'use'
      AND created_at >= datetime('now', '-30 days')
  ) as last_30_days_usage,
  w.updated_at
FROM wallets w
LEFT JOIN entitlements e ON w.subject_type = e.subject_type AND w.subject_id = e.subject_id;