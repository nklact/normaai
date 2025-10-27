// iOS-specific module for keyboard scroll prevention
#[cfg(target_os = "ios")]
mod webview_helper;

use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Windows: Get machine GUID
#[cfg(target_os = "windows")]
fn get_system_machine_id() -> Result<String, String> {
    use std::process::Command;

    // Try to get Windows machine GUID using wmic
    let output = Command::new("wmic")
        .args(&["csproduct", "get", "uuid", "/format:value"])
        .output()
        .map_err(|e| format!("Failed to run wmic: {}", e))?;

    if output.status.success() {
        let result = String::from_utf8_lossy(&output.stdout);
        for line in result.lines() {
            if line.starts_with("UUID=") {
                let uuid = line[5..].trim();
                if !uuid.is_empty() && uuid != "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF" {
                    return Ok(uuid.to_string());
                }
            }
        }
    }

    // Fallback: Try registry
    get_system_hardware_uuid()
}

// macOS: Get hardware UUID
#[cfg(target_os = "macos")]
fn get_system_machine_id() -> Result<String, String> {
    use std::process::Command;

    let output = Command::new("system_profiler")
        .args(&["SPHardwareDataType", "-json"])
        .output()
        .map_err(|e| format!("Failed to run system_profiler: {}", e))?;

    if output.status.success() {
        let result = String::from_utf8_lossy(&output.stdout);
        // Parse JSON to get hardware UUID
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&result) {
            if let Some(hardware) = json["SPHardwareDataType"]
                .as_array()
                .and_then(|arr| arr.first())
            {
                if let Some(uuid) = hardware["platform_UUID"].as_str() {
                    return Ok(uuid.to_string());
                }
            }
        }
    }

    // Fallback
    get_system_hardware_uuid()
}

// Linux: Get machine ID
#[cfg(target_os = "linux")]
fn get_system_machine_id() -> Result<String, String> {
    use std::fs;

    // Try /etc/machine-id first
    if let Ok(machine_id) = fs::read_to_string("/etc/machine-id") {
        let trimmed = machine_id.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    // Fallback to /var/lib/dbus/machine-id
    if let Ok(machine_id) = fs::read_to_string("/var/lib/dbus/machine-id") {
        let trimmed = machine_id.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    get_system_hardware_uuid()
}

// iOS: Not supported (mobile uses different device ID approach)
#[cfg(target_os = "ios")]
#[allow(dead_code)]
fn get_system_machine_id() -> Result<String, String> {
    Err("Device ID not supported on iOS - use mobile device APIs instead".to_string())
}

// Fallback hardware UUID method
#[allow(dead_code)]
fn get_system_hardware_uuid() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        // Try PowerShell method for Windows
        let output = Command::new("powershell")
            .args(&[
                "-Command",
                "(Get-CimInstance -Class Win32_ComputerSystemProduct).UUID",
            ])
            .output()
            .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

        if output.status.success() {
            let uuid = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !uuid.is_empty() && uuid != "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF" {
                return Ok(uuid);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        let output = Command::new("ioreg")
            .args(&["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
            .map_err(|e| format!("Failed to run ioreg: {}", e))?;

        if output.status.success() {
            let result = String::from_utf8_lossy(&output.stdout);
            for line in result.lines() {
                if line.contains("IOPlatformUUID") {
                    if let Some(start) = line
                        .find('"')
                        .and_then(|pos| line[pos + 1..].find('"').map(|p| pos + p + 1))
                    {
                        if let Some(end) = line[start + 1..].find('"').map(|p| start + p + 1) {
                            return Ok(line[start + 1..end].to_string());
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::fs;
        use std::process::Command;

        // Try DMI product UUID
        if let Ok(uuid) = fs::read_to_string("/sys/class/dmi/id/product_uuid") {
            let trimmed = uuid.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }

        // Try dmidecode as fallback
        if let Ok(output) = Command::new("dmidecode")
            .args(&["-s", "system-uuid"])
            .output()
        {
            if output.status.success() {
                let uuid = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !uuid.is_empty() {
                    return Ok(uuid);
                }
            }
        }
    }

    Err("Could not determine system hardware UUID".to_string())
}

// These Tauri commands are only for desktop builds (Windows/macOS/Linux desktop)
// Mobile builds (Android/iOS) use native device APIs instead
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
fn get_machine_id() -> Result<String, String> {
    get_system_machine_id()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
fn get_system_uuid() -> Result<String, String> {
    get_system_hardware_uuid()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build());

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
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                tauri::generate_handler![greet, get_machine_id, get_system_uuid]
            }
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                tauri::generate_handler![greet]
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
