// IAPBridge.swift
// iOS StoreKit 2 Bridge for Norma AI
// This file needs to be added to your iOS Xcode project

import Foundation
import StoreKit

@available(iOS 15.0, *)
@objc public class IAPBridge: NSObject {
    static let shared = IAPBridge()
    private var products: [Product] = []
    private var transactionTask: Task<Void, Error>?
    private var isInitialized = false

    private override init() {
        super.init()
    }

    // Initialize StoreKit and start listening for transactions
    @objc public func initialize() -> Bool {
        guard !isInitialized else { return true }

        // Start observing transaction updates
        transactionTask = Task {
            for await result in Transaction.updates {
                await self.handleTransaction(result)
            }
        }

        isInitialized = true
        print("✅ iOS IAP Bridge initialized")
        return true
    }

    // Get products from App Store
    public func getProducts(_ productIds: [String]) async throws -> [[String: Any]] {
        print("📦 Fetching products: \(productIds)")

        do {
            let storeProducts = try await Product.products(for: productIds)
            self.products = storeProducts

            let productsData = storeProducts.map { product -> [String: Any] in
                return [
                    "id": product.id,
                    "title": product.displayName,
                    "description": product.description,
                    "price": product.displayPrice,
                    "currency": product.priceFormatStyle.currencyCode ?? "USD"
                ]
            }

            print("✅ Fetched \(productsData.count) products")
            return productsData

        } catch {
            print("❌ Failed to fetch products: \(error)")
            throw error
        }
    }

    // Purchase a product
    public func purchase(_ productId: String) async throws -> [String: Any] {
        print("🛒 Attempting to purchase: \(productId)")

        guard let product = products.first(where: { $0.id == productId }) else {
            print("❌ Product not found: \(productId)")
            throw IAPError.productNotFound
        }

        do {
            let result = try await product.purchase()

            switch result {
            case .success(let verification):
                let transaction = try checkVerified(verification)

                // Finish the transaction
                await transaction.finish()

                // Get receipt data
                guard let appStoreReceiptURL = Bundle.main.appStoreReceiptURL,
                      FileManager.default.fileExists(atPath: appStoreReceiptURL.path) else {
                    print("❌ No receipt file found")
                    throw IAPError.noReceipt
                }

                let receiptData = try Data(contentsOf: appStoreReceiptURL)
                let receiptString = receiptData.base64EncodedString()

                let purchaseData: [String: Any] = [
                    "product_id": productId,
                    "transaction_id": String(transaction.id),
                    "receipt_data": receiptString
                ]

                print("✅ Purchase successful: \(transaction.id)")
                return purchaseData

            case .userCancelled:
                print("🚫 Purchase cancelled by user")
                throw IAPError.userCancelled

            case .pending:
                print("⏳ Purchase pending approval")
                throw IAPError.purchasePending

            @unknown default:
                print("❌ Unknown purchase result")
                throw IAPError.unknown
            }

        } catch {
            print("❌ Purchase failed: \(error)")
            throw error
        }
    }

    // Restore purchases (required by Apple)
    public func restorePurchases() async throws -> [[String: Any]] {
        print("🔄 Restoring purchases...")

        // Sync with App Store
        try await AppStore.sync()

        var restoredPurchases: [[String: Any]] = []

        // Get all current entitlements
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result {
                // Get receipt data
                guard let appStoreReceiptURL = Bundle.main.appStoreReceiptURL,
                      FileManager.default.fileExists(atPath: appStoreReceiptURL.path) else {
                    continue
                }

                do {
                    let receiptData = try Data(contentsOf: appStoreReceiptURL)
                    let receiptString = receiptData.base64EncodedString()

                    let purchaseData: [String: Any] = [
                        "product_id": transaction.productID,
                        "transaction_id": String(transaction.id),
                        "receipt_data": receiptString
                    ]

                    restoredPurchases.append(purchaseData)
                } catch {
                    print("⚠️ Failed to read receipt for \(transaction.productID)")
                }
            }
        }

        print("✅ Restored \(restoredPurchases.count) purchases")
        return restoredPurchases
    }

    // Handle transaction updates (renewals, expirations, etc.)
    private func handleTransaction(_ result: VerificationResult<Transaction>) async {
        print("🔔 Transaction update received")

        if case .verified(let transaction) = result {
            print("✅ Transaction verified: \(transaction.productID)")
            await transaction.finish()
        } else {
            print("❌ Transaction failed verification")
        }
    }

    // Verify transaction is legitimate
    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified:
            print("❌ Transaction verification failed")
            throw IAPError.verificationFailed
        case .verified(let safe):
            return safe
        }
    }

    deinit {
        transactionTask?.cancel()
    }
}

// IAP Error types
@objc public enum IAPError: Int, Error {
    case productNotFound = 1
    case noReceipt = 2
    case userCancelled = 3
    case purchasePending = 4
    case verificationFailed = 5
    case unknown = 99

    public var localizedDescription: String {
        switch self {
        case .productNotFound:
            return "Product not found"
        case .noReceipt:
            return "No receipt available"
        case .userCancelled:
            return "User cancelled the purchase"
        case .purchasePending:
            return "Purchase is pending approval"
        case .verificationFailed:
            return "Transaction verification failed"
        case .unknown:
            return "Unknown error occurred"
        }
    }
}