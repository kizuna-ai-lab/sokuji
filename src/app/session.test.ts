import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Kept from before the old audio service was deleted: ServiceFactory used to
// import ModernBrowserAudioService -> ModernAudioRecorder -> a worklet
// `?url` import that this sandboxed Vite test transform denied outright.
// ServiceFactory no longer reaches ModernAudioRecorder at all; this test's
// subject, session.ts, reaches it only via `capture/mic`, which is mocked
// directly below. Not needed by the current graph for that reason.
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

// The page's playback, as SpinePreview.test.tsx mocks it: no Web Audio in
// jsdom. Module-level so a test can see what the run handed it.
const { playback, getAppAudio } = vi.hoisted(() => {
  const queue = () => ({ position: () => null, pending: 0, subscribe: () => () => {} });
  const playback = {
    queues: { speaker: queue(), participant: queue(), replay: queue() },
    audio: vi.fn(), held: vi.fn(), clear: vi.fn(), live: vi.fn(), passthrough: vi.fn(), onVoiceIdle: vi.fn(() => () => {}),
    ttsTap: { read: () => new Float32Array(0) },
    meter: vi.fn(() => null),
  };
  return { playback, getAppAudio: vi.fn(async () => ({ playback, testTone: async () => {} })) };
});
// The logger reached through the session resolves outlets with the real `outletContext`.
vi.mock('../lib/audio/appAudio', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/audio/appAudio')>()), getAppAudio }));

// The app's own capture, over stand-ins for the devices, as appCapture.test.ts
// mocks them: a test that routes a leg through it (`capture: (app) => app`)
// sets `devices.next`; every other test hands the run a fake source directly.
const devices = vi.hoisted(() => ({
  /** What the next device opens to; none, and it refuses. */
  next: null as FakeSource | null,
  async open(): Promise<FakeSource> {
    if (!this.next) throw new Error('no device in tests');
    return this.next;
  },
}));
vi.mock('../lib/audio/capture/mic', () => ({ openMic: () => devices.open() }));
const labellerBuilds = vi.hoisted(() => ({ count: 0 }));
vi.mock('../lib/notes/runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/notes/runner')>();
  return { ...actual, notesSpeakerLabel: (...args: Parameters<typeof actual.notesSpeakerLabel>) => { labellerBuilds.count += 1; return actual.notesSpeakerLabel(...args); } };
});
vi.mock('../lib/audio/capture/systemAudio', () => ({ openSystemAudio: () => devices.open() }));
vi.mock('../lib/audio/capture/tab', () => ({ openTab: () => devices.open() }));
vi.mock('../lib/audio/capture/echoWatch', () => ({
  createEchoWatch: () => ({ attach: () => () => {}, onNotice: () => {}, setDiagnostics: () => {} }),
}));

// As punctuation.test.ts mocks it: this file only needs the runtime's
// `enabled` (the stores decide it) and a `punctuate` that answers nothing.
vi.mock('../lib/segmentation/PunctuationRuntime', () => {
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

// The desktop capture a pick opens, as screenContext.test.ts scripts it: a
// picture that is never blank, so the sampler's first frame comes on its first
// beat. Each capture opened is kept, to see that the run's end closes it.
const desktop = vi.hoisted(() => {
  const W = 64;
  const H = 36;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.round(30 + (x / W) * 100);
      rgba.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  const opened: Array<{ name: string; closed: boolean }> = [];
  return {
    opened,
    async open(source: { name: string; kind: 'window' | 'screen' }) {
      const capture = {
        name: source.name,
        kind: source.kind,
        closed: false,
        grab: async () => (capture.closed ? null : { rgba, width: W, height: H }),
        encode: async () => new Uint8Array([0xff, 0xd8, 0x01]),
        close: () => { capture.closed = true; },
      };
      opened.push(capture);
      return capture;
    },
  };
});
vi.mock('../lib/screen/desktopFrames', () => ({
  captureSourceMode: async () => ({ mode: 'list', screenRecording: 'granted' }),
  listCaptureSources: async () => ({ ok: true, sources: [] }),
  openDesktopCapture: (source: { name: string; kind: 'window' | 'screen' }) => desktop.open(source),
}));

vi.mock('../lib/export/appAutoSave', () => ({
  autoSaveConversation: vi.fn(async () => 'saved'),
}));

// The real karaoke's own subscribe/unsubscribe, spied on: item 8's proxy
// gating test needs to see whether the root ever bridges into it, without a
// real playback's queues to drive `createKaraoke`'s internal sampling.
const { karaokeSubscribe, karaokeUnsubscribe } = vi.hoisted(() => ({
  karaokeSubscribe: vi.fn(),
  karaokeUnsubscribe: vi.fn(),
}));
vi.mock('../lib/view/karaoke', () => ({
  createKaraoke: () => ({
    get: () => ({ lit: new Map(), replaying: null }),
    subscribe: (listener: () => void) => {
      karaokeSubscribe(listener);
      return () => { karaokeUnsubscribe(); };
    },
  }),
}));

import { AdapterStartError } from '../lib/contract/adapter';
import { createVirtualClock } from '../lib/contract/clock';
import { settleReports } from '../lib/diagnostics/report';
import { autoSaveConversation } from '../lib/export/appAutoSave';
import { DEFAULT_CLOSE_TIMEOUT_MS } from '../lib/session/runner';
import { usePanelNotesStore } from '../stores/panelNotesStore';
import { fakeLeasedProvider } from '../providers/fake/leased';
import { fakeProvider } from '../providers/fake/provider';
import { FAKE_LEASED_DEFAULTS } from '../providers/fake/settings';
import { createFakeSource, type FakeSource } from '../providers/fake/source';
import { localInferenceProvider } from '../providers/localInference/provider';
import { qwenLiveTranslateProvider } from '../providers/qwen_livetranslate/provider';
import { readShapeFromStores } from '../lib/session/appShape';
import { createSampler } from '../lib/screen/sampler';
import { useScreenContextStore, type PickedSource } from '../stores/screenContextStore';
import useAudioStore from '../stores/audioStore';
import useLogStore from '../stores/logStore';
import { useProviderStore } from '../stores/providerStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useLineUpStore } from '../stores/lineUpStore';
import { useLiveNotes } from '../lib/notes/live/liveStore';
import { useTurnModeStore } from '../stores/turnModeStore';
import { READINESS_DELAY_MS } from './readiness';
import { createAppSession, type AppSessionOptions } from './session';
import { currentSubtitleFeed } from './subtitleFeed';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HistoryPort } from '../lib/history/port';

const autoSave = vi.mocked(autoSaveConversation);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const providersBefore = useProviderStore.getState();
const audioBefore = useAudioStore.getState();
const settingsBefore = useSettingsStore.getState();
const segmentationBefore = useSegmentationStore.getState();
const turnModeBefore = useTurnModeStore.getState();

beforeEach(() => {
  useProviderStore.setState({ entries: {}, intent: undefined, readiness: {}, selected: null, legs: ['speaker'] });
  useAudioStore.setState({ mode: 'speaker', selectedInputDevice: null });
  devices.next = null;
  vi.clearAllMocks();
});

afterEach(() => {
  useProviderStore.setState(providersBefore, true);
  useAudioStore.setState(audioBefore, true);
  useSettingsStore.setState(settingsBefore, true);
  useSegmentationStore.setState(segmentationBefore, true);
  useTurnModeStore.setState(turnModeBefore, true);
  useLogStore.getState().setEnabled(false);
});

async function setup(options: AppSessionOptions = {}) {
  const clock = createVirtualClock(0);
  await useProviderStore.getState().load(fakeProvider);
  useProviderStore.getState().select('fake');
  const session = createAppSession({
    clock,
    newSessionId: () => 'run1',
    capture: () => async () => createFakeSource(clock),
    microphoneRequired: () => false,
    ...options,
  });
  const track = vi.fn();
  session.setBridges({ track });
  return { clock, session, track };
}

/** Electron's IPC as the preload exposes it: `receive` keeps each handler by channel, `invoke` records each channel in `order`. */
function electronIpc(order: string[] = []) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc = {
    invoke: vi.fn(async (channel: string, _data?: unknown) => { order.push(channel); }),
    receive: vi.fn((channel: string, fn: (...args: unknown[]) => void) => { handlers.set(channel, fn); }),
    removeListener: vi.fn(),
  };
  const closeRequested = () => handlers.get('app:close-requested')!();
  return { ipc, handlers, order, closeRequested };
}

