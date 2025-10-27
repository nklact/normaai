# Google Sign-In OAuth Fix - Final Implementation

## Problem Identified

The **Error 403: disallowed_useragent** on iOS was caused by a fundamental misunderstanding of how Supabase OAuth works in Tauri apps:

### ❌ What Was Wrong Before

1. **`skipBrowserRedirect: false`** - This does NOT work in Tauri apps. Even with this setting, Supabase opens OAuth in the Tauri webview, not the system browser.
2. **Redundant OAuth handlers** - Both `AuthCallback.jsx` component and `App.jsx` deep link handler were trying to do the same thing.
3. **Implicit flow handling** - Code was looking for `#access_token` in URL hash, but PKCE uses `?code` in query params.
4. **No routing** - `AuthCallback.jsx` component was never rendered because the app has no router.

### ✅ Correct Implementation

The proper way to handle OAuth in Tauri with Supabase:

1. **`skipBrowserRedirect: true`** - Prevents Supabase from opening the webview
2. **Manual browser opening** - Use `@tauri-apps/plugin-opener` to open external browser
3. **Deep link callback** - Handle `normaai://auth/callback?code=xxx` in the app
4. **PKCE code exchange** - Call `exchangeCodeForSession(code)` to get session

---

## Changes Made

### 1. Fixed `signInWithGoogle()` in `src/services/api.js:224-267`

**Key Changes:**
- Changed `skipBrowserRedirect: false` → `skipBrowserRedirect: true`
- Changed `redirectTo` to use custom scheme: `normaai://auth/callback`
- Added manual browser opening with `@tauri-apps/plugin-opener`

```javascript
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: 'normaai://auth/callback',  // Custom scheme for deep linking
    skipBrowserRedirect: true,               // CRITICAL: Must be true for Tauri
    // ... other options
  }
});

// Manually open external browser (not webview)
if (window.__TAURI__ && data.url) {
  const { open } = await import('@tauri-apps/plugin-opener');
  await open(data.url);  // Opens Safari/Chrome, not webview
}
```

### 2. Updated `handleDeepLink()` in `src/App.jsx:111-156`

**Key Changes:**
- Removed implicit flow (hash token) handling
- Added PKCE code exchange
- Added proper error handling

```javascript
const handleDeepLink = async (url) => {
  const urlObj = new URL(url);
  const code = new URLSearchParams(urlObj.search).get('code');  // PKCE code

  if (code) {
    // Exchange PKCE code for session
    const { data, error } = await apiService.supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Update auth state
      const status = await apiService.getUserStatus();
      setUserStatus(status);
      setIsAuthenticated(true);
      setAuthModalOpen(false);
    }
  }
};
```

### 3. Updated `initializeAuth()` in `src/App.jsx:158-182`

**Key Changes:**
- Added web OAuth callback handling (for browser)
- Handles PKCE code exchange on page load
- Clears code from URL after processing

```javascript
const initializeAuth = async () => {
  // Web only: Check for OAuth callback
  if (!window.__TAURI__) {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
      // Exchange PKCE code for session
      await apiService.supabase.auth.exchangeCodeForSession(code);
      // Clear code from URL
      window.history.replaceState(null, '', window.location.pathname);
    }
  }

  // ... rest of initialization
};
```

### 4. Exposed Supabase Client in `src/services/api.js:82-83`

```javascript
class ApiService {
  // Expose Supabase client for direct access
  supabase = supabase;
  // ...
}
```

### 5. Removed Redundant Files

- ❌ Deleted `src/components/AuthCallback.jsx` (unused, no router)
- ❌ Deleted `public/auth/redirect.html` (not needed)

### 6. Kept Rust Deep Link Handler in `src-tauri/src/lib.rs:210-251`

This is still correct and handles forwarding deep links to the webview.

---

## How It Works Now

### Desktop (Windows/Mac/Linux)

```
1. User clicks "Sign in with Google"
2. signInWithGoogle() gets OAuth URL from Supabase (skipBrowserRedirect: true)
3. @tauri-apps/plugin-opener opens DEFAULT BROWSER (Chrome/Edge/Safari)
4. User authenticates in EXTERNAL browser
5. Google redirects to: normaai://auth/callback?code=xxx
6. OS triggers deep link → Opens Norma AI app
7. Rust deep link handler forwards to webview
8. App.jsx handleDeepLink() catches URL
9. exchangeCodeForSession(code) gets session
10. ✅ User is logged in
```

### iOS

```
1. User clicks "Sign in with Google"
2. signInWithGoogle() gets OAuth URL from Supabase
3. @tauri-apps/plugin-opener opens SAFARI (external browser)
4. User authenticates in Safari
5. Google redirects to: normaai://auth/callback?code=xxx
6. iOS triggers deep link → Opens Norma AI app
7. Rust deep link handler forwards to webview
8. App.jsx handleDeepLink() catches URL
9. exchangeCodeForSession(code) gets session
10. ✅ User is logged in (NO 403 ERROR!)
```

### Android

```
Same as iOS, but uses Chrome instead of Safari
```

### Web (Browser)

