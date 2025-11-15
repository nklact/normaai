use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct RevenueCatClient {
    api_key: String,
    base_url: String,
    client: reqwest::Client,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SubscriberInfo {
    pub subscriber: Subscriber,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Subscriber {
    pub original_app_user_id: String,
    pub entitlements: HashMap<String, Entitlement>,
    pub subscriptions: HashMap<String, Subscription>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Entitlement {
    pub expires_date: Option<String>,
    pub product_identifier: String,
    pub purchase_date: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Subscription {
    pub expires_date: Option<String>,
    pub purchase_date: String,
    pub original_purchase_date: String,
    pub period_type: String, // "normal", "trial", "intro"
    pub store: String, // "app_store", "play_store", "stripe", etc.
    pub is_sandbox: bool,
    pub unsubscribe_detected_at: Option<String>,
    pub billing_issues_detected_at: Option<String>,
    pub ownership_type: String, // "PURCHASED", "FAMILY_SHARED"
}

#[derive(Debug, Deserialize, Serialize)]
pub struct WebhookEvent {
    pub event: WebhookEventData,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct WebhookEventData {
    #[serde(rename = "type")]
    pub event_type: String, // "INITIAL_PURCHASE", "RENEWAL", "CANCELLATION", etc.
    pub app_user_id: String,
    pub product_id: String,
    pub period_type: String,
    pub purchased_at_ms: i64,
    pub expiration_at_ms: Option<i64>,
    pub store: String,
    pub environment: String, // "PRODUCTION", "SANDBOX"
}

#[derive(Debug, Clone)]
pub struct SubscriptionStatus {
    pub account_type: String,
    pub subscription_type: Option<String>, // "monthly" or "yearly"
    pub expires_at: Option<DateTime<Utc>>,
    pub is_active: bool,
    pub platform: Option<String>, // "ios", "android", "web"
    pub in_grace_period: bool, // True if subscription has billing issues but still in grace period
}

impl RevenueCatClient {
    /// Create a new RevenueCat client
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            base_url: "https://api.revenuecat.com/v1".to_string(),
            client: reqwest::Client::new(),
        }
    }

    /// Fetch subscriber information from RevenueCat
    pub async fn get_subscriber(&self, app_user_id: &str) -> Result<SubscriberInfo, String> {
        let url = format!("{}/subscribers/{}", self.base_url, app_user_id);

        let response = self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .send()
            .await
            .map_err(|e| format!("Failed to fetch subscriber: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!("RevenueCat API error {}: {}", status, body));
        }

        response
            .json::<SubscriberInfo>()
            .await
            .map_err(|e| format!("Failed to parse subscriber info: {}", e))
    }

    /// Get the current subscription status for a user
    pub async fn get_subscription_status(&self, app_user_id: &str) -> Result<SubscriptionStatus, String> {
        let subscriber_info = self.get_subscriber(app_user_id).await?;

        // Check for active entitlements (not expired)
        let now = Utc::now();
        let has_professional = subscriber_info.subscriber.entitlements.get("professional")
            .and_then(|e| e.expires_date.as_ref())
            .and_then(|d| DateTime::parse_from_rfc3339(d).ok())
            .map(|expires| expires.with_timezone(&Utc) > now)
            .unwrap_or(false);

        let has_individual = subscriber_info.subscriber.entitlements.get("individual")
            .and_then(|e| e.expires_date.as_ref())
            .and_then(|d| DateTime::parse_from_rfc3339(d).ok())
            .map(|expires| expires.with_timezone(&Utc) > now)
            .unwrap_or(false);

        // Determine account type based on active entitlements
        let account_type = if has_professional {
            "professional"
        } else if has_individual {
            "individual"
        } else {
            "trial_registered" // Default to trial if no active entitlements
        };

        // Find the active subscription details
        let active_subscription = subscriber_info.subscriber.subscriptions
            .values()
            .filter(|sub| {
                // Check if subscription is still active
                if let Some(expires_date) = &sub.expires_date {
                    if let Ok(expires) = DateTime::parse_from_rfc3339(expires_date) {
                        return expires.with_timezone(&Utc) > Utc::now();
                    }
                }
                false
            })
            .max_by_key(|sub| {
                // Get the most recent subscription
                sub.purchase_date.clone()
            });

        let (subscription_type, expires_at, platform, in_grace_period) = if let Some(sub) = active_subscription {
            // Determine if monthly or yearly based on product identifier
            let sub_type = if subscriber_info.subscriber.subscriptions
                .keys()
                .any(|k| k.contains("yearly")) {
                Some("yearly".to_string())
            } else {
                Some("monthly".to_string())
            };

            // Parse expiration date
            let expires = sub.expires_date.as_ref()
                .and_then(|d| DateTime::parse_from_rfc3339(d).ok())
                .map(|d| d.with_timezone(&Utc));

            // Determine platform
            let platform = match sub.store.as_str() {
                "app_store" => Some("ios".to_string()),
                "play_store" => Some("android".to_string()),
                "stripe" => Some("web".to_string()),
                _ => None,
            };

            // Check for grace period (billing issues detected but not yet expired)
            let in_grace = sub.billing_issues_detected_at.is_some()
                && sub.expires_date.as_ref()
                    .and_then(|d| DateTime::parse_from_rfc3339(d).ok())
                    .map(|expires| expires.with_timezone(&Utc) > Utc::now())
                    .unwrap_or(false);

            (sub_type, expires, platform, in_grace)
        } else {
            (None, None, None, false)
        };

        let is_active = account_type != "trial_registered";

        Ok(SubscriptionStatus {
            account_type: account_type.to_string(),
            subscription_type,
            expires_at,
            is_active,
            platform,
            in_grace_period,
        })
    }

    /// Link a purchase receipt to a user in RevenueCat
    /// This tells RevenueCat which user made the purchase
    pub async fn link_purchase_to_user(
        &self,
        app_user_id: &str,
        receipt_token: &str,
        is_restore: bool,
    ) -> Result<SubscriberInfo, String> {
        let url = format!("{}/receipts", self.base_url);

        let payload = serde_json::json!({
            "app_user_id": app_user_id,
            "fetch_token": receipt_token,
            "is_restore": is_restore,
        });

        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .header("X-Platform", "android") // Will be overridden by receipt type
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Failed to link purchase: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!("RevenueCat API error {}: {}", status, body));
        }

        response
            .json::<SubscriberInfo>()
            .await
            .map_err(|e| format!("Failed to parse subscriber info: {}", e))
    }

    /// Verify webhook signature (if RevenueCat sends signed webhooks)
    /// Note: RevenueCat uses Authorization header for webhook authentication
    pub fn verify_webhook_signature(&self, authorization_header: &str, webhook_secret: &str) -> bool {
        // RevenueCat sends: Authorization: Bearer <webhook_secret>
        let expected = format!("Bearer {}", webhook_secret);
        authorization_header == expected
    }
}

/// Map RevenueCat product IDs to our internal plan types
pub fn product_id_to_plan_info(product_id: &str) -> Option<(&str, &str)> {
    // Returns (account_type, billing_period)
    match product_id {
        "com.nikola.normaai.individual.monthly" => Some(("individual", "monthly")),
        "com.nikola.normaai.individual.yearly" => Some(("individual", "yearly")),
        "com.nikola.normaai.professional.monthly" => Some(("professional", "monthly")),
        "com.nikola.normaai.professional.yearly" => Some(("professional", "yearly")),
        "com.nikola.normaai.team.monthly" => Some(("team", "monthly")),
        "com.nikola.normaai.team.yearly" => Some(("team", "yearly")),
        _ => None,
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_product_id_mapping() {
        assert_eq!(
            product_id_to_plan_info("com.nikola.normaai.individual.monthly"),
            Some(("individual", "monthly"))
        );
        assert_eq!(
            product_id_to_plan_info("com.nikola.normaai.professional.yearly"),
            Some(("professional", "yearly"))
        );
        assert_eq!(
            product_id_to_plan_info("invalid.product.id"),
            None
        );
    }

}
