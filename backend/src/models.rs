use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use validator::{Validate, ValidationError};

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Chat {
    pub id: i64,
    pub title: String,
    pub user_id: Option<Uuid>,
    pub device_fingerprint: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Message {
    pub id: i64,
    pub chat_id: i64,
    pub role: String,
    pub content: String,
    pub law_name: Option<String>,
    pub has_document: Option<bool>,
    pub document_filename: Option<String>,
    pub contract_file_id: Option<String>,
    pub contract_type: Option<String>,
    pub contract_filename: Option<String>,
    pub message_feedback: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct LawCache {
    pub id: i64,
    pub law_name: String,
    pub law_url: String,
    pub content: String,
    pub cached_at: chrono::DateTime<chrono::Utc>,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateChatRequest {
    pub title: String,
    pub device_fingerprint: Option<String>, // For trial users
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateChatResponse {
    pub id: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AddMessageRequest {
    pub chat_id: i64,
    pub role: String,
    pub content: String,
    pub law_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SubmitFeedbackRequest {
    pub feedback_type: String, // 'positive' or 'negative'
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SubmitFeedbackResponse {
    pub success: bool,
    pub message: String,
    pub updated: bool, // true if feedback was changed from previous value
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetCachedLawRequest {
    pub law_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LawContent {
    pub title: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FetchLawContentRequest {
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuestionRequest {
    pub question: String,
    pub document_content: Option<String>, // Extracted document text
    pub document_filename: Option<String>, // Original filename
    pub law_name: Option<String>, // Optional - will be auto-detected if not provided
    pub law_url: Option<String>, // Optional - will be auto-detected if not provided
    pub chat_id: i64,
    pub device_fingerprint: Option<String>, // For trial users
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GeneratedContract {
    pub filename: String,
    pub download_url: String,
    pub contract_type: String,
    pub preview_text: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QuestionResponse {
    pub answer: String,
    pub law_quotes: Vec<String>,
    pub law_name: Option<String>,
    pub generated_contract: Option<GeneratedContract>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerbianLaw {
    pub id: i32,
    pub name: String,
    pub url: String,
}

// Authentication Models
#[derive(Debug, Deserialize, Validate)]
pub struct RegisterRequest {
    #[validate(email(message = "Neispravna email adresa"))]
    #[validate(length(max = 254, message = "Email adresa je predugačka"))]
    pub email: String,
    
    #[validate(length(min = 8, max = 128, message = "Lozinka mora imati između 8 i 128 karaktera"))]
    #[validate(custom = "validate_password_strength")]
    pub password: String,
    
    #[validate(length(min = 10, max = 500, message = "Neispravna identifikacija uređaja"))]
    pub device_fingerprint: String,
}

#[derive(Debug, Deserialize, Validate)]
pub struct LoginRequest {
    #[validate(email(message = "Neispravna email adresa"))]
    #[validate(length(max = 254, message = "Email adresa je predugačka"))]
    pub email: String,
    
    #[validate(length(min = 1, max = 128, message = "Lozinka je obavezna"))]
    pub password: String,
    
    #[validate(length(min = 10, max = 500, message = "Neispravna identifikacija uređaja"))]
    pub device_fingerprint: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResponse {
    pub success: bool,
    pub user_id: Option<Uuid>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub migrated_chats: Option<i64>,
    pub verification_token: Option<String>, // Added for EmailJS integration
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: String,
    pub message: String,
    pub details: Option<serde_json::Value>,
}

// Optimized User Model (replaces users + device_fingerprints + subscriptions)
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub auth_user_id: Option<Uuid>, // Link to Supabase auth.users(id)
    pub email: String,
    pub password_hash: Option<String>, // Nullable for social login users
    pub email_verified: bool,
    pub name: Option<String>, // User's full name (from social login or registration)
    pub oauth_provider: Option<String>, // 'google', 'facebook', 'apple', NULL for email/password
    pub oauth_profile_picture_url: Option<String>, // Avatar URL from OAuth provider
    pub account_type: String, // 'trial_unregistered', 'trial_registered', 'individual', 'professional', 'team', 'premium'
    pub account_status: String, // 'active', 'suspended', 'deleted'
    pub device_fingerprint: Option<String>,
    pub team_id: Option<uuid::Uuid>,
    pub trial_started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub trial_expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub trial_messages_remaining: Option<i32>,
    pub premium_expires_at: Option<chrono::DateTime<chrono::Utc>>,
    // New subscription fields
    pub subscription_type: Option<String>, // 'monthly', 'yearly'
    pub subscription_started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub next_billing_date: Option<chrono::DateTime<chrono::Utc>>,
    pub subscription_status: Option<String>, // 'active', 'cancelled', 'expired'
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub last_login: Option<chrono::DateTime<chrono::Utc>>,
}

impl User {
    pub fn is_registered(&self) -> bool {
        matches!(self.account_type.as_str(), "trial_registered" | "individual" | "professional" | "team" | "premium")
    }

    pub fn can_upload_documents(&self) -> bool {
        matches!(self.account_type.as_str(), "professional" | "team" | "premium")
    }
}

// Unified Authentication Token Model (replaces email_verification_tokens + password_reset_tokens)
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct AuthenticationToken {
    pub id: i64,
    pub user_id: Uuid,
    pub token_type: String, // 'email_verification', 'password_reset', 'jwt_refresh'
    pub token: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub used_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl AuthenticationToken {
    pub async fn create(
        pool: &sqlx::Pool<sqlx::Postgres>,
        user_id: Uuid,
        token_type: &str,
        token: String,
        expires_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO authentication_tokens (user_id, token_type, token, expires_at) VALUES ($1, $2, $3, $4)"
        )
        .bind(user_id)
        .bind(token_type)
        .bind(token)
        .bind(expires_at)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn find_by_token(
        pool: &sqlx::Pool<sqlx::Postgres>,
        token: &str,
        token_type: &str,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            "SELECT id, user_id, token_type, token, expires_at, used_at, created_at FROM authentication_tokens WHERE token = $1 AND token_type = $2"
        )
        .bind(token)
        .bind(token_type)
        .fetch_optional(pool)
        .await
    }

    pub async fn mark_as_used(&self, pool: &sqlx::Pool<sqlx::Postgres>) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE authentication_tokens SET used_at = NOW() WHERE token = $1 AND token_type = $2")
            .bind(&self.token)
            .bind(&self.token_type)
            .execute(pool)
            .await?;

        Ok(())
    }

    pub fn is_valid(&self) -> bool {
        self.used_at.is_none() && chrono::Utc::now() < self.expires_at
    }
}

// IP Trial Limits Model (tracks trial starts per IP address)
#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct IpTrialLimit {
    pub id: i64,
    pub ip_address: ipnetwork::IpNetwork, // Use proper IP type for PostgreSQL INET
    pub date: chrono::NaiveDate,
    pub count: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserStatusResponse {
    pub is_authenticated: bool,
    pub user_id: Option<Uuid>,
    pub email: Option<String>,
    pub access_type: String, // "trial", "registered_trial", "premium" - for frontend compatibility
    pub account_type: String, // "trial_unregistered", "trial_registered", "premium" - internal use
    pub trial_expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub premium_expires_at: Option<chrono::DateTime<chrono::Utc>>, 
    pub subscription_expires_at: Option<chrono::DateTime<chrono::Utc>>, // Alias for frontend compatibility
    pub messages_used_today: i32, // Deprecated, always 0
    pub messages_remaining: Option<i32>, // None for premium (unlimited)
    pub total_messages_sent: i32, // Total number of user messages ever sent (for UI hints)
    // New subscription details
    pub subscription_type: Option<String>, // "monthly", "yearly"
    pub subscription_started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub next_billing_date: Option<chrono::DateTime<chrono::Utc>>,
    pub subscription_status: Option<String>, // "active", "cancelled", "expired"
}


// Complex parsing models removed - using simplified LLM-guided approach


// Password Reset Response
#[derive(Debug, Serialize, Deserialize)]
pub struct PasswordResetResponse {
    pub success: bool,
    pub message: String,
    pub reset_token: Option<String>, // Added for EmailJS integration
    pub email: Option<String>, // Added for EmailJS integration
}

// Password validation function
pub fn validate_password_strength(password: &str) -> Result<(), ValidationError> {
    let has_uppercase = password.chars().any(char::is_uppercase);
    let has_lowercase = password.chars().any(char::is_lowercase);
    let has_digit = password.chars().any(char::is_numeric);
    let has_special = password.chars().any(|c| "!@#$%^&*()_+-=[]{}|;:,.<>?".contains(c));
    
    if !(has_uppercase && has_lowercase && has_digit && has_special) {
        return Err(ValidationError::new("Lozinka mora sadržavati velika i mala slova, broj i specijalni karakter"));
    }
    Ok(())
}