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
import './ForgotPasswordForm.scss';

type Step = 'email' | 'otp';

export function ForgotPasswordForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();

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

    const result = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: 'forget-password',
    });

    if (result?.error) {
      console.error('Send OTP error:', result.error);

      if (result.error.status === 429 || result.error.message?.includes('Too many')) {
        setError(t('auth.rateLimitExceeded'));
        setCooldownSeconds(60);
      } else if (result.error.message?.toLowerCase().includes('network') || result.error.message?.toLowerCase().includes('fetch')) {
        setError(t('auth.networkError'));
      } else {
        setError(result.error.message || t('auth.forgotPasswordError'));
      }
      setLoading(false);
      return;
    }

    // Success - move to OTP step
    setStep('otp');
    setCooldownSeconds(60);
    setLoading(false);
  };

  // Resend OTP
  const handleResendOTP = async () => {
    if (cooldownSeconds > 0) return;

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
      return;
    }

    // Validate password length
    if (newPassword.length < 8) {
      setError(t('auth.passwordTooShort'));
      return;
    }

    setLoading(true);

    const result = await authClient.emailOtp.resetPassword({
      email,
      otp,
      password: newPassword,
    });

    if (result?.error) {
      console.error('Reset password error:', result.error);

      if (result.error.code === 'INVALID_OTP' || result.error.message?.toLowerCase().includes('invalid')) {
        setError(t('auth.invalidOTP'));
      } else if (result.error.code === 'OTP_EXPIRED' || result.error.message?.toLowerCase().includes('expired')) {
        setError(t('auth.otpExpired'));
      } else if (result.error.status === 429 || result.error.message?.includes('Too many')) {
        setError(t('auth.rateLimitExceeded'));
      } else {
        setError(result.error.message || t('auth.resetPasswordError'));
      }
      setLoading(false);
      return;
    }

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
          <Link to="/sign-in">
            {t('auth.backToSignIn')}
          </Link>
        </p>
      </div>
    </div>
  );
}
