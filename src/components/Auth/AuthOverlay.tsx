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
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useFloating,
  useDismiss,
  useRole,
  useInteractions,
  FloatingFocusManager,
  FloatingOverlay,
} from '@floating-ui/react';
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

  // No reference element: this is centred over the app, not anchored to
  // anything. useFloating is here for its open-state context, which is what
  // the focus manager and the dismiss interaction hang off.
  const { refs, context } = useFloating({
    open: overlay !== null,
    onOpenChange: (isOpen) => { if (!isOpen) close(); },
  });

  // A full-page route got Escape from the browser for free; an overlay has to
  // supply it. Outside presses are ignored on purpose — the scrim is not a
  // dismiss target here, because a misclick while typing a password should not
  // discard the form.
  const dismiss = useDismiss(context, { escapeKey: true, outsidePress: false });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

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
    <FloatingOverlay lockScroll className="auth-overlay-scrim">
      {/*
        modal: traps Tab inside the dialog and marks everything else
        aria-hidden, so the promise aria-modal makes is actually kept. Without
        it a keyboard user could tab straight back out to the application
        behind the scrim — and the overlay is usually opened from the account
        popover, whose own focus manager returns focus to the title-bar button
        as it closes, leaving the user outside the dialog to begin with.

        returnFocus hands focus back to whatever opened this once it closes.
      */}
      <FloatingFocusManager context={context} modal returnFocus>
        <div
          ref={refs.setFloating}
          aria-label={label}
          className="auth-overlay"
          {...getFloatingProps()}
        >
          <AuthLayout onClose={close}>{form}</AuthLayout>
        </div>
      </FloatingFocusManager>
    </FloatingOverlay>
  );
};

export default AuthOverlay;
