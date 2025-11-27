/**
 * Sign Up Form Component
 *
 * Custom sign-up form using Better Auth
 */

import React, { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authClient } from '../../lib/auth-client';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../../lib/analytics';
import './SignUpForm.scss';

export function SignUpForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { trackEvent, identifyUser } = useAnalytics();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate passwords match
    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch', 'Passwords do not match'));
      return;
    }

    // Validate password length
    if (password.length < 8) {
      setError(t('auth.passwordTooShort', 'Password must be at least 8 characters'));
      return;
    }

    setLoading(true);

    // Track sign up attempt
    trackEvent('sign_up_attempted', { method: 'email' });

    const { data, error } = await authClient.signUp.email({
      email,
      password,
      name,
    });

    if (error) {
      console.error('Sign up error:', error);

      // Determine error type for analytics
      let errorType = 'unknown';
      if (error.code === 'USER_ALREADY_EXISTS') {
        errorType = 'user_already_exists';
      } else if (error.code === 'INVALID_EMAIL') {
        errorType = 'invalid_email';
      } else if (error.code === 'WEAK_PASSWORD') {
        errorType = 'weak_password';
      } else if (error.status === 429) {
        errorType = 'rate_limit';
      } else if (error.message?.toLowerCase().includes('network') || error.message?.toLowerCase().includes('fetch')) {
        errorType = 'network';
      } else {
        errorType = 'server';
      }

      // Track sign up failure
      trackEvent('sign_up_failed', { method: 'email', error_type: errorType });

      // Handle specific error codes
      if (error.code === 'USER_ALREADY_EXISTS') {
        setError(t('auth.emailExists', 'An account with this email already exists'));
      } else if (error.code === 'INVALID_EMAIL') {
        setError(t('auth.invalidEmail', 'Please enter a valid email address'));
      } else if (error.code === 'WEAK_PASSWORD') {
        setError(t('auth.weakPassword', 'Password is too weak. Use at least 8 characters with letters and numbers'));
      } else if (error.status === 429) {
        // Rate limiting
        setError(t('auth.rateLimitExceeded', 'Too many requests. Please wait a moment and try again'));
      } else if (error.message?.toLowerCase().includes('network') || error.message?.toLowerCase().includes('fetch')) {
        setError(t('auth.networkError', 'Network error. Please check your connection'));
      } else {
        // Generic error with server message if available
        setError(error.message || t('auth.signUpError', 'Sign up failed. Please try again'));
      }
      setLoading(false);
      return;
    }

    // Track sign up success and identify user with email
    trackEvent('sign_up_succeeded', { method: 'email' });
    if (data?.user?.id) {
      identifyUser(data.user.id, data.user.email, { name: data.user.name });
    }

    // Navigate to home on successful sign up
    setLoading(false);
    navigate('/', { replace: true });
  };

  return (
    <div className="sign-up-form">
      <h2>{t('auth.signUp', 'Sign Up')}</h2>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="name">
            {t('auth.name', 'Name')}
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={loading}
            placeholder={t('auth.namePlaceholder', 'Your name')}
          />
        </div>

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
            minLength={8}
          />
          <small className="hint">
            {t('auth.passwordHint', 'At least 8 characters')}
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="confirmPassword">
            {t('auth.confirmPassword', 'Confirm Password')}
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            disabled={loading}
            placeholder={t('auth.confirmPasswordPlaceholder', 'Confirm your password')}
          />
        </div>

        <button
          type="submit"
          className="submit-button"
          disabled={loading}
        >
          {loading ? (
            <span className="loading-spinner" />
          ) : (
            t('auth.signUp', 'Sign Up')
          )}
        </button>
      </form>

      <div className="form-footer">
        <p>
          {t('auth.haveAccount', 'Already have an account?')}{' '}
          <Link to="/sign-in" onClick={() => trackEvent('sign_in_link_clicked', {})}>
            {t('auth.signIn', 'Sign In')}
          </Link>
        </p>
      </div>
    </div>
  );
}
