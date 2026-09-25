import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock('../../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }) };
});
// Captured instead of rendered: floating-ui's Tooltip opens only on hover, so
// asserting its `content` prop directly is the simple way to check the
// forced-by-mode tooltip (the brief's own key, since our i18n mock above
// returns the raw key for an object-shaped fallback).
const tooltipContents: unknown[] = [];
vi.mock('../../Tooltip/Tooltip', () => ({
  default: ({ content }: { content: unknown }) => {
    tooltipContents.push(content);
    return null;
  },
}));
vi.mock('../../../providers/registry', async () => {
  const { fakeProvider } = await import('../../../providers/fake/provider');
  return {
    presentProviders: () => [
      { ...fakeProvider, id: 'localInference', speech: 'optional' as const },
      { ...fakeProvider, id: 'always-provider', speech: 'always' as const },
      { ...fakeProvider, id: 'never-provider', speech: 'never' as const },
    ],
  };
});

import { FAKE_DEFAULTS } from '../../../providers/fake/settings';
import useAudioStore from '../../../stores/audioStore';
import { useProviderStore } from '../../../stores/providerStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTurnModeStore } from '../../../stores/turnModeStore';
import { OutputToggles, SpeechSection } from './SpeechSection';

const entry = () => ({ settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'auto', target: 'en' } });

/** The switch labeled `label`, out of every switch on the page. */
const switchByLabel = (label: string) => screen.getAllByRole('switch').find((el) => el.textContent?.includes(label))!;

beforeEach(() => {
  trackEvent.mockClear();
  tooltipContents.length = 0;
  useProviderStore.setState({ selected: 'localInference', entries: { localInference: entry() }, readiness: {} });
  useSettingsStore.setState({ textOnly: false, keepReplayAudio: false } as Partial<ReturnType<typeof useSettingsStore.getState>>);
  useTurnModeStore.setState({ turnMode: 'auto' });
  useAudioStore.setState({ mode: 'speaker' } as Partial<ReturnType<typeof useAudioStore.getState>>);
});

afterEach(() => {
  useProviderStore.setState({ selected: null, entries: {}, readiness: {} });
});

describe('SpeechSection', () => {
  it('is one config-section with the three turn modes, the current one active, and no switch inside it', () => {
    const { container } = render(<SpeechSection locked={false} />);
    const section = container.querySelector('#turn-detection-section');
    expect(section).toBeTruthy();
    expect(section?.className).toContain('config-section');
    expect(section?.querySelector('h3')?.textContent).toContain('settings.speechMode');
    const buttons = section!.querySelectorAll('.option-button');
    expect([...buttons].map((b) => b.textContent)).toEqual(['Auto', 'Push-to-Talk', 'Push-to-Translate']);
    expect(buttons[0]).toHaveClass('active');
    expect(section!.querySelector('[role="switch"]')).toBeNull();
  });

  it('clicking a mode sets it, persists it and tracks speech_mode_changed with LocalInference selected (old spelling)', () => {
    render(<SpeechSection locked={false} />);
    fireEvent.click(screen.getByText('Push-to-Talk'));
    expect(useTurnModeStore.getState().turnMode).toBe('push-to-talk');
    expect(trackEvent).toHaveBeenCalledWith('speech_mode_changed', { provider: 'local_inference', from_mode: 'Auto', to_mode: 'Push-to-Talk' });
    // `setTurnMode` persists through the real settings service (not mocked in
    // this file), which writes settings.common.turnMode straight to
    // localStorage — no ServiceFactory mock needed to observe it.
    expect(localStorage.getItem('settings.common.turnMode')).toBe('push-to-talk');
  });

  it('clicking the active mode does nothing', () => {
    render(<SpeechSection locked={false} />);
    fireEvent.click(screen.getByText('Auto'));
    expect(trackEvent).not.toHaveBeenCalled();
    expect(useTurnModeStore.getState().turnMode).toBe('auto');
  });

  it("locked disables the three turn-mode buttons, and OutputToggles' Text only — Keep audio for replay stays enabled", () => {
    render(
      <>
        <SpeechSection locked={true} />
        <OutputToggles locked={true} />
      </>,
    );
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    expect(switchByLabel('Text Only').getAttribute('aria-disabled')).toBe('true');
    expect(switchByLabel('Keep audio for replay').getAttribute('aria-disabled')).toBe('false');
  });
});

describe('OutputToggles', () => {
  it('is one config-section with no heading, holding the two switches', () => {
    const { container } = render(<OutputToggles locked={false} />);
    const section = container.querySelector('#output-section');
    expect(section).toBeTruthy();
    expect(section?.className).toContain('config-section');
    expect(section?.querySelector('h3')).toBeNull();
    expect(section!.querySelectorAll('[role="switch"]')).toHaveLength(2);
  });

  it("toggles Text Only for LocalInference (speech: 'optional')", () => {
    render(<OutputToggles locked={false} />);
    const sw = switchByLabel('Text Only');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(useSettingsStore.getState().textOnly).toBe(true);
  });

  it('shows Text Only on and disabled in participant mode, with the forced-by-mode tooltip', () => {
    useAudioStore.setState({ mode: 'participant' } as Partial<ReturnType<typeof useAudioStore.getState>>);
    render(<OutputToggles locked={false} />);
    const sw = switchByLabel('Text Only');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-disabled')).toBe('true');
    expect(tooltipContents).toContain('simpleConfig.textOnlyForcedByMode');
  });

  it("hides Text Only for a provider with speech: 'always'", () => {
    useProviderStore.setState({ selected: 'always-provider', entries: { 'always-provider': entry() } });
    render(<OutputToggles locked={false} />);
    expect(screen.queryByText('Text Only')).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(1);
  });

  it("shows Text Only on and disabled for a provider with speech: 'never'", () => {
    useProviderStore.setState({ selected: 'never-provider', entries: { 'never-provider': entry() } });
    render(<OutputToggles locked={false} />);
    const sw = switchByLabel('Text Only');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-disabled')).toBe('true');
  });

  it('toggles Keep audio for replay', () => {
    render(<OutputToggles locked={false} />);
    const sw = switchByLabel('Keep audio for replay');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(useSettingsStore.getState().keepReplayAudio).toBe(true);
  });
});
