import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';

// Kept from before the old audio service was deleted: ServiceFactory used to
// import ModernBrowserAudioService -> ModernAudioRecorder -> a worklet
// `?url` import that this sandboxed Vite test transform denied outright.
// ServiceFactory no longer reaches ModernAudioRecorder; this test's subject,
// session.ts, reaches it only via `appCapture`, which is mocked directly
// below. Not needed by the current graph for that reason.
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

// The replay queue karaoke reads: a case says which clip it is playing.
const replayQueue = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let playing: { key: string; t: number; ms: number } | null = null;
  return {
    position: () => playing,
    pending: 0,
    clears: 0,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Plays `key` (or nothing) and tells the listeners, as a clip starting or ending does. */
    play(key: string | null) {
      playing = key ? { key, t: 0, ms: 1000 } : null;
      for (const listener of [...listeners]) listener();
    },
  };
});

// The page's playback, as far as the panel reaches it: the queues karaoke
// reads, the ports the runner calls, and the bus meters the advanced footer asks for.
const playback = vi.hoisted(() => {
  const queue = { position: () => null, pending: 0, clears: 0, subscribe: () => () => {} };
  return {
    queues: { speaker: queue, participant: queue, replay: replayQueue },
    audio() {}, held() {}, clear() {}, live() {}, passthrough() {},
    replay(_leg: string, _segment: { ref: number }) {}, stopReplay() {}, preview: async (_clip: unknown) => {}, stopPreview() {},
    ttsTap: { read: () => new Float32Array(0) },
    meter: (_bus: string): null => null,
  };
});
// `failures`: how many loads fail before one succeeds (the session retries a failed load on its next call).
const load = vi.hoisted(() => ({ failures: 0 }));
// The test tone: a case gives it `AppAudio.testTone`'s behaviour (appAudio.test.ts covers the real one).
const tone = vi.hoisted(() => ({ testTone: vi.fn(async (_signal?: AbortSignal) => {}) }));
vi.mock('../../lib/audio/appAudio', () => ({
  getAppAudio: async () => {
    if (load.failures > 0) {
      load.failures -= 1;
      throw new Error('the graph did not build');
    }
    return { playback, testTone: tone.testTone };
  },
}));

const capture = vi.hoisted(() => ({
  openSource: async () => { throw new Error('no capture in tests'); },
  echo: { attach: () => () => {}, onNotice: vi.fn(), setDiagnostics: () => {} },
  levels: {
    speaker: { push() {}, read: () => new Float32Array(32), reset() {} },
    participant: { push() {}, read: () => new Float32Array(32), reset() {} },
  },
}));
vi.mock('../../lib/audio/appCapture', () => ({ createAppCapture: () => capture }));

vi.mock('../../lib/segmentation/PunctuationRuntime', () => {
  class FakePunctuationRuntime {
    dispose = vi.fn();
    punctuate = vi.fn(async () => null);
    constructor(public opts: { isEnabled(): boolean }) {}
    get enabled(): boolean {
      return this.opts.isEnabled();
    }
  }
  const PunctuationRuntime = vi.fn(function (opts: { isEnabled(): boolean }) {
    return new FakePunctuationRuntime(opts);
  });
  const MODEL_IDS = {
    'fireredpunc': 'punct-zh-fireredpunc',
    'edge-punct-en': 'punct-en-edge',
    'sat-3l-sm': 'punct-multi-sat',
  };
  return { PunctuationRuntime, MODEL_IDS };
});

// Every assertion below is a key. One `t` for the whole file, as i18next's is
// stable: the panel's notice action (and the list's per-notice cache) keep
// their identity across renders, as they do in the app.
const t = vi.hoisted(() => (key: string) => key);
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t }) };
});

const trackEvent = vi.hoisted(() => vi.fn());
vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent }) }));

vi.mock('../../config/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../config/analytics')>()),
  isDevelopment: () => true,
}));

// The gate's own rules are Task 9's tests; this file checks what the panel hands it.
const gate = vi.hoisted(() => ({ spy: vi.fn(), actual: null as null | ((...args: never[]) => boolean) }));
const replayBlockedSpy = gate.spy;
vi.mock('./panel/replayGate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./panel/replayGate')>();
  gate.actual = actual.replayBlocked;
  gate.spy.mockImplementation(actual.replayBlocked);
  return { replayBlocked: gate.spy };
});

