// iOS-specific module for keyboard scroll prevention and WebView process termination handling
#[cfg(target_os = "ios")]
mod webview_helper;

#[cfg(target_os = "ios")]
use tauri::Manager;

// Simple IAP module for mobile platforms
#[cfg(any(target_os = "ios", target_os = "android"))]
mod simple_iap;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Note: Device session ID is generated client-side using crypto.randomUUID()
// and stored persistently in:
// - Desktop/Mobile: Tauri Store (device.json)
// - Web: localStorage
// This approach is privacy-friendly and works across all platforms without
// requiring access to hardware identifiers.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Desktop-specific plugins (updater and process don't work on mobile)
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_oauth::init()); // OAuth for desktop (localhost callback)

    // Mobile-specific plugins (no updater or process)
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_web_auth::init()); // OAuth for mobile (custom URL schemes)
        // REMOVED: .plugin(tauri_plugin_iap::init()) - crashes on iOS 18 with Tauri 2.9.3
        // Using custom simple_iap implementation instead

    builder
        .setup(|_app| {
            // iOS: Prevent keyboard from scrolling webview and creating extra space
            #[cfg(target_os = "ios")]
            {
                if let Some(webview_window) = _app.get_webview_window("main") {
                    // Prevent keyboard from scrolling webview
                    webview_helper::disable_scroll_on_keyboard_show(&webview_window);

                    // Handle WebView content process termination (iOS background kill fix)
                    // Uses WKNavigationDelegate to detect when iOS kills the WebContent process
                    // and automatically reloads the page to restore functionality
                    webview_helper::enable_process_termination_handler(&webview_window);

                    // Enable Safari Web Inspector for debugging (iOS 16.4+)
                    // Note: Enabled in all builds (not just debug) for TestFlight debugging
                    use objc2::msg_send;
                    use objc2::runtime::AnyObject;

                    let _ = webview_window.with_webview(|webview| {
                        unsafe {
                            let webview_ptr = webview.inner() as *mut AnyObject;
                            if !webview_ptr.is_null() {
                                let _: () = msg_send![webview_ptr, setInspectable: true];
                            }
                        }
                    });

                    println!("✅ iOS WebView inspector enabled");
                }
            }
            Ok(())
        })
        .invoke_handler({
            #[cfg(any(target_os = "ios", target_os = "android"))]
            {
                tauri::generate_handler![
                    greet,
                    simple_iap::iap_init,
                    simple_iap::iap_get_products,
                    simple_iap::iap_purchase,
                    simple_iap::iap_restore,
                ]
            }
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                tauri::generate_handler![greet]
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
