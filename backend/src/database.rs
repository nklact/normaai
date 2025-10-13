use crate::models::*;
use crate::simple_auth::verify_token;
use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    response::Json as ResponseJson,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

type AppState = (PgPool, String, String); // (pool, api_key, jwt_secret)

// Helper function to extract user information from headers
pub fn extract_user_info(
    headers: &axum::http::HeaderMap,
    jwt_secret: &str,
) -> (Option<Uuid>, Option<String>) {
    // First try to get device fingerprint
    let device_fingerprint = headers
        .get("X-Device-Fingerprint")
        .and_then(|header| header.to_str().ok())
        .map(|s| s.to_string());

    // Then try to get user ID from JWT token
    let user_id = headers
        .get("Authorization")
        .and_then(|auth_header| auth_header.to_str().ok())
        .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
        .and_then(|token| verify_token(token, jwt_secret).ok())
        .and_then(|claims| Uuid::parse_str(&claims.sub).ok());

    (user_id, device_fingerprint)
}

/// Get user by ID or device fingerprint from optimized schema
pub async fn get_user(
    user_id: Option<Uuid>,
    device_fingerprint: Option<String>,
    pool: &PgPool,
) -> Result<Option<crate::models::User>, sqlx::Error> {
    if let Some(user_id) = user_id {
        // Get by user ID for registered users
        sqlx::query_as::<_, crate::models::User>(
            "SELECT * FROM users WHERE id = $1 AND account_status = 'active'",
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await
    } else if let Some(device_fp) = device_fingerprint {
        // Get by device fingerprint - only device trial records when logged out
        sqlx::query_as::<_, crate::models::User>(
            "SELECT * FROM users WHERE device_fingerprint = $1 AND account_type = 'trial_unregistered' AND account_status = 'active'"
        )
        .bind(device_fp)
        .fetch_optional(pool)
        .await
    } else {
        Ok(None)
    }
}

/// Get simplified user status - single query instead of multiple JOINs
pub async fn get_user_status_optimized(
    user_id: Option<Uuid>,
    device_fingerprint: Option<String>,
    pool: &PgPool,
) -> Result<UserStatusResponse, String> {
    let user = get_user(user_id, device_fingerprint.clone(), pool)
        .await
        .map_err(|e| format!("Failed to get user: {}", e))?;

    if let Some(user) = user {
        // When logged out (no user_id), always treat as trial regardless of account type
        // When logged in, use actual account type
        let (access_type, messages_remaining) = if user_id.is_none() {
            // Logged out - always show trial status based on device fingerprint
            ("trial", user.trial_messages_remaining)
        } else {
            // Logged in - use actual account status
            let access_type = match user.account_type.as_str() {
                "trial_unregistered" => "trial",
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
                _ => user.trial_messages_remaining,          // Trial messages
            };

            (access_type, messages_remaining)
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
        } else if let Some(ref device_fp) = device_fingerprint {
            // Trial user: count by device_fingerprint
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM messages m
                 JOIN chats c ON m.chat_id = c.id
                 WHERE c.device_fingerprint = $1 AND m.role = 'user'"
            )
            .bind(device_fp)
            .fetch_one(pool)
            .await
            .unwrap_or(0) as i32
        } else {
            0
        };

        Ok(UserStatusResponse {
            is_authenticated: user_id.is_some() && user.is_registered(), // Only authenticated if logged in
            user_id: user_id, // Only expose user_id if logged in
            email: if user_id.is_some() && !user.email.contains("@trial.local") {
                Some(user.email)
            } else {
                None
            },
            access_type: access_type.to_string(),
            account_type: if user_id.is_some() {
                user.account_type.clone()
            } else {
                "trial_unregistered".to_string()
            },
            trial_expires_at: None, // No time-based expiration anymore
            premium_expires_at: if user_id.is_some() {
                user.premium_expires_at
            } else {
                None
            },
            subscription_expires_at: if user_id.is_some() {
                user.premium_expires_at
            } else {
                None
            },
            messages_used_today: 0, // Not used anymore
            messages_remaining,
            total_messages_sent,
            // Include subscription fields only when logged in
            subscription_type: if user_id.is_some() {
                user.subscription_type
            } else {
                None
            },
            subscription_started_at: if user_id.is_some() {
                user.subscription_started_at
            } else {
                None
            },
            next_billing_date: if user_id.is_some() {
                user.next_billing_date
            } else {
                None
            },
            subscription_status: if user_id.is_some() {
                user.subscription_status
            } else {
                None
            },
        })
    } else {
        // No user found - they need to start trial first
        Ok(UserStatusResponse {
            is_authenticated: false,
            user_id: None,
            email: None,
            access_type: "trial".to_string(), // Frontend expects this
            account_type: "trial_unregistered".to_string(), // Internal use
            trial_expires_at: None,           // No time-based expiration
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

    // 1. Optimized Users table (combines users + device_fingerprints + subscriptions)
    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            email_verified BOOLEAN DEFAULT false,
            account_type VARCHAR(20) DEFAULT 'trial_registered' CHECK (account_type IN ('trial_unregistered', 'trial_registered', 'individual', 'professional', 'team', 'premium')),
            account_status VARCHAR(20) DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'deleted')),
            device_fingerprint VARCHAR(255),
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

    // 3. Usage logs table (replaces usage_tracking + ip_tracking)
    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS usage_logs (
            id BIGSERIAL PRIMARY KEY,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            device_fingerprint VARCHAR(255),
            ip_address INET,
            activity_type VARCHAR(20) DEFAULT 'message' CHECK (activity_type IN ('message', 'login', 'trial_start')),
            date DATE DEFAULT CURRENT_DATE,
            count INTEGER DEFAULT 1,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE (user_id, device_fingerprint, ip_address, activity_type, date)
        )
    "#)
    .execute(pool)
    .await?;

    // 4. IP Trial Limits table (simplified version of usage_logs for IP limiting only)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS ip_trial_limits (
            id BIGSERIAL PRIMARY KEY,
            ip_address INET NOT NULL,
            date DATE DEFAULT CURRENT_DATE,
            count INTEGER DEFAULT 1,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE (ip_address)
        )
    "#,
    )
    .execute(pool)
    .await?;

    // Migration: Update unique constraint to lifetime (ip_address only, not per date)
    // Drop old constraint if it exists
    sqlx::query(
        r#"
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'ip_trial_limits_ip_address_date_key'
            ) THEN
                ALTER TABLE ip_trial_limits DROP CONSTRAINT ip_trial_limits_ip_address_date_key;
            END IF;
        END $$;
    "#,
    )
    .execute(pool)
    .await
    .ok(); // Ignore errors if constraint doesn't exist

    // Add new unique constraint if not exists
    sqlx::query(
        r#"
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'ip_trial_limits_ip_address_key'
            ) THEN
                ALTER TABLE ip_trial_limits ADD CONSTRAINT ip_trial_limits_ip_address_key UNIQUE (ip_address);
            END IF;
        END $$;
    "#,
    )
    .execute(pool)
    .await
    .ok(); // Ignore errors if constraint already exists

    // Migration: Move existing trial data from usage_logs to ip_trial_limits
    // Aggregate all trials per IP (lifetime, not per day)
    sqlx::query(
        r#"
        INSERT INTO ip_trial_limits (ip_address, count, created_at)
        SELECT ip_address, SUM(count) as total_count, MIN(created_at) as first_trial
        FROM usage_logs
        WHERE activity_type = 'trial_start' AND ip_address IS NOT NULL
        GROUP BY ip_address
        ON CONFLICT (ip_address) DO NOTHING
    "#,
    )
    .execute(pool)
    .await
    .unwrap_or_else(|e| {
        println!(
            "Migration note: Could not migrate existing data (table may not exist): {}",
            e
        );
        Default::default()
    });

    // 5. Existing core tables (unchanged)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS chats (
            id BIGSERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            device_fingerprint VARCHAR(255),
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
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_users_device_fingerprint ON users(device_fingerprint) WHERE device_fingerprint IS NOT NULL")
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

    // IP trial limits indexes
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_ip_trial_limits_ip ON ip_trial_limits(ip_address)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_ip_trial_limits_date ON ip_trial_limits(date)")
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
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_chats_device_fingerprint ON chats(device_fingerprint)",
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[axum::debug_handler]
pub async fn create_chat_handler(
    State((pool, _, jwt_secret)): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(request): Json<CreateChatRequest>,
) -> Result<ResponseJson<CreateChatResponse>, StatusCode> {
    let (user_id, device_fingerprint) = extract_user_info(&headers, &jwt_secret);

    // Use the device_fingerprint from headers, not from request body for security
    let actual_device_fingerprint = device_fingerprint.or(request.device_fingerprint);

    let result = if let Some(user_id) = user_id {
        // Registered user: associate chat with user_id
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO chats (title, user_id, device_fingerprint) VALUES ($1, $2, $3) RETURNING id"
        )
        .bind(request.title)
        .bind(user_id)
        .bind(actual_device_fingerprint)
        .fetch_one(&pool)
        .await
    } else if let Some(device_fp) = actual_device_fingerprint {
        // Trial user: associate with device fingerprint only
        sqlx::query_scalar::<_, i64>(
            "INSERT INTO chats (title, device_fingerprint) VALUES ($1, $2) RETURNING id",
        )
        .bind(request.title)
        .bind(device_fp)
        .fetch_one(&pool)
        .await
    } else {
        // No valid authentication: reject
        return Err(StatusCode::UNAUTHORIZED);
    };

    let result = result.map_err(|e| {
        eprintln!("Failed to create chat: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(ResponseJson(CreateChatResponse { id: result }))
}

#[axum::debug_handler]
pub async fn get_chats_handler(
    State((pool, _, jwt_secret)): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<ResponseJson<Vec<Chat>>, StatusCode> {
    let (user_id, device_fingerprint) = extract_user_info(&headers, &jwt_secret);

    // Build query with proper filtering for user isolation
    let chats = if let Some(user_id) = user_id {
        // Registered user: get their chats only
        sqlx::query_as::<_, Chat>(
            "SELECT id, title, user_id, device_fingerprint, created_at, updated_at 
             FROM chats 
             WHERE user_id = $1 
             ORDER BY updated_at DESC",
        )
        .bind(user_id)
        .fetch_all(&pool)
        .await
    } else if let Some(device_fp) = device_fingerprint {
        // Trial user: get chats for this device only
        sqlx::query_as::<_, Chat>(
            "SELECT id, title, user_id, device_fingerprint, created_at, updated_at 
             FROM chats 
             WHERE user_id IS NULL AND device_fingerprint = $1 
             ORDER BY updated_at DESC",
        )
        .bind(device_fp)
        .fetch_all(&pool)
        .await
    } else {
        // No valid authentication: return empty
        Ok(Vec::new())
    };

    let chats = chats.map_err(|e| {
        eprintln!("Failed to fetch chats: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(ResponseJson(chats))
}

#[axum::debug_handler]
pub async fn get_messages_handler(
    State((pool, _, jwt_secret)): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(chat_id): Path<i64>,
) -> Result<ResponseJson<Vec<Message>>, StatusCode> {
    let (user_id, device_fingerprint) = extract_user_info(&headers, &jwt_secret);

    // First, verify the user owns this chat
    let chat_exists = if let Some(user_id) = user_id {
        // Registered user: check if chat belongs to them
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM chats WHERE id = $1 AND user_id = $2)",
        )
        .bind(chat_id)
        .bind(user_id)
        .fetch_one(&pool)
        .await
    } else if let Some(device_fp) = device_fingerprint {
        // Trial user: check if chat belongs to their device
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM chats WHERE id = $1 AND user_id IS NULL AND device_fingerprint = $2)"
        )
        .bind(chat_id)
        .bind(device_fp)
        .fetch_one(&pool)
        .await
    } else {
        // No valid authentication
        Ok(false)
    };

    let chat_exists = chat_exists.map_err(|e| {
        eprintln!("Failed to verify chat ownership: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if !chat_exists {
        return Err(StatusCode::NOT_FOUND);
    }

    // If ownership is verified, get the messages
    let messages = sqlx::query_as::<_, Message>(
        "SELECT id, chat_id, role, content, law_name, has_document, document_filename, contract_file_id, contract_type, contract_filename, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC"
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
    State((pool, _, jwt_secret)): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(request): Json<AddMessageRequest>,
) -> Result<StatusCode, StatusCode> {
    let (user_id, device_fingerprint) = extract_user_info(&headers, &jwt_secret);

    // First, verify the user owns this chat (same logic as get_messages_handler)
    let chat_exists = if let Some(user_id) = user_id {
        // Registered user: check if chat belongs to them
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM chats WHERE id = $1 AND user_id = $2)",
        )
        .bind(request.chat_id)
        .bind(user_id)
        .fetch_one(&pool)
        .await
    } else if let Some(device_fp) = device_fingerprint {
        // Trial user: check if chat belongs to their device
        sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM chats WHERE id = $1 AND user_id IS NULL AND device_fingerprint = $2)"
        )
        .bind(request.chat_id)
        .bind(device_fp)
        .fetch_one(&pool)
        .await
    } else {
        // No valid authentication
        Ok(false)
    };

    let chat_exists = chat_exists.map_err(|e| {
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
    State((pool, _, jwt_secret)): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(chat_id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    let (user_id, device_fingerprint) = extract_user_info(&headers, &jwt_secret);

    // Delete the chat only if the user owns it (CASCADE will automatically delete associated messages)
    let rows_affected = if let Some(user_id) = user_id {
        // Registered user: delete chats owned by this user_id (includes migrated trial chats)
        sqlx::query("DELETE FROM chats WHERE id = $1 AND user_id = $2")
            .bind(chat_id)
            .bind(user_id)
            .execute(&pool)
            .await
    } else if let Some(device_fp) = device_fingerprint {
        // Trial user: delete only chat belonging to their device (non-migrated)
        sqlx::query(
            "DELETE FROM chats WHERE id = $1 AND user_id IS NULL AND device_fingerprint = $2",
        )
        .bind(chat_id)
        .bind(device_fp)
        .execute(&pool)
        .await
    } else {
        // No valid authentication: reject
        return Err(StatusCode::UNAUTHORIZED);
    };

    let result = rows_affected.map_err(|e| {
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
    State((pool, _, jwt_secret)): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(chat_id): Path<i64>,
    Json(request): Json<UpdateChatTitleRequest>,
) -> Result<ResponseJson<UpdateChatTitleResponse>, StatusCode> {
    let (user_id, device_fingerprint) = extract_user_info(&headers, &jwt_secret);

    // Update the chat title only if the user owns it
    let rows_affected = if let Some(user_id) = user_id {
        // Registered user: update chats owned by this user_id
        sqlx::query(
            "UPDATE chats SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3",
        )
        .bind(&request.title)
        .bind(chat_id)
        .bind(user_id)
        .execute(&pool)
        .await
    } else if let Some(device_fp) = device_fingerprint {
        // Trial user: update only chat belonging to their device
        sqlx::query("UPDATE chats SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id IS NULL AND device_fingerprint = $3")
            .bind(&request.title)
            .bind(chat_id)
            .bind(device_fp)
            .execute(&pool)
            .await
    } else {
        // No valid authentication: reject
        return Err(StatusCode::UNAUTHORIZED);
    };

    let result = rows_affected.map_err(|e| {
        eprintln!("Failed to update chat title: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if result.rows_affected() == 0 {
        // Chat not found or user doesn't own it
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(ResponseJson(UpdateChatTitleResponse {
        success: true,
        message: "Chat title updated successfully".to_string(),
    }))
}

pub async fn get_cached_law_handler(
    State((pool, _, _)): State<AppState>,
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

/// Decrement trial message count for trial users
pub async fn decrement_trial_message(
    user_id: Option<Uuid>,
    device_fingerprint: Option<String>,
    pool: &PgPool,
) -> Result<(), String> {
    if let Some(user_id) = user_id {
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
    } else if let Some(device_fp) = device_fingerprint {
        // For unregistered trial users, find or create their record and decrement
        let existing_user = get_user(None, Some(device_fp.clone()), pool)
            .await
            .map_err(|e| format!("Failed to get user: {}", e))?;

        if let Some(user) = existing_user {
            // User exists, decrement their trial messages (regardless of account type when using device fingerprint)
            let rows_affected = sqlx::query(
                "UPDATE users SET trial_messages_remaining = trial_messages_remaining - 1, updated_at = NOW() 
                 WHERE id = $1 AND trial_messages_remaining > 0"
            )
            .bind(user.id)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to decrement trial messages: {}", e))?
            .rows_affected();

            if rows_affected == 0 {
                return Err("No trial messages remaining".to_string());
            }
        } else {
            return Err("No user found for device fingerprint".to_string());
        }
    } else {
        return Err("No user ID or device fingerprint provided".to_string());
    }

    Ok(())
}

/// Check if user can send a message (has trial messages remaining or is premium)
pub async fn can_send_message(
    user_id: Option<Uuid>,
    device_fingerprint: Option<String>,
    pool: &PgPool,
) -> Result<bool, String> {
    // Auto-reset Individual plan users' monthly limits if needed
    auto_reset_individual_monthly_limits(pool).await?;

    let user = get_user(user_id, device_fingerprint, pool)
        .await
        .map_err(|e| format!("Failed to get user: {}", e))?;

    if let Some(user) = user {
        // Professional, Team, and Premium users have unlimited messages
        if matches!(
            user.account_type.as_str(),
            "professional" | "team" | "premium"
        ) {
            return Ok(true);
        }

        // Trial and Individual users must have messages remaining
        Ok(user.trial_messages_remaining.unwrap_or(0) > 0)
    } else {
        // No user found - they need to start trial first
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
    device_fingerprint: Option<String>,
    estimated_cost_usd: f64,
    pool: &PgPool,
) -> Result<(), String> {
    let current_month = chrono::Utc::now().format("%Y-%m").to_string();

    if let Some(user_id) = user_id {
        // Registered user - track by user_id
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
    } else if let Some(device_fp) = device_fingerprint {
        // Trial user - track by device fingerprint
        sqlx::query(
            r#"
            UPDATE users
            SET monthly_llm_cost_usd = CASE
                WHEN current_cost_month = $2 THEN monthly_llm_cost_usd + $3
                ELSE $3
            END,
            current_cost_month = $2,
            updated_at = NOW()
            WHERE device_fingerprint = $1
            "#,
        )
        .bind(&device_fp)
        .bind(&current_month)
        .bind(estimated_cost_usd)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to track LLM cost for device: {}", e))?;
    }

    Ok(())
}
