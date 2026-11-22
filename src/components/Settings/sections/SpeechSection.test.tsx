import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { resolve } from 'node:path';
import { compile } from 'sass';

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock('../../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  // Defaults rendered with their values filled in, as i18next does without a catalog entry.
  const t = (key: string, fallback?: unknown, values?: Record<string, string>) =>
    (typeof fallback === 'string' ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => values?.[name] ?? '') : key);
  return { ...actual, useTranslation: () => ({ t }) };
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
import { presentProviders } from '../../../providers/registry';
import useAudioStore from '../../../stores/audioStore';
import { useModelStore } from '../../../stores/modelStore';
import { useProviderStore } from '../../../stores/providerStore';
import { runsOn } from '../../../stores/lineUpStore.testing';
import { useLineUpStore } from '../../../stores/lineUpStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTurnModeStore } from '../../../stores/turnModeStore';
import { ProviderTurnDetectionControls } from '../../providers/ProviderOwnSettings';
import { SpeechSection } from './SpeechSection';
import { registerReleasedCatalog } from '../../../lib/lineup/catalog.testing';

registerReleasedCatalog();

const entry = () => ({ settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'auto', target: 'en' } });
const localEntry = () => ({ settings: { ...LOCAL_INFERENCE_DEFAULTS }, credentials: {}, pair: { source: 'ja', target: 'en' } });
const originalResolve = useModelStore.getState().resolve;

beforeEach(() => {
  trackEvent.mockClear();
  tooltipContents.length = 0;
  runsOn('local_inference');
  useProviderStore.setState({ entries: { local_inference: localEntry() }, readiness: {} });
  useSettingsStore.setState({ textOnly: false, keepReplayAudio: false, settingsNavigationTarget: null } as Partial<ReturnType<typeof useSettingsStore.getState>>);
  useTurnModeStore.setState({ turnMode: 'auto', pushKey: 'Space' });
  useAudioStore.setState({ mode: 'speaker' } as Partial<ReturnType<typeof useAudioStore.getState>>);
  asr.entry = { type: 'asr', asrWorkerType: 'whisper-webgpu' };
  useModelStore.setState({ resolve: () => ({ asr: { modelId: 'asr-model' }, translation: null, tts: null }) } as unknown as Partial<ReturnType<typeof useModelStore.getState>>);
});

