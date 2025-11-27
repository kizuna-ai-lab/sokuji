import { useState, useEffect, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { authClient } from '@/lib/auth-client';
import { useAnalytics } from '@/lib/analytics';

type Step = 'email' | 'otp';

export function ForgotPassword() {
  const navigate = useNavigate();
  const { trackEvent } = useAnalytics();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // Track page view on mount
  useEffect(() => {
    trackEvent('dashboard_password_reset_initiated', {});
  }, []);

  // Cooldown timer
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

    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'forget-password',
      });

      if (result?.error) {
        trackEvent('dashboard_password_reset_failed', { error_type: result.error.status === 429 ? 'rate_limit' : 'send_otp_failed' });
        if (result.error.status === 429) {
          setError('Too many requests. Please wait a moment and try again');
          setCooldownSeconds(60);
        } else {
          setError(result.error.message || 'Failed to send verification code');
        }
        setLoading(false);
        return;
      }

      // Success - move to OTP step
      trackEvent('dashboard_password_reset_email_sent', {});
      setStep('otp');
      setCooldownSeconds(60);
    } catch {
      trackEvent('dashboard_password_reset_failed', { error_type: 'unexpected' });
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP
  const handleResendOTP = async () => {
    if (cooldownSeconds > 0) return;

    setError('');
    setLoading(true);

    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'forget-password',
      });

      if (result?.error) {
        if (result.error.status === 429) {
          setError('Too many requests. Please wait a moment and try again');
        } else {
          setError(result.error.message || 'Failed to resend code');
        }
      } else {
        setCooldownSeconds(60);
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify OTP and reset password
  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      const result = await authClient.emailOtp.resetPassword({
        email,
        otp,
        password: newPassword,
      });

      if (result?.error) {
        let errorType = 'unknown';
        if (result.error.code === 'INVALID_OTP') {
          errorType = 'invalid_otp';
          setError('Invalid verification code');
        } else if (result.error.code === 'OTP_EXPIRED') {
          errorType = 'otp_expired';
          setError('Verification code has expired. Please request a new one.');
        } else {
          setError(result.error.message || 'Failed to reset password');
        }
        trackEvent('dashboard_password_reset_failed', { error_type: errorType });
        setLoading(false);
        return;
      }

      // Success - redirect to sign in
      trackEvent('dashboard_password_reset_succeeded', {});
      navigate('/sign-in', { replace: true });
    } catch {
      trackEvent('dashboard_password_reset_failed', { error_type: 'unexpected' });
      setError('An unexpected error occurred');
      setLoading(false);
    }
  };

  if (step === 'otp') {
    return (
      <AuthLayout title="Reset password" subtitle={`Enter the code sent to ${email}`}>
        <form className="auth-form" onSubmit={handleResetPassword}>
          {error && <Alert variant="error">{error}</Alert>}

          <Input
            label="Verification Code"
            type="text"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            required
            disabled={loading}
            autoComplete="one-time-code"
          />

          <div className="auth-form__inline-link">
            <button
              type="button"
              onClick={handleResendOTP}
              disabled={loading || cooldownSeconds > 0}
              style={{
                background: 'none',
                border: 'none',
                color: cooldownSeconds > 0 ? 'var(--color-text-muted)' : 'var(--color-accent)',
                cursor: cooldownSeconds > 0 ? 'default' : 'pointer',
                fontSize: 'var(--font-xs)',
                padding: 0,
              }}
            >
              {cooldownSeconds > 0 ? `Resend code (${cooldownSeconds}s)` : 'Resend code'}
            </button>
          </div>

          <Input
            label="New Password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Minimum 8 characters"
            required
            disabled={loading}
            autoComplete="new-password"
          />

          <Input
            label="Confirm Password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            required
            disabled={loading}
            autoComplete="new-password"
          />

          <div className="auth-form__actions">
            <Button type="submit" fullWidth loading={loading} disabled={otp.length !== 6}>
              Reset Password
            </Button>
          </div>

          <p className="auth-form__link">
            <button
              type="button"
              onClick={() => {
                setStep('email');
                setOtp('');
                setNewPassword('');
                setConfirmPassword('');
                setError('');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-accent)',
                cursor: 'pointer',
                fontSize: 'var(--font-sm)',
                padding: 0,
              }}
            >
              <ArrowLeft size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              Use different email
            </button>
          </p>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Forgot password?" subtitle="Enter your email to reset your password">
      <form className="auth-form" onSubmit={handleSendOTP}>
        {error && <Alert variant="error">{error}</Alert>}

        <Input
          label="Email"
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          disabled={loading || cooldownSeconds > 0}
          autoComplete="email"
        />

        <div className="auth-form__actions">
          <Button type="submit" fullWidth loading={loading} disabled={cooldownSeconds > 0}>
            {cooldownSeconds > 0 ? `Send Code (${cooldownSeconds}s)` : 'Send Verification Code'}
          </Button>
        </div>

        <p className="auth-form__link">
          <Link to="/sign-in">
            <ArrowLeft size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
