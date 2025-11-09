use sqlx::PgPool;
use std::sync::Arc;
use tokio::time::{interval, Duration};
use tracing::{error, info};
use crate::database::{get_expired_deleted_users, permanently_delete_user};

/// Background job to permanently delete users after 30-day grace period
/// AND clean up expired sessions
/// Runs once per day at startup time
pub async fn start_cleanup_job(pool: Arc<PgPool>) {
    let mut interval = interval(Duration::from_secs(86400)); // 24 hours = 86400 seconds

    loop {
        interval.tick().await;

        info!("🗑️  Running daily cleanup jobs");

        // 1. Clean up expired and old revoked sessions
        info!("🔐 Cleaning up expired sessions");
        match crate::sessions::cleanup_sessions(&pool).await {
            Ok(count) => {
                if count > 0 {
                    info!("✅ Cleaned up {} expired/revoked session(s)", count);
                } else {
                    info!("✅ No sessions to clean up");
                }
            }
            Err(e) => {
                error!("❌ Failed to clean up sessions: {}", e);
            }
        }

        // 2. Permanently delete users after grace period
        info!("👤 Checking for users to permanently delete");
        match get_expired_deleted_users(&pool).await {
            Ok(user_ids) => {
                if user_ids.is_empty() {
                    info!("✅ No users to permanently delete");
                } else {
                    info!("📋 Found {} user(s) to permanently delete", user_ids.len());

                    for user_id in user_ids {
                        match permanently_delete_user(user_id, &pool).await {
                            Ok(_) => {
                                info!("✅ Successfully permanently deleted user: {}", user_id);
                                // TODO: Send confirmation email (if needed)
                                // TODO: Log to audit trail
                            }
                            Err(e) => {
                                error!("❌ Failed to permanently delete user {}: {}", user_id, e);
                            }
                        }
                    }
                }
            }
            Err(e) => {
                error!("❌ Failed to fetch expired deleted users: {}", e);
            }
        }

        info!("✅ Daily cleanup jobs completed");
    }
}
