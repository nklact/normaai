# Icon Generation Guide

This guide explains how to generate all required icons for Norma AI across all platforms.

## Quick Start

1. Place your master icon as `src-tauri/icons/1024x1024.png` (1024x1024px, PNG format)
2. Run: `npm run generate-icons`
3. Generate platform-specific formats (see below)

## Generated Icons

The `npm run generate-icons` command generates:

### ✅ Tauri Desktop (5 files)
- `32x32.png` - Windows taskbar, Linux
- `128x128.png` - macOS, Linux
- `128x128@2x.png` - macOS Retina (256x256)
- `256x256.png` - macOS, Linux
- `512x512.png` - macOS, Linux

### ✅ iOS App (18 files in `ios/` folder)
All required icon sizes for iOS devices:
- Notification icons (20pt in @1x, @2x, @3x)
- Settings icons (29pt in @1x, @2x, @3x)
- Spotlight icons (40pt in @1x, @2x, @3x)
- App icons (60pt in @2x, @3x)
- iPad icons (76pt in @1x, @2x)
- iPad Pro icon (83.5pt @2x)
- App Store icon (1024x1024)

### ✅ Android App (15 files in `gen/android/app/src/main/res/mipmap-*/`)
Three variants (launcher, round, foreground) for each density:
- `mdpi` (48x48)
- `hdpi` (72x72)
- `xhdpi` (96x96)
- `xxhdpi` (144x144)
- `xxxhdpi` (192x192)

### ✅ Web/PWA (6 files in `public/`)
- `favicon-16x16.png` - Browser tab (16x16)
- `favicon-32x32.png` - Browser tab (32x32)
- `favicon.ico` - Browser fallback (32x32)
- `apple-touch-icon.png` - iOS Safari bookmark (180x180)
- `icon-192.png` - PWA icon (192x192)
- `icon-512.png` - PWA splash screen (512x512)

## Platform-Specific Formats

### Windows `.ico` File

Run: `npm run generate-ico-icns`

This creates `icon.ico.png` which needs to be converted to a multi-size `.ico` file.

**Option 1: Online Converter (Easiest)**
1. Go to https://icoconvert.com/ or https://convertio.co/png-ico/
2. Upload `src-tauri/icons/icon.ico.png`
3. Select sizes: 16x16, 32x32, 48x48, 256x256
4. Download as `icon.ico`
5. Place in `src-tauri/icons/icon.ico`

**Option 2: ImageMagick**
```bash
convert icon.ico.png -define icon:auto-resize=256,128,96,64,48,32,16 icon.ico
```

### macOS `.icns` File

Run: `npm run generate-ico-icns`

This creates `icon.iconset` folder with all required sizes.

**Option 1: macOS iconutil (on Mac)**
```bash
cd src-tauri/icons
iconutil -c icns icon.iconset
```

**Option 2: Online Converter**
1. Zip the `icon.iconset` folder
2. Go to https://cloudconvert.com/iconset-to-icns
3. Upload the zip file
4. Download as `icon.icns`
5. Place in `src-tauri/icons/icon.icns`

**Option 3: png2icns**
```bash
npm install -g png2icns
png2icns icon.icns icon.iconset
```

## Verification

After generating all icons, verify in `tauri.conf.json`:

```json
{
  "bundle": {
    "icon": [
      "icons/favicon.svg",
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/256x256.png",
      "icons/512x512.png",
      "icons/1024x1024.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

## PWA Configuration

The `public/manifest.json` file is pre-configured for PWA:

```json
{
  "name": "Norma AI - Pravni Asistent",
  "short_name": "Norma AI",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

## SVG Favicon

If you have an SVG version of your logo, place it at `public/favicon.svg` for modern browsers.

## Troubleshooting

### Icons not showing in Tauri app
- Run `npm run tauri build` to rebuild the app bundle
- Clear cache: `rm -rf src-tauri/target`

### Android icons not generated
- Ensure Android project exists: `npm run tauri android init`
- Icons will be in `gen/android/app/src/main/res/mipmap-*/`

### PWA icons not working
- Verify `public/manifest.json` exists
- Check `index.html` has `<link rel="manifest" href="/manifest.json">`
- Test with Lighthouse PWA audit

## Scripts

- `npm run generate-icons` - Generate all PNG icons (desktop, iOS, Android, web)
- `npm run generate-ico-icns` - Prepare .ico and .icns files (requires manual conversion)

## Icon Requirements Summary

| Platform | Total Files | Location |
|----------|-------------|----------|
| Desktop | 7 PNG + 2 bundled | `src-tauri/icons/` |
| iOS | 18 PNG | `src-tauri/icons/ios/` |
| Android | 15 PNG | `gen/android/.../mipmap-*/` |
| Web/PWA | 6 files | `public/` |
| **Total** | **48 files** | - |

## Notes

- Source icon should be 1024x1024px PNG with transparent background
- All icons are generated with transparent backgrounds
- Web icons support both light and dark themes
- iOS and Android icons are automatically used by Tauri when building mobile apps
