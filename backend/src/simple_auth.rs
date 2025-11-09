// Simplified auth module without compile-time database validation
use crate::database::get_user_status_optimized;
use crate::models::*;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use bcrypt::{hash, DEFAULT_COST};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres, Row};
use uuid::Uuid;
use validator::{Validate, ValidationError};

// Password validation function
fn validate_password_strength(password: &str) -> Result<(), ValidationError> {
    let has_uppercase = password.chars().any(char::is_uppercase);
    let has_lowercase = password.chars().any(char::is_lowercase);
    let has_digit = password.chars().any(char::is_numeric);
    let has_special = password.chars().any(|c| "!@#$%^&*()_+-=[]{}|;:,.<>?".contains(c));

    if !(has_uppercase && has_lowercase && has_digit && has_special) {
        return Err(ValidationError::new("Lozinka mora sadržavati velika i mala slova, broj i specijalni karakter"));
    }
    Ok(())
}

// JWT Claims structure (for custom tokens)
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // user_id
    pub email: String,
    pub exp: usize,
    pub iat: usize,
}

// Supabase JWT Claims structure
#[derive(Debug, Serialize, Deserialize)]
pub struct SupabaseClaims {
    pub sub: String, // user_id in auth.users
    pub email: Option<String>,
    pub exp: usize,
    pub iat: usize,
    pub iss: Option<String>, // Issuer - should be Supabase URL
    pub aud: Option<String>, // Audience
    pub role: Option<String>,
}

// Application state for auth endpoints
// (database pool, openrouter_api_key, jwt_secret, supabase_url, supabase_jwt_secret)
pub type AuthAppState = (
    Pool<Postgres>,
    String,
    String,
    Option<String>,
    Option<String>,
);

// Generate JWT token
pub fn generate_token(user_id: Uuid, email: &str, jwt_secret: &str) -> Result<String, String> {
    let expiration = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::hours(1))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        sub: user_id.to_string(),
        email: email.to_string(),
        exp: expiration,
        iat: chrono::Utc::now().timestamp() as usize,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_ref()),
    )
    .map_err(|e| format!("Token generation failed: {}", e))
}

// Verify JWT token (custom tokens only - legacy)
pub fn verify_token(token: &str, jwt_secret: &str) -> Result<Claims, String> {
    let validation = Validation::default();
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_ref()),
        &validation,
    )
    .map(|data| data.claims)
    .map_err(|e| format!("Token verification failed: {}", e))
}

// Verify Supabase JWT token
pub fn verify_supabase_token(
    token: &str,
    supabase_jwt_secret: &str,
) -> Result<SupabaseClaims, String> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_audience(&["authenticated"]);
    validation.validate_exp = true;

    decode::<SupabaseClaims>(
        token,
        &DecodingKey::from_secret(supabase_jwt_secret.as_ref()),
        &validation,
    )
    .map(|data| data.claims)
    .map_err(|e| format!("Supabase token verification failed: {}", e))
}

// Query Supabase auth.identities to get OAuth providers for a user email
async fn get_auth_providers_for_email(
    email: &str,
    pool: &Pool<Postgres>,
) -> Result<Vec<String>, String> {
    let result = sqlx::query(
        r#"
        SELECT DISTINCT i.provider
        FROM auth.users u
        JOIN auth.identities i ON u.id = i.user_id
        WHERE u.email = $1
        "#,
    )
    .bind(email)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to query auth providers: {}", e))?;

    let providers: Vec<String> = result
        .iter()
        .filter_map(|row| row.try_get::<String, _>("provider").ok())
        .collect();

    Ok(providers)
}

// Filter out 'email' provider to get only OAuth providers
fn filter_oauth_providers(providers: Vec<String>) -> Vec<String> {
    providers.into_iter().filter(|p| p != "email").collect()
}

