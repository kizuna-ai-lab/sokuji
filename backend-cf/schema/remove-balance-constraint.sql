-- Migration to remove balance constraint from wallets table
-- This allows negative balance for accurate billing
-- Apply with: wrangler d1 execute sokuji-db-prod --file=./schema/remove-balance-constraint.sql

PRAGMA foreign_keys = OFF;

-- Step 1: Create new wallets table without the balance constraint
CREATE TABLE IF NOT EXISTS wallets_new (
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user','organization')),
  subject_id   TEXT NOT NULL,
  balance_tokens INTEGER NOT NULL DEFAULT 0,  -- Removed CHECK constraint to allow negative balance
  frozen         INTEGER NOT NULL DEFAULT 0 CHECK (frozen IN (0, 1)),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (subject_type, subject_id)
);

-- Step 2: Copy data from old table to new table
INSERT INTO wallets_new (subject_type, subject_id, balance_tokens, frozen, updated_at)
SELECT subject_type, subject_id, balance_tokens, frozen, updated_at
FROM wallets;

-- Step 3: Drop old table
DROP TABLE IF EXISTS wallets;

-- Step 4: Rename new table to original name
ALTER TABLE wallets_new RENAME TO wallets;

-- Step 5: Re-enable foreign keys
PRAGMA foreign_keys = ON;

-- Verify the change
SELECT 
  'Migration completed successfully.' as message,
  COUNT(*) as total_wallets,
  SUM(CASE WHEN balance_tokens < 0 THEN 1 ELSE 0 END) as negative_balance_count
FROM wallets;