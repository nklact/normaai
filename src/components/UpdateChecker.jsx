import { useEffect, useState } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import './UpdateChecker.css';

export function UpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Only run on desktop (Windows/Mac/Linux) builds, not on mobile
    const isTauriApp = Boolean(window.__TAURI__);
    const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const isDesktopApp = isTauriApp && !isMobileDevice;

    if (!isDesktopApp) {
      return;
    }

    checkForUpdates();
  }, []);

  const checkForUpdates = async () => {
    try {
      console.log('Checking for updates...');
      const update = await check();

      if (update?.available) {
        console.log('Update available:', update.version);
        setUpdateInfo(update);
        setUpdateAvailable(true);
      } else {
        console.log('No updates available');
      }
    } catch (err) {
      // Silently fail in development or if update endpoint is not configured
      // This is expected when developing locally or if GitHub releases aren't set up yet
      console.warn('Update check failed (this is normal in development):', err);
      console.warn('Error details:', {
        message: err?.message,
        cause: err?.cause,
        stack: err?.stack
      });
      // Don't set error state - just fail silently
    }
  };

  const handleUpdateNow = async () => {
    if (!updateInfo) return;

    try {
      setIsDownloading(true);
      setError(null);

      console.log('Downloading update...');

      // Download and install the update with progress tracking
      await updateInfo.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            console.log('Download started');
            setDownloadProgress(0);
            break;
          case 'Progress':
            const progress = Math.round((event.data.downloaded / event.data.contentLength) * 100);
            console.log(`Download progress: ${progress}%`);
            setDownloadProgress(progress);
            break;
          case 'Finished':
            console.log('Download finished, installing...');
            setDownloadProgress(100);
            break;
        }
      });

      console.log('Update installed successfully, relaunching app...');

      // Relaunch the application
      // Note: On Windows, the app automatically exits during installation,
      // so this mainly applies to macOS and Linux
      await relaunch();
    } catch (err) {
      console.error('Update installation failed:', err);
      setError('Failed to install update. Please try again.');
      setIsDownloading(false);
    }
  };

  const handleUpdateLater = () => {
    setUpdateAvailable(false);
    setUpdateInfo(null);
    // Update will be checked again next time the app opens
  };

  // Don't render anything if not on desktop or no update available
  const isTauriApp = Boolean(window.__TAURI__);
  const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isDesktopApp = isTauriApp && !isMobileDevice;

  if (!isDesktopApp || !updateAvailable) {
    return null;
  }

  return (
    <div className="update-overlay">
      <div className="update-modal">
        <div className="update-header">
          <h2>Nova verzija dostupna!</h2>
          <p className="update-version">Verzija {updateInfo?.version}</p>
        </div>

        {updateInfo?.body && (
          <div className="update-notes">
            <h3>Šta je novo:</h3>
            <p>{updateInfo.body}</p>
          </div>
        )}

        {error && (
          <div className="update-error">
            <p>{error}</p>
          </div>
        )}

        {isDownloading ? (
          <div className="update-downloading">
            <p>Preuzimanje ažuriranja...</p>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
            <p className="progress-text">{downloadProgress}%</p>
          </div>
        ) : (
          <div className="update-actions">
            <button
              className="update-button update-now"
              onClick={handleUpdateNow}
            >
              Ažuriraj sada
            </button>
            <button
              className="update-button update-later"
              onClick={handleUpdateLater}
            >
              Kasnije
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default UpdateChecker;
