import React, { useState, useEffect, useRef } from 'react';
import Icon from './Icons';
import apiService from '../services/api';
import logo from '../assets/logo.svg';
import logoWhite from '../assets/logo-w.svg';
import './AuthPage.css';

const AuthPage = ({ onSuccess, initialTab = 'login', reason = null }) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Smart auth flow states
  const [authMode, setAuthMode] = useState('forgot'); // 'email', 'login', 'register', 'forgot'
  const [emailChecked, setEmailChecked] = useState(false);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: ''
  });

  const [fieldErrors, setFieldErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Refs for auto-focus
  const passwordInputRef = useRef(null);

  // Set initial mode based on initialTab prop
  useEffect(() => {
    if (initialTab === 'forgot') {
      setAuthMode('forgot');
    } else {
      setAuthMode('email');
    }
  }, [initialTab]);

  // Auto-focus password field when it appears (after email is checked)
  useEffect(() => {
    if (emailChecked && (authMode === 'login' || authMode === 'register') && passwordInputRef.current) {
      // Small delay to ensure the input is rendered and visible
      setTimeout(() => {
        passwordInputRef.current?.focus();
      }, 100);
    }
  }, [emailChecked, authMode]);

  // Carousel slides
  const slides = [
    {
      image: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?q=80&w=1200',
      title: 'Pravni saveti na dohvat ruke',
      description: 'Dobijte precizne odgovore na pravna pitanja zasnovane na srpskom zakonodavstvu'
    },
    {
      image: 'https://images.unsplash.com/photo-1505664194779-8beaceb93744?q=80&w=1200',
      title: 'Analiza dokumenata',
      description: 'Učitajte ugovore i dokumenta za trenutnu pravnu analizu'
    },
    {
      image: 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?q=80&w=1200',
      title: 'Brzo i pouzdano',
      description: 'Uštedite vreme i novac uz AI pravnog asistenta dostupnog 24/7'
    }
  ];

  // Auto-rotate carousel
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [slides.length]);

  // Helper function to validate email format
  const isValidEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors(prev => ({ ...prev, [field]: '' }));
    }
    if (error) setError('');

    // Reset email checked state if user modifies email
    if (field === 'email' && emailChecked) {
      setEmailChecked(false);
      setAuthMode('email');
    }
  };

  const checkEmailExists = async (email) => {
    try {
      setIsCheckingEmail(true);

      // Use the proper backend endpoint to check if user exists
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'https://norma-ai.fly.dev'}/api/auth/check-provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      if (!response.ok) {
        console.log('❌ Failed to check email, returning null to show both options');
        return null; // null = show both login and register buttons
      }

      const data = await response.json();
      console.log('🔍 Email check result:', data);

      // Use the explicit user_exists flag from backend
      // Backend checks all providers (email + OAuth) to determine if user exists
      if (data.user_exists) {
        console.log('✅ User exists - showing login form');
        return true; // Show login form
      }

      // User doesn't exist - show registration form
      console.log('❌ User does not exist - showing registration form');
      return false;
    } catch (err) {
      console.error('Error checking email:', err);
      // On network error, return null to show both options
      return null;
    } finally {
      setIsCheckingEmail(false);
    }
  };

  const handleEmailSubmit = async () => {
    // Validate email
    if (!formData.email) {
      setFieldErrors({ email: 'Email adresa je obavezna' });
      return;
    }
    if (!isValidEmail(formData.email)) {
      setFieldErrors({ email: 'Neispravna email adresa' });
      return;
    }

    // Check if email exists
    const exists = await checkEmailExists(formData.email);

    if (exists === true) {
      // User exists - show login form
      setEmailChecked(true);
      setAuthMode('login');
    } else if (exists === false) {
      // User doesn't exist - show registration form
      setEmailChecked(true);
      setAuthMode('register');
    } else {
      // Network error (exists === null) - show error but stay in email mode
      setFieldErrors({
        email: 'Ne mogu da se povežem sa serverom. Proverite internet konekciju i pokušajte ponovo.'
      });
      // Don't proceed - keep user in email mode to retry
      setEmailChecked(false);
      // authMode stays as 'email'
    }
  };

  const validateForm = () => {
    const errors = {};

    if (!formData.email) {
      errors.email = 'Email adresa je obavezna';
    } else if (!isValidEmail(formData.email)) {
      errors.email = 'Neispravna email adresa';
    }

    if (authMode !== 'forgot' && authMode !== 'email') {
      if (!formData.password) {
        errors.password = 'Lozinka je obavezna';
      } else if (formData.password.length < 8) {
        errors.password = 'Lozinka mora imati najmanje 8 karaktera';
      }
    }

    if (authMode === 'register') {
      if (!formData.confirmPassword) {
        errors.confirmPassword = 'Potvrda lozinke je obavezna';
      } else if (formData.password !== formData.confirmPassword) {
        errors.confirmPassword = 'Lozinke se ne poklapaju';
      }

      if (formData.password) {
        const hasUpper = /[A-Z]/.test(formData.password);
        const hasLower = /[a-z]/.test(formData.password);
        const hasDigit = /\d/.test(formData.password);
        const hasSpecial = /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(formData.password);

        if (!(hasUpper && hasLower && hasDigit && hasSpecial)) {
          errors.password = 'Lozinka mora sadržati velika i mala slova, broj i specijalni karakter';
        }
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // If in email mode, just check email
    if (authMode === 'email') {
      await handleEmailSubmit();
      return;
    }

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      let result;

      if (authMode === 'login') {
        result = await apiService.login(formData.email, formData.password);
        setSuccess('Uspešno ste se prijavili!');
      } else if (authMode === 'register') {
        result = await apiService.register(formData.email, formData.password);
        setSuccess(result.message || 'Uspešno ste se registrovali! Proverite email za verifikaciju.');
      } else if (authMode === 'forgot') {
        result = await apiService.forgotPassword(formData.email);
        setSuccess(result.message || 'Instrukcije za resetovanje lozinke su poslate na email.');

        setTimeout(() => {
          resetToEmailMode();
        }, 3000);
        return;
      }

      setTimeout(() => {
        onSuccess(result);
        setFormData({ email: '', password: '', confirmPassword: '' });
        setFieldErrors({});
        setSuccess('');
        setError('');
        setShowPassword(false);
        setShowConfirmPassword(false);
      }, 1500);

    } catch (err) {
      console.error('Auth error:', err);

      // Special handling for "user already exists" error during registration
      if (authMode === 'register' && err.message && err.message.includes('već registrovan')) {
        setError('Email je već registrovan. ');
        // Switch to login mode automatically
        setTimeout(() => {
          setAuthMode('login');
          setError('');
        }, 2000);
      } else {
        setError(err.message || 'Došlo je do greške. Pokušajte ponovo.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    // Prevent double-click
    if (isLoading) {
      console.log('⚠️ Google login already in progress, ignoring duplicate click');
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      const result = await apiService.signInWithGoogle();

      // Validate result before proceeding
      if (!result?.session) {
        throw new Error('OAuth prijava nije vratila validnu sesiju');
      }

      setSuccess('Uspešno ste se prijavili!');
      // Immediately call onSuccess without delay for better UX
      setTimeout(() => {
        onSuccess(result);
      }, 500);
    } catch (err) {
      console.error('Google login error:', err);

      // Check if user cancelled (common error messages for cancellation)
      const isCancelled = err.message && (
        err.message.includes('cancelled') ||
        err.message.includes('canceled') ||
        err.message.includes('User cancelled') ||
        err.message.includes('Authentication was cancelled') ||
        err.message.toLowerCase().includes('cancel')
      );

      // Check for network errors
      const isNetworkError = err.message && (
        err.message.includes('Network') ||
        err.message.includes('network') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('timeout')
      );

      // Only show error if it's not a cancellation
      if (isCancelled) {
        // User cancelled - just silently reset (user knows they cancelled)
        console.log('ℹ️ User cancelled OAuth flow');
      } else if (isNetworkError) {
        setError('Greška u vezi. Proverite internet konekciju i pokušajte ponovo.');
      } else {
        setError(err.message || 'Google prijava nije uspela');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAppleLogin = async () => {
    // Prevent double-click
    if (isLoading) {
      console.log('⚠️ Apple login already in progress, ignoring duplicate click');
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      const result = await apiService.signInWithApple();

      // Validate result before proceeding
      if (!result?.session) {
        throw new Error('OAuth prijava nije vratila validnu sesiju');
      }

      setSuccess('Uspešno ste se prijavili!');
      // Immediately call onSuccess without delay for better UX
      setTimeout(() => {
        onSuccess(result);
      }, 500);
    } catch (err) {
      console.error('Apple login error:', err);

      // Check if user cancelled (common error messages for cancellation)
      const isCancelled = err.message && (
        err.message.includes('cancelled') ||
        err.message.includes('canceled') ||
        err.message.includes('User cancelled') ||
        err.message.includes('Authentication was cancelled') ||
        err.message.toLowerCase().includes('cancel')
      );

      // Check for network errors
      const isNetworkError = err.message && (
        err.message.includes('Network') ||
        err.message.includes('network') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('timeout')
      );

      // Only show error if it's not a cancellation
      if (isCancelled) {
        // User cancelled - just silently reset (user knows they cancelled)
        console.log('ℹ️ User cancelled OAuth flow');
      } else if (isNetworkError) {
        setError('Greška u vezi. Proverite internet konekciju i pokušajte ponovo.');
      } else {
        setError(err.message || 'Apple prijava nije uspela');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const isIOS = Boolean(window.__TAURI__) && /iPhone|iPad|iPod/i.test(navigator.userAgent);

  const resetToEmailMode = () => {
    setAuthMode('email');
    setEmailChecked(false);
    setFormData({ email: '', password: '', confirmPassword: '' });
    setFieldErrors({});
    setError('');
    setSuccess('');
  };

  const switchToForgotPassword = () => {
    setAuthMode('forgot');
    setError('');
    setSuccess('');
    setFieldErrors({});
  };

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev + 1) % slides.length);
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
  };

  const getTitle = () => {
    if (authMode === 'forgot') return 'Resetovanje lozinke';
    if (authMode === 'login') return 'Dobrodošli nazad!';
    if (authMode === 'register') return 'Kreirajte nalog';
    return 'Prijavite se ili se registrujte da nastavite';
  };

  const getSubmitButtonText = () => {
    if (isLoading) {
      if (authMode === 'email' || isCheckingEmail) return 'Proveravanje...';
      if (authMode === 'login') return 'Prijavljivanje...';
      if (authMode === 'register') return 'Registracija...';
      if (authMode === 'forgot') return 'Slanje emaila...';
    }
    if (authMode === 'email') return 'Nastavite';
    if (authMode === 'login') return 'Prijavite se';
    if (authMode === 'register') return 'Registrujte se';
    if (authMode === 'forgot') return 'Pošalji link za resetovanje';
    return 'Nastavite';
  };

  return (
    <div className="auth-page">
      {/* Left side - Form */}
      <div className="auth-page-form-side">
        <div className="auth-page-form-container">
          {/* Logo/Brand */}
          <div className="auth-page-brand">
            <img
              src={logo}
              alt="Norma AI"
              className="auth-page-logo light-logo"
            />
            <img
              src={logoWhite}
              alt="Norma AI"
              className="auth-page-logo dark-logo"
            />
            <p className="auth-page-brand-subtitle">Vaš pravni asistent</p>
          </div>

          {/* Title */}
          <div className="auth-page-title">
            <h2>{getTitle()}</h2>
          </div>

          {/* Reason message */}
          {reason === 'trial_exhausted' && authMode !== 'forgot' && (
            <div className="auth-page-reason">
              <Icon name="info" size={20} />
              <div>
                <strong>Potrošili ste sve probne poruke</strong>
                <p>Prijavite se za nastavak korišćenja aplikacije.</p>
              </div>
            </div>
          )}

          {/* Social logins - MOVED TO TOP */}
          {authMode !== 'forgot' && (
            <>
              <div className="auth-page-social-top">
                {isIOS && (
                  <button
                    type="button"
                    onClick={handleAppleLogin}
                    disabled={isLoading}
                    className="auth-page-social-btn apple"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path fill="currentColor" d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                    </svg>
                    Nastavite sa Apple
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isLoading}
                  className="auth-page-social-btn google"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.96v2.332C2.438 15.983 5.482 18 9 18z"/>
                    <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71 0-.593.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
                    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.96 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
                  </svg>
                  Nastavite sa Google
                </button>
              </div>

              <div className="auth-page-divider">
                <span>ili koristite email</span>
              </div>
            </>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="auth-page-form">
            {/* Email field - always editable (industry standard UX) */}
            <div className="auth-page-form-group">
              <label htmlFor="email" className="auth-page-label">Email adresa</label>
              <input
                id="email"
                type="email"
                className={`auth-page-input ${fieldErrors.email ? 'error' : ''}`}
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                placeholder="unesite@email.com"
                disabled={isLoading}
                autoComplete="email"
              />
              {fieldErrors.email && <div className="auth-page-error">{fieldErrors.email}</div>}
            </div>

            {/* Password field - shown for login or register */}
            {(authMode === 'login' || authMode === 'register') && (
              <div className="auth-page-form-group">
                <label htmlFor="password" className="auth-page-label">Lozinka</label>
                <div className="auth-page-password-wrapper">
                  <input
                    ref={passwordInputRef}
                    id="password"
                    type={showPassword ? "text" : "password"}
                    className={`auth-page-input ${fieldErrors.password ? 'error' : ''}`}
                    value={formData.password}
                    onChange={(e) => handleInputChange('password', e.target.value)}
                    placeholder="Unesite lozinku"
                    disabled={isLoading}
                    autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  />
                  <button
                    type="button"
                    className="auth-page-password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isLoading}
                    tabIndex={-1}
                  >
                    <Icon name={showPassword ? 'eyeOff' : 'eye'} size={16} />
                  </button>
                </div>
                {fieldErrors.password && <div className="auth-page-error">{fieldErrors.password}</div>}
              </div>
            )}

            {/* Confirm password - shown only for register */}
            {authMode === 'register' && (
              <div className="auth-page-form-group">
                <label htmlFor="confirmPassword" className="auth-page-label">Potvrda lozinke</label>
                <div className="auth-page-password-wrapper">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    className={`auth-page-input ${fieldErrors.confirmPassword ? 'error' : ''}`}
                    value={formData.confirmPassword}
                    onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                    placeholder="Potvrdite lozinku"
                    disabled={isLoading}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="auth-page-password-toggle"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    disabled={isLoading}
                    tabIndex={-1}
                  >
                    <Icon name={showConfirmPassword ? 'eyeOff' : 'eye'} size={16} />
                  </button>
                </div>
                {fieldErrors.confirmPassword && <div className="auth-page-error">{fieldErrors.confirmPassword}</div>}
              </div>
            )}

            {error && <div className="auth-page-error">{error}</div>}
            {success && <div className="auth-page-success">{success}</div>}

            <button
              type="submit"
              className="auth-page-submit"
              disabled={isLoading || isCheckingEmail}
            >
              {isLoading || isCheckingEmail ? (
                <>
                  <div className="auth-page-loading"></div>
                  {getSubmitButtonText()}
                </>
              ) : (
                getSubmitButtonText()
              )}
            </button>

            {/* Terms and Privacy notice */}
            {authMode !== 'forgot' && (
              <div className="auth-page-terms">
                Nastavljanjem prihvatate naše{' '}
                <a href="https://normaai.rs/uslovi.html" target="_blank" rel="noopener noreferrer">
                  Uslove korišćenja
                </a>
                {' '}i{' '}
                <a href="https://normaai.rs/privatnost.html" target="_blank" rel="noopener noreferrer">
                  Politiku privatnosti
                </a>
                .
              </div>
            )}

            {/* Footer links */}
            {authMode === 'login' && (
              <div className="auth-page-footer-link">
                <button
                  type="button"
                  className="auth-page-link-btn"
                  onClick={switchToForgotPassword}
                  disabled={isLoading}
                >
                  Zaboravili ste lozinku?
                </button>
              </div>
            )}

            {authMode === 'forgot' && (
              <div className="auth-page-footer-link">
                <button
                  type="button"
                  className="auth-page-link-btn"
                  onClick={resetToEmailMode}
                  disabled={isLoading}
                >
                  ← Nazad na prijavu
                </button>
              </div>
            )}
          </form>
        </div>
      </div>

      {/* Right side - Carousel (hidden on mobile) */}
      <div className="auth-page-carousel-side">
        <div className="auth-page-carousel">
          {slides.map((slide, index) => (
            <div
              key={index}
              className={`auth-page-slide ${index === currentSlide ? 'active' : ''}`}
              style={{ backgroundImage: `url(${slide.image})` }}
            >
              <div className="auth-page-slide-overlay">
                <div className="auth-page-slide-content">
                  <h2>{slide.title}</h2>
                  <p>{slide.description}</p>
                </div>
              </div>
            </div>
          ))}

          {/* Navigation arrows */}
          <button
            className="auth-page-carousel-arrow prev"
            onClick={prevSlide}
            aria-label="Previous slide"
          >
            <Icon name="chevronLeft" size={24} />
          </button>
          <button
            className="auth-page-carousel-arrow next"
            onClick={nextSlide}
            aria-label="Next slide"
          >
            <Icon name="chevronRight" size={24} />
          </button>

          {/* Carousel indicators */}
          <div className="auth-page-carousel-indicators">
            {slides.map((_, index) => (
              <button
                key={index}
                className={`auth-page-indicator ${index === currentSlide ? 'active' : ''}`}
                onClick={() => setCurrentSlide(index)}
                aria-label={`Slide ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
