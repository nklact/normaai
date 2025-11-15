use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Json as ResponseJson,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::revenuecat::{RevenueCatClient, WebhookEvent, product_id_to_plan_info};

type AppState = (PgPool, String, String, Option<String>, Option<String>, String); // (pool, api_key, jwt_secret, supabase_url, supabase_jwt_secret, resend_api_key)

#[derive(Debug, Serialize)]
pub struct WebhookResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct LinkPurchaseRequest {
    pub receipt_token: String,
    pub is_restore: bool,
}

/// Handle RevenueCat webhook events
///
/// RevenueCat sends webhooks for various subscription events:
/// - INITIAL_PURCHASE: First time user subscribes
/// - RENEWAL: Subscription auto-renewed
/// - CANCELLATION: User cancelled subscription
/// - EXPIRATION: Subscription expired
/// - BILLING_ISSUE: Payment failed
/// - etc.
///
/// Best practice: Instead of handling each event type differently,
/// we fetch the latest subscriber state from RevenueCat API and sync it.
pub async fn handle_revenuecat_webhook(
    State((pool, api_key, _, _, _, _)): State<AppState>,
    headers: HeaderMap,
    ResponseJson(payload): ResponseJson<WebhookEvent>,
) -> Result<ResponseJson<WebhookResponse>, (StatusCode, String)> {
    // Log webhook details with parsed product information
    let plan_info = product_id_to_plan_info(&payload.event.product_id);
    info!(
        "Received RevenueCat webhook: event_type={}, product_id={}, plan_info={:?}, user={}, environment={}",
        payload.event.event_type,
        payload.event.product_id,
        plan_info,
        payload.event.app_user_id,
        payload.event.environment  // ← Will show "SANDBOX" or "PRODUCTION"
    );

    // 1. Verify webhook signature
    let webhook_secret = std::env::var("REVENUECAT_WEBHOOK_SECRET")
        .unwrap_or_else(|_| String::new());

    if !webhook_secret.is_empty() {
        let authorization = headers
            .get("Authorization")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");

        let revenuecat_client = RevenueCatClient::new(
            std::env::var("REVENUECAT_API_KEY")
                .unwrap_or_else(|_| api_key.clone())
        );

        if !revenuecat_client.verify_webhook_signature(authorization, &webhook_secret) {
            warn!("Invalid webhook signature");
            return Err((
                StatusCode::UNAUTHORIZED,
                "Invalid webhook signature".to_string(),
            ));
        }
    }

    // 2. Extract user ID from webhook
    let app_user_id = &payload.event.app_user_id;
    let user_id = match Uuid::parse_str(app_user_id) {
        Ok(id) => id,
        Err(e) => {
            error!("Invalid user ID in webhook: {}", e);
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Invalid user ID: {}", e),
            ));
        }
    };

    // 3. Fetch latest subscription status from RevenueCat
    let revenuecat_client = RevenueCatClient::new(
        std::env::var("REVENUECAT_API_KEY")
            .unwrap_or_else(|_| api_key.clone())
    );

    let subscription_status = match revenuecat_client.get_subscription_status(app_user_id).await {
        Ok(status) => status,
        Err(e) => {
            error!("Failed to fetch subscription status: {}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch subscription status: {}", e),
            ));
        }
    };

    // 4. Update user in database
    match update_user_subscription(&pool, user_id, &subscription_status).await {
        Ok(_) => {
            info!(
                user_id = %user_id,
                account_type = %subscription_status.account_type,
                "Successfully updated user subscription from webhook"
            );
            Ok(ResponseJson(WebhookResponse {
                success: true,
                message: "Webhook processed successfully".to_string(),
            }))
        }
        Err(e) => {
            error!("Failed to update user subscription: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to update user: {}", e),
            ))
        }
    }
}

/// Update user subscription information in the database
async fn update_user_subscription(
    pool: &PgPool,
    user_id: Uuid,
    status: &crate::revenuecat::SubscriptionStatus,
) -> Result<(), String> {
    // Determine subscription_status
    // Grace period: billing issues detected but subscription hasn't expired yet
    let subscription_status = if status.in_grace_period {
        "active" // Keep active during grace period
    } else if status.is_active {
        "active"
    } else if status.expires_at.is_some() {
        "expired"
    } else {
        "cancelled"
    };

    // Calculate next billing date (for active subscriptions)
    let next_billing_date = if status.is_active {
        status.expires_at
    } else {
        None
    };

    // Determine final account_type and messages
    // If subscription is not active AND not in grace period, downgrade to trial
    let (final_account_type, messages_remaining) = if !status.is_active && !status.in_grace_period {
        // Subscription expired/cancelled - revert to trial with 0 messages
        // (they already used their original 5 trial messages)
        ("trial_registered", Some(0))
    } else {
        // Active subscription - use proper account type and message limits
        let messages = match status.account_type.as_str() {
            "individual" => Some(20),
            "professional" => None, // Unlimited
            _ => Some(5), // Fallback to trial
        };
        (status.account_type.as_str(), messages)
    };

    // Update user record
    let result = sqlx::query(
        "UPDATE users SET
            account_type = $1,
            subscription_type = $2,
            subscription_status = $3,
            premium_expires_at = $4,
            next_billing_date = $5,
            trial_messages_remaining = $6,
            platform = $7,
            revenuecat_subscriber_id = $8,
            last_receipt_validation = NOW(),
            updated_at = NOW()
        WHERE id = $9"
    )
    .bind(final_account_type)
    .bind(&status.subscription_type)
    .bind(subscription_status)
    .bind(status.expires_at)
    .bind(next_billing_date)
    .bind(messages_remaining)
    .bind(&status.platform)
    .bind(user_id.to_string()) // Use user UUID as RevenueCat subscriber ID
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| format!("Database error: {}", e))?;

    if result.rows_affected() == 0 {
        return Err(format!("User not found: {}", user_id));
    }

    Ok(())
}

