import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceIcon = path.join(__dirname, '../src-tauri/icons/1024x1024.png');
const iconsDir = path.join(__dirname, '../src-tauri/icons');

async function generateWindowsIco() {
  console.log('🪟 Generating Windows .ico file...');

  try {
    // Windows .ico should contain multiple sizes: 16, 32, 48, 256
    // Sharp doesn't support multi-size .ico, so we'll create a 256x256 version
    // For production, you should use ImageMagick or an online tool

    await sharp(sourceIcon)
      .resize(256, 256, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .toFormat('png')
      .toFile(path.join(iconsDir, 'icon.ico.png'));

    console.log('✓ Created icon.ico.png (256x256)');
    console.log('\n⚠️  Note: This is a PNG file, not a true .ico file.');
    console.log('   For a proper multi-size .ico file, use one of these methods:');
    console.log('   1. ImageMagick: convert icon.ico.png -define icon:auto-resize=256,128,96,64,48,32,16 icon.ico');
    console.log('   2. Online tool: https://icoconvert.com/ or https://convertio.co/png-ico/');
    console.log('   3. Windows tool: png2ico.exe');

  } catch (error) {
    console.error('✗ Failed to create icon.ico:', error.message);
  }
}

async function generateMacOSIcns() {
  console.log('\n🍎 Preparing for macOS .icns file...');

  try {
    // macOS .icns requires specific sizes and format
    // We need to create an .iconset folder with specific names
    const iconsetDir = path.join(iconsDir, 'icon.iconset');

    if (!fs.existsSync(iconsetDir)) {
      fs.mkdirSync(iconsetDir, { recursive: true });
    }

    const sizes = [
      { size: 16, name: 'icon_16x16.png' },
      { size: 32, name: 'icon_16x16@2x.png' },
      { size: 32, name: 'icon_32x32.png' },
      { size: 64, name: 'icon_32x32@2x.png' },
      { size: 128, name: 'icon_128x128.png' },
      { size: 256, name: 'icon_128x128@2x.png' },
      { size: 256, name: 'icon_256x256.png' },
      { size: 512, name: 'icon_256x256@2x.png' },
      { size: 512, name: 'icon_512x512.png' },
      { size: 1024, name: 'icon_512x512@2x.png' },
    ];

    for (const { size, name } of sizes) {
      await sharp(sourceIcon)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(path.join(iconsetDir, name));
      console.log(`✓ Created ${name} (${size}x${size})`);
    }

    console.log('\n✅ Iconset folder created successfully!');
    console.log('   Location:', iconsetDir);
    console.log('\n📝 To create the .icns file:');
    console.log('   On macOS, run: iconutil -c icns icon.iconset');
    console.log('   Or use online tool: https://cloudconvert.com/iconset-to-icns');
    console.log('   Or use png2icns: png2icns icon.icns icon.iconset');

  } catch (error) {
    console.error('✗ Failed to create iconset:', error.message);
  }
}

async function main() {
  console.log('🎨 Generating platform-specific icon formats...\n');

  if (!fs.existsSync(sourceIcon)) {
    console.error('❌ Source icon not found:', sourceIcon);
    process.exit(1);
  }

  await generateWindowsIco();
  await generateMacOSIcns();

  console.log('\n✅ Platform-specific icon preparation complete!');
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
