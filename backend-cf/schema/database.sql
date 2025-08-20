-- Sokuji D1 Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  image_url TEXT,
  subscription TEXT DEFAULT 'free' CHECK(subscription IN ('free', 'basic', 'premium', 'enterprise')),
  token_quota INTEGER DEFAULT 1000000,
  tokens_used INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


-- Usage logs table - supports flexible usage tracking for various events
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Basic information
  user_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,           -- 'response.done', 'conversation.item.input_audio_transcription.completed', etc.
  event_id TEXT,                       -- Original event ID
  
  -- Session identifier (for linking events from the same session)
  session_id TEXT,                     -- Session ID
  
  -- Model and provider information
  model TEXT NOT NULL,                 -- Model used
  provider TEXT NOT NULL,              -- 'openai', 'comet', etc.
  
  -- Token statistics (core billing fields)
  total_tokens INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  
  -- Detailed token breakdown (JSON)
  input_token_details TEXT,            -- JSON: {text_tokens, audio_tokens, cached_tokens, etc.}
  output_token_details TEXT,           -- JSON: {text_tokens, audio_tokens}
  
  -- Complete original data
  usage_data TEXT,                     -- Complete usage object JSON
  
  -- Additional metadata (includes conversation_id, response_id, item_id, etc.)
  metadata TEXT,                       -- JSON object with all other relevant information
  
  -- Timestamp
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);



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


-- Indexes for performance (only create if not exists)
CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_event_type ON usage_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_usage_logs_session_id ON usage_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_logs_model ON usage_logs(model);
CREATE INDEX IF NOT EXISTS idx_usage_logs_provider ON usage_logs(provider);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_id ON webhook_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_type ON webhook_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_clerk_user_id ON webhook_logs(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_processing_status ON webhook_logs(processing_status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_processed_at ON webhook_logs(processed_at);
