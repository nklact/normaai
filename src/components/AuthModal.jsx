import React, { useState } from 'react';
import Modal from './Modal';
import Icon from './Icons';
import apiService from '../services/api';

const AuthModal = ({ isOpen, onClose, onSuccess, initialTab = 'login', reason = null }) => {
  const [activeTab, setActiveTab] = useState(initialTab);

  // Update activeTab when modal opens with new initialTab
  React.useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: ''
  });

  const [fieldErrors, setFieldErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear field error when user starts typing
    if (fieldErrors[field]) {
      setFieldErrors(prev => ({ ...prev, [field]: '' }));
    }
    // Clear general error
    if (error) setError('');
  };

  const validateForm = () => {
    const errors = {};
    
    // Email validation (required for all tabs)
    if (!formData.email) {
      errors.email = 'Email adresa je obavezna';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Neispravna email adresa';
    }

    // Password validation (only for login and register)
    if (activeTab !== 'forgot') {
      if (!formData.password) {
        errors.password = 'Lozinka je obavezna';
      } else if (formData.password.length < 8) {
        errors.password = 'Lozinka mora imati najmanje 8 karaktera';
      }
    }

    // Registration-specific validation
    if (activeTab === 'register') {
      if (!formData.confirmPassword) {
        errors.confirmPassword = 'Potvrda lozinke je obavezna';
      } else if (formData.password !== formData.confirmPassword) {
        errors.confirmPassword = 'Lozinke se ne poklapaju';
      }

      // Stronger password validation for registration
      if (formData.password) {
        const hasUpper = /[A-Z]/.test(formData.password);
        const hasLower = /[a-z]/.test(formData.password);
        const hasDigit = /\d/.test(formData.password);
        const hasSpecial = /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(formData.password);

        if (!(hasUpper && hasLower && hasDigit && hasSpecial)) {
          errors.password = 'Lozinka mora sadržavati velika i mala slova, broj i specijalni karakter';
        }
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      let result;

      if (activeTab === 'login') {
        result = await apiService.login(formData.email, formData.password);
        setSuccess('Uspešno ste se prijavili!');
      } else if (activeTab === 'register') {
        result = await apiService.register(formData.email, formData.password);
        setSuccess(result.message || 'Uspešno ste se registrovali! Proverite email za verifikaciju.');
      } else if (activeTab === 'forgot') {
        result = await apiService.forgotPassword(formData.email);
        setSuccess(result.message || 'Instrukcije za resetovanje lozinke su poslane na email.');

        // Stay in forgot tab to show success message
        setTimeout(() => {
          setActiveTab('login');
          setSuccess('');
        }, 3000);
        return;
      }

      // Wait a moment to show success message for login/register
      setTimeout(() => {
        onSuccess(result);
        onClose();
        // Reset form
        setFormData({ email: '', password: '', confirmPassword: '' });
        setFieldErrors({});
        setSuccess('');
        setError('');
        setShowPassword(false);
        setShowConfirmPassword(false);
      }, 1500);

    } catch (err) {
      console.error('Auth error:', err);
      setError(err.message || 'Došlo je do greške. Pokušajte ponovo.');
    } finally {
      setIsLoading(false);
    }
  };

  // Google login handler
  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError('');
    try {
      await apiService.signInWithGoogle();
      // OAuth redirect will happen automatically
    } catch (err) {
      console.error('Google login error:', err);
      setError(err.message || 'Google prijava nije uspela');
    } finally {
      setIsLoading(false);
    }
  };

  const switchTab = (tab) => {
    setActiveTab(tab);
    setError('');
    setSuccess('');
    setFieldErrors({});
  };

  const handleClose = () => {
    onClose();
    // Reset form when closing
    setTimeout(() => {
      setFormData({ email: '', password: '', confirmPassword: '' });
      setFieldErrors({});
      setError('');
      setSuccess('');
      setActiveTab(initialTab);
      setShowPassword(false);
      setShowConfirmPassword(false);
    }, 200);
  };

  const tabsContent = activeTab !== 'forgot' ? (
    <div className="auth-tabs">
      <button
        className={`auth-tab ${activeTab === 'login' ? 'active' : ''}`}
        onClick={() => switchTab('login')}
        disabled={isLoading}
      >
        Prijava
      </button>
      <button
        className={`auth-tab ${activeTab === 'register' ? 'active' : ''}`}
        onClick={() => switchTab('register')}
        disabled={isLoading}
      >
        Registracija
      </button>
    </div>
  ) : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={activeTab === 'login' ? 'Prijava' : activeTab === 'register' ? 'Registracija' : 'Resetovanje lozinke'}
      type="auth"
      tabs={tabsContent}
    >

      {reason === 'trial_exhausted' && activeTab !== 'forgot' && (
        <div className="auth-reason-message">
          <div className="reason-icon">
            <Icon name="info" size={20} />
          </div>
          <div className="reason-text">
            <strong>Potrošili ste sve probne poruke</strong>
            <p>Prijavite se ili registrujte nalog za neograničeno korišćenje aplikacije.</p>
          </div>
        </div>
      )}

      {reason === 'ip_limit_exceeded' && activeTab !== 'forgot' && (
        <div className="auth-reason-message">
          <div className="reason-icon">
            <Icon name="info" size={20} />
          </div>
          <div className="reason-text">
            <strong>Dostigli ste maksimalan broj probnih naloga</strong>
            <p>Vaša IP adresa je dostigla limit probnih naloga. Molimo registrujte se za nastavak korišćenja aplikacije.</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="auth-form">
        <div className="form-group">
          <label htmlFor="email" className="form-label">Email adresa</label>
          <input
            id="email"
            type="email"
            className={`form-input ${fieldErrors.email ? 'error' : ''}`}
            value={formData.email}
            onChange={(e) => handleInputChange('email', e.target.value)}
            placeholder="unesite@email.com"
            disabled={isLoading}
            autoComplete="email"
          />
          {fieldErrors.email && <div className="form-error">{fieldErrors.email}</div>}
        </div>

        {activeTab !== 'forgot' && (
          <div className="form-group">
            <label htmlFor="password" className="form-label">Lozinka</label>
            <div className="password-input-container">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                className={`form-input password-input ${fieldErrors.password ? 'error' : ''}`}
                value={formData.password}
                onChange={(e) => handleInputChange('password', e.target.value)}
                placeholder="Unesite lozinku"
                disabled={isLoading}
                autoComplete={activeTab === 'login' ? 'current-password' : 'new-password'}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLoading}
                tabIndex={-1}
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={16} />
              </button>
            </div>
            {fieldErrors.password && <div className="form-error">{fieldErrors.password}</div>}
          </div>
        )}

        {activeTab === 'register' && (
          <div className="form-group">
            <label htmlFor="confirmPassword" className="form-label">Potvrda lozinke</label>
            <div className="password-input-container">
              <input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                className={`form-input password-input ${fieldErrors.confirmPassword ? 'error' : ''}`}
                value={formData.confirmPassword}
                onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                placeholder="Potvrdite lozinku"
                disabled={isLoading}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                disabled={isLoading}
                tabIndex={-1}
              >
                <Icon name={showConfirmPassword ? 'eyeOff' : 'eye'} size={16} />
              </button>
            </div>
            {fieldErrors.confirmPassword && <div className="form-error">{fieldErrors.confirmPassword}</div>}
          </div>
        )}

        {error && <div className="form-error">{error}</div>}
        {success && <div className="form-success">{success}</div>}

        <button
          type="submit"
          className="auth-submit"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <div className="auth-loading"></div>
              {activeTab === 'login' ? 'Prijavljivanje...' :
               activeTab === 'register' ? 'Registracija...' :
               'Slanje emaila...'}
            </>
          ) : (
            activeTab === 'login' ? 'Prijavite se' :
            activeTab === 'register' ? 'Registrujte se' :
            'Pošalji link za resetovanje'
          )}
        </button>

        {/* Google login button - only show on login/register tabs */}
        {activeTab !== 'forgot' && (
          <>
            <div className="social-divider">
              <span>ili nastavite sa</span>
            </div>

            <div className="social-buttons">
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isLoading}
                className="social-button google"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                  <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                  <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.96v2.332C2.438 15.983 5.482 18 9 18z"/>
                  <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71 0-.593.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
                  <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.96 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
                </svg>
                Google
              </button>
            </div>
          </>
        )}

        {activeTab === 'login' && (
          <div className="forgot-password-link">
            <button
              type="button"
              className="link-button"
              onClick={() => switchTab('forgot')}
              disabled={isLoading}
            >
              Zaboravili ste lozinku?
            </button>
          </div>
        )}

        {activeTab === 'forgot' && (
          <div className="back-to-login">
            <button
              type="button"
              className="link-button"
              onClick={() => switchTab('login')}
              disabled={isLoading}
            >
              ← Nazad na prijavu
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
};

export default AuthModal;