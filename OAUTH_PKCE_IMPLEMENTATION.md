# Google Sign-In PKCE Implementation

## Summary

This document explains the changes made to fix Google Sign-In across all platforms (Web, Desktop Windows/Mac/Linux, iOS, Android) by implementing PKCE (Proof Key for Code Exchange) flow and ensuring OAuth happens in the system browser instead of embedded webviews.

## Problem Fixed

**iOS 403 Error:** Google blocks OAuth in embedded webviews (WKWebView) with `Error 403: disallowed_useragent`. This has been the standard since April 2017.

**Root Cause:** The previous implementation tried to open OAuth in Tauri's webview context, triggering Google's security restrictions.

**Solution:** Use PKCE flow with system browser (Safari/Chrome) for OAuth, then return to app via deep links/universal links.

---

## Changes Made

### 1. Updated Supabase Client Configuration (src/services/api.js)

**Added PKCE Flow:**
```javascript
{
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce', // NEW: Use PKCE flow (more secure)
    storage: isDesktop ? createTauriStorage() : undefined // NEW: Custom storage
  }
}
```

**Added Custom Tauri Storage Adapter:**
- Created `createTauriStorage()` function to persist PKCE code verifier
- Uses `@tauri-apps/plugin-store` to store auth data in `auth.json`
- Required for PKCE to work across browser and app transitions

### 2. Fixed Google Sign-In Method (src/services/api.js)

**Key Changes:**
```javascript
skipBrowserRedirect: false  // CHANGED from: window.__TAURI__
```

**What This Does:**
- Allows Supabase to automatically open the **system browser** (Safari/Chrome)
- Removes manual `@tauri-apps/plugin-opener` call (no longer needed)
- System browser avoids Google's webview restrictions

**Flow:**
1. User clicks "Sign in with Google"
2. System browser opens with Google OAuth
3. User authenticates
4. Google redirects to `https://chat.normaai.rs/auth/callback?code=xxx`
5. Platform-specific handling:
   - **Mobile:** Universal/App Links intercept → opens app
   - **Desktop:** Redirect page triggers `normaai://` deep link → opens app
   - **Web:** Normal redirect in browser
6. AuthCallback component exchanges code for session

### 3. Added Deep Link Handler (src-tauri/src/lib.rs)

**New Code in `setup()` function:**
- Registers deep links for all platforms
- Listens for `normaai://auth/callback` (desktop)
- Listens for `https://chat.normaai.rs/auth/callback` (mobile via Universal/App Links)
- Forwards URLs to webview to trigger AuthCallback component

**Platform-Specific Behavior:**
- **Desktop:** `normaai://auth/callback?code=xxx` → converted to `https://chat.normaai.rs/auth/callback?code=xxx`
- **Mobile:** `https://chat.normaai.rs/auth/callback?code=xxx` → OS intercepts and opens app
- **Web:** Direct navigation, no deep link needed

### 4. Updated AuthCallback Component (src/components/AuthCallback.jsx)

**Added PKCE Support:**
- Checks for `?code=xxx` in URL (PKCE flow)
- Calls `supabase.auth.exchangeCodeForSession(code)` to exchange code for session
- Falls back to implicit flow (`#access_token=xxx`) for legacy/web compatibility

**Security:**
- Code verifier is stored in Tauri store (desktop) or localStorage (web)
- Code is single-use and short-lived (expires in ~10 minutes)
- Only works on same device/browser where flow was initiated

### 5. Created Desktop Redirect Page (public/auth/redirect.html)

**Purpose:**
- Handles OAuth redirect on desktop when opened in browser
- Automatically triggers deep link `normaai://auth/callback?code=xxx`
- Provides fallback manual link if automatic redirect fails

**How It Works:**
1. Google redirects to `https://chat.normaai.rs/auth/callback?code=xxx`
2. Browser loads this redirect page
3. Page triggers deep link via iframe + navigation
4. OS opens Norma AI desktop app
5. App handles the deep link

