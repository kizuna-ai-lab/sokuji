// Interface language belongs in Help, at the weight of a help link.
//
// It used to be a full config-section — an <h3>, an 18px icon, a tooltip —
// sitting at the top of the panel next to *Translation* languages, two
// adjacent blocks both called "language". But it is set once and never
// revisited, and by its own description it does NOT affect what you can
// translate. That makes it a fact about the application, like the version
// number and the update check, not a feature setting.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const changeLanguageWithLoad = vi.fn(async () => undefined);
vi.mock('../../../locales', () => ({ changeLanguageWithLoad }));

const setUILanguage = vi.fn();
vi.mock('../../../stores/settingsStore', () => ({
  useSetUILanguage: () => setUILanguage,
}));

const trackEvent = vi.fn();
vi.mock('../../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, d?: string) => d ?? _k,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../../contexts/OnboardingContext', () => ({
  useOnboarding: () => ({ startOnboarding: vi.fn() }),
}));

let electron = false;
vi.mock('../../../utils/environment', () => ({ isElectron: () => electron }));

vi.mock('../../../stores/updateStore', () => ({
  useUpdateStatus: () => 'idle',
  useCheckForUpdates: () => vi.fn(),
  useOpenUpdateDialog: () => vi.fn(),
}));

vi.mock('../../Tooltip/Tooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Injected by vite's `define` at build time, so it does not exist here.
vi.stubGlobal('__APP_VERSION__', '0.0.0-test');

const { default: HelpSection } = await import('./HelpSection');
const { INTERFACE_LANGUAGES } = await import('./interfaceLanguages');

beforeEach(() => {
  cleanup();
  electron = false;
  changeLanguageWithLoad.mockClear();
  setUILanguage.mockClear();
  trackEvent.mockClear();
});

const picker = () => screen.getByLabelText(/interface language/i) as HTMLSelectElement;

describe('interface language in Help', () => {
  it('is offered as a control inside the help section', () => {
    render(<HelpSection />);
    const help = document.querySelector('#help-section');
    expect(help).not.toBeNull();
    expect(help!.contains(picker())).toBe(true);
  });

  // The point of the move: no heading, no 18px icon, no section of its own —
  // the same weight as "Restart Setup Guide" sitting beside it.
  it('carries no section heading of its own', () => {
    render(<HelpSection />);
    const headings = Array.from(document.querySelectorAll('#help-section h3'));
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).not.toMatch(/interface language/i);
  });

  // The language's own name is the whole label. Every other entry here is a
  // single phrase, and "Interface Language: English" would be the only
  // "label: value" in the row — long enough, measured, to push Discussions
  // onto a third line. The name stays reachable to assistive technology
  // through aria-label, which the tests above rely on to find the control.
  it('lets the language name be the label, with no visible prefix', () => {
    render(<HelpSection />);
    const help = document.querySelector('#help-section')!;
    expect(help.textContent).not.toMatch(/Interface Language/);
    expect(picker().getAttribute('aria-label')).toMatch(/interface language/i);
  });

  // Settings themes every one of its dropdowns through one shared
  // `appearance: base-select` layer, keyed off these class names. Joining it
  // is what gives this control the app's own popup instead of the OS one, the
  // chevron that marks it as openable, and — because a base-select control
  // lays out to its selected option rather than its longest — a width that
  // follows the chosen language. Measured: 54px for 日本語 against 148px for
  // the same list as a classic OS widget.
  //
  // The width itself is a CSS property that jsdom cannot observe; what this
  // pins is the hook the stylesheet selects on, which is what would silently
  // break if the class were renamed.
  it('joins the shared select styling rather than rolling its own', () => {
    render(<HelpSection />);
    expect(picker().classList.contains('help-link__select')).toBe(true);
    expect(picker().closest('.help-link--picker')).not.toBeNull();
  });

  it('offers every interface language, not a shortened list', () => {
    render(<HelpSection />);
    expect(picker().options).toHaveLength(INTERFACE_LANGUAGES.length);
  });

  it('shows the language currently in use', () => {
    render(<HelpSection />);
    expect(picker().value).toBe('en');
  });

  it('applies a chosen language and remembers it', async () => {
    render(<HelpSection />);
    fireEvent.change(picker(), { target: { value: 'ja' } });
    expect(changeLanguageWithLoad).toHaveBeenCalledWith('ja');
    // Loading the catalogue is not the same as persisting the preference;
    // without the store write the choice is lost on the next launch.
    await vi.waitFor(() => expect(setUILanguage).toHaveBeenCalledWith('ja'));
  });

  it('reports the change with the language it came from', async () => {
    render(<HelpSection />);
    fireEvent.change(picker(), { target: { value: 'ja' } });
    await vi.waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith('language_changed', {
        from_language: 'en',
        to_language: 'ja',
        language_type: 'ui',
      }),
    );
  });

  // Changing the UI language reloads a catalogue, which is not something to do
  // underneath a running translation.
  it('is disabled while a session is running', () => {
    render(<HelpSection isSessionActive />);
    expect(picker().disabled).toBe(true);
  });

  it('leaves the other help links in place', () => {
    render(<HelpSection />);
    expect(screen.getByText(/restart setup guide/i)).toBeTruthy();
    expect(screen.getByText('support@kizuna.ai')).toBeTruthy();
  });
});
