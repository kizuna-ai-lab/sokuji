-- Migration script to update usage_logs table structure
-- This script creates the new table and migrates existing data

-- Step 1: Rename existing table if it exists
DROP TABLE IF EXISTS usage_logs_old;
ALTER TABLE usage_logs RENAME TO usage_logs_old;

-- Step 2: Create new table with updated structure
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

-- Step 3: Migrate existing data (if old table exists)
INSERT INTO usage_logs (
  user_id, event_type, event_id, session_id, model, provider,
  total_tokens, input_tokens, output_tokens,
  input_token_details, output_token_details, usage_data, metadata, created_at
)
SELECT 
  user_id,
  'response.done' as event_type,  -- Assume old records are response.done events
  NULL as event_id,               -- Old table doesn't have event_id
  session_id,
  model,
  'openai' as provider,           -- Default provider for old records
  total_tokens,
  input_tokens,
  output_tokens,
  input_token_details,
  output_token_details,
  JSON_OBJECT(
    'total_tokens', total_tokens,
    'input_tokens', input_tokens,
    'output_tokens', output_tokens,
    'input_token_details', COALESCE(JSON(input_token_details), JSON_OBJECT()),
    'output_token_details', COALESCE(JSON(output_token_details), JSON_OBJECT())
  ) as usage_data,
  JSON_OBJECT(
    'provider', 'openai',
    'response_id', response_id,
    'migrated_metadata', COALESCE(JSON(metadata), JSON_OBJECT())
  ) as metadata,
  created_at
FROM usage_logs_old
WHERE EXISTS (SELECT 1 FROM usage_logs_old LIMIT 1);

-- Step 4: Create indexes
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_event_type ON usage_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_usage_logs_session_id ON usage_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_logs_model ON usage_logs(model);
CREATE INDEX IF NOT EXISTS idx_usage_logs_provider ON usage_logs(provider);

-- Step 5: Drop old table (uncomment when migration is verified)
-- DROP TABLE IF EXISTS usage_logs_old;