// Dynamic import of Tauri API - only available in desktop builds
import { createClient } from "@supabase/supabase-js";

// Platform Detection
const isTauriApp = Boolean(window.__TAURI__);
const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const isDesktop = isTauriApp && !isMobileDevice;

// API Strategy: For web-first architecture, ALL platforms use HTTP API
// Tauri commands should only be used for platform-specific features (file system, native dialogs, etc.)
// Data operations should always use the centralized backend API
const USE_HTTP_API = true; // Always use HTTP for data operations (web-first architecture)

// Base URL for API calls
const API_BASE_URL = "https://norma-ai.fly.dev"; // Always use Fly.io backend

// Custom storage adapter for Tauri (PKCE requires persistent storage)
function createTauriStorage() {
  let storePromise = null;

  const getStore = async () => {
    if (!storePromise) {
      const { Store } = await import("@tauri-apps/plugin-store");
      storePromise = Store.load("auth.json");
    }
    return storePromise;
  };

  return {
    async getItem(key) {
      try {
        const store = await getStore();
        const value = await store.get(key);
        return value ?? null;
      } catch (error) {
        console.error("Error getting item from Tauri store:", error);
        return null;
      }
    },
    async setItem(key, value) {
      try {
        const store = await getStore();
        await store.set(key, value);
        await store.save();
      } catch (error) {
        console.error("Error setting item in Tauri store:", error);
      }
    },
    async removeItem(key) {
      try {
        const store = await getStore();
        await store.delete(key);
        await store.save();
      } catch (error) {
        console.error("Error removing item from Tauri store:", error);
      }
    },
  };
}

// Generate or retrieve persistent device session ID
// This ID survives token refreshes but can be reset by user (clearing storage)
async function getDeviceSessionId() {
  const STORAGE_KEY = 'device_session_id';

  if (isTauriApp) {
    try {
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('device.json');
      let sessionId = await store.get(STORAGE_KEY);

      if (!sessionId) {
        sessionId = crypto.randomUUID();
        await store.set(STORAGE_KEY, sessionId);
        await store.save();
      }
      return sessionId;
    } catch (error) {
      console.error('Error managing device session ID:', error);
      return crypto.randomUUID(); // Fallback to temporary ID
    }
  } else {
    // Web - use localStorage
    let sessionId = localStorage.getItem(STORAGE_KEY);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, sessionId);
    }
    return sessionId;
  }
}

// Initialize Supabase client with PKCE flow for better mobile/desktop support
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: "pkce", // Use PKCE flow (more secure for mobile/desktop)
      storage: isTauriApp ? createTauriStorage() : undefined, // Custom storage for Tauri apps (desktop + mobile)
    },
  }
);

// Listen for auth state changes and keep session synced
supabase.auth.onAuthStateChange((event, session) => {
  console.log(
    "Auth state changed:",
    event,
    session ? "Session active" : "No session"
  );
  if (event === "SIGNED_OUT") {
    console.log("User signed out");
  }
});

/**
 * Unified API service that works in both Tauri desktop and web environments
 */
class ApiService {
  // Expose Supabase client for direct access (needed for OAuth callbacks)
  supabase = supabase;

  // ==================== INTERNAL METHODS ====================

  /**
   * Get auth headers with Supabase session token and device session ID
   */
  async getAuthHeaders() {
    const headers = {
      "Content-Type": "application/json",
    };

    // Add device session ID for session deduplication
    const deviceSessionId = await getDeviceSessionId();
    headers["X-Device-Session-Id"] = deviceSessionId;

    // Get Supabase session
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }

