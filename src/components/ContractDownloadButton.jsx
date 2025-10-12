import React, { useState, useMemo } from 'react';
import Icon from './Icons';
import './ContractDownloadButton.css';

const ContractDownloadButton = ({ contract, userStatus, onOpenAuthModal, onOpenPlanSelection }) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  // Check if contract is expired (30 days)
  const isExpired = useMemo(() => {
    if (!contract.created_at) return false;
    const createdDate = new Date(contract.created_at);
    const now = new Date();
    const diffInDays = (now - createdDate) / (1000 * 60 * 60 * 24);
    return diffInDays > 30;
  }, [contract.created_at]);

  // Check if user has premium access (professional, team, or premium plans)
  const hasPremiumAccess = useMemo(() => {
    if (!userStatus) return false;
    const premiumTypes = ['professional', 'team', 'premium'];
    return premiumTypes.includes(userStatus.access_type);
  }, [userStatus]);

  const handleDownload = async () => {
    // Check if user has premium access
    if (!hasPremiumAccess) {
      // User is not logged in or doesn't have premium
      if (!userStatus || !userStatus.user_id) {
        // Not logged in - show auth modal
        if (onOpenAuthModal) {
          onOpenAuthModal();
        }
      } else {
        // Logged in but no premium - show plan selection
        if (onOpenPlanSelection) {
          onOpenPlanSelection();
        }
      }
      return;
    }
    try {
      setIsDownloading(true);
      setDownloadError(null);

      // Fetch the file from the backend
      const response = await fetch(contract.download_url);

      if (!response.ok) {
        throw new Error('Failed to download contract');
      }

      // Get the file blob
      const blob = await response.blob();

      // Create a download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = contract.filename;
      document.body.appendChild(link);
      link.click();

      // Cleanup
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

    } catch (error) {
      console.error('Contract download error:', error);
      setDownloadError('Greška pri preuzimanju ugovora. Pokušajte ponovo.');
    } finally {
      setIsDownloading(false);
    }
  };

  // Get button text based on user status
  const getButtonText = () => {
    if (isDownloading) return 'Preuzimanje...';
    if (!userStatus || !userStatus.user_id) return 'Prijavi se da preuzmeš';
    if (!hasPremiumAccess) return 'Nadogradi za preuzimanje';
    return 'Preuzmi ugovor';
  };

  return (
    <div className="contract-download-container">
      <div className="contract-info-box">
        <div className="contract-icon">
          <Icon name="file" size={24} />
        </div>
        <div className="contract-details">
          <div className="contract-filename">{contract.filename}</div>
          {contract.contract_type && (
            <div className="contract-type">{contract.contract_type}</div>
          )}
          {contract.preview_text && (
            <div className="contract-preview">{contract.preview_text}</div>
          )}
        </div>
      </div>

      {isExpired ? (
        <div className="contract-expired">
          <Icon name="clock" size={16} />
          <span>⏰ Ovaj ugovor je istekao (dostupan 30 dana)</span>
        </div>
      ) : (
        <button
          onClick={handleDownload}
          disabled={isDownloading}
          className={`contract-download-btn ${!hasPremiumAccess ? 'upgrade-required' : ''}`}
          title={hasPremiumAccess ? 'Preuzmi ugovor' : 'Potrebna je pretplata'}
        >
          {isDownloading ? (
            <>
              <div className="download-spinner">⏳</div>
              <span>Preuzimanje...</span>
            </>
          ) : (
            <>
              <Icon name={hasPremiumAccess ? "download" : "lock"} size={18} />
              <span>{getButtonText()}</span>
            </>
          )}
        </button>
      )}

      {downloadError && (
        <div className="download-error">
          <Icon name="alert" size={14} />
          <span>{downloadError}</span>
        </div>
      )}
    </div>
  );
};

export default ContractDownloadButton;
