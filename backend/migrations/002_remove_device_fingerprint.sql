-- Migration: Remove Device Fingerprint and Anonymous Trials
-- Date: 2025-11-07
-- Description: Clean up device fingerprint system and enforce login-required architecture

-- IMPORTANT: This migration is DESTRUCTIVE. Back up your database first!

BEGIN;

-- Step 1: Drop the ip_trial_limits table (no longer needed)
DROP TABLE IF EXISTS ip_trial_limits CASCADE;

-- Step 2: Delete all trial_unregistered users (anonymous trials)
DELETE FROM users WHERE account_type = 'trial_unregistered';

-- Step 3: Remove device_fingerprint column from users table
ALTER TABLE users DROP COLUMN IF EXISTS device_fingerprint;

-- Step 4: Make user_id required in chats table (all chats must belong to a registered user)
-- First, delete any orphaned chats without a user_id
DELETE FROM chats WHERE user_id IS NULL;

-- Then make user_id NOT NULL
ALTER TABLE chats ALTER COLUMN user_id SET NOT NULL;

-- Step 5: Update account_type constraint to remove 'trial_unregistered'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_type_check;
ALTER TABLE users ADD CONSTRAINT users_account_type_check
  CHECK (account_type IN ('trial_registered', 'individual', 'professional', 'team', 'premium'));

-- Step 6: Drop indexes related to device_fingerprint
DROP INDEX IF EXISTS idx_users_device_fingerprint;
DROP INDEX IF EXISTS idx_chats_device_fingerprint;

COMMIT;

-- Verification queries (run these after migration to verify):
-- SELECT COUNT(*) FROM users WHERE account_type = 'trial_unregistered'; -- Should be 0
-- SELECT COUNT(*) FROM chats WHERE user_id IS NULL; -- Should be 0
-- \d users -- Check that device_fingerprint column is gone
-- \d chats -- Check that user_id is NOT NULL