    return headers;
  }

  /**
   * Make an authenticated API call with automatic Supabase token refresh
   */
  async makeAuthenticatedRequest(url, options = {}, retryCount = 0) {
    const maxRetries = 1;

    try {
      const response = await fetch(url, {
        ...options,
        credentials: "include", // Required for CORS with credentials
        headers: {
          ...(await this.getAuthHeaders()),
          ...options.headers,
        },
      });

      // If we get a 401, Supabase will auto-refresh the token
      // Just retry the request once
      if (response.status === 401 && retryCount < maxRetries) {
        console.log("Got 401, refreshing session and retrying...");
        const {
          data: { session },
          error,
        } = await supabase.auth.refreshSession();

        if (error || !session) {
          throw new Error("Session expired. Please log in again.");
        }

        // Retry the original request with the new token
        return this.makeAuthenticatedRequest(url, options, retryCount + 1);
      }

      return response;
    } catch (error) {
      // Network or other errors
      if (error.message === "Session expired. Please log in again.") {
        throw error;
      }
      throw new Error(`Network error: ${error.message}`);
    }
  }

  // ==================== AUTHENTICATION METHODS ====================

  /**
   * Register a new user account with email/password
   */
  async register(email, password) {
    console.log("📝 Starting registration for:", email);

    // Step 1: Create Supabase auth user
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/verify-email.html`,
      },
    });

    console.log("📝 Supabase signUp response:", { data, error });

    if (error) {
      // Log the full error for debugging
      console.error("❌ Supabase registration error:", error);
      console.error("❌ Error details:", {
        message: error.message,
        status: error.status,
        code: error.code,
        name: error.name,
      });

      // Translate Supabase error messages to Serbian
      let errorMessage = "Registracija nije uspela";
      if (error.message.includes("User already registered")) {
        errorMessage = "Email je već registrovan";
      } else if (error.message.includes("Password should be")) {
        errorMessage = "Lozinka mora imati najmanje 6 karaktera";
      } else if (error.message.includes("invalid email")) {
        errorMessage = "Nevažeća email adresa";
      } else if (error.status === 500) {
        // Supabase server error - show more helpful message
        errorMessage = `Greška servera pri registraciji: ${error.message}`;
      }
      throw new Error(errorMessage);
    }

    // Check if user already exists (OAuth duplicate registration)
    if (data.user?.identities?.length === 0) {
      throw new Error(
        "Email je već registrovan. Pokušajte se prijaviti pomoću Google ili Apple naloga ili koristite opciju za prijavu."
      );
    }

    // Step 2: Link Supabase user to backend (creates trial_registered account with 5 messages)
    if (data.session) {
      try {
        const linkResponse = await this.makeAuthenticatedRequest(
          `${API_BASE_URL}/api/auth/link-user`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${data.session.access_token}`,
            },
          }
        );

        if (!linkResponse.ok) {
          console.error(
            "Failed to link user to backend:",
            await linkResponse.text()
          );
          // Don't fail registration if linking fails - user is created in Supabase
        } else {
          const linkResult = await linkResponse.json();
          console.log("✅ User linked to backend:", linkResult);

          // Verification email is now sent automatically by the backend
          // No need to call requestEmailVerification here
        }
      } catch (linkError) {
        console.error("Error linking user to backend:", linkError);
        // Don't fail registration if linking fails
      }
    }

    return {
      success: true,
      message: "Uspešno ste se registrovali! Proverite email za verifikaciju.",
      user: data.user,
      session: data.session,
    };
  }

  /**
   * Login with email and password
   */
  async login(email, password) {
    // First check if user has OAuth providers (before attempting Supabase login)
    try {
      const checkResponse = await fetch(
        `${API_BASE_URL}/api/auth/check-provider`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }
      );

      if (checkResponse.ok) {
        const providerData = await checkResponse.json();

        // If user has OAuth providers, show helpful error before attempting login
        if (providerData.has_oauth && providerData.providers.length > 0) {
          const providers = providerData.providers;

          if (providers.includes("google") && providers.includes("apple")) {
            throw new Error(
              "Neispravni podaci za prijavu. Molimo prijavite se pomoću Google ili Apple naloga."
            );
          } else if (providers.includes("google")) {
            throw new Error(
              "Neispravni podaci za prijavu. Molimo prijavite se pomoću Google naloga."
            );
          } else if (providers.includes("apple")) {
            throw new Error(
              "Neispravni podaci za prijavu. Molimo prijavite se pomoću Apple naloga."
            );
          } else {
            throw new Error(
              "Neispravni podaci za prijavu. Molimo prijavite se pomoću Google ili Apple naloga."
            );
          }
        }
      }
    } catch (checkError) {
      // If the error is our custom OAuth message, throw it
      if (checkError.message.includes("Molimo prijavite se")) {
        throw checkError;
      }
      // Otherwise, continue with normal login attempt
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Translate Supabase error messages to Serbian
      let errorMessage = "Prijava nije uspela";
      if (error.message.includes("Invalid login credentials")) {
        errorMessage = "Neispravni podaci za prijavu";
      } else if (error.message.includes("Email not confirmed")) {
        errorMessage = "Email nije potvrđen";
      } else if (error.message.includes("User not found")) {
        errorMessage = "Korisnik nije pronađen";
      }
      throw new Error(errorMessage);
    }

    // Link user to backend (in case they weren't linked before)
    if (data.session) {
      await this.linkOAuthUser(data.session);
    }

    return {
      success: true,
      message: "Uspešno ste se prijavili!",
      user: data.user,
      session: data.session,
    };
  }

  /**
   * Sign in with Google - Unified OAuth flow across all platforms
   *
   * Platform Flows:
   * - Web: Standard Supabase OAuth redirect
   * - Desktop: Localhost callback via tauri-plugin-oauth (external browser)
   * - iOS: ASWebAuthenticationSession via tauri-plugin-web-auth
   * - Android: Custom Tabs via tauri-plugin-web-auth
   */
  async signInWithGoogle() {
    console.log("🚀 signInWithGoogle() called");

    // Detect platform
    const isTauriApp = Boolean(window.__TAURI__);
    const isIOS = isTauriApp && /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isAndroid = isTauriApp && /Android/i.test(navigator.userAgent);
    const isDesktop = isTauriApp && !isIOS && !isAndroid;

    console.log(
      "📍 Platform:",
      isIOS
        ? "iOS (ASWebAuthenticationSession)"
        : isAndroid
        ? "Android (Custom Tabs)"
        : isDesktop
        ? "Desktop (localhost callback)"
        : "Web (Supabase OAuth)"
    );

    // Desktop: Use localhost callback (industry standard)
    if (isDesktop) {
      console.log(
        "🖥️ Using tauri-plugin-oauth for desktop (localhost callback)"
      );

      try {
        // Import the oauth plugin
        const { start } = await import("@fabianlars/tauri-plugin-oauth");
        const { open } = await import("@tauri-apps/plugin-opener");

        // Start localhost server and get the port
        const port = await start();
        const redirectUrl = `http://localhost:${port}`;

        console.log("🔐 Started OAuth server on:", redirectUrl);

        // Get Supabase URL
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error("VITE_SUPABASE_URL not configured");
        }

        // Build Supabase OAuth URL with localhost redirect
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: redirectUrl,
            skipBrowserRedirect: true, // Don't auto-redirect, we'll open manually
            queryParams: {
              access_type: "offline",
              prompt: "consent",
            },
          },
        });

        if (error) {
          throw new Error(error.message || "Failed to initiate OAuth");
        }

        console.log("🌐 Opening system browser for OAuth...");
        console.log("OAuth URL:", data.url);

        // Open system browser
        await open(data.url);

        console.log("⏳ Waiting for OAuth callback...");

        // The plugin will automatically capture the callback
        // Supabase PKCE flow will handle the code exchange
        // Listen for the callback via Supabase's session detection
        return new Promise((resolve, reject) => {
          // Set a timeout for OAuth flow (5 minutes)
          const timeout = setTimeout(() => {
            reject(
              new Error("OAuth timeout - user did not complete authentication")
            );
          }, 5 * 60 * 1000);

          // Poll for session (Supabase will auto-exchange PKCE code)
          const checkSession = setInterval(async () => {
            const {
              data: { session },
              error: sessionError,
            } = await supabase.auth.getSession();

            if (session) {
              clearTimeout(timeout);
              clearInterval(checkSession);
              console.log("✅ Desktop OAuth successful, session established");

              // Validate session
              if (!session.user) {
                reject(new Error("Invalid session data received from OAuth"));
                return;
              }

              // Link OAuth user to backend (non-blocking - don't fail login if this fails)
              try {
                await this.linkOAuthUser(session);
              } catch (linkError) {
                console.error("⚠️ Failed to link OAuth user to backend (non-fatal):", linkError);
                // Don't reject - user is authenticated in Supabase
              }

              resolve({ session, user: session.user });
            } else if (sessionError) {
              clearTimeout(timeout);
              clearInterval(checkSession);
              reject(sessionError);
            }
          }, 1000); // Check every second
        });
      } catch (authError) {
        console.error("❌ Desktop OAuth failed:", authError);
        // Preserve original error message for better debugging
        throw authError;
      }
    }

    // Mobile (iOS/Android): Use custom URL schemes
    if (isIOS || isAndroid) {
      console.log("📱 Using tauri-plugin-web-auth for mobile OAuth");

      try {
        // Import the authenticate function from the plugin
        const { authenticate } = await import("tauri-plugin-web-auth-api");

        // Get Supabase URL
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error("VITE_SUPABASE_URL not configured");
        }

        // Use custom URL scheme callback (must match app identifier)
        const callbackScheme = "com.nikola.norma-ai";
        const redirectUri = `${callbackScheme}://oauth-callback`;

        // Build Supabase OAuth URL with custom redirect
        const authUrl = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(
          redirectUri
        )}`;

        console.log("🔐 Opening in-app browser for OAuth via Supabase...");
        console.log("Auth URL:", authUrl);
        console.log("Callback scheme:", callbackScheme);

        // Call plugin with valid custom scheme
        const result = await authenticate({
          url: authUrl,
          callbackScheme: callbackScheme,
        });

        console.log("✅ OAuth callback received:", result.callbackUrl);

        // Parse callback URL - Supabase returns tokens in hash fragment
        const callbackUrl = result.callbackUrl;

        // Extract tokens from URL (can be in hash or query params)
        let accessToken, refreshToken;

        // Try hash fragment first (standard Supabase response)
        if (callbackUrl.includes("#")) {
          const hashPart = callbackUrl.split("#")[1];
          const hashParams = new URLSearchParams(hashPart);
          accessToken = hashParams.get("access_token");
          refreshToken = hashParams.get("refresh_token");
        }

        // Fallback to query params
        if (!accessToken) {
          const url = new URL(callbackUrl);
          accessToken = url.searchParams.get("access_token");
          refreshToken = url.searchParams.get("refresh_token");
        }

        // Check for errors
        const url = new URL(callbackUrl);
        const error =
          url.searchParams.get("error") ||
          url.searchParams.get("error_description");

        if (error) {
          throw new Error(`OAuth error: ${error}`);
        }

        if (!accessToken) {
          throw new Error("No access token in callback URL");
        }

        console.log("📤 Setting Supabase session with tokens...");

        // Set the session in Supabase
        const { data, error: authError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (authError) {
          console.error("❌ Failed to set Supabase session:", authError);
          throw new Error(authError.message || "Failed to set session");
        }

        console.log("✅ Supabase session established");

        // Validate session data before returning
        if (!data.session || !data.user) {
          throw new Error("Invalid session data received from OAuth");
        }

        // Link OAuth user to backend (non-blocking - don't fail login if this fails)
        try {
          await this.linkOAuthUser(data.session);
        } catch (linkError) {
          console.error("⚠️ Failed to link OAuth user to backend (non-fatal):", linkError);
          // Don't throw - user is authenticated in Supabase, backend will catch up on next API call
        }

        return { session: data.session, user: data.user };
      } catch (authError) {
        console.error("❌ Mobile OAuth failed:", authError);
        // Preserve original error message for better debugging
        throw authError;
      }
    }

    // Web only: Standard Supabase OAuth flow (redirect-based)
    console.log("🌐 Using Supabase OAuth (redirect flow for web)");

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/auth/callback",
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (error) {
      console.error("❌ Supabase signInWithOAuth error:", error);
      throw new Error(error.message || "Google prijava nije uspela");
    }

    // Supabase will handle the redirect
    return data;
  }

  async signInWithApple() {
    console.log("🍎 signInWithApple() called");

    // Detect platform
    const isTauriApp = Boolean(window.__TAURI__);
    const isIOS = isTauriApp && /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isAndroid = isTauriApp && /Android/i.test(navigator.userAgent);
    const isDesktop = isTauriApp && !isIOS && !isAndroid;

    console.log(
      "📍 Platform:",
      isIOS
        ? "iOS (ASWebAuthenticationSession)"
        : isAndroid
        ? "Android (Custom Tabs)"
        : isDesktop
        ? "Desktop (localhost callback)"
        : "Web"
    );

    // Desktop: Use localhost callback (same as Google)
    if (isDesktop) {
      console.log(
        "🖥️ Using tauri-plugin-oauth for desktop Apple Sign-In (localhost callback)"
      );

      try {
        const { start } = await import("@fabianlars/tauri-plugin-oauth");
        const { open } = await import("@tauri-apps/plugin-opener");

        const port = await start();
        const redirectUrl = `http://localhost:${port}`;

        console.log("🔐 Started OAuth server on:", redirectUrl);

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error("VITE_SUPABASE_URL not configured");
        }

        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: "apple",
          options: {
            redirectTo: redirectUrl,
            skipBrowserRedirect: true,
            queryParams: {
              access_type: "offline",
              prompt: "consent",
            },
          },
        });

        if (error) {
          throw new Error(error.message || "Failed to initiate OAuth");
        }

        console.log("🌐 Opening system browser for Apple OAuth...");
        await open(data.url);

        console.log("⏳ Waiting for OAuth callback...");

        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(
              new Error("OAuth timeout - user did not complete authentication")
            );
          }, 5 * 60 * 1000);

          const checkSession = setInterval(async () => {
            const {
              data: { session },
              error: sessionError,
            } = await supabase.auth.getSession();

            if (session) {
              clearTimeout(timeout);
              clearInterval(checkSession);
              console.log(
                "✅ Desktop Apple OAuth successful, session established"
              );

              // Validate session
              if (!session.user) {
                reject(new Error("Invalid session data received from OAuth"));
                return;
              }

              // Link OAuth user to backend (non-blocking - don't fail login if this fails)
              try {
                await this.linkOAuthUser(session);
              } catch (linkError) {
                console.error("⚠️ Failed to link Apple user to backend (non-fatal):", linkError);
                // Don't reject - user is authenticated in Supabase
              }

              resolve({ session, user: session.user });
            } else if (sessionError) {
              clearTimeout(timeout);
              clearInterval(checkSession);
              reject(sessionError);
            }
          }, 1000);
        });
      } catch (authError) {
        console.error("❌ Desktop Apple Sign-In failed:", authError);
        // Preserve original error message for better debugging
        throw authError;
      }
    }

    // Mobile (iOS only): Apple Sign-In via custom URL scheme
    if (isIOS) {
      console.log("📱 Using tauri-plugin-web-auth for iOS Apple Sign-In");

      try {
        const { authenticate } = await import("tauri-plugin-web-auth-api");

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error("VITE_SUPABASE_URL not configured");
        }

        const callbackScheme = "com.nikola.norma-ai";
        const redirectUri = `${callbackScheme}://oauth-callback`;
        const authUrl = `${supabaseUrl}/auth/v1/authorize?provider=apple&redirect_to=${encodeURIComponent(
          redirectUri
        )}`;

        console.log("🍎 Opening in-app browser for Apple OAuth...");

        const result = await authenticate({
          url: authUrl,
          callbackScheme: callbackScheme,
        });

        console.log("✅ OAuth callback received:", result.callbackUrl);

        const callbackUrl = result.callbackUrl;
        let accessToken, refreshToken;

        if (callbackUrl.includes("#")) {
          const hashPart = callbackUrl.split("#")[1];
          const hashParams = new URLSearchParams(hashPart);
          accessToken = hashParams.get("access_token");
          refreshToken = hashParams.get("refresh_token");
        }

        if (!accessToken) {
          const url = new URL(callbackUrl);
          accessToken = url.searchParams.get("access_token");
          refreshToken = url.searchParams.get("refresh_token");
        }

        const url = new URL(callbackUrl);
        const error =
          url.searchParams.get("error") ||
          url.searchParams.get("error_description");

        if (error) {
          throw new Error(`OAuth error: ${error}`);
        }

        if (!accessToken) {
          throw new Error("No access token in callback URL");
        }

        console.log("📤 Setting Supabase session with tokens...");

        const { data, error: authError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (authError) {
          console.error("❌ Failed to set Supabase session:", authError);
          throw new Error(authError.message || "Failed to set session");
        }

        console.log("✅ Supabase session established");

        // Validate session data before returning
        if (!data.session || !data.user) {
          throw new Error("Invalid session data received from OAuth");
        }

        // Link OAuth user to backend (non-blocking - don't fail login if this fails)
        try {
          await this.linkOAuthUser(data.session);
        } catch (linkError) {
          console.error("⚠️ Failed to link OAuth user to backend (non-fatal):", linkError);
          // Don't throw - user is authenticated in Supabase, backend will catch up on next API call
        }

        return { session: data.session, user: data.user };
      } catch (authError) {
        console.error("❌ iOS Apple Sign-In failed:", authError);
        // Preserve original error message for better debugging
        throw authError;
      }
    }

    // Non-supported platforms
    throw new Error(
      "Apple Sign-In is only available on iOS and desktop platforms"
    );
  }

  /**
   * Link OAuth/email user to backend after Supabase auth
   */
  async linkOAuthUser(session) {
    if (!session || !session.access_token) {
      console.warn("No session to link");
      return;
    }

    try {
      const linkResponse = await fetch(`${API_BASE_URL}/api/auth/link-user`, {
        method: "POST",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (!linkResponse.ok) {
        const errorText = await linkResponse.text();
        console.error("Failed to link OAuth user to backend:", errorText);
      } else {
        const linkResult = await linkResponse.json();
        console.log("✅ OAuth user linked to backend:", linkResult);
      }
    } catch (error) {
      console.error("Error linking OAuth user to backend:", error);
    }
  }

  /**
   * Logout and clear session
   */
  async logout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Logout error:", error);
      throw new Error(error.message || "Logout failed");
    }

    return { success: true, message: "Uspešno ste se odjavili" };
  }

  /**
   * Get user status (trial/premium info)
   */
  async getUserStatus() {
    console.log("🔍 DEBUG: apiService.getUserStatus() called");
    const response = await this.makeAuthenticatedRequest(
      `${API_BASE_URL}/api/auth/user-status`,
      {
        method: "GET",
      }
    );

    console.log("🔍 DEBUG: getUserStatus response status:", response.status);
    if (!response.ok) {
      console.log(
        "🔍 DEBUG: getUserStatus failed with status:",
        response.status
      );
      throw new Error(`Failed to get user status: ${response.status}`);
    }

    const result = await response.json();
    console.log("🔍 DEBUG: getUserStatus result:", result);
    return result;
  }

  /**
   * Request password reset (sends email via backend Resend service)
   */
  async forgotPassword(email) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to send password reset email");
      }

      return data;
    } catch (error) {
      console.error("Error requesting password reset:", error);
      throw error;
    }
  }

  /**
   * Reset password using token from email (backend validation)
   */
  async resetPassword(token, newPassword) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token, new_password: newPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to reset password");
      }

      return data;
    } catch (error) {
      console.error("Error resetting password:", error);
      throw error;
    }
  }

  /**
   * Request email verification (send/resend verification email)
   */
  async requestEmailVerification(accessToken = null) {
    try {
      const token = accessToken || (await this.getAccessToken());
      if (!token) {
        throw new Error("No access token available");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/auth/request-email-verification`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || "Failed to request email verification"
        );
      }

      const result = await response.json();
      // Email is now sent server-side by the backend
      return result;
    } catch (error) {
      console.error("Error requesting email verification:", error);
      throw error;
    }
  }

  // Email sending is now handled server-side by the backend
  // No client-side email sending needed anymore

  /**
   * Check if user is authenticated
   */
  async isAuthenticated() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return !!session;
  }

  /**
   * Get current access token
   */
  async getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token || null;
  }

  /**
   * Get current user
   */
  async getCurrentUser() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  }

  // ==================== EXISTING METHODS WITH AUTH HEADERS ====================

  /**
   * Create a new chat
   */
  async createChat(title) {
    console.log("🔍 DEBUG: apiService.createChat() called with title:", title);
    console.log("🔍 DEBUG: apiService.createChat() - making HTTP request");
    const response = await fetch(`${API_BASE_URL}/api/chats`, {
      method: "POST",
      credentials: "include",
      headers: await this.getAuthHeaders(),
      body: JSON.stringify({
        title,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    console.log("🔍 DEBUG: apiService.createChat() - got result:", result);
    return result.id;
  }

  /**
   * Get all chats
   */
  async getChats() {
    console.log("🔍 DEBUG: apiService.getChats() called");
    const response = await this.makeAuthenticatedRequest(
      `${API_BASE_URL}/api/chats`,
      {
        method: "GET",
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    console.log(
      "🔍 DEBUG: apiService.getChats() - got result:",
      result.length,
      "chats"
    );
    return result;
  }

  /**
   * Get messages for a specific chat
   */
  async getMessages(chatId) {
    const response = await this.makeAuthenticatedRequest(
      `${API_BASE_URL}/api/chats/${chatId}/messages`,
      {
        method: "GET",
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();

    // Reconstruct generated_contract objects from database fields
    const messagesWithContracts = result.map((message) => {
      // If message has contract fields, reconstruct the generated_contract object
      if (
        message.contract_file_id &&
        message.contract_type &&
        message.contract_filename
      ) {
        return {
          ...message,
          generated_contract: {
            filename: message.contract_filename,
            download_url: `${API_BASE_URL}/api/contracts/${message.contract_file_id}`,
            contract_type: message.contract_type,
            preview_text: "Ugovor je spreman za preuzimanje",
            created_at: message.created_at,
          },
        };
      }
      return message;
    });

    return messagesWithContracts;
  }

  /**
   * Add a message to a chat
   */
  async addMessage(chatId, role, content, lawName = null) {
    const response = await fetch(`${API_BASE_URL}/api/messages`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        role,
        content,
        law_name: lawName,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }

  /**
   * Delete a chat
   */
  async deleteChat(chatId) {
    const response = await this.makeAuthenticatedRequest(
      `${API_BASE_URL}/api/chats/${chatId}`,
      {
        method: "DELETE",
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }

  async updateChatTitle(chatId, title) {
    const response = await this.makeAuthenticatedRequest(
      `${API_BASE_URL}/api/chats/${chatId}/title`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }

  /**
   * Ask a question (main AI interaction)
   */
  async askQuestion(questionRequest) {
    // Both desktop and web apps use the same backend API
    // API key is managed by backend via environment variables
    const response = await this.makeAuthenticatedRequest(
      `${API_BASE_URL}/api/question`,
      {
        method: "POST",
        body: JSON.stringify(questionRequest),
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }

  /**
   * Fetch law content
   */
  async fetchLawContent(url) {
    const response = await fetch(`${API_BASE_URL}/api/law-content`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }

  /**
   * Get cached law content
   */
  async getCachedLaw(lawName) {
    const response = await fetch(`${API_BASE_URL}/api/cached-law`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ law_name: lawName }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }

  /**
   * Upgrade user plan (placeholder for payment processing)
   */
  async upgradePlan(planId, planData) {
    // Placeholder implementation until backend endpoints are ready
    // TODO: Replace with actual API call when backend is implemented
    const result = await new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: true,
          plan_id: planId,
          message: "Plan upgrade successful (placeholder)",
          // Simulate updated user status
          access_type: planId === "premium" ? "premium" : "trial",
          messages_remaining: planId === "premium" ? 999999 : 10,
        });
      }, 1500);
    });

    /*
    // Uncomment when backend is ready:
    const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/subscription/upgrade`, {
      method: 'POST',
      body: JSON.stringify({
        plan_id: planId,
        plan_data: planData
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Plan upgrade failed: ${response.status}`);
    }

    result = await response.json();
    */

    return result;
  }

  /**
   * Cancel user subscription
   */
  async cancelSubscription() {
    const response = await this.makeAuthenticatedRequest(
      `${API_BASE_URL}/api/subscription/cancel`,
      {
        method: "POST",
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.message || `Subscription cancellation failed: ${response.status}`
      );
    }

    return await response.json();
  }

  /**
   * Get subscription details
   */
  async getSubscriptionDetails() {
    const response = await this.makeAuthenticatedRequest(
      `${API_BASE_URL}/api/subscription/details`,
      {
        method: "GET",
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.message ||
          `Failed to get subscription details: ${response.status}`
      );
    }

    return await response.json();
  }

  /**
   * Change billing period (monthly/yearly)
   */
  async changeBillingPeriod(newPeriod) {
    const response = await this.makeAuthenticatedRequest(
      `${API_BASE_URL}/api/subscription/billing-period`,
      {
        method: "PUT",
        body: JSON.stringify({
          billing_period: newPeriod,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.message || `Failed to change billing period: ${response.status}`
      );
    }

    return await response.json();
  }

  /**
   * Change subscription plan (individual/professional/team)
   */
  async changePlan(newPlanId, billingPeriod = "monthly") {
    const response = await this.makeAuthenticatedRequest(
      `${API_BASE_URL}/api/subscription/change-plan`,
      {
        method: "PUT",
        body: JSON.stringify({
          plan_id: newPlanId,
          billing_period: billingPeriod,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.message || `Failed to change plan: ${response.status}`
      );
    }

    return await response.json();
  }

  /**
   * Submit feedback for a message
   * @param {number} messageId - The message ID
   * @param {string} feedbackType - 'positive' or 'negative'
   * @returns {Promise} Response with success status
   */
  async submitMessageFeedback(messageId, feedbackType) {
    console.log("🔍 API SERVICE: submitMessageFeedback called", {
      messageId,
      feedbackType,
      url: `${API_BASE_URL}/api/messages/${messageId}/feedback`,
    });

    const requestBody = { feedback_type: feedbackType };
    console.log("🔍 API SERVICE: Request body", requestBody);

    try {
      const response = await this.makeAuthenticatedRequest(
        `${API_BASE_URL}/api/messages/${messageId}/feedback`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      console.log("🔍 API SERVICE: Response received", result);
      return result;
    } catch (error) {
      console.error("❌ API SERVICE ERROR:", error);
      throw error;
    }
  }

  /**
   * Link purchase receipt to user in RevenueCat
   * @param {string} receiptToken - Purchase token (Android) or transaction receipt (iOS)
   * @param {boolean} isRestore - Whether this is a restore operation
   * @returns {Promise<Object>} Link result
   */
  async linkPurchase(receiptToken, isRestore = false) {
    try {
      const response = await this.makeAuthenticatedRequest(
        `${API_BASE_URL}/api/subscription/link-purchase`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            receipt_token: receiptToken,
            is_restore: isRestore,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to link purchase");
      }

      return await response.json();
    } catch (error) {
      console.error("Purchase linking error:", error);
      throw error;
    }
  }

  /**
   * Verify subscription status (calls RevenueCat API)
   * Useful for restoring purchases or debugging
   */
  async verifySubscription() {
    try {
      const response = await this.makeAuthenticatedRequest(
        `${API_BASE_URL}/api/subscription/verify`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to verify subscription");
      }

      return await response.json();
    } catch (error) {
      console.error("Subscription verification error:", error);
      throw error;
    }
  }

  /**
   * Request account deletion (soft delete with 30-day grace period)
   * @param {string|null} password - Required for email/password users, null for OAuth users
   * @returns {Promise<{success: boolean, message: string, grace_period_ends: string}>}
   */
  async requestDeleteAccount(password = null) {
    try {
      const response = await this.makeAuthenticatedRequest(
        `${API_BASE_URL}/api/auth/delete-account`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            password,
            confirmation: true,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to delete account");
      }

      return await response.json();
    } catch (error) {
      console.error("Error requesting account deletion:", error);
      throw error;
    }
  }

  /**
   * Restore account during grace period
   * @returns {Promise<{success: boolean, message: string, user_status: object}>}
   */
  async restoreAccount() {
    try {
      const response = await this.makeAuthenticatedRequest(
        `${API_BASE_URL}/api/auth/restore-account`,
        {
          method: "POST",
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to restore account");
      }

      return await response.json();
    } catch (error) {
      console.error("Error restoring account:", error);
      throw error;
    }
  }

  /**
   * Check if running in desktop mode
   */
  isDesktop() {
    return isDesktop;
  }

  /**
   * Get platform information
   */
  getPlatform() {
    return isDesktop ? "desktop" : "web";
  }

  // ==================== SESSION MANAGEMENT ====================

  /**
   * Get all active sessions for the current user
   */
  async getSessions() {
    const response = await this.makeAuthenticatedRequest(
      `${API_BASE_URL}/api/auth/sessions`,
      {
        method: "GET",
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get sessions: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Revoke a specific session
   */
  async revokeSession(sessionId) {
    const response = await this.makeAuthenticatedRequest(
      `${API_BASE_URL}/api/auth/sessions/revoke`,
      {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to revoke session: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Revoke all sessions except the current one
   */
  async revokeAllSessions() {
    const response = await this.makeAuthenticatedRequest(
      `${API_BASE_URL}/api/auth/sessions/revoke-all`,
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to revoke all sessions: ${response.status}`);
    }

    return await response.json();
  }

  // ==================== PASSWORD MANAGEMENT ====================

  /**
   * Change user password (uses Supabase)
   */
  async changePassword(newPassword) {
    // First update password via Supabase
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      // Translate Supabase error messages to Serbian
      let errorMessage = error.message || "Greška prilikom promene lozinke";

      if (
        errorMessage.includes(
          "New password should be different from the old password"
        )
      ) {
        errorMessage = "Nova lozinka mora biti drugačija od stare lozinke";
      } else if (errorMessage.includes("Password should be")) {
        errorMessage = "Lozinka ne ispunjava sigurnosne zahteve";
      }

      throw new Error(errorMessage);
    }

    // Then notify backend to revoke other sessions
    const response = await this.makeAuthenticatedRequest(
      `${API_BASE_URL}/api/auth/change-password`,
      {
        method: "POST",
        body: JSON.stringify({ new_password: newPassword }),
      }
    );

    if (!response.ok) {
      console.warn(
        "Password changed but failed to revoke sessions:",
        response.status
      );
      // Don't throw - password was already changed successfully
    }

    return await response.json();
  }
}

// Export a singleton instance
export const apiService = new ApiService();
export default apiService;

// Export Supabase client for direct access (e.g., in AuthPage)
export { supabase };

// Named exports for convenience - bind context to preserve 'this'
export const submitMessageFeedback =
  apiService.submitMessageFeedback.bind(apiService);
