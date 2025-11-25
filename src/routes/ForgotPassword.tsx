/**
 * Forgot password page component using Better Auth
 */

import { useNavigate } from 'react-router-dom';
import { ForgotPasswordForm } from '../components/Auth/ForgotPasswordForm';
import { AuthLayout } from '../components/Auth/AuthLayout';

export function ForgotPassword() {
  const navigate = useNavigate();

  const handleClose = () => {
    navigate('/');
  };

  return (
    <AuthLayout onClose={handleClose}>
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
