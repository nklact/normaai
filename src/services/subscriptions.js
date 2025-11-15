/**
 * Subscription Management Service
 *
 * Handles in-app purchases for iOS and Android using Tauri IAP plugin
 * For web/desktop, this will eventually integrate with Stripe
 */

import { getProductId, getAllProductIds, parseProductId } from '../config/products.js';

// Platform detection
const isTauriApp = Boolean(window.__TAURI__);
const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const isMobile = isTauriApp && isMobileDevice;

// Lazy-loaded IAP plugin (loaded on first use)
let iapPlugin = null;
let iapPluginPromise = null;

/**
 * Lazy load the IAP plugin (only on mobile)
 * @returns {Promise<Object|null>} The IAP plugin or null if not available
 */
async function getIAPPlugin() {
  if (!isMobile) {
    return null;
  }

  if (iapPlugin) {
    return iapPlugin;
  }

  if (!iapPluginPromise) {
    iapPluginPromise = (async () => {
      try {
        const plugin = await import('@choochmeque/tauri-plugin-iap-api');
        console.log('✅ IAP plugin loaded');
        iapPlugin = plugin;
        return plugin;
      } catch (error) {
        console.error('❌ Failed to load IAP plugin:', error);
        return null;
      }
    })();
  }

  return iapPluginPromise;
}

/**
 * Initialize the IAP system
 * This should be called once during app startup
 */
