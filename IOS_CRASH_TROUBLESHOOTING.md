# iOS Google Sign-In Crash - Additional Troubleshooting

## Current Status

Despite applying the following fixes:
- ✅ Added `GIDClientID` to Info.plist
- ✅ Added `LSApplicationQueriesSchemes` for Google app detection
- ✅ Added machine-uid plugin permissions
- ✅ Enhanced error handling and logging

**The app is still crashing when clicking the Google Sign-In button.**

## Critical Questions to Answer

### 1. Are you testing the correct build?

**Check the app version:**
- Look at the app version displayed in the iOS app
- It should show **0.4.5** if it includes our fixes
- If it shows 0.4.4 or earlier, you're testing an old build

### 2. Was the iOS build successful with the new configuration?

**Check GitHub Actions logs for the 0.4.5 build:**
1. Go to: https://github.com/YOUR_USERNAME/norma-ai/actions
2. Find the workflow run for commit `f63cecb` (Bump version to 0.4.5)
3. Check the "Configure Google OAuth URL Scheme in Info.plist" step
4. Look for these verification lines:
   ```
   GIDClientID:
   661564927057-spmsn2fh72qjc4ac1d3rkuqepfcvolkv.apps.googleusercontent.com

   CFBundleURLTypes:
   ...
   ```

If the verification shows the GIDClientID is present, the build is correct.

### 3. What are the actual iOS crash logs?

Since the app just closes with no JavaScript errors, we need native iOS crash logs:

**Get iOS crash logs:**
1. Open Xcode on your Mac
2. Go to **Window** → **Devices and Simulators**
3. Select your iPhone
4. Click **View Device Logs**
5. Find the crash report for "Norma AI" with the timestamp matching when you tested
6. Share the crash report - it will show the actual native stack trace

**Alternative method (from iPhone):**
1. Settings → Privacy & Security → Analytics & Improvements → Analytics Data
2. Find "Norma AI" crash reports
3. Share/AirDrop the crash report

## Most Likely Causes

Based on the symptoms (immediate crash with no logs), here are the most likely causes:

### Cause 1: Plugin Not Linked Properly (Most Likely)

The `tauri-plugin-google-auth` Rust library might not be properly linked in the iOS build.

**Solution:** Verify the plugin is in the Cargo.lock and properly built:

```bash
cd src-tauri
grep "tauri-plugin-google-auth" Cargo.lock
```

You should see entries for `tauri-plugin-google-auth` with version 0.3.x.

### Cause 2: Missing iOS Framework Dependencies

The Google Sign-In iOS SDK requires certain iOS frameworks to be linked.

**Check if these are included:**
- `AuthenticationServices.framework`
- `LocalAuthentication.framework`
- `SafariServices.framework`

### Cause 3: Info.plist Configuration Not Applied

Even though we added the configuration to the workflow, it might not have been applied during the build.

**Manual verification needed:**
After the iOS build completes, check:
```bash
cd src-tauri/gen/apple
/usr/libexec/PlistBuddy -c "Print :GIDClientID" norma-ai_iOS/Info.plist
```

This should print: `661564927057-spmsn2fh72qjc4ac1d3rkuqepfcvolkv.apps.googleusercontent.com`

### Cause 4: Plugin Initialization Crash

The plugin might be crashing during initialization in `lib.rs` before JavaScript even runs.

**Test:** Comment out the google-auth plugin temporarily and see if the app stops crashing:

```rust
// In src-tauri/src/lib.rs, comment this line:
// .plugin(tauri_plugin_google_auth::init())
```

If the crash stops, the problem is with the plugin initialization.

### Cause 5: Capabilities Permission Issue

Even though we added permissions, Tauri v2 might have specific capability requirements for iOS.

**Verify:** Check if a separate iOS capabilities file is needed:
```bash
# Check if this file exists:
ls src-tauri/capabilities/mobile.json
```

## Diagnostic Steps

### Step 1: Add More Defensive Logging

We've added logging to:
- `AuthModal.jsx` - logs when button is clicked
- `api.js` - logs before importing the plugin

**Next test:** Build version 0.4.6 with these new logs and check if you see:
- `🚀 handleGoogleLogin() called - button was clicked`
- `🚀 About to call apiService.signInWithGoogle()`
- `🚀 signInWithGoogle() called`

If you don't see ANY of these logs, the crash is happening in the native layer before JavaScript runs.

### Step 2: Test Without Google Sign-In

Temporarily comment out the Google Sign-In button entirely and verify the app works fine. This confirms the crash is specifically related to the Google Sign-In flow.

### Step 3: Try Simpler Plugin Configuration

Create a minimal test to see if the plugin can be imported at all:

Add this to your app's main component:
```javascript
useEffect(() => {
  const testPlugin = async () => {
    try {
      console.log('Testing plugin import...');
      const plugin = await import('@choochmeque/tauri-plugin-google-auth-api');
      console.log('Plugin imported successfully:', Object.keys(plugin));
    } catch (error) {
      console.error('Plugin import failed:', error);
    }
  };

  if (window.__TAURI__) {
    testPlugin();
  }
}, []);
```

## Alternative Solutions

If the plugin continues to crash, consider these alternatives:

### Option 1: Use Web OAuth Flow on Mobile

Instead of the native iOS SDK, use the standard web-based OAuth flow:

```javascript
if (isTauriApp && isIOS) {
  // Use web OAuth flow instead of native
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: 'https://chat.normaai.rs/auth/callback',
    }
  });
}
```

**Pros:**
- More reliable, uses standard browser flow
- No native SDK dependencies
- Works the same as desktop

**Cons:**
- Less smooth UX (opens Safari)
- Requires proper deep linking setup

### Option 2: Use Different OAuth Plugin

Try `tauri-plugin-oauth` instead, which might have better iOS support:

```bash
cargo add tauri-plugin-oauth
```

### Option 3: Implement Custom OAuth Flow

Use Tauri's `opener` plugin to handle OAuth manually:
1. Open Google OAuth URL in browser
2. Handle the callback with deep linking
3. Exchange code for tokens

## Next Steps

1. **Verify the build version** you're testing is 0.4.5
2. **Get the iOS crash logs** from Xcode or iPhone Settings
3. **Check GitHub Actions** logs to verify Info.plist was configured
4. **Test with the new logging** in version 0.4.6
5. **Share the crash report** so we can see the native stack trace

Once we have the crash logs, we'll know exactly what's failing and can provide a targeted fix.

## Files Modified for Additional Logging

- `src/components/AuthModal.jsx` - Added logging at button click
- `src/services/api.js` - Added logging before plugin import

Commit these changes as version 0.4.6 and test again to see which logs appear before the crash.
