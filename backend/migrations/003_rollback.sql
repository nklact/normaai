-- Rollback for Migration 003: Remove partially applied user_sessions migration
BEGIN;

-- Drop indexes if they exist (using IF EXISTS to avoid errors)
DROP INDEX IF EXISTS idx_sessions_cleanup;
DROP INDEX IF EXISTS idx_sessions_active;
DROP INDEX IF EXISTS idx_sessions_token_hash;
DROP INDEX IF EXISTS idx_sessions_user_id;

-- Drop table if it exists
DROP TABLE IF EXISTS user_sessions;

COMMIT;
