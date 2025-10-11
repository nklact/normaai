import { useEffect, useState } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/api/process';
import './UpdateChecker.css';

export function UpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Only run on desktop (Tauri) builds
    if (!window.__TAURI__) {
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
      console.error('Update check failed:', err);
      setError('Failed to check for updates');
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

      console.log('Update installed successfully, relaunching...');

      // Relaunch the application
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
  if (!window.__TAURI__ || !updateAvailable) {
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
