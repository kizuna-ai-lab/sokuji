/**
 * Sign-up page component using Better Auth
 */

import React from 'react';
import { SignUpForm } from '../components/Auth/SignUpForm';
import { AuthLayout } from '../components/Auth/AuthLayout';

export function SignUp() {
  return (
    <AuthLayout>
      <SignUpForm />
    </AuthLayout>
  );
}