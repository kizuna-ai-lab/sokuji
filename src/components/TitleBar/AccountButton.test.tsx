// src/components/TitleBar/AccountButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import AccountButton from './AccountButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
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

const showToast = vi.fn();
vi.mock('../Toast', () => ({ useToast: () => ({ showToast }) }));

let quota: any = null;
let kizunaEnabled = true;
vi.mock('../../utils/environment', () => ({
  isKizunaAIEnabled: () => kizunaEnabled,
}));

vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ quota, refetchAll: vi.fn() }),
}));

let providerId = 'openai';
let popoverRequested = false;
const setPopoverRequested = vi.fn((next: boolean) => { popoverRequested = next; });
vi.mock('../../stores/settingsStore', () => ({
  useProvider: () => providerId,
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
  providerId = 'openai';
  popoverRequested = false;
  setPopoverRequested.mockClear();
  refetchSpy.mockClear();
  showToast.mockClear();
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

  it('does not refetch once the e-mail is verified', () => {
    signIn(true);
    render(<AccountButton />);
    regainFocus();
    expect(refetchSpy).not.toHaveBeenCalled();
  });

  it('confirms the transition with a toast', () => {
    // Otherwise the only feedback is a warning disappearing, which is not
    // feedback: the user cannot tell success from a screen that never updated.
    signIn(false);
    const { rerender } = render(<AccountButton />);
    expect(showToast).not.toHaveBeenCalled();

    signIn(true);
    rerender(<AccountButton />);

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(String(showToast.mock.calls[0][0])).toMatch(/verified/i);
  });

  it('does not toast again on later renders', () => {
    signIn(false);
    const { rerender } = render(<AccountButton />);
    signIn(true);
    rerender(<AccountButton />);
    rerender(<AccountButton />);
    rerender(<AccountButton />);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('does not toast when an already-verified session merely finishes loading', () => {
    // Every app launch looks like this: the session resolves asynchronously, so
    // the first render has no user at all. Reading "no user yet" as "was
    // unverified" would congratulate the user on verifying at every startup.
    const { rerender } = render(<AccountButton />);
    signIn(true);
    rerender(<AccountButton />);
    expect(showToast).not.toHaveBeenCalled();
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

describe('AccountButton balance floor per provider', () => {
  const signIn = () => {
    signedIn = true;
    authUser = { name: 'J', email: 'you@example.com', emailVerified: true };
  };

  // sessionStartGate applies the Soniox floor ONLY to managed Soniox; every
  // other provider's floor is 1, i.e. the plain "> 0" rule. Using the Soniox
  // number for all of them lights a red "too low to start" dot next to a Start
  // button that is green and works — the false-positive direction this dot was
  // specifically designed to avoid.
  it('does not warn on a balance the Translate twin can actually start with', () => {
    providerId = 'kizunaai_openai_translate';
    signIn();
    quota = { balance: 10_000 };
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')).toBeNull();
  });

  it('does not warn on that balance for the Volcengine twin either', () => {
    providerId = 'kizunaai_volcengine_ast2';
    signIn();
    quota = { balance: 10_000 };
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')).toBeNull();
  });

  it('still warns those twins at a balance of zero, where Start really is blocked', () => {
    providerId = 'kizunaai_openai_translate';
    signIn();
    quota = { balance: 0 };
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')!.getAttribute('data-tone'))
      .toBe('low');
  });

  it('keeps the real Soniox floor for managed Soniox', () => {
    providerId = 'kizunaai_soniox';
    signIn();
    quota = { balance: 10_000 };
    render(<AccountButton />);
    expect(document.querySelector('.account-button__dot')!.getAttribute('data-tone'))
      .toBe('low');
  });
});
