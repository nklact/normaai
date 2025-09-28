// Simplified auth module without compile-time database validation
use crate::api::extract_client_ip;
use crate::database::{extract_user_info, get_user_status_optimized};
use crate::models::*;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres, Row};
use uuid::Uuid;
use validator::Validate;

// JWT Claims structure
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // user_id
    pub email: String,
    pub exp: usize,
    pub iat: usize,
}

// Application state for auth endpoints
pub type AuthAppState = (Pool<Postgres>, String, String); // (database pool, openrouter_api_key, jwt_secret)

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

// Verify JWT token
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

// Check IP trial limits (max 3 trials per IP)
pub async fn check_ip_trial_limits(
    pool: &Pool<Postgres>,
    ip_address: &str,
) -> Result<bool, (StatusCode, Json<ErrorResponse>)> {
    // Validate IP address format
    if ip_address.parse::<std::net::IpAddr>().is_err() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "INVALID_IP".to_string(),
                message: "Neispravna IP adresa".to_string(),
                details: None,
            }),
        ));
    }

    // Parse IP address for comparison
    let parsed_ip: std::net::IpAddr = ip_address.parse().unwrap(); // Already validated above
    let ip_network = ipnetwork::IpNetwork::from(parsed_ip);

    let ip_trial = sqlx::query_as::<_, crate::models::IpTrialLimit>(
        "SELECT id, ip_address, date, count, created_at FROM ip_trial_limits WHERE ip_address = $1 AND date = CURRENT_DATE"
    )
        .bind(ip_network)
        .fetch_optional(pool)
        .await
        .map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "DATABASE_ERROR".to_string(),
                message: "Greška provere IP adrese".to_string(),
                details: Some(serde_json::json!({"details": e.to_string()})),
            }))
        })?;

    // Return true if no record found (allowed) or count < 3 (allowed)
    // Return false if count >= 3 (blocked)
    Ok(ip_trial.map_or(true, |record| record.count < 3))
}

// Register endpoint
pub async fn register_handler(
    State((pool, _, jwt_secret)): State<AuthAppState>,
    Json(request): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ErrorResponse>)> {
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

    // Hash password
    let password_hash = hash(request.password, DEFAULT_COST).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "HASH_ERROR".to_string(),
                message: "Greška kodiranja lozinke".to_string(),
                details: Some(serde_json::json!({"details": e.to_string()})),
            }),
        )
    })?;

    // Check for existing unregistered trial user with same device fingerprint
    let existing_trial_user = sqlx::query(
        "SELECT id, trial_messages_remaining FROM users WHERE device_fingerprint = $1 AND account_type = 'trial_unregistered'"
    )
    .bind(&request.device_fingerprint)
    .fetch_optional(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
        error: "DATABASE_ERROR".to_string(),
        message: "Greška provere postojećeg korisnika".to_string(),
        details: Some(serde_json::json!({"details": e.to_string()})),
    })))?;

    let (user_id, result) = if let Some(existing_device_trial) = existing_trial_user {
        // Keep existing device trial record, create new user account with inherited messages
        let trial_messages_remaining: Option<i32> =
            existing_device_trial.get("trial_messages_remaining");
        let new_user_id = Uuid::new_v4();
        let trial_expires_at = chrono::Utc::now() + chrono::Duration::days(7);

        let insert_result = sqlx::query(
            "INSERT INTO users (id, email, password_hash, account_type, device_fingerprint, trial_started_at, trial_expires_at, trial_messages_remaining) 
             VALUES ($1, $2, $3, 'trial_registered', $4, NOW(), $5, $6)"
        )
        .bind(new_user_id)
        .bind(&request.email)
        .bind(&password_hash)
        .bind(&request.device_fingerprint)
        .bind(trial_expires_at)
        .bind(trial_messages_remaining)
        .execute(&pool)
        .await;

        (new_user_id, insert_result)
    } else {
        // Create new user if no trial user exists for this device
        let new_user_id = Uuid::new_v4();
        let trial_expires_at = chrono::Utc::now() + chrono::Duration::days(7);

        let insert_result = sqlx::query(
            "INSERT INTO users (id, email, password_hash, account_type, device_fingerprint, trial_started_at, trial_expires_at, trial_messages_remaining)
             VALUES ($1, $2, $3, 'trial_registered', $4, NOW(), $5, 5)"
        )
        .bind(new_user_id)
        .bind(&request.email)
        .bind(&password_hash)
        .bind(&request.device_fingerprint)
        .bind(trial_expires_at)
        .execute(&pool)
        .await;

        (new_user_id, insert_result)
    };

    match result {
        Ok(_) => {
            // Generate email verification token
            let verification_token: String = rand::thread_rng()
                .sample_iter(&rand::distributions::Alphanumeric)
                .take(64)
                .map(char::from)
                .collect();

            let expires_at = chrono::Utc::now() + chrono::Duration::hours(24); // 24 hour expiry

            // Store verification token in unified authentication_tokens table
            AuthenticationToken::create(
                &pool,
                user_id,
                "email_verification",
                verification_token.clone(),
                expires_at,
            )
            .await
            .map_err(|e| {
                println!("Failed to create verification token: {}", e);
                // Don't fail registration if verification token creation fails
            })
            .ok();

            // NOTE: Email sending moved to frontend via EmailJS
            // Token is returned to frontend for email sending
            println!(
                "Verification token generated for {}: {}",
                request.email, verification_token
            );

            // Migrate trial chats to registered user account
            let migrated_count = sqlx::query(
                "UPDATE chats SET user_id = $1 WHERE device_fingerprint = $2 AND user_id IS NULL",
            )
            .bind(user_id)
            .bind(&request.device_fingerprint)
            .execute(&pool)
            .await
            .map(|result| result.rows_affected() as i64)
            .unwrap_or(0);

            // Generate JWT token
            let token = generate_token(user_id, &request.email, &jwt_secret).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "TOKEN_ERROR".to_string(),
                        message: "Greška generisanja tokena".to_string(),
                        details: Some(serde_json::json!({"details": e})),
                    }),
                )
            })?;

            let migration_message =
                "Nalog kreiran uspešno. Proverite email za verifikaciju.".to_string();

            Ok(Json(AuthResponse {
                success: true,
                user_id: Some(user_id),
                access_token: Some(token),
                refresh_token: None,
                migrated_chats: Some(migrated_count),
                verification_token: Some(verification_token), // Added for EmailJS
                message: migration_message,
            }))
        }
        Err(e) => {
            if e.to_string().contains("unique") || e.to_string().contains("duplicate") {
                Err((
                    StatusCode::CONFLICT,
                    Json(ErrorResponse {
                        error: "EMAIL_EXISTS".to_string(),
                        message: "Email adresa već postoji".to_string(),
                        details: None,
                    }),
                ))
            } else {
                Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        error: "DATABASE_ERROR".to_string(),
                        message: "Greška kreiranja korisnika".to_string(),
                        details: Some(serde_json::json!({"details": e.to_string()})),
                    }),
                ))
            }
        }
    }
}

