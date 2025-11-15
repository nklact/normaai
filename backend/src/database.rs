use crate::models::*;
use crate::simple_auth::verify_any_token;
use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    response::Json as ResponseJson,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::{error, info, warn};
use uuid::Uuid;

type AppState = (PgPool, String, String, Option<String>); // (pool, api_key, jwt_secret, supabase_jwt_secret)

// Async function that supports both custom JWT and Supabase tokens
pub async fn verify_user_from_headers_async(
    headers: &axum::http::HeaderMap,
    jwt_secret: &str,
    supabase_jwt_secret: Option<&str>,
    pool: &sqlx::PgPool,
) -> Option<Uuid> {
    let token = headers
        .get("Authorization")
        .and_then(|auth_header| auth_header.to_str().ok())
        .and_then(|auth_str| auth_str.strip_prefix("Bearer "))?;

    // Verify the JWT token first (validates signature and expiration)
    let user_id = match verify_any_token(token, jwt_secret, supabase_jwt_secret, pool).await {
        Ok(id) => {
            info!(user_id = %id, "JWT verified successfully");
            id
        }
        Err(e) => {
            warn!(error = %e, "JWT verification failed");
            return None;
        }
    };

    // Extract device_session_id from headers for logging
    let device_session_id = headers
        .get("X-Device-Session-Id")
        .and_then(|h| h.to_str().ok());

    // Validate session is not revoked
    match crate::sessions::validate_session(pool, token).await {
        Ok(Some(session_id)) => {
            // Session found and valid
            info!(
                user_id = %user_id,
                session_id = %session_id,
                device_session_id = ?device_session_id,
                "Session validated successfully"
            );
            Some(user_id)
        }
        Ok(None) => {
            // Session not found - this could be a token refresh scenario
            warn!(
                user_id = %user_id,
                device_session_id = ?device_session_id,
                "Session not found - attempting token refresh update"
            );

            // Try to update existing session with new token
            match crate::sessions::update_session_token(pool, user_id, token, device_session_id).await {
                Ok(Some(session_id)) => {
                    info!(
                        user_id = %user_id,
                        session_id = %session_id,
                        device_session_id = ?device_session_id,
                        "Session token updated after refresh"
                    );
                    Some(user_id)
                }
                Ok(None) => {
                    // No session exists - this shouldn't happen if user was logged in
                    // Could indicate session was revoked or expired
                    error!(
                        user_id = %user_id,
                        device_session_id = ?device_session_id,
                        "No active session found - authentication failed"
                    );
                    None
                }
                Err(e) => {
                    error!(
                        user_id = %user_id,
                        device_session_id = ?device_session_id,
                        error = %e,
                        "Session token update error - allowing request (graceful degradation)"
                    );
                    // On error, allow the request to proceed (graceful degradation)
                    // This prevents session table issues from breaking authentication
                    Some(user_id)
                }
            }
        }
        Err(e) => {
            error!(
                user_id = %user_id,
                device_session_id = ?device_session_id,
                error = %e,
                "Session validation error - allowing request (graceful degradation)"
            );
            // On error, allow the request to proceed (graceful degradation)
            // This prevents session table issues from breaking authentication
            Some(user_id)
        }
    }
}

