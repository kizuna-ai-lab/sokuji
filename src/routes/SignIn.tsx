/**
 * Sign-in page component using Better Auth
 */

import { useNavigate } from 'react-router-dom';
import { SignInForm } from '../components/Auth/SignInForm';
import { AuthLayout } from '../components/Auth/AuthLayout';

export function SignIn() {
  const navigate = useNavigate();

  const handleClose = () => {
    navigate('/');
  };

  return (
    <AuthLayout onClose={handleClose}>
      <SignInForm />
    </AuthLayout>
  );
}