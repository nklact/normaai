import { sha256 } from "js-sha256";

/**
 * Detects current platform for device fingerprinting
 * @returns {string} Platform identifier
 */
function detectPlatform() {
  // Check for Tauri desktop app
  if (typeof window !== "undefined" && window.__TAURI__) {
    return "desktop";
  }

  // All browsers (mobile and desktop) use the same browser fingerprinting
  return "desktop-browser";
}

/**
 * Generate device fingerprint for desktop Tauri app
 * Uses hardware UUID from Tauri APIs
 */
async function generateDesktopFingerprint() {
  try {
    // Check if we're in a Tauri context and not a web build
    if (
      typeof window !== "undefined" &&
      window.__TAURI__ &&
      typeof __TAURI_BUILD__ !== "undefined" &&
      __TAURI_BUILD__
    ) {
      // Dynamic import only in Tauri builds
      const { invoke } = await import("@tauri-apps/api/core");

      // Try to get Windows machine GUID or macOS hardware UUID
      const machineId = await invoke("get_machine_id").catch(() => {
        // Fallback to other system identifiers if machine ID fails
        return invoke("get_system_uuid").catch(() => "desktop-fallback");
      });

      return sha256(machineId);
    } else {
      // Not in Tauri context, use browser fingerprinting
      return await generateBrowserFingerprint();
    }
  } catch (error) {
    console.warn("Failed to get desktop hardware ID, using fallback");
    // Fallback to browser-based fingerprinting for desktop
    return await generateBrowserFingerprint();
  }
}

/**
 * Generate device fingerprint for mobile apps
 * Uses platform-specific identifiers (Android ID / iOS IDFV)
 */
async function generateMobileAppFingerprint() {
  try {
    // Mobile apps would use Capacitor or similar
    // For Android: Settings.Secure.ANDROID_ID
    // For iOS: identifierForVendor

    if (
      typeof window !== "undefined" &&
      window.Capacitor &&
      typeof __CAPACITOR_BUILD__ !== "undefined" &&
      __CAPACITOR_BUILD__
    ) {
      // Dynamic import only in Capacitor builds
      try {
        // Use dynamic import with a variable to prevent Vite from resolving it at build time
        const capacitorDeviceModule = "@capacitor" + "/device";
        const { Device } = await import(
          /* @vite-ignore */ capacitorDeviceModule
        );
        const info = await Device.getId();
        return sha256(info.uuid);
      } catch (error) {
        console.warn("Capacitor Device plugin not available:", error);
        // Fall back to browser fingerprinting
        return await generateBrowserFingerprint();
      }
    }

    // If not in mobile app context, fall back to browser fingerprinting
    return await generateBrowserFingerprint();
  } catch (error) {
    console.warn("Failed to get mobile device ID, using browser fallback");
    return await generateBrowserFingerprint();
  }
}

/**
 * Detect available fonts on the system
 * This provides high entropy for device uniqueness
 */
function detectAvailableFonts() {
  const testFonts = [
    "Arial",
    "Helvetica",
    "Times",
    "Times New Roman",
    "Courier",
    "Courier New",
    "Verdana",
    "Georgia",
    "Palatino",
    "Garamond",
    "Bookman",
    "Comic Sans MS",
    "Trebuchet MS",
    "Arial Black",
    "Impact",
    "Lucida Sans Unicode",
    "Tahoma",
    "Lucida Console",
    "Monaco",
    "Consolas",
    "Lucida Sans",
    "Geneva",
    "Arial Unicode MS",
    "Lucida Grande",
    "Gill Sans",
    "Segoe UI",
    "Roboto",
    "Ubuntu",
    "Cantarell",
    "Fira Sans",
    "Droid Sans",
    "Helvetica Neue",
    "San Francisco",
    "Avenir",
  ];

  const availableFonts = [];
  const testString = "mmmmmmmmmmlli";
  const testSize = "72px";
  const baseFonts = ["monospace", "sans-serif", "serif"];

  // Create a canvas for font measurement
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  // Measure baseline fonts
  const baseSizes = {};
  baseFonts.forEach((baseFont) => {
    context.font = testSize + " " + baseFont;
    baseSizes[baseFont] = context.measureText(testString).width;
  });

  // Test each font
  testFonts.forEach((font) => {
    let detected = false;
    baseFonts.forEach((baseFont) => {
      context.font = testSize + " " + font + ", " + baseFont;
      const matched =
        context.measureText(testString).width === baseSizes[baseFont];
      if (!matched) {
        detected = true;
      }
    });
    if (detected) {
      availableFonts.push(font);
    }
  });

  return availableFonts;
}

/**
 * Generate device fingerprint for desktop/mobile browsers
 * Uses localStorage + ETag storage for persistence
 */