const env = vi.hoisted(() => ({ extension: false, electron: false }));
vi.mock('../../utils/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/environment')>()),
  isExtension: () => env.extension,
  isElectron: () => env.electron,
}));


// A marker: what the panel asks the permission modal to show.
interface ModalProps { isOpen: boolean; onClose(): void; type: string | null; note?: string | null }
const modal = vi.hoisted(() => ({ calls: [] as ModalProps[] }));
vi.mock('../Settings/shared/WarningModal', () => ({
  default: (props: ModalProps) => { modal.calls.push(props); return null; },
}));

import { configureAppSession, getAppSession } from '../../app/session';
import { createVirtualClock } from '../../lib/contract/clock';
import { PunctuationRuntime } from '../../lib/segmentation/PunctuationRuntime';
import type { AnalyticsPort } from '../../lib/session/ports';
import { VIEW_INTERVAL_MS } from '../../lib/view/conversationView';
import { TRANSIENT_NOTICE_MS } from '../../lib/view/filter';
import { fakeProvider } from '../../providers/fake/provider';
import { createFakeSource } from '../../providers/fake/source';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSubtitleStore } from '../../stores/subtitleStore';
import { usePanelNotesStore } from '../../stores/panelNotesStore';
import { useTurnModeStore } from '../../stores/turnModeStore';
import MainPanel from './MainPanel';

const clock = createVirtualClock(0);
// Before any render builds the page's session: the fake source, no microphone needed.
configureAppSession({
  clock,
  newSessionId: () => 'r1',
  capture: () => async () => createFakeSource(clock),
  microphoneRequired: () => false,
});

const runner = () => getAppSession().runner;
const mainAction = (container: HTMLElement) => container.querySelector('[data-tour="main-action"]') as HTMLButtonElement;
const rowTexts = (container: HTMLElement) => [...container.querySelectorAll('.conversation-list .row-text')].map((el) => el.textContent);
const lastModal = () => modal.calls[modal.calls.length - 1];

/** Renders the panel and lets the page's playback land, which it loads after the first render. */
async function renderPanel() {
  const result = render(<MainPanel />);
  await act(() => getAppSession().audio());
  return result;
}

/** The advanced footer's strips draw one frame on mount; nothing schedules the next, and no canvas is real here. Returns the restore. */
function stubCanvas(): () => void {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  return () => {
    getContext.mockRestore();
    vi.unstubAllGlobals();
  };
}

/** Clicks the main action and waits, inside act, until the run's state says `done`. */
async function click(container: HTMLElement, done: () => void): Promise<void> {
  await act(async () => {
    fireEvent.click(mainAction(container));
    await vi.waitFor(done);
  });
}

/** Clicks Start and waits for the run to be live. */
async function start(container: HTMLElement): Promise<void> {
  await click(container, () => expect(runner().state.getState().phase).toBe('running'));
}

/** Plays the fake's first exchange and lets the view draw it. */
function playFirstExchange(): void {
  act(() => { clock.advance(2500); });
  act(() => { clock.advance(VIEW_INTERVAL_MS); });
}

async function stop(): Promise<void> {
  await act(async () => {
    await runner().stop();
    await runner().settled();
  });
}

beforeAll(async () => {
  await useProviderStore.getState().load(fakeProvider);
  useProviderStore.getState().select('fake');
  // The session's own analytics (the runner's events) reach the page through its bridge.
  getAppSession().setBridges({ track: trackEvent as unknown as AnalyticsPort['track'] });
});

beforeEach(async () => {
  // The page's one session outlives each case: no run, no conversation, no last end.
  await runner().stop();
  await runner().settled();
  runner().clear();
  runner().state.setState({ phase: 'idle' }, true);
  clock.advance(VIEW_INTERVAL_MS);
  useProviderStore.getState().updateSettings(fakeProvider, { checkFails: false });
  useTurnModeStore.setState({ turnMode: 'auto' });
  useSettingsStore.setState({ uiMode: 'basic', keepReplayAudio: false, subtitleModeActive: false });
  useAudioStore.setState({ mode: 'speaker', participantSources: [], selectedParticipantSource: useAudioStore.getInitialState().selectedParticipantSource });
  env.extension = false;
  env.electron = false;
  usePanelNotesStore.setState({ notes: [] });
  modal.calls.length = 0;
  trackEvent.mockClear();
  // Answers as the real gate does, unless a case says otherwise.
  replayBlockedSpy.mockReset();
  replayBlockedSpy.mockImplementation(gate.actual!);
});

