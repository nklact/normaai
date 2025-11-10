import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import DeleteAccountModal from './DeleteAccountModal';
import ConfirmDialog from './ConfirmDialog';
import ErrorDialog from './ErrorDialog';
import InfoDialog from './InfoDialog';
import apiService from '../services/api';
import './SettingsModal.css';

const SettingsModal = ({
  isOpen,
  onClose,
  userStatus,
  onOpenPlanSelection,
  onOpenSubscriptionManagement,
  onAccountDeleted
}) => {
  const [activeTab, setActiveTab] = useState('account');
  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [revokingSession, setRevokingSession] = useState(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // Password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Dialog states
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, type: '', sessionId: null });
  const [errorDialog, setErrorDialog] = useState({ isOpen: false, message: '' });
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, message: '' });

  const tabs = (
    <div className="settings-tabs">
      <button
        className={`settings-tab ${activeTab === 'account' ? 'active' : ''}`}
        onClick={() => setActiveTab('account')}
      >
        Nalog
      </button>
      <button
        className={`settings-tab ${activeTab === 'devices' ? 'active' : ''}`}
        onClick={() => setActiveTab('devices')}
      >
        Uređaji
      </button>
      <button
        className={`settings-tab ${activeTab === 'security' ? 'active' : ''}`}
        onClick={() => setActiveTab('security')}
      >
        Sigurnost
      </button>
      <button
        className={`settings-tab ${activeTab === 'danger' ? 'active' : ''}`}
        onClick={() => setActiveTab('danger')}
      >
        Opasnost
      </button>
    </div>
  );

  // Reset to account tab when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab('account');
    }
  }, [isOpen]);

  // Load sessions when devices tab is opened
  useEffect(() => {
    if (activeTab === 'devices' && isOpen) {
      loadSessions();
    }
  }, [activeTab, isOpen]);

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const sessionsData = await apiService.getSessions();
      setSessions(sessionsData);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoadingSessions(false);
    }
  };

  const handleRevokeSession = async (sessionId) => {
    const session = sessions.find(s => s.id === sessionId);
    const isCurrentSession = session?.is_current;

    setConfirmDialog({
      isOpen: true,
      type: 'revokeSession',
      sessionId,
      title: isCurrentSession ? 'Odjavi se sa ovog uređaja' : 'Ukloni uređaj',
      message: isCurrentSession
        ? 'Da li ste sigurni da želite da se odjavite? Bićete vraćeni na stranicu za prijavu.'
        : 'Da li ste sigurni da želite da uklonite ovaj uređaj? Moraćete ponovo da se prijavite na njemu.'
    });
  };

  const handleConfirmRevokeSession = async () => {
    const sessionId = confirmDialog.sessionId;
    const isCurrentSession = sessions.find(s => s.id === sessionId)?.is_current;
    setRevokingSession(sessionId);

    try {
      await apiService.revokeSession(sessionId);

      // If user revoked their current session, immediately logout
      if (isCurrentSession) {
        console.log('🔓 Current session revoked - logging out immediately');
        await apiService.logout();
        // Close modal and reload to show login screen
        onClose();
        window.location.reload();
        return;
      }

      // Otherwise, just remove from list
      setSessions(sessions.filter(s => s.id !== sessionId));
    } catch (error) {
      console.error('Failed to revoke session:', error);
      setErrorDialog({
        isOpen: true,
        message: 'Greška prilikom uklanjanja uređaja. Molimo pokušajte ponovo.'
      });
    } finally {
      setRevokingSession(null);
    }
  };

  const handleRevokeAllSessions = async () => {
    setConfirmDialog({
      isOpen: true,
      type: 'revokeAll',
      title: 'Odjavi sve ostale uređaje',
      message: 'Da li ste sigurni da želite da se odjavite sa svih drugih uređaja? Ova akcija ne može biti poništena.'
    });
  };

  const handleConfirmRevokeAll = async () => {
    try {
      const result = await apiService.revokeAllSessions();
      setInfoDialog({
        isOpen: true,
        message: result.message || 'Uspešno ste odjavljeni sa svih drugih uređaja.'
      });
      loadSessions();
    } catch (error) {
      console.error('Failed to revoke all sessions:', error);
      setErrorDialog({
        isOpen: true,
        message: 'Greška prilikom uklanjanja sesija. Molimo pokušajte ponovo.'
      });
    }
  };

  const handleConfirmDialogAction = async () => {
    if (confirmDialog.type === 'revokeSession') {
      handleConfirmRevokeSession();
    } else if (confirmDialog.type === 'revokeAll') {
      handleConfirmRevokeAll();
    } else if (confirmDialog.type === 'logout') {
      await handleLogout();
    }
  };

  const handleLogout = async () => {
    try {
      console.log('🔓 Logging out...');
      await apiService.logout();
      onClose();
      window.location.reload();
    } catch (error) {
      console.error('Error during logout:', error);
      // Even if logout fails, close modal and reload
      onClose();
      window.location.reload();
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    // Validation
    if (newPassword.length < 8) {
      setPasswordError('Lozinka mora imati najmanje 8 karaktera');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Lozinke se ne poklapaju');
      return;
    }

    const hasUppercase = /[A-Z]/.test(newPassword);
    const hasLowercase = /[a-z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(newPassword);

    if (!(hasUppercase && hasLowercase && hasNumber && hasSpecial)) {
      setPasswordError('Lozinka mora sadržati velika i mala slova, broj i specijalni karakter');
      return;
    }

    setChangingPassword(true);
    try {
      await apiService.changePassword(newPassword);
      setPasswordSuccess('Lozinka uspešno promenjena. Druge sesije su uklonjene.');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setPasswordError(error.message || 'Greška prilikom promene lozinke');
    } finally {
      setChangingPassword(false);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Upravo sada';
    if (diffMins < 60) return `Pre ${diffMins} min`;
    if (diffHours < 24) return `Pre ${diffHours}h`;
    if (diffDays < 7) return `Pre ${diffDays} dana`;
    return date.toLocaleDateString('sr-RS');
  };

  const parseUserAgent = (ua) => {
    if (!ua) return { device: 'Nepoznat uređaj', browser: '', os: '', icon: '🌐' };

    const userAgent = ua.toLowerCase();
    const originalUA = ua; // Keep original for case-sensitive matching

    // Detect device type and model
    let deviceType = 'desktop';
    let deviceName = '';
    let icon = '💻';

    // iPhone detection with model estimation
    if (userAgent.includes('iphone')) {
      deviceType = 'mobile';
      icon = '📱';

      // Estimate iPhone model based on iOS version
      if (userAgent.includes('iphone os 17') || userAgent.includes('cpu os 17')) {
        deviceName = 'iPhone 15';
      } else if (userAgent.includes('iphone os 16') || userAgent.includes('cpu os 16')) {
        deviceName = 'iPhone 14';
      } else if (userAgent.includes('iphone os 15') || userAgent.includes('cpu os 15')) {
        deviceName = 'iPhone 13';
      } else if (userAgent.includes('iphone os 14') || userAgent.includes('cpu os 14')) {
        deviceName = 'iPhone 12';
      } else if (userAgent.includes('iphone os 13') || userAgent.includes('cpu os 13')) {
        deviceName = 'iPhone 11';
      } else if (userAgent.includes('iphone os 12') || userAgent.includes('cpu os 12')) {
        deviceName = 'iPhone XS';
      } else if (userAgent.includes('iphone os 11') || userAgent.includes('cpu os 11')) {
        deviceName = 'iPhone X';
      } else {
        deviceName = 'iPhone';
      }
    }
    // iPad detection
    else if (userAgent.includes('ipad')) {
      deviceType = 'tablet';
      icon = '📱';
      deviceName = 'iPad';
    }
    // Android detection with manufacturer
    else if (userAgent.includes('android')) {
      icon = '📱';

      if (userAgent.includes('mobile')) {
        deviceType = 'mobile';

        // Detect specific Android devices
        if (userAgent.includes('samsung')) {
          if (userAgent.includes('sm-s23')) deviceName = 'Samsung Galaxy S23';
          else if (userAgent.includes('sm-s22')) deviceName = 'Samsung Galaxy S22';
          else if (userAgent.includes('sm-s21')) deviceName = 'Samsung Galaxy S21';
          else if (userAgent.includes('sm-s9')) deviceName = 'Samsung Galaxy S';
          else if (userAgent.includes('sm-n')) deviceName = 'Samsung Galaxy Note';
          else if (userAgent.includes('sm-a')) deviceName = 'Samsung Galaxy A';
          else deviceName = 'Samsung Galaxy';
        } else if (userAgent.includes('pixel')) {
          const pixelMatch = userAgent.match(/pixel\s?(\d+)/);
          deviceName = pixelMatch ? `Google Pixel ${pixelMatch[1]}` : 'Google Pixel';
        } else if (userAgent.includes('huawei')) {
          deviceName = 'Huawei telefon';
        } else if (userAgent.includes('xiaomi') || userAgent.includes('redmi')) {
          deviceName = 'Xiaomi telefon';
        } else if (userAgent.includes('oneplus')) {
          deviceName = 'OnePlus';
        } else if (userAgent.includes('oppo')) {
          deviceName = 'Oppo';
        } else if (userAgent.includes('vivo')) {
          deviceName = 'Vivo';
        } else {
          deviceName = 'Android telefon';
        }
      } else {
        deviceType = 'tablet';
        deviceName = userAgent.includes('samsung') ? 'Samsung tablet' : 'Android tablet';
      }
    }

    // Detect OS with detailed version
    let os = '';

    // Windows version detection
    if (userAgent.includes('windows nt 10.0')) {
      os = 'Windows 11'; // Modern Windows 10.0 is usually Windows 11
    } else if (userAgent.includes('windows nt 6.3')) {
      os = 'Windows 8.1';
    } else if (userAgent.includes('windows nt 6.2')) {
      os = 'Windows 8';
    } else if (userAgent.includes('windows nt 6.1')) {
      os = 'Windows 7';
    } else if (userAgent.includes('windows nt 6.0')) {
      os = 'Windows Vista';
    } else if (userAgent.includes('windows nt 5.1')) {
      os = 'Windows XP';
    } else if (userAgent.includes('windows')) {
      os = 'Windows';
    }
    // macOS version detection
    else if (userAgent.includes('mac os x')) {
      const macMatch = userAgent.match(/mac os x (\d+)[_.](\d+)/);
      if (macMatch) {
        const major = parseInt(macMatch[1]);
        const minor = parseInt(macMatch[2]);

        if (major === 14) os = 'macOS Sonoma';
        else if (major === 13) os = 'macOS Ventura';
        else if (major === 12) os = 'macOS Monterey';
        else if (major === 11) os = 'macOS Big Sur';
        else if (major === 10) {
          if (minor >= 15) os = 'macOS Catalina';
          else if (minor >= 14) os = 'macOS Mojave';
          else os = 'macOS';
        } else {
          os = 'macOS';
        }
      } else {
        os = 'macOS';
      }
      if (!deviceName) deviceName = 'Mac';
    }
    // Linux detection
    else if (userAgent.includes('linux')) {
      if (userAgent.includes('ubuntu')) os = 'Ubuntu';
      else if (userAgent.includes('fedora')) os = 'Fedora';
      else if (userAgent.includes('debian')) os = 'Debian';
      else os = 'Linux';
      if (!deviceName) deviceName = `${os} računar`;
    }
    // iOS version
    else if (userAgent.includes('iphone os') || userAgent.includes('cpu os')) {
      const iosMatch = userAgent.match(/(?:iphone )?(?:cpu )?os (\d+)[_.](\d+)/);
      if (iosMatch) {
        os = `iOS ${iosMatch[1]}`;
      } else {
        os = 'iOS';
      }
    }
    // Android version
    else if (userAgent.includes('android')) {
      const androidMatch = userAgent.match(/android\s([0-9.]+)/);
      if (androidMatch) {
        const version = parseFloat(androidMatch[1]);
        if (version >= 14) os = 'Android 14';
        else if (version >= 13) os = 'Android 13';
        else if (version >= 12) os = 'Android 12';
        else if (version >= 11) os = 'Android 11';
        else if (version >= 10) os = 'Android 10';
        else os = `Android ${Math.floor(version)}`;
      } else {
        os = 'Android';
      }
    }

    // Detect browser
    let browser = '';
    if (userAgent.includes('edg/')) {
      browser = 'Edge';
    } else if (userAgent.includes('chrome/') && !userAgent.includes('edg')) {
      browser = 'Chrome';
    } else if (userAgent.includes('firefox/')) {
      browser = 'Firefox';
    } else if (userAgent.includes('safari/') && !userAgent.includes('chrome')) {
      browser = 'Safari';
    } else if (userAgent.includes('opera') || userAgent.includes('opr/')) {
      browser = 'Opera';
    }

    // Build friendly device name
    if (deviceType === 'desktop') {
      if (!deviceName) {
        deviceName = os ? `${os} računar` : 'Računar';
      }
      if (browser) {
        deviceName = `${deviceName} · ${browser}`;
      }
    } else {
      // Mobile/tablet - add OS version if device name doesn't already contain specific model
      const hasSpecificModel = deviceName.includes('15') || deviceName.includes('14') ||
                               deviceName.includes('13') || deviceName.includes('XS') ||
                               deviceName.includes('Galaxy') || deviceName.includes('Pixel');

      if (os && !hasSpecificModel) {
        deviceName = `${deviceName} · ${os}`;
      }

      // Add browser only if it's not default (Safari on iOS, Chrome on Android)
      const isDefaultBrowser = (deviceName.includes('iPhone') && browser === 'Safari') ||
                               (deviceName.includes('iPad') && browser === 'Safari') ||
                               (deviceName.includes('Android') && browser === 'Chrome');

      if (browser && !isDefaultBrowser) {
        deviceName = `${deviceName} · ${browser}`;
      }
    }

    return { device: deviceName, browser, os, icon };
  };

  const getDeviceIcon = (deviceName) => {
    if (!deviceName) return '💻';
    const parsed = parseUserAgent(deviceName);
    return parsed.icon;
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Podešavanja" tabs={tabs} type="settings">
        <div className="settings-content">
          {activeTab === 'account' && (
            <div className="settings-section">
              <div className="settings-section-header">
                <h4>Informacije o nalogu</h4>
              </div>
              <div className="settings-info-group">
                <div className="settings-info-item">
                  <span className="settings-label">Email:</span>
                  <span className="settings-value">{userStatus?.email}</span>
                </div>
                <div className="settings-info-item">
                  <span className="settings-label">Tip naloga:</span>
                  <span className="settings-value">
                    {userStatus?.account_type === 'trial_registered' && 'Probni period'}
                    {userStatus?.account_type === 'individual' && 'Individual'}
                    {userStatus?.account_type === 'professional' && 'Professional'}
                    {userStatus?.account_type === 'team' && 'Team'}
                    {userStatus?.account_type === 'premium' && 'Premium'}
                  </span>
                </div>
                {userStatus?.messages_remaining !== null && userStatus?.messages_remaining !== undefined && (
                  <div className="settings-info-item">
                    <span className="settings-label">Preostalo poruka:</span>
                    <span className="settings-value">{userStatus?.messages_remaining}</span>
                  </div>
                )}
              </div>

              <div className="settings-section-header">
                <h4>Upravljanje nalogom</h4>
              </div>
              <div className="settings-actions">
                {userStatus?.account_type === 'trial_registered' && (
                  <button
                    className="settings-btn settings-btn-primary"
                    onClick={() => {
                      onClose();
                      onOpenPlanSelection();
                    }}
                  >
                    Nadogradi plan
                  </button>
                )}
                {['individual', 'professional', 'team', 'premium'].includes(userStatus?.account_type) && (
                  <button
                    className="settings-btn settings-btn-secondary"
                    onClick={() => {
                      onClose();
                      onOpenSubscriptionManagement();
                    }}
                  >
                    Upravljaj pretplatom
                  </button>
                )}
                <button
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    fontSize: '14px',
                    cursor: 'pointer',
                    padding: '8px 0',
                    textDecoration: 'underline'
                  }}
                  onClick={() => {
                    setConfirmDialog({
                      isOpen: true,
                      type: 'logout',
                      title: 'Odjava',
                      message: 'Da li ste sigurni da želite da se odjavite?'
                    });
                  }}
                  onMouseEnter={(e) => e.target.style.color = 'var(--primary-color)'}
                  onMouseLeave={(e) => e.target.style.color = 'var(--text-secondary)'}
                >
                  Odjavite se
                </button>
              </div>
            </div>
          )}

          {activeTab === 'devices' && (
            <div className="settings-section">
              <div className="settings-section-header">
                <h4>Aktivni uređaji</h4>
                {sessions.length > 1 && (
                  <button
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      fontSize: '14px',
                      cursor: 'pointer',
                      padding: '8px 0',
                      textDecoration: 'underline'
                    }}
                    onClick={handleRevokeAllSessions}
                    onMouseEnter={(e) => e.target.style.color = 'var(--primary-color)'}
                    onMouseLeave={(e) => e.target.style.color = 'var(--text-secondary)'}
                  >
                    Odjavi sve ostale
                  </button>
                )}
              </div>

              {loadingSessions ? (
                <div className="settings-loading">Učitavanje...</div>
              ) : sessions.length === 0 ? (
                <div className="settings-empty">Nema aktivnih sesija</div>
              ) : (
                <div className="sessions-list">
                  {sessions.map(session => {
                    const deviceInfo = parseUserAgent(session.device_name);
                    return (
                      <div key={session.id} className="session-item">
                        <div className="session-icon">{deviceInfo.icon}</div>
                        <div className="session-info">
                          <div className="session-device">
                            {deviceInfo.device}
                            {session.is_current && <span className="session-current-badge">Trenutni</span>}
                          </div>
                          <div className="session-meta">
                            {session.ip_address && <span>{session.ip_address}</span>}
                            <span>Poslednja aktivnost: {formatDate(session.last_seen_at)}</span>
                          </div>
                        </div>
                        {!session.is_current && (
                          <button
                            className="session-revoke-btn"
                            onClick={() => handleRevokeSession(session.id)}
                            disabled={revokingSession === session.id}
                          >
                            {revokingSession === session.id ? 'Uklanjanje...' : 'Ukloni'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'security' && (
            <div className="settings-section">
              <div className="settings-section-header">
                <h4>Promena lozinke</h4>
              </div>
              <form onSubmit={handleChangePassword} className="password-change-form">
                <div className="form-group">
                  <label htmlFor="newPassword">Nova lozinka</label>
                  <input
                    type="password"
                    id="newPassword"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Unesite novu lozinku"
                    disabled={changingPassword}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="confirmPassword">Potvrdite lozinku</label>
                  <input
                    type="password"
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Potvrdite novu lozinku"
                    disabled={changingPassword}
                    required
                  />
                </div>
                <div className="password-requirements">
                  <p>Lozinka mora sadržati:</p>
                  <ul>
                    <li>Najmanje 8 karaktera</li>
                    <li>Veliko i malo slovo</li>
                    <li>Broj</li>
                    <li>Specijalni karakter (!@#$%^&* itd.)</li>
                  </ul>
                </div>
                {passwordError && <div className="form-error">{passwordError}</div>}
                {passwordSuccess && <div className="form-success">{passwordSuccess}</div>}
                <button
                  type="submit"
                  className="settings-btn settings-btn-primary"
                  disabled={changingPassword}
                >
                  {changingPassword ? 'Promena...' : 'Promeni lozinku'}
                </button>
              </form>
            </div>
          )}

          {activeTab === 'danger' && (
            <div className="settings-section">
              <div className="settings-section-header">
                <h4>Opasna zona</h4>
              </div>
              <div className="settings-info-group">
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                  Brisanje naloga će onemogućiti pristup svim funkcijama i otkazati aktivne pretplate.
                  Imate 30 dana da vratite nalog pre trajnog brisanja svih podataka.
                </p>
              </div>
              <div className="settings-actions">
                <button
                  className="settings-btn settings-btn-danger"
                  onClick={() => setDeleteModalOpen(true)}
                >
                  Obriši nalog
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <DeleteAccountModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onAccountDeleted={() => {
          setDeleteModalOpen(false);
          onClose();
          onAccountDeleted();
        }}
        userStatus={userStatus}
      />

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ isOpen: false, type: '', sessionId: null })}
        onConfirm={handleConfirmDialogAction}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText="Potvrdi"
        cancelText="Otkaži"
        type="danger"
      />

      <ErrorDialog
        isOpen={errorDialog.isOpen}
        onClose={() => setErrorDialog({ isOpen: false, message: '' })}
        message={errorDialog.message}
      />

      <InfoDialog
        isOpen={infoDialog.isOpen}
        onClose={() => setInfoDialog({ isOpen: false, message: '' })}
        title="Uspešno"
        message={infoDialog.message}
      />
    </>
  );
};

export default SettingsModal;