// Unified token verification - tries Supabase first, then custom
// Returns (user_id from auth.users, is_supabase_token)
pub async fn verify_any_token(
    token: &str,
    jwt_secret: &str,
    supabase_jwt_secret: Option<&str>,
    pool: &Pool<Postgres>,
) -> Result<Uuid, String> {
    // Try Supabase token first if we have the secret
    if let Some(supabase_secret) = supabase_jwt_secret {
        if let Ok(claims) = verify_supabase_token(token, supabase_secret) {
            // Parse Supabase user ID
            let auth_user_id = Uuid::parse_str(&claims.sub)
                .map_err(|_| "Invalid Supabase user ID in token".to_string())?;

            // Look up user by auth_user_id
            let user = sqlx::query_as::<_, User>(
                "SELECT * FROM users WHERE auth_user_id = $1 AND account_status = 'active'",
            )
            .bind(auth_user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Database error: {}", e))?
            .ok_or_else(|| "User not found for Supabase token".to_string())?;

            return Ok(user.id);
        }
    }

    // Fall back to custom JWT verification
    let claims = verify_token(token, jwt_secret)?;
    let user_id =
        Uuid::parse_str(&claims.sub).map_err(|_| "Invalid user ID in custom token".to_string())?;

    Ok(user_id)
}

// Link Supabase auth user to backend user (for registration and OAuth)
pub async fn link_user_handler(
    State((pool, _, _jwt_secret, _, supabase_jwt_secret)): State<AuthAppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Extract Supabase auth_user_id DIRECTLY from JWT token (not from public.users)
    // We need the auth.users.id, not the public.users.id!
    let supabase_user_id = if let Some(supabase_secret) = supabase_jwt_secret.as_deref() {
        headers
            .get("Authorization")
            .and_then(|auth_header| auth_header.to_str().ok())
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .and_then(|token| verify_supabase_token(token, supabase_secret).ok())
            .map(|claims| Uuid::parse_str(&claims.sub).ok())
            .flatten()
    } else {
        None
    };

    let supabase_user_id = supabase_user_id.ok_or_else(|| {
        eprintln!("❌ Failed to extract supabase_user_id from token - no valid Supabase JWT found");
        (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "INVALID_TOKEN".to_string(),
                message: "Neispravan token".to_string(),
                details: None,
            }),
        )
    })?;

    // Get email and metadata from Supabase auth.users
    println!("🔍 Looking up Supabase user with ID: {}", supabase_user_id);
    println!("🔍 Using DATABASE_URL pool to query auth.users");

    // First, test if we can query auth.users at all
    let test_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM auth.users")
        .fetch_one(&pool)
        .await
        .unwrap_or(-1);
    println!("🔍 Total users in auth.users: {}", test_count);

    let supabase_user =
        sqlx::query("SELECT email, raw_user_meta_data FROM auth.users WHERE id = $1")
            .bind(supabase_user_id)
            .fetch_optional(&pool)
            .await
            .map_err(|e| {
                eprintln!("❌ Failed to fetch Supabase user {}: {}", supabase_user_id, e);
                eprintln!("❌ SQL error details: {:?}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "DATABASE_ERROR".to_string(),
                        message: "Greška baze podataka".to_string(),
                        details: Some(serde_json::json!({"details": e.to_string(), "user_id": supabase_user_id.to_string()})),
                    }),
                )
            })?;

    let supabase_user = supabase_user.ok_or_else(|| {
        eprintln!("❌ Supabase user {} not found in auth.users table", supabase_user_id);
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "USER_NOT_FOUND".to_string(),
                message: "Supabase korisnik nije pronađen".to_string(),
                details: Some(serde_json::json!({"supabase_user_id": supabase_user_id.to_string()})),
            }),
        )
    })?;

    let email: String = supabase_user.get("email");
    let raw_meta: Option<serde_json::Value> = supabase_user.get("raw_user_meta_data");

    // For manual verification: always start as false when user registers
    // They need to verify via our verification endpoint (not Supabase's auto-confirm)
    // OAuth users are automatically verified (they verified with Google/Apple)
    println!("🔍 DEBUG: raw_user_meta_data = {:?}", raw_meta);
    let provider_value = raw_meta
        .as_ref()
        .and_then(|m| m.get("provider"))
        .and_then(|p| p.as_str());
    println!("🔍 DEBUG: provider from metadata = {:?}", provider_value);

    let is_oauth = provider_value
        .map(|p| p != "email")
        .unwrap_or(false);

    println!("🔍 DEBUG: is_oauth = {}, email_verified will be = {}", is_oauth, is_oauth);
    let email_verified = is_oauth; // OAuth = verified, email/password = needs manual verification

    // Extract OAuth provider and profile info from metadata
    let (oauth_provider, name, profile_picture) = if let Some(meta) = raw_meta {
        let provider = meta
            .get("provider")
            .and_then(|p| p.as_str())
            .map(String::from);
        let full_name = meta
            .get("full_name")
            .and_then(|n| n.as_str())
            .map(String::from);
        let avatar = meta
            .get("avatar_url")
            .and_then(|a| a.as_str())
            .map(String::from);
        (provider, full_name, avatar)
    } else {
        (None, None, None)
    };

    // Check if user already exists in public.users by auth_user_id
    let existing_user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE auth_user_id = $1")
        .bind(supabase_user_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "DATABASE_ERROR".to_string(),
                    message: "Greška baze podataka".to_string(),
                    details: Some(serde_json::json!({"details": e.to_string()})),
                }),
            )
        })?;

    let (user_id, migrated_chats) = if let Some(user) = existing_user {
        // Check if user is deleted and within grace period - auto-restore
        if user.account_status == "deleted" {
            if let Some(deleted_at) = user.deleted_at {
                let grace_period_ends = deleted_at + chrono::Duration::days(30);
                if chrono::Utc::now() < grace_period_ends {
                    // Auto-restore user on login
                    crate::database::restore_user(user.id, &pool)
                        .await
                        .map_err(|e| {
                            eprintln!("Failed to auto-restore user on login: {}", e);
                            (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(ErrorResponse {
                                    error: "RESTORE_ERROR".to_string(),
                                    message: "Greška prilikom vraćanja naloga".to_string(),
                                    details: Some(serde_json::json!({"details": e.to_string()})),
                                }),
                            )
                        })?;

                    println!("✅ Auto-restored deleted account for user {}", user.email);
                } else {
                    // Grace period expired
                    return Err((
                        StatusCode::FORBIDDEN,
                        Json(ErrorResponse {
                            error: "ACCOUNT_PERMANENTLY_DELETED".to_string(),
                            message: "Ovaj nalog je trajno obrisan".to_string(),
                            details: None,
                        }),
                    ));
                }
            }
        }

        // User already linked (and restored if needed) - just return their info
        (user.id, 0)
    } else {
        // Create new registered user with trial (5 messages)
        let new_user_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO users (
                id, auth_user_id, email, password_hash, name, oauth_provider,
                oauth_profile_picture_url, account_type, email_verified,
                trial_started_at, trial_messages_remaining
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'trial_registered', $8, NOW(), 5)",
        )
        .bind(new_user_id)
        .bind(supabase_user_id)
        .bind(&email)
        .bind("") // password_hash - empty for Supabase users
        .bind(&name)
        .bind(&oauth_provider)
        .bind(&profile_picture)
        .bind(email_verified)
        .execute(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "DATABASE_ERROR".to_string(),
                    message: "Greška kreiranja korisnika".to_string(),
                    details: Some(serde_json::json!({"details": e.to_string()})),
                }),
            )
        })?;

        (new_user_id, 0)
    };

    Ok(Json(AuthResponse {
        success: true,
        user_id: Some(user_id),
        access_token: None, // Supabase handles tokens
        refresh_token: None,
        migrated_chats: Some(migrated_chats),
        verification_token: None,
        message: "Uspešno povezan nalog".to_string(),
    }))
}

#[derive(Deserialize)]
pub struct CheckProviderRequest {
    pub email: String,
}

#[derive(Serialize)]
pub struct CheckProviderResponse {
    pub has_oauth: bool,
    pub providers: Vec<String>,
    pub user_exists: bool, // NEW: explicitly indicate if user exists
}

pub async fn check_provider_handler(
    State((pool, _, _, _, _)): State<AuthAppState>,
    Json(request): Json<CheckProviderRequest>,
) -> Result<Json<CheckProviderResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Query Supabase auth.identities to get ALL providers
    let all_providers = get_auth_providers_for_email(&request.email, &pool)
        .await
        .unwrap_or_default();

    // User exists if they have ANY provider (email or OAuth)
    let user_exists = !all_providers.is_empty();

    // Filter to get only OAuth providers (for display purposes)
    let oauth_providers = filter_oauth_providers(all_providers);

    Ok(Json(CheckProviderResponse {
        has_oauth: !oauth_providers.is_empty(),
        providers: oauth_providers,
        user_exists, // Explicitly tell frontend if user exists
    }))
}

