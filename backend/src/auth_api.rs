use crate::api::extract_client_ip;
use crate::auth::AuthService;
use crate::models::*;
use crate::trial::TrialService;
use axum::{
    extract::{Extension, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

// Application state for auth endpoints
pub type AppState = (Pool<Postgres>, String, String); // (database pool, openrouter_api_key, jwt_secret)

// Register endpoint
pub async fn register_handler(
    State((pool, _, jwt_secret)): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ErrorResponse>)> {
    let auth_service = AuthService::new(pool, jwt_secret);

    match auth_service.register_user(request).await {
        Ok(response) => Ok(Json(response)),
        Err(error) => {
            let status = match error.error.as_str() {
                "VALIDATION_ERROR" => StatusCode::BAD_REQUEST,
                "EMAIL_EXISTS" => StatusCode::CONFLICT,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            Err((status, Json(error)))
        }
    }
}

// Login endpoint
pub async fn login_handler(
    State((pool, _, jwt_secret)): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<ErrorResponse>)> {
    let auth_service = AuthService::new(pool, jwt_secret);

    match auth_service.login_user(request).await {
        Ok(response) => Ok(Json(response)),
        Err(error) => {
            let status = match error.error.as_str() {
                "VALIDATION_ERROR" => StatusCode::BAD_REQUEST,
                "INVALID_CREDENTIALS" => StatusCode::UNAUTHORIZED,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            Err((status, Json(error)))
        }
    }
}

// User status endpoint (trial/premium info)
pub async fn user_status_handler(
    State((pool, _, jwt_secret)): State<AppState>,
    Extension(claims): Extension<Option<crate::auth::Claims>>,
    device_fingerprint: DeviceFingerprintHeader,
) -> Result<Json<UserStatusResponse>, (StatusCode, Json<ErrorResponse>)> {
    let auth_service = AuthService::new(pool, jwt_secret);

    let user_id = claims.as_ref().and_then(|c| c.sub.parse::<Uuid>().ok());
    let device_fp = device_fingerprint.0.as_deref();

    match auth_service.get_user_status(user_id, device_fp).await {
        Ok(response) => Ok(Json(response)),
        Err(error) => Err((StatusCode::INTERNAL_SERVER_ERROR, Json(error))),
    }
}

// Start trial endpoint
pub async fn start_trial_handler(
    State((pool, _, _)): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<StartTrialRequest>,
) -> Result<Json<TrialResponse>, (StatusCode, Json<ErrorResponse>)> {
    let trial_service = TrialService::new(pool);

    // Extract client IP from headers (consistent with other endpoints)
    let client_ip_str = extract_client_ip(&headers);
    let client_ip = match client_ip_str.parse::<std::net::IpAddr>() {
        Ok(ip) => ip,
        Err(_) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "INVALID_IP".to_string(),
                    message: "Neispravna IP adresa".to_string(),
                    details: None,
                }),
            ));
        }
    };

    match trial_service
        .start_trial(&request.device_fingerprint, client_ip)
        .await
    {
        Ok(trial) => Ok(Json(TrialResponse {
            success: true,
            trial_started_at: trial.trial_started_at,
            trial_expires_at: None,
            messages_remaining: 5, // New trial gets 5 messages
            message: "Trial uspešno aktiviran".to_string(),
        })),
        Err(error) => {
            let status = match error.error.as_str() {
                "IP_LIMIT_EXCEEDED" => StatusCode::TOO_MANY_REQUESTS,
                "TRIAL_EXPIRED" => StatusCode::FORBIDDEN,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            Err((status, Json(error)))
        }
    }
}

// Helper structs for additional endpoints
#[derive(serde::Deserialize)]
pub struct StartTrialRequest {
    pub device_fingerprint: String,
}

#[derive(serde::Serialize)]
pub struct TrialResponse {
    pub success: bool,
    pub trial_started_at: chrono::DateTime<chrono::Utc>,
    pub trial_expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub messages_remaining: i32, // Messages remaining for trial
    pub message: String,
}

// Custom header extractor for device fingerprint
pub struct DeviceFingerprintHeader(pub Option<String>);

impl<S> axum::extract::FromRequestParts<S> for DeviceFingerprintHeader
where
    S: Send + Sync,
{
    type Rejection = ();

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        let device_fingerprint = parts
            .headers
            .get("X-Device-Fingerprint")
            .and_then(|header| header.to_str().ok())
            .map(|s| s.to_string());

        Ok(DeviceFingerprintHeader(device_fingerprint))
    }
}

// Simple subscription management endpoints (placeholder for future payment integration)
pub async fn create_subscription_handler(
    State((pool, _, _)): State<AppState>,
    Extension(claims): Extension<crate::auth::Claims>,
    Json(request): Json<CreateSubscriptionRequest>,
) -> Result<Json<SubscriptionResponse>, (StatusCode, Json<ErrorResponse>)> {
    let user_id: Uuid = claims.sub.parse().map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "INVALID_TOKEN".to_string(),
                message: "Neispravan token".to_string(),
                details: None,
            }),
        )
    })?;

    // Update user to premium status (using new optimized schema)
    let expires_at = chrono::Utc::now() + chrono::Duration::days(30);

    let updated_user = sqlx::query_as::<_, User>(
        r#"
        UPDATE users 
        SET account_type = 'premium', premium_expires_at = $2, updated_at = NOW() 
        WHERE id = $1 
        RETURNING *
        "#,
    )
    .bind(user_id)
    .bind(expires_at)
    .fetch_one(&pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "DATABASE_ERROR".to_string(),
                message: "Greška aktivacije premium pretplate".to_string(),
                details: Some(serde_json::json!({"details": e.to_string()})),
            }),
        )
    })?;

    Ok(Json(SubscriptionResponse {
        success: true,
        subscription_id: updated_user.id.to_string(),
        plan_type: "premium".to_string(),
        status: "active".to_string(),
        expires_at: updated_user.premium_expires_at,
        message: "Premium subscription aktiviran".to_string(),
    }))
}

#[derive(serde::Deserialize)]
pub struct CreateSubscriptionRequest {
    pub price_rsd: Option<i32>,
}

#[derive(serde::Serialize)]
pub struct SubscriptionResponse {
    pub success: bool,
    pub subscription_id: i64,
    pub plan_type: String,
    pub status: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub message: String,
}
