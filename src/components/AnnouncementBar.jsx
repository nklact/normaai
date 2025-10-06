import React, { useState, useEffect } from 'react';
import './AnnouncementBar.css';

const AnnouncementBar = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [platform, setPlatform] = useState(null);

  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    const isAndroid = /android/i.test(userAgent);
    const isIOS = /iphone|ipad|ipod/i.test(userAgent);

    // Check if running in Tauri app (desktop or mobile)
    const isTauriApp = typeof window !== 'undefined' && window.__TAURI__;

    // Check if running in mobile app (vs mobile web browser)
    const isInApp = isTauriApp || // Tauri app (desktop or mobile)
                    window.navigator.standalone || // iOS PWA/app
                    window.matchMedia('(display-mode: standalone)').matches || // Android PWA/app
                    document.referrer.includes('android-app://') || // Android app webview
                    /wv/i.test(userAgent); // Android webview

    // Only show on mobile web browsers, not in mobile apps
    if ((isAndroid || isIOS) && !isInApp) {
      setPlatform(isAndroid ? 'android' : 'ios');
      setIsVisible(true);
    }
  }, []);

  if (!isVisible) return null;

  const appStoreUrl = platform === 'android'
    ? "https://play.google.com/store/apps/details?id=rs.normaai.app"
    : "https://apps.apple.com/app/norma-ai/id123456789";

  return (
    <div className="announcement-bar announcement-bar-visible">
      <div className="announcement-content">
        <img src="/favicon.svg" alt="Norma AI" className="announcement-icon" />
        <span className="announcement-text">
          Preuzmite Norma AI mobilnu aplikaciju za najbolje iskustvo
        </span>
      </div>
      <a href={appStoreUrl} className="download-btn">
        PREUZMI
      </a>
    </div>
  );
};

export default AnnouncementBar;