// User status endpoint - uses optimized single-query approach
pub async fn user_status_handler(
    State((pool, _, jwt_secret, _, supabase_jwt_secret)): State<AuthAppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<UserStatusResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Try async verification first (supports both Supabase and custom tokens)
    let user_id = crate::database::verify_user_from_headers_async(
        &headers,
        &jwt_secret,
        supabase_jwt_secret.as_deref(),
        &pool,
    )
    .await;

    match get_user_status_optimized(user_id, &pool).await {
        Ok(status) => Ok(Json(status)),
        Err(e) => {
            eprintln!("Failed to get user status: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "DATABASE_ERROR".to_string(),
                    message: "Greška dobijanja statusa korisnika".to_string(),
                    details: Some(serde_json::json!({"details": e})),
                }),
            ))
        }
    }
}

// Refresh JWT token
pub async fn refresh_handler(
    State((pool, _, jwt_secret, _, _)): State<AuthAppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Get current token from Authorization header
    let auth_header = headers
        .get("Authorization")
        .and_then(|header| header.to_str().ok())
        .and_then(|header| header.strip_prefix("Bearer "));

    if let Some(token) = auth_header {
        match verify_token(token, &jwt_secret) {
            Ok(claims) => {
                // Parse user ID and validate user still exists and is active
                if let Ok(user_id) = Uuid::parse_str(&claims.sub) {
                    // Check if user still exists and is active in database
                    let user = sqlx::query("SELECT email, account_status FROM users WHERE id = $1")
                        .bind(&user_id)
                        .fetch_optional(&pool)
                        .await
                        .map_err(|e| {
                            (
                                StatusCode::INTERNAL_SERVER_ERROR,
                                Json(ErrorResponse {
                                    error: "DATABASE_ERROR".to_string(),
                                    message: "Greška baze podataka".to_string(),
                                    details: Some(serde_json::json!({"details": e.to_string()})),
                                }),
                            )
                        })?;

                    let user = user.ok_or((
                        StatusCode::UNAUTHORIZED,
                        Json(ErrorResponse {
                            error: "USER_NOT_FOUND".to_string(),
                            message: "Korisnik ne postoji".to_string(),
                            details: None,
                        }),
                    ))?;

                    let email: String = user.get("email");
                    let account_status: String = user.get("account_status");

                    // Check if account is active
                    if account_status != "active" {
                        return Err((
                            StatusCode::UNAUTHORIZED,
                            Json(ErrorResponse {
                                error: "ACCOUNT_INACTIVE".to_string(),
                                message: "Nalog nije aktivan".to_string(),
                                details: None,
                            }),
                        ));
                    }

                    // Update last_login
                    sqlx::query("UPDATE users SET last_login = NOW() WHERE id = $1")
                        .bind(&user_id)
                        .execute(&pool)
                        .await
                        .ok(); // Don't fail refresh if this fails

                    let new_token = generate_token(user_id, &email, &jwt_secret).map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(ErrorResponse {
                                error: "TOKEN_ERROR".to_string(),
                                message: "Greška generisanja novog tokena".to_string(),
                                details: Some(serde_json::json!({"details": e})),
                            }),
                        )
                    })?;

                    return Ok(Json(AuthResponse {
                        success: true,
                        user_id: Some(user_id),
                        access_token: Some(new_token),
                        refresh_token: None,
                        migrated_chats: None,
                        verification_token: None, // Not needed for refresh
                        message: "Token uspešno osvežen".to_string(),
                    }));
                }
            }
            Err(_) => {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse {
                        error: "INVALID_TOKEN".to_string(),
                        message: "Neispravan token".to_string(),
                        details: None,
                    }),
                ));
            }
        }
    }

    Err((
        StatusCode::UNAUTHORIZED,
        Json(ErrorResponse {
            error: "MISSING_TOKEN".to_string(),
            message: "Token nije pronađen".to_string(),
            details: None,
        }),
    ))
}

// Forgot password endpoint
pub async fn forgot_password_handler(
    State((pool, _, _, _, _)): State<AuthAppState>,
    Json(request): Json<ForgotPasswordRequest>,
) -> Result<Json<PasswordResetResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Validate input
    if let Err(e) = request.validate() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "VALIDATION_ERROR".to_string(),
                message: "Email adresa nije validna".to_string(),
                details: Some(serde_json::to_value(e.field_errors()).unwrap()),
            }),
        ));
    }

    // Check if user exists
    let user =
        sqlx::query("SELECT id, email FROM users WHERE email = $1 AND account_status = 'active'")
            .bind(&request.email)
            .fetch_optional(&pool)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "DATABASE_ERROR".to_string(),
                        message: "Greška baze podataka".to_string(),
                        details: Some(serde_json::json!({"details": e.to_string()})),
                    }),
                )
            })?;

    if let Some(user) = user {
        let user_id: Uuid = user.get("id");

        // Generate secure reset token (64 characters)
        let token: String = rand::thread_rng()
            .sample_iter(&rand::distributions::Alphanumeric)
            .take(64)
            .map(char::from)
            .collect();

        let expires_at = chrono::Utc::now() + chrono::Duration::hours(1); // 1 hour expiry

        // Store reset token in unified authentication_tokens table
        AuthenticationToken::create(&pool, user_id, "password_reset", token.clone(), expires_at)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "DATABASE_ERROR".to_string(),
                        message: "Greška kreiranja reset tokena".to_string(),
                        details: Some(serde_json::json!({"details": e.to_string()})),
                    }),
                )
            })?;

        // NOTE: Email sending moved to frontend via EmailJS
        // Return token and email for frontend to send the email
        println!(
            "Password reset token generated for {}: {}",
            request.email, token
        );

        return Ok(Json(PasswordResetResponse {
            success: true,
            message: "Instrukcije za resetovanje lozinke će biti poslane na email.".to_string(),
            reset_token: Some(token),
            email: Some(request.email),
        }));
    }

    // Always return success (but no token) to prevent email enumeration attacks
    Ok(Json(PasswordResetResponse {
        success: true,
        message: "Ako email postoji, instrukcije za resetovanje lozinke su poslane.".to_string(),
        reset_token: None,
        email: None,
    }))
}

