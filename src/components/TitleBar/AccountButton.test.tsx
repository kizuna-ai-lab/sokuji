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

vi.mock('../../stores/settingsStore', () => ({
  useProvider: () => 'openai',
  useTextOnly: () => false,
}));

beforeEach(() => {
  cleanup();
  signedIn = false;
  authUser = null;
  quota = null;
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