// First in the file: the page's session keeps its playback once loaded, and
// this case needs the page's first load to fail.
describe('MainPanel before its playback has loaded', () => {
  it('asks for the playback again when the phase moves, and picks it up', async () => {
    load.failures = 1;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<MainPanel />);
      await act(async () => {
        await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining('The playback did not load'), expect.anything()));
      });
      // No playback, no capture: the echo notice has nothing to listen to.
      expect(capture.echo.onNotice).not.toHaveBeenCalled();

      // A start retries the load (the runner's own call); the panel asks again when the phase moves.
      act(() => { runner().state.setState({ phase: 'starting', step: 'checking' }, true); });
      // The load the panel's own call began: its answer reaches the panel first.
      await act(() => getAppSession().audio());
      expect(capture.echo.onNotice).toHaveBeenCalledWith(expect.any(Function));
    } finally {
      error.mockRestore();
      act(() => { runner().state.setState({ phase: 'idle' }, true); });
    }
  });
});

describe('MainPanel', () => {
  it('draws the empty state and a Start before anything has happened', async () => {
    const { container } = await renderPanel();
    expect(container.querySelector('.conversation-display .empty-state')?.textContent).toContain('simplePanel.startToBegin');
    expect(mainAction(container)).not.toBeNull();
    expect(mainAction(container).disabled).toBe(false);
    expect(mainAction(container).textContent).toContain('simplePanel.start');
  });

  // Roadmap 1e-3a: "or the page runs two punctuation runtimes". The old
  // panel built its own (`useSegmentationRuntime`); this one uses the root's.
  it("constructs no punctuation runtime of its own: the page's one is the root's", async () => {
    await renderPanel();
    const { results } = vi.mocked(PunctuationRuntime).mock;
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe(getAppSession().punctuation.runtime);
  });

  it("starts the root runner and draws the run's rows, with the export menu", async () => {
    const { container } = await renderPanel();
    await start(container);
    playFirstExchange();
    expect(container.querySelectorAll('.conversation-list .conversation-row').length).toBeGreaterThan(0);
    expect(rowTexts(container)).toContain('Hello, how are you?');
    expect(container.querySelector('.conversation-toolbar .export-btn')).not.toBeNull();
    await stop();
  });

  // Ruling 11: a click while the provider's entry loads is not refused as
  // "no provider" — Start honors the gate even when the click beat the
  // render that would have turned the button off.
  it('never starts while the gate is shut, even from a click that beat its render', async () => {
    const { container } = await renderPanel();
    try {
      await act(async () => {
        // Selected, not loaded: the gate shuts, and the button is not drawn off yet.
        useProviderStore.setState({ selected: 'localInference' });
        expect(getAppSession().subtitle.get().canStart).toBe(false);
        expect(mainAction(container).disabled).toBe(false);
        fireEvent.click(mainAction(container));
      });
      expect(runner().state.getState()).toEqual({ phase: 'idle' });
    } finally {
      act(() => { useProviderStore.setState({ selected: 'fake' }); });
    }
  });

  it('keeps the conversation after Stop, and the clear button empties it', async () => {
    const { container } = await renderPanel();
    await start(container);
    playFirstExchange();
    await click(container, () => expect(runner().state.getState().phase).toBe('idle'));
    await act(() => runner().settled());
    expect(container.querySelectorAll('.conversation-list .conversation-row').length).toBeGreaterThan(0);

    fireEvent.click(container.querySelector('.clear-conversation-btn') as HTMLButtonElement);
    expect(runner().conversation.snapshot().every((leg) => leg.segments.length === 0)).toBe(true);
    act(() => { clock.advance(VIEW_INTERVAL_MS); });
    expect(container.querySelector('.conversation-display .empty-state')).not.toBeNull();
  });

  it('offers typed text while the speaker leg is live, and sends it through the runner', async () => {
    const { container } = await renderPanel();
    expect(container.querySelector('.text-input')).toBeNull();
    await start(container);
    const input = container.querySelector('.text-input') as HTMLInputElement;
    expect(input).not.toBeNull();

    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    act(() => { clock.advance(VIEW_INTERVAL_MS); });
    // The fake answers typed text with a row of its own and its translation.
    expect(rowTexts(container)).toEqual(expect.arrayContaining(['hi', '«hi»']));
    expect(trackEvent).toHaveBeenCalledWith('text_input_sent', expect.objectContaining({ provider: 'fake', text_length: 2 }));

    await click(container, () => expect(runner().state.getState().phase).toBe('idle'));
    await act(() => runner().settled());
    expect(container.querySelector('.text-input')).toBeNull();
  });

  it('holds a turn with the Space key under push-to-talk', async () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk' });
    const { container } = await renderPanel();
    expect(container.querySelector('.push-to-talk-btn')).toBeNull();
    await start(container);
    const hold = () => container.querySelector('.push-to-talk-btn .btn-text')?.textContent;
    expect(hold()).toBe('simplePanel.holdToSpeak');

    fireEvent.keyDown(window, { code: 'Space' });
    expect(hold()).toBe('simplePanel.release');
    act(() => { clock.advance(300); });
    fireEvent.keyUp(window, { code: 'Space' });
    expect(hold()).toBe('simplePanel.holdToSpeak');
    // The run counts a release only for a turn it had open: the press reached it.
    expect(trackEvent).toHaveBeenCalledWith('push_to_talk_used', expect.objectContaining({ mode: 'push-to-talk', hold_duration_ms: 300 }));
    await stop();
  });

  // Ruling 16: both follow the speaker leg being live, not the run alone.
  // The web has no participant leg to run (the gate refuses it), so the
  // runner's store is set as a run on the desktop would leave it.
  it('offers neither the hold button nor typed text while the speaker leg is not live', async () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk' });
    const { container } = await renderPanel();
    for (const legs of [{ participant: 'live' }, { speaker: 'reconnecting', participant: 'live' }] as const) {
      act(() => { runner().state.setState({ phase: 'running', since: 0, legs }, true); });
      expect(container.querySelector('[data-tour="main-action"]')?.textContent).toContain('simplePanel.stop');
      expect(container.querySelector('.push-to-talk-btn')).toBeNull();
      expect(container.querySelector('.text-input')).toBeNull();
    }
    act(() => { runner().state.setState({ phase: 'idle' }, true); });
  });

  // Settings are locked while a run is live, so the stored ones are the run's.
  it("offers typed text only when the provider takes it with the stored settings (Live Translate takes none)", async () => {
    const textInput = vi.spyOn(fakeProvider, 'textInput').mockReturnValue(false);
    try {
      const { container } = await renderPanel();
      act(() => { runner().state.setState({ phase: 'running', since: 0, legs: { speaker: 'live' } }, true); });
      expect(container.querySelector('[data-tour="main-action"]')?.textContent).toContain('simplePanel.stop');
      expect(container.querySelector('.text-input')).toBeNull();
      expect(textInput).toHaveBeenCalledWith(useProviderStore.getState().entries.fake!.settings);
    } finally {
      textInput.mockRestore();
      act(() => { runner().state.setState({ phase: 'idle' }, true); });
    }
  });

  it('draws why a refused start did not happen as the status line, in words, with no action for a code with no Settings target', async () => {
    const { container } = await renderPanel();
    await start(container);
    playFirstExchange();
    await stop();

    act(() => { useProviderStore.getState().updateSettings(fakeProvider, { checkFails: true }); });
    await click(container, () => expect(runner().state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'refused' } }));

    const list = container.querySelector('.conversation-list') as HTMLElement;
    // A refused start keeps the last conversation; the status line says why, outside the list.
    expect(list.querySelectorAll('.conversation-row').length).toBeGreaterThan(0);
    expect(list.querySelector('.sys-row')).toBeNull();
    const line = container.querySelector('.status-line');
    // The live gate (the provider is known unready now) outranks the refusal it caused.
    expect(line?.getAttribute('data-status')).toBe('unready:message');
    expect(line?.querySelector('.status-line__text')?.textContent).toContain('The fake reports not ready');
    expect(container.querySelector('.status-line__action')).toBeNull();
  });

  it("disables every replay while the gate says so, and hands the gate the run, the platform and Other's source", async () => {
    replayBlockedSpy.mockReturnValue(true);
    useSettingsStore.setState({ keepReplayAudio: true });
    useAudioStore.setState({ selectedParticipantSource: { deviceId: 'app:42', label: 'Meeting app' } });
    const { container } = await renderPanel();
    await start(container);
    playFirstExchange();

    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.row-play-btn')];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      expect(button.title).toBe('mainPanel.replayBlockedWholeSystem');
    }
    const [input] = replayBlockedSpy.mock.lastCall!;
    expect(input.run).toBe(runner().state.getState());
    expect(input.platform).toBe('web');
    expect(input.participantSourceId).toBe(useAudioStore.getState().selectedParticipantSource?.deviceId);
    expect(input.participantSourceId).toBe('app:42');
    await stop();
  });

  it('opens the Screen Recording modal on a loopback denial, with the application note, and reopens it from the status line', async () => {
    useAudioStore.setState({ participantSources: [{ deviceId: 'system', label: 'System' }, { deviceId: 'app:1', label: 'App' }] });
    const { container } = await renderPanel();
    expect(lastModal()).toMatchObject({ isOpen: false, type: null });

    act(() => {
      runner().state.setState({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'loopback_denied', message: 'm', leg: 'participant' } } }, true);
    });
    expect(lastModal()).toMatchObject({ isOpen: true, type: 'screen-recording-denied', note: 'audioPanel.screenRecordingHasAlternative' });

    act(() => { lastModal().onClose(); });
    expect(lastModal()).toMatchObject({ isOpen: false, type: null });

    const line = container.querySelector('.status-line');
    expect(line?.getAttribute('data-status')).toBe('last-end:loopback_denied');
    expect(line?.querySelector('.status-line__text')?.textContent).toBe('notices.loopback_denied');
    expect(container.querySelector('.sys-row')).toBeNull();
    const actions = container.querySelectorAll<HTMLButtonElement>('.status-line__action');
    expect(actions.length).toBe(1);
    expect(actions[0].textContent).toBe('audioPanel.openSystemSettings');
    fireEvent.click(actions[0]);
    expect(lastModal()).toMatchObject({ isOpen: true, type: 'screen-recording-denied' });
  });

  it('leaves the note out when no application is on offer', async () => {
    await renderPanel();
    act(() => {
      runner().state.setState({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'loopback_denied', message: 'm', leg: 'participant' } } }, true);
    });
    expect(lastModal()).toMatchObject({ isOpen: true, type: 'screen-recording-denied', note: null });
  });

  it('draws the advanced footer: both input strips, the output strip on the virtual bus, and the debug button', async () => {
    const restoreCanvas = stubCanvas();
    const meter = vi.spyOn(playback, 'meter');
    try {
      useSettingsStore.setState({ uiMode: 'advanced' });
      useAudioStore.setState({ mode: 'both' });
      const { container } = await renderPanel();
      expect(container.querySelector('.control-footer.advanced')).not.toBeNull();
      expect(container.querySelector('.control-footer.basic')).toBeNull();
      expect(container.querySelectorAll('.waveform-input-group .waveform-strip').length).toBe(2);
      expect(container.querySelector('.waveform-strip--output')).not.toBeNull();
      expect(container.querySelector('.debug-button')).not.toBeNull();
      // What the meeting hears (ruling 3), from the loaded playback.
      expect(meter).toHaveBeenCalledWith('virtual');
      expect(meter.mock.calls.every(([bus]) => bus === 'virtual')).toBe(true);
    } finally {
      meter.mockRestore();
      restoreCanvas();
    }
  });

  it("gives a notice whose code has a Settings target that section's button", async () => {
    const navigate = vi.fn();
    const original = useSettingsStore.getState().navigateToSettings;
    useSettingsStore.setState({ navigateToSettings: navigate });
    try {
      const { container } = await renderPanel();
      act(() => {
        runner().state.setState({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'no_microphone', message: 'm', leg: 'speaker' } } }, true);
      });
      expect(container.querySelector('.status-line')?.getAttribute('data-status')).toBe('last-end:no_microphone');
      const actions = container.querySelectorAll<HTMLButtonElement>('.status-line__action');
      expect(actions.length).toBe(1);
      expect(actions[0].textContent).toBe('settings.title');
      fireEvent.click(actions[0]);
      expect(navigate).toHaveBeenCalledWith('microphone');
    } finally {
      act(() => { useSettingsStore.setState({ navigateToSettings: original }); });
    }
  });

  // The line's key names an end by its code: a later end must not show an earlier one's action.
  it("gives each end its own action, not the one the panel drew for an earlier end", async () => {
    const { container } = await renderPanel();
    act(() => {
      runner().state.setState({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'not_ready', message: 'm' } } }, true);
    });
    expect(container.querySelector('.status-line')?.getAttribute('data-status')).toBe('last-end:not_ready');
    expect(container.querySelector('.status-line__action')).toBeNull();
    act(() => {
      runner().state.setState({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'no_microphone', message: 'm', leg: 'speaker' } } }, true);
    });
    expect(container.querySelector('.status-line')?.getAttribute('data-status')).toBe('last-end:no_microphone');
    expect(container.querySelector('.status-line__action')?.textContent).toBe('settings.title');
  });

  // Today's toggle (`MainPanel.tsx:3543-3551`): the playing item's button stops it.
  it('stops the replay that is playing when its button is clicked again', async () => {
    useSettingsStore.setState({ keepReplayAudio: true });
    const replay = vi.spyOn(playback, 'replay');
    const stopReplay = vi.spyOn(playback, 'stopReplay');
    try {
      const { container } = await renderPanel();
      await start(container);
      playFirstExchange();
      await stop();
      const button = container.querySelector<HTMLButtonElement>('.row-play-btn')!;
      expect(button.disabled).toBe(false);

      fireEvent.click(button);
      expect(replay).toHaveBeenCalledTimes(1);
      const [leg, segment] = replay.mock.calls[0];
      // The replay queue plays that segment: karaoke says so, and the row shows it.
      act(() => { replayQueue.play(`${leg}:${segment.ref}:0`); });
      expect(button.classList.contains('playing')).toBe(true);

      fireEvent.click(button);
      expect(stopReplay).toHaveBeenCalledTimes(1);
      expect(replay).toHaveBeenCalledTimes(1);
    } finally {
      act(() => { replayQueue.play(null); });
      replay.mockRestore();
      stopReplay.mockRestore();
    }
  });

  // The end stays on the runner (the subtitle surfaces read it); Clear dismisses the panel's line for it.
  it("clears a failed start's line, and draws a later end again", async () => {
    const { container } = await renderPanel();
    const clear = () => container.querySelector('.clear-conversation-btn') as HTMLButtonElement;
    act(() => {
      runner().state.setState({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'start_failed', message: 'socket closed' } } }, true);
    });
    expect(container.querySelector('.status-line')?.getAttribute('data-status')).toBe('last-end:start_failed');
    expect(container.querySelector('.sys-row')).toBeNull();
    expect(clear().disabled).toBe(false);

    fireEvent.click(clear());
    expect(container.querySelector('.status-line')).toBeNull();
    expect(container.querySelector('.conversation-display .empty-state')).not.toBeNull();
    expect(clear().disabled).toBe(true);

    act(() => {
      runner().state.setState({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'start_failed', message: 'socket closed again' } } }, true);
    });
    expect(container.querySelector('.status-line')?.getAttribute('data-status')).toBe('last-end:start_failed');
  });

  it("clears a refused start's line with the conversation it kept", async () => {
    const { container } = await renderPanel();
    await start(container);
    playFirstExchange();
    await stop();
    act(() => { useProviderStore.getState().updateSettings(fakeProvider, { checkFails: true }); });
    await click(container, () => expect(runner().state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'refused' } }));
    expect(container.querySelectorAll('.conversation-list .conversation-row').length).toBeGreaterThan(0);
    expect(container.querySelector('.sys-row')).toBeNull();

    fireEvent.click(container.querySelector('.clear-conversation-btn') as HTMLButtonElement);
    act(() => { clock.advance(VIEW_INTERVAL_MS); });
    expect(container.querySelector('.conversation-list')).toBeNull();
    // The gate is still shut (the provider is unready now): that line is a live condition, not the end Clear hid.
    expect(container.querySelector('.status-line')?.getAttribute('data-status')).toBe('unready:message');
    expect(container.querySelector('.conversation-display .empty-state')).not.toBeNull();
  });

  it('shows why Start is off as the status line, not as a tooltip (spec 2026-10-05 §3)', async () => {
    // The web has no participant leg to run: the start gate refuses it, which makes the subtitle session's idle `unready`.
    useAudioStore.setState({ mode: 'participant' });
    const { container } = await renderPanel();
    expect(getAppSession().subtitle.get().canStart).toBe(false);
    expect(container.querySelector('.status-line')?.getAttribute('data-status')).toBe('unready:participant_source_unavailable');
    expect(mainAction(container).disabled).toBe(true);
    expect(mainAction(container).getAttribute('title')).toBeNull();
    expect(container.querySelector('.tooltip')).toBeNull();
  });

  it('mounts the status line directly above the advanced footer', async () => {
    const restoreCanvas = stubCanvas();
    try {
      useSettingsStore.setState({ uiMode: 'advanced' });
      useAudioStore.setState({ mode: 'participant' });
      const { container } = await renderPanel();
      const line = container.querySelector('.status-line');
      expect(line).not.toBeNull();
      expect(line!.nextElementSibling?.matches('.control-footer.advanced')).toBe(true);
    } finally {
      restoreCanvas();
    }
  });

  it('dismissing the echo line hides it', async () => {
    const { container } = await renderPanel();
    act(() => { capture.echo.onNotice.mock.lastCall![0]({ cause: 'tts-echo', lagMs: 120, rho: 0.8 }); });
    expect(container.querySelector('[data-status="echo:tts-echo"]')).not.toBeNull();
    fireEvent.click(container.querySelector('.status-line__dismiss')!);
    expect(container.querySelector('.status-line')).toBeNull();
  });

  it('dismissing the subtitle-entry hint clears it from the store', async () => {
    // The hint is a running line (Ruling 11); a selected input, or the line is the microphone wait, which outranks it.
    const selected = useAudioStore.getState().selectedInputDevice;
    useAudioStore.setState({ selectedInputDevice: { deviceId: 'mic', label: 'Mic', isVirtual: false } as never });
    const { container } = await renderPanel();
    try {
      act(() => {
        runner().state.setState({ phase: 'running', since: 0, legs: { speaker: 'live' } }, true);
        useSubtitleStore.setState({ entryHint: 'refresh' });
      });
      expect(container.querySelector('[data-status="subtitle-entry"]')).not.toBeNull();
      fireEvent.click(container.querySelector('.status-line__dismiss')!);
      expect(useSubtitleStore.getState().entryHint).toBeNull();
    } finally {
      act(() => {
        runner().state.setState({ phase: 'idle' }, true);
        useAudioStore.setState({ selectedInputDevice: selected });
      });
    }
  });

  it('the wait for a microphone is the line', async () => {
    const selected = useAudioStore.getState().selectedInputDevice;
    useAudioStore.setState({ selectedInputDevice: null });
    try {
      const { container } = await renderPanel();
      act(() => { runner().state.setState({ phase: 'running', since: 0, legs: { speaker: 'live' } }, true); });
      expect(container.querySelector('.status-line')?.getAttribute('data-status')).toBe('mic-waiting');
    } finally {
      act(() => {
        runner().state.setState({ phase: 'idle' }, true);
        useAudioStore.setState({ selectedInputDevice: selected });
      });
    }
  });

  // Ruling 16's toggle: a second press stops the tone, even one still decoding.
  it('stops the test tone on a second press: a playing one ends, a decoding one never plays', async () => {
    const restoreCanvas = stubCanvas();
    const preview = vi.spyOn(playback, 'preview');
    const stopPreview = vi.spyOn(playback, 'stopPreview');
    // `AppAudio.testTone`'s contract: decode, then play unless the press's signal aborted meanwhile.
    let decoded!: (clip: { audio: Float32Array; sampleRate: number }) => void;
    const decode = new Promise<{ audio: Float32Array; sampleRate: number }>((resolve) => { decoded = resolve; });
    tone.testTone.mockImplementation(async (signal?: AbortSignal) => {
      const clip = await decode;
      if (signal?.aborted) return;
      await playback.preview(clip);
    });
    try {
      useSettingsStore.setState({ uiMode: 'advanced' });
      const { container } = await renderPanel();
      const debug = () => container.querySelector('.debug-button') as HTMLButtonElement;

      // Pressed, then pressed again while the tone still decodes.
      fireEvent.click(debug());
      expect(debug().classList.contains('active')).toBe(true);
      fireEvent.click(debug());
      expect(debug().classList.contains('active')).toBe(false);
      const [firstPress] = tone.testTone.mock.calls[0];
      expect(firstPress?.aborted).toBe(true);
      const clip = { audio: new Float32Array(8), sampleRate: 24000 };
      await act(async () => { decoded(clip); });
      expect(preview).not.toHaveBeenCalled();

      // Pressed once more: it plays; a second press stops it.
      let ended!: () => void;
      preview.mockImplementation(() => new Promise<void>((resolve) => { ended = resolve; }));
      stopPreview.mockImplementation(() => ended());
      await act(async () => { fireEvent.click(debug()); });
      expect(preview).toHaveBeenCalledWith(clip);
      expect(debug().classList.contains('active')).toBe(true);
      await act(async () => { fireEvent.click(debug()); });
      expect(stopPreview).toHaveBeenCalled();
      expect(debug().classList.contains('active')).toBe(false);
      expect(tone.testTone.mock.calls[1][0]?.aborted).toBe(true);
    } finally {
      tone.testTone.mockReset();
      tone.testTone.mockImplementation(async () => {});
      preview.mockRestore();
      stopPreview.mockRestore();
      restoreCanvas();
    }
  });

  it("draws the extension's overlay placeholder in place of the list, and no toolbar while idle with nothing to show", async () => {
    env.extension = true;
    useSettingsStore.setState({ subtitleModeActive: true });
    const { container } = await renderPanel();
    expect(container.querySelector('.empty-state')?.textContent).toContain('mainPanel.subtitleTakeover');
    expect(container.querySelector('.conversation-list')).toBeNull();
    expect(container.querySelector('.conversation-toolbar')).toBeNull();
  });

  // Electron's takeover covers the whole window (MainLayout), so its panel draws on as usual.
  it('draws the list as usual in subtitle mode outside the extension', async () => {
    useSettingsStore.setState({ subtitleModeActive: true });
    const { container } = await renderPanel();
    expect(container.querySelector('.empty-state')?.textContent).toContain('simplePanel.startToBegin');
    expect(container.querySelector('.conversation-toolbar')).not.toBeNull();
  });
});