// Reset password endpoint
pub async fn reset_password_handler(
    State((pool, _, _, _, _)): State<AuthAppState>,
    Json(request): Json<ResetPasswordRequest>,
) -> Result<Json<MessageResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Validate input
    if let Err(e) = request.validate() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "VALIDATION_ERROR".to_string(),
                message: "Podaci nisu validni".to_string(),
                details: Some(serde_json::to_value(e.field_errors()).unwrap()),
            }),
        ));
    }

    // Find and validate reset token
    let reset_token = AuthenticationToken::find_by_token(&pool, &request.token, "password_reset")
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "DATABASE_ERROR".to_string(),
                    message: "Greška baze podataka".to_string(),
                    details: Some(serde_json::json!({"details": e.to_string()})),
                }),
            )
        })?;

    let reset_token = reset_token.ok_or((
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            error: "INVALID_TOKEN".to_string(),
            message: "Neispravan ili nepostojeći token".to_string(),
            details: None,
        }),
    ))?;

    // Check if token is valid (not expired and not used)
    if !reset_token.is_valid() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "TOKEN_EXPIRED_OR_USED".to_string(),
                message: "Token je istekao ili već iskorišćen".to_string(),
                details: None,
            }),
        ));
    }

    // Hash new password
    let password_hash = hash(&request.new_password, DEFAULT_COST).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "HASH_ERROR".to_string(),
                message: "Greška kodiranja lozinke".to_string(),
                details: Some(serde_json::json!({"details": e.to_string()})),
            }),
        )
    })?;

    // Update user password and last_login
    sqlx::query("UPDATE users SET password_hash = $1, last_login = NOW() WHERE id = $2")
        .bind(&password_hash)
        .bind(reset_token.user_id)
        .execute(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "DATABASE_ERROR".to_string(),
                    message: "Greška ažuriranja lozinke".to_string(),
                    details: Some(serde_json::json!({"details": e.to_string()})),
                }),
            )
        })?;

    // Mark token as used
    reset_token.mark_as_used(&pool).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "DATABASE_ERROR".to_string(),
                message: "Greška označavanja tokena".to_string(),
                details: Some(serde_json::json!({"details": e.to_string()})),
            }),
        )
    })?;

    Ok(Json(MessageResponse {
        success: true,
        message: "Lozinka je uspešno resetovana".to_string(),
    }))
}

// Request email verification (send/resend verification email)
pub async fn request_email_verification_handler(
    State((pool, _, jwt_secret, _, supabase_jwt_secret)): State<AuthAppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<VerificationEmailResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Verify user is authenticated
    let user_id = crate::database::verify_user_from_headers_async(
        &headers,
        &jwt_secret,
        supabase_jwt_secret.as_deref(),
        &pool,
    )
    .await
    .ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "UNAUTHORIZED".to_string(),
                message: "Neautorizovan pristup".to_string(),
                details: None,
            }),
        )
    })?;

    // Get user from database
    let user = sqlx::query_as::<_, User>(
        "SELECT * FROM users WHERE id = $1 AND account_status = 'active'",
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "DATABASE_ERROR".to_string(),
                message: "Greška baze podataka".to_string(),
                details: Some(serde_json::json!({"details": e.to_string()})),
            }),
        )
    })?
    .ok_or((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: "USER_NOT_FOUND".to_string(),
            message: "Korisnik nije pronađen".to_string(),
            details: None,
        }),
    ))?;

    // Check if already verified
    if user.email_verified {
        return Ok(Json(VerificationEmailResponse {
            success: true,
            message: "Email je već verifikovan".to_string(),
            email: None,
            verification_token: None,
        }));
    }

    // Generate verification token (64 characters, 24 hour expiry)
    let token: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();

    let expires_at = chrono::Utc::now() + chrono::Duration::hours(24);

    // Store verification token
    AuthenticationToken::create(&pool, user_id, "email_verification", token.clone(), expires_at)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "DATABASE_ERROR".to_string(),
                    message: "Greška kreiranja verifikacionog tokena".to_string(),
                    details: Some(serde_json::json!({"details": e.to_string()})),
                }),
            )
        })?;

    println!("📧 Email verification token generated for {}: {}", user.email, token);

    // Return token and email for frontend to send via EmailJS
    Ok(Json(VerificationEmailResponse {
        success: true,
        message: "Verifikacioni token je kreiran".to_string(),
        email: Some(user.email),
        verification_token: Some(token),
    }))
}

// Email verification endpoint
pub async fn verify_email_handler(
    State((pool, _, _, _, _)): State<AuthAppState>,
    Json(request): Json<VerifyEmailRequest>,
) -> Result<Json<MessageResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Find and validate verification token
    let verification_token =
        AuthenticationToken::find_by_token(&pool, &request.token, "email_verification")
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "DATABASE_ERROR".to_string(),
                        message: "Greška baze podataka".to_string(),
                        details: Some(serde_json::json!({"details": e.to_string()})),
                    }),
                )
            })?;

    let verification_token = verification_token.ok_or((
        StatusCode::BAD_REQUEST,
        Json(ErrorResponse {
            error: "INVALID_TOKEN".to_string(),
            message: "Neispravan ili nepostojeći token".to_string(),
            details: None,
        }),
    ))?;

    // Check if token is valid (not expired and not used)
    if !verification_token.is_valid() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "TOKEN_EXPIRED_OR_USED".to_string(),
                message: "Token je istekao ili već iskorišćen".to_string(),
                details: None,
            }),
        ));
    }

    // Update user email verification status
    sqlx::query("UPDATE users SET email_verified = true WHERE id = $1")
        .bind(verification_token.user_id)
        .execute(&pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "DATABASE_ERROR".to_string(),
                    message: "Greška verifikacije emaila".to_string(),
                    details: Some(serde_json::json!({"details": e.to_string()})),
                }),
            )
        })?;

    // Mark token as used
    verification_token.mark_as_used(&pool).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "DATABASE_ERROR".to_string(),
                message: "Greška označavanja tokena".to_string(),
                details: Some(serde_json::json!({"details": e.to_string()})),
            }),
        )
    })?;

    Ok(Json(MessageResponse {
        success: true,
        message: "Email je uspešno verifikovan".to_string(),
    }))
}

// Logout endpoint
pub async fn logout_handler() -> Result<Json<MessageResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Since we're using stateless JWT tokens, logout is handled client-side
    // by removing the token from storage
    Ok(Json(MessageResponse {
        success: true,
        message: "Uspešno ste se odjavili".to_string(),
    }))
}

