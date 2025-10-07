import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// iOS viewport height bug fix (kazinov's solution for Tauri iOS)
// Fixes initial load white space and prevents issues on orientation change
const fixIOSViewportBug = () => {
  // Only apply on iOS
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (!isIOS) return;

  const applyFix = () => {
    // Force viewport recalculation by toggling height
    document.documentElement.style.height = 'initial';
    setTimeout(() => {
      document.documentElement.style.height = '';
    }, 150);
  };

  // Fix on initial load
  setTimeout(applyFix, 0);

  // Fix on orientation change
  window.addEventListener('orientationchange', () => {
    setTimeout(applyFix, 150);
  });
};

fixIOSViewportBug();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