afterEach(() => {
  runsOn(null);
  useProviderStore.setState({ entries: {}, readiness: {} });
  useModelStore.setState({ resolve: originalResolve });
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
    // It names who serves each stage too: no line-up is stored here, so the provider that runs, on all three.
    expect(trackEvent).toHaveBeenCalledWith('speech_mode_changed', {
      provider: 'local_inference', stages: { transcription: 'local_inference', translation: 'local_inference', speech: 'local_inference' },
      from_mode: 'Auto', to_mode: 'Push-to-Talk',
    });
    // `setTurnMode` persists through the real settings service (not mocked in
    // this file), which writes settings.common.turnMode straight to
    // localStorage — no ServiceFactory mock needed to observe it.
    expect(localStorage.getItem('settings.common.turnMode')).toBe('push-to-talk');
  });

  // Before a line-up is stored, the one the settings show is what runs where this device runs (`lineUpThatRuns`):
  // the event names its services, as the run's records do; beside another provider it names that provider alone.
  it("names the stages of the line-up that runs: the one shown where this device runs, before one is stored", () => {
    const shown = { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null };
    try {
      useLineUpStore.setState({ lineUp: shown, stored: false, unstoredProvider: 'local_inference' });
      render(<SpeechSection locked={false} />);
      fireEvent.click(screen.getByText('Push-to-Talk'));
      expect(trackEvent).toHaveBeenCalledWith('speech_mode_changed', {
        provider: 'local_inference', stages: { transcription: 'local_inference', translation: 'bing', speech: 'edge' },
        from_mode: 'Auto', to_mode: 'Push-to-Talk',
      });
      trackEvent.mockClear();
      act(() => {
        useLineUpStore.setState({ lineUp: shown, stored: false, unstoredProvider: 'fake' });
        useProviderStore.setState({ entries: { fake: entry() } });
      });
      fireEvent.click(screen.getByText('Push-to-Translate'));
      expect(trackEvent).toHaveBeenCalledWith('speech_mode_changed', {
        provider: 'fake', stages: { transcription: 'fake', translation: 'fake', speech: 'fake' },
        from_mode: 'Push-to-Talk', to_mode: 'Push-to-Translate',
      });
    } finally {
      useLineUpStore.setState({ lineUp: null, stored: false });
    }
  });

  // Ruling 8: every provider ends an utterance under Auto by its own
  // detection now (LocalInference's VAD, Soniox's endpoint model), so the
  // heading's tooltip names none of them.
  it("the Speech mode's tooltip names no mechanism: the provider's detection, for your voice and the other side's", () => {
    const { container } = render(<SpeechSection locked={false} />);
    // The explanation of the three modes is the mode choice's own title now (the mock's heading has no help mark).
    const modesTitle = container.querySelector('.turn-detection-options')!.getAttribute('title')!;
    const texts = [modesTitle, ...tooltipContents.filter((c): c is string => typeof c === 'string')];
    const heading = texts.find((c) => c.includes('Push-to-Translate:'));
    expect(heading).toContain('Auto: the provider detects when you have finished speaking.');
    expect(heading).toContain("Other's audio always uses the provider's automatic detection.");
    for (const c of texts) {
      expect(c).not.toContain('semantic VAD');
      expect(c).not.toContain('local Voice Activity Detection');
    }
  });

  it('clicking the active mode does nothing', () => {
    render(<SpeechSection locked={false} />);
    fireEvent.click(screen.getByText('Auto'));
    expect(trackEvent).not.toHaveBeenCalled();
    expect(useTurnModeStore.getState().turnMode).toBe('auto');
  });

  it('locked disables the three turn-mode buttons', () => {
    render(<SpeechSection locked={true} />);
    // The three turn modes — the tuning summary's link below them only
    // navigates, and stays enabled (its own case below).
    const modes = ['Auto', 'Push-to-Talk', 'Push-to-Translate'].map((label) => screen.getByRole('button', { name: label }));
    for (const button of modes) expect(button).toBeDisabled();
  });
});

