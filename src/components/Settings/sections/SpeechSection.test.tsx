import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { resolve } from 'node:path';
import { compile } from 'sass';

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
// LocalInference is the real one — its `TurnDetection` is what the Speech
// section draws under Auto; the fake has none.
vi.mock('../../../providers/registry', async () => {
  const { fakeProvider } = await import('../../../providers/fake/provider');
  const { localInferenceProvider } = await import('../../../providers/localInference/provider');
  return {
    presentProviders: () => [
      localInferenceProvider,
      fakeProvider,
      { ...fakeProvider, id: 'always-provider', speech: 'always' as const },
      { ...fakeProvider, id: 'never-provider', speech: 'never' as const },
    ],
  };
});
// The speaker direction's resolved ASR decides LocalInference's VAD knobs:
// `resolve` (set on the model store below) answers 'asr-model', and this is
// its manifest entry.
const asr = vi.hoisted(() => ({ entry: undefined as { type?: string; asrWorkerType?: string } | undefined }));
vi.mock('../../../lib/local-inference/modelManifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/local-inference/modelManifest')>();
  return { ...actual, getManifestEntry: (id: string) => (id === 'asr-model' ? asr.entry : actual.getManifestEntry(id)) };
});

import { FAKE_DEFAULTS } from '../../../providers/fake/settings';
import { LOCAL_INFERENCE_DEFAULTS } from '../../../providers/localInference/settings';
import useAudioStore from '../../../stores/audioStore';
import { useModelStore } from '../../../stores/modelStore';
import { useProviderStore } from '../../../stores/providerStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTurnModeStore } from '../../../stores/turnModeStore';
import { OutputToggles, SpeechSection } from './SpeechSection';

const entry = () => ({ settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'auto', target: 'en' } });
const localEntry = () => ({ settings: { ...LOCAL_INFERENCE_DEFAULTS }, credentials: {}, pair: { source: 'ja', target: 'en' } });
const originalResolve = useModelStore.getState().resolve;

/** The switch labeled `label`, out of every switch on the page. */
const switchByLabel = (label: string) => screen.getAllByRole('switch').find((el) => el.textContent?.includes(label))!;

beforeEach(() => {
  trackEvent.mockClear();
  tooltipContents.length = 0;
  useProviderStore.setState({ selected: 'localInference', entries: { localInference: localEntry() }, readiness: {} });
  useSettingsStore.setState({ textOnly: false, keepReplayAudio: false } as Partial<ReturnType<typeof useSettingsStore.getState>>);
  useTurnModeStore.setState({ turnMode: 'auto' });
  useAudioStore.setState({ mode: 'speaker' } as Partial<ReturnType<typeof useAudioStore.getState>>);
  asr.entry = { type: 'asr', asrWorkerType: 'whisper-webgpu' };
  useModelStore.setState({ resolve: () => ({ asr: { modelId: 'asr-model' }, translation: null, tts: null }) } as unknown as Partial<ReturnType<typeof useModelStore.getState>>);
});

afterEach(() => {
  useProviderStore.setState({ selected: null, entries: {}, readiness: {} });
  useModelStore.setState({ resolve: originalResolve });
});

describe('SpeechSection', () => {
  it('is one config-section with the three turn modes, the current one active, and no switch inside it', () => {
    const { container } = render(<SpeechSection locked={false} layout="simple" />);
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
    render(<SpeechSection locked={false} layout="simple" />);
    fireEvent.click(screen.getByText('Push-to-Talk'));
    expect(useTurnModeStore.getState().turnMode).toBe('push-to-talk');
    expect(trackEvent).toHaveBeenCalledWith('speech_mode_changed', { provider: 'local_inference', from_mode: 'Auto', to_mode: 'Push-to-Talk' });
    // `setTurnMode` persists through the real settings service (not mocked in
    // this file), which writes settings.common.turnMode straight to
    // localStorage — no ServiceFactory mock needed to observe it.
    expect(localStorage.getItem('settings.common.turnMode')).toBe('push-to-talk');
  });

  it('clicking the active mode does nothing', () => {
    render(<SpeechSection locked={false} layout="simple" />);
    fireEvent.click(screen.getByText('Auto'));
    expect(trackEvent).not.toHaveBeenCalled();
    expect(useTurnModeStore.getState().turnMode).toBe('auto');
  });

  it("locked disables the three turn-mode buttons, and OutputToggles' Text only — Keep audio for replay stays enabled", () => {
    render(
      <>
        <SpeechSection locked={true} layout="simple" />
        <OutputToggles locked={true} />
      </>,
    );
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    expect(switchByLabel('Text Only').getAttribute('aria-disabled')).toBe('true');
    expect(switchByLabel('Keep audio for replay').getAttribute('aria-disabled')).toBe('false');
  });
});

