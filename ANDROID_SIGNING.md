# Android APK Signing Configuration

## Overview
This project is configured for automatic APK signing during release builds. The configuration ensures that APKs are properly signed and ready for distribution.

## Files Created

### 1. Production Keystore
- **File**: `norma-ai-production.keystore`
- **Location**: Root directory (same level as package.json)
- **Purpose**: Contains the cryptographic keys for signing APKs
- **Validity**: 10,000 days (until 2053)

### 2. Signing Configuration
- **File**: `src-tauri/gen/android/app/signing.properties`
- **Purpose**: Contains keystore credentials
- **Security**: Added to .gitignore - never commit this file

### 3. Build Configuration
- **File**: `src-tauri/gen/android/app/build.gradle.kts`
- **Changes**: Added automatic signing configuration for release builds

## How It Works

When you run `npx tauri android build`, the system will:

1. Read signing credentials from `signing.properties`
2. Automatically sign the release APK using the production keystore
3. Generate a signed APK ready for installation/distribution

## Security Notes

⚠️ **IMPORTANT SECURITY CONSIDERATIONS**

1. **Keystore Protection**:
   - Keep `norma-ai-production.keystore` secure
   - Never share the keystore file publicly
   - Make secure backups of the keystore

2. **Password Security**:
   - Current password: `#NormaAI123$rs`
   - Store this password securely (password manager recommended)
   - Never commit `signing.properties` to version control

3. **Version Control**:
   - `*.keystore` files are in .gitignore
   - `signing.properties` is in .gitignore
   - These files will not be committed to Git

## For Team Development

If working with a team:

1. **Keystore Distribution**: Securely share the keystore file with team members
2. **Credentials**: Share the signing.properties file securely (encrypted communication)
3. **Setup**: Each developer needs both files in the correct locations

## Troubleshooting

### APK Installation Issues
- Ensure the APK is signed (check file size - signed APKs are larger)
- Verify keystore credentials in signing.properties
- Check that keystore file exists at the specified path

### Build Failures
- Verify signing.properties exists and contains correct credentials
- Check keystore file path in signing.properties
- Ensure Android build tools are properly installed

## Manual Signing (Backup Method)

If automatic signing fails, you can manually sign APKs:

```bash
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA256 -keystore norma-ai-production.keystore -storepass "#NormaAI123$rs" path/to/unsigned.apk norma-ai-prod
```

## Keystore Details

- **Algorithm**: RSA 2048-bit
- **Signature**: SHA256withRSA
- **Alias**: norma-ai-prod
- **Organization**: Norma AI
- **Location**: Belgrade, Serbia
- **Validity**: Until February 13, 2053