/**
 * Authentication, rendered over the app rather than in place of it.
 *
 * SignIn, SignUp and ForgotPassword used to be siblings of Home in the router.
 * Navigating to one unmounted the entire tree — UserProfileProvider,
 * OnboardingProvider, SettingsInitializer, MainLayout, MainPanel — and took any
 * running translation session with it, before the user had typed a character.
 * Signing in successfully then mounted all of it again from scratch.
 *
 * As an overlay, Home never unmounts, and the user keeps sight of whatever they
 * were configuring when they reached for the account.
 */
import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthOverlay, useSetAuthOverlay } from '../../stores/settingsStore';
import { AuthLayout } from './AuthLayout';
import { SignInForm } from './SignInForm';
import { SignUpForm } from './SignUpForm';
import { ForgotPasswordForm } from './ForgotPasswordForm';

const AuthOverlay: React.FC = () => {
  const { t } = useTranslation();
  const overlay = useAuthOverlay();
  const setOverlay = useSetAuthOverlay();

  const close = useCallback(() => setOverlay(null), [setOverlay]);

  // A full-page route got Escape from the browser for free; an overlay has to
  // supply it. Bound only while open, so it never competes with anything else
  // that wants the key.
  useEffect(() => {
    if (!overlay) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [overlay, close]);

  if (!overlay) return null;

  const form =
    overlay === 'sign-in' ? <SignInForm />
      : overlay === 'sign-up' ? <SignUpForm />
        : <ForgotPasswordForm />;

  const label =
    overlay === 'sign-in' ? t('common.signIn', 'Sign In')
      : overlay === 'sign-up' ? t('common.signUp', 'Sign Up')
        : t('auth.forgotPassword', 'Forgot Password');

  return (
    <div role="dialog" aria-modal="true" aria-label={label} className="auth-overlay">
      <AuthLayout onClose={close}>{form}</AuthLayout>
    </div>
  );
};

export default AuthOverlay;