---

## Platform-Specific Flows

### Web (Browser)
```
1. User clicks "Sign in with Google"
2. Supabase redirects to Google OAuth
3. User authenticates
4. Google redirects to https://chat.normaai.rs/auth/callback?code=xxx
5. Browser loads AuthCallback component
6. Component exchanges code for session using PKCE
7. User is logged in ✅
```

### Desktop (Windows/Mac/Linux)
```
1. User clicks "Sign in with Google"
2. Default browser (Chrome/Edge/Safari) opens with Google OAuth
3. User authenticates
4. Google redirects to https://chat.normaai.rs/auth/callback?code=xxx
5. Browser loads redirect.html
6. redirect.html triggers deep link: normaai://auth/callback?code=xxx
7. OS opens Norma AI desktop app
8. Tauri deep link handler forwards URL to webview
9. AuthCallback component exchanges code for session using PKCE
10. User is logged in ✅
```

### iOS
```
1. User clicks "Sign in with Google"
2. Safari opens with Google OAuth
3. User authenticates
4. Google redirects to https://chat.normaai.rs/auth/callback?code=xxx
5. iOS intercepts URL (Universal Links) and opens Norma AI app
6. Tauri deep link handler forwards URL to webview
7. AuthCallback component exchanges code for session using PKCE
8. User is logged in ✅
```

### Android
```
1. User clicks "Sign in with Google"
2. Chrome opens with Google OAuth
3. User authenticates
4. Google redirects to https://chat.normaai.rs/auth/callback?code=xxx
5. Android intercepts URL (App Links) and opens Norma AI app
6. Tauri deep link handler forwards URL to webview
7. AuthCallback component exchanges code for session using PKCE
8. User is logged in ✅
```

---

## Configuration Checklist

### ✅ Supabase Dashboard
- **Site URL:** `https://chat.normaai.rs`
- **Redirect URLs:**
  - `https://chat.normaai.rs/**`
  - `https://chat.normaai.rs/auth/callback`
  - `http://localhost:5173/**`
  - `http://localhost:5173/auth/callback`

### ✅ Google Cloud Console
- **Authorized JavaScript Origins:**
  - `https://garjufwsbqhzaukprnbs.supabase.co`
  - `https://chat.normaai.rs`
  - `http://localhost:5173`

- **Authorized Redirect URIs:**
  - `https://garjufwsbqhzaukprnbs.supabase.co/auth/v1/callback`
  - `https://chat.normaai.rs/auth/callback`
  - `http://localhost:5173/auth/callback`

### ✅ Universal Links / App Links
- **iOS:** `https://chat.normaai.rs/.well-known/apple-app-site-association`
  - Apple Team ID: `AL3V38N8H9`
  - App ID: `AL3V38N8H9.com.nikola.norma-ai`
  - Path: `/auth/callback`

- **Android:** `https://chat.normaai.rs/.well-known/assetlinks.json`
  - Package: `com.nikola.norma_ai`
  - SHA256: `F9:1E:19:B5:05:10:C2:B6:87:0B:D3:0C:4E:BD:5E:AF:91:E0:F3:70:7B:31:37:E9:42:F2:BB:0F:64:43:EA:C2`

### ✅ Tauri Configuration (src-tauri/tauri.conf.json)
- Deep link schemes configured:
  - Desktop: `normaai://`
  - Mobile: `https://chat.normaai.rs/auth/callback`

---

## Testing Instructions

### Development (Web)
```bash
npm run dev
```
- Open http://localhost:5173
- Click "Sign in with Google"
- Should complete OAuth in browser
- **Expected:** Login works ✅

### Production (Desktop)
```bash
npm run tauri build
```
- Install app from `src-tauri/target/release/bundle/`
- Open installed app
- Click "Sign in with Google"
- Browser should open for OAuth
- After authentication, should return to app

**Important:** Deep links only work in production builds, not `npm run tauri dev`!

