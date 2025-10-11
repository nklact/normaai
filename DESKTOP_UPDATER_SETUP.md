# Desktop Updater Setup Guide

This guide will help you complete the setup for automatic desktop app updates using Tauri's built-in updater.

## What We've Already Done

✅ Added Tauri updater plugin to Cargo.toml
✅ Installed @tauri-apps/plugin-updater npm package
✅ Updated tauri.conf.json with updater configuration
✅ Initialized updater plugin in Rust code (lib.rs)
✅ Added updater permissions to capabilities/default.json
✅ Created UpdateChecker React component
✅ Integrated UpdateChecker into App.jsx
✅ Created GitHub Actions workflow for releases

---

## What You Need to Do

### Step 1: Generate Signing Keys

The updater requires cryptographic keys to verify update authenticity.

**Run this command:**
```bash
npm run tauri signer generate -- -w norma-ai-updater.key
```

When prompted, enter a **strong password** (save it somewhere secure - you'll need it for GitHub secrets).

**Important:**
- DO NOT commit `norma-ai-updater.key` to git (it's your private key)
- You'll get two files:
  - `norma-ai-updater.key` - Private key (keep secret)
  - `norma-ai-updater.key.pub` - Public key (will go in tauri.conf.json)

---

### Step 2: Update tauri.conf.json with Public Key

After generating the keys, you need to add the public key to your Tauri configuration.

1. Open `norma-ai-updater.key.pub` and copy its contents
2. Open `src-tauri/tauri.conf.json`
3. Find this line:
   ```json
   "pubkey": "REPLACE_WITH_PUBLIC_KEY_AFTER_GENERATION",
   ```
4. Replace it with your actual public key:
   ```json
   "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFCQ0RFRkdISUoKRVdB...",
   ```

**Example of what it should look like:**
```json
{
  "plugins": {
    "updater": {
      "active": true,
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFCQ0RFRkdISUoKRVdBQUEAQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQQ==",
      "endpoints": [
        "https://github.com/nklact/normaai/releases/latest/download/latest.json"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

---

### Step 3: Add GitHub Secrets

You need to add 2 secrets to your private GitHub repository.

**Go to:** `https://github.com/nklact/normaai/settings/secrets/actions`

**Add these secrets:**

#### 1. `TAURI_SIGNING_PRIVATE_KEY`
- Open `norma-ai-updater.key` file
- Copy the **entire contents** of the file
- Paste it as the secret value

#### 2. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Enter the password you used when generating the keys
- Paste it as the secret value

**Security Note:** These secrets are encrypted by GitHub and only accessible during GitHub Actions workflows.

---

### Step 4: Add gitignore Entry

Add this to your `.gitignore` to prevent accidentally committing the private key:

```
# Tauri updater signing keys
norma-ai-updater.key
norma-ai-updater.key.pub
*.key
*.key.pub
```

---

## How to Release Updates

Once setup is complete, releasing updates is simple:

### 1. Update Version Number

Update the version in **both** files:
- `src-tauri/tauri.conf.json` → `"version": "0.3.3"`
- `package.json` → `"version": "0.3.3"`

### 2. Commit Changes

```bash
git add .
git commit -m "Bump version to 0.3.3"
```

### 3. Create and Push Tag

```bash
git tag v0.3.3
git push origin master
git push origin v0.3.3
```

### 4. Wait for Build

GitHub Actions will automatically:
1. Build for Windows, macOS, and Linux
2. Sign the installers with your private key
3. Create a GitHub Release (draft)
4. Upload all installers and `latest.json`
5. Publish the release

### 5. Monitor Progress

Go to: `https://github.com/nklact/normaai/actions`

The build takes approximately **15-20 minutes** for all platforms.

---

## How Users Get Updates

1. User opens the Norma AI desktop app
2. App automatically checks GitHub for updates in the background
3. If update available, a modal appears:
   - **"Nova verzija dostupna!"**
   - Shows version number and release notes
   - Buttons: "Ažuriraj sada" or "Kasnije"
4. If user clicks "Ažuriraj sada":
   - Download progress shown
   - App installs update
   - App restarts automatically
5. If user clicks "Kasnije":
   - Modal closes
   - Check repeats next time app opens

---

## Testing the Updater

### Before First Release

1. Complete Steps 1-4 above
2. Create your first release (tag `v0.3.3` for example)
3. Wait for GitHub Actions to complete
4. Download and install the app from GitHub Releases

### Testing Update Flow

1. Install version `v0.3.3` on your machine
2. Bump version to `v0.3.4` in both files
3. Create tag `v0.3.4` and push
4. Wait for build to complete
5. Open the installed `v0.3.3` app
6. Update modal should appear within 5 seconds
7. Click "Ažuriraj sada" and verify it works

---

## Troubleshooting

### "Failed to check for updates"
- Check that `latest.json` exists at: `https://github.com/nklact/normaai/releases/latest/download/latest.json`
- Verify the GitHub Release is published (not draft)

### "Signature verification failed"
- Public key in `tauri.conf.json` doesn't match private key
- Regenerate keys and update both config and GitHub secrets

### "GitHub Actions build failed"
- Check that GitHub secrets are set correctly
- Verify private key and password are correct
- Check Actions logs for specific errors

### Update modal doesn't appear
- Make sure you're running the Tauri desktop app (not web browser)
- Check browser console for errors (F12)
- Verify `latest.json` has higher version than installed app

---

## Important Files Reference

| File | Purpose |
|------|---------|
| `src-tauri/tauri.conf.json` | Contains public key and update endpoint |
| `src-tauri/capabilities/default.json` | Grants updater permissions |
| `src-tauri/src/lib.rs` | Initializes updater plugin |
| `src/components/UpdateChecker.jsx` | React component for update UI |
| `src/App.jsx` | Renders UpdateChecker component |
| `.github/workflows/desktop-release.yml` | Automates build and release |
| `norma-ai-updater.key` | Private signing key (DO NOT COMMIT) |
| `norma-ai-updater.key.pub` | Public verification key |

---

## Next Steps

After completing Steps 1-4 above:

1. Test the updater with a real release
2. Consider adding release notes to your git tags
3. Update the GitHub Release body with changelogs
4. Monitor update analytics (check GitHub Release download counts)

---

## Questions?

If you encounter any issues:
1. Check the Troubleshooting section above
2. Review Tauri updater docs: https://v2.tauri.app/plugin/updater/
3. Check GitHub Actions logs for build errors
