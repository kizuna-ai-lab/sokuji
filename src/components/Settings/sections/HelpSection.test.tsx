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

const changeLanguageWithLoad = vi.fn<(lang: string) => Promise<void>>();
vi.mock('../../../locales', () => ({ changeLanguageWithLoad }));

const setUILanguage = vi.fn<(lang: string) => Promise<void>>();
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

vi.mock('../../Tour/useStartBasicsTour', () => ({ useStartBasicsTour: () => vi.fn() }));

let electron = false;
vi.mock('../../../utils/environment', () => ({ isElectron: () => electron }));

vi.mock('../../../stores/updateStore', () => ({
  useUpdateStatus: () => 'idle',
  useCheckForUpdates: () => vi.fn(),
  useOpenUpdateDialog: () => vi.fn(),
}));

// Records suppression so the picker's interaction with it can be asserted;
// renders children either way, as the real one does.
//
// Only the tooltips that are actually controlled are recorded. Help renders
// three — the picker's, support's and Discussions' — and the last two pass no
// `suppressed` at all, so recording every render would leave the reader of
// this array looking at Discussions' constant false.
const tooltipSuppressed: boolean[] = [];
// `.at(-1)` needs ES2022; this project targets ES2020.
const lastSuppressed = () => tooltipSuppressed[tooltipSuppressed.length - 1];
vi.mock('../../Tooltip/Tooltip', () => ({
  default: ({ children, suppressed }: { children: React.ReactNode; suppressed?: boolean }) => {
    if (suppressed !== undefined) tooltipSuppressed.push(suppressed);
    return <>{children}</>;
  },
}));

// Injected by vite's `define` at build time, so it does not exist here.
vi.stubGlobal('__APP_VERSION__', '0.0.0-test');

const { default: HelpSection } = await import('./HelpSection');
const { INTERFACE_LANGUAGES } = await import('./interfaceLanguages');

beforeEach(() => {
  cleanup();
  electron = false;
  changeLanguageWithLoad.mockReset();
  changeLanguageWithLoad.mockResolvedValue(undefined);
  setUILanguage.mockReset();
  setUILanguage.mockResolvedValue(undefined);
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
    // The work runs on a serialising chain, so it lands a microtask later.
    await vi.waitFor(() => expect(changeLanguageWithLoad).toHaveBeenCalledWith('ja'));
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

  // Opening the picker puts a list right where the tooltip is; leaving the
  // tooltip up means it covers the thing the user just asked to see. Focus is
  // the signal available here — a native select gives no open/close event —
  // and it covers both opening by mouse and arriving by keyboard.
  it('drops the tooltip once the picker takes focus', async () => {
    render(<HelpSection />);
    tooltipSuppressed.length = 0;
    fireEvent.focus(picker());
    await vi.waitFor(() => expect(lastSuppressed()).toBe(true));
  });

  it('restores the tooltip when the picker is left', async () => {
    render(<HelpSection />);
    fireEvent.focus(picker());
    await vi.waitFor(() => expect(lastSuppressed()).toBe(true));
    fireEvent.blur(picker());
    await vi.waitFor(() => expect(lastSuppressed()).toBe(false));
  });

  // A <select> fires change on every arrow-key step, so holding a direction
  // walks the list and starts one request per language passed.
  //
  // Guarding only the writes is not enough, and this is the trap: the loader
  // calls i18n.changeLanguage() ITSELF, before any check the caller could make
  // afterwards. A stale request allowed to run would change the visible
  // language back on its way to being discarded, leaving the app showing one
  // language and having saved another. The requests are serialised instead,
  // and each checks whether it is still wanted before doing anything at all.
  it('never loads a language the user has already moved on from', async () => {
    const started: string[] = [];
    const finish: Record<string, () => void> = {};
    changeLanguageWithLoad.mockImplementation((lang: string) => {
      started.push(lang);
      return new Promise<void>((res) => { finish[lang] = () => res(); });
    });

    render(<HelpSection />);
    fireEvent.change(picker(), { target: { value: 'ja' } });
    fireEvent.change(picker(), { target: { value: 'zh_CN' } });

    // Whichever ran first, let it settle, then let everything drain.
    await new Promise((r) => setTimeout(r, 0));
    Object.values(finish).forEach((f) => f());
    await new Promise((r) => setTimeout(r, 0));
    Object.values(finish).forEach((f) => f());
    await new Promise((r) => setTimeout(r, 0));

    // ja was superseded before it could run, so it must never have been loaded
    // — a load is a visible language change, not just a write.
    expect(started).not.toContain('ja');
    expect(setUILanguage).not.toHaveBeenCalledWith('ja');
    await vi.waitFor(() => expect(setUILanguage).toHaveBeenCalledWith('zh_CN'));
  });

  // The loader has already changed the visible language by the time the write
  // fails, and the store's own setter applies its value before awaiting the
  // settings service. Left alone the app keeps a language it failed to save.
  it('puts the language back when the write fails', async () => {
    setUILanguage.mockRejectedValueOnce(new Error('disk full'));
    render(<HelpSection />);
    fireEvent.change(picker(), { target: { value: 'ja' } });

    await vi.waitFor(() => expect(setUILanguage).toHaveBeenCalledWith('ja'));
    // Rolled back to what it was before the attempt.
    await vi.waitFor(() => expect(changeLanguageWithLoad).toHaveBeenLastCalledWith('en'));
  });

  // setUILanguage writes through the settings service. Left unawaited, a
  // failure there surfaced as an unhandled rejection while analytics recorded
  // a change that was never persisted.
  it('does not report a change it failed to persist', async () => {
    setUILanguage.mockRejectedValueOnce(new Error('disk full'));
    render(<HelpSection />);
    fireEvent.change(picker(), { target: { value: 'ja' } });

    await vi.waitFor(() => expect(setUILanguage).toHaveBeenCalledWith('ja'));
    await new Promise((r) => setTimeout(r, 0));
    expect(trackEvent).not.toHaveBeenCalledWith(
      'language_changed',
      expect.objectContaining({ to_language: 'ja' }),
    );
  });

  it('survives a catalogue that fails to load', async () => {
    changeLanguageWithLoad.mockRejectedValueOnce(new Error('offline'));
    render(<HelpSection />);
    fireEvent.change(picker(), { target: { value: 'ja' } });

    await new Promise((r) => setTimeout(r, 0));
    // Nothing persisted, nothing reported, and no unhandled rejection.
    expect(setUILanguage).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalledWith(
      'language_changed',
      expect.objectContaining({ to_language: 'ja' }),
    );
  });

  it('leaves the other help links in place', () => {
    render(<HelpSection />);
    expect(screen.getByText(/restart setup guide/i)).toBeTruthy();
    expect(screen.getByText('support@kizuna.ai')).toBeTruthy();
  });
});
