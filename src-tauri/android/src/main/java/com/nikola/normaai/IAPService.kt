// IAPService.kt
// Android Play Billing Bridge for Norma AI
// This file needs to be added to your Android project at:
// src-tauri/gen/android/app/src/main/java/com/nikola/normaai/IAPService.kt

package com.nikola.normaai

import android.app.Activity
import com.android.billingclient.api.*
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject

class IAPService(private val activity: Activity) {
    private lateinit var billingClient: BillingClient
    private val productDetailsMap = mutableMapOf<String, ProductDetails>()
    private var isInitialized = false

    // Callback for purchase updates
    private var purchaseCallback: ((String) -> Unit)? = null

    private val purchasesUpdatedListener = PurchasesUpdatedListener { billingResult, purchases ->
        when (billingResult.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                purchases?.forEach { purchase ->
                    handlePurchase(purchase)
                }
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> {
                val errorJson = JSONObject().apply {
                    put("error", "user_cancelled")
                }
                purchaseCallback?.invoke(errorJson.toString())
            }
            else -> {
                val errorJson = JSONObject().apply {
                    put("error", "purchase_failed")
                    put("code", billingResult.responseCode)
                }
                purchaseCallback?.invoke(errorJson.toString())
            }
        }
    }

    fun initialize(callback: (Boolean) -> Unit) {
        if (isInitialized) {
            callback(true)
            return
        }

        println("🔧 Initializing Google Play Billing...")

        billingClient = BillingClient.newBuilder(activity)
            .setListener(purchasesUpdatedListener)
            .enablePendingPurchases()
            .build()

        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(billingResult: BillingResult) {
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    println("✅ Google Play Billing initialized")
                    isInitialized = true
                    callback(true)
                } else {
                    println("❌ Billing initialization failed: ${billingResult.responseCode}")
                    callback(false)
                }
            }

            override fun onBillingServiceDisconnected() {
                println("⚠️ Billing service disconnected, will retry...")
                isInitialized = false
                // Retry connection
            }
        })
    }

    suspend fun getProducts(productIds: List<String>): String = withContext(Dispatchers.IO) {
        println("📦 Fetching products: $productIds")

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                productIds.map { productId ->
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build()
                }
            )
            .build()

        return@withContext suspendCancellableCoroutine { continuation ->
            billingClient.queryProductDetailsAsync(params) { billingResult, productDetailsList ->
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    // Store product details for later use
                    productDetailsList.forEach { product ->
                        productDetailsMap[product.productId] = product
                    }

                    // Convert to JSON
                    val productsArray = JSONArray()
                    productDetailsList.forEach { product ->
                        val subscriptionOffer = product.subscriptionOfferDetails?.firstOrNull()
                        val pricingPhase = subscriptionOffer?.pricingPhases?.pricingPhaseList?.firstOrNull()

                        val productJson = JSONObject().apply {
                            put("id", product.productId)
                            put("title", product.title)
                            put("description", product.description)
                            put("price", pricingPhase?.formattedPrice ?: "N/A")
                            put("currency", pricingPhase?.priceCurrencyCode ?: "USD")
                        }
                        productsArray.put(productJson)
                    }

                    println("✅ Fetched ${productsArray.length()} products")
                    continuation.resume(productsArray.toString())
                } else {
                    println("❌ Failed to fetch products: ${billingResult.responseCode}")
                    continuation.resume("[]")
                }
            }
        }
    }

    fun purchase(productId: String, callback: (String) -> Unit) {
        println("🛒 Attempting to purchase: $productId")

        val productDetails = productDetailsMap[productId]
        if (productDetails == null) {
            val errorJson = JSONObject().apply {
                put("error", "product_not_found")
            }
            callback(errorJson.toString())
            return
        }

        // Get the offer token (required for subscriptions)
        val offerToken = productDetails.subscriptionOfferDetails?.firstOrNull()?.offerToken
        if (offerToken == null) {
            val errorJson = JSONObject().apply {
                put("error", "no_offer_available")
            }
            callback(errorJson.toString())
            return
        }

        // Set callback for purchase result
        purchaseCallback = callback

        // Build the purchase params
        val productDetailsParamsList = listOf(
            BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(productDetails)
                .setOfferToken(offerToken)
                .build()
        )

        val billingFlowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(productDetailsParamsList)
            .build()

        // Launch the billing flow
        billingClient.launchBillingFlow(activity, billingFlowParams)
    }

    private fun handlePurchase(purchase: Purchase) {
        println("✅ Purchase received: ${purchase.products}")

        // Acknowledge the purchase if it hasn't been acknowledged yet
        if (!purchase.isAcknowledged) {
            val acknowledgePurchaseParams = AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(purchase.purchaseToken)
                .build()

            billingClient.acknowledgePurchase(acknowledgePurchaseParams) { billingResult ->
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    println("✅ Purchase acknowledged")
                }
            }
        }

        // Build purchase result JSON
        val purchaseJson = JSONObject().apply {
            put("product_id", purchase.products.first())
            put("transaction_id", purchase.orderId ?: "")
            put("receipt_data", purchase.purchaseToken)
        }

        purchaseCallback?.invoke(purchaseJson.toString())
        purchaseCallback = null
    }

    suspend fun restorePurchases(): String = withContext(Dispatchers.IO) {
        println("🔄 Restoring purchases...")

        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.SUBS)
            .build()

        return@withContext suspendCancellableCoroutine { continuation ->
            billingClient.queryPurchasesAsync(params) { billingResult, purchasesList ->
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    val purchasesArray = JSONArray()

                    purchasesList.forEach { purchase ->
                        // Only include active purchases
                        if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) {
                            val purchaseJson = JSONObject().apply {
                                put("product_id", purchase.products.first())
                                put("transaction_id", purchase.orderId ?: "")
                                put("receipt_data", purchase.purchaseToken)
                            }
                            purchasesArray.put(purchaseJson)

                            // Acknowledge if needed
                            if (!purchase.isAcknowledged) {
                                val acknowledgePurchaseParams = AcknowledgePurchaseParams.newBuilder()
                                    .setPurchaseToken(purchase.purchaseToken)
                                    .build()

                                billingClient.acknowledgePurchase(acknowledgePurchaseParams) { }
                            }
                        }
                    }

                    println("✅ Restored ${purchasesArray.length()} purchases")
                    continuation.resume(purchasesArray.toString())
                } else {
                    println("❌ Failed to restore purchases: ${billingResult.responseCode}")
                    continuation.resume("[]")
                }
            }
        }
    }
}

// Companion object to hold singleton instance
object IAPManager {
    private var instance: IAPService? = null

    fun getInstance(activity: Activity): IAPService {
        if (instance == null) {
            instance = IAPService(activity)
        }
        return instance!!
    }
}