// Create premium subscription
pub async fn create_subscription_handler(
    State((pool, _, jwt_secret, _, _)): State<AuthAppState>,
    headers: axum::http::HeaderMap,
    Json(request): Json<CreateSubscriptionRequest>,
) -> Result<Json<SubscriptionResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Verify JWT token
    let auth_header = headers
        .get("Authorization")
        .and_then(|header| header.to_str().ok())
        .and_then(|header| header.strip_prefix("Bearer "));

    if let Some(token) = auth_header {
        match verify_token(token, &jwt_secret) {
            Ok(claims) => {
                if let Ok(user_id) = Uuid::parse_str(&claims.sub) {
                    // Calculate subscription dates based on billing period
                    let now = chrono::Utc::now();
                    let (expires_at, next_billing_date) = match request.billing_period.as_str() {
                        "monthly" => {
                            let expires = now + chrono::Duration::days(30);
                            (expires, expires)
                        }
                        "yearly" => {
                            let expires = now + chrono::Duration::days(365);
                            (expires, expires)
                        }
                        _ => {
                            return Err((
                                StatusCode::BAD_REQUEST,
                                Json(ErrorResponse {
                                    error: "INVALID_BILLING_PERIOD".to_string(),
                                    message: "Nepodržan tip naplate".to_string(),
                                    details: None,
                                }),
                            ));
                        }
                    };

                    // Extract price from pricing object or calculate based on plan and billing period
                    let price = request
                        .pricing
                        .get("price")
                        .and_then(|p| p.as_i64())
                        .unwrap_or_else(|| {
                            match (request.plan_id.as_str(), request.billing_period.as_str()) {
                                ("individual", "monthly") => 3400,
                                ("individual", "yearly") => 34000,
                                ("professional", "monthly") => 6400,
                                ("professional", "yearly") => 64000,
                                ("team", "monthly") => 24900, // Base team price
                                ("team", "yearly") => 249000,
                                ("premium", "monthly") => 6400, // Migrate premium to professional pricing
                                ("premium", "yearly") => 64000,
                                _ => 6400, // Default to professional monthly
                            }
                        }) as i32;

                    // Map plan_id to account_type (keeping premium for backward compatibility)
                    let account_type = match request.plan_id.as_str() {
                        "individual" => "individual",
                        "professional" => "professional",
                        "team" => "team",
                        "premium" => "professional", // Migrate premium to professional
                        _ => "professional",         // Default fallback
                    };

                    // Generate team_id for team plans
                    let team_id = if request.plan_id == "team" {
                        Some(Uuid::new_v4())
                    } else {
                        None
                    };

                    // Create subscription by updating user account
                    sqlx::query(
                        "UPDATE users SET
                            account_type = $1,
                            premium_expires_at = $2,
                            subscription_type = $3,
                            subscription_started_at = $4,
                            next_billing_date = $5,
                            subscription_status = 'active',
                            team_id = $6,
                            trial_messages_remaining = CASE
                                WHEN $1 = 'individual' THEN 20
                                WHEN $1 IN ('professional', 'team') THEN NULL
                                ELSE trial_messages_remaining
                            END,
                            updated_at = NOW()
                        WHERE id = $7",
                    )
                    .bind(account_type)
                    .bind(expires_at)
                    .bind(&request.billing_period)
                    .bind(now)
                    .bind(next_billing_date)
                    .bind(team_id)
                    .bind(user_id)
                    .execute(&pool)
                    .await
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(ErrorResponse {
                                error: "DATABASE_ERROR".to_string(),
                                message: "Greška kreiranja pretplate".to_string(),
                                details: Some(serde_json::json!({"details": e.to_string()})),
                            }),
                        )
                    })?;

                    return Ok(Json(SubscriptionResponse {
                        success: true,
                        subscription_id: Some(user_id.to_string()),
                        plan_type: request.plan_id.clone(),
                        status: "active".to_string(),
                        expires_at: Some(expires_at),
                        price_rsd: price,
                        message: format!(
                            "{} pretplata aktivirana ({})",
                            match request.plan_id.as_str() {
                                "individual" => "Individual",
                                "professional" => "Professional",
                                "team" => "Team",
                                "premium" => "Professional", // Migrate premium to professional
                                _ => "Professional",
                            },
                            if request.billing_period == "yearly" {
                                "godišnje"
                            } else {
                                "mesečno"
                            }
                        ),
                    }));
                }
            }
            Err(_) => {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse {
                        error: "INVALID_TOKEN".to_string(),
                        message: "Neispravan token".to_string(),
                        details: None,
                    }),
                ));
            }
        }
    }

    Err((
        StatusCode::UNAUTHORIZED,
        Json(ErrorResponse {
            error: "MISSING_TOKEN".to_string(),
            message: "Token nije pronađen".to_string(),
            details: None,
        }),
    ))
}

