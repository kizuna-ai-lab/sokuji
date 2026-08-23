// src/components/TitleBar/AccountPopover.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

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
