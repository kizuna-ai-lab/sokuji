import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same reason as appShape.test.ts: settingsStore's static import graph reaches
// ModernBrowserAudioService's worklet `?url` import via ServiceFactory, which
// this sandboxed Vite test transform denies outright.
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
  };
  return { playback, getAppAudio: vi.fn(async () => ({ playback, testTone: async () => {} })) };
});
vi.mock('../lib/audio/appAudio', () => ({ getAppAudio }));

vi.mock('../lib/audio/appCapture', () => ({
  createAppCapture: () => ({
    openSource: async () => { throw new Error('no capture in tests'); },
    echo: { attach: () => () => {}, onNotice: () => {}, setDiagnostics: () => {} },
  }),
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
import { fakeProvider } from '../providers/fake/provider';
import { createFakeSource } from '../providers/fake/source';
import { localInferenceProvider } from '../providers/localInference/provider';
import useAudioStore from '../stores/audioStore';
import useLogStore from '../stores/logStore';
import { useProviderStore } from '../stores/providerStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useSettingsStore } from '../stores/settingsStore';
import { READINESS_DELAY_MS } from './readiness';
import { createAppSession, type AppSessionOptions } from './session';

const autoSave = vi.mocked(autoSaveConversation);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const providersBefore = useProviderStore.getState();
const audioBefore = useAudioStore.getState();
const settingsBefore = useSettingsStore.getState();
const segmentationBefore = useSegmentationStore.getState();

beforeEach(() => {
  useProviderStore.setState({ entries: {}, readiness: {}, selected: null, legs: ['speaker'] });
  useAudioStore.setState({ mode: 'speaker', selectedInputDevice: null });
  vi.clearAllMocks();
});

afterEach(() => {
  useProviderStore.setState(providersBefore, true);
  useAudioStore.setState(audioBefore, true);
  useSettingsStore.setState(settingsBefore, true);
  useSegmentationStore.setState(segmentationBefore, true);
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
    expect(loaded.capture).toEqual({ openSource: expect.any(Function), echo: expect.any(Object) });
  });

  it('opens a leg only once the playback has loaded, and plays the run through it', async () => {
    const { session } = await setup();
    await session.runner.start();
    expect(session.runner.state.getState().phase).toBe('running');
    expect(getAppAudio).toHaveBeenCalledTimes(1);
    expect(playback.live).toHaveBeenCalledWith(true);
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

describe('attach', () => {
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
});

describe('getAppSession', () => {
  // Last in the file: it swaps the module registry, so this module's imports
  // above no longer reach the fresh stores it builds against.
  it('builds one session per page, with the options given before it was built', async () => {
    vi.resetModules();
    const m = await import('./session');
    const { useProviderStore: freshProviders } = await import('../stores/providerStore');
    const { fakeProvider: freshFake } = await import('../providers/fake/provider');
    // A provider a start could open, so only `refuse` stands between a start and a run.
    await freshProviders.getState().load(freshFake);
    freshProviders.getState().select('fake');
    m.configureAppSession({ refuse: () => true, clock: createVirtualClock(0) });
    const session = m.getAppSession();
    expect(m.getAppSession()).toBe(session);
    m.configureAppSession({});
    expect(m.getAppSession()).toBe(session);
    await session.runner.start();
    expect(session.runner.state.getState()).toMatchObject({ lastEnd: { reason: 'refused', notice: { code: 'no_provider' } } });
  });
});
