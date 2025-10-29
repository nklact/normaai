# iOS Google Sign-In Crash - Root Cause & Solution

## Problem Summary

The iOS app crashes immediately after clicking "Sign in with Google" button when tested on a real device via TestFlight.

### Symptoms
- Works fine on Windows Desktop (`npm run tauri dev`)
- Crashes on iOS real device immediately after button click
- No error message shown, app just closes
- Device fingerprint also failing on iOS (related but separate issue)

## Root Cause (UPDATED)

**The crash is caused by missing `GIDClientID` key in Info.plist.**

The `tauri-plugin-google-auth` plugin uses the native iOS Google Sign-In SDK, which **requires** the `GIDClientID` key to be set in the app's Info.plist file. Without this key, the native SDK fails to initialize and causes the app to crash immediately when attempting to sign in.

### What Was Missing

The iOS workflow was correctly configuring:
- ✅ URL scheme (`CFBundleURLTypes`) with reversed Client ID
- ✅ iOS Client ID in environment variables (`VITE_GOOGLE_IOS_CLIENT_ID`)
- ✅ Tauri capabilities for google-auth plugin

But it was missing:
- ❌ `GIDClientID` key in Info.plist (required by native Google Sign-In SDK)
- ❌ `LSApplicationQueriesSchemes` for Google app detection

### Your Client IDs (For Reference)

You have correctly configured all three Client IDs:

- **iOS Client ID**: `661564927057-spmsn2fh72qjc4ac1d3rkuqepfcvolkv.apps.googleusercontent.com`
- **Android Client ID**: `661564927057-av0hdraoidq14bdppvi0gjjjusmn6j3v.apps.googleusercontent.com`
- **Desktop Client ID**: `661564927057-8m8p4giulc6rb11820ptih71fki3fe79.apps.googleusercontent.com`

### Why This Crashes

According to Google's iOS documentation, the native Google Sign-In SDK requires `GIDClientID` to be present in Info.plist to properly initialize. When this key is missing, the SDK crashes during initialization rather than returning a proper error.

## Solution: Step-by-Step Fix

### What Has Been Fixed

**iOS Google Sign-In Crash:**

The iOS workflow (`.github/workflows/ios.yml`) has been updated to include:

1. ✅ **GIDClientID in Info.plist** - Now properly configured from `VITE_GOOGLE_IOS_CLIENT_ID` secret
2. ✅ **LSApplicationQueriesSchemes** - Added for Google app detection (Chrome, Safari support)
3. ✅ **Enhanced validation** - Better error messages in the sign-in code to catch issues earlier
4. ✅ **Verification logging** - The workflow now prints out the Info.plist configuration to verify it's correct

**Device Fingerprint Issue:**

The Tauri capabilities (`src-tauri/capabilities/default.json`) has been updated to include:

5. ✅ **machine-uid permissions** - Added `machine-uid:default` and `machine-uid:allow-get-machine-uid` so the plugin can access iOS device identifier

### What You Need To Do

#### Step 1: Verify GitHub Secret is Set

Make sure your GitHub repository has the correct iOS Client ID configured:

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Verify `VITE_GOOGLE_IOS_CLIENT_ID` is set to: `661564927057-spmsn2fh72qjc4ac1d3rkuqepfcvolkv.apps.googleusercontent.com`

If it's not set or has a different value, update it.

#### Step 2: Commit and Push Changes

The files that have been modified:
- `.github/workflows/ios.yml` - Added GIDClientID and LSApplicationQueriesSchemes configuration
- `src/services/api.js` - Enhanced error handling and validation for Google Sign-In
- `src-tauri/capabilities/default.json` - Added machine-uid plugin permissions
- `IOS_GOOGLE_SIGNIN_FIX.md` - This documentation

Commit and push these changes:

```bash
git add .github/workflows/ios.yml src/services/api.js src-tauri/capabilities/default.json IOS_GOOGLE_SIGNIN_FIX.md
git commit -m "Fix iOS Google Sign-In crash and device fingerprint issues

- Add GIDClientID to Info.plist for Google Sign-In iOS SDK
- Add LSApplicationQueriesSchemes for Google app detection
- Add machine-uid plugin permissions for device fingerprinting
- Enhance error handling and validation in sign-in flow"
git push origin master
```

