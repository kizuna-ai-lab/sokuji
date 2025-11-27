import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * ResetPassword page - redirects to ForgotPassword
 * Since we use OTP-based reset, the token-based flow is not needed.
 * This page handles any legacy links that might still point here.
 */
export function ResetPassword() {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to forgot-password page which handles the OTP flow
    navigate('/forgot-password', { replace: true });
  }, [navigate]);

  return null;
}