describe('createAppSession', () => {
  it('builds no playback until asked, and builds it once', async () => {
    const { session } = await setup();
    expect(getAppAudio).not.toHaveBeenCalled();
    const first = session.audio();
    const second = session.audio();
    expect(second).toBe(first);
    const loaded = await first;
    expect(getAppAudio).toHaveBeenCalledTimes(1);
    expect(loaded.playback).toBe(playback);
    expect(loaded.capture).toMatchObject({ openSource: expect.any(Function), echo: expect.any(Object), levels: expect.any(Object) });
  });

  it("subscribes to the playback's voice idles once, when it loads", async () => {
    const { session } = await setup();
    expect(playback.onVoiceIdle).not.toHaveBeenCalled();
    await session.audio(); await session.audio();
    expect(playback.onVoiceIdle).toHaveBeenCalledTimes(1);
  });

  it('opens a leg only once the playback has loaded, and plays the run through it', async () => {
    const { session } = await setup();
    await session.runner.start();
    expect(session.runner.state.getState().phase).toBe('running');
    expect(getAppAudio).toHaveBeenCalledTimes(1);
    expect(playback.live).toHaveBeenCalledWith(true);
    await session.runner.stop();
  });

  // The owner's rule (2026-09-26): the mic strip shows whether the voice is
  // fed into processing. The meter runs on the real clock, which barely moves
  // here: two chunks make a window of the tone, and flat at once on the
  // release is the gate's reset, not the meter's own staleness.
  it("keeps the speaker's meter flat under push-to-talk until a press, then follows the chunks until the release", async () => {
    useTurnModeStore.setState({ turnMode: 'push-to-talk' });
    const { session, clock } = await setup({ capture: (app) => app });
    devices.next = createFakeSource(clock, { voiced: true });
    const flat = (levels: Float32Array) => [...levels].every((v) => v === 0);
    await session.runner.start();
    const { levels } = (await session.audio()).capture;

    clock.advance(300);
    expect(flat(levels.speaker.read())).toBe(true);
    session.runner.press();
    clock.advance(200);
    expect(flat(levels.speaker.read())).toBe(false);
    session.runner.release();
    clock.advance(100);
    expect(flat(levels.speaker.read())).toBe(true);

    await session.runner.stop();
  });

  it('keeps one karaoke: nothing lit before the playback loads, the real one after, behind the same object', async () => {
    const { session } = await setup();
    const karaoke = session.karaoke;
    const idle = karaoke.get();
    expect(idle.lit.size).toBe(0);
    expect(idle.replaying).toBeNull();
    expect(karaoke.get()).toBe(idle);
    const listener = vi.fn();
    karaoke.subscribe(listener);
    await session.audio();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.karaoke).toBe(karaoke);
  });

  it("auto-saves a run's end once, then refetches the balance", async () => {
    const order: string[] = [];
    autoSave.mockImplementationOnce(async () => {
      await Promise.resolve();
      order.push('saved');
      return 'saved';
    });
    const refetchQuota = vi.fn(async () => { order.push('refetch'); });
    const { session } = await setup();
    session.setBridges({ refetchQuota });
    await session.runner.start();
    await session.runner.stop();
    expect(autoSave).toHaveBeenCalledTimes(1);
    const [legs, info] = autoSave.mock.calls[0];
    expect(legs.map((leg) => leg.leg)).toEqual(['speaker']);
    expect(info).toBe(session.runner.conversation.info);
    expect(refetchQuota).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['saved', 'refetch']);
  });

  it('clears the panel notes when a run starts (spec 2026-10-05 §5)', async () => {
    const { session } = await setup();
    // The clearing is an attach-time subscription, like the session's others.
    const detach = session.attach();
    usePanelNotesStore.getState().add({ severity: 'info', code: 'export_copied', message: 'copied' });
    session.runner.state.setState({ phase: 'starting', step: 'checking' });
    expect(usePanelNotesStore.getState().notes).toEqual([]);
    detach();
  });

  // Final review I2: the subtitle surfaces' Clear reaches the runner, not MainPanel's
  // handler, so the session clears the notes when the conversation empties.
  it('clears the panel notes when the conversation is cleared from anywhere', async () => {
    const { session } = await setup();
    const detach = session.attach();
    usePanelNotesStore.getState().add({ severity: 'info', code: 'export_copied', message: 'copied' });
    session.runner.clear();
    expect(usePanelNotesStore.getState().notes).toEqual([]);
    detach();
    // Detached, a Clear leaves the store alone.
    usePanelNotesStore.getState().add({ severity: 'info', code: 'export_copied', message: 'copied' });
    session.runner.clear();
    expect(usePanelNotesStore.getState().notes).toHaveLength(1);
    usePanelNotesStore.getState().clear();
  });

  it("writes the auto-save's note while the run's conversation stands", async () => {
    autoSave.mockImplementationOnce(async (_legs, _info, notify) => {
      await Promise.resolve();
      notify.note({ severity: 'info', code: 'autosave_saved', message: 'saved' });
      return 'saved';
    });
    const { session } = await setup();
    await session.runner.start();
    await session.runner.stop();
    expect(usePanelNotesStore.getState().notes.map((n) => n.code)).toEqual(['autosave_saved']);
    usePanelNotesStore.getState().clear();
  });

  // PR #598 review: a save can outlive the runner's 5 s bound, after which the
  // next run may start. Its result must not be drawn in that run's conversation.
  it("drops the auto-save's note when the conversation was reset before the save answered", async () => {
    let finish!: () => void;
    autoSave.mockImplementationOnce(async (_legs, _info, notify) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      notify.note({ severity: 'info', code: 'autosave_saved', message: 'saved' });
      return 'saved';
    });
    const { session } = await setup();
    await session.runner.start();
    const stopping = session.runner.stop();
    await vi.waitFor(() => expect(autoSave).toHaveBeenCalledTimes(1));
    // Clear, or the next start: the notes are emptied while the save still writes.
    usePanelNotesStore.getState().clear();
    finish();
    await stopping;
    expect(usePanelNotesStore.getState().notes).toEqual([]);
  });

  it('never erases a bridge with undefined: a later setBridges without refetchQuota keeps the earlier one', async () => {
    const { session } = await setup();
    const refetchQuota = vi.fn(async () => {});
    session.setBridges({ refetchQuota });
    const track = vi.fn();
    session.setBridges({ refetchQuota: undefined, track });

    await session.runner.start();
    await session.runner.stop();
    await flush();

    expect(refetchQuota).toHaveBeenCalledTimes(1);
  });

  it('saves nothing and loads nothing for a refused start', async () => {
    const { session } = await setup({ refuse: () => true });
    await session.runner.start();
    expect(session.runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'refused', notice: { code: 'no_provider' } } });
    expect(autoSave).not.toHaveBeenCalled();
    expect(getAppAudio).not.toHaveBeenCalled();
  });

  it('sends the session events with what the app keeps', async () => {
    useAudioStore.setState({ noiseSuppressionMode: 'standard', isMicMuted: false, isMonitorMuted: true, isRealVoicePassthroughEnabled: true });
    useSettingsStore.setState({ segmentationMode: 'sentences', sentenceSegmentationChunkSentences: 2 });
    useSegmentationStore.setState({ phase: 'ready' });
    const { session, track } = await setup();
    await session.runner.start();
    const start = track.mock.calls.find(([event]) => event === 'translation_session_start')?.[1];
    expect(start).toEqual(expect.objectContaining({
      session_id: 'run1',
      noise_suppression_enabled: true,
      noise_suppression_mode: 'standard',
      real_voice_passthrough_enabled: true,
      input_device_on: true,
      monitor_device_on: false,
      sentence_segmentation_enabled: true,
      sentence_segmentation_active: true,
      sentence_segmentation_chunk_sentences: 2,
    }));
    expect(start).not.toHaveProperty('model');
    session.frames.port.frame('speaker', { direction: 'out', type: 'local.segmentation.seal', payload: { reason: 'sentences', text: 'One.' } });
    await session.runner.stop();
    const end = track.mock.calls.find(([event]) => event === 'translation_session_end')?.[1];
    expect(end).toEqual(expect.objectContaining({ session_id: 'run1', segmentation_seals: { speaker_sentences: 1 } }));
    expect(end).not.toHaveProperty('translation_count');
  });

  it('asks for a microphone unless told otherwise', async () => {
    const asked = await setup({ microphoneRequired: undefined });
    expect(asked.session.subtitle.get()).toMatchObject({ canStart: false, idle: { code: 'no_microphone' } });
    const told = await setup();
    expect(told.session.subtitle.get().canStart).toBe(true);
  });

  it('subscribes to the real karaoke only while the proxy has a listener, unsubscribing when the last one leaves', async () => {
    const { session } = await setup();
    await session.audio();
    expect(karaokeSubscribe).not.toHaveBeenCalled();

    const offA = session.karaoke.subscribe(() => {});
    expect(karaokeSubscribe).toHaveBeenCalledTimes(1);
    const offB = session.karaoke.subscribe(() => {});
    expect(karaokeSubscribe).toHaveBeenCalledTimes(1); // one bridging subscription serves every listener

    offA();
    expect(karaokeUnsubscribe).not.toHaveBeenCalled();
    offB();
    expect(karaokeUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('retries a failed playback load', async () => {
    getAppAudio.mockRejectedValueOnce(new Error('boom'));
    const { session } = await setup();

    await expect(session.audio()).rejects.toThrow('boom');
    const loaded = await session.audio();

    expect(loaded.playback).toBe(playback);
    expect(getAppAudio).toHaveBeenCalledTimes(2);
  });
});

describe('start', () => {
  it('never reaches the runner while canStart is false: its state stays the same object', async () => {
    const { session, track } = await setup({ microphoneRequired: undefined });
    expect(session.subtitle.get().canStart).toBe(false);
    const before = session.runner.state.getState();

    await session.start('button');

    expect(session.runner.state.getState()).toBe(before);
    expect(track).not.toHaveBeenCalled();
  });

  it('starts once canStart is true, forwarding the method to the runner', async () => {
    const { session, track } = await setup();
    expect(session.subtitle.get().canStart).toBe(true);

    await session.start('button');

    expect(session.runner.state.getState().phase).toBe('running');
    expect(track).toHaveBeenCalledWith('session_control_clicked', { action: 'start', method: 'button' });

    await session.runner.stop();
  });
});

describe('start — screen context (spec 2026-10-22 §3.1)', () => {
  const SLIDES = { id: 'window:1', name: 'Slides', kind: 'window' as const, thumbnail: 'data:,', appIcon: null };
  const auth = { signedIn: false, getToken: async () => null };

  beforeEach(() => {
    // The desktop app: where Qwen is offered and the picker is a modal.
    window.electronAPI = {};
    desktop.opened.length = 0;
    useScreenContextStore.setState({ sampler: null, state: null, picked: null });
  });

  afterEach(() => {
    delete window.electronAPI;
    useScreenContextStore.getState().sampler?.close();
    useScreenContextStore.setState({ sampler: null, state: null, picked: null });
  });

  /** Qwen with its own key unset (the run is refused once it checks), the switch as given. */
  async function qwen(screenContext: boolean, withPicker = true) {
    const clock = createVirtualClock(0);
    await useProviderStore.getState().load(qwenLiveTranslateProvider);
    useProviderStore.getState().select('qwen_livetranslate');
    useProviderStore.getState().updateSettings(qwenLiveTranslateProvider, { screenContext });
    const session = createAppSession({
      clock,
      newSessionId: () => 'run1',
      capture: () => async () => createFakeSource(clock),
      microphoneRequired: () => false,
    });
    const order: string[] = [];
    const pickScreenSource = vi.fn(async (): Promise<PickedSource | null> => {
      order.push('pick');
      return { kind: 'desktop' as const, source: SLIDES };
    });
    session.setBridges({ track: vi.fn(), ...(withPicker ? { pickScreenSource } : {}) });
    // What the runner read at its start: the stores do not move between its read and the step it sets.
    const carried: Array<{ frames?: unknown } | null> = [];
    session.runner.state.subscribe((now, before) => {
      if (now.phase !== 'starting' || before.phase !== 'idle') return;
      order.push('starting');
      carried.push(readShapeFromStores(auth));
    });
    return { clock, session, order, carried, pickScreenSource };
  }

  /** The sampler's beats, a second at a time; the pick and its capture land before the first. */
  async function beats(clock: ReturnType<typeof createVirtualClock>, seconds: number) {
    const settle = async () => { for (let j = 0; j < 50; j++) await Promise.resolve(); };
    for (let i = 0; i < seconds; i++) {
      await settle();
      clock.advance(1000);
      await settle();
    }
  }

  it("with the switch on and nothing held, start asks the picker before the runner and the run carries the source; the run's end releases it", async () => {
    const { clock, session, order, carried, pickScreenSource } = await qwen(true);
    expect(session.subtitle.get().canStart).toBe(true);
    const started = session.start('button');
    await beats(clock, 1);
    await started;
    expect(pickScreenSource).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['pick', 'starting']);
    expect(carried[0]?.frames).toMatchObject({ name: 'Slides', kind: 'window' });
    // No key: the run was refused once it checked, and that end released the source.
    expect(session.runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'refused' } });
    expect(useScreenContextStore.getState()).toMatchObject({ sampler: null, state: null });
    expect(desktop.opened).toHaveLength(1);
    expect(desktop.opened[0].closed).toBe(true);
  });

  it('with the switch off, the picker is never asked and the shape has no frames', async () => {
    const { session, order, carried, pickScreenSource } = await qwen(false);
    await session.start('button');
    expect(pickScreenSource).not.toHaveBeenCalled();
    expect(order).toEqual(['starting']);
    expect(carried[0]).not.toBeNull();
    expect('frames' in carried[0]!).toBe(false);
    expect(desktop.opened).toHaveLength(0);
  });

  it('a second Start while the picker is open is the same start', async () => {
    const { clock, session, pickScreenSource } = await qwen(true);
    const first = session.start('button');
    const second = session.start('button');
    expect(second).toBe(first);
    await beats(clock, 1);
    await first;
    expect(pickScreenSource).toHaveBeenCalledTimes(1);
    expect(desktop.opened).toHaveLength(1);
  });

  it('without a picker mounted, starts without frames and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { session, order, carried } = await qwen(true, false);
      await session.start('button');
      expect(order).toEqual(['starting']);
      expect('frames' in carried[0]!).toBe(false);
      expect(desktop.opened).toHaveLength(0);
      expect(session.runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'refused' } });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[ScreenContext]'));
    } finally {
      warn.mockRestore();
    }
  });

  it('a picker taken away with null (the panel unmounting) is not asked any more, and the start says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { session, order, pickScreenSource } = await qwen(true);
      session.setBridges({ pickScreenSource: null });
      await session.start('button');
      expect(pickScreenSource).not.toHaveBeenCalled();
      expect(order).toEqual(['starting']);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[ScreenContext]'));
    } finally {
      warn.mockRestore();
    }
  });

  it('a pick held from the settings opens at Start without asking, and stays held after the run', async () => {
    const { clock, session, order, carried, pickScreenSource } = await qwen(true);
    useScreenContextStore.getState().setPicked({ kind: 'desktop', source: SLIDES });
    const started = session.start('button');
    await beats(clock, 1);
    await started;
    expect(pickScreenSource).not.toHaveBeenCalled();
    expect(order).toEqual(['starting']);
    expect(carried[0]?.frames).toMatchObject({ name: 'Slides', kind: 'window' });
    expect(useScreenContextStore.getState().picked).toEqual({ kind: 'desktop', source: SLIDES });
  });

  it('Start without screen context in the picker turns the switch off, so the run and the setting agree (owner, 2026-10-22, ruling 3)', async () => {
    const { session, carried, pickScreenSource } = await qwen(true);
    pickScreenSource.mockImplementationOnce(async () => null);
    await session.start('button');
    expect(pickScreenSource).toHaveBeenCalledTimes(1);
    expect(useProviderStore.getState().entries.qwen_livetranslate.settings).toMatchObject({ screenContext: false });
    expect(useScreenContextStore.getState().picked).toBeNull();
    expect('frames' in carried[0]!).toBe(false);
    expect(desktop.opened).toHaveLength(0);
  });

  it('a start with no picker to ask leaves the switch as it is: nobody chose to start without', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { session } = await qwen(true, false);
      await session.start('button');
      expect(useProviderStore.getState().entries.qwen_livetranslate.settings).toMatchObject({ screenContext: true });

      // The panel unmounting mid-pick: its open pick answered null, its picker taken away in the same step.
      const unmounting = await qwen(true);
      unmounting.pickScreenSource.mockImplementationOnce(async () => {
        unmounting.session.setBridges({ pickScreenSource: null });
        return null;
      });
      await unmounting.session.start('button');
      expect(unmounting.pickScreenSource).toHaveBeenCalledTimes(1);
      expect(useProviderStore.getState().entries.qwen_livetranslate.settings).toMatchObject({ screenContext: true });
    } finally {
      warn.mockRestore();
    }
  });

  it("a live run's stop releases the source it carried", async () => {
    const { session, clock } = await setup();
    const sampler = createSampler(clock);
    useScreenContextStore.getState().set(sampler);
    await session.start('button');
    expect(session.runner.state.getState().phase).toBe('running');
    expect(useScreenContextStore.getState().sampler).toBe(sampler);
    await session.runner.stop();
    expect(useScreenContextStore.getState()).toMatchObject({ sampler: null, state: null });
    // Closed: a capture attached now is ignored.
    sampler.attach({ name: 'Late', kind: 'window', grab: async () => null, encode: async () => new Uint8Array() });
    expect(sampler.state().name).not.toBe('Late');
  });
});

