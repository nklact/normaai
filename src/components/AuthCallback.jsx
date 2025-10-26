import React, { useEffect, useState } from 'react';
import { supabase } from '../services/api';

/**
 * AuthCallback component handles OAuth redirects from social login providers
 * It exchanges the auth code for a session and redirects back to the app
 */
const AuthCallback = ({ onSuccess }) => {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Get the session from the URL hash
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        if (session) {
          console.log('Auth callback successful, session:', session);

          // Call onSuccess callback if provided
          if (onSuccess) {
            onSuccess({
              success: true,
              user: session.user,
              session: session
            });
          }

          // Redirect to main app
          window.location.href = '/';
        } else {
          throw new Error('No session found');
        }
      } catch (error) {
        console.error('Auth callback error:', error);
        setError(error.message || 'Authentication failed');
        setLoading(false);

        // Redirect to home after 3 seconds
        setTimeout(() => {
          window.location.href = '/';
        }, 3000);
      }
    };

    handleAuthCallback();
  }, [onSuccess]);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.spinner}></div>
        <p style={styles.text}>Completing sign in...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.errorIcon}>⚠️</div>
        <p style={styles.errorText}>{error}</p>
        <p style={styles.subText}>Redirecting to home...</p>
      </div>
    );
  }

  return null;
};

// Inline styles for simplicity
const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  spinner: {
    border: '4px solid #f3f3f3',
    borderTop: '4px solid #3498db',
    borderRadius: '50%',
    width: '40px',
    height: '40px',
    animation: 'spin 1s linear infinite',
  },
  text: {
    marginTop: '20px',
    fontSize: '16px',
    color: '#333',
  },
  errorIcon: {
    fontSize: '48px',
    marginBottom: '20px',
  },
  errorText: {
    fontSize: '16px',
    color: '#e74c3c',
    marginBottom: '10px',
  },
  subText: {
    fontSize: '14px',
    color: '#7f8c8d',
  },
};

// Add keyframe animation for spinner
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

export default AuthCallback;
