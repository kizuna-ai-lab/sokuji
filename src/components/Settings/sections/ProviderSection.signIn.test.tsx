/**
 * The sign-in notice on a Kizuna-managed provider used to state a restriction
 * with nothing to act on. It is now an entry point: clicking it opens the
 * title-bar account popover, so the sign-in affordance is maintained in one
 * place and the click teaches the user where the account entry lives.
 *
 * Runs against the real i18n catalog (settingsStore imports src/locales for
 * its side effect) rather than a stubbed t(): the notice is a <Trans> with a
 * component slot, so a stub returning keys would assert nothing about whether
 * the sentence assembles a control at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const auth = vi.hoisted(() => ({ signedIn: false }));

vi.mock('../../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

vi.mock('../../../lib/auth/hooks', () => ({
  useAuth: () => ({ isSignedIn: auth.signedIn, getToken: async () => 'token' }),
}));

vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: unknown) => d,
      setSetting: async () => undefined,
    }),
  },
}));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { Provider } = await import('../../../types/Provider');
const { default: ProviderSection } = await import('./ProviderSection');

const realSetter = useSettingsStore.getState().setAccountPopoverRequested;

describe('ProviderSection — the sign-in notice is an entry point', () => {
  beforeEach(() => {
    cleanup();
    auth.signedIn = false;
    useSettingsStore.setState({
      provider: Provider.KIZUNA_AI_SONIOX,
      accountPopoverRequested: false,
      setAccountPopoverRequested: realSetter,
    } as never);
  });

  it('turns the sign-in notice into a control that opens the account popover', () => {
    const setRequested = vi.fn();
    useSettingsStore.setState({ setAccountPopoverRequested: setRequested } as never);

    render(<ProviderSection isSessionActive={false} />);
    fireEvent.click(screen.getByRole('button', { name: /sign in or sign up/i }));

    expect(setRequested).toHaveBeenCalledWith(true);
  });

  it('raises the request on the store the title bar actually reads', () => {
    // The control above is asserted against a stubbed action; this one runs
    // the real one, so the five-site store handshake is exercised end to end.
    render(<ProviderSection isSessionActive={false} />);
    fireEvent.click(screen.getByRole('button', { name: /sign in or sign up/i }));

    expect(useSettingsStore.getState().accountPopoverRequested).toBe(true);
  });

  it('leaves the notice out entirely once signed in', () => {
    auth.signedIn = true;
    render(<ProviderSection isSessionActive={false} />);

    expect(screen.queryByRole('button', { name: /sign in or sign up/i })).toBeNull();
  });
});
