/**
 * Sign In Form Component
 *
 * Custom sign-in form using Better Auth
 */

import React, { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authClient } from '../../lib/auth-client';
import { useTranslation } from 'react-i18next';
import './SignInForm.scss';

export function SignInForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { data, error } = await authClient.signIn.email({
      email,
      password,
    });

    if (error) {
      console.error('Sign in error:', error);

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
          <Link to="/sign-up">
            {t('auth.signUp', 'Sign Up')}
          </Link>
        </p>
      </div>
    </div>
  );
}
