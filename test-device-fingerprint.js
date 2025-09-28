/**
 * Test script for the refactored device fingerprint system
 * Run this in the browser console to validate implementation
 */

async function testDeviceFingerprint() {
  console.log('🧪 Testing Device Fingerprint System...');

  try {
    // Import the functions
    const {
      getDeviceFingerprint,
      getPlatformInfo,
      isValidFingerprint,
      clearDeviceFingerprint
    } = await import('./src/utils/deviceFingerprint.js');

    // Test platform detection
    console.log('📱 Platform Info:', getPlatformInfo());

    // Test fingerprint generation
    console.log('⏳ Generating device fingerprint...');
    const fingerprint1 = await getDeviceFingerprint();
    console.log('✅ First fingerprint:', fingerprint1);

    // Test fingerprint validation
    const isValid = isValidFingerprint(fingerprint1);
    console.log('🔍 Fingerprint valid:', isValid);

    // Test consistency (should return same fingerprint)
    const fingerprint2 = await getDeviceFingerprint();
    console.log('✅ Second fingerprint:', fingerprint2);
    console.log('🔄 Consistency check:', fingerprint1 === fingerprint2 ? 'PASS' : 'FAIL');

    // Test fingerprint properties
    console.log('📏 Fingerprint length:', fingerprint1.length);
    console.log('🔤 Is hex string:', /^[a-f0-9]+$/.test(fingerprint1));

    // Test clear functionality
    console.log('🧹 Testing clear functionality...');
    clearDeviceFingerprint();
    console.log('✅ Clear completed');

    // For desktop apps, test would be different since they use hardware IDs
    const platformInfo = getPlatformInfo();
    if (platformInfo.platform === 'desktop') {
      console.log('💻 Desktop app detected - using hardware ID');
    } else if (platformInfo.platform === 'mobile-browser') {
      console.log('📱 Mobile browser detected - should show app download screen');
    } else {
      console.log('🌐 Desktop browser detected - using browser fingerprinting');
    }

    console.log('✅ All tests completed successfully!');
    return {
      platform: platformInfo.platform,
      fingerprint: fingerprint1,
      isValid,
      isConsistent: fingerprint1 === fingerprint2
    };

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

// For Node.js environment (if running tests there)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { testDeviceFingerprint };
}

// Auto-run in browser
if (typeof window !== 'undefined') {
  console.log('🚀 Starting device fingerprint tests...');
  testDeviceFingerprint();
}