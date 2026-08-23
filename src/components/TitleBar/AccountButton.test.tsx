// src/components/TitleBar/AccountButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AccountButton from './AccountButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

let signedIn = false;
let authUser: any = null;
vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: signedIn }),
  useUser: () => ({ isLoaded: true, user: authUser, refetch: vi.fn() }),
}));

let quota: any = null;
vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ quota, refetchAll: vi.fn() }),
}));

let providerId = 'openai';
vi.mock('../../stores/settingsStore', () => ({
  useProvider: () => providerId,
  useTextOnly: () => false,
}));

beforeEach(() => {
  cleanup();
  signedIn = false;
  authUser = null;
  quota = null;
  providerId = 'openai';
});

describe('AccountButton', () => {
  it('shows a generic person mark and no initial when signed out', () => {
    render(<AccountButton />);
    const btn = screen.getByRole('button');
    expect(btn.querySelector('svg')).toBeTruthy();
    expect(btn.querySelector('.account-button__initial')).toBeNull();
  });

  it('shows the uppercased initial of the name when signed in', () => {
    signedIn = true;
    authUser = { name: 'jiang zhuo', email: 'you@example.com', emailVerified: true };
    render(<AccountButton />);
    expect(screen.getByText('J')).toBeTruthy();
  });

  it('falls back to the e-mail when the account has no name', () => {
    signedIn = true;
    authUser = { name: null, email: 'zed@example.com', emailVerified: true };
    render(<AccountButton />);
    expect(screen.getByText('Z')).toBeTruthy();
  });

  it('renders the balance compactly, not at full precision', () => {
    signedIn = true;
    authUser = { name: 'J', email: 'you@example.com', emailVerified: true };
    quota = { balance: 1_552 };
    render(<AccountButton />);
    expect(screen.getByText('< $0.01')).toBeTruthy();
  });

  it('renders no balance label at all when signed out', () => {
    render(<AccountButton />);
    expect(screen.queryByText(/\$/)).toBeNull();
  });
});

describe('AccountButton status dot', () => {
  const signIn = (over: Partial<{ emailVerified: boolean }> = {}) => {
    signedIn = true;
    authUser = { name: 'J', email: 'you@example.com', emailVerified: true, ...over };
  };

  it('shows nothing while signed out, even with no verified e-mail', () => {
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')).toBeNull();
  });

  it('shows an amber dot for an unverified e-mail on any provider', () => {
    signIn({ emailVerified: false });
    quota = { balance: 12_340_000 };
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')!.getAttribute('data-tone'))
      .toBe('unverified');
  });

  it('does NOT warn about a low balance under a BYOK provider', () => {
    // The wallet funds nothing here, so the balance is not the user's problem.
    signIn();
    quota = { balance: 1 };
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')).toBeNull();
  });

  it('shows a red dot for a low balance under a managed provider', () => {
    providerId = 'kizunaai_soniox';
    signIn();
    quota = { balance: 1 };
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')!.getAttribute('data-tone'))
      .toBe('low');
  });

  it('lets red outrank amber when both apply', () => {
    providerId = 'kizunaai_soniox';
    signIn({ emailVerified: false });
    quota = { balance: 1 };
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')!.getAttribute('data-tone'))
      .toBe('low');
  });

  it('shows no dot when verified and funded', () => {
    providerId = 'kizunaai_soniox';
    signIn();
    quota = { balance: 12_340_000 };
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')).toBeNull();
  });
});

describe('AccountButton accessibility', () => {
  const signIn = (over: Partial<{ emailVerified: boolean }> = {}) => {
    signedIn = true;
    authUser = { name: 'J', email: 'you@example.com', emailVerified: true, ...over };
  };

  // The dot is aria-hidden, so without this the entire early-warning value of
  // the status dot is invisible to a screen reader: the button would just say
  // "Account" whether or not the session is about to be refused.
  it('names the low-balance state in the accessible label', () => {
    providerId = 'kizunaai_soniox';
    signIn();
    quota = { balance: 1 };
    render(<AccountButton />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/balance/i);
  });

  it('names the unverified state in the accessible label', () => {
    signIn({ emailVerified: false });
    quota = { balance: 12_340_000 };
    render(<AccountButton />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toMatch(/verif/i);
  });

  it('says just "Account" when there is nothing to report', () => {
    signIn();
    quota = { balance: 12_340_000 };
    render(<AccountButton />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Account');
  });
});
