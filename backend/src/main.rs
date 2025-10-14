mod database;
mod api;
mod scraper;
mod models;
mod simple_auth;
mod legal_parser;
mod laws;
mod contracts;

use axum::{
    routing::{get, post, put, delete},
    Router, 
    extract::DefaultBodyLimit,
    http::Method,
};
use tower_http::cors::{CorsLayer, Any};
use tower_http::trace::TraceLayer;
use sqlx::postgres::PgPoolOptions;
use std::env;
use tracing_subscriber;

async fn health_check() -> &'static str {
    "OK"
}


#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    // Get environment variables
    let database_url = env::var("DATABASE_URL")
        .expect("DATABASE_URL environment variable must be set");
    let openrouter_api_key = env::var("OPENROUTER_API_KEY")
        .expect("OPENROUTER_API_KEY environment variable must be set");
    let openai_api_key = env::var("OPENAI_API_KEY")
        .expect("OPENAI_API_KEY environment variable must be set");
    let jwt_secret = env::var("JWT_SECRET")
        .unwrap_or_else(|_| "default-jwt-secret-key-change-in-production".to_string());

    // Connect to database with optimized pool settings for Fly.io auto-suspension
    let pool = PgPoolOptions::new()
        .max_connections(5)                                // Limit connections (Fly.io free tier)
        .min_connections(1)                                // Keep 1 connection ready
        .acquire_timeout(std::time::Duration::from_secs(5)) // Fast timeout instead of 30s
        .max_lifetime(std::time::Duration::from_secs(30 * 60)) // Recycle connections every 30 min
        .idle_timeout(Some(std::time::Duration::from_secs(5 * 60))) // Close idle after 5 min
        .test_before_acquire(true)                         // Health check before using connection
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    // Run migrations
    database::run_migrations(&pool).await
        .expect("Failed to run migrations");

    // Law cache is now on-demand - no need for startup preloading
    // Laws are cached for 24 hours when users ask about them
    println!("✅ Server ready - laws will be cached on-demand as users ask about them");

    // Clean up old contracts on startup
    match contracts::cleanup_old_contracts() {
        Ok(count) if count > 0 => println!("🗑️  Cleaned up {} expired contracts", count),
        Ok(_) => println!("✅ No expired contracts to clean up"),
        Err(e) => println!("⚠️  Contract cleanup warning: {}", e),
    }

    // Configure CORS
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
        .allow_headers(Any);

    // Complete auth and subscription routes
    let auth_routes = Router::new()
        // Authentication endpoints
        .route("/api/auth/register", post(simple_auth::register_handler))
        .route("/api/auth/login", post(simple_auth::login_handler))
        .route("/api/auth/refresh", post(simple_auth::refresh_handler))
        .route("/api/auth/forgot-password", post(simple_auth::forgot_password_handler))
        .route("/api/auth/reset-password", post(simple_auth::reset_password_handler))
        .route("/api/auth/verify-email", post(simple_auth::verify_email_handler))
        .route("/api/auth/logout", post(simple_auth::logout_handler))
        .route("/api/auth/user-status", get(simple_auth::user_status_handler))
        // Trial endpoint
        .route("/api/trial/start", post(simple_auth::start_trial_handler))
        // Subscription endpoints
        .route("/api/subscription/create", post(simple_auth::create_subscription_handler))
        .route("/api/subscription/status", get(simple_auth::subscription_status_handler))
        .route("/api/subscription/cancel", post(simple_auth::cancel_subscription_handler))
        .route("/api/subscription/change-plan", put(simple_auth::change_plan_handler))
        .route("/api/subscription/billing-period", put(simple_auth::change_billing_period_handler))
        .with_state((pool.clone(), openrouter_api_key.clone(), jwt_secret.clone()));

    // Database and scraper routes (3-element state)
    let database_routes = Router::new()
        .route("/api/chats", get(database::get_chats_handler))
        .route("/api/chats", post(database::create_chat_handler))
        .route("/api/chats/:chat_id", delete(database::delete_chat_handler))
        .route("/api/chats/:chat_id/title", put(database::update_chat_title_handler))
        .route("/api/chats/:chat_id/messages", get(database::get_messages_handler))
        .route("/api/messages", post(database::add_message_handler))
        .route("/api/law-content", post(scraper::fetch_law_content_handler))
        .route("/api/cached-law", post(database::get_cached_law_handler))
        .with_state((pool.clone(), openrouter_api_key.clone(), jwt_secret.clone()));

    // API routes that need OpenAI key (4-element state)
    let api_routes = Router::new()
        .route("/api/question", post(api::ask_question_handler))
        .route("/api/transcribe", post(api::transcribe_audio_handler))
        .with_state((pool, openrouter_api_key, openai_api_key, jwt_secret));

    // Contract download route (no auth required - files are UUID-based)
    let contract_routes = Router::new()
        .route("/api/contracts/:file_id", get(contracts::download_contract_handler));

    // Combine routes
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/debug", get(|| async { "Debug endpoint working!" }))
        .merge(auth_routes)
        .merge(database_routes)
        .merge(api_routes)
        .merge(contract_routes)
        // .layer(axum::middleware::from_fn(request_logger)) // Disabled - only enable for debugging
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024)); // 50MB max body size

    let port = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await.unwrap();
    
    println!("🚀 Server running on http://0.0.0.0:{}", port);
    
    // Serve with connection info for IP extraction
    axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await.unwrap();
}

