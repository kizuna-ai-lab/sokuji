import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Alert } from '@/components/ui/Alert';
import { authClient } from '@/lib/auth-client';
import { useAnalytics } from '@/lib/analytics';

export function VerifyToken() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { trackEvent, identifyUser } = useAnalytics();
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(true);
  const hasVerified = useRef(false); // Prevent double verification in React Strict Mode

  const token = searchParams.get('token');
  const redirect = searchParams.get('redirect') || '/dashboard';

  useEffect(() => {
    // Prevent double execution in React Strict Mode
    if (hasVerified.current) return;
    hasVerified.current = true;

    const verifyToken = async () => {
      if (!token) {
        trackEvent('ott_verification_failed', { error_type: 'missing_token' });
        setError('No verification token provided');
        setVerifying(false);
        return;
      }

      trackEvent('ott_verification_started', {});

      try {
        const { data, error: verifyError } = await authClient.oneTimeToken.verify({
          token,
        });

        if (verifyError) {
          trackEvent('ott_verification_failed', { error_type: 'invalid_token' });
          setError('Invalid or expired token. Please sign in manually.');
          setVerifying(false);
          return;
        }

        // Track success and identify user
        trackEvent('ott_verification_succeeded', {});
        if (data?.user?.id) {
          identifyUser(data.user.id, data.user.email, { name: data.user.name });
        }

        // Redirect to intended destination
        navigate(redirect, { replace: true });
      } catch {
        trackEvent('ott_verification_failed', { error_type: 'unexpected' });
        setError('An unexpected error occurred. Please sign in manually.');
        setVerifying(false);
      }
    };

    verifyToken();
  }, [token, redirect, navigate, trackEvent, identifyUser]);

  if (verifying) {
    return (
      <AuthLayout title="Verifying..." subtitle="Please wait while we sign you in">
        <div className="auth-form" style={{ textAlign: 'center' }}>
          <div className="loading-spinner" style={{
            margin: '2rem auto',
            width: '40px',
            height: '40px',
            border: '3px solid rgba(255, 255, 255, 0.1)',
            borderTop: '3px solid #10a37f',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          <p style={{ color: 'var(--text-secondary)', marginTop: '1rem' }}>
            Authenticating your session...
          </p>
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Verification Failed" subtitle="We couldn't sign you in automatically">
      <div className="auth-form">
        {error && <Alert variant="error">{error}</Alert>}
        <p style={{ color: 'var(--text-secondary)', marginTop: '1rem', textAlign: 'center' }}>
          <a href="/sign-in" style={{ color: '#10a37f' }}>Click here to sign in</a>
        </p>
      </div>
    </AuthLayout>
  );
}
