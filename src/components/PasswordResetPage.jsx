import React, { useState, useEffect } from 'react';
import apiService from '../services/api';
import './PasswordResetPage.css';

const PasswordResetPage = () => {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    // Extract token from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    if (urlToken) {
      setToken(urlToken);
    } else {
      setError('Neispravan link za resetovanje lozinke.');
    }
  }, []);

  const validateForm = () => {
    const errors = {};

    if (!password) {
      errors.password = 'Lozinka je obavezna';
    } else if (password.length < 8) {
      errors.password = 'Lozinka mora imati najmanje 8 karaktera';
    } else {
      // Strong password validation
      const hasUpper = /[A-Z]/.test(password);
      const hasLower = /[a-z]/.test(password);
      const hasDigit = /\d/.test(password);
      const hasSpecial = /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password);

      if (!(hasUpper && hasLower && hasDigit && hasSpecial)) {
        errors.password = 'Lozinka mora sadržavati velika i mala slova, broj i specijalni karakter';
      }
    }

    if (!confirmPassword) {
      errors.confirmPassword = 'Potvrda lozinke je obavezna';
    } else if (password !== confirmPassword) {
      errors.confirmPassword = 'Lozinke se ne poklapaju';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!token) {
      setError('Neispravan link za resetovanje lozinke.');
      return;
    }

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      const result = await apiService.resetPassword(token, password);
      setSuccess(result.message || 'Lozinka je uspešno promenjena!');
      
      // Redirect to login after 3 seconds
      setTimeout(() => {
        window.location.href = '/';
      }, 3000);
    } catch (err) {
      console.error('Password reset error:', err);
      setError(err.message || 'Greška prilikom resetovanja lozinke. Pokušajte ponovo.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    if (field === 'password') {
      setPassword(value);
    } else if (field === 'confirmPassword') {
      setConfirmPassword(value);
    }
    
    // Clear field error when user starts typing
    if (fieldErrors[field]) {
      setFieldErrors(prev => ({ ...prev, [field]: '' }));
    }
    // Clear general error
    if (error) setError('');
  };

  if (!token && !error) {
    return (
      <div className="reset-container">
        <div className="reset-card">
          <div className="loading">Učitavanje...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="reset-container">
      <div className="reset-card">
        <div className="reset-header">
          <h1>Resetovanje lozinke</h1>
          <p>Unesite novu lozinku za vaš nalog.</p>
        </div>

        <form onSubmit={handleSubmit} className="reset-form">
          <div className="form-group">
            <label htmlFor="password" className="form-label">Nova lozinka</label>
            <input
              id="password"
              type="password"
              className={`form-input ${fieldErrors.password ? 'error' : ''}`}
              value={password}
              onChange={(e) => handleInputChange('password', e.target.value)}
              placeholder="Unesite novu lozinku"
              disabled={isLoading}
              autoComplete="new-password"
            />
            {fieldErrors.password && <div className="form-error">{fieldErrors.password}</div>}
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword" className="form-label">Potvrda nove lozinke</label>
            <input
              id="confirmPassword"
              type="password"
              className={`form-input ${fieldErrors.confirmPassword ? 'error' : ''}`}
              value={confirmPassword}
              onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
              placeholder="Potvrdite novu lozinku"
              disabled={isLoading}
              autoComplete="new-password"
            />
            {fieldErrors.confirmPassword && <div className="form-error">{fieldErrors.confirmPassword}</div>}
          </div>

          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success">{success}</div>}

          <button
            type="submit"
            className="reset-submit"
            disabled={isLoading || !token}
          >
            {isLoading ? (
              <>
                <div className="loading-spinner"></div>
                Resetovanje...
              </>
            ) : (
              'Resetuj lozinku'
            )}
          </button>
        </form>

        <div className="reset-footer">
          <a href="/" className="back-link">
            ← Nazad na početnu
          </a>
        </div>
      </div>
    </div>
  );
};

export default PasswordResetPage;