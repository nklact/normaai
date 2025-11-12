/**
 * Minimal Keyboard Debug Utility for Mobile Safari
 * Logs essential keyboard events for USB debugging via MacOS Safari
 */

export function initKeyboardDebug() {
  // Only run on mobile devices
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (!isMobile) {
    console.log('🔍 Keyboard Debug: Not a mobile device, skipping');
    return;
  }

  console.log('🔍 Keyboard Debug: Enabled');
  console.log('🔍 User Agent:', navigator.userAgent);

  let keyboardIsOpen = false;

  // Log when input is focused (keyboard opening)
  document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      console.log('🔍 ===== INPUT FOCUSED - KEYBOARD OPENING =====');
      console.log('🔍 Element:', e.target.className || e.target.tagName);

      setTimeout(() => {
        const vh = window.visualViewport?.height || window.innerHeight;
        const wh = window.innerHeight;
        const keyboardHeight = wh - vh;

        console.log('🔍 Keyboard opened:');
        console.log(`   - Window height: ${wh}px`);
        console.log(`   - Visual viewport height: ${vh}px`);
        console.log(`   - Keyboard height: ${keyboardHeight}px`);
        console.log(`   - window.scrollY: ${window.scrollY}`);

        keyboardIsOpen = true;
      }, 300);
    }
  }, true);

  // Log when input is blurred (keyboard closing)
  document.addEventListener('focusout', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      console.log('🔍 ===== INPUT BLURRED - KEYBOARD CLOSING =====');
      console.log('🔍 Keyboard was open:', keyboardIsOpen);

      setTimeout(() => {
        console.log('🔍 After keyboard close:');
        console.log(`   - window.scrollY: ${window.scrollY} ${window.scrollY === 0 ? '✅' : '🔴'}`);
        console.log(`   - visualViewport.offsetTop: ${window.visualViewport?.offsetTop || 'N/A'} ${window.visualViewport?.offsetTop === 0 ? '✅' : '🔴'}`);

        keyboardIsOpen = false;
      }, 500);
    }
  }, true);

  // Monitor viewport resize (keyboard open/close detection)
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const vh = window.visualViewport.height;
      const wh = window.innerHeight;
      const keyboardHeight = wh - vh;
      const isKeyboardOpen = keyboardHeight > 100;

      console.log('🔍 ===== VIEWPORT RESIZE =====');
      console.log(`🔍 Keyboard ${isKeyboardOpen ? '🟢 OPEN' : '🔴 CLOSED'} (${keyboardHeight}px difference)`);
      console.log(`   - Visual viewport: ${vh}px`);
      console.log(`   - Window height: ${wh}px`);
    });
  }

  console.log('🔍 Keyboard Debug: Monitoring active');
}
