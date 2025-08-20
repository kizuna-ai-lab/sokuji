-- Migration: Remove subscription CHECK constraint
-- SQLite doesn't support dropping CHECK constraints directly, so we need to recreate the table

-- Step 1: Create new users table without CHECK constraint
CREATE TABLE users_new (
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

-- Step 2: Copy data from old table to new table
INSERT INTO users_new (id, clerk_id, email, first_name, last_name, image_url, subscription, token_quota, tokens_used, created_at, updated_at)
SELECT id, clerk_id, email, first_name, last_name, image_url, subscription, token_quota, tokens_used, created_at, updated_at
FROM users;

-- Step 3: Drop old table
DROP TABLE users;

-- Step 4: Rename new table to original name
ALTER TABLE users_new RENAME TO users;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);