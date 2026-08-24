/**
 * The "Text Only" toggle is a lie in a participant-only mode.
 *
 * The participant (reverse-direction) leg never speaks: every descriptor's
 * `buildParticipantSessionConfig` forces `textOnly: true`, pinned registry-wide
 * by descriptorRegistry.test.ts. So in "Others" mode the session is text-only
 * whatever the switch says, and an OFF switch promised spoken translation the
 * app was never going to produce.
 *
 * The fix follows the shape the panel already uses for inherently text-only
 * providers (Zoom AI, Volcengine ST): a permanently-on, non-interactive switch.
 * The persisted setting is deliberately NOT rewritten — `settings.common.textOnly`
 * is one global preference, and stamping it true on entering "Others" would
 * silently discard the user's choice for "You"/"Both".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_k: string, def?: string) => def ?? _k,
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('../../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
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
const { default: useAudioStore } = await import('../../../stores/audioStore');
const { default: useSessionStore } = await import('../../../stores/sessionStore');
const { Provider } = await import('../../../types/Provider');
const { default: LanguageSection } = await import('./LanguageSection');

/** The Text Only switch, picked out of the section's several toggles by label. */
const textOnlySwitch = () =>
  screen.getAllByRole('switch').find((el) => el.textContent?.includes('Text Only'))!;

const renderSection = () =>
  render(
    <LanguageSection isSessionActive={false} showTranslationLanguages={true} />
  );

describe('LanguageSection — Text Only toggle vs the channel matrix', () => {
  beforeEach(() => {
    // Gemini: textOnlyCapability 'optional', i.e. the switch is interactive at all.
    useSettingsStore.setState({ provider: Provider.GEMINI, textOnly: false } as any);
    useAudioStore.setState({ mode: 'speaker' } as any);
    useSessionStore.setState({ lockedMode: null } as any);
  });

  it('is interactive and follows the setting in speaker mode', () => {
    renderSection();
    const sw = textOnlySwitch();
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('aria-disabled')).toBe('false');
  });

  it('stays interactive in both mode — the speaker leg still speaks', () => {
    useAudioStore.setState({ mode: 'both' } as any);
    renderSection();
    const sw = textOnlySwitch();
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('aria-disabled')).toBe('false');
  });

  it('shows on and locked in participant mode even though the setting is off', () => {
    useAudioStore.setState({ mode: 'participant' } as any);
    renderSection();
    const sw = textOnlySwitch();
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-disabled')).toBe('true');
  });

  it('does not rewrite the persisted setting when it locks the switch', () => {
    useAudioStore.setState({ mode: 'participant' } as any);
    renderSection();
    fireEvent.click(textOnlySwitch());
    // Still the user's own choice — restored the moment they leave "Others".
    expect(useSettingsStore.getState().textOnly).toBe(false);
  });

  it('reads the locked mode during a session, not the picker', () => {
    // Mode cannot change mid-session, but the locked snapshot is the honest
    // source and is what every other mode-scoped lock in Settings reads.
    useAudioStore.setState({ mode: 'speaker' } as any);
    useSessionStore.setState({ lockedMode: 'participant' } as any);
    renderSection();
    expect(textOnlySwitch().getAttribute('aria-checked')).toBe('true');
  });
});