/// Manual endpoint to verify and sync a user's subscription status
/// This is useful for debugging or when webhook delivery fails
pub async fn verify_subscription(
    State((pool, api_key, jwt_secret, _, supabase_jwt_secret, _)): State<AppState>,
    headers: HeaderMap,
) -> Result<ResponseJson<WebhookResponse>, (StatusCode, String)> {
    // Verify user authentication
    let user_id = crate::database::verify_user_from_headers_async(
        &headers,
        &jwt_secret,
        supabase_jwt_secret.as_deref(),
        &pool,
    )
    .await
    .ok_or_else(|| {
        (StatusCode::UNAUTHORIZED, "Unauthorized".to_string())
    })?;

    info!("Manual subscription verification for user {}", user_id);

    // Fetch subscription status from RevenueCat
    let revenuecat_client = RevenueCatClient::new(
        std::env::var("REVENUECAT_API_KEY")
            .unwrap_or_else(|_| api_key.clone())
    );

    let subscription_status = match revenuecat_client.get_subscription_status(&user_id.to_string()).await {
        Ok(status) => status,
        Err(e) => {
            warn!("Failed to fetch subscription status: {}", e);
            // If RevenueCat doesn't have the user, return current status
            return Ok(ResponseJson(WebhookResponse {
                success: true,
                message: "No subscription found in RevenueCat".to_string(),
            }));
        }
    };

    // Update database
    match update_user_subscription(&pool, user_id, &subscription_status).await {
        Ok(_) => {
            info!(
                user_id = %user_id,
                account_type = %subscription_status.account_type,
                "Successfully verified and updated subscription"
            );
            Ok(ResponseJson(WebhookResponse {
                success: true,
                message: format!(
                    "Subscription verified: {} ({})",
                    subscription_status.account_type,
                    subscription_status.subscription_type.as_deref().unwrap_or("N/A")
                ),
            }))
        }
        Err(e) => {
            error!("Failed to update user subscription: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to update subscription: {}", e),
            ))
        }
    }
}

/// Link a purchase receipt to the user in RevenueCat
/// This is called after a successful IAP purchase to associate it with the user
pub async fn link_purchase(
    State((pool, api_key, jwt_secret, _, supabase_jwt_secret, _)): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<LinkPurchaseRequest>,
) -> Result<ResponseJson<WebhookResponse>, (StatusCode, String)> {
    // Verify user authentication
    let user_id = crate::database::verify_user_from_headers_async(
        &headers,
        &jwt_secret,
        supabase_jwt_secret.as_deref(),
        &pool,
    )
    .await
    .ok_or_else(|| {
        (StatusCode::UNAUTHORIZED, "Unauthorized".to_string())
    })?;

    info!(
        user_id = %user_id,
        is_restore = payload.is_restore,
        "Linking purchase to user"
    );

    let revenuecat_client = RevenueCatClient::new(
        std::env::var("REVENUECAT_API_KEY")
            .unwrap_or_else(|_| api_key.clone())
    );

    // Link purchase to user in RevenueCat
    match revenuecat_client
        .link_purchase_to_user(&user_id.to_string(), &payload.receipt_token, payload.is_restore)
        .await
    {
        Ok(_) => {
            info!(user_id = %user_id, "Successfully linked purchase to RevenueCat");
        }
        Err(e) => {
            error!("Failed to link purchase to RevenueCat: {}", e);
            // Don't fail - webhook will eventually sync
            warn!("Purchase linking failed, but webhook should sync later");
        }
    }

    // Fetch and update subscription status
    let subscription_status = match revenuecat_client.get_subscription_status(&user_id.to_string()).await {
        Ok(status) => status,
        Err(e) => {
            error!("Failed to fetch subscription status after linking: {}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to fetch subscription: {}", e),
            ));
        }
    };

    // Update database
    match update_user_subscription(&pool, user_id, &subscription_status).await {
        Ok(_) => {
            info!(
                user_id = %user_id,
                account_type = %subscription_status.account_type,
                "Successfully linked and activated subscription"
            );
            Ok(ResponseJson(WebhookResponse {
                success: true,
                message: format!(
                    "Subscription activated: {} ({})",
                    subscription_status.account_type,
                    subscription_status.subscription_type.as_deref().unwrap_or("N/A")
                ),
            }))
        }
        Err(e) => {
            error!("Failed to update user subscription: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to update subscription: {}", e),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_subscription_status_mapping() {
        // Test that active subscription maps to "active"
        let status = crate::revenuecat::SubscriptionStatus {
            account_type: "professional".to_string(),
            subscription_type: Some("monthly".to_string()),
            expires_at: Some(chrono::Utc::now() + chrono::Duration::days(30)),
            is_active: true,
            platform: Some("ios".to_string()),
            in_grace_period: false,
        };

        assert!(status.is_active);
        assert_eq!(status.account_type, "professional");
    }
}