/// Get user by ID from optimized schema
pub async fn get_user(
    user_id: Option<Uuid>,
    pool: &PgPool,
) -> Result<Option<crate::models::User>, sqlx::Error> {
    if let Some(user_id) = user_id {
        // First try to get active user
        let user = sqlx::query_as::<_, crate::models::User>(
            "SELECT * FROM users WHERE id = $1 AND account_status = 'active'",
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

        // If user found and active, return it
        if user.is_some() {
            return Ok(user);
        }

        // Check if user is deleted but within grace period
        let deleted_user = sqlx::query_as::<_, crate::models::User>(
            "SELECT * FROM users WHERE id = $1 AND account_status = 'deleted'",
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

        if let Some(user) = deleted_user {
            if let Some(deleted_at) = user.deleted_at {
                let grace_period_ends = deleted_at + chrono::Duration::days(30);
                if chrono::Utc::now() < grace_period_ends {
                    // Auto-restore user within grace period
                    restore_user(user_id, pool).await?;
                    // Fetch the restored user
                    return sqlx::query_as::<_, crate::models::User>(
                        "SELECT * FROM users WHERE id = $1",
                    )
                    .bind(user_id)
                    .fetch_optional(pool)
                    .await;
                }
            }
        }

        Ok(None)
    } else {
        // No user_id provided - user not authenticated
        Ok(None)
    }
}

/// Get simplified user status - single query instead of multiple JOINs
pub async fn get_user_status_optimized(
    user_id: Option<Uuid>,
    pool: &PgPool,
) -> Result<UserStatusResponse, String> {
    let user = get_user(user_id, pool)
        .await
        .map_err(|e| format!("Failed to get user: {}", e))?;

    if let Some(user) = user {
        // User is authenticated - use actual account type
        let access_type = match user.account_type.as_str() {
            "trial_registered" => "trial",
            "individual" => "individual",
            "professional" => "professional",
            "team" => "team",
            "premium" => "professional", // Migrate existing premium users to professional
            _ => "trial",
        };

        let messages_remaining = match user.account_type.as_str() {
            "professional" | "team" | "premium" => None, // Unlimited
            "individual" => user.trial_messages_remaining, // 20 per month
            _ => user.trial_messages_remaining,          // Trial messages (5 for new registrations)
        };

        // Count total messages sent by this user (for UI hints)
        let total_messages_sent: i32 = if let Some(uid) = user_id {
            // Registered user: count by user_id
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM messages m
                 JOIN chats c ON m.chat_id = c.id
                 WHERE c.user_id = $1 AND m.role = 'user'"
            )
            .bind(uid)
            .fetch_one(pool)
            .await
            .unwrap_or(0) as i32
        } else {
            0
        };

        Ok(UserStatusResponse {
            is_authenticated: user_id.is_some() && user.is_registered(),
            user_id,
            email: Some(user.email.clone()),
            email_verified: user.email_verified,
            oauth_provider: user.oauth_provider.clone(),
            access_type: access_type.to_string(),
            account_type: user.account_type.clone(),
            trial_expires_at: None, // No time-based expiration
            premium_expires_at: user.premium_expires_at,
            subscription_expires_at: user.premium_expires_at,
            messages_used_today: 0, // Not used anymore
            messages_remaining,
            total_messages_sent,
            // Include subscription fields
            subscription_type: user.subscription_type,
            subscription_started_at: user.subscription_started_at,
            next_billing_date: user.next_billing_date,
            subscription_status: user.subscription_status,
        })
    } else {
        // No user found - user needs to register/login
        Ok(UserStatusResponse {
            is_authenticated: false,
            user_id: None,
            email: None,
            email_verified: false,
            oauth_provider: None,
            access_type: "trial".to_string(),
            account_type: "trial_registered".to_string(), // Will be set on registration
            trial_expires_at: None,
            premium_expires_at: None,
            subscription_expires_at: None, // Alias for frontend
            messages_used_today: 0,        // Not used
            messages_remaining: None,      // No trial started yet
            total_messages_sent: 0,        // No messages sent yet
            // No subscription data for unregistered users
            subscription_type: None,
            subscription_started_at: None,
            next_billing_date: None,
            subscription_status: None,
        })
    }
}

pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::Error> {
    // Create optimized tables for new schema

    // 1. Optimized Users table (combines users + subscriptions)
    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            auth_user_id UUID UNIQUE,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            email_verified BOOLEAN DEFAULT false,
            name VARCHAR(255),
            oauth_provider VARCHAR(50),
            oauth_profile_picture_url TEXT,
            account_type VARCHAR(20) DEFAULT 'trial_registered' CHECK (account_type IN ('trial_registered', 'individual', 'professional', 'team', 'premium')),
            account_status VARCHAR(20) DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'deleted')),
            deleted_at TIMESTAMP WITH TIME ZONE,
            trial_started_at TIMESTAMP WITH TIME ZONE,
            trial_expires_at TIMESTAMP WITH TIME ZONE,
            trial_messages_remaining INTEGER DEFAULT 5,
            premium_expires_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            last_login TIMESTAMP WITH TIME ZONE
        )
    "#)
    .execute(pool)
    .await?;

    // 2. Authentication tokens table (replaces email_verification_tokens + password_reset_tokens)
    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS authentication_tokens (
            id BIGSERIAL PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_type VARCHAR(20) NOT NULL CHECK (token_type IN ('email_verification', 'password_reset', 'jwt_refresh')),
            token VARCHAR(255) NOT NULL UNIQUE,
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            used_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    "#)
    .execute(pool)
    .await?;

    // 3. User sessions table for device tracking and concurrent login limits
    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS user_sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            session_token_hash VARCHAR(64) NOT NULL UNIQUE,
            device_info JSONB,
            ip_address INET,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            revoked BOOLEAN NOT NULL DEFAULT false
        )
    "#)
    .execute(pool)
    .await?;

    // 4. Existing core tables
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS chats (
            id BIGSERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS messages (
            id BIGSERIAL PRIMARY KEY,
            chat_id BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            law_name TEXT,
            has_document BOOLEAN DEFAULT FALSE,
            document_filename TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    "#,
    )
    .execute(pool)
    .await?;

    // Add has_document column to existing messages table (migration for existing databases)
    sqlx::query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS has_document BOOLEAN DEFAULT FALSE")
        .execute(pool)
        .await?;

    // Add document_filename column to existing messages table (migration for existing databases)
    sqlx::query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS document_filename TEXT")
        .execute(pool)
        .await?;

    // Add contract fields to messages table (migration for contract generation feature)
    sqlx::query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS contract_file_id TEXT")
        .execute(pool)
        .await?;

    sqlx::query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS contract_type TEXT")
        .execute(pool)
        .await?;

    sqlx::query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS contract_filename TEXT")
        .execute(pool)
        .await?;

    // Add message_feedback column for user feedback tracking
    sqlx::query("ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_feedback VARCHAR(20) CHECK (message_feedback IN ('positive', 'negative'))")
        .execute(pool)
        .await?;

    // Add index for message_feedback for analytics queries
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_messages_feedback ON messages(message_feedback) WHERE message_feedback IS NOT NULL")
        .execute(pool)
        .await?;

    // Add cost tracking columns to existing users table (migration for existing databases)
    sqlx::query("ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_llm_cost_usd DECIMAL(10,2) DEFAULT 0.00")
        .execute(pool)
        .await?;

    sqlx::query("ALTER TABLE users ADD COLUMN IF NOT EXISTS current_cost_month VARCHAR(7) DEFAULT TO_CHAR(NOW(), 'YYYY-MM')")
        .execute(pool)
        .await?;

    // Add team_id column for team plan support
    sqlx::query("ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id UUID")
        .execute(pool)
        .await?;

    // Add trial_messages_remaining column for clean trial implementation
    sqlx::query(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_messages_remaining INTEGER DEFAULT 5",
    )
    .execute(pool)
    .await?;

    // Add auth_user_id column for Supabase integration (links to auth.users)
    sqlx::query(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE",
    )
    .execute(pool)
    .await?;

    // Add name column for user profiles (from OAuth or manual entry)
    sqlx::query(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255)",
    )
    .execute(pool)
    .await?;

    // Add oauth_provider column to track OAuth login method
    sqlx::query(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(50)",
    )
    .execute(pool)
    .await?;

    // Add oauth_profile_picture_url column for user avatars
    sqlx::query(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_profile_picture_url TEXT",
    )
    .execute(pool)
    .await?;

    // Add deleted_at column for soft delete functionality
    sqlx::query(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS law_cache (
            id BIGSERIAL PRIMARY KEY,
            law_name TEXT UNIQUE NOT NULL,
            law_url TEXT NOT NULL,
            content TEXT NOT NULL,
            cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL
        )
    "#,
    )
    .execute(pool)
    .await?;

    // Create optimized indexes
    // Users table indexes
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_users_account_type ON users(account_type)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_users_trial_expires ON users(trial_expires_at) WHERE trial_expires_at IS NOT NULL")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_users_premium_expires ON users(premium_expires_at) WHERE premium_expires_at IS NOT NULL")
        .execute(pool)
        .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_users_team_id ON users(team_id) WHERE team_id IS NOT NULL",
    )
    .execute(pool)
    .await?;

    // Authentication tokens indexes
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON authentication_tokens(user_id)",
    )
    .execute(pool)
    .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON authentication_tokens(token)")
        .execute(pool)
        .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_auth_tokens_type ON authentication_tokens(token_type)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires ON authentication_tokens(expires_at)",
    )
    .execute(pool)
    .await?;

    // User sessions indexes
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON user_sessions(session_token_hash)")
        .execute(pool)
        .await?;
    // Partial index for active sessions (without NOW() which is non-immutable)
    // We filter expires_at > NOW() in queries instead of in the index predicate
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_active ON user_sessions(user_id, last_seen_at DESC) WHERE revoked = false")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_cleanup ON user_sessions(expires_at) WHERE revoked = false")
        .execute(pool)
        .await?;

    // Core table indexes
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_law_cache_name ON law_cache(law_name)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_law_cache_expires ON law_cache(expires_at)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id)")
        .execute(pool)
        .await?;

    Ok(())
}

