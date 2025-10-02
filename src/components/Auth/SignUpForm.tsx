/**
 * Sign Up Form Component
 *
 * Custom sign-up form using Better Auth
 */

import React, { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authClient } from '../../lib/auth-client';
import { useTranslation } from 'react-i18next';
import './SignUpForm.scss';

export function SignUpForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
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

    try {
      await authClient.signUp.email({
        email,
        password,
        name,
      });

      // Navigate to home on successful sign up
      navigate('/', { replace: true });
    } catch (err: any) {
      console.error('Sign up error:', err);

      // Handle specific error messages
      if (err.message?.includes('already exists')) {
        setError(t('auth.emailExists', 'An account with this email already exists'));
      } else if (err.message?.includes('Invalid email')) {
        setError(t('auth.invalidEmail', 'Please enter a valid email address'));
      } else {
        setError(t('auth.signUpError', 'An error occurred. Please try again.'));
      }
    } finally {
      setLoading(false);
    }
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
          <Link to="/sign-in">
            {t('auth.signIn', 'Sign In')}
          </Link>
        </p>
      </div>
    </div>
  );
}