describe("SpeechSection — the provider's turn-detection tuning", () => {
  const SUMMARY = 'VAD Settings · Min Silence Duration: 1.40s';
  const section = (container: HTMLElement) => container.querySelector('#turn-detection-section')!;
  const sliders = (container: HTMLElement) => section(container).querySelectorAll('input[type="range"]');
  const link = (container: HTMLElement) => section(container).querySelector<HTMLButtonElement>('button.turn-detection-link');
  const target = () => useSettingsStore.getState().settingsNavigationTarget;

  // The Controls live among the provider's options: the row links there instead of opening them in place.
  it("Auto: the summary below the turn modes is a link to the provider's tuning block — no disclosure, no controls here", () => {
    const { container } = render(<SpeechSection locked={false} />);
    const button = link(container)!;
    expect(button).toBeTruthy();
    expect(button.textContent).toBe(SUMMARY);
    // Below the three turn-mode buttons.
    const turnModes = section(container).querySelector('.turn-detection-options')!;
    // eslint-disable-next-line no-bitwise
    expect(turnModes.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section(container).querySelector('[aria-expanded]')).toBeNull();
    expect(sliders(container)).toHaveLength(0);
  });

  // One settings page (settings page plan, ruling 4): the link only navigates; no UI mode is written, no mode switch tracked.
  it('the link navigates, and writes no UI mode', () => {
    useSettingsStore.setState({ uiMode: 'basic' });
    const { container } = render(<SpeechSection locked={false} />);
    fireEvent.click(link(container)!);
    expect(target()).toBe('turn-detection-tuning');
    expect(useSettingsStore.getState().uiMode).toBe('basic');
    expect(localStorage.getItem('settings.common.uiMode')).toBeNull();
    expect(trackEvent).not.toHaveBeenCalled();
    expect(sliders(container)).toHaveLength(0);
  });

  // The heading's tooltip sits on the row itself.
  it('the row carries the VAD settings tooltip', () => {
    render(<SpeechSection locked={false} />);
    expect(tooltipContents).toContain(
      'Voice Activity Detection parameters. Controls how speech segments are detected and split. Changes take effect on next session start.',
    );
  });

  // The provider's tuning block and this row read the same entry.
  it("a change in the provider's tuning block goes to the provider's settings, and the summary follows", () => {
    const { container } = render(
      <>
        <SpeechSection locked={false} />
        <ProviderTurnDetectionControls providers={presentProviders()} />
      </>,
    );
    const block = container.querySelector<HTMLElement>('#turn-detection-tuning-section')!;
    const minSilence = within(block).getByText('Min Silence Duration').closest('.setting-item')!.querySelector('input[type="range"]')!;
    fireEvent.change(minSilence, { target: { value: '0.5' } });
    expect((useProviderStore.getState().entries.local_inference.settings as typeof LOCAL_INFERENCE_DEFAULTS).vadMinSilenceDuration).toBe(0.5);
    expect(link(container)!.textContent).toBe('VAD Settings · Min Silence Duration: 0.50s');
  });

  it.each(['push-to-talk', 'push-to-translate'] as const)('%s: no summary and no link', (turnMode) => {
    useTurnModeStore.setState({ turnMode });
    const { container } = render(<SpeechSection locked={false} />);
    expect(screen.queryByText(SUMMARY)).toBeNull();
    expect(link(container)).toBeNull();
    expect(sliders(container)).toHaveLength(0);
  });

  it('a provider without TurnDetection shows neither', () => {
    runsOn('fake');
    useProviderStore.setState({ entries: { fake: entry() } });
    const { container } = render(<SpeechSection locked={false} />);
    expect(screen.queryByText(/VAD Settings/)).toBeNull();
    expect(link(container)).toBeNull();
    expect(sliders(container)).toHaveLength(0);
  });

  // The link only navigates; it changes nothing, so a run leaves it working —
  // the Controls it leads to are what the lock disables.
  it('locked leaves the link enabled, and it still navigates', () => {
    const { container } = render(<SpeechSection locked={true} />);
    const button = link(container)!;
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(target()).toBe('turn-detection-tuning');
  });

  // Endpoint detection replaces VAD on a streaming ASR with no worker type:
  // the provider's Summary renders nothing, and the row it would sit in must
  // go with it — else the page shows an empty link.
  // The row is the section's; hiding it is the stylesheet's job, so this is
  // asserted in two halves: the summary element is empty in the real DOM,
  // and the compiled Settings.scss hides a row whose summary is empty.
  it('nothing to tune (a streaming ASR with no worker type): the row is hidden', () => {
    asr.entry = { type: 'asr-stream', asrWorkerType: undefined };
    const { container } = render(<SpeechSection locked={false} />);
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

  // The row is the section's last child and has no control under its label,
  // so neither it nor the label keeps a bottom margin: the space above the
  // next divider is the section's own padding-bottom, as everywhere else.
  it('the row keeps no bottom margin of its own (compiled Settings.scss)', () => {
    const { css } = compile(resolve(__dirname, '../Settings.scss'));
    expect(css).toMatch(/\.config-section \.setting-item\.turn-detection-tuning,\s*\.settings-section \.setting-item\.turn-detection-tuning\s*\{[^}]*margin-bottom:\s*0;/);
    expect(css).toMatch(/\.config-section \.setting-item\.turn-detection-tuning \.setting-label,\s*\.settings-section \.setting-item\.turn-detection-tuning \.setting-label\s*\{[^}]*margin-bottom:\s*0;/);
  });
});

// The mock's line-up page (v18): a plain heading with its hint, the three modes as a compact segmented choice.
describe('SpeechSection — as the mock draws it', () => {
  it('heads the section with its name and a hint, no icon or help mark', () => {
    const { container } = render(<SpeechSection locked={false} />);
    const h3 = container.querySelector('h3')!;
    expect(h3).toHaveClass('settings-subhead');
    expect(h3).toHaveTextContent('When a stretch of speech goes off to be translated; fixed during a session');
    expect(h3.querySelector('svg')).toBeNull();
    expect(tooltipContents.some((c) => typeof c === 'string' && c.includes('Push-to-Translate:'))).toBe(false);
  });

  it('draws the three modes as a compact segmented choice', () => {
    const { container } = render(<SpeechSection locked={false} />);
    expect(container.querySelector('.turn-detection-options')).toHaveClass('settings-seg');
  });
});

// The mock's speech mode (owner 2026-11-15: lay it out as the mock does): a "Speech mode" label over the three
// modes, then a box listing what the mode does — the turn end under Auto, the key and what it does otherwise.
describe('SpeechSection — the box under the modes, as the mock lists it', () => {
  const box = (container: HTMLElement) => container.querySelector<HTMLElement>('.turn-mode-box');
  const rows = (container: HTMLElement) => [...box(container)!.querySelectorAll('.turn-mode-box__row')].map((r) => [...r.children].map((c) => c.textContent));

  it('labels the three modes as the mock does', () => {
    const { container } = render(<SpeechSection locked={false} />);
    const field = container.querySelector('.settings-field')!;
    expect(field.querySelector('.settings-field__label')?.textContent).toBe('settings.speechMode');
    expect(field.querySelector('.turn-detection-options')).not.toBeNull();
  });

  it("Auto: the turn end, with the provider's summary that opens its tuning", () => {
    const { container } = render(<SpeechSection locked={false} />);
    const row = box(container)!.querySelector('.turn-mode-box__row')!;
    expect(row.firstElementChild?.textContent).toBe('Turn end');
    expect(within(row as HTMLElement).getByRole('button').textContent).toBe('VAD Settings · Min Silence Duration: 1.40s');
  });

  const keyRow = (container: HTMLElement) => box(container)!.querySelector<HTMLElement>('.turn-mode-box__row--key')!;
  const keyName = (container: HTMLElement) => keyRow(container).querySelector('kbd')?.textContent;
  const said = (container: HTMLElement) => rows(container).slice(1);

  // Owner 2026-11-21: each mode says what happens while the key is held and while it is not.
  it('Push-to-Talk: the key, then what happens while it is held and while it is not', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk' });
    const { container } = render(<SpeechSection locked={false} />);
    expect(keyRow(container).firstElementChild?.textContent).toBe('Key');
    expect(keyName(container)).toBe('Space');
    expect(said(container)).toEqual([
      ['While held', 'Sokuji listens; when you let go, that stretch is translated and the other side hears the translation. With Passthrough on, the other side also hears your own voice, quietly.'],
      ['While not held', 'Sokuji does not listen; nothing you say is translated or reaches the other side.'],
    ]);
  });

  it('Push-to-Translate: the key, then what happens while it is held and while it is not', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-translate' });
    const { container } = render(<SpeechSection locked={false} />);
    expect(keyName(container)).toBe('Space');
    expect(said(container)).toEqual([
      ['While held', 'What you say is translated; the other side hears only the translation, not your own voice.'],
      ['While not held', 'Your own voice goes straight to the other side, untranslated.'],
    ]);
  });

  // Owner 2026-11-21: the key can be changed, in the app as before (while Sokuji has focus).
  it('Change takes the next key pressed, keeps it, and Reset goes back to Space', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk' });
    const { container } = render(<SpeechSection locked={false} />);
    expect(within(keyRow(container)).queryByRole('button', { name: 'Reset to Space' })).toBeNull();
    fireEvent.click(within(keyRow(container)).getByRole('button', { name: 'Change' }));
    expect(keyRow(container).textContent).toContain('Press a key… (Esc to cancel)');

    fireEvent.keyDown(document.body, { code: 'ControlRight', key: 'Control', ctrlKey: true });
    fireEvent.keyUp(document.body, { code: 'ControlRight', key: 'Control' });
    expect(useTurnModeStore.getState().pushKey).toBe('ControlRight');
    expect(keyName(container)).toBe('Right Ctrl');

    fireEvent.click(within(keyRow(container)).getByRole('button', { name: 'Reset to Space' }));
    expect(useTurnModeStore.getState().pushKey).toBe('Space');
    expect(keyName(container)).toBe('Space');
  });

  it('refuses a key a hold cannot take and keeps waiting; Esc cancels and keeps the key', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk', pushKey: 'F8' });
    const { container } = render(<SpeechSection locked={false} />);
    fireEvent.click(within(keyRow(container)).getByRole('button', { name: 'Change' }));
    fireEvent.keyDown(document.body, { code: 'CapsLock', key: 'CapsLock' });
    expect(keyRow(container).textContent).toContain('CapsLock cannot be used. Press another key.');
    expect(useTurnModeStore.getState().pushKey).toBe('F8');

    fireEvent.keyDown(document.body, { code: 'Escape', key: 'Escape' });
    expect(useTurnModeStore.getState().pushKey).toBe('F8');
    expect(keyName(container)).toBe('F8');
    expect(within(keyRow(container)).getByRole('button', { name: 'Change' })).toBeInTheDocument();
  });

  it('keeps the key press that picks a key from reaching anything else (it holds no turn)', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk' });
    const heard = vi.fn();
    window.addEventListener('keydown', heard);
    try {
      const { container } = render(<SpeechSection locked={false} />);
      fireEvent.click(within(keyRow(container)).getByRole('button', { name: 'Change' }));
      fireEvent.keyDown(document.body, { code: 'Space', key: ' ' });
      expect(heard).not.toHaveBeenCalled();
      // Picking is over: the next press is everyone's again.
      fireEvent.keyDown(document.body, { code: 'Space', key: ' ' });
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', heard);
    }
  });

  it('stops picking when the mode leaves the keys behind, so keys reach the page again', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk' });
    const heard = vi.fn();
    window.addEventListener('keydown', heard);
    try {
      const { container } = render(<SpeechSection locked={false} />);
      fireEvent.click(within(keyRow(container)).getByRole('button', { name: 'Change' }));
      act(() => { useTurnModeStore.setState({ turnMode: 'auto' }); });
      fireEvent.keyDown(document.body, { code: 'KeyA', key: 'a' });
      expect(heard).toHaveBeenCalledTimes(1);
      expect(useTurnModeStore.getState().pushKey).toBe('Space');
    } finally {
      window.removeEventListener('keydown', heard);
    }
  });

  it('lets Tab move focus while picking, so the keyboard can reach Cancel', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk' });
    const { container } = render(<SpeechSection locked={false} />);
    fireEvent.click(within(keyRow(container)).getByRole('button', { name: 'Change' }));
    const tab = new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', bubbles: true, cancelable: true });
    document.body.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(keyRow(container).textContent).toContain('Press a key… (Esc to cancel)');
  });

  it('leaves Enter and Space on its own buttons to the buttons, so Cancel works from the keyboard', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk', pushKey: 'F8' });
    const { container } = render(<SpeechSection locked={false} />);
    fireEvent.click(within(keyRow(container)).getByRole('button', { name: 'Change' }));
    const cancel = within(keyRow(container)).getByRole('button', { name: 'Cancel' });
    for (const code of ['Enter', 'Space']) {
      const press = new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code, bubbles: true, cancelable: true });
      cancel.dispatchEvent(press);
      expect(press.defaultPrevented, code).toBe(false);
    }
    expect(useTurnModeStore.getState().pushKey).toBe('F8');
  });

  it('takes the focus off Change when picking starts, so Space picks Space instead of pressing the button', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk', pushKey: 'F8' });
    const { container } = render(<SpeechSection locked={false} />);
    const change = within(keyRow(container)).getByRole('button', { name: 'Change' });
    change.focus();
    fireEvent.click(change);
    expect(document.activeElement).not.toBe(change);
    fireEvent.keyDown(document.activeElement!, { code: 'Space', key: ' ' });
    expect(useTurnModeStore.getState().pushKey).toBe('Space');
  });

  it('gives the focus back to Change when a key is picked or the picking is cancelled', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk', pushKey: 'F8' });
    const { container } = render(<SpeechSection locked={false} />);
    const change = within(keyRow(container)).getByRole('button', { name: 'Change' });
    fireEvent.click(change);
    fireEvent.keyDown(document.activeElement!, { code: 'KeyT', key: 't' });
    expect(useTurnModeStore.getState().pushKey).toBe('KeyT');
    expect(document.activeElement).toBe(change);
    fireEvent.click(change);
    fireEvent.keyDown(document.activeElement!, { code: 'Escape', key: 'Escape' });
    expect(document.activeElement).toBe(change);
  });

  it('keeps the focus in the box after Reset, on Change', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk', pushKey: 'F8' });
    const { container } = render(<SpeechSection locked={false} />);
    const reset = within(keyRow(container)).getByRole('button', { name: 'Reset to Space' });
    reset.focus();
    fireEvent.click(reset);
    expect(document.activeElement).toBe(within(keyRow(container)).getByRole('button', { name: 'Change' }));
  });

  it('names a refused key by what it types when it has no code', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk' });
    const { container } = render(<SpeechSection locked={false} />);
    fireEvent.click(within(keyRow(container)).getByRole('button', { name: 'Change' }));
    fireEvent.keyDown(document.body, { code: '', key: 'Process' });
    expect(keyRow(container).textContent).toContain('Process cannot be used. Press another key.');
  });

  it('lets a shortcut through while picking: a key pressed with Ctrl, Alt, Shift or Cmd held is not a choice', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk', pushKey: 'F8' });
    const { container } = render(<SpeechSection locked={false} />);
    fireEvent.click(within(keyRow(container)).getByRole('button', { name: 'Change' }));
    const shortcut = new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', metaKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(shortcut);
    expect(shortcut.defaultPrevented).toBe(false);
    expect(useTurnModeStore.getState().pushKey).toBe('F8');
    expect(keyRow(container).textContent).toContain('Press a key… (Esc to cancel)');
    // Cmd on its own is still named as a key that cannot be used.
    fireEvent.keyDown(document.body, { code: 'MetaLeft', key: 'Meta', metaKey: true });
    fireEvent.keyUp(document.body, { code: 'MetaLeft', key: 'Meta' });
    expect(keyRow(container).textContent).toContain('Left Windows cannot be used. Press another key.');
    // And Ctrl on its own is still a key it can take.
    fireEvent.keyDown(document.body, { code: 'ControlRight', key: 'Control', ctrlKey: true });
    fireEvent.keyUp(document.body, { code: 'ControlRight', key: 'Control' });
    expect(useTurnModeStore.getState().pushKey).toBe('ControlRight');
  });

  it('takes a modifier only when it is let go on its own, so Shift+Tab and Ctrl shortcuts change nothing', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk', pushKey: 'F8' });
    const { container } = render(<SpeechSection locked={false} />);
    fireEvent.click(within(keyRow(container)).getByRole('button', { name: 'Change' }));
    const chords: Array<[string, string, Record<string, boolean>]> = [
      ['ShiftLeft', 'Tab', { shiftKey: true }],
      ['ControlLeft', 'KeyR', { ctrlKey: true }],
      ['ControlLeft', 'ShiftLeft', { ctrlKey: true, shiftKey: true }],
    ];
    for (const [modifier, other, held] of chords) {
      const down = new KeyboardEvent('keydown', { code: modifier, bubbles: true, cancelable: true, ...held });
      document.body.dispatchEvent(down);
      expect(down.defaultPrevented, modifier).toBe(false);
      fireEvent.keyDown(document.body, { code: other, ...held });
      fireEvent.keyUp(document.body, { code: other, ...held });
      fireEvent.keyUp(document.body, { code: modifier });
      expect(useTurnModeStore.getState().pushKey, `${modifier}+${other}`).toBe('F8');
      expect(keyRow(container).textContent).toContain('Press a key… (Esc to cancel)');
    }
    // A modifier that was already down when the picking started is not a choice either.
    fireEvent.keyUp(document.body, { code: 'AltLeft' });
    expect(useTurnModeStore.getState().pushKey).toBe('F8');
  });

  it('stops picking when the user clicks outside the box, so the next key reaches what they clicked', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk', pushKey: 'F8' });
    const { container } = render(<SpeechSection locked={false} />);
    fireEvent.click(within(keyRow(container)).getByRole('button', { name: 'Change' }));
    fireEvent.pointerDown(keyRow(container));
    expect(keyRow(container).textContent).toContain('Press a key… (Esc to cancel)');
    fireEvent.pointerDown(document.body);
    expect(within(keyRow(container)).getByRole('button', { name: 'Change' })).toBeTruthy();
    const typed = new KeyboardEvent('keydown', { code: 'KeyH', key: 'h', bubbles: true, cancelable: true });
    document.body.dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(false);
    expect(useTurnModeStore.getState().pushKey).toBe('F8');
  });

  it('stops picking when Tab takes the focus out of the box, so the keys reach the next control', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk', pushKey: 'F8' });
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      const { container } = render(<SpeechSection locked={false} />);
      fireEvent.click(within(keyRow(container)).getByRole('button', { name: 'Change' }));
      within(keyRow(container)).getByRole('button', { name: 'Cancel' }).focus();
      expect(keyRow(container).textContent).toContain('Press a key… (Esc to cancel)');
      act(() => { outside.focus(); });
      expect(within(keyRow(container)).getByRole('button', { name: 'Change' })).toBeTruthy();
      const press = new KeyboardEvent('keydown', { code: 'ArrowDown', key: 'ArrowDown', bubbles: true, cancelable: true });
      outside.dispatchEvent(press);
      expect(press.defaultPrevented).toBe(false);
      expect(useTurnModeStore.getState().pushKey).toBe('F8');
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });

  it('stops picking when the window loses focus', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk', pushKey: 'F8' });
    const { container } = render(<SpeechSection locked={false} />);
    fireEvent.click(within(keyRow(container)).getByRole('button', { name: 'Change' }));
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(within(keyRow(container)).getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  it('lets keys through again once the box is gone in the middle of picking', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk', pushKey: 'F8' });
    const { container, unmount } = render(<SpeechSection locked={false} />);
    fireEvent.click(within(keyRow(container)).getByRole('button', { name: 'Change' }));
    unmount();
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    const press = new KeyboardEvent('keydown', { code: 'KeyH', key: 'h', bubbles: true, cancelable: true });
    document.body.dispatchEvent(press);
    window.removeEventListener('keydown', seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(press.defaultPrevented).toBe(false);
    expect(useTurnModeStore.getState().pushKey).toBe('F8');
  });

  it('leaves the focus where the user clicked when a click outside ends the picking', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk', pushKey: 'F8' });
    const { container } = render(<SpeechSection locked={false} />);
    const change = within(keyRow(container)).getByRole('button', { name: 'Change' });
    fireEvent.click(change);
    fireEvent.pointerDown(document.body);
    expect(document.activeElement).not.toBe(change);
  });

  it('cannot change the key while a session runs', () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk' });
    const { container } = render(<SpeechSection locked />);
    expect(within(keyRow(container)).getByRole('button', { name: 'Change' })).toBeDisabled();
  });

  it('a provider without TurnDetection draws no box under Auto', () => {
    runsOn('fake');
    useProviderStore.setState({ entries: { fake: entry() } });
    const { container } = render(<SpeechSection locked={false} />);
    expect(box(container)).toBeNull();
  });
});
