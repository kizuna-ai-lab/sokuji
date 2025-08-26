-- Add webhook_logs table to record all incoming Clerk webhooks
-- This migration adds comprehensive webhook logging for audit trail and debugging

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

-- Indexes for performance and querying
CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_id ON webhook_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_type ON webhook_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_clerk_user_id ON webhook_logs(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_processing_status ON webhook_logs(processing_status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_processed_at ON webhook_logs(processed_at);