### Production (iOS)
```bash
npm run tauri ios build
```
- Install on device or TestFlight
- Open app
- Click "Sign in with Google"
- Safari should open for OAuth
- After authentication, should return to app via Universal Links

**Verify Universal Links:**
```bash
xcrun simctl openurl booted https://chat.normaai.rs/auth/callback?code=test
```
Should open app, not Safari.

### Production (Android)
```bash
npm run tauri android build
```
- Install APK on device
- Open app
- Click "Sign in with Google"
- Chrome should open for OAuth
- After authentication, should return to app via App Links

**Verify App Links:**
```bash
adb shell am start -a android.intent.action.VIEW -d "https://chat.normaai.rs/auth/callback?code=test" com.nikola.norma_ai
```
Should open app, not browser.

---

## Security Benefits

✅ **No Tokens in URL:** Only short-lived codes passed via redirect (not access tokens)
✅ **Code Verifier Validation:** Prevents authorization code interception attacks
✅ **System Browser Security:** Leverages browser's security features and credential management
✅ **Industry Standard:** Recommended by Google, Apple, OAuth 2.1 spec
✅ **Single-Use Codes:** Authorization codes expire after first use
✅ **Device Binding:** Code verifier stored locally, must exchange on same device

---

## Troubleshooting

### iOS: 403 Error Still Occurs
**Cause:** OAuth still opening in webview instead of Safari
**Fix:** Ensure `skipBrowserRedirect: false` in `signInWithGoogle()`

### Desktop: Deep Link Doesn't Work
**Cause:** Testing in dev mode instead of production build
**Fix:** Build and install production app: `npm run tauri build`

### Mobile: Universal Links Don't Work
**iOS Fix:**
- Verify `.well-known/apple-app-site-association` is accessible via HTTPS
- Check Apple Team ID matches
- Reinstall app after hosting file
- Check iOS Settings → Safari → Advanced → Universal Links is enabled

**Android Fix:**
- Verify `.well-known/assetlinks.json` is accessible via HTTPS
- Check SHA256 fingerprint matches release keystore
- Run: `adb shell pm verify-app-links --re-verify com.nikola.norma_ai`

### Code Exchange Fails
**Error:** "Code expired" or "Invalid code"
**Cause:** Code can only be used once and expires in ~10 minutes
**Fix:** Complete OAuth flow quickly, don't refresh callback page

---

## Files Changed

| File | Change Summary |
|------|----------------|
| `src/services/api.js` | Added PKCE config, custom storage, fixed `signInWithGoogle()` |
| `src-tauri/src/lib.rs` | Added deep link handler in `setup()` function |
| `src/components/AuthCallback.jsx` | Added PKCE code exchange support |
| `public/auth/redirect.html` | NEW: Desktop deep link trigger page |

---

## Next Steps

### Required for Production:
1. ✅ Deploy `.well-known` files to `https://chat.normaai.rs`
2. ✅ Verify Google OAuth redirect URIs in Google Cloud Console
3. ✅ Verify Supabase redirect URLs in Supabase Dashboard
4. Build and test on all platforms before release

### Optional Enhancements:
- Add error handling UI for failed OAuth attempts
- Add loading state during OAuth redirect
- Implement "Continue in app" banner on web for mobile users
- Add analytics to track OAuth success/failure rates

---

## References

- [Google OAuth 2.0 for Native Apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Supabase PKCE Flow Documentation](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Tauri Deep Linking Guide](https://v2.tauri.app/plugin/deep-linking/)
- [Apple Universal Links](https://developer.apple.com/ios/universal-links/)
- [Android App Links](https://developer.android.com/training/app-links)

---

## Support

If you encounter issues:
1. Check console logs for error messages
2. Verify all configuration checklist items
3. Test on web first (simplest flow)
4. Then test desktop, then mobile

For platform-specific issues:
- **iOS:** Check Web Inspector (enabled in app)
- **Android:** Use `adb logcat`
- **Desktop:** Check terminal output from Tauri
