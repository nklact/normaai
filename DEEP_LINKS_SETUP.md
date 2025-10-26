# Deep Links Setup for Multi-Platform OAuth

This guide explains how to set up Universal Links (iOS), App Links (Android), and custom URL schemes (Desktop) for Google OAuth across all platforms.

## Overview

The app now uses **Universal Links** for OAuth authentication, which works seamlessly across:
- ✅ Web (direct redirect)
- ✅ Desktop (Windows/Mac/Linux via custom scheme + Universal Link)
- ✅ Mobile (iOS/Android via Universal Links/App Links)

When a user completes Google OAuth, they're redirected to `https://chat.normaai.rs/auth/callback`, and:
- **Web**: Normal redirect, session stored in browser
- **Desktop**: OS opens the app via custom `normaai://` scheme (fallback) or web link
- **Mobile**: OS intercepts the HTTPS URL and opens your app instead of browser

## Step 1: Host `.well-known` Files

These files tell iOS and Android that your app can handle links from `chat.normaai.rs`.

### iOS - Universal Links

1. **Get your Apple Team ID:**
   - Go to https://developer.apple.com/account
   - Your Team ID is shown in the top right (format: `AB12CD34EF`)

2. **Update `public/.well-known/apple-app-site-association`:**
   ```bash
   # Replace $APPLE_TEAM_ID with your actual Team ID
   sed -i 's/\$APPLE_TEAM_ID/AB12CD34EF/g' public/.well-known/apple-app-site-association
   ```

   Or manually edit the file and replace `$APPLE_TEAM_ID` with your Team ID.

3. **Verify the file looks like this:**
   ```json
   {
     "applinks": {
       "apps": [],
       "details": [
         {
           "appID": "AB12CD34EF.com.nikola.norma-ai",
           "paths": ["/auth/callback"]
         }
       ]
     }
   }
   ```

### Android - App Links

1. **Get your release certificate SHA256 fingerprint:**

   **If you have a keystore:**
   ```bash
   keytool -list -v -keystore path/to/your-release-key.keystore -alias your-key-alias
   ```

   **If building with Tauri (auto-generated):**
   ```bash
   # After building an Android APK
   keytool -printcert -jarfile target/release/bundle/android/app-release.apk
   ```

   Look for `SHA256:` line, copy the fingerprint (format: `AA:BB:CC:DD:...`)

2. **Update `public/.well-known/assetlinks.json`:**
   ```json
   [
     {
       "relation": ["delegate_permission/common.handle_all_urls"],
       "target": {
         "namespace": "android_app",
         "package_name": "com.nikola.norma_ai",
         "sha256_cert_fingerprints": [
           "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99"
         ]
       }
     }
   ]
   ```

### Hosting the Files

These files must be accessible at:
- `https://chat.normaai.rs/.well-known/apple-app-site-association`
- `https://chat.normaai.rs/.well-known/assetlinks.json`

**Important:**
- ✅ Must be served over HTTPS
- ✅ No file extension for `apple-app-site-association`
- ✅ Content-Type should be `application/json`
- ✅ Must be at root domain (not subdomain like www)

**How to host:**

If you're using a static site host (Vercel, Netlify, etc.), these files in `public/.well-known/` will automatically be served.

If using a custom server, configure it to serve these files:

**Nginx example:**
```nginx
location /.well-known/ {
    root /var/www/normaai/public;
    default_type application/json;
}
```

**Verify hosting:**
```bash
curl https://chat.normaai.rs/.well-known/apple-app-site-association
curl https://chat.normaai.rs/.well-known/assetlinks.json
```

## Step 2: Update Google OAuth Configuration

1. Go to: https://console.cloud.google.com/apis/credentials
2. Click on your OAuth 2.0 Client ID
3. Add these **Authorized redirect URIs**:

   ```
   https://garjufwsbqhzaukprnbs.supabase.co/auth/v1/callback
   https://chat.normaai.rs/auth/callback
   http://localhost:5173/auth/callback
   ```

4. Add these **Authorized JavaScript origins**:

   ```
   https://garjufwsbqhzaukprnbs.supabase.co
   https://chat.normaai.rs
   http://localhost:5173
   ```

5. Click **Save**

## Step 3: Update Supabase Configuration

1. Go to: https://supabase.com/dashboard/project/garjufwsbqhzaukprnbs/auth/url-configuration

