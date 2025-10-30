// Dynamic import of Tauri API - only available in desktop builds
import { createClient } from '@supabase/supabase-js';
import { getDeviceFingerprint } from '../utils/deviceFingerprint.js';

// Platform Detection
const isTauriApp = Boolean(window.__TAURI__);
const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const isDesktop = isTauriApp && !isMobileDevice;

// API Strategy: For web-first architecture, ALL platforms use HTTP API
// Tauri commands should only be used for platform-specific features (file system, native dialogs, etc.)
// Data operations should always use the centralized backend API
const USE_HTTP_API = true; // Always use HTTP for data operations (web-first architecture)

// Base URL for API calls
const API_BASE_URL = 'https://norma-ai.fly.dev'; // Always use Fly.io backend

// Custom storage adapter for Tauri (PKCE requires persistent storage)
function createTauriStorage() {
  let storePromise = null;

  const getStore = async () => {
    if (!storePromise) {
      const { Store } = await import('@tauri-apps/plugin-store');
      storePromise = Store.load('auth.json');
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
        console.error('Error getting item from Tauri store:', error);
        return null;
      }
    },
    async setItem(key, value) {
      try {
        const store = await getStore();
        await store.set(key, value);
        await store.save();
      } catch (error) {
        console.error('Error setting item in Tauri store:', error);
      }
    },
    async removeItem(key) {
      try {
        const store = await getStore();
        await store.delete(key);
        await store.save();
      } catch (error) {
        console.error('Error removing item from Tauri store:', error);
      }
    }
  };
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
      flowType: 'pkce', // Use PKCE flow (more secure for mobile/desktop)
      storage: isTauriApp ? createTauriStorage() : undefined // Custom storage for Tauri apps (desktop + mobile)
    }
  }
);

