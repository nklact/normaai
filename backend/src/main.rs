mod database;
mod api;
mod scraper;
mod models;
mod simple_auth;
mod legal_parser;
mod laws;
mod contracts;
mod cleanup;
mod sessions;

use axum::{
    routing::{get, post, put, delete},
    Router,
    extract::DefaultBodyLimit,
    http::{Method, HeaderValue},
};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use sqlx::postgres::PgPoolOptions;
use std::{env, sync::Arc};
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

    // Supabase configuration (optional - for social login and unified auth)
    let supabase_url = env::var("SUPABASE_URL").ok();
    let supabase_jwt_secret = env::var("SUPABASE_JWT_SECRET").ok();

    // Connect to database with optimized pool settings for Fly.io auto-suspension
    // IMPORTANT: Use Supabase's Transaction pooler (port 6543) for auto-suspend compatibility
    let pool = PgPoolOptions::new()
        .max_connections(10)                                    // Supabase pooler can handle more
        .min_connections(0)                                     // Don't keep idle connections (they die on suspend)
        .acquire_timeout(std::time::Duration::from_secs(10))    // Allow time for post-wake connection burst
        .max_lifetime(std::time::Duration::from_secs(5 * 60))   // Recycle connections every 5 min
        .idle_timeout(Some(std::time::Duration::from_secs(2 * 60))) // Close idle after 2 min (before suspend)
        .test_before_acquire(true)                              // Health check before reusing
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

    // Start background cleanup job for deleted users (30-day grace period)
    let cleanup_pool = Arc::new(pool.clone());
    tokio::spawn(async move {
        cleanup::start_cleanup_job(cleanup_pool).await;
    });
    println!("🗑️  Started user deletion cleanup job (runs daily)");

    // Configure CORS - allow requests from web app, Tauri desktop, and mobile apps
    // Note: When using allow_credentials(true), we CANNOT use Any for headers
    // We must specify allowed headers explicitly (CORS security requirement)
    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:1420".parse::<HeaderValue>().unwrap(), // Tauri dev
            "https://tauri.localhost".parse::<HeaderValue>().unwrap(), // Tauri production
            "tauri://localhost".parse::<HeaderValue>().unwrap(), // Tauri custom protocol
            "https://chat.normaai.rs".parse::<HeaderValue>().unwrap(), // Production web
            "http://localhost:5173".parse::<HeaderValue>().unwrap(), // Vite dev
            "http://localhost:3000".parse::<HeaderValue>().unwrap(), // Alternative dev port
        ])
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
            axum::http::header::ACCEPT,
            axum::http::header::HeaderName::from_static("x-device-session-id"), // Custom header for session deduplication
        ])
        .allow_credentials(true); // Required for Authorization header support

    // Complete auth and subscription routes
    let auth_routes = Router::new()
        // Authentication endpoints
        .route("/api/auth/link-user", post(simple_auth::link_user_handler))
        .route("/api/auth/check-provider", post(simple_auth::check_provider_handler))
        .route("/api/auth/refresh", post(simple_auth::refresh_handler))
        .route("/api/auth/forgot-password", post(simple_auth::forgot_password_handler))
        .route("/api/auth/reset-password", post(simple_auth::reset_password_handler))
        .route("/api/auth/request-email-verification", post(simple_auth::request_email_verification_handler))
        .route("/api/auth/verify-email", post(simple_auth::verify_email_handler))
        .route("/api/auth/logout", post(simple_auth::logout_handler))
        .route("/api/auth/user-status", get(simple_auth::user_status_handler))
        // Session management endpoints
        .route("/api/auth/sessions", get(simple_auth::get_sessions_handler))
        .route("/api/auth/sessions/revoke", post(simple_auth::revoke_session_handler))
        .route("/api/auth/sessions/revoke-all", post(simple_auth::revoke_all_sessions_handler))
        // Password change endpoint
        .route("/api/auth/change-password", post(simple_auth::change_password_handler))
        // Account deletion endpoints
        .route("/api/auth/delete-account", post(simple_auth::request_delete_account_handler))
        .route("/api/auth/restore-account", post(simple_auth::restore_account_handler))
        // Subscription endpoints
        .route("/api/subscription/create", post(simple_auth::create_subscription_handler))
        .route("/api/subscription/status", get(simple_auth::subscription_status_handler))
        .route("/api/subscription/cancel", post(simple_auth::cancel_subscription_handler))
        .route("/api/subscription/change-plan", put(simple_auth::change_plan_handler))
        .route("/api/subscription/billing-period", put(simple_auth::change_billing_period_handler))
        .with_state((
            pool.clone(),
            openrouter_api_key.clone(),
            jwt_secret.clone(),
            supabase_url.clone(),
            supabase_jwt_secret.clone(),
        ));

    // Database and scraper routes (4-element state with Supabase JWT secret)
    let database_routes = Router::new()
        .route("/api/chats", get(database::get_chats_handler))
        .route("/api/chats", post(database::create_chat_handler))
        .route("/api/chats/:chat_id", delete(database::delete_chat_handler))
        .route("/api/chats/:chat_id/title", put(database::update_chat_title_handler))
        .route("/api/chats/:chat_id/messages", get(database::get_messages_handler))
        .route("/api/messages", post(database::add_message_handler))
        .route("/api/messages/:message_id/feedback", post(database::submit_message_feedback_handler))
        .route("/api/law-content", post(scraper::fetch_law_content_handler))
        .route("/api/cached-law", post(database::get_cached_law_handler))
        .with_state((pool.clone(), openrouter_api_key.clone(), jwt_secret.clone(), supabase_jwt_secret.clone()));

    // API routes that need OpenAI key (5-element state with Supabase JWT secret)
    let api_routes = Router::new()
        .route("/api/question", post(api::ask_question_handler))
        .route("/api/transcribe", post(api::transcribe_audio_handler))
        .with_state((pool, openrouter_api_key, openai_api_key, jwt_secret, supabase_jwt_secret));

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