describe('panel notes (spec 2026-10-05 §5)', () => {
  afterEach(() => { delete (window as unknown as { electron?: unknown }).electron; });

  it('draws a note after the conversation as a system row with its own action', async () => {
    const invoke = vi.fn();
    usePanelNotesStore.getState().add({ severity: 'info', code: 'autosave_saved', message: 'saved', params: { filename: 'a.txt' }, action: { kind: 'show-in-folder', dir: '/d' } });
    const { container } = await renderPanel();
    // After the render: the update listeners the panel mounts need the whole bridge, the click only `invoke`.
    env.electron = true;
    (window as unknown as { electron: { invoke: typeof invoke } }).electron = { invoke };
    const row = container.querySelector('.sys-row--info');
    expect(row).not.toBeNull();
    fireEvent.click(row!.querySelector('.sys-row__action')!);
    expect(invoke).toHaveBeenCalledWith('open-directory', '/d');
  });

  it('an expired transient note leaves Clear off over an empty list', async () => {
    usePanelNotesStore.getState().add({ severity: 'info', code: 'export_copied', message: 'copied', lifetime: 'transient' }, Date.now() - TRANSIENT_NOTICE_MS - 1);
    const { container } = await renderPanel();
    expect(container.querySelector('.sys-row--info')).toBeNull();
    expect((container.querySelector('.clear-conversation-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  // Ruling 8 (final review C1): the overlay draws L1 only, so while it runs the panel's
  // placeholder carries the notes under it — the one place they show.
  it("draws a note under the extension overlay's placeholder while the overlay runs", async () => {
    env.extension = true;
    useSettingsStore.setState({ subtitleModeActive: true });
    usePanelNotesStore.getState().add({ severity: 'info', code: 'export_copied', message: 'copied', lifetime: 'transient' });
    const { container } = await renderPanel();
    try {
      act(() => { runner().state.setState({ phase: 'running', since: 0, legs: { speaker: 'live' } }, true); });
      const placeholder = container.querySelector('.conversation-display > .empty-state')!;
      expect(placeholder.querySelector('p')?.textContent).toContain('mainPanel.subtitleTakeover');
      const row = placeholder.querySelector('.sys-row--info');
      expect(row).not.toBeNull();
      expect(placeholder.querySelector('p')!.compareDocumentPosition(row!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      act(() => { runner().state.setState({ phase: 'idle' }, true); });
    }
  });

  it('Clear removes the notes with the conversation', async () => {
    usePanelNotesStore.getState().add({ severity: 'info', code: 'export_copied', message: 'copied', lifetime: 'transient' });
    const { container } = await renderPanel();
    expect(container.querySelector('.sys-row--info')).not.toBeNull();
    fireEvent.click(container.querySelector('.clear-conversation-btn')!);
    expect(usePanelNotesStore.getState().notes).toEqual([]);
  });
});
