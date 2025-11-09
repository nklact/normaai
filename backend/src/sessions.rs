// Session management module for tracking user sessions and enforcing device limits
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

const MAX_CONCURRENT_SESSIONS: i64 = 5;

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub name: Option<String>,      // "iPhone 14 Pro"
    pub os: Option<String>,         // "iOS 17.2"
    pub browser: Option<String>,    // "Safari"
    pub app_version: Option<String>, // "1.0.0"
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserSession {
    pub id: Uuid,
    pub user_id: Uuid,
    pub device_info: Option<serde_json::Value>,
    pub ip_address: Option<std::net::IpAddr>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_seen_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub revoked: bool,
}

/// Hash an access token using SHA-256 (one-way, secure)
pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Create a new session or update existing one
/// Returns session ID
pub async fn create_or_update_session(
    pool: &Pool<Postgres>,
    user_id: Uuid,
    token: &str,
    device_info: Option<DeviceInfo>,
    ip_address: Option<std::net::IpAddr>,
) -> Result<Uuid, sqlx::Error> {
    let token_hash = hash_token(token);
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(24 * 30); // 30 days
    let device_info_json = device_info.map(|d| serde_json::to_value(d).ok()).flatten();

    // Check if session already exists (same token)
    let existing_session: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM user_sessions WHERE session_token_hash = $1"
    )
    .bind(&token_hash)
    .fetch_optional(pool)
    .await?;

    if let Some((session_id,)) = existing_session {
        // Update existing session's last_seen_at
        sqlx::query(
            "UPDATE user_sessions SET last_seen_at = NOW() WHERE id = $1"
        )
        .bind(session_id)
        .execute(pool)
        .await?;

        return Ok(session_id);
    }

    // Enforce concurrent session limit
    let active_sessions_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_sessions
         WHERE user_id = $1 AND revoked = false AND expires_at > NOW()"
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    if active_sessions_count >= MAX_CONCURRENT_SESSIONS {
        // Revoke oldest session
        sqlx::query(
            "UPDATE user_sessions
             SET revoked = true
             WHERE id = (
                 SELECT id FROM user_sessions
                 WHERE user_id = $1 AND revoked = false
                 ORDER BY last_seen_at ASC
                 LIMIT 1
             )"
        )
        .bind(user_id)
        .execute(pool)
        .await?;
    }

    // Create new session
    let session_id: Uuid = sqlx::query_scalar(
        "INSERT INTO user_sessions (user_id, session_token_hash, device_info, ip_address, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id"
    )
    .bind(user_id)
    .bind(&token_hash)
    .bind(device_info_json)
    .bind(ip_address)
    .bind(expires_at)
    .fetch_one(pool)
    .await?;

    Ok(session_id)
}

/// Validate that a session is active (not revoked, not expired)
/// Also updates last_seen_at timestamp
pub async fn validate_session(
    pool: &Pool<Postgres>,
    token: &str,
) -> Result<bool, sqlx::Error> {
    let token_hash = hash_token(token);

    let is_valid: Option<bool> = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM user_sessions
            WHERE session_token_hash = $1
              AND revoked = false
              AND expires_at > NOW()
        )"
    )
    .bind(&token_hash)
    .fetch_one(pool)
    .await?;

    if is_valid == Some(true) {
        // Update last_seen_at
        sqlx::query(
            "UPDATE user_sessions SET last_seen_at = NOW() WHERE session_token_hash = $1"
        )
        .bind(&token_hash)
        .execute(pool)
        .await?;

        Ok(true)
    } else {
        Ok(false)
    }
}

/// Get all active sessions for a user
pub async fn get_user_sessions(
    pool: &Pool<Postgres>,
    user_id: Uuid,
) -> Result<Vec<UserSession>, sqlx::Error> {
    let sessions = sqlx::query_as::<_, UserSession>(
        "SELECT id, user_id, device_info, ip_address, created_at, last_seen_at, expires_at, revoked
         FROM user_sessions
         WHERE user_id = $1 AND revoked = false AND expires_at > NOW()
         ORDER BY last_seen_at DESC"
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(sessions)
}

/// Revoke a specific session
pub async fn revoke_session(
    pool: &Pool<Postgres>,
    session_id: Uuid,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE user_sessions SET revoked = true
         WHERE id = $1 AND user_id = $2"
    )
    .bind(session_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Revoke all sessions for a user (except optionally the current one)
pub async fn revoke_all_sessions(
    pool: &Pool<Postgres>,
    user_id: Uuid,
    except_token: Option<&str>,
) -> Result<u64, sqlx::Error> {
    let result = if let Some(token) = except_token {
        let token_hash = hash_token(token);
        sqlx::query(
            "UPDATE user_sessions SET revoked = true
             WHERE user_id = $1 AND session_token_hash != $2"
        )
        .bind(user_id)
        .bind(&token_hash)
        .execute(pool)
        .await?
    } else {
        sqlx::query(
            "UPDATE user_sessions SET revoked = true WHERE user_id = $1"
        )
        .bind(user_id)
        .execute(pool)
        .await?
    };

    Ok(result.rows_affected())
}

/// Clean up expired and revoked sessions (should be run periodically)
pub async fn cleanup_sessions(pool: &Pool<Postgres>) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "DELETE FROM user_sessions
         WHERE expires_at < NOW() OR (revoked = true AND last_seen_at < NOW() - INTERVAL '7 days')"
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}