// Login endpoint
pub async fn login_handler(
    State((pool, _, jwt_secret)): State<AuthAppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ErrorResponse>)> {
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

    // Find user
    let row = sqlx::query("SELECT id, email, password_hash FROM users WHERE email = $1")
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

    let user = row.ok_or_else(|| {
        (StatusCode::UNAUTHORIZED, Json(ErrorResponse {
            error: "INVALID_CREDENTIALS".to_string(),
            message: "Neispravna email adresa ili lozinka. Proverite podatke ili se registrujte ukoliko nemate nalog.".to_string(),
            details: Some(serde_json::json!({"details": "Email ili lozinka nisu tačni"})),
        }))
    })?;

    let user_id: Uuid = user.get("id");
    let email: String = user.get("email");
    let stored_hash: String = user.get("password_hash");

    // Verify password
    let password_valid = verify(&request.password, &stored_hash).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "HASH_ERROR".to_string(),
                message: "Greška verifikacije lozinke".to_string(),
                details: Some(serde_json::json!({"details": e.to_string()})),
            }),
        )
    })?;

    if !password_valid {
        return Err((StatusCode::UNAUTHORIZED, Json(ErrorResponse {
            error: "INVALID_CREDENTIALS".to_string(),
            message: "Neispravna email adresa ili lozinka. Proverite podatke ili se registrujte ukoliko nemate nalog.".to_string(),
            details: Some(serde_json::json!({"details": "Email ili lozinka nisu tačni"})),
        })));
    }

    // Generate JWT token
    let token = generate_token(user_id, &email, &jwt_secret).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "TOKEN_ERROR".to_string(),
                message: "Greška generisanja tokena".to_string(),
                details: Some(serde_json::json!({"details": e})),
            }),
        )
    })?;

    Ok(Json(AuthResponse {
        success: true,
        user_id: Some(user_id),
        access_token: Some(token),
        refresh_token: None,
        migrated_chats: None,
        verification_token: None, // Not needed for login
        message: "Uspešna prijava".to_string(),
    }))
}

