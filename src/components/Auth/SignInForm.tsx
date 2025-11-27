/**
 * Sign In Form Component
 *
 * Custom sign-in form using Better Auth
 */

import React, { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authClient } from '../../lib/auth-client';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../../lib/analytics';
import './SignInForm.scss';

export function SignInForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { trackEvent, identifyUser } = useAnalytics();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Track sign in attempt
    trackEvent('sign_in_attempted', { method: 'email' });

    const { data, error } = await authClient.signIn.email({
      email,
      password,
    });

    if (error) {
      console.error('Sign in error:', error);

      // Determine error type for analytics
      let errorType: 'invalid_credentials' | 'network' | 'rate_limit' | 'server' = 'server';
      if (error.code === 'INVALID_EMAIL_OR_PASSWORD' || error.code === 'USER_NOT_FOUND') {
        errorType = 'invalid_credentials';
      } else if (error.status === 429) {
        errorType = 'rate_limit';
      } else if (error.message?.toLowerCase().includes('network') || error.message?.toLowerCase().includes('fetch')) {
        errorType = 'network';
      }

      // Track sign in failure
      trackEvent('sign_in_failed', { method: 'email', error_type: errorType });

      // Handle specific error codes
      if (error.code === 'INVALID_EMAIL_OR_PASSWORD') {
        setError(t('auth.invalidCredentials', 'Invalid email or password'));
      } else if (error.code === 'USER_NOT_FOUND') {
        setError(t('auth.userNotFound', 'No account found with this email'));
      } else if (error.status === 403) {
        // Email verification required
        setError(t('auth.emailVerificationRequired', 'Please verify your email address before signing in'));
      } else if (error.status === 429) {
        // Rate limiting
        setError(t('auth.rateLimitExceeded', 'Too many requests. Please wait a moment and try again'));
      } else if (error.message?.toLowerCase().includes('network') || error.message?.toLowerCase().includes('fetch')) {
        setError(t('auth.networkError', 'Network error. Please check your connection'));
      } else {
        // Generic error with server message if available
        setError(error.message || t('auth.signInError', 'Sign in failed. Please try again'));
      }
      setLoading(false);
      return;
    }

    // Track sign in success and identify user with email
    trackEvent('sign_in_succeeded', { method: 'email' });
    if (data?.user?.id) {
      identifyUser(data.user.id, data.user.email, { name: data.user.name });
    }

    // Navigate to home on successful sign in
    setLoading(false);
    navigate('/', { replace: true });
  };

  return (
    <div className="sign-in-form">
      <h2>{t('auth.signIn', 'Sign In')}</h2>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="email">
            {t('auth.email', 'Email')}
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            placeholder={t('auth.emailPlaceholder', 'your@email.com')}
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">
            {t('auth.password', 'Password')}
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            placeholder={t('auth.passwordPlaceholder', 'Enter your password')}
          />
          <Link
            to="/forgot-password"
            className="forgot-password-link"
            onClick={() => trackEvent('forgot_password_link_clicked', {})}
          >
            {t('auth.forgotPassword', 'Forgot Password?')}
          </Link>
        </div>

        <button
          type="submit"
          className="submit-button"
          disabled={loading}
        >
          {loading ? (
            <span className="loading-spinner" />
          ) : (
            t('auth.signIn', 'Sign In')
          )}
        </button>
      </form>

      <div className="form-footer">
        <p>
          {t('auth.noAccount', "Don't have an account?")}{' '}
          <Link to="/sign-up" onClick={() => trackEvent('sign_up_link_clicked', {})}>
            {t('auth.signUp', 'Sign Up')}
          </Link>
        </p>
      </div>
    </div>
  );
}
