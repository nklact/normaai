/**
 * Simple IAP Service
 * Replaces the buggy tauri-plugin-iap with a minimal implementation
 * that works with iOS 18 and Tauri 2.9.3
 */

import { invoke } from '@tauri-apps/api/core';

class SimpleIAPService {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize the IAP system
   */
  async initialize() {
    if (this.initialized) {
      return true;
    }

    try {
      const result = await invoke('iap_init');
      this.initialized = result;
      return result;
    } catch (error) {
      console.error('Failed to initialize IAP:', error);
      throw error;
    }
  }

  /**
   * Get products from the app store
   * @param {string[]} productIds - Array of product IDs to fetch
   * @returns {Promise<Array>} Array of product objects
   */
  async getProducts(productIds) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const products = await invoke('iap_get_products', { productIds });
      return products;
    } catch (error) {
      console.error('Failed to get products:', error);
      throw error;
    }
  }

  /**
   * Purchase a product
   * @param {string} productId - Product ID to purchase
   * @returns {Promise<Object>} Purchase result with transaction details
   */
  async purchase(productId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const purchase = await invoke('iap_purchase', { productId });
      return purchase;
    } catch (error) {
      console.error('Purchase failed:', error);
      throw error;
    }
  }

  /**
   * Restore previous purchases
   * @returns {Promise<Array>} Array of restored purchases
   */
  async restorePurchases() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const purchases = await invoke('iap_restore');
      return purchases;
    } catch (error) {
      console.error('Failed to restore purchases:', error);
      throw error;
    }
  }
}

// Export singleton instance
export default new SimpleIAPService();