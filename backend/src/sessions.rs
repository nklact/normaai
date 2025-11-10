// Session management module for tracking user sessions and enforcing device limits
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Pool, Postgres};
use tracing::{info, warn};
use uuid::Uuid;

const MAX_CONCURRENT_SESSIONS: i64 = 5;

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub session_id: Option<String>,  // Stable UUID per app instance (survives token refresh)
    pub name: Option<String>,        // "iPhone 14 Pro"
    pub os: Option<String>,          // "iOS 17.2"
    pub browser: Option<String>,     // "Safari"
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
    let device_info_json = device_info.as_ref().map(|d| serde_json::to_value(d).ok()).flatten();

    // Check if session already exists (same token)
    let existing_session: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM user_sessions WHERE session_token_hash = $1"
    )
    .bind(&token_hash)
    .fetch_optional(pool)
    .await?;

    if let Some((session_id,)) = existing_session {
        // Update existing session's last_seen_at and device info
        sqlx::query(
            "UPDATE user_sessions
             SET last_seen_at = NOW(),
                 device_info = $1,
                 ip_address = $2
             WHERE id = $3"
        )
        .bind(&device_info_json)
        .bind(ip_address)
        .bind(session_id)
        .execute(pool)
        .await?;

        return Ok(session_id);
    }

    // Token not found - check if this is a token refresh from same device
    // Match by device session_id (stable across token refreshes)
    if let Some(ref device_json) = device_info_json {
        // Extract session_id from device_info JSON
        let device_session_id = device_json
            .get("session_id")
            .and_then(|v| v.as_str());

        if let Some(session_id_str) = device_session_id {
            // Try to find existing session by session_id
            let existing_device_session: Option<(Uuid,)> = sqlx::query_as(
                "SELECT id FROM user_sessions
                 WHERE user_id = $1
                   AND device_info->>'session_id' = $2
                   AND revoked = false
                   AND expires_at > NOW()
                 ORDER BY last_seen_at DESC
                 LIMIT 1"
            )
            .bind(user_id)
            .bind(session_id_str)
            .fetch_optional(pool)
            .await?;

            if let Some((session_id,)) = existing_device_session {
                // Update existing device session with new token (token refresh scenario)
                sqlx::query(
                    "UPDATE user_sessions
                     SET session_token_hash = $1,
                         last_seen_at = NOW(),
                         expires_at = $2,
                         device_info = $3
                     WHERE id = $4"
                )
                .bind(&token_hash)
                .bind(expires_at)
                .bind(device_json)
                .bind(session_id)
                .execute(pool)
                .await?;

                return Ok(session_id);
            }
        }
    }

    // Clean up stale sessions first to avoid hitting limit with expired sessions
    cleanup_user_sessions(pool, user_id).await?;

    // Enforce concurrent session limit
    let active_sessions_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_sessions
         WHERE user_id = $1 AND revoked = false AND expires_at > NOW()"
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    if active_sessions_count >= MAX_CONCURRENT_SESSIONS {
        warn!(
            user_id = %user_id,
            active_sessions = active_sessions_count,
            max_sessions = MAX_CONCURRENT_SESSIONS,
            "Session limit reached, revoking oldest session"
        );

        // Revoke oldest session
        sqlx::query(
            "UPDATE user_sessions
             SET revoked = true
             WHERE id = (
                 SELECT id FROM user_sessions
                 WHERE user_id = $1 AND revoked = false AND expires_at > NOW()
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
///
/// Returns:
/// - Ok(Some(session_id)) if session found and valid
/// - Ok(None) if session not found or invalid
/// - Err(e) on database errors
pub async fn validate_session(
    pool: &Pool<Postgres>,
    token: &str,
) -> Result<Option<Uuid>, sqlx::Error> {
    let token_hash = hash_token(token);

    // Try to find and update the session atomically
    let session_id: Option<Uuid> = sqlx::query_scalar(
        "UPDATE user_sessions
         SET last_seen_at = NOW()
         WHERE session_token_hash = $1
           AND revoked = false
           AND expires_at > NOW()
         RETURNING id"
    )
    .bind(&token_hash)
    .fetch_optional(pool)
    .await?;

    if let Some(id) = session_id {
        info!(session_id = %id, token_hash_prefix = &token_hash[..16], "Session validated");
        Ok(Some(id))
    } else {
        warn!(token_hash_prefix = &token_hash[..16], "Session not found or expired");
        Ok(None)
    }
}

/// Update an existing session with a new token (for token refresh scenarios)
/// This should be called when validation fails but we have a valid JWT
///
/// Returns:
/// - Ok(Some(session_id)) if session was found and updated
/// - Ok(None) if no active session exists for this user
/// - Err(e) on database errors
pub async fn update_session_token(
    pool: &Pool<Postgres>,
    user_id: Uuid,
    new_token: &str,
    device_session_id: Option<&str>,
) -> Result<Option<Uuid>, sqlx::Error> {
    let new_token_hash = hash_token(new_token);
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(24 * 30); // 30 days

    // Strategy: Find the most recent active session for this user and update it
    // Priority: device_session_id match > most recent session
    let session_id: Option<Uuid> = if let Some(device_id) = device_session_id {
        // Try to find session by device_session_id first (most accurate)
        info!(user_id = %user_id, device_session_id = device_id, "Attempting to update session by device_session_id");

        sqlx::query_scalar(
            "UPDATE user_sessions
             SET session_token_hash = $1,
                 last_seen_at = NOW(),
                 expires_at = $2
             WHERE user_id = $3
               AND device_info->>'session_id' = $4
               AND revoked = false
               AND expires_at > NOW()
             RETURNING id"
        )
        .bind(&new_token_hash)
        .bind(expires_at)
        .bind(user_id)
        .bind(device_id)
        .fetch_optional(pool)
        .await?
    } else {
        None
    };

    // If device_session_id match failed or wasn't provided, fall back to most recent session
    if session_id.is_none() {
        info!(user_id = %user_id, "Updating most recent active session (fallback)");

        let fallback_session_id: Option<Uuid> = sqlx::query_scalar(
            "UPDATE user_sessions
             SET session_token_hash = $1,
                 last_seen_at = NOW(),
                 expires_at = $2
             WHERE id = (
                 SELECT id FROM user_sessions
                 WHERE user_id = $3
                   AND revoked = false
                   AND expires_at > NOW()
                 ORDER BY last_seen_at DESC
                 LIMIT 1
             )
             RETURNING id"
        )
        .bind(&new_token_hash)
        .bind(expires_at)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

        if let Some(id) = fallback_session_id {
            info!(user_id = %user_id, session_id = %id, "Session token updated via fallback");
            Ok(Some(id))
        } else {
            warn!(user_id = %user_id, "No active session found to update");
            Ok(None)
        }
    } else {
        info!(user_id = %user_id, session_id = ?session_id, "Session token updated via device_session_id");
        Ok(session_id)
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
/// Returns the number of sessions deleted
pub async fn cleanup_sessions(pool: &Pool<Postgres>) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "DELETE FROM user_sessions
         WHERE expires_at < NOW()
            OR (revoked = true AND last_seen_at < NOW() - INTERVAL '7 days')
            OR (revoked = false AND last_seen_at < NOW() - INTERVAL '90 days')"
    )
    .execute(pool)
    .await?;

    let deleted_count = result.rows_affected();
    if deleted_count > 0 {
        info!(sessions_deleted = deleted_count, "Cleaned up expired/stale sessions");
    }

    Ok(deleted_count)
}

/// Cleanup stale sessions for a specific user
/// This helps prevent hitting the concurrent session limit with expired sessions
pub async fn cleanup_user_sessions(pool: &Pool<Postgres>, user_id: Uuid) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "DELETE FROM user_sessions
         WHERE user_id = $1
           AND (expires_at < NOW()
                OR (revoked = true AND last_seen_at < NOW() - INTERVAL '7 days')
                OR (revoked = false AND last_seen_at < NOW() - INTERVAL '90 days'))"
    )
    .bind(user_id)
    .execute(pool)
    .await?;

    let deleted_count = result.rows_affected();
    if deleted_count > 0 {
        info!(user_id = %user_id, sessions_deleted = deleted_count, "Cleaned up stale sessions for user");
    }

    Ok(deleted_count)
}
