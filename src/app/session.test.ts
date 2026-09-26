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
    audio: vi.fn(), held: vi.fn(), clear: vi.fn(), live: vi.fn(), passthrough: vi.fn(),
    ttsTap: { read: () => new Float32Array(0) },
    meter: vi.fn(() => null),
  };
  return { playback, getAppAudio: vi.fn(async () => ({ playback, testTone: async () => {} })) };
});
vi.mock('../lib/audio/appAudio', () => ({ getAppAudio }));

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

import { createVirtualClock } from '../lib/contract/clock';
import { settleReports } from '../lib/diagnostics/report';
import { autoSaveConversation } from '../lib/export/appAutoSave';
import { DEFAULT_CLOSE_TIMEOUT_MS } from '../lib/session/runner';
import { fakeProvider } from '../providers/fake/provider';
import { createFakeSource, type FakeSource } from '../providers/fake/source';
import { localInferenceProvider } from '../providers/localInference/provider';
import useAudioStore from '../stores/audioStore';
import useLogStore from '../stores/logStore';
import { useProviderStore } from '../stores/providerStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useTurnModeStore } from '../stores/turnModeStore';
import { READINESS_DELAY_MS } from './readiness';
import { createAppSession, type AppSessionOptions } from './session';
import { currentSubtitleFeed } from './subtitleFeed';

const autoSave = vi.mocked(autoSaveConversation);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const providersBefore = useProviderStore.getState();
const audioBefore = useAudioStore.getState();
const settingsBefore = useSettingsStore.getState();
const segmentationBefore = useSegmentationStore.getState();
const turnModeBefore = useTurnModeStore.getState();

beforeEach(() => {
  useProviderStore.setState({ entries: {}, readiness: {}, selected: null, legs: ['speaker'] });
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
    const [legs, info, notify] = autoSave.mock.calls[0];
    expect(legs.map((leg) => leg.leg)).toEqual(['speaker']);
    expect(info).toBe(session.runner.conversation.info);
    expect(notify).toEqual({ showToast: expect.any(Function) });
    expect(refetchQuota).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['saved', 'refetch']);
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

  it('checks a local provider by itself', async () => {
    const { session, clock } = await setup();
    const spy = vi.fn(async () => ({ state: 'unknown' as const }));
    useProviderStore.setState({
      selected: 'localInference',
      entries: { localInference: { settings: {}, credentials: {}, pair: { source: 'ja', target: 'en' } } },
      readiness: {},
      refreshReadiness: spy,
    });
    const detach = session.attach();

    clock.advance(READINESS_DELAY_MS);
    await flush();

    expect(spy).toHaveBeenCalledWith(localInferenceProvider, { signedIn: false, getToken: expect.any(Function) });

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

  it('keeps the provider put while a run is not idle, and lets it change once idle', async () => {
    useLogStore.getState().setEnabled(true);
    useLogStore.getState().clearLogs();
    const { session } = await setup();
    const detach = session.attach();

    await session.runner.start();
    expect(session.runner.state.getState().phase).toBe('running');
    useProviderStore.getState().select('localInference');
    expect(useProviderStore.getState().selected).toBe('fake');
    await settleReports();
    expect(useLogStore.getState().logs.filter((l) => l.type === 'warning' && l.message.includes('cannot change during a session'))).toHaveLength(1);

    await session.runner.stop();
    await session.runner.settled();
    useProviderStore.getState().select('localInference');
    expect(useProviderStore.getState().selected).toBe('localInference');

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
