# iOS WebView Background Termination Fix

## Problem Description

When the Norma AI app is left inactive on iPhone for extended periods (e.g., left in a tab), iOS terminates the WKWebView's WebContent process to free memory. Upon reopening the app, users see a blank screen (`about:blank`) and must force-close and reopen the app.

### Root Cause

- **Process Termination**: iOS kills the WKWebView's separate WebContent process (not the app process) when the app is backgrounded for too long or under memory pressure
- **JavaScript Cannot Detect**: When the WebContent process dies, ALL JavaScript execution stops, including event listeners
- **No Recovery**: The `visibilitychange` and `pageshow` event listeners were in the terminated process and never fire
- **Safari Inspector Shows Nothing**: No JavaScript console exists because the JS engine is part of the terminated process

## Solution Implemented

### 1. Patched wry to Version with Fix

Modified `src-tauri/Cargo.toml` to use the latest wry from GitHub which includes the WebView process termination handler:

```toml
[patch.crates-io]
wry = { git = "https://github.com/tauri-apps/wry", branch = "dev" }
```

This includes the merged fix from [tauri-apps/wry#1624](https://github.com/tauri-apps/wry/pull/1624).

### 2. Native WKNavigationDelegate Implementation

Implemented a proper `WKNavigationDelegate` in `src-tauri/src/webview_helper.rs` using objc2:

**Key Components:**
- **WKWebView and WKNavigationDelegate declarations**: Forward-declared using `objc2::extern_class!` and `objc2::extern_protocol!`
- **ProcessTerminationDelegate class**: Custom Objective-C class created at runtime using `define_class!` macro
- **webViewWebContentProcessDidTerminate**: Implements Apple's official delegate method for detecting process termination
- **Thread-local storage**: Keeps the delegate instance alive for the app lifetime
- **Direct WKWebView API**: Sets the navigation delegate directly on the WKWebView instance

**How it works:**
1. When app starts, we create a `ProcessTerminationDelegate` instance
2. Set it as the WKWebView's `navigationDelegate`
3. When iOS kills the WebContent process, Apple's WebKit framework calls our delegate method
4. We automatically reload the page to restore functionality

### 3. Removed JavaScript-Only Fix

Removed the ineffective JavaScript detection from `src\App.jsx` (lines 120-172) since:
- JavaScript cannot run when the WebContent process is terminated
- Event listeners don't fire when the process that registered them is dead
- Native delegate is the only reliable and proper solution

## Technical Details

### Why JavaScript Alone Cannot Work

1. **Separate Process Architecture**: WKWebView uses a multi-process model:
   - Main app process (your Tauri app)
   - WebContent process (JavaScript engine, DOM, rendering)
   - Networking process

2. **Process Independence**: iOS can terminate the WebContent process without killing your app

3. **No JavaScript Execution**: When WebContent dies:
   - All JavaScript code stops executing
   - React state is lost
   - Event listeners are cleared
   - Console logs stop
   - The page shows `about:blank`

4. **Native Detection Required**: Only native code running in the main app process can detect and recover from WebContent termination

### How the Fix Works

```rust
// In src-tauri/src/webview_helper.rs

// Define the WKNavigationDelegate protocol
objc2::extern_protocol!(
    pub unsafe trait WKNavigationDelegate: NSObjectProtocol {
        #[optional]
        #[method(webViewWebContentProcessDidTerminate:)]
        unsafe fn webViewWebContentProcessDidTerminate(&self, webview: &WKWebView);
    }
);

// Implement our custom delegate
define_class!(
    pub struct ProcessTerminationDelegate;

    unsafe impl WKNavigationDelegate for ProcessTerminationDelegate {
        #[unsafe(method(webViewWebContentProcessDidTerminate:))]
        unsafe fn webViewWebContentProcessDidTerminate(&self, _webview: &WKWebView) {
            println!("⚠️ WKWebView content process terminated - reloading...");
            let webview_window = &self.ivars().webview_window;
            let _ = webview_window.eval("window.location.reload()");
        }
    }
);
```

**This is the proper Apple-sanctioned approach:**
1. Uses official `WKNavigationDelegate` protocol
2. Implements `webViewWebContentProcessDidTerminate` delegate method
3. Called directly by WebKit framework when process terminates
4. No polling, no wasted resources, no battery drain
5. Runs in main app process, independent of WebContent process

## Testing

### To Test the Fix:

1. **Build and deploy** to TestFlight:
   ```bash
   cd src-tauri
   npm run tauri ios build -- --export-method app-store-connect
   ```

2. **Test scenario**:
   - Open the app on iPhone
   - Switch to another app
   - Leave it for 30+ minutes (or simulate low memory)
   - Return to the Norma AI app
   - **Expected**: App automatically reloads and works normally
   - **Before fix**: Blank screen requiring app restart

3. **Check logs** in Xcode Console or Safari Web Inspector:
   - Should see: `✅ iOS WebView health monitoring enabled`
   - On recovery: `⚠️ iOS WebView unresponsive, attempting reload...`

## Future Improvements

When [tauri-apps/tauri#14325](https://github.com/tauri-apps/tauri/pull/14325) is merged, we can use the official Tauri API:

```rust
use tauri::webview::WebviewWindowExt;

webview_window.on_web_content_process_terminate(|| {
    println!("WebContent process terminated");
    // Handle termination
});
```

This will be cleaner than polling but will provide the same functionality.

## Related Issues

- Upstream fix: https://github.com/tauri-apps/wry/pull/1624 (Merged ✅)
- Tauri integration: https://github.com/tauri-apps/tauri/pull/14325 (Pending)
- Issue reported by: User testing on iPhone after periods of inactivity

## References

- [Apple WKNavigationDelegate Documentation](https://developer.apple.com/documentation/webkit/wknavigationdelegate/webviewwebcontentprocessdidterminate(_:))
- [WebKit Process Termination](https://webkit.org/blog/8090/workers-at-your-service/)
- [iOS Memory Management](https://developer.apple.com/documentation/uikit/app_and_environment/managing_your_app_s_life_cycle)