// Get subscription status
pub async fn subscription_status_handler(
    State((pool, _, jwt_secret, _, _)): State<AuthAppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<SubscriptionResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Verify JWT token
    let auth_header = headers
        .get("Authorization")
        .and_then(|header| header.to_str().ok())
        .and_then(|header| header.strip_prefix("Bearer "));

    if let Some(token) = auth_header {
        match verify_token(token, &jwt_secret) {
            Ok(claims) => {
                if let Ok(user_id) = Uuid::parse_str(&claims.sub) {
                    // Get user account status
                    let user = sqlx::query(
                        "SELECT account_type, premium_expires_at, subscription_type, subscription_started_at, next_billing_date, subscription_status FROM users WHERE id = $1 AND account_status = 'active'"
                    )
                    .bind(user_id)
                    .fetch_optional(&pool)
                    .await
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                        error: "DATABASE_ERROR".to_string(),
                        message: "Greška dobijanja pretplate".to_string(),
                        details: Some(serde_json::json!({"details": e.to_string()})),
                    })))?;

                    if let Some(user_row) = user {
                        let account_type: String = user_row.get("account_type");
                        let premium_expires_at: Option<chrono::DateTime<chrono::Utc>> =
                            user_row.get("premium_expires_at");
                        let subscription_type: Option<String> = user_row.get("subscription_type");
                        let subscription_status: Option<String> =
                            user_row.get("subscription_status");

                        let (plan_type, status, price) = match account_type.as_str() {
                            "individual" => {
                                let billing_period =
                                    subscription_type.as_deref().unwrap_or("monthly");
                                let sub_status = subscription_status.as_deref().unwrap_or("active");
                                let price = if billing_period == "yearly" {
                                    34000
                                } else {
                                    3400
                                };
                                ("individual", sub_status, price)
                            }
                            "professional" => {
                                let billing_period =
                                    subscription_type.as_deref().unwrap_or("monthly");
                                let sub_status = subscription_status.as_deref().unwrap_or("active");
                                let price = if billing_period == "yearly" {
                                    64000
                                } else {
                                    6400
                                };
                                ("professional", sub_status, price)
                            }
                            "team" => {
                                let billing_period =
                                    subscription_type.as_deref().unwrap_or("monthly");
                                let sub_status = subscription_status.as_deref().unwrap_or("active");
                                let price = if billing_period == "yearly" {
                                    249000
                                } else {
                                    24900
                                };
                                ("team", sub_status, price)
                            }
                            "premium" => {
                                let billing_period =
                                    subscription_type.as_deref().unwrap_or("monthly");
                                let sub_status = subscription_status.as_deref().unwrap_or("active");
                                let price = if billing_period == "yearly" {
                                    64000
                                } else {
                                    6400
                                };
                                ("professional", sub_status, price) // Migrate premium to professional
                            }
                            _ => ("trial", "active", 0),
                        };

                        return Ok(Json(SubscriptionResponse {
                            success: true,
                            subscription_id: Some(user_id.to_string()),
                            plan_type: plan_type.to_string(),
                            status: status.to_string(),
                            expires_at: premium_expires_at,
                            price_rsd: price,
                            message: "Status pretplate".to_string(),
                        }));
                    } else {
                        return Ok(Json(SubscriptionResponse {
                            success: true,
                            subscription_id: None,
                            plan_type: "trial".to_string(),
                            status: "active".to_string(),
                            expires_at: None,
                            price_rsd: 0,
                            message: "Korisnik nije pronađen".to_string(),
                        }));
                    }
                }
            }
            Err(_) => {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse {
                        error: "INVALID_TOKEN".to_string(),
                        message: "Neispravan token".to_string(),
                        details: None,
                    }),
                ));
            }
        }
    }

    Err((
        StatusCode::UNAUTHORIZED,
        Json(ErrorResponse {
            error: "MISSING_TOKEN".to_string(),
            message: "Token nije pronađen".to_string(),
            details: None,
        }),
    ))
}

// Cancel subscription
pub async fn cancel_subscription_handler(
    State((pool, _, jwt_secret, _, _)): State<AuthAppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<MessageResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Verify JWT token
    let auth_header = headers
        .get("Authorization")
        .and_then(|header| header.to_str().ok())
        .and_then(|header| header.strip_prefix("Bearer "));

    if let Some(token) = auth_header {
        match verify_token(token, &jwt_secret) {
            Ok(claims) => {
                if let Ok(user_id) = Uuid::parse_str(&claims.sub) {
                    // Cancel premium subscription (keep premium until billing period ends)
                    sqlx::query(
                        "UPDATE users SET
                            premium_expires_at = next_billing_date,
                            subscription_type = NULL,
                            subscription_started_at = NULL,
                            next_billing_date = NULL,
                            subscription_status = 'cancelled',
                            updated_at = NOW()
                        WHERE id = $1 AND account_type = 'premium'",
                    )
                    .bind(user_id)
                    .execute(&pool)
                    .await
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(ErrorResponse {
                                error: "DATABASE_ERROR".to_string(),
                                message: "Greška otkazivanja pretplate".to_string(),
                                details: Some(serde_json::json!({"details": e.to_string()})),
                            }),
                        )
                    })?;

                    return Ok(Json(MessageResponse {
                        success: true,
                        message: "Pretplata je uspešno otkazana".to_string(),
                    }));
                }
            }
            Err(_) => {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse {
                        error: "INVALID_TOKEN".to_string(),
                        message: "Neispravan token".to_string(),
                        details: None,
                    }),
                ));
            }
        }
    }

    Err((
        StatusCode::UNAUTHORIZED,
        Json(ErrorResponse {
            error: "MISSING_TOKEN".to_string(),
            message: "Token nije pronađen".to_string(),
            details: None,
        }),
    ))
}

// Enhanced trial start endpoint with bypass detection
#[derive(serde::Deserialize, Validate)]
pub struct ForgotPasswordRequest {
    #[validate(email(message = "Neispravna email adresa"))]
    pub email: String,
}

#[derive(serde::Deserialize, Validate)]
pub struct ResetPasswordRequest {
    #[validate(length(min = 32, max = 256, message = "Neispravan token"))]
    pub token: String,
    #[validate(length(
        min = 8,
        max = 128,
        message = "Lozinka mora imati između 8 i 128 karaktera"
    ))]
    #[validate(custom = "validate_password_strength")]
    pub new_password: String,
}

#[derive(serde::Deserialize)]
pub struct VerifyEmailRequest {
    pub token: String,
}

#[derive(serde::Deserialize)]
pub struct CreateSubscriptionRequest {
    pub plan_id: String,            // "individual", "professional", "team", "premium"
    pub billing_period: String,     // "monthly" or "yearly"
    pub pricing: serde_json::Value, // Price details from frontend
}

#[derive(serde::Serialize)]
pub struct MessageResponse {
    pub success: bool,
    pub message: String,
}

#[derive(serde::Serialize)]
pub struct SubscriptionResponse {
    pub success: bool,
    pub subscription_id: Option<String>,
    pub plan_type: String,
    pub status: String,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub price_rsd: i32,
    pub message: String,
}

