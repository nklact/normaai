# Supabase Authentication Setup Guide

This guide explains how to set up Supabase Authentication for Norma AI with Google OAuth login.

## Prerequisites

- A Supabase project (create one at [supabase.com](https://supabase.com))
- Database already connected (you should already have this)

## 1. Database Migration

Run the database migration to add Supabase auth support:

```sql
-- Run this in your Supabase SQL Editor
-- File: backend/migrations/001_supabase_auth_integration.sql
```

The migration will:
- Add `auth_user_id` column to link users to Supabase auth
- Make `password_hash` nullable (for social login users)
- Create triggers to auto-create/link users on Supabase signup
- Handle trial inheritance when users register
- Handle email linking for existing accounts

## 2. Configure Environment Variables

### Backend (.env)

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_JWT_SECRET=your-jwt-secret-here
```

**Where to find these:**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **Project Settings** → **API**
4. Copy **Project URL** → This is your `SUPABASE_URL`
5. Copy **JWT Secret** (NOT anon/service_role key!) → This is your `SUPABASE_JWT_SECRET`

### Frontend (.env)

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

**Where to find these:**
1. Same location as above (Project Settings → API)
2. Copy **Project URL** → This is your `VITE_SUPABASE_URL`
3. Copy **anon public** key → This is your `VITE_SUPABASE_ANON_KEY`

## 3. Configure Google OAuth

### Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. **No API needs to be enabled** (Google+ API is deprecated)
4. Configure **OAuth consent screen** (if not already done):
   - User Type: **External**
   - App name: **Norma AI**
   - User support email: Your email
   - Developer contact: Your email
   - Scopes: Leave default (email, profile, openid)
   - Save
5. Go to **Credentials** → Click **Create Credentials** → **OAuth client ID**
6. Configure:
   - **Application type**: Web application
   - **Name**: Norma AI Web
   - **Authorized JavaScript origins**:
     - `https://garjufwsbqhzaukprnbs.supabase.co`
     - `https://normaai.rs`
     - `http://localhost:5173` (for dev)
   - **Authorized redirect URIs**:
     - `https://garjufwsbqhzaukprnbs.supabase.co/auth/v1/callback`
     - `https://chat.normaai.rs/auth/callback`
     - `http://localhost:5173/auth/callback`
7. Click **Create**
8. Copy **Client ID** and **Client Secret**

### Supabase Dashboard Setup

1. Go to: https://supabase.com/dashboard/project/garjufwsbqhzaukprnbs/auth/providers
2. Find **Google** in the providers list
3. Toggle it **ON**
4. Paste:
   - **Client ID** (from Google)
   - **Client Secret** (from Google)
5. Click **Save**

✅ Done! Google login is now configured.

## 4. Configure Email Templates (Optional)

Supabase automatically sends emails for:
- Email verification (when users register)
- Password reset

To customize these:
1. Go to **Authentication** → **Email Templates**
2. Customize the templates with your branding
3. Update **Sender email** and **Sender name**

## 5. Configure Redirect URLs

In Supabase Dashboard:
1. Go to **Authentication** → **URL Configuration**
2. Add your **Site URL**: `https://normaai.rs`
3. Add **Redirect URLs**:
   - `https://normaai.rs`
   - `https://normaai.rs/auth/callback`
   - `http://localhost:5173` (for dev)
   - `http://localhost:5173/auth/callback` (for dev)

## 6. Install Dependencies

```bash
# Frontend
npm install

# Backend
cargo build
```

## 7. Run Migrations

The migration file is at: `backend/migrations/001_supabase_auth_integration.sql`

Run it in Supabase SQL Editor or via your migration tool.

## 8. Test the Integration

1. Start the backend: `cd backend && cargo run`
2. Start the frontend: `npm run dev`
3. Open http://localhost:5173
4. Try:
   - Register with email/password
   - Login with Google
   - Login with Facebook
   - Login with Apple

## How It Works

### Authentication Flow

1. **Trial Users** (not logged in):
   - Use device fingerprint (unchanged from before)
   - Get 5 free messages
   - No Supabase auth involved

2. **Email/Password Registration**:
   - User fills form → Supabase creates auth.users entry
   - Database trigger creates public.users entry
   - Inherits trial messages if device fingerprint exists
   - Email verification sent automatically by Supabase

3. **Social Login** (Google/Facebook/Apple):
   - User clicks social button → Redirects to provider
   - User authorizes → Provider redirects back with code
   - Supabase exchanges code for session
   - Database trigger creates/links public.users entry
   - Email automatically verified (providers verify emails)

4. **Email Linking**:
   - If user has existing email/password account
   - Then tries to login with social (same email)
   - Database trigger links accounts (updates auth_user_id)
   - User can now use both methods to login

### Database Schema

- **auth.users** (Supabase managed):
  - Stores authentication credentials
  - Handles password hashing, email verification
  - Manages OAuth tokens

- **public.users** (Your app):
  - Linked via `auth_user_id`
  - Stores app-specific data (trials, subscriptions, etc.)
  - Auto-created by trigger when someone signs up

### Token Verification

The backend now supports both:
- **Supabase JWT tokens** (for new auth)
- **Custom JWT tokens** (legacy, optional)

When a request comes in with Authorization header:
1. Try to verify as Supabase JWT
2. If that fails, try custom JWT (for backwards compatibility)
3. Look up user in database

## Troubleshooting

### "Invalid JWT" errors
- Make sure you're using **JWT Secret**, not anon key in backend env
- Check that SUPABASE_URL matches exactly (with https://)

### Social login redirects to wrong URL
- Check **Redirect URLs** in Supabase dashboard
- Make sure provider redirect URI matches Supabase callback URL

### User not created after signup
- Check database trigger is installed: `\df handle_new_supabase_user`
- Check Supabase logs: Dashboard → Database → Logs

### Email not sent
- Check **Email Templates** are enabled in Supabase
- Verify sender email in Supabase settings
- Check spam folder

## Migration from Old System

If you had users with the old email/password system:
- They can continue logging in with email/password
- They can link their Google/Facebook/Apple account in settings (future feature)
- New users will use Supabase auth by default

## Security Notes

- ✅ Supabase handles password hashing (bcrypt)
- ✅ JWT tokens auto-refresh before expiry
- ✅ Email verification automatic
- ✅ Rate limiting on auth endpoints (Supabase default)
- ✅ SQL injection protection (parameterized queries)
- ✅ CORS configured correctly
- ⚠️ Make sure to use HTTPS in production
- ⚠️ Never commit .env files to git

## Desktop and Mobile App Setup

For desktop (Windows/Mac/Linux) and mobile (iOS/Android) apps, additional configuration is required to handle OAuth redirects properly using Universal Links and deep linking.

📖 **See [DEEP_LINKS_SETUP.md](./DEEP_LINKS_SETUP.md) for complete instructions on:**
- Setting up Universal Links (iOS)
- Setting up App Links (Android)
- Configuring deep links for desktop apps
- Hosting `.well-known` files
- Testing OAuth flow on all platforms

## Support

For issues:
1. Check Supabase logs: Dashboard → Auth → Logs
2. Check backend logs for JWT verification errors
3. Check browser console for frontend errors

For Supabase-specific issues:
- [Supabase Docs](https://supabase.com/docs/guides/auth)
- [Supabase Discord](https://discord.supabase.com/)
