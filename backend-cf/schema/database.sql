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


-- Usage logs table
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  session_id TEXT, -- from response.done event
  response_id TEXT, -- from response.done event
  model TEXT, -- from response.done
  total_tokens INTEGER NOT NULL, -- response.usage.total_tokens
  input_tokens INTEGER NOT NULL, -- response.usage.input_tokens
  output_tokens INTEGER NOT NULL, -- response.usage.output_tokens
  input_token_details TEXT, -- JSON: response.usage.input_token_details
  output_token_details TEXT, -- JSON: response.usage.output_token_details
  metadata TEXT, -- other useful info like conversation_id
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);



-- Indexes for performance (only create if not exists)
CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at);
