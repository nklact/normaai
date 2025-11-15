// Minimal IAP Implementation for Tauri
// iOS: Uses FFI bridge to Swift StoreKit 2
// Android: JavaScript calls Kotlin IAPService directly via Tauri mobile bridge

use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SimplePurchase {
    pub product_id: String,
    pub transaction_id: Option<String>,
    pub receipt_data: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SimpleProduct {
    pub id: String,
    pub price: String,
    pub currency: String,
    pub title: String,
    pub description: String,
}

// Initialize the IAP system (iOS StoreKit / Android Play Billing)
#[command]
pub async fn iap_init() -> Result<bool, String> {
    #[cfg(target_os = "ios")]
    {
        ios_init().await
    }

    #[cfg(target_os = "android")]
    {
        android_init().await
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        Err("IAP is only available on mobile platforms".to_string())
    }
}

// Get products from the store
#[command]
pub async fn iap_get_products(product_ids: Vec<String>) -> Result<Vec<SimpleProduct>, String> {
    #[cfg(target_os = "ios")]
    {
        ios_get_products(product_ids).await
    }

    #[cfg(target_os = "android")]
    {
        android_get_products(product_ids).await
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        Err("IAP is only available on mobile platforms".to_string())
    }
}

// Purchase a product
#[command]
pub async fn iap_purchase(product_id: String) -> Result<SimplePurchase, String> {
    #[cfg(target_os = "ios")]
    {
        ios_purchase(product_id).await
    }

    #[cfg(target_os = "android")]
    {
        android_purchase(product_id).await
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        Err("IAP is only available on mobile platforms".to_string())
    }
}

// Restore purchases
#[command]
pub async fn iap_restore() -> Result<Vec<SimplePurchase>, String> {
    #[cfg(target_os = "ios")]
    {
        ios_restore_purchases().await
    }

    #[cfg(target_os = "android")]
    {
        android_restore_purchases().await
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        Err("IAP is only available on mobile platforms".to_string())
    }
}

// ============================================================================
// iOS StoreKit 2 Implementation
// ============================================================================

#[cfg(target_os = "ios")]
mod ios_ffi {
    use std::ffi::{CStr, CString};
    use std::os::raw::c_char;
    use std::sync::{Arc, Mutex};
    use std::collections::HashMap;

    // Storage for FFI callbacks
    lazy_static::lazy_static! {
        static ref CALLBACKS: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));
    }

    extern "C" {
        // These functions will be implemented in Swift
        fn ios_iap_initialize() -> bool;
        fn ios_iap_get_products_json(product_ids_json: *const c_char) -> *mut c_char;
        fn ios_iap_purchase_product(product_id: *const c_char) -> *mut c_char;
        fn ios_iap_restore_purchases() -> *mut c_char;
        fn ios_free_string(ptr: *mut c_char);
    }

    pub fn initialize() -> bool {
        unsafe { ios_iap_initialize() }
    }

    pub fn get_products(product_ids: Vec<String>) -> Result<String, String> {
        let json = serde_json::to_string(&product_ids)
            .map_err(|e| format!("Failed to serialize product IDs: {}", e))?;

        let c_json = CString::new(json)
            .map_err(|e| format!("Failed to create CString: {}", e))?;

        unsafe {
            let result_ptr = ios_iap_get_products_json(c_json.as_ptr());
            if result_ptr.is_null() {
                return Err("iOS returned null for get products".to_string());
            }

            let result_str = CStr::from_ptr(result_ptr)
                .to_str()
                .map_err(|e| format!("Failed to convert result: {}", e))?
                .to_string();

            ios_free_string(result_ptr);
            Ok(result_str)
        }
    }

    pub fn purchase(product_id: &str) -> Result<String, String> {
        let c_product_id = CString::new(product_id)
            .map_err(|e| format!("Failed to create CString: {}", e))?;

        unsafe {
            let result_ptr = ios_iap_purchase_product(c_product_id.as_ptr());
            if result_ptr.is_null() {
                return Err("iOS returned null for purchase".to_string());
            }

            let result_str = CStr::from_ptr(result_ptr)
                .to_str()
                .map_err(|e| format!("Failed to convert result: {}", e))?
                .to_string();

            ios_free_string(result_ptr);
            Ok(result_str)
        }
    }

    pub fn restore() -> Result<String, String> {
        unsafe {
            let result_ptr = ios_iap_restore_purchases();
            if result_ptr.is_null() {
                return Err("iOS returned null for restore".to_string());
            }

            let result_str = CStr::from_ptr(result_ptr)
                .to_str()
                .map_err(|e| format!("Failed to convert result: {}", e))?
                .to_string();

            ios_free_string(result_ptr);
            Ok(result_str)
        }
    }
}

#[cfg(target_os = "ios")]
async fn ios_init() -> Result<bool, String> {
    Ok(ios_ffi::initialize())
}

#[cfg(target_os = "ios")]
async fn ios_get_products(product_ids: Vec<String>) -> Result<Vec<SimpleProduct>, String> {
    let json_result = ios_ffi::get_products(product_ids)?;
    serde_json::from_str(&json_result)
        .map_err(|e| format!("Failed to parse products JSON: {}", e))
}

#[cfg(target_os = "ios")]
async fn ios_purchase(product_id: String) -> Result<SimplePurchase, String> {
    let json_result = ios_ffi::purchase(&product_id)?;
    serde_json::from_str(&json_result)
        .map_err(|e| format!("Failed to parse purchase JSON: {}", e))
}

#[cfg(target_os = "ios")]
async fn ios_restore_purchases() -> Result<Vec<SimplePurchase>, String> {
    let json_result = ios_ffi::restore()?;
    serde_json::from_str(&json_result)
        .map_err(|e| format!("Failed to parse restore JSON: {}", e))
}

// ============================================================================
// Android Play Billing Implementation
// ============================================================================
// Android implementation is handled entirely by IAPService.kt in the android/ directory.
// Tauri auto-discovers and integrates it during the build process.
// The Kotlin service is invoked from JavaScript via the Tauri mobile plugin bridge.

#[cfg(target_os = "android")]
async fn android_init() -> Result<bool, String> {
    // IAPService.kt handles initialization via its initialize() method
    // Called from JavaScript, not from Rust
    Ok(true)
}

#[cfg(target_os = "android")]
async fn android_get_products(_product_ids: Vec<String>) -> Result<Vec<SimpleProduct>, String> {
    // IAPService.kt handles product fetching
    // Called from JavaScript, not from Rust
    // Return empty list as fallback (JavaScript should use direct Kotlin bridge)
    Ok(Vec::new())
}

#[cfg(target_os = "android")]
async fn android_purchase(_product_id: String) -> Result<SimplePurchase, String> {
    // IAPService.kt handles purchases
    // Called from JavaScript, not from Rust
    Err("Use JavaScript to call IAPService.purchase()".to_string())
}

#[cfg(target_os = "android")]
async fn android_restore_purchases() -> Result<Vec<SimplePurchase>, String> {
    // IAPService.kt handles restore
    // Called from JavaScript, not from Rust
    Ok(Vec::new())
}