// Change plan endpoint
pub async fn change_plan_handler(
    State((pool, _, jwt_secret, _, _)): State<AuthAppState>,
    headers: HeaderMap,
    Json(request): Json<ChangePlanRequest>,
) -> Result<Json<SubscriptionResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Authenticate user
    let auth_header = headers
        .get("Authorization")
        .and_then(|header| header.to_str().ok())
        .and_then(|header| header.strip_prefix("Bearer "));

    let user_id = if let Some(token) = auth_header {
        match verify_token(token, &jwt_secret) {
            Ok(claims) => {
                if let Ok(user_id) = Uuid::parse_str(&claims.sub) {
                    user_id
                } else {
                    return Err((
                        StatusCode::UNAUTHORIZED,
                        Json(ErrorResponse {
                            error: "INVALID_TOKEN".to_string(),
                            message: "Neispravan token".to_string(),
                            details: None,
                        }),
                    ));
                }
            }
            Err(_) => {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse {
                        error: "INVALID_TOKEN".to_string(),
                        message: "Neispravan token".to_string(),
                        details: None,
                    }),
                ));
            }
        }
    } else {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "MISSING_TOKEN".to_string(),
                message: "Token nije pronađen".to_string(),
                details: None,
            }),
        ));
    };

    // Validate plan_id
    if !["individual", "professional", "team"].contains(&request.plan_id.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "INVALID_PLAN".to_string(),
                message: "Neispravan plan ID".to_string(),
                details: None,
            }),
        ));
    }

    // Validate billing_period
    if !["monthly", "yearly"].contains(&request.billing_period.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "INVALID_BILLING_PERIOD".to_string(),
                message: "Neispravan period naplate".to_string(),
                details: None,
            }),
        ));
    }

    // Get pricing
    let price_rsd = match (request.plan_id.as_str(), request.billing_period.as_str()) {
        ("individual", "monthly") => 3400,
        ("individual", "yearly") => 34000,
        ("professional", "monthly") => 6400,
        ("professional", "yearly") => 64000,
        ("team", "monthly") => 24900,
        ("team", "yearly") => 249000,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "INVALID_PLAN_COMBINATION".to_string(),
                    message: "Neispravna kombinacija plana i perioda".to_string(),
                    details: None,
                }),
            ));
        }
    };

    // Calculate next billing date
    let next_billing_date = if request.billing_period == "yearly" {
        chrono::Utc::now() + chrono::Duration::days(365)
    } else {
        chrono::Utc::now() + chrono::Duration::days(30)
    };

    // Update user's subscription plan
    let update_result = sqlx::query(
        "UPDATE users SET
            account_type = $1,
            subscription_type = $2,
            subscription_started_at = NOW(),
            next_billing_date = $3,
            subscription_status = 'active',
            team_id = $4,
            trial_messages_remaining = $5,
            updated_at = NOW()
         WHERE id = $6",
    )
    .bind(&request.plan_id)
    .bind(&request.billing_period)
    .bind(next_billing_date)
    .bind(if request.plan_id == "team" {
        Some(uuid::Uuid::new_v4())
    } else {
        None
    })
    .bind(if request.plan_id == "individual" {
        Some(20)
    } else {
        None
    })
    .bind(user_id)
    .execute(&pool)
    .await;

    match update_result {
        Ok(_) => Ok(Json(SubscriptionResponse {
            success: true,
            subscription_id: Some(user_id.to_string()),
            plan_type: request.plan_id,
            status: "active".to_string(),
            expires_at: Some(next_billing_date),
            price_rsd,
            message: "Plan je uspešno promenjen".to_string(),
        })),
        Err(e) => {
            eprintln!("Database error during plan change: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "DATABASE_ERROR".to_string(),
                    message: "Greška prilikom promene plana".to_string(),
                    details: None,
                }),
            ))
        }
    }
}

// Change billing period endpoint
pub async fn change_billing_period_handler(
    State((pool, _, jwt_secret, _, _)): State<AuthAppState>,
    headers: HeaderMap,
    Json(request): Json<ChangeBillingPeriodRequest>,
) -> Result<Json<SubscriptionResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Authenticate user
    let auth_header = headers
        .get("Authorization")
        .and_then(|header| header.to_str().ok())
        .and_then(|header| header.strip_prefix("Bearer "));

    let user_id = if let Some(token) = auth_header {
        match verify_token(token, &jwt_secret) {
            Ok(claims) => {
                if let Ok(user_id) = Uuid::parse_str(&claims.sub) {
                    user_id
                } else {
                    return Err((
                        StatusCode::UNAUTHORIZED,
                        Json(ErrorResponse {
                            error: "INVALID_TOKEN".to_string(),
                            message: "Neispravan token".to_string(),
                            details: None,
                        }),
                    ));
                }
            }
            Err(_) => {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse {
                        error: "INVALID_TOKEN".to_string(),
                        message: "Neispravan token".to_string(),
                        details: None,
                    }),
                ));
            }
        }
    } else {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "MISSING_TOKEN".to_string(),
                message: "Token nije pronađen".to_string(),
                details: None,
            }),
        ));
    };

    // Validate billing_period
    if !["monthly", "yearly"].contains(&request.billing_period.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "INVALID_BILLING_PERIOD".to_string(),
                message: "Neispravan period naplate".to_string(),
                details: None,
            }),
        ));
    }

    // Get current user data to determine plan type
    let user_result = sqlx::query_as::<_, User>(
        "SELECT * FROM users WHERE id = $1 AND account_status = 'active'",
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await;

    let user = match user_result {
        Ok(Some(user)) => user,
        Ok(None) => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "USER_NOT_FOUND".to_string(),
                    message: "Korisnik nije pronađen".to_string(),
                    details: None,
                }),
            ));
        }
        Err(e) => {
            eprintln!("Database error: {}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "DATABASE_ERROR".to_string(),
                    message: "Greška pri pristupu bazi".to_string(),
                    details: None,
                }),
            ));
        }
    };

    // Get pricing based on current plan and new billing period
    let price_rsd = match (user.account_type.as_str(), request.billing_period.as_str()) {
        ("individual", "monthly") => 3400,
        ("individual", "yearly") => 34000,
        ("professional", "monthly") | ("premium", "monthly") => 6400,
        ("professional", "yearly") | ("premium", "yearly") => 64000,
        ("team", "monthly") => 24900,
        ("team", "yearly") => 249000,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "INVALID_PLAN_TYPE".to_string(),
                    message: "Nepoznat tip plana".to_string(),
                    details: None,
                }),
            ));
        }
    };

    // Calculate next billing date
    let next_billing_date = if request.billing_period == "yearly" {
        chrono::Utc::now() + chrono::Duration::days(365)
    } else {
        chrono::Utc::now() + chrono::Duration::days(30)
    };

    // Update billing period
    let update_result = sqlx::query(
        "UPDATE users SET
            subscription_type = $1,
            next_billing_date = $2,
            updated_at = NOW()
         WHERE id = $3",
    )
    .bind(&request.billing_period)
    .bind(next_billing_date)
    .bind(user_id)
    .execute(&pool)
    .await;

    match update_result {
        Ok(_) => Ok(Json(SubscriptionResponse {
            success: true,
            subscription_id: Some(user_id.to_string()),
            plan_type: user.account_type,
            status: "active".to_string(),
            expires_at: Some(next_billing_date),
            price_rsd,
            message: "Period naplate je uspešno promenjen".to_string(),
        })),
        Err(e) => {
            eprintln!("Database error during billing period change: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "DATABASE_ERROR".to_string(),
                    message: "Greška prilikom promene perioda naplate".to_string(),
                    details: None,
                }),
            ))
        }
    }
}

