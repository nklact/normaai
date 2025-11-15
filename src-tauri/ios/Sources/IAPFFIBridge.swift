// IAPFFIBridge.swift
// C FFI Bridge between Swift and Rust
// This file exports C functions that can be called from Rust

import Foundation

// Helper to convert Swift string to C string (caller must free)
private func stringToCString(_ string: String) -> UnsafeMutablePointer<CChar> {
    let count = string.utf8.count + 1
    let result = UnsafeMutablePointer<CChar>.allocate(capacity: count)
    string.withCString { baseAddress in
        result.initialize(from: baseAddress, count: count)
    }
    return result
}

// Helper to convert JSON data to C string
private func jsonToCString<T: Encodable>(_ data: T) -> UnsafeMutablePointer<CChar>? {
    guard let jsonData = try? JSONEncoder().encode(data),
          let jsonString = String(data: jsonData, encoding: .utf8) else {
        return nil
    }
    return stringToCString(jsonString)
}

// Initialize IAP
@_cdecl("ios_iap_initialize")
public func ios_iap_initialize() -> Bool {
    return IAPBridge.shared.initialize()
}

// Get products (async operation wrapped in sync function)
@_cdecl("ios_iap_get_products_json")
public func ios_iap_get_products_json(_ productIdsJson: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
    let jsonString = String(cString: productIdsJson)

    guard let jsonData = jsonString.data(using: .utf8),
          let productIds = try? JSONDecoder().decode([String].self, from: jsonData) else {
        print("❌ Failed to decode product IDs JSON")
        return nil
    }

    // Use DispatchSemaphore to make async code synchronous for FFI
    let semaphore = DispatchSemaphore(value: 0)
    var result: UnsafeMutablePointer<CChar>? = nil

    Task {
        do {
            let products = try await IAPBridge.shared.getProducts(productIds)
            result = jsonToCString(products)
        } catch {
            print("❌ Error getting products: \(error)")
            result = nil
        }
        semaphore.signal()
    }

    semaphore.wait()
    return result
}

// Purchase a product (async operation wrapped in sync function)
@_cdecl("ios_iap_purchase_product")
public func ios_iap_purchase_product(_ productId: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
    let productIdString = String(cString: productId)

    let semaphore = DispatchSemaphore(value: 0)
    var result: UnsafeMutablePointer<CChar>? = nil

    Task {
        do {
            let purchaseData = try await IAPBridge.shared.purchase(productIdString)
            result = jsonToCString(purchaseData)
        } catch IAPError.userCancelled {
            // Return error JSON for user cancellation
            let errorData: [String: Any] = ["error": "user_cancelled"]
            if let jsonData = try? JSONSerialization.data(withJSONObject: errorData),
               let jsonString = String(data: jsonData, encoding: .utf8) {
                result = stringToCString(jsonString)
            }
        } catch {
            print("❌ Error purchasing: \(error)")
            let errorData: [String: Any] = ["error": error.localizedDescription]
            if let jsonData = try? JSONSerialization.data(withJSONObject: errorData),
               let jsonString = String(data: jsonData, encoding: .utf8) {
                result = stringToCString(jsonString)
            }
        }
        semaphore.signal()
    }

    semaphore.wait()
    return result
}

// Restore purchases (async operation wrapped in sync function)
@_cdecl("ios_iap_restore_purchases")
public func ios_iap_restore_purchases() -> UnsafeMutablePointer<CChar>? {
    let semaphore = DispatchSemaphore(value: 0)
    var result: UnsafeMutablePointer<CChar>? = nil

    Task {
        do {
            let purchases = try await IAPBridge.shared.restorePurchases()
            result = jsonToCString(purchases)
        } catch {
            print("❌ Error restoring purchases: \(error)")
            result = jsonToCString([[String: Any]]())
        }
        semaphore.signal()
    }

    semaphore.wait()
    return result
}

// Free a C string allocated by Swift
@_cdecl("ios_free_string")
public func ios_free_string(_ ptr: UnsafeMutablePointer<CChar>?) {
    ptr?.deallocate()
}