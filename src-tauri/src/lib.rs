// iOS-specific module for keyboard scroll prevention
#[cfg(target_os = "ios")]
mod webview_helper;

use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Note: Device ID retrieval is now handled by tauri-plugin-machine-uid
// The plugin provides getMachineUid() command that works across all platforms:
// - Windows: WMI system UUID
// - macOS: IOKit system UUID
// - Linux: D-Bus machine ID
// - iOS: UIDevice's identifierForVendor
// - Android: Settings.Secure.ANDROID_ID

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_google_auth::init())
        .plugin(tauri_plugin_machine_uid::init());

    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_google_auth::init())
        .plugin(tauri_plugin_machine_uid::init());

    builder
        .setup(|app| {
            // iOS: Prevent keyboard from scrolling webview and creating extra space
            #[cfg(target_os = "ios")]
            {
                if let Some(webview_window) = app.get_webview_window("main") {
                    webview_helper::disable_scroll_on_keyboard_show(&webview_window);

                    // Enable Safari Web Inspector for debugging (iOS 16.4+)
                    // Note: Enabled in all builds (not just debug) for TestFlight debugging
                    use objc2::{msg_send, sel};
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
            tauri::generate_handler![greet]
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
