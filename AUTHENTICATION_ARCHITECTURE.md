# Norma AI - Authentication Architecture Overview

## Project Structure

### Project Type
- **Multi-platform Tauri Application** supporting:
  - Web (React SPA)
  - Desktop (Windows, macOS, Linux)
  - Mobile (iOS via ASWebAuthenticationSession, Android via Custom Tabs)
  - Version: 0.4.12

### Technology Stack

#### Frontend
- **Framework**: React 19.1.0 with Vite
- **UI Library**: Vanilla CSS with custom components
- **State Management**: React hooks with context API
- **Language**: JSX/JavaScript
- **Package Manager**: npm

#### Backend
- **Language**: Rust (Axum web framework)
- **Runtime**: Tokio async runtime
- **Database**: PostgreSQL via Supabase
- **Server**: Deployed on Fly.io
- **API Base URL**: https://norma-ai.fly.dev

#### Desktop/Mobile Framework
- **Tauri**: Version 2.8.0
- **Build Tool**: Vite with Tauri CLI

## Authentication Methods

### 1. Email/Password Authentication
- **Provider**: Supabase Auth
- **Files**:
  - Frontend: /src/components/AuthModal.jsx
  - Backend: /backend/src/simple_auth.rs
  - API: POST /api/auth/register, POST /api/auth/login

### 2. Google OAuth 2.0 (Unified)
- **Web & Desktop**: Supabase OAuth (redirect-based PKCE)
- **iOS**: tauri-plugin-web-auth with ASWebAuthenticationSession
- **Android**: tauri-plugin-web-auth with Custom Tabs
- **Files**:
  - Frontend: /src/services/api.js (signInWithGoogle method)
  - UI: /src/components/AuthModal.jsx

## Key Files & Paths

### Frontend Files
- /src/components/AuthModal.jsx - Auth UI & Google login handler
- /src/services/api.js - API client, Supabase setup, auth logic
- /src/App.jsx - Main app with auth state management
- /src/utils/deviceFingerprint.js - Device identification
- package.json - Frontend dependencies

### Backend Files
- /backend/src/main.rs - Server setup & route definitions
- /backend/src/simple_auth.rs - Authentication handlers
- /backend/src/models.rs - Request/response models
- /backend/Cargo.toml - Backend dependencies

### Tauri Files
- /src-tauri/src/lib.rs - Plugin initialization
- /src-tauri/src/main.rs - Tauri app entry point
- /src-tauri/Cargo.toml - Tauri dependencies
- /src-tauri/tauri.conf.json - App configuration

### Configuration
- /.env.example - Environment variable reference
- /src-tauri/tauri.conf.json - Tauri config with iOS bundle settings
- /.github/workflows/ios.yml - iOS build workflow

## Authentication Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/auth/register | POST | Register with email/password |
| /api/auth/login | POST | Login with email/password |
| /api/auth/logout | POST | Logout |
| /api/auth/user-status | GET | Get user account status |
| /api/auth/forgot-password | POST | Request password reset |
| /api/trial/start | POST | Start free trial |
| /api/subscription/change-plan | PUT | Change subscription plan |

## Database Schema (Auth)

### Users Table
- id (UUID, primary key)
- auth_user_id (UUID, references Supabase auth.users)
- email (VARCHAR)
- account_type (VARCHAR: trial_unregistered, trial_registered, individual, professional, team)
- messages_remaining (INT, NULL for unlimited)
- device_fingerprint (VARCHAR)
- created_at (TIMESTAMP)

### Subscriptions Table
- id (UUID)
- user_id (UUID)
- plan_type (VARCHAR: trial, individual, professional, team)
- billing_period (VARCHAR: monthly, yearly)
- status (VARCHAR: active, cancelled)

## Session Management

### Storage
- **Desktop/Mobile**: Tauri plugin-store (encrypted by OS)
- **Web**: Browser localStorage (Supabase default)

### Token Management
- **PKCE Flow**: Used for all OAuth flows
- **Access Token**: Short-lived JWT (~1 hour)
- **Auto-refresh**: Enabled on 401 responses
- **Token Verification**: Supabase JWT or custom JWT (legacy)

## Mobile Authentication

### iOS
- Plugin: tauri-plugin-web-auth (ASWebAuthenticationSession)
- Flow: Opens system browser, tokens in callback URL, stored in Tauri store
- Implementation: /src-tauri/src/lib.rs lines 30-35
- Build: .github/workflows/ios.yml

### Android
- Plugin: tauri-plugin-web-auth (Chrome Custom Tabs)
- Flow: Same as iOS (in-app tabs instead of system browser)
- Implementation: Same plugin configuration

## Environment Variables Required

VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
VITE_GOOGLE_IOS_CLIENT_ID=your_ios_client_id.apps.googleusercontent.com
VITE_GOOGLE_ANDROID_CLIENT_ID=your_android_client_id.apps.googleusercontent.com
VITE_GOOGLE_DESKTOP_CLIENT_ID=your_desktop_client_id.apps.googleusercontent.com
VITE_GOOGLE_DESKTOP_CLIENT_SECRET=your_desktop_client_secret

## Key Dependencies

### Frontend (package.json)
- @supabase/supabase-js: ^2.49.1
- tauri-plugin-web-auth-api: ^1.0.0
- @tauri-apps/api: ^2.8.0
- @tauri-apps/plugin-store: ^2.4.0

### Backend (Cargo.toml)
- axum: ^0.7
- tokio: ^1
- sqlx: ^0.8
- jsonwebtoken: ^9.2
- bcrypt: ^0.15

### Tauri (src-tauri/Cargo.toml)
- tauri: ^2
- tauri-plugin-web-auth: ^1.0
- tauri-plugin-machine-uid: ^0.1.2

## Trial System

- Default: 5 free messages
- Device Fingerprint: For tracking usage
- IP Limits: Max 3 trials per IP (lifetime)
- API: POST /api/trial/start

## Security Features

- **Password**: bcrypt hashing (cost 12)
- **HTTPS Only**: All API calls to Fly.io
- **PKCE**: OAuth flows use PKCE
- **Token Storage**: Encrypted by Tauri/browser
- **Device Fingerprint**: Trial abuse prevention
- **IP Limits**: Trial limit per IP address

## Recent Changes

- Commit 026479b: Refactored to use tauri-plugin-web-auth (removed old Google auth plugin)
- Commit 87d956f: Fixed tauri-plugin-web-auth implementation per official docs
- Commit 5440b7d: Fixed iOS workflow command syntax
- Status: Production-ready with unified mobile OAuth
