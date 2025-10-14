/**
 * Sign-up page component using Better Auth
 */

import { useNavigate } from 'react-router-dom';
import { SignUpForm } from '../components/Auth/SignUpForm';
import { AuthLayout } from '../components/Auth/AuthLayout';

export function SignUp() {
  const navigate = useNavigate();

  const handleClose = () => {
    navigate('/');
  };

  return (
    <AuthLayout onClose={handleClose}>
      <SignUpForm />
    </AuthLayout>
  );
}