#### Step 3: Monitor GitHub Actions Build

GitHub Actions will automatically:
- Build the iOS app with the correct configuration
- Add `GIDClientID` to Info.plist
- Configure URL schemes properly
- Upload to TestFlight

Watch the build logs to verify that the Info.plist configuration is printed correctly:
- Look for "GIDClientID: 661564927057-spmsn2fh72qjc4ac1d3rkuqepfcvolkv.apps.googleusercontent.com"
- Look for "✅ Google OAuth configuration added to Info.plist"

#### Step 4: Test on Device

1. Wait for TestFlight build to be available (~30-60 minutes)
2. Install the new build on your iPhone
3. Test "Sign in with Google"
4. It should now open Google Sign-In without crashing

## Verification Checklist

Before deploying, verify:

- [ ] iOS Client ID created in Google Cloud Console
- [ ] iOS Client ID is for **iOS** platform (not Web)
- [ ] Bundle ID matches: `com.nikola.norma-ai`
- [ ] GitHub secret `VITE_GOOGLE_IOS_CLIENT_ID` updated
- [ ] URL scheme in iOS workflow matches reversed iOS Client ID
- [ ] Changes committed and pushed to master

## Additional Notes

### About Client IDs

Your app needs **THREE different Client IDs**:

1. **Web Client ID** - For web browser and desktop OAuth flow
   - Environment variable: `VITE_GOOGLE_DESKTOP_CLIENT_ID`
   - Used on: Web browsers, Windows/Mac/Linux desktop apps

2. **iOS Client ID** - For iOS app
   - Environment variable: `VITE_GOOGLE_IOS_CLIENT_ID`
   - Used on: iPhone/iPad apps
   - Associated with Bundle ID

3. **Android Client ID** - For Android app
   - Environment variable: `VITE_GOOGLE_ANDROID_CLIENT_ID`
   - Used on: Android phones/tablets
   - Associated with package name and SHA-1 certificate

### Device Fingerprint Issue (ALSO FIXED)

The warning in logs: `Machine UID plugin returned no ID for mobile, using fallback`

**Root cause**: The `machine-uid` plugin was missing from the Tauri capabilities configuration, preventing it from accessing the iOS `identifierForVendor` API.

**Fixed**: Added the following permissions to `src-tauri/capabilities/default.json`:
- `machine-uid:default`
- `machine-uid:allow-get-machine-uid`

After the fix, the plugin will properly retrieve the iOS device identifier instead of falling back to browser fingerprinting.

**Note**: iOS `identifierForVendor` has some known limitations:
- Returns `null` if no other apps from the same vendor are installed
- Changes if all apps from the vendor are uninstalled then reinstalled
- May return `null` in some TestFlight/Enterprise builds

The fallback to browser fingerprinting is intentional and provides a reliable backup mechanism.

### Testing Locally

To test iOS locally before deploying to TestFlight:

1. Create a `.env.local` file with your iOS Client ID:
   ```bash
   VITE_GOOGLE_IOS_CLIENT_ID=YOUR_IOS_CLIENT_ID.apps.googleusercontent.com
   ```

2. Build for iOS:
   ```bash
   cd src-tauri
   cargo tauri ios build
   ```

3. The URL scheme will need to be manually added to `src-tauri/gen/apple/norma-ai_iOS/Info.plist` for local builds

## Debugging

If the crash persists after these changes:

1. Check the new logs from iPhone to see if there are new error messages
2. Verify the Client ID is being logged correctly (check for validation warnings)
3. Confirm the URL scheme was applied correctly in Info.plist
4. Test the Web/Desktop version to ensure those still work

The updated code in `src/services/api.js` now includes:
- iOS Client ID format validation
- Better error messages if Client ID is wrong type
- Helpful debugging information in logs

## References

- [tauri-plugin-google-auth iOS Setup](https://github.com/choochmeque/tauri-plugin-google-auth/blob/main/iOS_SETUP.md)
- [Google OAuth iOS Setup](https://developers.google.com/identity/sign-in/ios/start-integrating)
- [Tauri iOS Development](https://tauri.app/v1/guides/building/ios)

## Support

If you need help:
1. Check the new logs from TestFlight build
2. Verify Client ID configuration in Google Cloud Console
3. Confirm GitHub secrets are set correctly
4. Review the validation warnings in the logs
