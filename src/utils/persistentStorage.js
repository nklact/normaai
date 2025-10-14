/**
 * Persistent Storage Abstraction Layer
 *
 * Automatically uses the appropriate storage based on environment:
 * - Tauri (desktop, iOS, Android): tauri-plugin-store (survives app updates)
 * - Web browsers: localStorage (standard web storage)
 */

const isTauri = typeof window !== 'undefined' && window.__TAURI__;
let store = null;

/**
 * Initialize the storage backend
 */
async function initializeStore() {
  if (isTauri && !store) {
    try {
      const { Store } = await import('@tauri-apps/plugin-store');
      store = await Store.load('store.json');
    } catch (error) {
      console.warn('Failed to initialize Tauri store, falling back to localStorage:', error);
      store = null; // Will use localStorage as fallback
    }
  }
}

/**
 * Get a value from persistent storage
 * @param {string} key - The key to retrieve
 * @returns {Promise<string|null>} The stored value or null if not found
 */
export async function getItem(key) {
  if (isTauri) {
    await initializeStore();
    if (store) {
      try {
        const value = await store.get(key);
        return value !== undefined && value !== null ? String(value) : null;
      } catch (error) {
        console.warn(`Failed to get ${key} from Tauri store:`, error);
        // Fallback to localStorage
      }
    }
  }

  // Web or fallback
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn(`Failed to get ${key} from localStorage:`, error);
    return null;
  }
}

/**
 * Set a value in persistent storage
 * @param {string} key - The key to store
 * @param {string} value - The value to store
 * @returns {Promise<void>}
 */
export async function setItem(key, value) {
  if (isTauri) {
    await initializeStore();
    if (store) {
      try {
        await store.set(key, value);
        await store.save(); // Persist to disk immediately
        return;
      } catch (error) {
        console.warn(`Failed to set ${key} in Tauri store:`, error);
        // Fallback to localStorage
      }
    }
  }

  // Web or fallback
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`Failed to set ${key} in localStorage:`, error);
  }
}

/**
 * Remove a value from persistent storage
 * @param {string} key - The key to remove
 * @returns {Promise<void>}
 */
export async function removeItem(key) {
  if (isTauri) {
    await initializeStore();
    if (store) {
      try {
        await store.delete(key);
        await store.save(); // Persist to disk immediately
        return;
      } catch (error) {
        console.warn(`Failed to remove ${key} from Tauri store:`, error);
        // Fallback to localStorage
      }
    }
  }

  // Web or fallback
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn(`Failed to remove ${key} from localStorage:`, error);
  }
}

/**
 * Clear all values from persistent storage (use with caution)
 * @returns {Promise<void>}
 */
export async function clear() {
  if (isTauri) {
    await initializeStore();
    if (store) {
      try {
        await store.clear();
        await store.save();
        return;
      } catch (error) {
        console.warn('Failed to clear Tauri store:', error);
        // Fallback to localStorage
      }
    }
  }

  // Web or fallback
  try {
    localStorage.clear();
  } catch (error) {
    console.warn('Failed to clear localStorage:', error);
  }
}
