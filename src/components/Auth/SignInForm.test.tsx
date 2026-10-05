import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { SignInForm } from './SignInForm';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn(), identifyUser: vi.fn() }) }));
vi.mock('../../lib/auth-client', () => ({ authClient: { signIn: { email: vi.fn(async () => ({ data: null, error: { code: 'INVALID_EMAIL_OR_PASSWORD' } })) } } }));

let reason: 'session_expired' | null = null;
const setAuthOverlay = vi.fn();
vi.mock('../../stores/settingsStore', () => ({
  useSetAuthOverlay: () => setAuthOverlay,
  useAuthOverlayReason: () => reason,
}));

beforeEach(() => { reason = null; setAuthOverlay.mockClear(); });
afterEach(cleanup);

describe('SignInForm — why it opened (spec 2026-10-05 §5, T4)', () => {
  it('opens clean by default', () => {
    const { container } = render(<SignInForm />);
    expect(container.querySelector('.error-message')).toBeNull();
  });

  it('says the session expired, in the card’s own message slot, when that is why it opened', () => {
    reason = 'session_expired';
    const { container } = render(<SignInForm />);
    expect(container.querySelector('.error-message')?.textContent).toBe('auth.sessionExpired');
  });

  it('a submit replaces it with the submit’s own outcome', async () => {
    reason = 'session_expired';
    const { container, findByText } = render(<SignInForm />);
    fireEvent.change(container.querySelector('#email')!, { target: { value: 'a@b.c' } });
    fireEvent.change(container.querySelector('#password')!, { target: { value: 'pw' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(await findByText('auth.invalidCredentials')).toBeTruthy();
  });
});