```
1. User clicks "Sign in with Google"
2. signInWithGoogle() gets OAuth URL
3. Browser redirects to Google OAuth
4. User authenticates
5. Google redirects back to: https://yourdomain.com?code=xxx
6. Page reloads with code in URL
7. initializeAuth() detects code on page load
8. exchangeCodeForSession(code) gets session
9. Code is cleared from URL
10. ✅ User is logged in
```

---

## Why This Fixes the 403 Error

### Before (❌ Broken)
- OAuth opened in Tauri **webview** (WKWebView on iOS)
- Google detected webview user-agent
- Google blocked with **403: disallowed_useragent**

### After (✅ Fixed)
- OAuth opens in **external browser** (Safari on iOS)
- Google sees Safari user-agent
- Google allows authentication
- **No 403 error!**

---

## Configuration Requirements

### Google Cloud Console

**Authorized Redirect URIs:**
```
https://garjufwsbqhzaukprnbs.supabase.co/auth/v1/callback
normaai://auth/callback
```

**Authorized JavaScript Origins:**
```
https://garjufwsbqhzaukprnbs.supabase.co
```

### Supabase Dashboard

**Site URL:**
```
https://chat.normaai.rs
```

**Redirect URLs:**
```
normaai://auth/callback
https://chat.normaai.rs
https://chat.normaai.rs/**
```

### Tauri Configuration (Already Set)

`src-tauri/tauri.conf.json`:
```json
{
  "plugins": {
    "deep-link": {
      "desktop": {
        "schemes": ["normaai"]
      },
      "mobile": [
        {
          "scheme": ["https"],
          "host": "chat.normaai.rs",
          "pathPrefix": ["/auth/callback"],
          "appLink": true
        }
      ]
    }
  }
}
```

---

## Testing Instructions

### ⚠️ Important Notes

1. **Deep links only work in PRODUCTION builds**, not `npm run tauri dev`
2. **Build first**: `npm run tauri build`
3. **Install the app** from `src-tauri/target/release/bundle/`
4. **Then test** Google Sign-In

### Desktop Testing

```bash
# Build production app
npm run tauri build

# Install from:
# Windows: src-tauri/target/release/bundle/msi/
# Mac: src-tauri/target/release/bundle/dmg/
# Linux: src-tauri/target/release/bundle/appimage/

# Test:
# 1. Open installed app
# 2. Click "Sign in with Google"
# 3. External browser should open
# 4. After authentication, should redirect back to app
# 5. ✅ Should be logged in
```

### iOS Testing

```bash
# Build iOS app
npm run tauri ios build

# Install via Xcode or TestFlight
# Test same as desktop
# Safari should open for OAuth
# Should redirect back to app after authentication
```

### Web Testing

```bash
# Just test in browser
npm run dev

# Open localhost:5173
# Click "Sign in with Google"
# Should work normally in browser
```

---

## Debugging

### Check if external browser opens

**Expected:** Safari/Chrome opens
**If webview opens:** Check that `skipBrowserRedirect: true` and `@tauri-apps/plugin-opener` is being called

### Check deep link registration

**Windows:**
```powershell
# Check registry for normaai:// protocol
reg query HKEY_CURRENT_USER\Software\Classes\normaai
```

**Mac:**
```bash
# Check if app is registered for normaai://
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -dump | grep normaai
```

**iOS:**
```bash
# Test deep link
xcrun simctl openurl booted normaai://auth/callback?code=test
# Should open app
```

### Check console logs

Look for these logs:
```
🌐 Opening external browser for OAuth: https://...
🔗 Deep link received: normaai://auth/callback?code=...
🔐 PKCE authorization code detected, exchanging for session...
✅ PKCE session obtained successfully
✅ Authentication successful via PKCE deep link
```

---

## Summary of Files Changed

| File | Change |
|------|--------|
| `src/services/api.js` | Fixed `signInWithGoogle()` to use `skipBrowserRedirect: true` and manual browser opening |
| `src/App.jsx` | Updated `handleDeepLink()` for PKCE, updated `initializeAuth()` for web OAuth |
| `src/services/api.js` | Exposed `supabase` client as class property |
| `src/components/AuthCallback.jsx` | ❌ DELETED (redundant) |
| `public/auth/redirect.html` | ❌ DELETED (not needed) |
| `src-tauri/tauri.conf.json` | Version bump to 0.3.52 |

---

## Key Takeaways

1. **`skipBrowserRedirect: false` does NOT work in Tauri** - always use `true`
2. **Manual browser opening is required** - use `@tauri-apps/plugin-opener`
3. **PKCE uses query params** (`?code=xxx`), not hash (`#access_token=xxx`)
4. **Deep links only work in production builds**, not dev mode
5. **External browser avoids 403 error** - Google allows Safari/Chrome user-agent

---

## Testing Checklist

- [ ] Build production app: `npm run tauri build`
- [ ] Install app from bundle folder
- [ ] Click "Sign in with Google"
- [ ] **External browser opens** (not webview)
- [ ] Complete Google authentication
- [ ] **Browser redirects to app** (deep link works)
- [ ] **App shows user as logged in** (session created)
- [ ] **No 403 error on iOS**

If all checkboxes pass, the implementation is working correctly!