describe('attach', () => {
  it("registers the subtitle feed the extension overlay's publisher reads, only while attached (plan 1e-4 ruling 1)", async () => {
    const { session } = await setup();
    expect(currentSubtitleFeed()).toBeNull();
    const detach = session.attach();

    const feed = currentSubtitleFeed()!;
    expect(feed.sources.session).toBe(session.subtitle);
    expect(feed.sources.karaoke).toBe(session.karaoke);
    expect(feed.sources.entries.get()).toBe(session.view.get().entries);

    const press = vi.spyOn(session.runner, 'press');
    const release = vi.spyOn(session.runner, 'release');
    const clear = vi.spyOn(session.runner, 'clear');
    feed.press();
    feed.release();
    feed.clear();
    expect(press).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);

    detach();
    expect(currentSubtitleFeed()).toBeNull();
  });

  it('abandons the run on pagehide, only while attached', async () => {
    const { session } = await setup();
    await session.runner.start();
    const detach = session.attach();

    window.dispatchEvent(new Event('pagehide'));
    expect(session.runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'user' } });
    expect(autoSave).not.toHaveBeenCalled();

    detach();
    await session.runner.start();
    window.dispatchEvent(new Event('pagehide'));
    expect(session.runner.state.getState().phase).not.toBe('idle');
    await session.runner.stop();
  });

  it('does nothing on a second live attach, reported once as a warning', async () => {
    useLogStore.getState().setEnabled(true);
    useLogStore.getState().clearLogs();
    const { session } = await setup();
    const detach1 = session.attach();
    const detach2 = session.attach();

    await settleReports();
    expect(useLogStore.getState().logs.filter((l) => l.type === 'warning')).toHaveLength(1);

    // The second attach's own effects never registered: detaching it changes nothing.
    await session.runner.start();
    detach2();
    window.dispatchEvent(new Event('pagehide'));
    expect(session.runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'user' } });

    detach1();
  });

  it('attaches again once the first has detached', async () => {
    const { session } = await setup();
    const detach1 = session.attach();
    detach1();

    const detach2 = session.attach();
    await session.runner.start();
    window.dispatchEvent(new Event('pagehide'));
    expect(session.runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'user' } });

    detach2();
  });

  it("keeps the provider store's legs on the audio mode", async () => {
    const { session } = await setup();
    const detach = session.attach();

    useAudioStore.setState({ mode: 'both' });
    expect(useProviderStore.getState().legs).toEqual(['speaker', 'participant']);

    detach();
  });

  it("keeps the provider store's speech inputs on the text-only switch, only while attached (Stage 2 Volcengine AST2, choice 1)", async () => {
    const { session } = await setup();
    useSettingsStore.setState({ textOnly: false });
    const detach = session.attach();

    useSettingsStore.setState({ textOnly: true });
    expect(useProviderStore.getState().speech.textOnly).toBe(true);

    detach();
    useSettingsStore.setState({ textOnly: false });
    expect(useProviderStore.getState().speech.textOnly).toBe(true);
  });

  it('checks a local provider by itself', async () => {
    const { session, clock } = await setup();
    const spy = vi.fn(async () => ({ state: 'unknown' as const }));
    useProviderStore.setState({
      selected: 'local_inference',
      entries: { local_inference: { settings: {}, credentials: {}, pair: { source: 'ja', target: 'en' } } },
      readiness: {},
      refreshReadiness: spy,
    });
    const detach = session.attach();

    clock.advance(READINESS_DELAY_MS);
    await flush();

    expect(spy).toHaveBeenCalledWith(localInferenceProvider, { signedIn: false, getToken: expect.any(Function) });

    detach();
  });

  it("forgets a managed provider's readiness when the sign-in or the account flips — after the render, not during it", async () => {
    const { session } = await setup();
    useProviderStore.setState({
      selected: 'fake_leased',
      entries: { fake_leased: { settings: FAKE_LEASED_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } },
      readiness: { fake_leased: { state: 'ready', models: [] } },
    });
    const detach = session.attach();
    const readiness = () => useProviderStore.getState().readiness.fake_leased;

    session.setBridges({ auth: { signedIn: true, userId: 'u1', getToken: async () => 't' } });
    expect(readiness()).toEqual({ state: 'ready', models: [] });
    await Promise.resolve();
    expect(readiness()).toEqual({ state: 'unknown' });

    useProviderStore.setState({ readiness: { fake_leased: { state: 'ready', models: [] } } });
    session.setBridges({ auth: { signedIn: true, userId: 'u1', getToken: async () => 't' } });
    await Promise.resolve();
    expect(readiness()).toEqual({ state: 'ready', models: [] });

    session.setBridges({ auth: { signedIn: true, userId: 'u2', getToken: async () => 't' } });
    await Promise.resolve();
    expect(readiness()).toEqual({ state: 'unknown' });

    detach();
  });

  it('forgets it too when the sign-in finishes loading', async () => {
    const { session } = await setup();
    useProviderStore.setState({
      selected: 'fake_leased',
      entries: { fake_leased: { settings: FAKE_LEASED_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } },
      readiness: { fake_leased: { state: 'ready', models: [] } },
    });
    const detach = session.attach();
    const readiness = () => useProviderStore.getState().readiness.fake_leased;
    const getToken = async () => 't';

    session.setBridges({ auth: { signedIn: false, loaded: false, getToken } });
    await Promise.resolve();
    useProviderStore.setState({ readiness: { fake_leased: { state: 'ready', models: [] } } });

    session.setBridges({ auth: { signedIn: false, loaded: true, getToken } });
    await Promise.resolve();
    expect(readiness()).toEqual({ state: 'unknown' });

    useProviderStore.setState({ readiness: { fake_leased: { state: 'ready', models: [] } } });
    session.setBridges({ auth: { signedIn: false, loaded: true, getToken } });
    await Promise.resolve();
    expect(readiness()).toEqual({ state: 'ready', models: [] });

    detach();
  });

  it('tells Electron it is busy through a run', async () => {
    const invoke = vi.fn(async () => undefined);
    const { session } = await setup({ ipc: { invoke } });
    const detach = session.attach();

    await session.runner.start();
    expect(invoke).toHaveBeenCalledWith('app:session-busy', true);

    await session.runner.stop();
    await session.runner.settled();
    await flush();
    expect(invoke).toHaveBeenCalledWith('app:session-busy', false);

    detach();
  });

  it('invokes nothing with ipc: null', async () => {
    // window.electron stands in for what the default would reach, so a
    // regression that ignores `ipc: null` shows up here instead of silently
    // finding nothing to call.
    const invoke = vi.fn(async () => undefined);
    (window as unknown as { electron: { invoke: typeof invoke } }).electron = { invoke };
    const { session } = await setup({ ipc: null });
    const detach = session.attach();

    await session.runner.start();
    await session.runner.stop();
    await session.runner.settled();
    await flush();

    expect(invoke).not.toHaveBeenCalled();

    detach();
    delete (window as { electron?: unknown }).electron;
  });

  it("names each run's id on every event of that run, and the next run its own", async () => {
    const ids = ['run1', 'run2'];
    useTurnModeStore.setState({ turnMode: 'push-to-talk' });
    const { session, clock, track } = await setup({ newSessionId: () => ids.shift()! });
    const detach = session.attach();

    await session.runner.start();
    session.runner.press();
    clock.advance(1_000);
    session.runner.release();
    session.runner.sendText('hi');
    await session.runner.stop();
    await session.runner.start();
    await session.runner.stop();

    const withId = track.mock.calls
      .filter(([, properties]) => properties && typeof properties === 'object' && 'session_id' in properties)
      .map(([event, properties]) => [event, (properties as { session_id: string }).session_id]);
    expect(withId).toEqual([
      ['translation_session_start', 'run1'],
      ['push_to_talk_used', 'run1'],
      ['text_input_sent', 'run1'],
      ['translation_session_end', 'run1'],
      ['translation_session_start', 'run2'],
      ['translation_session_end', 'run2'],
    ]);

    detach();
  });

  it("answers Electron's close request only once the run's save has landed", async () => {
    const { ipc, order, closeRequested } = electronIpc();
    let save!: () => void;
    autoSave.mockImplementationOnce(() => new Promise((resolve) => {
      save = () => {
        order.push('saved');
        resolve('saved');
      };
    }));
    const { session } = await setup({ ipc });
    const detach = session.attach();
    await session.runner.start();

    const closing = closeRequested();
    await flush();
    expect(autoSave).toHaveBeenCalledTimes(1);
    expect(ipc.invoke).not.toHaveBeenCalledWith('app:close-ready');

    save();
    await closing;
    expect(order.filter((step) => step === 'app:close-ready')).toHaveLength(1);
    expect(order.indexOf('saved')).toBeLessThan(order.indexOf('app:close-ready'));
    expect(session.runner.state.getState().phase).toBe('idle');

    detach();
  });

  it("waits out an ending that outlived the runner's bound before answering the close", async () => {
    const { ipc, closeRequested } = electronIpc();
    let save!: () => void;
    autoSave.mockImplementationOnce(() => new Promise((resolve) => { save = () => resolve('saved'); }));
    const sourceClock = createVirtualClock(0);
    // A capture that never finishes stopping: its release times out at 5 s,
    // then the held save runs past the runner's 15 s bound.
    const { session, clock } = await setup({
      ipc,
      capture: () => async () => ({ ...createFakeSource(sourceClock), stop: () => new Promise<void>(() => {}) }),
    });
    const detach = session.attach();
    await session.runner.start();

    const closing = closeRequested();
    await flush();
    clock.advance(DEFAULT_CLOSE_TIMEOUT_MS);
    await flush();
    expect(session.runner.state.getState().phase).toBe('idle');
    expect(autoSave).toHaveBeenCalledTimes(1);
    expect(ipc.invoke).not.toHaveBeenCalledWith('app:close-ready');

    save();
    await closing;
    expect(ipc.invoke).toHaveBeenCalledWith('app:close-ready');

    detach();
  });

  it("answers Electron's close request at once when nothing runs", async () => {
    const { ipc, closeRequested } = electronIpc();
    const { session } = await setup({ ipc });
    const detach = session.attach();

    await closeRequested();
    expect(ipc.invoke).toHaveBeenCalledWith('app:close-ready');

    detach();
  });

  describe('live notes during a session', () => {
    /** A live notes loop the test watches: what it was given, and whether it stopped or was let go. */
    /** A loop that records what happened to it; `lastUpdate`, when given, holds its stop until it settles. */
    function fakeLive(lastUpdate?: Promise<void>) {
      const made: Array<{ deps: unknown; sentences: number[]; stopped: boolean; disposed: boolean }> = [];
      const factory = (deps: unknown) => {
        const one = { deps, sentences: [] as number[], stopped: false, disposed: false };
        made.push(one);
        return {
          sentences: (list: ReadonlyArray<{ n: number }>) => { one.sentences.push(...list.map((x) => x.n)); },
          stop: async () => { await lastUpdate; one.stopped = true; },
          dispose: () => { one.disposed = true; },
        };
      };
      return { made, factory };
    }
    const historyPort = () => {
      const answer = (value: unknown) => async () => value;
      return {
        openRecord: answer(undefined), putLeg: answer(undefined), createTranscript: answer(1), putSegments: answer(undefined),
        putNotices: answer(undefined), appendSentences: answer({ added: 0 }), reviseSentences: answer(undefined), closeRecord: answer({ kept: true }),
      } as unknown as HistoryPort;
    };
    async function withLive(on: boolean, service: string | null, run: () => Promise<void>) {
      const lineUpBefore = useLineUpStore.getState().lineUp;
      useSettingsStore.setState({ liveNotes: on } as never);
      useLineUpStore.setState({ lineUp: { transcription: 'fake', translation: 'fake', speech: 'fake', summarisation: service } } as never);
      useProviderStore.setState({ entries: { ...useProviderStore.getState().entries, openai: { settings: {}, credentials: { apiKey: 'sk-test' }, pair: { source: 'en', target: 'ja' } } } } as never);
      try { await run(); } finally {
        useSettingsStore.setState({ liveNotes: false } as never);
        useLineUpStore.setState({ lineUp: lineUpBefore });
      }
    }

    it('feeds a loop for the record while the session runs, and gives it its last update at Stop', async () => {
      await withLive(true, 'openai', async () => {
        const live = fakeLive();
        const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory });
        await session.runner.start();
        clock.advance(8000);
        await vi.waitFor(() => expect(live.made).toHaveLength(1));
        await vi.waitFor(() => expect(live.made[0].sentences.length).toBeGreaterThan(0));
        expect(useLiveNotes.getState()).toMatchObject({ recordId: 'run1', running: true });
        await session.runner.stop();
        await session.runner.settled();
        await vi.waitFor(() => expect(live.made[0].stopped).toBe(true));
        await vi.waitFor(() => expect(useLiveNotes.getState()).toMatchObject({ running: false, ended: true }));
      });
    });

    // Review: a failure to read the notes service (the stored settings) does not leave the record's live notes stuck; a
    // later sentence tries again.
    it('tries the notes service again with a later sentence when reading it failed', async () => {
      await withLive(true, 'openai', async () => {
        const realLoad = useProviderStore.getState().load;
        let loads = 0;
        useProviderStore.setState({
          entries: {},
          load: async (provider: { id: string }) => {
            // The session's own provider loads as usual; only OpenAI's, read for the notes, fails once.
            if (provider?.id !== 'openai') return realLoad(provider as never);
            loads += 1;
            if (loads === 1) throw new Error('settings could not be read');
            useProviderStore.setState({ entries: { openai: { settings: {}, credentials: { apiKey: 'sk-test' }, pair: { source: 'en', target: 'ja' } } } } as never);
          },
        } as never);
        try {
          const live = fakeLive();
          const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory });
          await session.runner.start();
          // The script's first exchange: reading the service fails. Its second, later: read again, and the loop starts.
          clock.advance(3000);
          await flush();
          await flush();
          expect(live.made).toHaveLength(0);
          clock.advance(5000);
          await flush();
          await vi.waitFor(() => expect(live.made).toHaveLength(1));
          expect(loads).toBe(2);
          await session.runner.stop();
          await session.runner.settled();
        } finally {
          useProviderStore.setState({ load: realLoad } as never);
        }
      });
    });

    // Owner, 2026-11-17: no "None" in the line-up; the switch alone decides, a line-up naming none uses the default.
    it('starts no loop when live notes are off, and one when they are on with no notes service named', async () => {
      for (const [on, service, loops] of [[false, 'openai', 0], [true, null, 1]] as const) {
        await withLive(on, service, async () => {
          const live = fakeLive();
          const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory });
          await session.runner.start();
          clock.advance(8000);
          await flush();
          await session.runner.stop();
          await session.runner.settled();
          expect(live.made).toHaveLength(loops);
        });
      }
    });

    it('lets the loop go when live notes are turned off during the session, and says so', async () => {
      await withLive(true, 'openai', async () => {
        const live = fakeLive();
        const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory });
        await session.runner.start();
        clock.advance(8000);
        await vi.waitFor(() => expect(live.made).toHaveLength(1));
        useSettingsStore.setState({ liveNotes: false } as never);
        expect(live.made[0].disposed).toBe(true);
        expect(useLiveNotes.getState()).toMatchObject({ running: false, off: true });
        await session.runner.stop();
      });
    });

    type LiveDeps = import('../lib/notes/live/loop').LiveNotesDeps;
    /** A loop whose Stop gives one last answer, and whose Stop can be held. */
    function answeringLive(o: { hold?: boolean } = {}) {
      const made: Array<{ deps: LiveDeps; stopped: boolean; disposed: boolean; release: () => void }> = [];
      const factory = (deps: LiveDeps) => {
        let release = () => {};
        const held = new Promise<void>((resolve) => { release = resolve; });
        const one = { deps, stopped: false, disposed: false, release };
        made.push(one);
        return {
          sentences: () => {},
          stop: async () => {
            one.stopped = true;
            if (o.hold) await held;
            deps.onState({ title: 'Last word', topics: [] });
          },
          dispose: () => { one.disposed = true; },
        };
      };
      return { made, factory };
    }

    it('shows the last update the loop gives at Stop', async () => {
      await withLive(true, 'openai', async () => {
        const live = answeringLive();
        const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory as never });
        await session.runner.start();
        clock.advance(8000);
        await vi.waitFor(() => expect(live.made).toHaveLength(1));
        await session.runner.stop();
        await session.runner.settled();
        await vi.waitFor(() => expect(useLiveNotes.getState()).toMatchObject({ recordId: 'run1', state: { title: 'Last word' }, ended: true }));
      });
    });

    it("leaves a new session's notes alone when the last session's final update comes late", async () => {
      await withLive(true, 'openai', async () => {
        const live = answeringLive({ hold: true });
        let runs = 0;
        const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory as never, newSessionId: () => `run${++runs}` });
        await session.runner.start();
        clock.advance(8000);
        await vi.waitFor(() => expect(live.made).toHaveLength(1));
        await session.runner.stop();
        await session.runner.settled();
        await vi.waitFor(() => expect(live.made[0].stopped).toBe(true));
        await session.runner.start();
        clock.advance(8000);
        await vi.waitFor(() => expect(live.made).toHaveLength(2));
        expect(useLiveNotes.getState()).toMatchObject({ recordId: 'run2', running: true });
        live.made[0].release();
        await flush();
        await flush();
        expect(useLiveNotes.getState()).toMatchObject({ recordId: 'run2', state: null, running: true, ended: false });
        await session.runner.stop();
      });
    });

    it('ends the loop with the run even when History does not keep the record', async () => {
      await withLive(true, 'openai', async () => {
        const live = fakeLive();
        const port = historyPort();
        (port as unknown as { closeRecord: () => Promise<unknown> }).closeRecord = async () => ({ kept: false });
        const { session, clock } = await setup({ history: port, ipc: null, liveNotes: live.factory });
        await session.runner.start();
        clock.advance(8000);
        await vi.waitFor(() => expect(live.made).toHaveLength(1));
        await session.runner.stop();
        await session.runner.settled();
        await vi.waitFor(() => expect(live.made[0].stopped).toBe(true));
        await vi.waitFor(() => expect(useLiveNotes.getState()).toMatchObject({ running: false, ended: true, history: 'notKept' }));
      });
    });

    // Review: the panel's promise of full notes follows what was decided when the record closed.
    it('tells the panel whether full notes are being written for the record, as decided when it closed', async () => {
      for (const after of [true, false]) {
        await withLive(true, 'openai', async () => {
          useSettingsStore.setState({ notesAfterSession: after } as never);
          const live = fakeLive();
          const notes = { start: vi.fn(), cancel: vi.fn(), running: () => [], subscribe: () => () => {} };
          const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory, notes: notes as never });
          await session.runner.start();
          clock.advance(8000);
          await vi.waitFor(() => expect(live.made).toHaveLength(1));
          await session.runner.stop();
          await session.runner.settled();
          await vi.waitFor(() => expect(useLiveNotes.getState()).toMatchObject({ ended: true, history: 'kept', fullNotes: after }));
          useSettingsStore.setState({ notesAfterSession: false } as never);
        });
      }
    });

    it('a new start takes the last session\'s notes off the screen, the line saying they were off included', async () => {
      await withLive(true, 'openai', async () => {
        const live = fakeLive();
        const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory });
        await session.runner.start();
        clock.advance(8000);
        await vi.waitFor(() => expect(live.made).toHaveLength(1));
        useSettingsStore.setState({ liveNotes: false } as never);
        await session.runner.stop();
        await session.runner.settled();
        expect(useLiveNotes.getState()).toMatchObject({ off: true });
        await session.runner.start();
        expect(useLiveNotes.getState()).toMatchObject({ recordId: null, state: null, off: false, ended: false, running: false });
        await session.runner.stop();
      });
    });

    it('builds the speaker labels once per update, not once per sentence', async () => {
      await withLive(true, 'openai', async () => {
        const live = fakeLive();
        const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory });
        await session.runner.start();
        clock.advance(20_000);
        await vi.waitFor(() => expect(live.made).toHaveLength(1));
        await vi.waitFor(() => expect(live.made[0].sentences.length).toBeGreaterThan(1));
        const deps = live.made[0].deps as LiveDeps;
        const sentence = { n: live.made[0].sentences[0], side: 'other', sideCertain: true, speaker: '1', startMs: 0, endMs: 1, text: 'x', fromOpen: false } as never;
        labellerBuilds.count = 0;
        for (let i = 0; i < 50; i++) deps.speakerLabel(sentence);
        expect(labellerBuilds.count).toBeLessThanOrEqual(1);
        await session.runner.stop();
      });
    });

    // During a session Clear empties the captions only.
    it('Clear during a session leaves the live notes on screen and their loop', async () => {
      await withLive(true, 'openai', async () => {
        const live = fakeLive();
        const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory });
        const detach = session.attach();
        await session.runner.start();
        clock.advance(8000);
        await vi.waitFor(() => expect(live.made).toHaveLength(1));
        useLiveNotes.getState().update('run1', { title: 'T', topics: [] });
        session.runner.clear();
        expect(useLiveNotes.getState().state).toEqual({ title: 'T', topics: [] });
        expect(live.made[0].disposed).toBe(false);
        await session.runner.stop();
        detach();
      });
    });
    // Review: after Stop the loop runs on until its last update is back; a Clear then is after the session, and empties
    // the notes, and the update that comes back late lands nowhere.
    it('Clear after Stop empties the live notes while their last update is on its way, and drops it', async () => {
      await withLive(true, 'openai', async () => {
        let settle!: () => void;
        const live = fakeLive(new Promise<void>((resolve) => { settle = resolve; }));
        const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory });
        const detach = session.attach();
        await session.runner.start();
        clock.advance(8000);
        await vi.waitFor(() => expect(live.made).toHaveLength(1));
        useLiveNotes.getState().update('run1', { title: 'T', topics: [] });
        await session.runner.stop();
        expect(useLiveNotes.getState().running).toBe(true);
        session.runner.clear();
        expect(useLiveNotes.getState()).toMatchObject({ recordId: null, state: null });
        useLiveNotes.getState().update('run1', { title: 'Late', topics: [] });
        settle();
        await vi.waitFor(() => expect(live.made[0].stopped).toBe(true));
        expect(useLiveNotes.getState()).toMatchObject({ recordId: null, state: null, ended: false });
        detach();
      });
    });
    it('Clear after Stop, before any sentence reached the live notes, keeps them cleared when the last sentences come', async () => {
      await withLive(true, 'openai', async () => {
        const live = fakeLive();
        let runs = 0;
        const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory, newSessionId: () => `run${++runs}` });
        const detach = session.attach();
        await session.runner.start();
        const stopping = session.runner.stop();
        session.runner.clear();
        // A last final the service sends while the run stops, after the Clear: a sentence for the same record.
        const speaker = session.runner.conversation.get('speaker')!;
        speaker.apply({ kind: 'segmentOpened', payload: { ref: 99, side: 'source' } });
        speaker.apply({ kind: 'segmentText', payload: { ref: 99, text: 'One last thing before we go.' } });
        speaker.apply({ kind: 'segmentClosed', payload: { ref: 99 } });
        clock.advance(3000);
        await stopping;
        clock.advance(8000);
        await session.runner.settled();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(live.made).toHaveLength(0);
        expect(useLiveNotes.getState()).toMatchObject({ recordId: null, running: false });
        // The next session has its live notes again.
        await session.runner.start();
        clock.advance(8000);
        await vi.waitFor(() => expect(live.made).toHaveLength(1));
        expect(useLiveNotes.getState()).toMatchObject({ recordId: 'run2', running: true });
        await session.runner.stop();
        await session.runner.settled();
        detach();
      });
    });

    /** A loop that records what happened to it, in order, and what it was told to go on from. */
    function watchedLive() {
      const events: string[] = [];
      const made: Array<{ deps: LiveDeps; sentences: number[] }> = [];
      const factory = (deps: LiveDeps) => {
        const one = { deps, sentences: [] as number[] };
        made.push(one);
        const i = made.length;
        return {
          sentences: (list: ReadonlyArray<{ n: number }>) => { one.sentences.push(...list.map((x) => x.n)); },
          quiet: () => { events.push(`quiet ${i}`); },
          stop: async () => { events.push(`stop ${i}`); },
          dispose: () => { events.push(`dispose ${i}`); },
        };
      };
      return { made, events, factory };
    }

    it('keeps the loop from sending on its own once the session is stopping: only the last update is left', async () => {
      await withLive(true, 'openai', async () => {
        const live = watchedLive();
        const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory as never });
        await session.runner.start();
        clock.advance(8000);
        await vi.waitFor(() => expect(live.made).toHaveLength(1));
        await session.runner.stop();
        await session.runner.settled();
        await vi.waitFor(() => expect(live.events).toContain('stop 1'));
        expect(live.events).toEqual(['quiet 1', 'stop 1']);
      });
    });

    it('turned off and on again in one session, goes on from the notes on screen with the sentences that follow', async () => {
      await withLive(true, 'openai', async () => {
        const live = watchedLive();
        const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory as never });
        await session.runner.start();
        // The first exchange is said; the second starts at 5 s.
        clock.advance(4000);
        await vi.waitFor(() => expect(live.made).toHaveLength(1));
        await vi.waitFor(() => expect(live.made[0].sentences.length).toBeGreaterThan(0));
        const earlier = [...live.made[0].sentences];
        live.made[0].deps.onState({ title: 'Weekly', topics: [] });
        useSettingsStore.setState({ liveNotes: false } as never);
        useSettingsStore.setState({ liveNotes: true } as never);
        expect(useLiveNotes.getState().state).toEqual({ title: 'Weekly', topics: [] });
        clock.advance(20_000);
        await vi.waitFor(() => expect(live.made).toHaveLength(2));
        const from = live.made[1].deps.from!;
        expect(from.state).toEqual({ title: 'Weekly', topics: [] });
        expect(from.seen.map((x) => x.n)).toEqual(earlier);
        expect(useLiveNotes.getState()).toMatchObject({ recordId: 'run1', running: true, off: false, state: { title: 'Weekly', topics: [] } });
        await session.runner.stop();
      });
    });

    it('shows that Kizuna AI stopped the live notes, for the session on screen', async () => {
      await withLive(true, 'openai', async () => {
        const live = watchedLive();
        const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory as never });
        await session.runner.start();
        clock.advance(4000);
        await vi.waitFor(() => expect(live.made).toHaveLength(1));
        live.made[0].deps.onStopped!('no-balance');
        expect(useLiveNotes.getState()).toMatchObject({ recordId: 'run1', running: false, stopped: 'no-balance' });
        await session.runner.stop();
      });
    });

    it('adds what each live update used to the session on screen', async () => {
      await withLive(true, 'openai', async () => {
        const live = watchedLive();
        const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory as never });
        await session.runner.start();
        clock.advance(4000);
        await vi.waitFor(() => expect(live.made).toHaveLength(1));
        live.made[0].deps.onUsage!({ prompt_tokens: 900, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 800 } });
        expect(useLiveNotes.getState().used).toEqual({ input: 900, cached: 800, output: 30 });
        await session.runner.stop();
      });
    });

    // Review: a Stop while the notes service is still loading kept nothing for the last update.
    it('makes the loop when the notes service answers after Stop, and gives it the sentences for its last update', async () => {
      await withLive(true, 'openai', async () => {
        const live = watchedLive();
        const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory as never });
        // The notes service's key is still being read when the session stops.
        const entries = useProviderStore.getState().entries;
        const { openai: _openai, ...others } = entries as Record<string, unknown>;
        const loadBefore = useProviderStore.getState().load;
        let release!: () => void;
        const loaded = new Promise<void>((r) => { release = r; });
        useProviderStore.setState({ entries: others, load: async () => { await loaded; useProviderStore.setState({ entries }); } } as never);
        try {
          await session.runner.start();
          clock.advance(8000);
          await vi.waitFor(() => expect(useLiveNotes.getState()).toMatchObject({ recordId: 'run1', running: true }));
          await session.runner.stop();
          await session.runner.settled();
          expect(live.made).toHaveLength(0);
          release();
          await vi.waitFor(() => expect(live.events).toContain('stop 1'));
          expect(live.made[0].sentences.length).toBeGreaterThan(0);
          await vi.waitFor(() => expect(useLiveNotes.getState()).toMatchObject({ recordId: 'run1', running: false, ended: true }));
        } finally {
          useProviderStore.setState({ load: loadBefore } as never);
        }
      });
    });

    // Review: turned off while the last update was still on its way, the loop went on and could still send.
    it('lets a loop still giving its last update go when live notes are turned off', async () => {
      await withLive(true, 'openai', async () => {
        const live = answeringLive({ hold: true });
        const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory as never });
        await session.runner.start();
        clock.advance(8000);
        await vi.waitFor(() => expect(live.made).toHaveLength(1));
        await session.runner.stop();
        await session.runner.settled();
        await vi.waitFor(() => expect(live.made[0].stopped).toBe(true));
        useSettingsStore.setState({ liveNotes: false } as never);
        expect(live.made[0].disposed).toBe(true);
        live.made[0].release();
        await vi.waitFor(() => expect(useLiveNotes.getState()).toMatchObject({ recordId: 'run1', ended: true }));
      });
    });

    it('ends the panel at Stop when the notes service could not be read', async () => {
      await withLive(true, 'openai', async () => {
        const live = watchedLive();
        const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory as never });
        const entries = useProviderStore.getState().entries;
        const { openai: _openai, ...others } = entries as Record<string, unknown>;
        const loadBefore = useProviderStore.getState().load;
        useProviderStore.setState({ entries: others, load: async () => { throw new Error('unreadable'); } } as never);
        try {
          await session.runner.start();
          clock.advance(8000);
          await vi.waitFor(() => expect(useLiveNotes.getState()).toMatchObject({ recordId: 'run1', running: true }));
          await flush();
          await session.runner.stop();
          await session.runner.settled();
          await vi.waitFor(() => expect(useLiveNotes.getState()).toMatchObject({ recordId: 'run1', running: false, ended: true }));
          expect(live.made).toHaveLength(0);
        } finally {
          useProviderStore.setState({ load: loadBefore } as never);
          await settleReports();
        }
      });
    });

    it('watches the switch only while a loop runs', async () => {
      await withLive(true, 'openai', async () => {
        const offs: Array<ReturnType<typeof vi.fn>> = [];
        const subscribe = useSettingsStore.subscribe;
        const spy = vi.spyOn(useSettingsStore, 'subscribe').mockImplementation(((listener: never) => {
          const off = vi.fn(subscribe(listener));
          offs.push(off);
          return off;
        }) as never);
        try {
          const live = watchedLive();
          const { session, clock } = await setup({ history: historyPort(), ipc: null, liveNotes: live.factory as never });
          // What the app session holds for its whole life is not this test's: only what a run adds.
          offs.length = 0;
          await session.runner.start();
          clock.advance(8000);
          await vi.waitFor(() => expect(live.made).toHaveLength(1));
          expect(offs.length).toBeGreaterThan(0);
          await session.runner.stop();
          await session.runner.settled();
          await vi.waitFor(() => expect(live.events).toContain('stop 1'));
          expect(offs.every((off) => off.mock.calls.length > 0)).toBe(true);
        } finally {
          spy.mockRestore();
        }
      });
    });
  });

  describe('closing while notes are being written', () => {
    /** A notes runner with one version running for `ids`; cancel ends it. */
    function writingNotes(ids: string[]) {
      const running = new Set(ids);
      const listeners = new Set<() => void>();
      return {
        start: vi.fn(),
        cancel: vi.fn((id: string) => { running.delete(id); queueMicrotask(() => { for (const l of listeners) l(); }); }),
        running: () => [...running],
        subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
        notify: () => { for (const l of listeners) l(); },
      };
    }

    it('keeps the app busy while notes are written, so a close asks first', async () => {
      const { ipc } = electronIpc();
      const notes = writingNotes([]);
      const { session } = await setup({ ipc, notes, history: null });
      const detach = session.attach();
      (notes.running as unknown as () => string[]) = () => ['run-0001-aaaa'];
      notes.notify();
      expect(ipc.invoke).toHaveBeenLastCalledWith('app:session-busy', true);
      (notes.running as unknown as () => string[]) = () => [];
      notes.notify();
      expect(ipc.invoke).toHaveBeenLastCalledWith('app:session-busy', false);
      detach();
    });

    it('asks, and on Quit marks the notes cancelled and closes', async () => {
      const { ipc, order, closeRequested } = electronIpc();
      const notes = writingNotes(['run-0001-aaaa']);
      const askQuit = vi.fn(async () => 'quit' as const);
      const { session } = await setup({ ipc, notes, askQuit, history: null });
      const detach = session.attach();
      await closeRequested();
      expect(askQuit).toHaveBeenCalledTimes(1);
      expect(order.indexOf('app:close-asking')).toBeLessThan(order.indexOf('app:close-ready'));
      expect(notes.cancel).toHaveBeenCalledWith('run-0001-aaaa');
      expect(ipc.invoke).toHaveBeenCalledWith('app:close-ready');
      detach();
    });

    it('asks, and on Stay keeps the app and the notes', async () => {
      const { ipc, closeRequested } = electronIpc();
      const notes = writingNotes(['run-0001-aaaa']);
      const { session } = await setup({ ipc, notes, askQuit: async () => 'stay', history: null });
      const detach = session.attach();
      await closeRequested();
      expect(notes.cancel).not.toHaveBeenCalled();
      expect(ipc.invoke).toHaveBeenCalledWith('app:close-cancelled');
      expect(ipc.invoke).not.toHaveBeenCalledWith('app:close-ready');
      detach();
    });

    it('writes no notes for a session the window closed, and asks nothing', async () => {
      const { ipc, closeRequested } = electronIpc();
      const notes = writingNotes([]);
      const askQuit = vi.fn(async () => 'quit' as const);
      const lineUpBefore = useLineUpStore.getState().lineUp;
      useSettingsStore.setState({ notesAfterSession: true } as never);
      useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: 'openai' } } as never);
      try {
        const calls: string[] = [];
        const answer = (name: string, value: unknown) => async () => { calls.push(name); return value; };
        const port = { port: {
          openRecord: answer('openRecord', undefined), putLeg: answer('putLeg', undefined), createTranscript: answer('createTranscript', 1),
          putSegments: answer('putSegments', undefined), putNotices: answer('putNotices', undefined),
          appendSentences: answer('appendSentences', { added: 0 }), reviseSentences: answer('reviseSentences', undefined),
          closeRecord: answer('closeRecord', { kept: true }),
        } as unknown as HistoryPort, calls: { map: <T>(f: (c: [string]) => T) => calls.map((c) => f([c])) } };
        const { session, clock } = await setup({ ipc, notes, askQuit, history: port.port });
        const detach = session.attach();
        await session.runner.start();
        clock.advance(8000);
        await closeRequested();
        await flush();
        expect(port.calls.map((c) => c[0])).toContain('closeRecord');
        expect(notes.start).not.toHaveBeenCalled();
        expect(askQuit).not.toHaveBeenCalled();
        expect(ipc.invoke).toHaveBeenCalledWith('app:close-ready');
        detach();
      } finally {
        useSettingsStore.setState({ notesAfterSession: false } as never);
        useLineUpStore.setState({ lineUp: lineUpBefore });
      }
    });

    it('asks before ending a live session, and Stay leaves it running', async () => {
      const { ipc, closeRequested } = electronIpc();
      const notes = writingNotes(['run-0001-aaaa']);
      let phaseWhenAsked = '';
      const { session } = await setup({ ipc, notes, history: null, askQuit: async () => { phaseWhenAsked = session.runner.state.getState().phase; return 'stay'; } });
      const detach = session.attach();
      await session.runner.start();
      await closeRequested();
      expect(phaseWhenAsked).toBe('running');
      expect(session.runner.state.getState().phase).toBe('running');
      expect(ipc.invoke).toHaveBeenCalledWith('app:close-cancelled');
      expect(ipc.invoke).not.toHaveBeenCalledWith('app:close-ready');
      await session.runner.stop();
      detach();
    });

    it('closes at once when no notes are being written', async () => {
      const { ipc, closeRequested } = electronIpc();
      const askQuit = vi.fn(async () => 'stay' as const);
      const { session } = await setup({ ipc, notes: writingNotes([]), askQuit, history: null });
      const detach = session.attach();
      await closeRequested();
      expect(askQuit).not.toHaveBeenCalled();
      expect(ipc.invoke).toHaveBeenCalledWith('app:close-ready');
      detach();
    });
  });

  it('counts a close as the window ending the run, not a Stop button press', async () => {
    const { ipc, closeRequested } = electronIpc();
    const { session, track } = await setup({ ipc });
    const detach = session.attach();
    await session.runner.start();

    await closeRequested();
    expect(track).toHaveBeenCalledWith('session_control_clicked', { action: 'stop', method: 'window' });
    expect(track).not.toHaveBeenCalledWith('session_control_clicked', { action: 'stop', method: 'button' });

    detach();
  });

  it('stops listening for the close request on detach', async () => {
    const { ipc, handlers } = electronIpc();
    const { session } = await setup({ ipc });
    const detach = session.attach();
    const handler = handlers.get('app:close-requested');
    expect(handler).toEqual(expect.any(Function));

    detach();
    expect(ipc.removeListener).toHaveBeenCalledWith('app:close-requested', handler);
  });

  it('reports a source that ended the run as an audio error, and a normal stop as none', async () => {
    let source!: FakeSource;
    const sourceClock = createVirtualClock(0);
    const { session, track } = await setup({ capture: () => async () => (source = createFakeSource(sourceClock)) });
    const detach = session.attach();

    await session.runner.start();
    await session.runner.stop();
    await session.runner.settled();
    expect(track).not.toHaveBeenCalledWith('audio_error', expect.anything());

    await session.runner.start();
    source.end('unplugged');
    await session.runner.settled();
    expect(session.runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'source-ended' } });
    expect(track).toHaveBeenCalledWith('audio_error', {
      error_type: 'device_access',
      error_message: 'The speaker capture ended: unplugged',
      device_info: 'speaker',
    });
    expect(track.mock.calls.filter(([event]) => event === 'audio_error')).toHaveLength(1);

    detach();
  });

  /** A signed-in session on the leased fake whose lease the service refuses with `code`, attached, with its balance refetch spied on. */
  async function refusedLease(code: string) {
    const { session } = await setup();
    await useProviderStore.getState().load(fakeLeasedProvider);
    useProviderStore.getState().select('fake_leased');
    const refetchQuota = vi.fn(async () => {});
    session.setBridges({ refetchQuota, auth: { signedIn: true, userId: 'u1', getToken: async () => 't' } });
    const acquire = vi.spyOn(fakeLeasedProvider.session!, 'acquire').mockRejectedValueOnce(new AdapterStartError('The service refused the lease.', code));
    const detach = session.attach();
    await session.runner.start();
    await session.runner.settled();
    acquire.mockRestore();
    expect(session.runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code } } });
    return { refetchQuota, detach };
  }

  it.each(['insufficient_balance', 'wallet_frozen', 'not_org_member', 'org_wallet_frozen', 'org_balance_held', 'org_insufficient_balance'])('refetches the balance once the service refuses a start with %s: the wallet it answered for has changed', async (code) => {
    const { refetchQuota, detach } = await refusedLease(code);
    expect(refetchQuota).toHaveBeenCalledTimes(1);
    detach();
  });

  /** A run that went live on the fake and then failed with `code` (a give-up the organization's wallet caused), with its balance refetch spied on. */
  async function failedMidSession(code: string) {
    const { session } = await setup();
    const refetchQuota = vi.fn(async () => {});
    session.setBridges({ refetchQuota });
    let events!: Parameters<typeof fakeProvider.start>[1];
    const start = vi.spyOn(fakeProvider, 'start').mockImplementationOnce(async (request, e) => {
      events = e;
      start.mockRestore();
      return fakeProvider.start(request, e);
    });
    const detach = session.attach();
    await session.runner.start();
    events.failed({ message: 'Refused.', code });
    await session.runner.settled();
    expect(session.runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'leg-failed', notice: { code } } });
    return { refetchQuota, detach };
  }

  it.each(['org_wallet_frozen', 'not_org_member', 'org_balance_held', 'org_insufficient_balance'])('refetches the balance once a live run ends with %s, as after a refused start', async (code) => {
    const { refetchQuota, detach } = await failedMidSession(code);
    // Once for the refusal; the run's own end may add its refetch.
    expect(refetchQuota).toHaveBeenCalled();
    detach();
  });

  it('refetches nothing for a start refused for another reason', async () => {
    const { refetchQuota, detach } = await refusedLease('session_conflict');
    expect(refetchQuota).not.toHaveBeenCalled();
    detach();
  });

  it('keeps the provider put while a run is not idle, and lets it change once idle', async () => {
    useLogStore.getState().setEnabled(true);
    useLogStore.getState().clearLogs();
    const { session } = await setup();
    const detach = session.attach();

    await session.runner.start();
    expect(session.runner.state.getState().phase).toBe('running');
    useProviderStore.getState().select('local_inference');
    expect(useProviderStore.getState().selected).toBe('fake');
    await settleReports();
    expect(useLogStore.getState().logs.filter((l) => l.type === 'warning' && l.message.includes('cannot change during a session'))).toHaveLength(1);

    await session.runner.stop();
    await session.runner.settled();
    useProviderStore.getState().select('local_inference');
    expect(useProviderStore.getState().selected).toBe('local_inference');

    detach();
  });

  it('holds the provider from an attach made mid-run, and lets it go on detach', async () => {
    const { session } = await setup();
    await session.runner.start();
    const detach = session.attach();
    expect(useProviderStore.getState().selectionLocked).toBe(true);

    detach();
    expect(useProviderStore.getState().selectionLocked).toBe(false);
    await session.runner.stop();
  });
});