2. Set **Site URL** to:
   ```
   https://chat.normaai.rs
   ```

3. Add these **Redirect URLs**:
   ```
   https://chat.normaai.rs/**
   https://chat.normaai.rs/auth/callback
   http://localhost:5173/**
   http://localhost:5173/auth/callback
   ```

4. Click **Save**

## Step 4: Testing

### Web (Easiest)
1. Open `https://chat.normaai.rs` in browser
2. Click "Sign in with Google"
3. Complete OAuth
4. Should redirect back to chat and be logged in

### Desktop (Requires production build)
1. Build the app: `npm run tauri build`
2. Install the built app from `src-tauri/target/release/bundle/`
3. Open the installed app
4. Click "Sign in with Google"
5. Browser opens for OAuth
6. After completing OAuth, you should be redirected back to the desktop app

**Note**: Deep links don't work in dev mode (`npm run tauri dev`) - must use production build!

### iOS (Requires Apple Developer account)
1. Build for iOS: `npm run tauri ios build`
2. Install on device or simulator
3. Open the app
4. Click "Sign in with Google"
5. Browser opens for OAuth
6. After completing, should return to app

**Verify Universal Links work:**
```bash
# On iOS device/simulator
xcrun simctl openurl booted https://chat.normaai.rs/auth/callback
# Should open your app, not Safari
```

### Android (Requires keystore)
1. Build for Android: `npm run tauri android build`
2. Install APK on device
3. Open the app
4. Click "Sign in with Google"
5. Browser opens for OAuth
6. After completing, should return to app

**Verify App Links work:**
```bash
# On Android device
adb shell am start -a android.intent.action.VIEW -d "https://chat.normaai.rs/auth/callback" com.nikola.norma_ai
# Should open your app, not browser
```

## Troubleshooting

### iOS - Universal Links not working
- ✅ Verify `apple-app-site-association` is accessible via HTTPS
- ✅ Check Apple Team ID is correct
- ✅ Make sure app is installed from production build (not dev mode)
- ✅ Try deleting and reinstalling the app
- ✅ Check iOS Settings → Safari → Advanced → Experimental Features → Universal Links enabled

### Android - App Links not working
- ✅ Verify `assetlinks.json` is accessible via HTTPS
- ✅ Check SHA256 fingerprint matches your release keystore
- ✅ Package name must be exactly `com.nikola.norma_ai` (with underscores)
- ✅ Try: `adb shell pm verify-app-links --re-verify com.nikola.norma_ai`

### Desktop - Deep links not working
- ✅ Must use production build (`npm run tauri build`), not dev mode
- ✅ On Windows, check if custom scheme `normaai://` is registered in registry
- ✅ On macOS, check `/Applications/Norma AI.app` is registered for the scheme
- ✅ On Linux, check `.desktop` file is installed

### OAuth redirect showing 404
- ✅ Make sure all redirect URIs are added to Google OAuth configuration
- ✅ Verify Supabase Site URL and Redirect URLs are configured
- ✅ Check that `https://chat.normaai.rs/auth/callback` returns your app (not 404)

## How It Works

1. User clicks "Sign in with Google"
2. App opens browser with Google OAuth URL
3. User completes OAuth on Google
4. Google redirects to: `https://chat.normaai.rs/auth/callback#access_token=...`
5. **On Web**: Normal redirect, Supabase JS client stores tokens
6. **On Desktop**: Browser tries to open the URL, OS sees it matches `normaai://` scheme registration, opens your app
7. **On Mobile**: OS intercepts the HTTPS URL (via Universal/App Links), opens your app instead of browser
8. App extracts tokens from URL hash, authenticates user

## Security Notes

- ✅ All OAuth happens in real browser (not webview) - more secure
- ✅ Tokens never exposed to external servers (only Supabase)
- ✅ Universal/App Links verified by OS (prevents spoofing)
- ✅ HTTPS required for all production URLs
- ✅ Custom schemes on desktop are less secure (anyone can register), but fine for OAuth callback

## Support

For issues with:
- **Universal Links**: https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app
- **App Links**: https://developer.android.com/training/app-links
- **Tauri Deep Links**: https://v2.tauri.app/plugin/deep-linking/
- **Supabase Auth**: https://supabase.com/docs/guides/auth
