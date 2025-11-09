-- Migration 003: Add user sessions table for device tracking and concurrent login limits
BEGIN;

-- Create user_sessions table for tracking active sessions
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA256 hash of access token
    device_info JSONB, -- {name: "iPhone 14", os: "iOS 17", browser: "Safari"}
    ip_address INET, -- For security monitoring only
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT false
);

-- Create indexes for efficient queries
CREATE INDEX idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON user_sessions(session_token_hash);
-- Partial index for active sessions (without NOW() which is non-immutable)
-- We filter active sessions in queries instead of in the index predicate
CREATE INDEX idx_sessions_active ON user_sessions(user_id, last_seen_at DESC)
    WHERE revoked = false;
CREATE INDEX idx_sessions_cleanup ON user_sessions(expires_at)
    WHERE revoked = false;

COMMIT;
