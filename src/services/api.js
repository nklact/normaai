// Dynamic import of Tauri API - only available in desktop builds
import { getDeviceFingerprint } from '../utils/deviceFingerprint.js';

// Detect if we're running in Tauri (desktop) or web environment
const isDesktop = window.__TAURI__;

// Base URL for API calls
const API_BASE_URL = 'https://norma-ai.fly.dev'; // Always use Fly.io backend

// Authentication token management
class AuthTokenManager {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.refreshPromise = null; // Prevent multiple simultaneous refresh attempts
    this.loadTokensFromStorage();
  }

  loadTokensFromStorage() {
    try {
      this.accessToken = localStorage.getItem('norma_ai_access_token');
      this.refreshToken = localStorage.getItem('norma_ai_refresh_token');
    } catch (e) {
      console.warn('Could not load tokens from storage');
    }
  }

  saveTokens(accessToken, refreshToken = null) {
    this.accessToken = accessToken;
    if (refreshToken !== null) {
      this.refreshToken = refreshToken;
    }
    
    try {
      if (accessToken) {
        localStorage.setItem('norma_ai_access_token', accessToken);
      }
      if (refreshToken) {
        localStorage.setItem('norma_ai_refresh_token', refreshToken);
      }
    } catch (e) {
      console.warn('Could not save tokens to storage');
    }
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    this.refreshPromise = null;
    
    try {
      localStorage.removeItem('norma_ai_access_token');
      localStorage.removeItem('norma_ai_refresh_token');
    } catch (e) {
      console.warn('Could not clear tokens from storage');
    }
  }

  async getAuthHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'X-Device-Fingerprint': await getDeviceFingerprint()
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    return headers;
  }

  isAuthenticated() {
    return !!this.accessToken;
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refreshAccessToken() {
    // If refresh is already in progress, return the existing promise
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    this.refreshPromise = this._performTokenRefresh();
    
    try {
      const result = await this.refreshPromise;
      this.refreshPromise = null;
      return result;
    } catch (error) {
      this.refreshPromise = null;
      throw error;
    }
  }

  async _performTokenRefresh() {
    const deviceFingerprint = await getDeviceFingerprint();

    if (isDesktop) {
      // For desktop, delegate to Tauri backend
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke("auth_refresh", {
        refreshToken: this.refreshToken,
        deviceFingerprint
      });
      
      if (result.success && result.access_token) {
        this.saveTokens(result.access_token, result.refresh_token);
        return result;
      } else {
        throw new Error(result.message || 'Token refresh failed');
      }
    } else {
      // For web, make direct API call
      const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Fingerprint': deviceFingerprint
        },
        body: JSON.stringify({ 
          refresh_token: this.refreshToken,
          device_fingerprint: deviceFingerprint 
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || `Token refresh failed: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success && result.access_token) {
        this.saveTokens(result.access_token, result.refresh_token);
        return result;
      } else {
        throw new Error(result.message || 'Token refresh failed');
      }
    }
  }
}

const authManager = new AuthTokenManager();

/**
 * Cache Manager for localStorage operations
 * Handles data caching with device fingerprint scoping for multi-user support
 */
class CacheManager {
  constructor() {
    this.prefix = 'norma_cache_';
    this.deviceFingerprint = null;
  }

  /**
   * Get device fingerprint (lazy loaded)
   */
  async getFingerprint() {
    if (!this.deviceFingerprint) {
      this.deviceFingerprint = await getDeviceFingerprint();
    }
    return this.deviceFingerprint;
  }

  /**
   * Generate cache key with device fingerprint scope
   */
  async generateKey(type, id = null) {
    const fingerprint = await this.getFingerprint();
    return id
      ? `${this.prefix}${fingerprint}_${type}_${id}`
      : `${this.prefix}${fingerprint}_${type}`;
  }

  /**
   * Get cached data
   */
  async get(type, id = null) {
    try {
      const key = await this.generateKey(type, id);
      const cached = localStorage.getItem(key);

      if (!cached) {
        return null;
      }

      const parsed = JSON.parse(cached);
      console.log(`📦 Cache HIT: ${type}${id ? `/${id}` : ''} (${parsed.data?.length || 'N/A'} items)`);
      return parsed.data;
    } catch (e) {
      console.warn(`Cache read failed for ${type}:`, e.message);
      return null;
    }
  }

  /**
   * Set cached data
   */
  async set(type, data, id = null) {
    try {
      const key = await this.generateKey(type, id);
      const cacheEntry = {
        data,
        timestamp: Date.now(),
        deviceFingerprint: await this.getFingerprint()
      };

      localStorage.setItem(key, JSON.stringify(cacheEntry));
      console.log(`💾 Cache SET: ${type}${id ? `/${id}` : ''} (${data?.length || 'N/A'} items)`);
    } catch (e) {
      // localStorage can fail due to quota or private browsing - don't throw
      console.warn(`Cache write failed for ${type}:`, e.message);
    }
  }

  /**
   * Invalidate specific cache entry
   */
  async invalidate(type, id = null) {
    try {
      const key = await this.generateKey(type, id);
      localStorage.removeItem(key);
      console.log(`🗑️  Cache INVALIDATED: ${type}${id ? `/${id}` : ''}`);
    } catch (e) {
      console.warn(`Cache invalidation failed for ${type}:`, e.message);
    }
  }

  /**
   * Invalidate all message caches (when chat is deleted or messages change)
   */
  async invalidateAllMessages() {
    try {
      const fingerprint = await this.getFingerprint();
      const prefix = `${this.prefix}${fingerprint}_messages_`;

      // Find and remove all message cache keys for this device
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => localStorage.removeItem(key));
      console.log(`🗑️  Cache INVALIDATED: all messages (${keysToRemove.length} entries)`);
    } catch (e) {
      console.warn('Cache invalidation failed for messages:', e.message);
    }
  }

  /**
   * Clear all cache for current device
   */
  async clearAll() {
    try {
      const fingerprint = await this.getFingerprint();
      const devicePrefix = `${this.prefix}${fingerprint}_`;

      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(devicePrefix)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => localStorage.removeItem(key));
      console.log(`🗑️  Cache CLEARED: all entries (${keysToRemove.length} items)`);
    } catch (e) {
      console.warn('Cache clear failed:', e.message);
    }
  }
}

const cacheManager = new CacheManager();

/**
 * Unified API service that works in both Tauri desktop and web environments
 */
class ApiService {
  // ==================== INTERNAL METHODS ====================

  /**
   * Make an authenticated API call with automatic token refresh on 401
   */
  async makeAuthenticatedRequest(url, options = {}, retryCount = 0) {
    const maxRetries = 1;
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...(await authManager.getAuthHeaders()),
          ...options.headers
        }
      });

      // If we get a 401 and have a refresh token, try to refresh
      if (response.status === 401 && retryCount < maxRetries && authManager.refreshToken) {
        try {
          console.log('Access token expired, attempting refresh...');
          await authManager.refreshAccessToken();
          
          // Retry the original request with the new token
          return this.makeAuthenticatedRequest(url, options, retryCount + 1);
        } catch (refreshError) {
          console.warn('Token refresh failed:', refreshError.message);
          // Clear tokens since refresh failed
          authManager.clearTokens();
          throw new Error('Session expired. Please log in again.');
        }
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
   * Register a new user account
   */
  async register(email, password) {
    const deviceFingerprint = await getDeviceFingerprint();
    
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("auth_register", {
        email,
        password,
        deviceFingerprint
      });
    } else {
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: await authManager.getAuthHeaders(),
        body: JSON.stringify({ 
          email, 
          password, 
          device_fingerprint: deviceFingerprint 
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `Registration failed: ${response.status}`);
      }

      const result = await response.json();
      
      // Save tokens if successful
      if (result.success && result.access_token) {
        authManager.saveTokens(result.access_token, result.refresh_token);
      }
      
      return result;
    }
  }

  /**
   * Login with email and password
   */
  async login(email, password) {
    const deviceFingerprint = await getDeviceFingerprint();
    
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("auth_login", {
        email,
        password,
        deviceFingerprint
      });
    } else {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: await authManager.getAuthHeaders(),
        body: JSON.stringify({ 
          email, 
          password, 
          device_fingerprint: deviceFingerprint 
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `Login failed: ${response.status}`);
      }

      const result = await response.json();
      
      // Save tokens if successful
      if (result.success && result.access_token) {
        authManager.saveTokens(result.access_token, result.refresh_token);
      }
      
      return result;
    }
  }

  /**
   * Logout and clear tokens
   */
  async logout() {
    authManager.clearTokens();

    // Clear all cached data on logout
    await cacheManager.clearAll();

    return { success: true, message: 'Uspešno ste se odjavili' };
  }

  /**
   * Get user status (trial/premium info) - with localStorage caching
   * @param {Function} onFreshData - Optional callback when fresh data is fetched
   */
  async getUserStatus(onFreshData = null) {
    console.log('🔍 DEBUG: apiService.getUserStatus() called');

    // Try to get from cache first (instant load)
    const cached = await cacheManager.get('userStatus');
    if (cached) {
      console.log('⚡ Returning cached user status immediately');

      // Start background refresh (non-blocking)
      this._refreshUserStatusInBackground(onFreshData);

      return cached;
    }

    // No cache - fetch fresh data
    console.log('🌐 No cache - fetching fresh user status');
    return await this._fetchUserStatus(onFreshData);
  }

  /**
   * Internal: Fetch user status from server and update cache
   */
  async _fetchUserStatus(onFreshData = null) {
    try {
      let result;

      if (isDesktop) {
        const { invoke } = await import('@tauri-apps/api/core');
        result = await invoke("get_user_status");
      } else {
        const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/auth/user-status`, {
          method: 'GET'
        });

        console.log('🔍 DEBUG: getUserStatus response status:', response.status);
        if (!response.ok) {
          console.log('🔍 DEBUG: getUserStatus failed with status:', response.status);
          throw new Error(`Failed to get user status: ${response.status}`);
        }

        result = await response.json();
      }

      console.log('🔍 DEBUG: getUserStatus result:', result);

      // Update cache with fresh data
      await cacheManager.set('userStatus', result);

      // Notify caller if callback provided
      if (onFreshData) {
        onFreshData(result);
      }

      return result;
    } catch (error) {
      console.error('Failed to fetch user status:', error);
      throw error;
    }
  }

  /**
   * Internal: Refresh user status in background without blocking
   */
  async _refreshUserStatusInBackground(onFreshData = null) {
    console.log('🔄 Starting background refresh for user status');
    try {
      await this._fetchUserStatus(onFreshData);
      console.log('✅ Background refresh complete for user status');
    } catch (error) {
      console.warn('Background refresh failed for user status:', error.message);
      // Don't throw - this is a background operation
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
        headers: await authManager.getAuthHeaders(),
        body: JSON.stringify({ device_fingerprint: deviceFingerprint })
      });

      console.log('🔍 DEBUG: startTrial response status:', response.status);
      
      if (!response.ok) {
        let errorText = '';
        try {
          const responseText = await response.text();
          console.error('🔍 DEBUG: Error response text:', responseText);
          try {
            const errorJson = JSON.parse(responseText);
            errorText = errorJson.message || `Trial start failed: ${response.status}`;
          } catch (jsonError) {
            errorText = responseText || `Trial start failed: ${response.status}`;
          }
        } catch (readError) {
          errorText = `Trial start failed: ${response.status}`;
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
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("forgot_password", { email });
    } else {
      const response = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `Forgot password failed: ${response.status}`);
      }

      return await response.json();
    }
  }

  /**
   * Reset password with token
   */
  async resetPassword(token, newPassword) {
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("reset_password", { token, newPassword });
    } else {
      const response = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          token, 
          new_password: newPassword 
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `Reset password failed: ${response.status}`);
      }

      return await response.json();
    }
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return authManager.isAuthenticated();
  }

  /**
   * Get current access token
   */
  getAccessToken() {
    return authManager.accessToken;
  }

  // ==================== EXISTING METHODS WITH AUTH HEADERS ====================

  /**
   * Create a new chat
   */
  async createChat(title) {
    console.log('🔍 DEBUG: apiService.createChat() called with title:', title);

    let chatId;

    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      chatId = await invoke("create_chat", { title });
    } else {
      console.log('🔍 DEBUG: apiService.createChat() - making HTTP request');
      const response = await fetch(`${API_BASE_URL}/api/chats`, {
        method: 'POST',
        headers: await authManager.getAuthHeaders(),
        body: JSON.stringify({
          title,
          device_fingerprint: await getDeviceFingerprint()
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      console.log('🔍 DEBUG: apiService.createChat() - got result:', result);
      chatId = result.id;
    }

    // Invalidate chats cache since a new chat was created
    await cacheManager.invalidate('chats');

    return chatId;
  }

  /**
   * Get all chats (with localStorage caching)
   * @param {Function} onFreshData - Optional callback when fresh data is fetched
   */
  async getChats(onFreshData = null) {
    console.log('🔍 DEBUG: apiService.getChats() called');

    // Try to get from cache first (instant load)
    const cached = await cacheManager.get('chats');
    if (cached) {
      console.log('⚡ Returning cached chats immediately');

      // Start background refresh (non-blocking)
      this._refreshChatsInBackground(onFreshData);

      return cached;
    }

    // No cache - fetch fresh data
    console.log('🌐 No cache - fetching fresh chats');
    return await this._fetchChats(onFreshData);
  }

  /**
   * Internal: Fetch chats from server and update cache
   */
  async _fetchChats(onFreshData = null) {
    try {
      let result;

      if (isDesktop) {
        const { invoke } = await import('@tauri-apps/api/core');
        result = await invoke("get_chats");
      } else {
        const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/chats`, {
          method: 'GET'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        result = await response.json();
      }

      console.log('🔍 DEBUG: apiService._fetchChats() - got result:', result.length, 'chats');

      // Update cache with fresh data
      await cacheManager.set('chats', result);

      // Notify caller if callback provided
      if (onFreshData) {
        onFreshData(result);
      }

      return result;
    } catch (error) {
      console.error('Failed to fetch chats:', error);
      throw error;
    }
  }

  /**
   * Internal: Refresh chats in background without blocking
   */
  async _refreshChatsInBackground(onFreshData = null) {
    console.log('🔄 Starting background refresh for chats');
    try {
      await this._fetchChats(onFreshData);
      console.log('✅ Background refresh complete for chats');
    } catch (error) {
      console.warn('Background refresh failed for chats:', error.message);
      // Don't throw - this is a background operation
    }
  }

  /**
   * Get messages for a specific chat (with localStorage caching)
   * @param {number} chatId - Chat ID
   * @param {Function} onFreshData - Optional callback when fresh data is fetched
   */
  async getMessages(chatId, onFreshData = null) {
    // Try to get from cache first (instant load)
    const cached = await cacheManager.get('messages', chatId);
    if (cached) {
      console.log(`⚡ Returning cached messages for chat ${chatId} immediately`);

      // Start background refresh (non-blocking)
      this._refreshMessagesInBackground(chatId, onFreshData);

      return cached;
    }

    // No cache - fetch fresh data
    console.log(`🌐 No cache - fetching fresh messages for chat ${chatId}`);
    return await this._fetchMessages(chatId, onFreshData);
  }

  /**
   * Internal: Fetch messages from server and update cache
   */
  async _fetchMessages(chatId, onFreshData = null) {
    try {
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

      // Update cache with fresh data
      await cacheManager.set('messages', result, chatId);

      // Notify caller if callback provided
      if (onFreshData) {
        onFreshData(result);
      }

      return result;
    } catch (error) {
      console.error(`Failed to fetch messages for chat ${chatId}:`, error);
      throw error;
    }
  }

  /**
   * Internal: Refresh messages in background without blocking
   */
  async _refreshMessagesInBackground(chatId, onFreshData = null) {
    console.log(`🔄 Starting background refresh for messages (chat ${chatId})`);
    try {
      await this._fetchMessages(chatId, onFreshData);
      console.log(`✅ Background refresh complete for messages (chat ${chatId})`);
    } catch (error) {
      console.warn(`Background refresh failed for messages (chat ${chatId}):`, error.message);
      // Don't throw - this is a background operation
    }
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
      await invoke("delete_chat", { chatId });
    } else {
      const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/chats/${chatId}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }

    // Invalidate caches since chat was deleted
    await cacheManager.invalidate('chats');
    await cacheManager.invalidate('messages', chatId);
  }

  async updateChatTitle(chatId, title) {
    let result;

    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      result = await invoke("update_chat_title", { chatId, title });
    } else {
      const response = await this.makeAuthenticatedRequest(`${API_BASE_URL}/api/chats/${chatId}/title`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      result = await response.json();
    }

    // Invalidate chats cache since title was updated
    await cacheManager.invalidate('chats');

    return result;
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
    const result = await response.json();

    // Invalidate caches since new messages were added
    // - Messages cache for this specific chat
    // - Chats cache (updated_at timestamp changed)
    // - User status (messages_remaining count changed)
    await cacheManager.invalidate('messages', questionRequest.chat_id);
    await cacheManager.invalidate('chats');
    await cacheManager.invalidate('userStatus');

    return result;
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
    
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("upgrade_plan", {
        planId,
        planData,
        deviceFingerprint
      });
    } else {
      // Placeholder implementation until backend endpoints are ready
      // TODO: Replace with actual API call when backend is implemented
      return new Promise((resolve) => {
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

      return await response.json();
      */
    }
  }

  /**
   * Cancel user subscription
   */
  async cancelSubscription() {
    const deviceFingerprint = await getDeviceFingerprint();
    
    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("cancel_subscription", { deviceFingerprint });
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

      return await response.json();
    }
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

    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("change_billing_period", { newPeriod, deviceFingerprint });
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

      return await response.json();
    }
  }

  /**
   * Change subscription plan (individual/professional/team)
   */
  async changePlan(newPlanId, billingPeriod = 'monthly') {
    const deviceFingerprint = await getDeviceFingerprint();

    if (isDesktop) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke("change_plan", {
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

      return await response.json();
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