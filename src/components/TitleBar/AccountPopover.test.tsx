// src/components/TitleBar/AccountPopover.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import AccountPopover from './AccountPopover';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));
let signedIn = true;
vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: signedIn }),
}));
vi.mock('../Auth/UserAccountInfo', () => ({
  UserAccountInfo: () => <div data-testid="account-info" />,
}));
let navigateImpl = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateImpl }));

beforeEach(() => { cleanup(); signedIn = true; });

describe('AccountPopover signed in', () => {
  it('renders nothing while closed', () => {
    render(<AccountPopover open={false} anchorEl={null} onClose={vi.fn()} />);
    expect(screen.queryByTestId('account-info')).toBeNull();
  });

  it('renders the account panel when open', () => {
    render(<AccountPopover open anchorEl={document.body} onClose={vi.fn()} />);
    expect(screen.getByTestId('account-info')).toBeTruthy();
  });
});

describe('AccountPopover signed out', () => {
  it('offers both routes, so a returning user is not stranded on sign-up', () => {
    signedIn = false;
    render(<AccountPopover open anchorEl={document.body} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /sign up/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  it('navigates to the right route from each button', () => {
    signedIn = false;
    const nav = vi.fn();
    navigateImpl = nav;
    render(<AccountPopover open anchorEl={document.body} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));
    expect(nav).toHaveBeenCalledWith('/sign-up');
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(nav).toHaveBeenCalledWith('/sign-in');
  });
});