async function generateBrowserFingerprint() {
  const components = [];

  // Device screen characteristics (same across all browsers)
  components.push(screen.width);
  components.push(screen.height);
  components.push(screen.colorDepth);
  components.push(screen.pixelDepth || screen.colorDepth);

  // Available screen size (excludes taskbars, same across browsers)
  components.push(screen.availWidth);
  components.push(screen.availHeight);

  // Device timezone (system-level, same across browsers)
  components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);

  // Platform/OS (system-level, same across browsers)
  components.push(navigator.platform);

  // Hardware characteristics (device-level, same across browsers)
  components.push(navigator.hardwareConcurrency || "unknown");
  components.push(navigator.deviceMemory || "unknown");
  components.push(navigator.maxTouchPoints || 0);

  // System language (typically same across browsers on same device)
  const systemLanguages = navigator.languages || [
    navigator.language || "unknown",
  ];
  components.push(systemLanguages.slice(0, 3).join(",")); // First 3 languages

  // User Agent characteristics (browser-specific but device-correlated)
  components.push(navigator.userAgent);
  components.push(navigator.vendor || "unknown");
  components.push(navigator.product || "unknown");

  // Performance and capabilities
  components.push(
    navigator.cookieEnabled ? "cookies-enabled" : "cookies-disabled"
  );
  components.push(navigator.onLine ? "online" : "offline");
  components.push(navigator.doNotTrack || "unknown");

  // Font detection (very effective for device uniqueness)
  const fonts = detectAvailableFonts();
  components.push(fonts.join(","));

  // Media devices fingerprinting
  try {
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const deviceTypes = devices.map((device) => device.kind).sort();
      components.push(deviceTypes.join(","));
    } else {
      components.push("media-devices-unavailable");
    }
  } catch (e) {
    components.push("media-devices-error");
  }

  // Battery API (if available, provides unique device characteristics)
  try {
    if ("getBattery" in navigator) {
      const battery = await navigator.getBattery();
      components.push(
        `battery-${Math.round(battery.level * 100)}-${battery.charging}`
      );
    } else {
      components.push("battery-unavailable");
    }
  } catch (e) {
    components.push("battery-error");
  }

  // Audio capabilities (device hardware, same across browsers)
  try {
    const audioContext = new (window.AudioContext ||
      window.webkitAudioContext)();
    components.push(audioContext.sampleRate.toString());
    components.push(audioContext.destination.maxChannelCount.toString());
    audioContext.close();
  } catch (e) {
    components.push("audio-unavailable");
  }

  // WebGL hardware info (GPU-level, should be same across browsers)
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (gl) {
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        const vendor =
          gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || "unknown";
        const renderer =
          gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "unknown";
        components.push(vendor);
        components.push(renderer);
      } else {
        components.push("webgl-no-debug");
      }

      // Additional WebGL parameters for better uniqueness
      components.push(gl.getParameter(gl.MAX_TEXTURE_SIZE) || "unknown");
      components.push(gl.getParameter(gl.MAX_VERTEX_ATTRIBS) || "unknown");
      components.push(gl.getParameter(gl.MAX_VIEWPORT_DIMS) || "unknown");
      components.push(
        gl.getParameter(gl.SHADING_LANGUAGE_VERSION) || "unknown"
      );
    } else {
      components.push("webgl-unavailable");
    }
  } catch (e) {
    components.push("webgl-error");
  }

  // Canvas fingerprinting (highly effective for device uniqueness)
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    // Set canvas size for consistent rendering
    canvas.width = 280;
    canvas.height = 60;

    // Draw complex shapes and text with various properties
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";

    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, 100, 0);
    gradient.addColorStop(0, "#f39c12");
    gradient.addColorStop(1, "#e74c3c");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 100, 30);

    // Colored rectangle with transparency
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.fillRect(125, 1, 62, 20);

    // Text with different colors and fonts
    ctx.fillStyle = "#069";
    ctx.fillText("Norma AI Device Check 🔒", 2, 15);
    ctx.fillStyle = "#f60";
    ctx.fillText("Canvas Test αβγδε", 4, 35);

    // Additional shapes for more entropy
    ctx.beginPath();
    ctx.arc(50, 50, 20, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
    ctx.fill();

    // Complex path with curves
    ctx.beginPath();
    ctx.moveTo(150, 10);
    ctx.quadraticCurveTo(170, 30, 190, 10);
    ctx.strokeStyle = "#8e44ad";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Get canvas data and hash it
    const canvasData = canvas.toDataURL();
    components.push(sha256(canvasData));
  } catch (e) {
    components.push("canvas-error");
  }

  // Combine all components
  const combinedString = components.join("|");

  // Generate SHA-256 hash
  return sha256(combinedString);
}

/**
 * Check if current user agent is a mobile browser
 * Used to redirect mobile browser users to app stores
 */
