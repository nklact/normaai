import React, { useState } from 'react';
import Modal from './Modal';
import Icon from './Icons';
import apiService from '../services/api';
import { formatDistanceToNow } from 'date-fns';
import { sr } from 'date-fns/locale';
import emailjs from '@emailjs/browser';

// EmailJS Configuration - Replace with your actual EmailJS credentials
const EMAILJS_CONFIG = {
  SERVICE_ID: 'YOUR_SERVICE_ID', // Replace with your EmailJS service ID
  TEMPLATE_ID_VERIFICATION: 'YOUR_VERIFICATION_TEMPLATE_ID', // Replace with verification template ID
  TEMPLATE_ID_RESET: 'YOUR_RESET_TEMPLATE_ID', // Replace with password reset template ID
  USER_ID: 'YOUR_USER_ID' // Replace with your EmailJS user ID
};

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

  // EmailJS helper function
  const sendVerificationEmail = async (email, token) => {
    try {
      const verificationUrl = `${window.location.origin}/verify-email?token=${token}`;
      
      await emailjs.send(
        EMAILJS_CONFIG.SERVICE_ID,
        EMAILJS_CONFIG.TEMPLATE_ID_VERIFICATION,
        {
          to_email: email,
          verification_url: verificationUrl,
          app_name: 'Norma AI'
        },
        EMAILJS_CONFIG.USER_ID
      );
      
      console.log('Verification email sent successfully via EmailJS');
      return true;
    } catch (error) {
      console.error('Failed to send verification email via EmailJS:', error);
      return false;
    }
  };

  const sendPasswordResetEmail = async (email, token) => {
    try {
      const resetUrl = `${window.location.origin}/reset-password?token=${token}`;
      
      await emailjs.send(
        EMAILJS_CONFIG.SERVICE_ID,
        EMAILJS_CONFIG.TEMPLATE_ID_RESET,
        {
          to_email: email,
          reset_url: resetUrl,
          app_name: 'Norma AI'
        },
        EMAILJS_CONFIG.USER_ID
      );
      
      console.log('Password reset email sent successfully via EmailJS');
      return true;
    } catch (error) {
      console.error('Failed to send password reset email via EmailJS:', error);
      return false;
    }
  };

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
        
        // Send verification email via EmailJS if token is provided
        if (result.verification_token) {
          const emailSent = await sendVerificationEmail(formData.email, result.verification_token);
          if (emailSent) {
            setSuccess(result.message || 'Uspešno ste se registrovali! Proverite email za verifikaciju.');
          } else {
            setSuccess((result.message || 'Uspešno ste se registrovali!') + ' Greška slanja email-a za verifikaciju.');
          }
        } else {
          setSuccess(result.message || 'Uspešno ste se registrovali!');
        }
      } else if (activeTab === 'forgot') {
        result = await apiService.forgotPassword(formData.email);
        
        // Send password reset email via EmailJS if token is provided
        if (result.reset_token && result.email) {
          const emailSent = await sendPasswordResetEmail(result.email, result.reset_token);
          if (emailSent) {
            setSuccess('Instrukcije za resetovanje lozinke su poslane na email.');
          } else {
            setSuccess('Greška slanja email-a. Pokušajte ponovo.');
          }
        } else {
          setSuccess(result.message || 'Ako email postoji, instrukcije su poslane.');
        }
        
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
            <p>Molimo registrujte se za nastavak.</p>
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