describe('getAppSession', () => {
  // Last in the file: it swaps the module registry, so this module's imports
  // above no longer reach the fresh stores it builds against.
  it('builds one session per page, with the options given before it was built', async () => {
    vi.resetModules();
    const m = await import('./session');
    const { useProviderStore: freshProviders } = await import('../stores/providerStore');
    const { fakeProvider: freshFake } = await import('../providers/fake/provider');
    const { currentRunPhase } = await import('./runPhase');
    // A provider a start could open, so only `refuse` stands between a start and a run.
    await freshProviders.getState().load(freshFake);
    freshProviders.getState().select('fake');
    let refusing = true;
    const clock = createVirtualClock(0);
    m.configureAppSession({ refuse: () => refusing, clock, capture: () => async () => createFakeSource(clock) });
    expect(currentRunPhase()).toBe('idle');
    const session = m.getAppSession();
    expect(m.getAppSession()).toBe(session);
    m.configureAppSession({});
    expect(m.getAppSession()).toBe(session);
    await session.runner.start();
    expect(session.runner.state.getState()).toMatchObject({ lastEnd: { reason: 'refused', notice: { code: 'no_provider' } } });

    // The page's run phase, for code outside React, reads the session built here.
    refusing = false;
    await session.runner.start();
    expect(session.runner.state.getState().phase).toBe('running');
    expect(currentRunPhase()).toBe('running');
    await session.runner.stop();
    expect(currentRunPhase()).toBe('idle');
  });
});