export async function initializeIAP() {
  const plugin = await getIAPPlugin();

  if (!plugin) {
    console.log('IAP not available on this platform');
    return { success: false, platform: 'web/desktop' };
  }

  try {
    // Initialize the plugin (if needed by the specific plugin implementation)
    console.log('Initializing IAP...');
    return { success: true, platform: isMobile ? 'mobile' : 'web' };
  } catch (error) {
    console.error('Failed to initialize IAP:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get available products from the store
 * @returns {Promise<Array>} Array of product objects with pricing info
 */
export async function getAvailableProducts() {
  const plugin = await getIAPPlugin();

  if (!plugin) {
    console.warn('IAP not available - returning empty product list');
    return [];
  }

  try {
    const productIds = getAllProductIds();
    console.log('Fetching products:', productIds);

    const response = await plugin.getProducts(productIds, 'subs');
    console.log('Products fetched:', response);

    return response.products.map(product => ({
      id: product.productId,
      title: product.title,
      description: product.description,
      priceString: product.formattedPrice,
      currencyCode: product.priceCurrencyCode,
      priceAmountMicros: product.priceAmountMicros,
      ...parseProductId(product.productId), // Add planType and billingPeriod
    }));
  } catch (error) {
    console.error('Failed to fetch products:', error);
    throw new Error(`Failed to fetch products: ${error.message}`);
  }
}

/**
 * Purchase a subscription
 * @param {string} planType - 'individual', 'professional', or 'team'
 * @param {string} billingPeriod - 'monthly' or 'yearly'
 * @param {string} userId - User's Supabase UUID (for RevenueCat)
 * @returns {Promise<Object>} Purchase result
 */
export async function purchaseSubscription(planType, billingPeriod, userId) {
  const plugin = await getIAPPlugin();

  if (!plugin) {
    throw new Error('In-app purchases are only available on iOS and Android apps');
  }

  const productId = getProductId(planType, billingPeriod);
  if (!productId) {
    throw new Error(`Invalid plan: ${planType} ${billingPeriod}`);
  }

  try {
    console.log(`Purchasing ${productId} for user ${userId}`);

    // Initiate purchase flow with app account token (iOS) or obfuscated account ID (Android)
    const options = {
      appAccountToken: userId, // iOS - links purchase to user account
      obfuscatedAccountId: userId, // Android - links purchase to user account
    };

    const purchase = await plugin.purchase(productId, 'subs', options);

    console.log('Purchase successful:', purchase);

    // The purchase object contains transaction info
    return {
      success: true,
      productId: purchase.productId,
      transactionId: purchase.orderId,
      purchaseToken: purchase.purchaseToken,
      purchaseTime: purchase.purchaseTime,
      platform: getPlatform(),
    };
  } catch (error) {
    console.error('Purchase failed:', error);

    // Handle user cancellation vs actual errors
    if (error.message?.includes('cancel') || error.message?.includes('cancelled')) {
      return {
        success: false,
        cancelled: true,
        message: 'Purchase cancelled by user',
      };
    }

    throw new Error(`Purchase failed: ${error.message}`);
  }
}

/**
 * Restore previous purchases (required by Apple)
 * This is important for users who:
 * - Reinstalled the app
 * - Switched devices
 * - Lost their purchase data
 *
 * @returns {Promise<Array>} Array of restored purchases
 */
export async function restorePurchases() {
  const plugin = await getIAPPlugin();

  if (!plugin) {
    throw new Error('Restore purchases is only available on iOS and Android apps');
  }

  try {
    console.log('Restoring purchases...');

    const response = await plugin.restorePurchases('subs');
    console.log('Purchases restored:', response);

    return response.purchases.map(purchase => ({
      productId: purchase.productId,
      transactionId: purchase.orderId,
      purchaseToken: purchase.purchaseToken,
      purchaseTime: purchase.purchaseTime,
      ...parseProductId(purchase.productId),
    }));
  } catch (error) {
    console.error('Failed to restore purchases:', error);
    throw new Error(`Failed to restore purchases: ${error.message}`);
  }
}

/**
 * Get active purchases
 * @returns {Promise<Array>} Array of active purchases
 */
export async function getActivePurchases() {
  const plugin = await getIAPPlugin();

  if (!plugin) {
    return [];
  }

  try {
    const response = await plugin.getPurchaseHistory();
    return response.history;
  } catch (error) {
    console.error('Failed to get purchases:', error);
    return [];
  }
}

/**
 * Finish a transaction (acknowledge it)
 * Required by Google Play after purchase
 * @param {string} purchaseToken - Purchase token to acknowledge
 */
export async function finishTransaction(purchaseToken) {
  const plugin = await getIAPPlugin();

  if (!plugin) {
    return;
  }

  try {
    await plugin.acknowledgePurchase(purchaseToken);
    console.log('Transaction acknowledged:', purchaseToken);
  } catch (error) {
    console.error('Failed to acknowledge purchase:', error);
  }
}

/**
 * Get current platform
 * @returns {string} 'ios', 'android', 'web', or 'desktop'
 */
export function getPlatform() {
  if (!isTauriApp) return 'web';
  if (isMobileDevice) {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ? 'ios' : 'android';
  }
  return 'desktop';
}

/**
 * Check if IAP is supported on current platform
 * @returns {boolean}
 */
export function isIAPSupported() {
  return isMobile;
}

/**
 * Purchase flow with backend validation
 * This is the complete flow that should be used in the UI
 *
 * @param {string} planType - 'individual', 'professional', or 'team'
 * @param {string} billingPeriod - 'monthly' or 'yearly'
 * @param {string} userId - User's Supabase UUID
 * @param {Function} apiClient - API client instance with validatePurchase method
 * @returns {Promise<Object>} Result with subscription status
 */
export async function completePurchaseFlow(planType, billingPeriod, userId, apiClient) {
  try {
    // Step 1: Purchase from store
    const purchaseResult = await purchaseSubscription(planType, billingPeriod, userId);

    if (!purchaseResult.success) {
      return purchaseResult; // Cancelled or failed
    }

    // Step 2: Link purchase to user in RevenueCat
    try {
      await apiClient.linkPurchase(purchaseResult.purchaseToken, false);

      // Step 3: Finish transaction (acknowledge it)
      await finishTransaction(purchaseResult.purchaseToken);

      return {
        success: true,
        message: 'Subscription activated successfully',
      };
    } catch (linkError) {
      console.error('Failed to link purchase:', linkError);

      // Even if linking fails, acknowledge the transaction
      await finishTransaction(purchaseResult.purchaseToken);

      // Webhook should eventually sync it
      return {
        success: true,
        pendingValidation: true,
        message: 'Purchase successful. Your subscription will be activated shortly.',
      };
    }
  } catch (error) {
    console.error('Purchase flow failed:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Restore purchases flow with backend sync
 * @param {string} userId - User's Supabase UUID
 * @param {Function} apiClient - API client instance
 * @returns {Promise<Object>} Result with restored subscriptions
 */
export async function completeRestoreFlow(userId, apiClient) {
  try {
    const restored = await restorePurchases();

    if (restored.length === 0) {
      return {
        success: true,
        message: 'No purchases found to restore',
        count: 0,
      };
    }

    // Link restored purchases to user in RevenueCat
    for (const purchase of restored) {
      try {
        await apiClient.linkPurchase(purchase.purchaseToken, true);
      } catch (error) {
        console.error('Failed to link restored purchase:', error);
        // Continue with other purchases
      }
    }

    return {
      success: true,
      message: `Restored ${restored.length} purchase(s)`,
      count: restored.length,
      purchases: restored,
    };
  } catch (error) {
    console.error('Restore flow failed:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}