#[axum::debug_handler]
pub async fn create_chat_handler(
    State((pool, _, jwt_secret, supabase_jwt_secret)): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(request): Json<CreateChatRequest>,
) -> Result<ResponseJson<CreateChatResponse>, StatusCode> {
    // Verify user with Supabase token support
    let user_id = verify_user_from_headers_async(&headers, &jwt_secret, supabase_jwt_secret.as_deref(), &pool)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Registered user: associate chat with user_id
    let result = sqlx::query_scalar::<_, i64>(
        "INSERT INTO chats (title, user_id) VALUES ($1, $2) RETURNING id"
    )
    .bind(request.title)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to create chat: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(ResponseJson(CreateChatResponse { id: result }))
}

#[axum::debug_handler]
pub async fn get_chats_handler(
    State((pool, _, jwt_secret, supabase_jwt_secret)): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<ResponseJson<Vec<Chat>>, StatusCode> {
    // Verify user with Supabase token support
    let user_id = verify_user_from_headers_async(&headers, &jwt_secret, supabase_jwt_secret.as_deref(), &pool)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Get chats by user_id
    let chats = sqlx::query_as::<_, Chat>(
        "SELECT id, title, user_id, created_at, updated_at
         FROM chats
         WHERE user_id = $1
         ORDER BY updated_at DESC"
    )
    .bind(user_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to fetch chats: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(ResponseJson(chats))
}

#[axum::debug_handler]
pub async fn get_messages_handler(
    State((pool, _, jwt_secret, supabase_jwt_secret)): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(chat_id): Path<i64>,
) -> Result<ResponseJson<Vec<Message>>, StatusCode> {
    // Verify user with Supabase token support
    let user_id = verify_user_from_headers_async(&headers, &jwt_secret, supabase_jwt_secret.as_deref(), &pool)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Verify the user owns this chat
    let chat_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM chats WHERE id = $1 AND user_id = $2)"
    )
    .bind(chat_id)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to verify chat ownership: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if !chat_exists {
        return Err(StatusCode::NOT_FOUND);
    }

    // If ownership is verified, get the messages
    let messages = sqlx::query_as::<_, Message>(
        "SELECT id, chat_id, role, content, law_name, has_document, document_filename, contract_file_id, contract_type, contract_filename, message_feedback, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC"
    )
    .bind(chat_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to fetch messages: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(ResponseJson(messages))
}

#[axum::debug_handler]
pub async fn add_message_handler(
    State((pool, _, jwt_secret, supabase_jwt_secret)): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(request): Json<AddMessageRequest>,
) -> Result<StatusCode, StatusCode> {
    let user_id = verify_user_from_headers_async(&headers, &jwt_secret, supabase_jwt_secret.as_deref(), &pool).await;

    // Only authenticated users can add messages
    let user_id = user_id.ok_or(StatusCode::UNAUTHORIZED)?;

    // Verify the user owns this chat
    let chat_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM chats WHERE id = $1 AND user_id = $2)"
    )
    .bind(request.chat_id)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to verify chat ownership for message: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if !chat_exists {
        return Err(StatusCode::NOT_FOUND);
    }

    // If ownership is verified, insert the message
    sqlx::query("INSERT INTO messages (chat_id, role, content, law_name) VALUES ($1, $2, $3, $4)")
        .bind(request.chat_id)
        .bind(request.role)
        .bind(request.content)
        .bind(request.law_name)
        .execute(&pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to add message: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Update the chat's updated_at timestamp
    sqlx::query("UPDATE chats SET updated_at = NOW() WHERE id = $1")
        .bind(request.chat_id)
        .execute(&pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to update chat timestamp: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(StatusCode::OK)
}

#[axum::debug_handler]
pub async fn delete_chat_handler(
    State((pool, _, jwt_secret, supabase_jwt_secret)): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(chat_id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    // Verify user with Supabase token support
    let user_id = verify_user_from_headers_async(&headers, &jwt_secret, supabase_jwt_secret.as_deref(), &pool)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Delete the chat only if the user owns it (CASCADE will automatically delete associated messages)
    let result = sqlx::query("DELETE FROM chats WHERE id = $1 AND user_id = $2")
        .bind(chat_id)
        .bind(user_id)
        .execute(&pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to delete chat: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if result.rows_affected() == 0 {
        // Chat not found or user doesn't own it
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(StatusCode::OK)
}

#[derive(Deserialize)]
pub struct UpdateChatTitleRequest {
    pub title: String,
}

#[derive(Serialize)]
pub struct UpdateChatTitleResponse {
    pub success: bool,
    pub message: String,
}

pub async fn update_chat_title_handler(
    State((pool, _, jwt_secret, supabase_jwt_secret)): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(chat_id): Path<i64>,
    Json(request): Json<UpdateChatTitleRequest>,
) -> Result<ResponseJson<UpdateChatTitleResponse>, StatusCode> {
    // Verify user with Supabase token support
    let user_id = verify_user_from_headers_async(&headers, &jwt_secret, supabase_jwt_secret.as_deref(), &pool)
        .await
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Update the chat title only if the user owns it
    let rows_affected = sqlx::query(
        "UPDATE chats SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3"
    )
    .bind(&request.title)
    .bind(chat_id)
    .bind(user_id)
    .execute(&pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to update chat title: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if rows_affected.rows_affected() == 0 {
        // Chat not found or user doesn't own it
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(ResponseJson(UpdateChatTitleResponse {
        success: true,
        message: "Chat title updated successfully".to_string(),
    }))
}

pub async fn get_cached_law_handler(
    State((pool, _, _, _)): State<AppState>,
    Json(request): Json<GetCachedLawRequest>,
) -> Result<ResponseJson<Option<LawCache>>, StatusCode> {
    let cached_law = sqlx::query_as::<_, LawCache>(
        "SELECT id, law_name, law_url, content, cached_at, expires_at FROM law_cache WHERE law_name = $1 AND expires_at > NOW() LIMIT 1"
    )
    .bind(request.law_name)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to check cached law: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(ResponseJson(cached_law))
}

pub async fn cache_law(
    law_name: String,
    law_url: String,
    content: String,
    expires_hours: i64,
    pool: &PgPool,
) -> Result<(), String> {
    // Insert or replace the cached law with expiration calculation
    sqlx::query("INSERT INTO law_cache (law_name, law_url, content, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour' * $4) ON CONFLICT (law_name) DO UPDATE SET law_url = $2, content = $3, cached_at = NOW(), expires_at = NOW() + INTERVAL '1 hour' * $4")
        .bind(law_name)
        .bind(law_url)
        .bind(content)
        .bind(expires_hours)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to cache law: {}", e))?;

    Ok(())
}

// ==================== USAGE TRACKING FUNCTIONS ====================

/// Decrement trial message count for users with limited messages
pub async fn decrement_trial_message(
    user_id: Option<Uuid>,
    pool: &PgPool,
) -> Result<(), String> {
    let user_id = user_id.ok_or("User not authenticated".to_string())?;

    // For registered users, decrement their trial_messages_remaining
    let rows_affected = sqlx::query(
        "UPDATE users SET trial_messages_remaining = trial_messages_remaining - 1, updated_at = NOW()
         WHERE id = $1 AND account_type NOT IN ('professional', 'team', 'premium') AND trial_messages_remaining > 0"
    )
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to decrement user trial messages: {}", e))?
    .rows_affected();

    if rows_affected == 0 {
        return Err("No messages remaining or user has unlimited plan".to_string());
    }

    Ok(())
}

/// Check if user can send a message (has trial messages remaining or is premium)
pub async fn can_send_message(
    user_id: Option<Uuid>,
    pool: &PgPool,
) -> Result<bool, String> {
    let user_id = user_id.ok_or("User not authenticated".to_string())?;

    // Auto-reset Individual plan users' monthly limits if needed
    auto_reset_individual_monthly_limits(pool).await?;

    let user = get_user(Some(user_id), pool)
        .await
        .map_err(|e| format!("Failed to get user: {}", e))?;

    if let Some(user) = user {
        // Check if paid subscription expired
        if let Some(expires_at) = user.premium_expires_at {
            if expires_at < chrono::Utc::now() {
                // Subscription expired - user reverts to trial behavior
                // Note: During grace period, subscription_status is "active" so this won't trigger
                return Ok(user.trial_messages_remaining.unwrap_or(0) > 0);
            }
        }

        // Professional and Premium users have unlimited messages (if not expired)
        // Grace period users keep access until expiration
        if matches!(user.account_type.as_str(), "professional" | "premium") {
            return Ok(true);
        }

        // Trial and Individual users must have messages remaining
        Ok(user.trial_messages_remaining.unwrap_or(0) > 0)
    } else {
        Ok(false)
    }
}

/// Auto-reset monthly message limits for Individual users when their monthly cycle renews
/// This checks if a month has passed since their subscription started and resets accordingly
pub async fn auto_reset_individual_monthly_limits(pool: &PgPool) -> Result<i64, String> {
    let rows_affected = sqlx::query(
        "UPDATE users SET
            trial_messages_remaining = 20,
            updated_at = NOW()
         WHERE account_type = 'individual'
           AND subscription_started_at IS NOT NULL
           AND (
               -- If trial_messages_remaining is NULL, this is their first reset
               trial_messages_remaining IS NULL
               -- Or if they have no messages left and a month has passed since last reset
               OR (trial_messages_remaining = 0 AND
                   EXTRACT(EPOCH FROM (NOW() - COALESCE(updated_at, subscription_started_at))) >= 30 * 24 * 3600)
           )"
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to auto-reset monthly message limits: {}", e))?
    .rows_affected();

    if rows_affected > 0 {
        println!(
            "🔄 Auto-reset monthly limits for {} Individual plan users",
            rows_affected
        );
    }

    Ok(rows_affected as i64)
}

// ==================== LLM COST TRACKING FUNCTIONS ====================

/// Estimate LLM cost based on character count (rough approximation)
pub fn estimate_llm_cost(input_chars: usize, output_chars: usize) -> f64 {
    // Rough estimation: 1 token ≈ 4 characters
    let input_tokens = input_chars / 4;
    let output_tokens = output_chars / 4;

    // Gemini 2.5 Pro pricing: $1.25/M input tokens, $10/M output tokens
    let input_cost = (input_tokens as f64 / 1_000_000.0) * 1.25;
    let output_cost = (output_tokens as f64 / 1_000_000.0) * 10.0;

    input_cost + output_cost
}

/// Track LLM usage cost for a user, automatically handling monthly resets
pub async fn track_llm_cost(
    user_id: Option<Uuid>,
    estimated_cost_usd: f64,
    pool: &PgPool,
) -> Result<(), String> {
    let current_month = chrono::Utc::now().format("%Y-%m").to_string();

    if let Some(user_id) = user_id {
        // Track by user_id
        sqlx::query(
            r#"
            UPDATE users
            SET monthly_llm_cost_usd = CASE
                WHEN current_cost_month = $2 THEN monthly_llm_cost_usd + $3
                ELSE $3
            END,
            current_cost_month = $2,
            updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(user_id)
        .bind(&current_month)
        .bind(estimated_cost_usd)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to track LLM cost for user: {}", e))?;
    }

    Ok(())
}

/// Submit or update feedback for a message
#[axum::debug_handler]
pub async fn submit_message_feedback_handler(
    State((pool, _, jwt_secret, supabase_jwt_secret)): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(message_id): Path<i64>,
    Json(request): Json<crate::models::SubmitFeedbackRequest>,
) -> Result<ResponseJson<crate::models::SubmitFeedbackResponse>, StatusCode> {
    println!("🔍 BACKEND: Feedback request received for message_id={}, feedback_type={}", message_id, request.feedback_type);

    let user_id = verify_user_from_headers_async(&headers, &jwt_secret, supabase_jwt_secret.as_deref(), &pool).await;
    println!("🔍 BACKEND: User info - user_id={:?}", user_id);

    // Validate feedback_type
    if request.feedback_type != "positive" && request.feedback_type != "negative" {
        println!("❌ BACKEND: Invalid feedback_type: {}", request.feedback_type);
        return Err(StatusCode::BAD_REQUEST);
    }

    // First, verify the message exists and user has access to it
    // Get the chat_id for this message
    let chat_id_result: Option<i64> = sqlx::query_scalar(
        "SELECT chat_id FROM messages WHERE id = $1"
    )
    .bind(message_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to fetch message: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let chat_id = match chat_id_result {
        Some(id) => id,
        None => return Err(StatusCode::NOT_FOUND),
    };

    // Verify user owns this chat
    let user_id = user_id.ok_or(StatusCode::UNAUTHORIZED)?;

    let chat_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM chats WHERE id = $1 AND user_id = $2)",
    )
    .bind(chat_id)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to verify chat ownership: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if !chat_exists {
        return Err(StatusCode::FORBIDDEN);
    }

    // Check if feedback already exists for this message
    let existing_feedback: Option<String> = sqlx::query_scalar(
        "SELECT message_feedback FROM messages WHERE id = $1"
    )
    .bind(message_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to check existing feedback: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let updated = existing_feedback.is_some() && existing_feedback.as_deref() != Some(&request.feedback_type);

    // Update the feedback
    sqlx::query(
        "UPDATE messages SET message_feedback = $1 WHERE id = $2"
    )
    .bind(&request.feedback_type)
    .execute(&pool)
    .await
    .map_err(|e| {
        eprintln!("❌ BACKEND: Failed to update message feedback: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    println!("✅ BACKEND: Feedback submitted successfully for message_id={}, updated={}", message_id, updated);

    Ok(ResponseJson(crate::models::SubmitFeedbackResponse {
        success: true,
        message: "Feedback submitted successfully".to_string(),
        updated,
    }))
}

// ============================================================================
// Account Deletion Functions
// ============================================================================

/// Mark user account as deleted (soft delete)
pub async fn soft_delete_user(
    user_id: Uuid,
    pool: &PgPool,
) -> Result<chrono::DateTime<chrono::Utc>, sqlx::Error> {
    let deleted_at = chrono::Utc::now();

    sqlx::query(
        r#"
        UPDATE users
        SET account_status = 'deleted',
            deleted_at = $1,
            updated_at = $1
        WHERE id = $2
        "#
    )
    .bind(deleted_at)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(deleted_at)
}

/// Restore user account from soft delete (within grace period)
pub async fn restore_user(
    user_id: Uuid,
    pool: &PgPool,
) -> Result<User, sqlx::Error> {
    let user = sqlx::query_as::<_, User>(
        r#"
        UPDATE users
        SET account_status = 'active',
            deleted_at = NULL,
            updated_at = NOW()
        WHERE id = $1
          AND account_status = 'deleted'
          AND deleted_at IS NOT NULL
          AND deleted_at > NOW() - INTERVAL '30 days'
        RETURNING *
        "#
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(user)
}

/// Check if user is within 30-day grace period
pub async fn is_within_grace_period(
    user_id: Uuid,
    pool: &PgPool,
) -> Result<bool, sqlx::Error> {
    let result: Option<(Option<chrono::DateTime<chrono::Utc>>,)> = sqlx::query_as(
        r#"
        SELECT deleted_at
        FROM users
        WHERE id = $1
          AND account_status = 'deleted'
          AND deleted_at IS NOT NULL
        "#
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    if let Some((Some(deleted_at),)) = result {
        let grace_period_ends = deleted_at + chrono::Duration::days(30);
        return Ok(chrono::Utc::now() < grace_period_ends);
    }

    Ok(false)
}

/// Permanently delete user and all associated data
pub async fn permanently_delete_user(
    user_id: Uuid,
    pool: &PgPool,
) -> Result<(), sqlx::Error> {
    // Get auth_user_id to delete from Supabase auth.users (which cascades to users table)
    let auth_user_id: Option<(Option<Uuid>,)> = sqlx::query_as(
        "SELECT auth_user_id FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    if let Some((Some(auth_id),)) = auth_user_id {
        // Delete from Supabase auth.users (cascades to users table via FK)
        sqlx::query("DELETE FROM auth.users WHERE id = $1")
            .bind(auth_id)
            .execute(pool)
            .await?;
    } else {
        // Fallback: Direct deletion if no auth_user_id
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(user_id)
            .execute(pool)
            .await?;
    }

    Ok(())
}

/// Get users whose grace period has expired (for cleanup job)
pub async fn get_expired_deleted_users(pool: &PgPool) -> Result<Vec<Uuid>, sqlx::Error> {
    let records: Vec<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT id
        FROM users
        WHERE account_status = 'deleted'
          AND deleted_at IS NOT NULL
          AND deleted_at < NOW() - INTERVAL '30 days'
        "#
    )
    .fetch_all(pool)
    .await?;

    Ok(records.into_iter().map(|(id,)| id).collect())
}

/// Check if user is team admin (has team_id and other users in the same team)
pub async fn is_team_admin(
    user_id: Uuid,
    pool: &PgPool,
) -> Result<bool, sqlx::Error> {
    // A user is considered team admin if they have account_type = 'team' and team_id is set
    // This is a simplified check - you may need to adjust based on your team structure
    let result: Option<(String, Option<Uuid>)> = sqlx::query_as(
        r#"
        SELECT account_type, team_id
        FROM users
        WHERE id = $1
        "#
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    if let Some((account_type, Some(team_id))) = result {
        // Check if user is team type and has team_id
        if account_type == "team" {
            // Check if there are other users in the team
            let team_members_count: (i64,) = sqlx::query_as(
                r#"
                SELECT COUNT(*)
                FROM users
                WHERE team_id = $1 AND id != $2 AND account_status = 'active'
                "#
            )
            .bind(team_id)
            .bind(user_id)
            .fetch_one(pool)
            .await?;

            return Ok(team_members_count.0 > 0);
        }
    }

    Ok(false)
}

/// Cancel user's subscription (used during account deletion)
/// Sets subscription to 'cancelled' but keeps access until billing period ends
pub async fn cancel_subscription(
    user_id: Uuid,
    pool: &PgPool,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE users
        SET premium_expires_at = next_billing_date,
            subscription_type = NULL,
            subscription_started_at = NULL,
            next_billing_date = NULL,
            subscription_status = 'cancelled',
            updated_at = NOW()
        WHERE id = $1
        "#
    )
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(())
}
