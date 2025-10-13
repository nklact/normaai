import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceIcon = path.join(__dirname, '../src-tauri/icons/1024x1024.png');
const iconsDir = path.join(__dirname, '../src-tauri/icons');
const iosDir = path.join(iconsDir, 'ios');
const publicDir = path.join(__dirname, '../public');

// Ensure directories exist
[iconsDir, iosDir, publicDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// 1. TAURI DESKTOP ICONS (for Windows, macOS, Linux)
const desktopIcons = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
  { name: '256x256.png', size: 256 },
  { name: '512x512.png', size: 512 },
];

// 2. iOS APP ICONS (all required by Apple)
const iosIcons = [
  // Notification icons
  { name: 'AppIcon-20x20@1x.png', size: 20 },
  { name: 'AppIcon-20x20@2x.png', size: 40 },
  { name: 'AppIcon-20x20@2x-1.png', size: 40 },
  { name: 'AppIcon-20x20@3x.png', size: 60 },

  // Settings icons
  { name: 'AppIcon-29x29@1x.png', size: 29 },
  { name: 'AppIcon-29x29@2x.png', size: 58 },
  { name: 'AppIcon-29x29@2x-1.png', size: 58 },
  { name: 'AppIcon-29x29@3x.png', size: 87 },

  // Spotlight icons
  { name: 'AppIcon-40x40@1x.png', size: 40 },
  { name: 'AppIcon-40x40@2x.png', size: 80 },
  { name: 'AppIcon-40x40@2x-1.png', size: 80 },
  { name: 'AppIcon-40x40@3x.png', size: 120 },

  // App icons
  { name: 'AppIcon-60x60@2x.png', size: 120 },
  { name: 'AppIcon-60x60@3x.png', size: 180 },

  // iPad icons
  { name: 'AppIcon-76x76@1x.png', size: 76 },
  { name: 'AppIcon-76x76@2x.png', size: 152 },
  { name: 'AppIcon-83.5x83.5@2x.png', size: 167 },

  // App Store icon
  { name: 'AppIcon-512@2x.png', size: 1024 },
];

// 3. WEB/PWA ICONS (for browser and Progressive Web App)
const webIcons = [
  { name: 'apple-touch-icon.png', size: 180, dir: publicDir }, // iOS Safari bookmark
  { name: 'icon-192.png', size: 192, dir: publicDir }, // PWA icon
  { name: 'icon-512.png', size: 512, dir: publicDir }, // PWA icon
  { name: 'favicon-16x16.png', size: 16, dir: publicDir }, // Browser tab
  { name: 'favicon-32x32.png', size: 32, dir: publicDir }, // Browser tab
];

// Android icons will be generated in the gen/android folder structure
const androidDensities = [
  { name: 'mdpi', size: 48 },
  { name: 'hdpi', size: 72 },
  { name: 'xhdpi', size: 96 },
  { name: 'xxhdpi', size: 144 },
  { name: 'xxxhdpi', size: 192 },
];

async function resizeIcon(inputPath, outputPath, size, options = {}) {
  try {
    const sharpInstance = sharp(inputPath).resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    });

    await sharpInstance.png().toFile(outputPath);

    console.log(`✓ Created ${path.basename(outputPath)} (${size}x${size})`);
  } catch (error) {
    console.error(`✗ Failed to create ${path.basename(outputPath)}:`, error.message);
  }
}

async function generateFavicon() {
  try {
    // Generate multi-size favicon.ico (contains 16x16, 32x32, 48x48)
    const sizes = [16, 32, 48];
    const buffers = [];

    for (const size of sizes) {
      const buffer = await sharp(sourceIcon)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();
      buffers.push(buffer);
    }

    // For now, just create a 32x32 favicon.ico (sharp doesn't support multi-size .ico)
    await sharp(sourceIcon)
      .resize(32, 32, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(path.join(publicDir, 'favicon.ico'));

    console.log('✓ Created favicon.ico (32x32)');
    console.log('  Note: For multi-size favicon.ico, use a tool like png2ico or ImageMagick');
  } catch (error) {
    console.error('✗ Failed to create favicon.ico:', error.message);
  }
}

async function generateAndroidIcons() {
  console.log('\n📱 Generating Android icons...');

  const androidResDir = path.join(__dirname, '../src-tauri/gen/android/app/src/main/res');

  // Check if Android project exists
  if (!fs.existsSync(androidResDir)) {
    console.log('⚠️  Android project not found at:', androidResDir);
    console.log('   Android icons will be skipped. Run "npm run tauri android init" first.');
    return;
  }

  for (const density of androidDensities) {
    const densityDir = path.join(androidResDir, `mipmap-${density.name}`);

    if (!fs.existsSync(densityDir)) {
      fs.mkdirSync(densityDir, { recursive: true });
    }

    // Generate 3 variants for each density
    await resizeIcon(
      sourceIcon,
      path.join(densityDir, 'ic_launcher.png'),
      density.size
    );

    await resizeIcon(
      sourceIcon,
      path.join(densityDir, 'ic_launcher_round.png'),
      density.size
    );

    await resizeIcon(
      sourceIcon,
      path.join(densityDir, 'ic_launcher_foreground.png'),
      density.size
    );
  }
}

async function generateAllIcons() {
  console.log('🎨 Generating ALL icons from 1024x1024.png...\n');

  // Check if source exists
  if (!fs.existsSync(sourceIcon)) {
    console.error('❌ Source icon not found:', sourceIcon);
    console.error('   Please ensure 1024x1024.png exists in src-tauri/icons/');
    process.exit(1);
  }

  // 1. Desktop icons
  console.log('🖥️  Generating Tauri Desktop icons...');
  for (const icon of desktopIcons) {
    await resizeIcon(sourceIcon, path.join(iconsDir, icon.name), icon.size);
  }

  // 2. iOS icons
  console.log('\n📱 Generating iOS icons...');
  for (const icon of iosIcons) {
    await resizeIcon(sourceIcon, path.join(iosDir, icon.name), icon.size);
  }

  // 3. Web/PWA icons
  console.log('\n🌐 Generating Web/PWA icons...');
  for (const icon of webIcons) {
    const outputDir = icon.dir || publicDir;
    await resizeIcon(sourceIcon, path.join(outputDir, icon.name), icon.size);
  }

  // 4. Favicon
  await generateFavicon();

  // 5. Android icons (if project exists)
  await generateAndroidIcons();

  console.log('\n✅ All icons generated successfully!');
  console.log('\n📋 Manual steps required:');
  console.log('   1. Generate icon.icns for macOS:');
  console.log('      - Use png2icns or iconutil');
  console.log('      - Command: png2icns icons/icon.icns icons/1024x1024.png');
  console.log('   2. Generate icon.ico for Windows:');
  console.log('      - Use ImageMagick or online tool');
  console.log('      - Should contain: 16x16, 32x32, 48x48, 256x256');
  console.log('   3. Update public/index.html to reference new favicon and PWA icons');
  console.log('\n📁 Generated icons:');
  console.log(`   - Desktop: ${desktopIcons.length} files in src-tauri/icons/`);
  console.log(`   - iOS: ${iosIcons.length} files in src-tauri/icons/ios/`);
  console.log(`   - Web/PWA: ${webIcons.length + 1} files in public/`);
  console.log(`   - Android: Check gen/android/app/src/main/res/mipmap-*/`);
}

generateAllIcons().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