function isMobileBrowser() {
  const userAgent = navigator.userAgent.toLowerCase();
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
    userAgent
  );
}

/**
 * Main device fingerprint generation function
 * Routes to appropriate method based on platform
 */
async function generateDeviceFingerprint() {
  const platform = detectPlatform();

  switch (platform) {
    case "desktop":
      return await generateDesktopFingerprint();
    case "mobile-app":
      return await generateMobileAppFingerprint();
    case "desktop-browser":
    default:
      // Both desktop and mobile browsers use the same fingerprinting
      return await generateBrowserFingerprint();
  }
}

/**
 * Get or generate device fingerprint with appropriate persistence
 * - Desktop App: Direct hardware ID (no persistence needed)
 * - Mobile App: Direct device ID (no persistence needed)
 * - Browsers: localStorage + ETag storage for persistence
 */
export async function getDeviceFingerprint() {
  const platform = detectPlatform();


  const STORAGE_KEY = "norma_ai_device_fp";

  // Desktop and mobile apps get hardware IDs directly - no storage needed
  if (platform === "desktop" || platform === "mobile-app") {
    return await generateDeviceFingerprint();
  }

  // Browser-based fingerprinting with persistence
  const currentFingerprint = await generateDeviceFingerprint();

  try {
    // Try to get existing fingerprint from localStorage
    let storedFingerprint = localStorage.getItem(STORAGE_KEY);

    if (!storedFingerprint) {
      // Store the current fingerprint
      localStorage.setItem(STORAGE_KEY, currentFingerprint);

      // Also try to store in IndexedDB for better persistence
      storeInIndexedDB(STORAGE_KEY, currentFingerprint);

      return currentFingerprint;
    }

    // Verify stored fingerprint matches current device
    if (storedFingerprint === currentFingerprint) {
      return storedFingerprint;
    } else {
      // Device characteristics changed - could be legitimate or bypass attempt
      console.warn("Device fingerprint mismatch detected");

      // Update stored fingerprint to current one
      localStorage.setItem(STORAGE_KEY, currentFingerprint);
      storeInIndexedDB(STORAGE_KEY, currentFingerprint);

      return currentFingerprint;
    }
  } catch (e) {
    // Fallback if localStorage is not available
    console.warn(
      "localStorage not available, using device-generated fingerprint"
    );
    return currentFingerprint;
  }
}


/**
 * Store fingerprint in IndexedDB for better persistence across browsers
 * This is a backup storage method
 */
function storeInIndexedDB(key, value) {
  try {
    if (!window.indexedDB) return;

    const request = indexedDB.open("NormaAI_DeviceStorage", 1);

    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("fingerprints")) {
        db.createObjectStore("fingerprints");
      }
    };

    request.onsuccess = function (event) {
      const db = event.target.result;
      const transaction = db.transaction(["fingerprints"], "readwrite");
      const store = transaction.objectStore("fingerprints");
      store.put(value, key);
    };

    request.onerror = function () {
      console.warn("IndexedDB storage failed");
    };
  } catch (e) {
    console.warn("IndexedDB not available");
  }
}

/**
 * Clear stored device fingerprint (useful for testing)
 * Only applies to browser-based fingerprints
 */
export function clearDeviceFingerprint() {
  const STORAGE_KEY = "norma_ai_device_fp";
  const platform = detectPlatform();

  // Only clear for browser-based platforms
  if (platform === "desktop-browser") {
    try {
      localStorage.removeItem(STORAGE_KEY);

      // Also clear from IndexedDB
      try {
        const request = indexedDB.open("NormaAI_DeviceStorage", 1);
        request.onsuccess = function (event) {
          const db = event.target.result;
          if (db.objectStoreNames.contains("fingerprints")) {
            const transaction = db.transaction(["fingerprints"], "readwrite");
            const store = transaction.objectStore("fingerprints");
            store.delete(STORAGE_KEY);
          }
        };
      } catch (e) {
        console.warn("Could not clear device fingerprint from IndexedDB");
      }
    } catch (e) {
      console.warn("Could not clear device fingerprint from localStorage");
    }
  }
}

/**
 * Validate device fingerprint format
 */
export function isValidFingerprint(fingerprint) {
  return (
    typeof fingerprint === "string" &&
    fingerprint.length === 64 &&
    /^[a-f0-9]+$/.test(fingerprint)
  );
}

/**
 * Get platform info for debugging
 */
export function getPlatformInfo() {
  const platform = detectPlatform();
  const isMobile = isMobileBrowser();

  return {
    platform,
    isMobile,
    hasTauri: typeof window !== "undefined" && !!window.__TAURI__,
    hasCapacitor: typeof window !== "undefined" && !!window.Capacitor,
    userAgent: navigator.userAgent,
  };
}
