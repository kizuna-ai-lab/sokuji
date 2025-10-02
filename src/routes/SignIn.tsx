/**
 * Sign-in page component using Better Auth
 */

import React from 'react';
import { SignInForm } from '../components/Auth/SignInForm';
import { AuthLayout } from '../components/Auth/AuthLayout';

export function SignIn() {
  return (
    <AuthLayout>
      <SignInForm />
    </AuthLayout>
  );
}