// Request structs for new endpoints
#[derive(Debug, Deserialize)]
pub struct ChangePlanRequest {
    pub plan_id: String,
    pub billing_period: String,
}

#[derive(Debug, Deserialize)]
pub struct ChangeBillingPeriodRequest {
    pub billing_period: String,
}

// ==================== ACCOUNT DELETION ENDPOINTS ====================

/// Request account deletion (soft delete with 30-day grace period)
pub async fn request_delete_account_handler(
    State((pool, _, jwt_secret, _, supabase_jwt_secret)): State<AuthAppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<crate::models::DeleteAccountRequest>,
) -> Result<Json<crate::models::DeleteAccountResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Verify token (supports both Supabase and custom JWT tokens)
    let user_id = crate::database::verify_user_from_headers_async(
        &headers,
        &jwt_secret,
        supabase_jwt_secret.as_deref(),
        &pool,
    )
    .await
    .ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "UNAUTHORIZED".to_string(),
                message: "Neautorizovan pristup".to_string(),
                details: None,
            }),
        )
    })?;

    // Get user from database
    let user = sqlx::query_as::<_, User>(
        "SELECT * FROM users WHERE id = $1 AND account_status = 'active'",
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| {
        eprintln!("Database error fetching user: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "DATABASE_ERROR".to_string(),
                message: "Greška baze podataka".to_string(),
                details: Some(serde_json::json!({"details": e.to_string()})),
            }),
        )
    })?
    .ok_or((
        StatusCode::NOT_FOUND,
        Json(ErrorResponse {
            error: "USER_NOT_FOUND".to_string(),
            message: "Korisnik nije pronađen".to_string(),
            details: None,
        }),
    ))?;
    // Validation: confirmation must be true
    if !payload.confirmation {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "CONFIRMATION_REQUIRED".to_string(),
                message: "Potvrda brisanja naloga je obavezna".to_string(),
                details: None,
            }),
        ));
    }

    // Check if user is team admin
    let is_admin = crate::database::is_team_admin(user.id, &pool)
        .await
        .map_err(|e| {
            eprintln!("Database error checking team admin status: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "DATABASE_ERROR".to_string(),
                    message: "Greška baze podataka".to_string(),
                    details: Some(serde_json::json!({"details": e.to_string()})),
                }),
            )
        })?;

    if is_admin {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "TEAM_ADMIN".to_string(),
                message: "Ne možete obrisati nalog dok ste administrator tima. Prvo prebacite vlasništvo tima.".to_string(),
                details: None,
            }),
        ));
    }

    // No password verification needed - all users authenticate through Supabase
    // JWT token verification (already done) is sufficient authentication
    // Passwords are managed by Supabase Auth, not stored in public.users

    // Cancel active subscription if exists
    if user.subscription_status == Some("active".to_string()) {
        crate::database::cancel_subscription(user.id, &pool)
            .await
            .map_err(|e| {
                eprintln!("Failed to cancel subscription: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "SUBSCRIPTION_CANCEL_ERROR".to_string(),
                        message: "Greška prilikom otkazivanja pretplate".to_string(),
                        details: Some(serde_json::json!({"details": e.to_string()})),
                    }),
                )
            })?;
    }

    // Soft delete user
    let deleted_at = crate::database::soft_delete_user(user.id, &pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to soft delete user: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "DELETE_ERROR".to_string(),
                    message: "Greška prilikom brisanja naloga".to_string(),
                    details: Some(serde_json::json!({"details": e.to_string()})),
                }),
            )
        })?;

    let grace_period_ends = deleted_at + chrono::Duration::days(30);

    // TODO: Send email notification about deletion and grace period

    Ok(Json(crate::models::DeleteAccountResponse {
        success: true,
        message: "Brisanje vašeg naloga je zakazano. Ukoliko se ponovo prijavite u roku od 30 dana, vaš nalog će biti vraćen. Nakon isteka tog perioda, nalog će biti trajno obrisan.".to_string(),
        grace_period_ends: Some(grace_period_ends.to_rfc3339()),
    }))
}

/// Restore account during grace period (called manually or automatically on login)
pub async fn restore_account_handler(
    State((pool, _, jwt_secret, _, supabase_jwt_secret)): State<AuthAppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<crate::models::RestoreAccountResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Verify token (supports both Supabase and custom JWT tokens)
    let user_id = crate::database::verify_user_from_headers_async(
        &headers,
        &jwt_secret,
        supabase_jwt_secret.as_deref(),
        &pool,
    )
    .await
    .ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "UNAUTHORIZED".to_string(),
                message: "Neautorizovan pristup".to_string(),
                details: None,
            }),
        )
    })?;
    // Check if user is within grace period
    let within_grace_period = crate::database::is_within_grace_period(user_id, &pool)
        .await
        .map_err(|e| {
            eprintln!("Database error checking grace period: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "DATABASE_ERROR".to_string(),
                    message: "Greška baze podataka".to_string(),
                    details: Some(serde_json::json!({"details": e.to_string()})),
                }),
            )
        })?;

    if !within_grace_period {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "GRACE_PERIOD_EXPIRED".to_string(),
                message:
                    "Period za oporavak naloga je istekao ili nalog nije bio zakazan za brisanje"
                        .to_string(),
                details: None,
            }),
        ));
    }

    // Restore user
    let restored_user = crate::database::restore_user(user_id, &pool)
        .await
        .map_err(|e| {
            eprintln!("Failed to restore user: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "RESTORE_ERROR".to_string(),
                    message: "Greška prilikom vraćanja naloga".to_string(),
                    details: Some(serde_json::json!({"details": e.to_string()})),
                }),
            )
        })?;

    // Get full user status
    let user_status =
        crate::database::get_user_status_optimized(Some(restored_user.id), &pool)
            .await
            .map_err(|e| {
                eprintln!("Failed to get user status: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "STATUS_ERROR".to_string(),
                        message: "Greška prilikom preuzimanja statusa korisnika".to_string(),
                        details: Some(serde_json::json!({"details": e})),
                    }),
                )
            })?;

    // TODO: Send email notification about restoration

    Ok(Json(crate::models::RestoreAccountResponse {
        success: true,
        message: "Vaš nalog je uspešno vraćen.".to_string(),
        user_status,
    }))
}

// ==================== EMAIL FUNCTIONS ====================
// NOTE: Email sending has been moved to frontend using EmailJS
// Backend now only generates tokens and returns them to frontend
// This eliminates the need for backend email configuration