// Listen for auth state changes and keep session synced
supabase.auth.onAuthStateChange((event, session) => {
  console.log('Auth state changed:', event, session ? 'Session active' : 'No session');
  if (event === 'SIGNED_OUT') {
    console.log('User signed out');
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
   * Get auth headers with Supabase session token
   */
  async getAuthHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'X-Device-Fingerprint': await getDeviceFingerprint()
    };

    // Get Supabase session
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
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
        headers: {
          ...(await this.getAuthHeaders()),
          ...options.headers
        }
      });

      // If we get a 401, Supabase will auto-refresh the token
      // Just retry the request once
      if (response.status === 401 && retryCount < maxRetries) {
        console.log('Got 401, refreshing session and retrying...');
        const { data: { session }, error } = await supabase.auth.refreshSession();

        if (error || !session) {
          throw new Error('Session expired. Please log in again.');
        }

        // Retry the original request with the new token
        return this.makeAuthenticatedRequest(url, options, retryCount + 1);
      }

      return response;
    } catch (error) {
      // Network or other errors
      if (error.message === 'Session expired. Please log in again.') {
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
    const deviceFingerprint = await getDeviceFingerprint();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          device_fingerprint: deviceFingerprint
        }
      }
    });

    if (error) {
      // Translate Supabase error messages to Serbian
      let errorMessage = 'Registracija nije uspela';
      if (error.message.includes('User already registered')) {
        errorMessage = 'Email je već registrovan';
      } else if (error.message.includes('Password should be')) {
        errorMessage = 'Lozinka mora imati najmanje 6 karaktera';
      } else if (error.message.includes('invalid email')) {
        errorMessage = 'Nevažeća email adresa';
      }
      throw new Error(errorMessage);
    }

    return {
      success: true,
      message: data.user?.identities?.length === 0
        ? 'Email je već registrovan. Prijavite se.'
        : 'Uspešno ste se registrovali! Proverite email za verifikaciju.',
      user: data.user,
      session: data.session
    };
  }

  /**
   * Login with email and password
   */
  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      // Translate Supabase error messages to Serbian
      let errorMessage = 'Prijava nije uspela';
      if (error.message.includes('Invalid login credentials')) {
        errorMessage = 'Neispravni podaci za prijavu';
      } else if (error.message.includes('Email not confirmed')) {
        errorMessage = 'Email nije potvrđen';
      } else if (error.message.includes('User not found')) {
        errorMessage = 'Korisnik nije pronađen';
      }
      throw new Error(errorMessage);
    }

    return {
      success: true,
      message: 'Uspešno ste se prijavili!',
      user: data.user,
      session: data.session
    };
  }

  /**
   * Sign in with Google - Uses native Google SDKs on mobile, OAuth on desktop
   * Works on: Web, Desktop (Windows/Mac/Linux), Mobile (iOS/Android)
   *
   * iOS/Android Flow (Native Google SDK):
   * 1. Call tauri-plugin-google-auth signIn()
   * 2. Native Google SDK handles authentication
   * 3. Returns Google ID token
   * 4. Exchange ID token with Supabase using signInWithIdToken()
   * 5. Get Supabase session
   *
   * Desktop Flow (OAuth with localhost):
   * 1. Call tauri-plugin-google-auth signIn()
   * 2. Opens browser with OAuth flow
   * 3. Redirects to localhost server
   * 4. Returns Google ID token
   * 5. Exchange ID token with Supabase
   *
   * Web Flow:
   * Standard Supabase OAuth redirect flow
   */
  async signInWithGoogle() {
    console.log('🚀 signInWithGoogle() called');
    const deviceFingerprint = await getDeviceFingerprint();

    // Detect platform
    const isTauriApp = Boolean(window.__TAURI__);
    const isIOS = isTauriApp && /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isAndroid = isTauriApp && /Android/i.test(navigator.userAgent);
    const isMobile = isIOS || isAndroid;
    const isDesktop = isTauriApp && !isMobile;

    console.log('📍 Platform:',
      isIOS ? 'Tauri iOS' :
      isAndroid ? 'Tauri Android' :
      isDesktop ? 'Tauri Desktop' :
      'Web Browser');

    // Tauri apps (iOS, Android, Desktop): Use tauri-plugin-google-auth
    if (isTauriApp) {
      console.log('📱 Using tauri-plugin-google-auth');
      console.log('🔍 DEBUG: Platform detection - isIOS:', isIOS, 'isAndroid:', isAndroid, 'isDesktop:', isDesktop);

      try {
        console.log('🔍 DEBUG: Step 1 - About to import tauri-plugin-google-auth-api...');
        console.log('🔍 DEBUG: window.__TAURI__ exists:', !!window.__TAURI__);

        const { signIn } = await import('@choochmeque/tauri-plugin-google-auth-api');
        console.log('🔍 DEBUG: Step 1 COMPLETE - signIn function imported successfully');
        console.log('🔍 DEBUG: Step 1 - signIn function imported:', typeof signIn);

        console.log('🔍 DEBUG: Step 2 - Importing google-oauth config...');
        const { GOOGLE_OAUTH_CONFIG } = await import('../config/google-oauth.js');
        console.log('🔍 DEBUG: Step 2 - GOOGLE_OAUTH_CONFIG loaded:', JSON.stringify(GOOGLE_OAUTH_CONFIG, null, 2));

        // Select the appropriate Client ID based on platform
        let clientId, clientSecret;

        console.log('🔍 DEBUG: Step 3 - Selecting platform-specific config...');
        if (isIOS) {
          clientId = GOOGLE_OAUTH_CONFIG.ios.clientId;
          console.log('🔍 DEBUG: iOS Client ID:', clientId);
          console.log('🔍 DEBUG: iOS Client ID type:', typeof clientId);
        } else if (isAndroid) {
          clientId = GOOGLE_OAUTH_CONFIG.android.clientId;
          clientSecret = GOOGLE_OAUTH_CONFIG.android.clientSecret;
          console.log('🔍 DEBUG: Android Client ID:', clientId);
          console.log('🔍 DEBUG: Android Client ID type:', typeof clientId);
          console.log('🔍 DEBUG: Android Client Secret exists:', !!clientSecret);
        } else if (isDesktop) {
          clientId = GOOGLE_OAUTH_CONFIG.desktop.clientId;
          clientSecret = GOOGLE_OAUTH_CONFIG.desktop.clientSecret;
          console.log('🔍 DEBUG: Desktop Client ID:', clientId);
          console.log('🔍 DEBUG: Desktop Client Secret exists:', !!clientSecret);
        }

        if (!clientId) {
          console.error('❌ DEBUG: clientId is missing!');
          throw new Error('Google OAuth Client ID is not configured. Please check your environment variables.');
        }

        // Additional iOS validation
        if (isIOS) {
          console.log('🔍 DEBUG: Validating iOS Client ID format...');
          if (typeof clientId !== 'string' || clientId === 'undefined' || clientId === '') {
            console.error('❌ DEBUG: iOS Client ID is invalid:', clientId);
            throw new Error('iOS Google Client ID is not properly configured. Please ensure VITE_GOOGLE_IOS_CLIENT_ID is set correctly in your build environment.');
          }
          if (!clientId.includes('.apps.googleusercontent.com')) {
            console.warn('⚠️ DEBUG: iOS Client ID might be incorrect format. Expected format: XXXXX.apps.googleusercontent.com');
            console.warn('⚠️ DEBUG: Current value:', clientId);
          }
          console.log('✅ DEBUG: iOS Client ID format validation passed');
        }

        console.log('🔍 DEBUG: Step 4 - Preparing signIn parameters...');
        const signInParams = {
          clientId: clientId,
          scopes: ['openid', 'email', 'profile'],
        };

        // Add clientSecret for Android and Desktop (both need it for token exchange)
        // iOS does NOT use clientSecret (native SDK handles tokens internally)
        if ((isAndroid || isDesktop) && clientSecret) {
          signInParams.clientSecret = clientSecret;
        }

        console.log('🔍 DEBUG: signIn params:', JSON.stringify(signInParams, null, 2));

        console.log('🔐 DEBUG: Step 5 - Calling Google Sign In...');
        console.log('🔐 DEBUG: About to call native signIn with clientId:', clientId.substring(0, 20) + '...');

        let response;
        try {
          response = await signIn(signInParams);
          console.log('✅ DEBUG: Step 6 - Google authentication successful');
        } catch (signInError) {
          console.error('❌ DEBUG: signIn() call failed');
          console.error('❌ DEBUG: This might indicate:');
          console.error('   - Wrong Client ID type (Web instead of iOS)');
          console.error('   - Missing URL scheme in Info.plist');
          console.error('   - Client ID not registered in Google Cloud Console');
          console.error('❌ DEBUG: Error:', signInError);
          throw new Error(`Google Sign In failed: ${signInError?.message || 'Unknown native error'}`);
        }

        console.log('🔍 DEBUG: Response keys:', Object.keys(response || {}));
        console.log('🔍 DEBUG: Has idToken:', !!response?.idToken);

        // Exchange Google ID token with Supabase
        console.log('🔄 Exchanging Google ID token with Supabase...');

        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: response.idToken,
        });

        if (error) {
          console.error('❌ Supabase signInWithIdToken error:', error);
          throw new Error(error.message || 'Failed to sign in with Supabase');
        }

        console.log('✅ Supabase session obtained successfully');

        // Store device fingerprint
        if (data.user) {
          try {
            await this.updateDeviceFingerprint(deviceFingerprint);
          } catch (err) {
            console.warn('Failed to update device fingerprint:', err);
          }
        }

        return { session: data.session, user: data.user };

      } catch (authError) {
        console.error('❌ DEBUG: Tauri Google Sign In failed at some step');
        console.error('❌ DEBUG: Error name:', authError?.name);
        console.error('❌ DEBUG: Error message:', authError?.message);
        console.error('❌ DEBUG: Error stack:', authError?.stack);
        console.error('❌ DEBUG: Full error object:', JSON.stringify(authError, Object.getOwnPropertyNames(authError), 2));

        // Try to identify which step failed
        if (authError?.message?.includes('not configured')) {
          console.error('❌ DEBUG: Failed at Step 3 - Client ID validation');
        } else if (authError?.message?.includes('import')) {
          console.error('❌ DEBUG: Failed at Step 1 or 2 - Module import');
        } else if (authError?.message?.includes('signIn')) {
          console.error('❌ DEBUG: Failed at Step 5 - Calling signIn function');
        } else if (authError?.message?.includes('Supabase')) {
          console.error('❌ DEBUG: Failed at Step 7 - Supabase token exchange');
        } else {
          console.error('❌ DEBUG: Failed at unknown step - check error details above');
        }

        throw new Error(authError.message || 'Google prijava nije uspela');
      }
    }

    // Web: Standard Supabase OAuth flow
    console.log('🌐 Web browser - using Supabase OAuth');

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/auth/callback',
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      }
    });

    if (error) {
      console.error('❌ Supabase signInWithOAuth error:', error);
      throw new Error(error.message || 'Google prijava nije uspela');
    }

    // Web: Supabase will handle the redirect
    return data;
  }


  /**
   * Logout and clear session
   */
  async logout() {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('Logout error:', error);
      throw new Error(error.message || 'Logout failed');
    }

    return { success: true, message: 'Uspešno ste se odjavili' };
  }

  /**
   * Get user status (trial/premium info)
   */
  async getUserStatus() {
    console.log('🔍 DEBUG: apiService.getUserStatus() called');
    const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/auth/user-status`, {
      method: 'GET'
    });

    console.log('🔍 DEBUG: getUserStatus response status:', response.status);
    if (!response.ok) {
      console.log('🔍 DEBUG: getUserStatus failed with status:', response.status);
      throw new Error(`Failed to get user status: ${response.status}`);
    }

    const result = await response.json();
    console.log('🔍 DEBUG: getUserStatus result:', result);
    return result;
  }

  /**
   * Start a trial for the current device
   */
  async startTrial() {
    console.log('🔍 DEBUG: apiService.startTrial() called');
    const deviceFingerprint = await getDeviceFingerprint();
    console.log('🔍 DEBUG: startTrial() with deviceFingerprint:', deviceFingerprint);

    const response = await fetch(`${API_BASE_URL}/api/trial/start`, {
      method: 'POST',
      headers: await this.getAuthHeaders(),
      body: JSON.stringify({ device_fingerprint: deviceFingerprint })
    });

    console.log('🔍 DEBUG: startTrial response status:', response.status);

    if (!response.ok) {
      let errorText = '';
      let errorCode = '';
      try {
        const responseText = await response.text();
        console.error('🔍 DEBUG: Error response text:', responseText);
        try {
          const errorJson = JSON.parse(responseText);
          errorCode = errorJson.error || '';
          errorText = errorJson.message || `Trial start failed: ${response.status}`;
        } catch (jsonError) {
          errorText = responseText || `Trial start failed: ${response.status}`;
        }
      } catch (readError) {
        errorText = `Trial start failed: ${response.status}`;
      }

      // Include error code in the error message for easier detection
      if (errorCode === 'IP_LIMIT_EXCEEDED') {
        throw new Error(`IP_LIMIT_EXCEEDED: ${errorText}`);
      }
      throw new Error(errorText);
    }

    const result = await response.json();
    console.log('🔍 DEBUG: startTrial result:', result);
    return result;
  }

  /**
   * Request password reset
   */
  async forgotPassword(email) {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    });

    if (error) {
      throw new Error(error.message || 'Failed to send password reset email');
    }

    return {
      success: true,
      message: 'Instrukcije za resetovanje lozinke su poslate na email.'
    };
  }

  /**
   * Reset password (when user follows email link)
   */
  async resetPassword(newPassword) {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) {
      throw new Error(error.message || 'Failed to reset password');
    }

    return {
      success: true,
      message: 'Lozinka je uspešno promenjena'
    };
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated() {
    const { data: { session } } = await supabase.auth.getSession();
    return !!session;
  }

  /**
   * Get current access token
   */
  async getAccessToken() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  }

  /**
   * Get current user
   */
  async getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  }

  // ==================== EXISTING METHODS WITH AUTH HEADERS ====================

  /**
   * Create a new chat
   */
  async createChat(title) {
    console.log('🔍 DEBUG: apiService.createChat() called with title:', title);
    console.log('🔍 DEBUG: apiService.createChat() - making HTTP request');
    const response = await fetch(`${API_BASE_URL}/api/chats`, {
      method: 'POST',
      headers: await this.getAuthHeaders(),
      body: JSON.stringify({
        title,
        device_fingerprint: await getDeviceFingerprint()
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    console.log('🔍 DEBUG: apiService.createChat() - got result:', result);
    return result.id;
  }

  /**
   * Get all chats
   */
  async getChats() {
    console.log('🔍 DEBUG: apiService.getChats() called');
    const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/chats`, {
      method: 'GET'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    console.log('🔍 DEBUG: apiService.getChats() - got result:', result.length, 'chats');
    return result;
  }

  /**
   * Get messages for a specific chat
   */
  async getMessages(chatId) {
    const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/chats/${chatId}/messages`, {
      method: 'GET'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();

    // Reconstruct generated_contract objects from database fields
    const messagesWithContracts = result.map(message => {
      // If message has contract fields, reconstruct the generated_contract object
      if (message.contract_file_id && message.contract_type && message.contract_filename) {
        return {
          ...message,
          generated_contract: {
            filename: message.contract_filename,
            download_url: `${API_BASE_URL}/api/contracts/${message.contract_file_id}`,
            contract_type: message.contract_type,
            preview_text: "Ugovor je spreman za preuzimanje",
            created_at: message.created_at
          }
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        role,
        content,
        law_name: lawName
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }

  /**
   * Delete a chat
   */
  async deleteChat(chatId) {
    const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/chats/${chatId}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }

  async updateChatTitle(chatId, title) {
    const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/chats/${chatId}/title`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }

  /**
   * Ask a question (main AI interaction)
   */
  async askQuestion(questionRequest) {
    // Both desktop and web apps use the same backend API
    // API key is managed by backend via environment variables
    const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/question`, {
      method: 'POST',
      body: JSON.stringify({
        ...questionRequest,
        device_fingerprint: await getDeviceFingerprint()
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }

  /**
   * Fetch law content
   */
  async fetchLawContent(url) {
    const response = await fetch(`${API_BASE_URL}/api/law-content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }

  /**
   * Get cached law content
   */
  async getCachedLaw(lawName) {
    const response = await fetch(`${API_BASE_URL}/api/cached-law`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ law_name: lawName })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }

  /**
   * Upgrade user plan (placeholder for payment processing)
   */
  async upgradePlan(planId, planData) {
    const deviceFingerprint = await getDeviceFingerprint();

    // Placeholder implementation until backend endpoints are ready
    // TODO: Replace with actual API call when backend is implemented
    const result = await new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: true,
          plan_id: planId,
          message: 'Plan upgrade successful (placeholder)',
          // Simulate updated user status
          access_type: planId === 'premium' ? 'premium' : 'trial',
          messages_remaining: planId === 'premium' ? 999999 : 10
        });
      }, 1500);
    });

    /*
    // Uncomment when backend is ready:
    const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/subscription/upgrade`, {
      method: 'POST',
      body: JSON.stringify({
        plan_id: planId,
        plan_data: planData,
        device_fingerprint: deviceFingerprint
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
    const deviceFingerprint = await getDeviceFingerprint();

    const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/subscription/cancel`, {
      method: 'POST',
      body: JSON.stringify({
        device_fingerprint: deviceFingerprint
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Subscription cancellation failed: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Get subscription details
   */
  async getSubscriptionDetails() {
    const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/subscription/details`, {
      method: 'GET'
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Failed to get subscription details: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Change billing period (monthly/yearly)
   */
  async changeBillingPeriod(newPeriod) {
    const deviceFingerprint = await getDeviceFingerprint();

    const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/subscription/billing-period`, {
      method: 'PUT',
      body: JSON.stringify({
        billing_period: newPeriod,
        device_fingerprint: deviceFingerprint
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Failed to change billing period: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Change subscription plan (individual/professional/team)
   */
  async changePlan(newPlanId, billingPeriod = 'monthly') {
    const deviceFingerprint = await getDeviceFingerprint();

    const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/subscription/change-plan`, {
      method: 'PUT',
      body: JSON.stringify({
        plan_id: newPlanId,
        billing_period: billingPeriod,
        device_fingerprint: deviceFingerprint
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Failed to change plan: ${response.status}`);
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
    console.log('🔍 API SERVICE: submitMessageFeedback called', {
      messageId,
      feedbackType,
      url: `${API_BASE_URL}/api/messages/${messageId}/feedback`
    });

    const requestBody = { feedback_type: feedbackType };
    console.log('🔍 API SERVICE: Request body', requestBody);

    try {
      const response = await this.makeAuthenticatedRequest(
        `${API_BASE_URL}/api/messages/${messageId}/feedback`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      console.log('🔍 API SERVICE: Response received', result);
      return result;
    } catch (error) {
      console.error('❌ API SERVICE ERROR:', error);
      throw error;
    }
  }

  /**
   * Process payment (placeholder)
   */
  async processPayment(planId, paymentData) {
    // Placeholder for payment processing
    // In real implementation, this would integrate with Stripe, PayPal, etc.
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: true,
          transaction_id: `tx_${Date.now()}`,
          plan_id: planId,
          message: 'Payment processed successfully'
        });
      }, 2000);
    });
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
    return isDesktop ? 'desktop' : 'web';
  }
}

// Export a singleton instance
export const apiService = new ApiService();
export default apiService;

// Export Supabase client for direct access (e.g., in AuthModal)
export { supabase };

// Named exports for convenience - bind context to preserve 'this'
export const submitMessageFeedback = apiService.submitMessageFeedback.bind(apiService);