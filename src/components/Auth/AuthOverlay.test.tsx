// Authentication renders OVER the app, never instead of it.
//
// SignIn used to be a sibling of Home in the router, so navigating to it
// unmounted the entire tree — providers, layout, and any live translation
// session — before the user had typed a character. These tests pin the
// overlay's contract; that the tree survives is a property only the running
// app can show, and it is verified there.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AuthOverlay from './AuthOverlay';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

vi.mock('./SignInForm', () => ({ SignInForm: () => <div data-testid="sign-in-form" /> }));
vi.mock('./SignUpForm', () => ({ SignUpForm: () => <div data-testid="sign-up-form" /> }));
vi.mock('./ForgotPasswordForm', () => ({
  ForgotPasswordForm: () => <div data-testid="forgot-form" />,
}));

let overlay: string | null = null;
const setOverlay = vi.fn();
vi.mock('../../stores/settingsStore', () => ({
  useAuthOverlay: () => overlay,
  useSetAuthOverlay: () => setOverlay,
}));

beforeEach(() => {
  cleanup();
  overlay = null;
  setOverlay.mockClear();
});

describe('AuthOverlay', () => {
  it('renders nothing when no form is requested', () => {
    const { container } = render(<AuthOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the sign-in form', () => {
    overlay = 'sign-in';
    render(<AuthOverlay />);
    expect(screen.getByTestId('sign-in-form')).toBeTruthy();
  });

  it('shows the sign-up form', () => {
    overlay = 'sign-up';
    render(<AuthOverlay />);
    expect(screen.getByTestId('sign-up-form')).toBeTruthy();
  });

  it('shows the forgot-password form', () => {
    overlay = 'forgot-password';
    render(<AuthOverlay />);
    expect(screen.getByTestId('forgot-form')).toBeTruthy();
  });

  it('closes by clearing the store, not by navigating', () => {
    overlay = 'sign-in';
    render(<AuthOverlay />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(setOverlay).toHaveBeenCalledWith(null);
  });

  // A full-page route got this from the browser for free; an overlay has to
  // supply it.
  it('closes on Escape', () => {
    overlay = 'sign-in';
    render(<AuthOverlay />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(setOverlay).toHaveBeenCalledWith(null);
  });

  it('does not listen for Escape while closed', () => {
    render(<AuthOverlay />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(setOverlay).not.toHaveBeenCalled();
  });

  it('names the dialog for a screen reader', () => {
    overlay = 'sign-in';
    render(<AuthOverlay />);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('aria-label')).toBeTruthy();
  });
});
