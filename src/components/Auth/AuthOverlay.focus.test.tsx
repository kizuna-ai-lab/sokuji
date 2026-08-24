// aria-modal is a promise to a screen reader; focus management is what makes
// it true.
//
// The overlay opens from the account popover, whose own FloatingFocusManager
// hands focus back to the title-bar button as it closes. So without this the
// keyboard user is left standing outside a dialog that has just declared
// everything around it unavailable — able to tab through, and activate, the
// application controls behind the scrim.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import AuthOverlay from './AuthOverlay';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

// Real focusable controls: a form stubbed as an empty div cannot show whether
// focus moved into it.
vi.mock('./SignInForm', () => ({
  SignInForm: () => (
    <form>
      <input aria-label="Email" />
      <input aria-label="Password" type="password" />
      <button type="submit">Sign In</button>
    </form>
  ),
}));
vi.mock('./SignUpForm', () => ({ SignUpForm: () => <div /> }));
vi.mock('./ForgotPasswordForm', () => ({ ForgotPasswordForm: () => <div /> }));

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
  document.body.innerHTML = '';
});

const dialog = () => document.querySelector('[role="dialog"]');

describe('AuthOverlay focus', () => {
  it('moves focus into the dialog when it opens', async () => {
    overlay = 'sign-in';
    render(<AuthOverlay />);
    await waitFor(() => {
      expect(dialog()!.contains(document.activeElement)).toBe(true);
    });
  });

  // The control the user is looking for is in the form, not the close button.
  it('does not leave focus on the page behind the scrim', async () => {
    // Something focusable outside the dialog, standing in for the app.
    const outside = document.createElement('button');
    outside.textContent = 'Behind';
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    overlay = 'sign-in';
    render(<AuthOverlay />);
    await waitFor(() => expect(document.activeElement).not.toBe(outside));
  });

  it('still closes on Escape', async () => {
    overlay = 'sign-in';
    render(<AuthOverlay />);
    await waitFor(() => expect(dialog()!.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(setOverlay).toHaveBeenCalledWith(null));
  });

  it('still closes on the close button', async () => {
    overlay = 'sign-in';
    render(<AuthOverlay />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(setOverlay).toHaveBeenCalledWith(null);
  });

  // Guards the modal contract: while this is open the rest of the app must be
  // hidden from assistive technology, not merely painted over.
  it('hides the application behind it from assistive technology', async () => {
    const outside = document.createElement('div');
    outside.setAttribute('data-app', '');
    document.body.appendChild(outside);

    overlay = 'sign-in';
    render(<AuthOverlay />);
    await waitFor(() => {
      expect(outside.getAttribute('aria-hidden')).toBe('true');
    });
  });
});