describe("SpeechSection — the provider's turn-detection tuning", () => {
  const SUMMARY = 'VAD Settings · Min Silence Duration: 1.40s';
  const section = (container: HTMLElement) => container.querySelector('#turn-detection-section')!;
  const sliders = (container: HTMLElement) => section(container).querySelectorAll('input[type="range"]');
  const disclosure = (container: HTMLElement) => section(container).querySelector('button[aria-expanded]');

  it('Simple, Auto: the summary line below the turn modes, with no disclosure and no controls', () => {
    const { container } = render(<SpeechSection locked={false} layout="simple" />);
    const line = screen.getByText(SUMMARY);
    expect(section(container).contains(line)).toBe(true);
    // Below the three turn-mode buttons.
    const turnModes = section(container).querySelector('.turn-detection-options')!;
    // eslint-disable-next-line no-bitwise
    expect(turnModes.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(disclosure(container)).toBeNull();
    expect(sliders(container)).toHaveLength(0);
  });

  it('Advanced, Auto: a collapsed disclosure holding the summary; clicking it shows the VAD sliders', () => {
    const { container } = render(<SpeechSection locked={false} layout="advanced" />);
    const button = disclosure(container)!;
    expect(button).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent).toContain(SUMMARY);
    expect(sliders(container)).toHaveLength(0);

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    // A vad-web worker: all five knobs.
    expect(sliders(container)).toHaveLength(5);
    expect(screen.getByText('Min Silence Duration')).toBeTruthy();

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(sliders(container)).toHaveLength(0);
  });

  it("a change goes to the provider's settings, and the summary follows", () => {
    const { container } = render(<SpeechSection locked={false} layout="advanced" />);
    fireEvent.click(disclosure(container)!);
    const minSilence = screen.getByText('Min Silence Duration').closest('.setting-item')!.querySelector('input[type="range"]')!;
    fireEvent.change(minSilence, { target: { value: '0.5' } });
    expect((useProviderStore.getState().entries.localInference.settings as typeof LOCAL_INFERENCE_DEFAULTS).vadMinSilenceDuration).toBe(0.5);
    expect(disclosure(container)!.textContent).toContain('VAD Settings · Min Silence Duration: 0.50s');
  });

  it.each([
    ['push-to-talk', 'simple'],
    ['push-to-talk', 'advanced'],
    ['push-to-translate', 'simple'],
    ['push-to-translate', 'advanced'],
  ] as const)('%s (%s): no summary and no disclosure', (turnMode, layout) => {
    useTurnModeStore.setState({ turnMode });
    const { container } = render(<SpeechSection locked={false} layout={layout} />);
    expect(screen.queryByText(SUMMARY)).toBeNull();
    expect(disclosure(container)).toBeNull();
    expect(sliders(container)).toHaveLength(0);
  });

  it.each(['simple', 'advanced'] as const)('a provider without TurnDetection shows neither (%s)', (layout) => {
    useProviderStore.setState({ selected: 'fake', entries: { fake: entry() } });
    const { container } = render(<SpeechSection locked={false} layout={layout} />);
    expect(screen.queryByText(/VAD Settings/)).toBeNull();
    expect(disclosure(container)).toBeNull();
    expect(sliders(container)).toHaveLength(0);
  });

  // The disclosure only shows what is set; it changes nothing, so a run
  // leaves it working — the knobs inside are what the lock disables.
  it('locked disables the controls, not the disclosure', () => {
    const { container } = render(<SpeechSection locked={true} layout="advanced" />);
    const button = disclosure(container)!;
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(sliders(container)).toHaveLength(5);
    for (const slider of sliders(container)) expect(slider).toBeDisabled();
  });

  // Endpoint detection replaces VAD on a streaming ASR with no worker type:
  // the provider's Summary and Controls render nothing, and the row they
  // would sit in must go with them — else Advanced shows a bare chevron.
  // The row is the section's; hiding it is the stylesheet's job, so this is
  // asserted in two halves: the summary element is empty in the real DOM,
  // and the compiled Settings.scss hides a row whose summary is empty.
  it.each(['simple', 'advanced'] as const)('nothing to tune (a streaming ASR with no worker type, %s): the row is hidden', (layout) => {
    asr.entry = { type: 'asr-stream', asrWorkerType: undefined };
    const { container } = render(<SpeechSection locked={false} layout={layout} />);
    expect(screen.queryByText(/VAD Settings/)).toBeNull();
    const summary = section(container).querySelector('.turn-detection-summary')!;
    expect(summary).toBeTruthy();
    expect(summary.childNodes).toHaveLength(0);
    const row = summary.closest('.turn-detection-tuning')!;
    expect(row).toBeTruthy();
    expect(row.closest('.config-section')).toBe(section(container));

    const { css } = compile(resolve(__dirname, '../Settings.scss'));
    expect(css).toMatch(/\.config-section \.turn-detection-tuning:has\(\.turn-detection-summary:empty\)[^{]*\{\s*display:\s*none;/);
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