// User status endpoint - uses optimized single-query approach
pub async fn user_status_handler(
    State((pool, _, jwt_secret)): State<AuthAppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<UserStatusResponse>, (StatusCode, Json<ErrorResponse>)> {
    let (user_id, device_fingerprint) = extract_user_info(&headers, &jwt_secret);

    match get_user_status_optimized(user_id, device_fingerprint, &pool).await {
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
    State((pool, _, jwt_secret)): State<AuthAppState>,
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
    State((pool, _, _)): State<AuthAppState>,
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
    State((pool, _, _)): State<AuthAppState>,
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

// Email verification endpoint
pub async fn verify_email_handler(
    State((pool, _, _)): State<AuthAppState>,
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
    State((pool, _, jwt_secret)): State<AuthAppState>,
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
    State((pool, _, jwt_secret)): State<AuthAppState>,
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
    State((pool, _, jwt_secret)): State<AuthAppState>,
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
pub async fn start_trial_handler(
    State((pool, _, _)): State<AuthAppState>,
    headers: HeaderMap,
    Json(request): Json<StartTrialRequest>,
) -> Result<Json<TrialResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Validate device fingerprint format
    if request.device_fingerprint.len() != 64
        || !request
            .device_fingerprint
            .chars()
            .all(|c| c.is_ascii_hexdigit())
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "INVALID_FINGERPRINT".to_string(),
                message: "Neispravna identifikacija uređaja".to_string(),
                details: None,
            }),
        ));
    }

    // Extract client IP from headers (consistent with api.rs)
    let client_ip_str = extract_client_ip(&headers);

    // Check IP trial limits (max 3 trials per IP) - includes IP validation
    if !check_ip_trial_limits(&pool, &client_ip_str).await? {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(ErrorResponse {
                error: "IP_LIMIT_EXCEEDED".to_string(),
                message: "Maksimalan broj trial naloga za ovu IP adresu je dostignut (3)"
                    .to_string(),
                details: Some(serde_json::json!({
                    "max_trials_per_ip": 3
                })),
            }),
        ));
    }

    // Check if device fingerprint already has a device trial record
    let existing_trial = sqlx::query("SELECT trial_started_at, trial_messages_remaining FROM users WHERE device_fingerprint = $1 AND account_type = 'trial_unregistered' AND account_status = 'active'")
        .bind(&request.device_fingerprint)
        .fetch_optional(&pool)
        .await
        .map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
                error: "DATABASE_ERROR".to_string(),
                message: "Greška provere device fingerprint".to_string(),
                details: Some(serde_json::json!({"details": e.to_string()})),
            }))
        })?;

    if let Some(existing_trial) = existing_trial {
        let trial_started_at: chrono::DateTime<chrono::Utc> =
            existing_trial.get("trial_started_at");
        let trial_messages_remaining: Option<i32> = existing_trial.get("trial_messages_remaining");

        // Device trial already exists - return existing trial status
        return Ok(Json(TrialResponse {
            success: true,
            trial_started_at,
            trial_expires_at: trial_started_at + chrono::Duration::days(365), // Not used in new simplified system
            messages_remaining: trial_messages_remaining.unwrap_or(0),
            message: format!(
                "Uređaj već ima aktivan trial sa {} preostalih poruka",
                trial_messages_remaining.unwrap_or(0)
            ),
        }));
    }

    // Create new unregistered trial user
    let trial_expires_at = chrono::Utc::now() + chrono::Duration::days(7);
    let trial_email = format!(
        "unregistered_{}@trial.local",
        &request.device_fingerprint[0..8]
    );

    // Insert unregistered trial user with 5 total messages
    sqlx::query(
        "INSERT INTO users (email, password_hash, account_type, device_fingerprint, trial_started_at, trial_expires_at, trial_messages_remaining)
         VALUES ($1, '$2b$12$placeholder.hash.for.unregistered.users', 'trial_unregistered', $2, NOW(), $3, 5)"
    )
    .bind(&trial_email)
    .bind(&request.device_fingerprint)
    .bind(trial_expires_at)
    .execute(&pool)
    .await
    .map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse {
            error: "DATABASE_ERROR".to_string(),
            message: "Greška kreiranja trial naloga".to_string(),
            details: Some(serde_json::json!({"details": e.to_string()})),
        }))
    })?;

    // Log trial start activity
    let client_ip_network =
        ipnetwork::IpNetwork::from(client_ip_str.parse::<std::net::IpAddr>().unwrap());
    sqlx::query(
        "INSERT INTO ip_trial_limits (ip_address, date, count)
         VALUES ($1, CURRENT_DATE, 1)
         ON CONFLICT (ip_address, date)
         DO UPDATE SET count = ip_trial_limits.count + 1",
    )
    .bind(client_ip_network)
    .execute(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "DATABASE_ERROR".to_string(),
                message: "Greška logovanja trial aktivnosti".to_string(),
                details: Some(serde_json::json!({"details": e.to_string()})),
            }),
        )
    })?;

    Ok(Json(TrialResponse {
        success: true,
        trial_started_at: chrono::Utc::now(),
        trial_expires_at,
        messages_remaining: 5, // New trial gets 5 messages
        message: "Trial uspešno aktiviran za 7 dana".to_string(),
    }))
}

// Helper structs
#[derive(serde::Deserialize)]
pub struct StartTrialRequest {
    pub device_fingerprint: String,
}

#[derive(serde::Serialize)]
pub struct TrialResponse {
    pub success: bool,
    pub trial_started_at: chrono::DateTime<chrono::Utc>,
    pub trial_expires_at: chrono::DateTime<chrono::Utc>,
    pub messages_remaining: i32, // Messages remaining for trial
    pub message: String,
}

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
    State((pool, _, jwt_secret)): State<AuthAppState>,
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
    State((pool, _, jwt_secret)): State<AuthAppState>,
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

// ==================== EMAIL FUNCTIONS ====================
// NOTE: Email sending has been moved to frontend using EmailJS
// Backend now only generates tokens and returns them to frontend
// This eliminates the need for backend email configuration