// History: every desktop run is written into its record (session capture).
describe('history', () => {
  type Call = [string, any];
  /** A port that records each call; `slow(method)` holds that method's answers until `release()`. */
  function recordingPort() {
    const calls: Call[] = [];
    const slow = new Set<string>();
    let held: Array<() => void> = [];
    let transcripts = 0;
    const answer = (method: string, arg: unknown, value: unknown) => {
      calls.push([method, arg]);
      if (slow.has(method)) return new Promise((resolve) => { held.push(() => resolve(value)); });
      return Promise.resolve(value);
    };
    const port = {
      openRecord: (a: unknown) => answer('openRecord', a, undefined),
      putLeg: (a: unknown) => answer('putLeg', a, undefined),
      createTranscript: (a: unknown) => answer('createTranscript', a, ++transcripts),
      putSegments: (a: unknown) => answer('putSegments', a, undefined),
      putNotices: (a: unknown) => answer('putNotices', a, undefined),
      appendSentences: (a: { sentences: unknown[] }) => answer('appendSentences', a, { added: a.sentences.length }),
      reviseSentences: (a: unknown) => answer('reviseSentences', a, undefined),
      closeRecord: (a: unknown) => answer('closeRecord', a, { kept: true }),
    } as unknown as HistoryPort;
    return { port, calls, slow: (m: string) => slow.add(m), release: () => { slow.clear(); const h = held; held = []; for (const f of h) f(); } };
  }

  /** A port over the real store in a temporary folder, called directly as the IPC layer would. */
  function storePort() {
    const nodeRequire = createRequire(import.meta.url);
    const { openHistory } = nodeRequire('../../electron/history-store.js');
    const dir = mkdtempSync(join(tmpdir(), 'sokuji-capture-'));
    const store = openHistory({ dir });
    const call = (method: string) => async (a: unknown) => store[method](a);
    const port = Object.fromEntries(['openRecord', 'putLeg', 'createTranscript', 'putSegments', 'putNotices', 'appendSentences', 'reviseSentences', 'closeRecord']
      .map((m) => [m, call(m)])) as unknown as HistoryPort;
    const h = { port, store, dir, cleanup: () => { h.store.close(); rmSync(dir, { recursive: true, force: true }); } };
    return h;
  }

  /** A run id as the app makes them (a UUID's shape): the store refuses an id that could leave its folder. */
  const RUN = 'run-0001-aaaa';

  it('writes a run into the port it was given and closes the record', async () => {
    const port = recordingPort();
    const { session, clock } = await setup({ history: port.port, ipc: null });
    await session.runner.start();
    clock.advance(8000);
    await session.runner.stop();
    await session.runner.settled();
    await flush();
    const names = port.calls.map((c) => c[0]);
    expect(names[0]).toBe('openRecord');
    expect(port.calls[0][1]).toEqual(expect.objectContaining({ id: 'run1', mode: 'speaker' }));
    expect(names).toContain('appendSentences');
    expect(names[names.length - 1]).toBe('closeRecord');
  });

  it('starts the notes of a closed record when notes after the session are on and a notes service is chosen', async () => {
    const port = recordingPort();
    const notes = { start: vi.fn(), cancel: vi.fn(), running: () => [] as string[], subscribe: () => () => {} };
    const lineUpBefore = useLineUpStore.getState().lineUp;
    useSettingsStore.setState({ notesAfterSession: true } as never);
    useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: 'openai' } } as never);
    try {
      const { session, clock } = await setup({ history: port.port, ipc: null, notes });
      await session.runner.start();
      clock.advance(8000);
      await session.runner.stop();
      await session.runner.settled();
      await flush();
      expect(notes.start).toHaveBeenCalledTimes(1);
      expect(notes.start).toHaveBeenCalledWith('run1');
    } finally {
      useSettingsStore.setState({ notesAfterSession: false } as never);
      useLineUpStore.setState({ lineUp: lineUpBefore });
    }
  });

  it('starts no notes when notes after the session are off, and writes them when on with no notes service named', async () => {
    for (const [on, service, writes] of [[false, 'openai', false], [true, null, true]] as const) {
      const port = recordingPort();
      const notes = { start: vi.fn(), cancel: vi.fn(), running: () => [] as string[], subscribe: () => () => {} };
      const lineUpBefore = useLineUpStore.getState().lineUp;
      useSettingsStore.setState({ notesAfterSession: on } as never);
      useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: service } } as never);
      try {
        const { session, clock } = await setup({ history: port.port, ipc: null, notes });
        await session.runner.start();
        clock.advance(8000);
        await session.runner.stop();
        await session.runner.settled();
        await flush();
        expect(port.calls.map((c) => c[0])).toContain('closeRecord');
        expect(notes.start).toHaveBeenCalledTimes(writes ? 1 : 0);
      } finally {
        useSettingsStore.setState({ notesAfterSession: false } as never);
        useLineUpStore.setState({ lineUp: lineUpBefore });
      }
    }
  });

  it("records each side's audio into the record while the run goes on", async () => {
    const port = recordingPort();
    const pieces: Array<{ recordId: string; source: string }> = [];
    (port.port as unknown as Record<string, unknown>).appendTrack = async (a: { recordId: string; source: string; data: Uint8Array }) => {
      pieces.push({ recordId: a.recordId, source: a.source });
      return { bytes: a.data.length };
    };
    const head = new Uint8Array([79, 112, 117, 115, 72, 101, 97, 100, 1, 1, 156, 0, 192, 93, 0, 0, 0, 0, 0]);
    const historyEncoder = (onPacket: (d: Uint8Array, s: number) => void, onHead: (h: Uint8Array) => void) => {
      let sent = false;
      return { encode: (pcm: Int16Array) => { if (!sent) { sent = true; onHead(head); } for (let i = 0; i < pcm.length; i += 480) onPacket(new Uint8Array(3), 960); }, flush: async () => {}, close: () => {} };
    };
    const { session, clock } = await setup({ history: port.port, ipc: null, historyEncoder });
    await session.runner.start();
    clock.advance(3000);
    await flush();
    await session.runner.stop();
    await session.runner.settled();
    await flush();
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every((p) => p.recordId === 'run1' && p.source === 'speaker')).toBe(true);
    const names = port.calls.map((c) => c[0]);
    expect(names[names.length - 1]).toBe('closeRecord');
  });

  it('records no audio where the page cannot encode it, and still writes the record', async () => {
    const port = recordingPort();
    const appendTrack = vi.fn();
    (port.port as unknown as Record<string, unknown>).appendTrack = appendTrack;
    const { session, clock } = await setup({ history: port.port, ipc: null, historyEncoder: null });
    await session.runner.start();
    clock.advance(3000);
    await session.runner.stop();
    await session.runner.settled();
    await flush();
    expect(appendTrack).not.toHaveBeenCalled();
    expect(port.calls.map((c) => c[0])).toContain('closeRecord');
  });

  it('creates no writer without a port', async () => {
    const { session, clock } = await setup({ history: null, ipc: null });
    await session.runner.start();
    clock.advance(2000);
    await session.runner.stop();
    await session.runner.settled();
  });

  it('answers the close request only after the last writes', async () => {
    const port = recordingPort();
    port.slow('closeRecord');
    const { ipc, order, closeRequested } = electronIpc();
    const { session, clock } = await setup({ history: port.port, ipc });
    const detach = session.attach();
    await session.runner.start();
    clock.advance(1000);
    const closing = closeRequested();
    await flush();
    await flush();
    expect(order).not.toContain('app:close-ready');
    port.release();
    await closing;
    expect(order).toContain('app:close-ready');
    detach();
  });

  it('stores a run so that the record gives back the same conversation', async () => {
    const h = storePort();
    try {
      const { session, clock } = await setup({ history: h.port, ipc: null, newSessionId: () => RUN });
      await session.runner.start();
      clock.advance(8000);
      await session.runner.stop();
      await session.runner.settled();
      await flush();
      await flush();
      const ended = session.runner.conversation.snapshot();
      const legs = ended.map((l) => ({
        ...l,
        notices: l.notices.filter((n) => n.lifetime !== 'transient'),
        segments: l.segments.map(({ speech: _speech, heard: _heard, ...rest }) => ({ ...rest, speech: [] })),
      }));
      expect(h.store.getLegs(RUN)).toEqual(legs);
      const rec = h.store.getRecord(RUN);
      expect(rec.state).toBe('closed');
      const sentences = h.store.getSentences({ transcriptId: rec.transcripts[0].id });
      expect(sentences.length).toBeGreaterThan(0);
      expect(sentences.map((s: { n: number }) => s.n)).toEqual(sentences.map((_: unknown, i: number) => i + 1));
      expect(sentences.every((s: { startMs: number; endMs: number }) => s.endMs >= s.startMs && s.startMs >= 0)).toBe(true);
    } finally {
      h.cleanup();
    }
  });

  it('follows the rewrite script without changing a number or a time', async () => {
    const h = storePort();
    try {
      const { session, clock } = await setup({ history: h.port, ipc: null, newSessionId: () => RUN });
      useProviderStore.getState().updateSettings(fakeProvider, { script: 'rewrite' });
      await session.runner.start();
      clock.advance(8000);
      await flush();
      const transcriptId = h.store.getRecord(RUN).transcripts[0].id;
      const before = h.store.getSentences({ transcriptId });
      await session.runner.stop();
      await session.runner.settled();
      await flush();
      await flush();
      const after = h.store.getSentences({ transcriptId });
      expect(after.length).toBeGreaterThan(0);
      expect(after.slice(0, before.length).map((s: { n: number; startMs: number; endMs: number }) => [s.n, s.startMs, s.endMs]))
        .toEqual(before.map((s: { n: number; startMs: number; endMs: number }) => [s.n, s.startMs, s.endMs]));
    } finally {
      h.cleanup();
    }
  });

  it('keeps writing into the same record across a dropped connection', async () => {
    const h = storePort();
    try {
      const { session, clock } = await setup({ history: h.port, ipc: null, newSessionId: () => RUN });
      useProviderStore.getState().updateSettings(fakeProvider, { script: 'reconnect' });
      await session.runner.start();
      for (let i = 0; i < 30; i++) { clock.advance(1000); await flush(); }
      await session.runner.stop();
      await session.runner.settled();
      await flush();
      await flush();
      expect(h.store.listRecords({}).map((r: { id: string; state: string }) => [r.id, r.state])).toEqual([[RUN, 'closed']]);
      const sentences = h.store.getSentences({ transcriptId: h.store.getRecord(RUN).transcripts[0].id });
      expect(sentences.length).toBeGreaterThan(1);
      expect(sentences.map((s: { n: number }) => s.n).sort((a: number, b: number) => a - b)).toEqual(sentences.map((_: unknown, i: number) => i + 1));
    } finally {
      h.cleanup();
    }
  });

  it('leaves a record that launch recovery closes when the page goes away mid-run', async () => {
    const h = storePort();
    try {
      const { session, clock } = await setup({ history: h.port, ipc: null, newSessionId: () => RUN });
      const detach = session.attach();
      await session.runner.start();
      clock.advance(8000);
      await flush();
      await flush();
      const written = h.store.getSentences({ transcriptId: h.store.getRecord(RUN).transcripts[0].id }).length;
      expect(written).toBeGreaterThan(0);
      window.dispatchEvent(new Event('pagehide'));
      detach();
      const nodeRequire = createRequire(import.meta.url);
      const { openHistory } = nodeRequire('../../electron/history-store.js');
      h.store.close();
      const reopened = openHistory({ dir: h.dir });
      h.store = reopened;
      expect(reopened.recoverOpenRecords()).toEqual({ closed: [RUN], dropped: [] });
      expect(reopened.getSentences({ transcriptId: reopened.getRecord(RUN).transcripts[0].id }).length).toBe(written);
    } finally {
      h.cleanup();
    }
  });
});

