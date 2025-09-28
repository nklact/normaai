# TestFlight Setup - Free iPhone Testing

Complete step-by-step guide to test your app on iPhone for free using GitHub Actions + TestFlight.

## Step 1: Push Code to GitHub

```bash
git add .
git commit -m "Add iOS TestFlight workflow"
git push
```

## Step 2: Create Apple ID (Free)

1. Go to [appleid.apple.com](https://appleid.apple.com/)
2. Click "Create Your Apple ID"
3. Use your regular email (no payment required)
4. Verify your email

## Step 3: Create App-Specific Password

1. Sign in at [appleid.apple.com](https://appleid.apple.com/)
2. Go to "App-Specific Passwords"
3. Click "Generate an app-specific password"
4. Label it "GitHub Actions"
5. Copy the generated password (save it!)

## Step 4: Get Apple Team ID

1. Go to [developer.apple.com](https://developer.apple.com/account/)
2. Sign in with your Apple ID
3. You'll see "Team ID" on the account page
4. Copy this 10-character code

## Step 5: Create GitHub Secrets

1. Go to your GitHub repo: `https://github.com/nklact/normaai`
2. Click Settings → Secrets and variables → Actions
3. Click "New repository secret" and add these:

```
APPLE_ID: your@email.com
APPLE_PASSWORD: [the app-specific password from Step 3]
APPLE_TEAM_ID: [the 10-character team ID from Step 4]
```

## Step 6: Create Development Certificate

1. On your local machine, open Keychain Access
2. Go to Keychain Access → Certificate Assistant → Request a Certificate from a Certificate Authority
3. Enter your email and name, select "Save to disk"
4. Save the .certSigningRequest file

5. Go to [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates)
6. Click "+" to add certificate
7. Select "iOS Development"
8. Upload your .certSigningRequest file
9. Download the certificate (.cer file)

10. Double-click the .cer file to install in Keychain Access
11. In Keychain Access, find your certificate
12. Right-click → Export → Save as .p12 file with a password

## Step 7: Add Certificate to GitHub Secrets

```bash
# Convert certificate to base64
base64 -i your-certificate.p12 | pbcopy
```

Add to GitHub Secrets:
```
APPLE_CERTIFICATE: [paste the base64 string]
APPLE_CERTIFICATE_PASSWORD: [the password you used for .p12]
APPLE_SIGNING_IDENTITY: iPhone Developer: Your Name (XXXXXXXXXX)
```

## Step 8: Create App in App Store Connect

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com/)
2. Click "My Apps" → "+" → "New App"
3. Fill in:
   - Platform: iOS
   - Name: Norma AI
   - Primary Language: English
   - Bundle ID: com.nikola.norma-ai
   - SKU: norma-ai-1

## Step 9: Trigger Build

1. Push any change to your repo
2. Go to Actions tab in GitHub
3. Watch the "iOS Build & TestFlight" workflow run
4. If successful, app will be uploaded to TestFlight automatically

## Step 10: Install on iPhone

1. Download TestFlight app from App Store
2. Sign in with same Apple ID
3. Your app "Norma AI" will appear in TestFlight
4. Tap "Install" and test!

## Troubleshooting

### "No signing identity found"
- Make sure APPLE_SIGNING_IDENTITY exactly matches your certificate name
- Check certificate hasn't expired

### "Invalid bundle identifier"
- Ensure bundle ID in tauri.conf.json matches App Store Connect

### "Upload failed"
- Check APPLE_PASSWORD is the app-specific password, not your regular password
- Verify APPLE_ID and APPLE_TEAM_ID are correct

### Build fails
- Check GitHub Actions logs for specific errors
- Ensure all secrets are set correctly

## Success!

Once working, every time you push code:
1. GitHub automatically builds your iOS app
2. Uploads to TestFlight
3. You get notification to test new version
4. Install instantly on your iPhone

No Mac, no Xcode, no $99 fee - just push and test!