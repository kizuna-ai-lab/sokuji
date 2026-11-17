// The app's own quit during a session with live notes: no last update, and the quit is not held up.
// The module mocks are the ones session.test.ts needs to build an app session in jsdom (copied, not shared).
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
// jsdom.
const { getAppAudio } = vi.hoisted(() => {
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

import { createVirtualClock } from '../lib/contract/clock';
import { fakeProvider } from '../providers/fake/provider';
import { createFakeSource, type FakeSource } from '../providers/fake/source';
import { useProviderStore } from '../stores/providerStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useLineUpStore } from '../stores/lineUpStore';
import { useLiveNotes } from '../lib/notes/live/liveStore';
import { createAppSession, type AppSessionOptions } from './session';
import type { HistoryPort } from '../lib/history/port';
import type { LiveNotesDeps } from '../lib/notes/live/loop';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const providersBefore = useProviderStore.getState();
const settingsBefore = useSettingsStore.getState();
const lineUpBefore = useLineUpStore.getState().lineUp;

beforeEach(() => {
  useProviderStore.setState({ entries: {}, intent: undefined, readiness: {}, selected: null, legs: ['speaker'] });
  devices.next = null;
  vi.clearAllMocks();
});
afterEach(() => {
  useProviderStore.setState(providersBefore, true);
  useSettingsStore.setState(settingsBefore, true);
  useLineUpStore.setState({ lineUp: lineUpBefore });
  useLiveNotes.getState().reset();
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
  session.setBridges({ track: vi.fn() });
  return { clock, session };
}

function electronIpc() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc = {
    invoke: vi.fn(async (_channel: string, _data?: unknown) => {}),
    receive: vi.fn((channel: string, fn: (...args: unknown[]) => void) => { handlers.set(channel, fn); }),
    removeListener: vi.fn(),
  };
  return { ipc, closeRequested: () => handlers.get('app:close-requested')!() };
}

const historyPort = () => {
  const answer = (value: unknown) => async () => value;
  return {
    openRecord: answer(undefined), putLeg: answer(undefined), createTranscript: answer(1), putSegments: answer(undefined),
    putNotices: answer(undefined), appendSentences: answer({ added: 0 }), reviseSentences: answer(undefined), closeRecord: answer({ kept: true }),
  } as unknown as HistoryPort;
};

/** A live notes loop whose Stop (the last update) never finishes: a quit that waited for it would hang. */
function hangingLive() {
  const made: Array<{ deps: LiveNotesDeps; sentences: number; stopped: boolean; quiet: boolean; disposed: boolean }> = [];
  const factory = (deps: LiveNotesDeps) => {
    const one = { deps, sentences: 0, stopped: false, quiet: false, disposed: false };
    made.push(one);
    return {
      sentences: (list: readonly unknown[]) => { one.sentences += list.length; },
      quiet: () => { one.quiet = true; },
      stop: () => { one.stopped = true; return new Promise<void>(() => {}); },
      dispose: () => { one.disposed = true; },
    };
  };
  return { made, factory };
}

describe('the last update at Stop, and none at the app\'s own quit', () => {
  it('lets the loop go without its last update when the app quits during a session, and answers the close', async () => {
    useSettingsStore.setState({ liveNotes: true, notesAfterSession: false } as never);
    useLineUpStore.setState({ lineUp: { transcription: 'fake', translation: 'fake', speech: 'fake', summarisation: 'openai' } } as never);
    useProviderStore.setState({ entries: { ...useProviderStore.getState().entries, openai: { settings: {}, credentials: { apiKey: 'sk-test' }, pair: { source: 'en', target: 'ja' } } } } as never);
    const { ipc, closeRequested } = electronIpc();
    const live = hangingLive();
    const { session, clock } = await setup({ ipc, history: historyPort(), liveNotes: live.factory as never, askQuit: async () => 'quit' });
    const detach = session.attach();
    await session.runner.start();
    clock.advance(8000);
    await vi.waitFor(() => expect(live.made).toHaveLength(1));
    await vi.waitFor(() => expect(live.made[0].sentences).toBeGreaterThan(0));

    await closeRequested();
    await flush();
    expect(ipc.invoke).toHaveBeenCalledWith('app:close-ready');
    expect(live.made[0].disposed).toBe(true);
    expect(live.made[0].stopped).toBe(false);
    expect(useLiveNotes.getState()).toMatchObject({ recordId: 'run1', running: false, ended: true });
    detach();
  });
});
