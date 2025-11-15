/**
 * Product IDs for In-App Purchases
 *
 * These IDs must match exactly with the products configured in:
 * - Apple App Store Connect (for iOS)
 * - Google Play Console (for Android)
 * - RevenueCat Dashboard (for all platforms)
 */

export const PRODUCT_IDS = {
  // Individual Plan
  INDIVIDUAL_MONTHLY: 'com.nikola.normaai.individual.monthly',
  INDIVIDUAL_YEARLY: 'com.nikola.normaai.individual.yearly',

  // Professional Plan
  PROFESSIONAL_MONTHLY: 'com.nikola.normaai.professional.monthly',
  PROFESSIONAL_YEARLY: 'com.nikola.normaai.professional.yearly',

  // Team Plan
  TEAM_MONTHLY: 'com.nikola.normaai.team.monthly',
  TEAM_YEARLY: 'com.nikola.normaai.team.yearly',
};

/**
 * Map plan type and billing period to product ID
 * @param {string} planType - 'individual', 'professional', or 'team'
 * @param {string} billingPeriod - 'monthly' or 'yearly'
 * @returns {string|null} Product ID or null if not found
 */
export function getProductId(planType, billingPeriod) {
  const key = `${planType.toUpperCase()}_${billingPeriod.toUpperCase()}`;
  return PRODUCT_IDS[key] || null;
}

/**
 * Parse product ID to get plan type and billing period
 * @param {string} productId - Product ID from store
 * @returns {{planType: string, billingPeriod: string}|null}
 */
export function parseProductId(productId) {
  // Format: com.nikola.normaai.{planType}.{billingPeriod}
  const match = productId.match(/com\.nikola\.normaai\.(\w+)\.(\w+)/);
  if (!match) return null;

  return {
    planType: match[1], // individual, professional, or team
    billingPeriod: match[2], // monthly or yearly
  };
}

/**
 * Get all product IDs as an array (for querying store)
 * @returns {string[]}
 */
export function getAllProductIds() {
  return Object.values(PRODUCT_IDS);
}

/**
 * RevenueCat Entitlement IDs
 * These map to the features users get access to
 */
export const ENTITLEMENTS = {
  INDIVIDUAL: 'individual',
  PROFESSIONAL: 'professional',
  TEAM: 'team',
};

/**
 * Get entitlement ID for a plan type
 * @param {string} planType - 'individual', 'professional', or 'team'
 * @returns {string|null}
 */
export function getEntitlementId(planType) {
  const key = planType.toUpperCase();
  return ENTITLEMENTS[key] || null;
}
