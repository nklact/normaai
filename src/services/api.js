// Dynamic import of Tauri API - only available in desktop builds
import { createClient } from '@supabase/supabase-js';
import { getDeviceFingerprint } from '../utils/deviceFingerprint.js';

// Detect if we're running in Tauri DESKTOP (Windows/Mac/Linux) environment
// Mobile (iOS/Android) apps should use HTTP like web browsers
const isDesktop = window.__TAURI__ && !(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));

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
      storage: isDesktop ? createTauriStorage() : undefined // Custom storage for Tauri
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
   * Sign in with Google - Uses ASWebAuthenticationSession on iOS/Android (PKCE flow)
   * Works on: Web, Desktop (Windows/Mac/Linux), Mobile (iOS/Android)
   *
   * iOS/Android Flow (ASWebAuthenticationSession):
   * 1. Get OAuth URL from Supabase with skipBrowserRedirect: true
   * 2. Open in-app browser via ASWebAuthenticationSession (iOS) or Custom Tabs (Android)
   * 3. User authenticates with Google in secure in-app browser
   * 4. Google redirects to callback URL (normaai://auth/callback)
   * 5. Browser automatically returns to app with callback URL
   * 6. Extract code from callback and exchange for session
   *
   * Desktop Flow:
   * 1-4. Same as above but uses system browser (Safari/Chrome/Edge)
   * 5. Deep link brings user back to app
   * 6. Extract code and exchange for session
   *
   * Web Flow:
   * Standard OAuth redirect flow handled by Supabase
   */
  async signInWithGoogle() {
    console.log('🚀 signInWithGoogle() called');
    const deviceFingerprint = await getDeviceFingerprint();

    // Detect platform
    const isTauriApp = Boolean(window.__TAURI__);
    const isMobile = isTauriApp && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const isDesktop = isTauriApp && !isMobile;

    console.log('📍 Platform:', isTauriApp ? (isMobile ? 'Tauri Mobile' : 'Tauri Desktop') : 'Web Browser');

    // Get OAuth URL from Supabase
    // Always use HTTPS redirect URL because Google OAuth doesn't support custom URL schemes
    // For mobile, we'll use Universal Links (https://chat.normaai.rs) configured in tauri.conf.json
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'https://chat.normaai.rs/auth/callback', // HTTPS for all platforms
        skipBrowserRedirect: isTauriApp, // We'll handle browser opening manually for Tauri
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
        data: {
          device_fingerprint: deviceFingerprint
        }
      }
    });

    if (error) {
      console.error('❌ Supabase signInWithOAuth error:', error);
      throw new Error(error.message || 'Google prijava nije uspela');
    }

    console.log('✅ OAuth URL received:', data.url ? data.url.substring(0, 100) + '...' : 'NO URL');

    if (!data.url) {
      console.error('❌ No OAuth URL returned from Supabase!');
      throw new Error('No OAuth URL received');
    }

    // Mobile: Use ASWebAuthenticationSession (in-app browser)
    // Note: We use 'https' as callbackScheme because Google OAuth doesn't support custom URL schemes
    // The plugin will use ASWebAuthenticationSession with Universal Links (https://chat.normaai.rs)
    if (isMobile) {
      console.log('📱 Opening ASWebAuthenticationSession (in-app browser)');
      try {
        const { authenticate } = await import('@inkibra/tauri-plugin-auth');

        // Use 'https' as the scheme since Google requires HTTPS redirects
        // The actual callback will be: https://chat.normaai.rs/auth/callback?code=xxx
        const result = await authenticate({
          authUrl: data.url,
          callbackScheme: 'https' // Use https instead of custom scheme
        });

        console.log('✅ Authentication completed, callback received:', result.callbackUrl.substring(0, 100) + '...');

        // Extract code from callback URL
        const callbackUrl = new URL(result.callbackUrl);
        const code = callbackUrl.searchParams.get('code');

        if (!code) {
          throw new Error('No authorization code in callback URL');
        }

        console.log('🔐 Exchanging authorization code for session...');

        // Exchange code for session using Supabase PKCE
        const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

        if (sessionError) {
          console.error('❌ Failed to exchange code for session:', sessionError);
          throw new Error(sessionError.message || 'Failed to complete authentication');
        }

        console.log('✅ Session obtained successfully');
        return sessionData;

      } catch (authError) {
        console.error('❌ ASWebAuthenticationSession error:', authError);
        throw new Error(authError.message || 'Authentication failed');
      }
    }

    // Desktop: Use external browser (Safari/Chrome/Edge) with deep link
    if (isDesktop) {
      console.log('🖥️ Opening external browser for OAuth (Desktop)');
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(data.url);
        console.log('✅ External browser opened successfully');
        // Desktop will handle the callback via deep link in App.jsx
        return data;
      } catch (openError) {
        console.error('❌ Failed to open external browser:', openError);
        throw new Error('Failed to open browser for OAuth');
      }
    }

    // Web: Standard OAuth redirect flow
    console.log('🌐 Web browser - Supabase will handle redirect');
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
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("get_user_status");
    } else {
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
  }

  /**
   * Start a trial for the current device
   */
  async startTrial() {
    console.log('🔍 DEBUG: apiService.startTrial() called');
    const deviceFingerprint = await getDeviceFingerprint();
    console.log('🔍 DEBUG: startTrial() with deviceFingerprint:', deviceFingerprint);
    
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("start_trial", { deviceFingerprint });
    } else {
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
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("create_chat", { title });
    } else {
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
  }

  /**
   * Get all chats
   */
  async getChats() {
    console.log('🔍 DEBUG: apiService.getChats() called');
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("get_chats");
    } else {
      const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/chats`, {
        method: 'GET'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      console.log('🔍 DEBUG: apiService.getChats() - got result:', result.length, 'chats');
      return result;
    }
  }

  /**
   * Get messages for a specific chat
   */
  async getMessages(chatId) {
    let result;

    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      result = await invoke("get_messages", { chatId });
    } else {
      const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/chats/${chatId}/messages`, {
        method: 'GET'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      result = await response.json();
    }

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
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("add_message", {
        chatId,
        role,
        content,
        lawName
      });
    } else {
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
  }

  /**
   * Delete a chat
   */
  async deleteChat(chatId) {
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("delete_chat", { chatId });
    } else {
      const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/chats/${chatId}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }
  }

  async updateChatTitle(chatId, title) {
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("update_chat_title", { chatId, title });
    } else {
      const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/chats/${chatId}/title`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    }
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
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("fetch_law_content", { url });
    } else {
      const response = await fetch(`${API_BASE_URL}/api/law-content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    }
  }

  /**
   * Get cached law content
   */
  async getCachedLaw(lawName) {
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("get_cached_law", { lawName });
    } else {
      const response = await fetch(`${API_BASE_URL}/api/cached-law`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ law_name: lawName })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    }
  }

  /**
   * Upgrade user plan (placeholder for payment processing)
   */
  async upgradePlan(planId, planData) {
    const deviceFingerprint = await getDeviceFingerprint();

    let result;

    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      result = await invoke("upgrade_plan", {
        planId,
        planData,
        deviceFingerprint
      });
    } else {
      // Placeholder implementation until backend endpoints are ready
      // TODO: Replace with actual API call when backend is implemented
      result = await new Promise((resolve) => {
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
    }

    return result;
  }

  /**
   * Cancel user subscription
   */
  async cancelSubscription() {
    const deviceFingerprint = await getDeviceFingerprint();

    let result;

    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      result = await invoke("cancel_subscription", { deviceFingerprint });
    } else {
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

      result = await response.json();
    }

    return result;
  }

  /**
   * Get subscription details
   */
  async getSubscriptionDetails() {
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("get_subscription_details");
    } else {
      const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/subscription/details`, {
        method: 'GET'
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `Failed to get subscription details: ${response.status}`);
      }

      return await response.json();
    }
  }

  /**
   * Change billing period (monthly/yearly)
   */
  async changeBillingPeriod(newPeriod) {
    const deviceFingerprint = await getDeviceFingerprint();

    let result;

    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      result = await invoke("change_billing_period", { newPeriod, deviceFingerprint });
    } else {
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

      result = await response.json();
    }

    return result;
  }

  /**
   * Change subscription plan (individual/professional/team)
   */
  async changePlan(newPlanId, billingPeriod = 'monthly') {
    const deviceFingerprint = await getDeviceFingerprint();

    let result;

    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      result = await invoke("change_plan", {
        newPlanId,
        billingPeriod,
        deviceFingerprint
      });
    } else {
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

      result = await response.json();
    }

    return result;
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