-- Fix for the idx_sessions_active index that has NOW() in predicate
-- This script drops the problematic index so it can be recreated correctly

BEGIN;

-- Drop the problematic index if it exists
DROP INDEX IF EXISTS idx_sessions_active;

-- The corrected index will be created automatically by database.rs on next deployment
-- (without the NOW() function in the WHERE clause)

COMMIT;
