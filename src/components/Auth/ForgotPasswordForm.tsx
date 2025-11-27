/**
 * Forgot Password Form Component
 *
 * OTP-based password reset flow using Better Auth email-otp plugin.
 * Step 1: User enters email to receive OTP
 * Step 2: User enters OTP and new password to reset
 */

import React, { useState, useEffect, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authClient } from '../../lib/auth-client';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../../lib/analytics';
import './ForgotPasswordForm.scss';

type Step = 'email' | 'otp';

export function ForgotPasswordForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { trackEvent } = useAnalytics();

  // Track password reset initiated on component mount
  useEffect(() => {
    trackEvent('password_reset_initiated', {});
  }, []);

  // Form state
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // UI state
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // Cooldown timer effect
  useEffect(() => {
    if (cooldownSeconds > 0) {
      const timer = setTimeout(() => setCooldownSeconds(cooldownSeconds - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldownSeconds]);

  // Step 1: Send OTP to email
  const handleSendOTP = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (cooldownSeconds > 0) return;

    setLoading(true);

    // Track OTP request
    trackEvent('otp_requested', {});

    const result = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: 'forget-password',
    });

    if (result?.error) {
      console.error('Send OTP error:', result.error);

      // Determine error type for analytics
      let errorType: 'rate_limit' | 'invalid_email' | 'network' | 'server' = 'server';
      if (result.error.status === 429 || result.error.message?.includes('Too many')) {
        errorType = 'rate_limit';
        setError(t('auth.rateLimitExceeded'));
        setCooldownSeconds(60);
      } else if (result.error.message?.toLowerCase().includes('network') || result.error.message?.toLowerCase().includes('fetch')) {
        errorType = 'network';
        setError(t('auth.networkError'));
      } else {
        setError(result.error.message || t('auth.forgotPasswordError'));
      }

      // Track OTP request failure
      trackEvent('otp_request_failed', { error_type: errorType });

      setLoading(false);
      return;
    }

    // Track OTP request success
    trackEvent('otp_request_succeeded', {});

    // Success - move to OTP step
    setStep('otp');
    setCooldownSeconds(60);
    setLoading(false);
  };

  // Resend OTP
  const handleResendOTP = async () => {
    if (cooldownSeconds > 0) return;

    // Track OTP resend click
    trackEvent('otp_resend_clicked', {});

    setError('');
    setLoading(true);

    const result = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: 'forget-password',
    });

    if (result?.error) {
      if (result.error.status === 429 || result.error.message?.includes('Too many')) {
        setError(t('auth.rateLimitExceeded'));
      } else {
        setError(result.error.message || t('auth.forgotPasswordError'));
      }
    } else {
      setCooldownSeconds(60);
    }

    setLoading(false);
  };

  // Step 2: Verify OTP and reset password
  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordsDoNotMatch'));
      trackEvent('password_reset_failed', { error_type: 'validation_error' });
      return;
    }

    // Validate password length
    if (newPassword.length < 8) {
      setError(t('auth.passwordTooShort'));
      trackEvent('password_reset_failed', { error_type: 'validation_error' });
      return;
    }

    setLoading(true);

    // Track password reset submission
    trackEvent('password_reset_submitted', {});

    const result = await authClient.emailOtp.resetPassword({
      email,
      otp,
      password: newPassword,
    });

    if (result?.error) {
      console.error('Reset password error:', result.error);

      // Determine error type for analytics
      let errorType: 'invalid_otp' | 'expired_otp' | 'validation_error' | 'network' = 'validation_error';

      if (result.error.code === 'INVALID_OTP' || result.error.message?.toLowerCase().includes('invalid')) {
        errorType = 'invalid_otp';
        setError(t('auth.invalidOTP'));
      } else if (result.error.code === 'OTP_EXPIRED' || result.error.message?.toLowerCase().includes('expired')) {
        errorType = 'expired_otp';
        setError(t('auth.otpExpired'));
      } else if (result.error.status === 429 || result.error.message?.includes('Too many')) {
        setError(t('auth.rateLimitExceeded'));
      } else if (result.error.message?.toLowerCase().includes('network') || result.error.message?.toLowerCase().includes('fetch')) {
        errorType = 'network';
        setError(t('auth.networkError'));
      } else {
        setError(result.error.message || t('auth.resetPasswordError'));
      }

      // Track password reset failure
      trackEvent('password_reset_failed', { error_type: errorType });

      setLoading(false);
      return;
    }

    // Track password reset success
    trackEvent('password_reset_succeeded', {});

    // Success - redirect to sign in
    setLoading(false);
    navigate('/sign-in', {
      replace: true,
      state: { message: t('auth.passwordResetSuccess') }
    });
  };

  return (
    <div className="forgot-password-form">
      <h2>{t('auth.resetPassword')}</h2>

      {step === 'email' ? (
        <>
          <p className="description">{t('auth.enterEmailForReset')}</p>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <form onSubmit={handleSendOTP}>
            <div className="form-group">
              <label htmlFor="email">
                {t('auth.email')}
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading || cooldownSeconds > 0}
                placeholder={t('auth.emailPlaceholder')}
              />
            </div>

            <button
              type="submit"
              className="submit-button"
              disabled={loading || cooldownSeconds > 0}
            >
              {loading ? (
                <span className="loading-spinner" />
              ) : cooldownSeconds > 0 ? (
                `${t('auth.sendOTP')} (${cooldownSeconds}s)`
              ) : (
                t('auth.sendOTP')
              )}
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="description">
            {t('auth.otpSentTo', { email })}
          </p>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <form onSubmit={handleResetPassword}>
            <div className="form-group">
              <label htmlFor="otp">
                {t('auth.verificationCode')}
              </label>
              <input
                id="otp"
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                disabled={loading}
                placeholder="000000"
                className="otp-input"
                maxLength={6}
                autoComplete="one-time-code"
              />
              <button
                type="button"
                className="resend-link"
                onClick={handleResendOTP}
                disabled={loading || cooldownSeconds > 0}
              >
                {cooldownSeconds > 0
                  ? `${t('auth.resendOTP')} (${cooldownSeconds}s)`
                  : t('auth.resendOTP')
                }
              </button>
            </div>

            <div className="form-group">
              <label htmlFor="newPassword">
                {t('auth.newPassword')}
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={loading}
                placeholder={t('auth.newPasswordPlaceholder')}
                minLength={8}
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">
                {t('auth.confirmPassword')}
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
                placeholder={t('auth.confirmPasswordPlaceholder')}
                minLength={8}
              />
            </div>

            <button
              type="submit"
              className="submit-button"
              disabled={loading || otp.length !== 6}
            >
              {loading ? (
                <span className="loading-spinner" />
              ) : (
                t('auth.resetPassword')
              )}
            </button>
          </form>

          <button
            type="button"
            className="back-button"
            onClick={() => {
              setStep('email');
              setOtp('');
              setNewPassword('');
              setConfirmPassword('');
              setError('');
            }}
          >
            {t('auth.changeEmail')}
          </button>
        </>
      )}

      <div className="form-footer">
        <p>
          <Link to="/sign-in" onClick={() => trackEvent('sign_in_link_clicked', {})}>
            {t('auth.backToSignIn')}
          </Link>
        </p>
      </div>
    </div>
  );
}
