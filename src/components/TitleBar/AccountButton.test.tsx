// src/components/TitleBar/AccountButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import AccountButton from './AccountButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

const shortfall = vi.hoisted(() => ({ value: false }));
vi.mock('./useBalanceShortfall', () => ({ useBalanceShortfall: () => shortfall.value }));

// providerStore imports ServiceFactory at module scope, which chains into
// SettingsService and into i18n's own setup. Stubbed, as every other test
// that pulls in the real providerStore does, so this file stays scoped to
// AccountButton's wiring.
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: unknown) => d,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

let signedIn = false;
let authUser: any = null;
// A fresh function identity on every render, delegating to one spy. That is
// what better-auth's useSession actually hands back, and it is why the refresh
// hook keeps refetch in a ref instead of listing it in its effect deps.
const refetchSpy = vi.fn();
vi.mock('../../lib/auth/hooks', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: signedIn }),
  useUser: () => ({ isLoaded: true, user: authUser, refetch: () => refetchSpy() }),
}));

let quota: any = null;
let kizunaEnabled = true;
vi.mock('../../utils/environment', () => ({
  isKizunaAIEnabled: () => kizunaEnabled,
}));

vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ quota, refetchAll: vi.fn() }),
}));

let popoverRequested = false;
const setPopoverRequested = vi.fn((next: boolean) => { popoverRequested = next; });
vi.mock('../../stores/settingsStore', () => ({
  useTextOnly: () => false,
  useAccountPopoverRequested: () => popoverRequested,
  useSetAccountPopoverRequested: () => setPopoverRequested,
}));

// The popover itself is covered by AccountPopover.test.tsx; here it stands in
// only as a presence signal, so these tests stay about the wiring.
vi.mock('./AccountPopover', () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="account-popover" /> : null,
}));

beforeEach(() => {
  cleanup();
  kizunaEnabled = true;
  signedIn = false;
  authUser = null;
  quota = null;
  shortfall.value = false;
  popoverRequested = false;
  setPopoverRequested.mockClear();
  refetchSpy.mockClear();
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

  it('shows a red dot for a low balance under a managed provider', () => {
    shortfall.value = true;
    signIn();
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')!.getAttribute('data-tone'))
      .toBe('low');
  });

  it('lets red outrank amber when both apply', () => {
    shortfall.value = true;
    signIn({ emailVerified: false });
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')!.getAttribute('data-tone'))
      .toBe('low');
  });

  it('shows no dot when verified and funded', () => {
    shortfall.value = false;
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
    shortfall.value = true;
    signIn();
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

describe('AccountButton under the Kizuna master gate', () => {
  // A build with VITE_ENABLE_KIZUNA_AI unset registers no managed provider and
  // has no wallet, so an account is worth nothing there. Offering to register
  // would promise a service that build does not contain. AccountSection guarded
  // on this before it was removed; the guard has to survive the move.
  it('renders nothing at all when the Kizuna gate is closed', () => {
    kizunaEnabled = false;
    const { container } = render(<AccountButton />);
    expect(container.querySelector('.account-button')).toBeNull();
  });

  it('still renders nothing when the gate is closed and a user is signed in', () => {
    kizunaEnabled = false;
    signedIn = true;
    authUser = { name: 'J', email: 'you@example.com', emailVerified: true };
    quota = { balance: 12_340_000 };
    const { container } = render(<AccountButton />);
    expect(container.querySelector('.account-button')).toBeNull();
  });
});

describe('AccountButton popover', () => {
  it('opens the popover on click and closes it on a second click', () => {
    signedIn = true;
    authUser = { name: 'J', email: 'you@example.com', emailVerified: true };
    render(<AccountButton />);
    const btn = screen.getByRole('button');
    expect(screen.queryByTestId('account-popover')).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByTestId('account-popover')).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.queryByTestId('account-popover')).toBeNull();
  });

  it('opens the popover while signed out too — that is the registration entry', () => {
    render(<AccountButton />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('account-popover')).toBeTruthy();
  });

  it('opens on a request raised elsewhere, and clears the request behind it', () => {
    // The provider sign-in notice raises the store flag rather than owning a
    // second sign-in affordance. Asserted as a TRANSITION, not as a mount: a
    // flag that is already true on the first render would be honoured even by
    // an effect that ignores its own dependencies, and the flag has to be
    // cleared or the popover could never be closed again.
    const { rerender } = render(<AccountButton />);
    expect(screen.queryByTestId('account-popover')).toBeNull();

    popoverRequested = true;
    rerender(<AccountButton />);

    expect(screen.getByTestId('account-popover')).toBeTruthy();
    expect(setPopoverRequested).toHaveBeenCalledWith(false);
  });
});

describe('AccountButton e-mail verification', () => {
  const signIn = (emailVerified: boolean) => {
    signedIn = true;
    authUser = { name: 'J', email: 'you@example.com', emailVerified };
  };
  const regainFocus = () => act(() => { window.dispatchEvent(new Event('focus')); });

  // The user finishes verifying in a browser and switches back. Nothing in the
  // app notices on its own: the old polling ran only during the 60-second
  // resend cooldown, inside a component that is now mounted only while the
  // popover is open. AccountButton is always mounted, so the listener is here.
  it('refetches the session when the window regains focus while unverified', () => {
    signIn(false);
    render(<AccountButton />);
    regainFocus();
    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  // This used to stop once the e-mail was verified. Verified users are exactly
  // the ones moving between the app and the dashboard, so they are the ones
  // most likely to have signed out over there — dropping the session cookie
  // this app shares. Refetching on return is what lets the app notice, instead
  // of showing an avatar and a balance for a session the server has forgotten.
  it('keeps refetching after the e-mail is verified', () => {
    signIn(true);
    render(<AccountButton />);
    regainFocus();
    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it('verification shows as the dot clearing; nothing else (spec 2026-10-05 §5, T5)', () => {
    signIn(false);
    const { container, rerender } = render(<AccountButton />);
    expect(container.querySelector('.account-button__dot[data-tone="unverified"]')).not.toBeNull();
    signIn(true);
    rerender(<AccountButton />);
    expect(container.querySelector('.account-button__dot')).toBeNull();
  });
});

describe('AccountButton signed-out label', () => {
  // A bare 14px person glyph sitting between two labelled buttons reads as a
  // missing label, and says nothing about what clicking it does — on the one
  // control whose whole job is to be found by someone who has not signed up.
  it('labels the signed-out entry, like its neighbours', () => {
    render(<AccountButton />);
    expect(screen.getByRole('button').textContent).toContain('Sign In');
  });

  it('still shows no balance while signed out', () => {
    render(<AccountButton />);
    expect(screen.queryByText(/\$/)).toBeNull();
  });
});

describe("AccountButton balance dot — the start gate's own answer", () => {
  const signIn = () => {
    signedIn = true;
    authUser = { name: 'J', email: 'you@example.com', emailVerified: true };
  };

  // The dot is exactly the hook's answer, whatever the provider — including
  // an own-key one, which the hook itself (useBalanceShortfall.test.tsx,
  // case 3) never marks short. The floor computation lives there now, not
  // here: this file is only the wiring between the hook and the dot.
  it('the dot is the start gate\'s: it shows exactly when the hook says the balance is short', () => {
    shortfall.value = true;
    signIn();
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')!.getAttribute('data-tone')).toBe('low');

    cleanup();
    shortfall.value = false;
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')).toBeNull();
  });
});
