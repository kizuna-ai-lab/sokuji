import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The native pieces are stood in for: a capture that records how it was started,
// a notification that records show/hide, a stream that records close/end. The
// lease calls are mocked per test. What is under test is the session's own
// sequencing: what it does on a terminal error, after stop(), when
// session-started fails after the socket opened, and after a close during connect().
type FakeCapture = {
  options: { echoCancellation: boolean; inputDeviceId?: string | null };
  stopped: boolean;
  paused: number;
  emit(pcm?: Int16Array): void;
  onStopped: (reason: string, message?: string) => void;
  stop(): Promise<void>;
};
const audio = vi.hoisted(() => ({
  captures: [] as FakeCapture[],
  // Every start the module was asked for, resumes included.
  starts: [] as Array<{ echoCancellation: boolean; inputDeviceId?: string | null }>,
  // What the next start reports; `chain` undefined: vendor when processed, none when not.
  chain: undefined as string | undefined,
  // Starts refused: 'always', or only those asking for echo cancellation.
  fail: null as null | 'always' | 'processed',
  pending: null as null | Promise<void>,
  pausing: null as null | Promise<void>,
  trackFailed: (_message: string) => {},
  notification: {
    show: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
    listeners: {} as Record<string, () => void>,
    addEventListener: vi.fn((name: string, cb: () => void) => {
      audio.notification.listeners[name] = cb;
      return { remove: () => { delete audio.notification.listeners[name]; } };
    }),
  },
  manager: {
    setAudioSessionOptions: vi.fn(),
    observeAudioInterruptions: vi.fn(),
    requestRecordingPermissions: vi.fn(async () => 'Granted'),
    requestNotificationPermissions: vi.fn(async () => 'Granted'),
    addSystemEventListener: vi.fn(() => ({ remove: () => {} })),
  },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('react-native-audio-api', () => ({
  AudioManager: audio.manager,
  RecordingNotificationManager: audio.notification,
}));
vi.mock('./captureNative', () => ({
  createCapture: (o: { options: FakeCapture['options']; onAudio: (pcm: Int16Array) => void; onStopped: FakeCapture['onStopped'] }) => {
    const info = () => ({ chain: audio.chain ?? (o.options.echoCancellation ? 'vendor' : 'none'), sampleRate: 16000 });
    const begin = async () => {
      audio.starts.push(o.options);
      if (audio.pending) await audio.pending;
      if (audio.fail === 'always' || (audio.fail === 'processed' && o.options.echoCancellation)) throw new Error('refused');
      return info();
    };
    const c = {
      options: o.options,
      stopped: false,
      paused: 0,
      emit: (pcm = new Int16Array(1600)) => o.onAudio(pcm),
      onStopped: o.onStopped,
      async start() { audio.captures.push(c); return begin(); },
      async stop() { c.stopped = true; },
      async pause() { c.paused += 1; if (audio.pausing) await audio.pausing; },
      resume: begin,
    };
    return c;
  },
}));
vi.mock('./speechNative', () => ({ createNativeSpeechPlayer: (_rate: number, onFailed: (message: string) => void) => (audio.trackFailed = onFailed, { play() {}, stop() {}, queuedSeconds: () => 0, held: () => 0, close: async () => {} }) }));
vi.mock('../../modules/route-picker/src/RoutePickerModule', () => ({ currentOutput: () => null, addOutputListener: () => ({ remove() {} }) }));
vi.mock('../../modules/audio-capture/src/AudioCaptureModule', () => ({ listInputs: async () => [] }));
vi.mock('./logFile', () => ({ openLogFile: () => 'memory', appendLog: () => {} }));
const network = vi.hoisted(() => ({ listeners: [] as Array<(state: { isConnected: boolean | null }) => void> }));
vi.mock('expo-network', () => ({
  addNetworkStateListener: (cb: (state: { isConnected: boolean | null }) => void) => {
    network.listeners.push(cb);
    return { remove: () => { network.listeners.splice(network.listeners.indexOf(cb), 1); } };
  },
}));
const lease = vi.hoisted(() => ({
  leaseKey: vi.fn(),
  sessionStarted: vi.fn(),
  sessionEnd: vi.fn(),
}));
vi.mock('./lease', () => lease);
type FakeClock = { now(): number; setTimeout(fn: () => void, ms: number): () => void };
const streams = vi.hoisted(() => [] as Array<{ handlers: Record<string, (...a: never[]) => void>; open: boolean; closed: boolean; ended: boolean; deps?: { clock?: FakeClock }; cfg: Record<string, unknown> | null }>);
vi.mock('@shared/providers/soniox/sttStream', () => ({
  SONIOX_STT_MODEL: 'stt-rt-v5',
  SonioxSttStream: class {
    handlers: Record<string, (...a: never[]) => void> = {};
    open = false;
    closed = false;
    ended = false;
    deps?: { clock?: FakeClock };
    constructor(deps?: { clock?: FakeClock }) { this.deps = deps; streams.push(this); }
    setHandlers(h: Record<string, (...a: never[]) => void>) { this.handlers = h; }
    cfg: Record<string, unknown> | null = null;
    async connect(cfg: Record<string, unknown>) { this.cfg = cfg; this.open = true; }
    sendAudio() {}
    end() { this.ended = true; }
    close() { this.closed = true; this.open = false; }
    isOpen() { return this.open; }
  },
}));

import { startSession, type SessionEvent } from './session';

const grant = {
  leaseId: 'L1', clientReferenceId: 'r', region: 'us' as const, maxSessionDurationSeconds: 3600,
  streams: [{ role: 'par_stt', apiKey: 'k', clientReferenceId: 'r1' }],
};
const echo = { echoCancellation: true, echoCancellationOther: false };
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const statuses = (events: SessionEvent[]) => events.filter((e) => e.type === 'status');
const transcript = { message: vi.fn(), reconnected: vi.fn(), setSpeech: vi.fn() };

async function boot(events: SessionEvent[]) {
  const s = startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, echo, onEvent: (e) => events.push(e) });
  await flush();
  const rec = audio.captures.at(-1)!;
  rec.emit();
  await flush();
  return { s, rec };
}

beforeEach(() => {
  vi.clearAllMocks();
  audio.captures.length = 0;
  audio.starts.length = 0;
  audio.chain = undefined;
  audio.fail = null;
  audio.pending = null;
  audio.pausing = null;
  audio.notification.listeners = {};
  streams.length = 0;
  network.listeners.length = 0;
  lease.leaseKey.mockResolvedValue(grant);
  lease.sessionStarted.mockResolvedValue(undefined);
  lease.sessionEnd.mockResolvedValue(true);
});
afterEach(() => { vi.useRealTimers(); });

describe('a terminal error', () => {
  it('turns the microphone and the notification off and ends the session', async () => {
    lease.leaseKey.mockRejectedValueOnce(new Error('balance_exhausted'));
    const events: SessionEvent[] = [];
    const { s, rec } = await boot(events);
    expect(rec.stopped).toBe(true);
    expect(audio.notification.hide).toHaveBeenCalledTimes(1);
    expect(statuses(events).at(-1)).toEqual({ type: 'status', status: 'error', detail: 'balance_exhausted' });
    // stop() after that has nothing left to do and says nothing more
    const n = events.length;
    await s.stop();
    expect(events.length).toBe(n);
  });
});

describe('after stop()', () => {
  it('aborts a lease request in flight and says nothing when it settles', async () => {
    let signal: AbortSignal | undefined;
    let settle!: () => void;
    lease.leaseKey.mockImplementationOnce((o: { signal?: AbortSignal }) => new Promise((_, reject) => {
      signal = o.signal;
      settle = () => reject(new Error('lease_conflict'));
    }));
    const events: SessionEvent[] = [];
    const { s } = await boot(events);
    await s.stop();
    expect(signal?.aborted).toBe(true);
    expect(statuses(events).at(-1)?.status).toBe('stopped');
    const n = events.length;
    settle();
    await flush();
    expect(events.length).toBe(n);
  });

  it('does not report listening when session-started settles after the stop', async () => {
    let settle!: () => void;
    lease.sessionStarted.mockImplementationOnce(() => new Promise<void>((resolve) => { settle = resolve; }));
    const events: SessionEvent[] = [];
    const { s } = await boot(events);
    await s.stop();
    const n = events.length;
    settle();
    await flush();
    expect(events.length).toBe(n);
    expect(statuses(events).at(-1)?.status).toBe('stopped');
  });
});

describe('session-started fails after the socket opened', () => {
  it('closes that socket and retries', async () => {
    lease.sessionStarted.mockRejectedValueOnce(new Error('session-started 500'));
    const events: SessionEvent[] = [];
    const { s } = await boot(events);
    expect(streams.at(-1)!.closed).toBe(true);
    expect(statuses(events).at(-1)).toEqual({ type: 'status', status: 'reconnecting', detail: 'session-started 500' });
    await s.stop();
  });

  it('ends with sign in again on a 401', async () => {
    lease.sessionStarted.mockRejectedValueOnce(new Error('sign_in_required'));
    const events: SessionEvent[] = [];
    const { rec } = await boot(events);
    expect(streams.at(-1)!.closed).toBe(true);
    expect(rec.stopped).toBe(true);
    expect(statuses(events).at(-1)).toEqual({ type: 'status', status: 'error', detail: 'sign_in_required' });
  });
});

describe('a close while connect() is still running', () => {
  it('reconnects once, not again after the retry succeeded', async () => {
    vi.useFakeTimers();
    let fail!: (e: Error) => void;
    lease.sessionStarted.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
    const events: SessionEvent[] = [];
    const { s } = await boot(events);
    // the socket closes while session-started is still pending
    streams.at(-1)!.handlers.onClose({ code: 1006, reason: '' } as never);
    fail(new Error('session-started 500'));
    await flush();
    await vi.advanceTimersByTimeAsync(2000); // the scheduled retry
    await flush();
    await vi.advanceTimersByTimeAsync(30000);
    await flush();
    expect(lease.leaseKey).toHaveBeenCalledTimes(2);
    expect(statuses(events).at(-1)?.status).toBe('listening');
    await s.stop();
  });
});

describe('stop()', () => {
  it('still hides the notification, ends the lease and reports stopped when the capture refuses to stop', async () => {
    const events: SessionEvent[] = [];
    const { s, rec } = await boot(events);
    rec.stop = async () => { throw new Error('busy'); };
    await s.stop();
    expect(audio.notification.hide).toHaveBeenCalledTimes(1);
    expect(lease.sessionEnd).toHaveBeenCalledWith(expect.objectContaining({ leaseId: 'L1' }));
    expect(statuses(events).at(-1)?.status).toBe('stopped');
  });
});

describe('a throw while starting', () => {
  it('ends the session with an error instead of an unhandled rejection', async () => {
    audio.manager.requestNotificationPermissions.mockRejectedValueOnce(new Error('boom'));
    const events: SessionEvent[] = [];
    startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, echo, onEvent: (e) => events.push(e) });
    await flush();
    expect(statuses(events).at(-1)).toEqual({ type: 'status', status: 'error', detail: 'boom' });
  });
});

describe('Android background: setTimeout never fires', () => {
  // React Native pauses JS timers with the activity on Android, while the audio
  // callback keeps coming. Every wait must be driven by the audio callback (the
  // ticker): here the fake timers are never advanced, time moves only through
  // Date.now(), and the capture's frames are the only thing that ticks.
  it('still reconnects after a drop when only the audio callback runs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const events: SessionEvent[] = [];
    const { s, rec } = await boot(events);
    expect(statuses(events).at(-1)?.status).toBe('listening');
    // the network drops: session-end fails, the next lease fails once
    lease.sessionEnd.mockRejectedValueOnce(new Error('dns'));
    lease.leaseKey.mockRejectedValueOnce(new Error('session-key timeout'));
    streams.at(-1)!.handlers.onClose({ code: 1006, reason: '' } as never);
    await flush();
    // audio keeps coming for 20 s of wall-clock time; no timer is ever fired
    for (let i = 0; i < 200; i++) {
      vi.setSystemTime(1_000_000 + (i + 1) * 100);
      rec.emit();
      await flush();
    }
    expect(lease.leaseKey).toHaveBeenCalledTimes(3);
    expect(statuses(events).at(-1)?.status).toBe('listening');
    await s.stop();
  });
});

describe('the network comes back', () => {
  it('retries at once instead of waiting out the backoff', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    lease.leaseKey.mockRejectedValueOnce(new Error('session-key timeout'));
    const events: SessionEvent[] = [];
    const { s } = await boot(events);
    expect(statuses(events).at(-1)?.status).toBe('reconnecting');
    expect(lease.leaseKey).toHaveBeenCalledTimes(1);
    network.listeners.forEach((cb) => cb({ isConnected: true }));
    await flush();
    expect(lease.leaseKey).toHaveBeenCalledTimes(2);
    expect(statuses(events).at(-1)?.status).toBe('listening');
    await s.stop();
  });
});

describe('another device holds the account', () => {
  it('says so after a minute of 409s and keeps trying', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000_000);
    // leaseKey's own 409 loop gives up with lease_conflict after 60 s; the
    // session keeps retrying and names the cause on screen.
    lease.leaseKey.mockRejectedValueOnce(new Error('lease_conflict'));
    const events: SessionEvent[] = [];
    const { s } = await boot(events);
    expect(statuses(events).at(-1)).toEqual({ type: 'status', status: 'reconnecting', detail: 'other_session' });
    await vi.advanceTimersByTimeAsync(2500);
    await flush();
    expect(lease.leaseKey).toHaveBeenCalledTimes(2);
    expect(statuses(events).at(-1)?.status).toBe('listening');
    await s.stop();
  });

  // The next attempt spends another minute in leaseKey's 409 loop: the sentence
  // must stay on screen for all of it, not give way to "Reconnecting…" at the retry.
  it('keeps saying so while the next attempts wait out their 409s', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_500_000);
    lease.leaseKey.mockRejectedValueOnce(new Error('lease_conflict')).mockRejectedValueOnce(new Error('lease_conflict'));
    const events: SessionEvent[] = [];
    const { s } = await boot(events);
    const first = statuses(events).findIndex((e) => e.detail === 'other_session');
    expect(first).toBeGreaterThanOrEqual(0);
    await vi.advanceTimersByTimeAsync(2500); // retry 1: 409s again
    await flush();
    await vi.advanceTimersByTimeAsync(5500); // retry 2: a grant
    await flush();
    expect(lease.leaseKey).toHaveBeenCalledTimes(3);
    const after = statuses(events).slice(first);
    expect(after.filter((e) => e.status === 'reconnecting').every((e) => e.detail === 'other_session')).toBe(true);
    expect(after.at(-1)?.status).toBe('listening');
    await s.stop();
  });
});

describe('the checkpoint', () => {
  // The history store writes the session every 60 s, measured by the session's
  // ticker: with the screen off on Android only the audio callback moves time.
  it('fires every 60 s of audio-callback time, with no JS timer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(4_000_000);
    const checkpoints: number[] = [];
    const events: SessionEvent[] = [];
    const s = startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, echo, checkpointMs: 60000, onCheckpoint: () => checkpoints.push(Date.now()), onEvent: (e) => events.push(e) });
    await flush();
    const rec = audio.captures.at(-1)!;
    for (let i = 0; i <= 1300; i++) {
      vi.setSystemTime(4_000_000 + i * 100);
      rec.emit();
      if (i % 50 === 0) await flush();
    }
    expect(checkpoints.map((t) => t - 4_000_000)).toEqual([60000, 120000]);
    await s.stop();
  });
});

describe('hearing the translation', () => {
  // The grant for a spoken session carries a par_tts stream beside par_stt.
  const spokenGrant = { ...grant, streams: [...grant.streams, { role: 'par_tts', apiKey: 'tts-key', clientReferenceId: 'r1' }] };
  const player = () => ({ played: 0, stopped: 0, play() { this.played += 1; }, stop() { this.stopped += 1; }, queuedSeconds: () => 0, held: () => 0 });
  const listen = { voice: null, speed: 1 };
  type R = 'headphones' | 'bluetooth' | 'speaker' | 'other';

  // A listening session on `first`, up to its first 'listening'.
  async function spoken(first: R, opts: { defaultPlayer?: boolean; echo?: typeof echo; p?: ReturnType<typeof player> } = {}) {
    lease.leaseKey.mockResolvedValue(spokenGrant);
    const events: SessionEvent[] = [];
    const routeCb: { fn: ((r: R) => void) | null } = { fn: null };
    const p = opts.p ?? player();
    const s = startSession({
      token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, echo: opts.echo ?? echo, listen,
      getRoute: async () => first,
      onRouteChange: (cb) => { routeCb.fn = cb; return () => { routeCb.fn = null; }; },
      ...(opts.defaultPlayer ? {} : { createPlayer: () => p }),
      onEvent: (e) => events.push(e),
    });
    await flush();
    audio.captures.at(-1)?.emit();
    await flush();
    const route = async (r: R) => { routeCb.fn?.(r); await flush(); };
    return { s, events, p, route };
  }
  const interruption = (e: { type: string; shouldResume?: boolean }) => {
    const on = audio.manager.addSystemEventListener.mock.calls as unknown as Array<[string, (e: unknown) => void]>;
    on.filter(([name]) => name === 'interruption').at(-1)![1](e);
  };

  it('asks for the spoken shape whenever the translation is to be heard, on any route', async () => {
    const { s } = await spoken('speaker');
    expect(lease.leaseKey.mock.calls[0][0]).toMatchObject({ participantSpeech: true });
    await s.stop();
  });

  it('asks for subtitles alone without the setting', async () => {
    const events: SessionEvent[] = [];
    const { s } = await boot(events);
    expect(lease.leaseKey.mock.calls[0][0].participantSpeech).toBeUndefined();
    expect(audio.starts[0].echoCancellation).toBe(false);
    await s.stop();
  });

  it('starts capture processed on the loudspeaker and plain with headphones', async () => {
    for (const [route, processed] of [['speaker', true], ['bluetooth', false], ['headphones', false]] as const) {
      audio.starts.length = 0;
      const { s, events } = await spoken(route);
      expect(audio.starts[0].echoCancellation).toBe(processed);
      expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'spoken', voice: true });
      await s.stop();
    }
  });

  it("processes another output only by the user's choice", async () => {
    const chosen = { ...echo, echoCancellationOther: true };
    audio.chain = 'vendor';
    const first = await spoken('bluetooth', { echo: chosen });
    expect(audio.starts[0].echoCancellation).toBe(true);
    expect(statuses(first.events).at(-1)).toMatchObject({ status: 'listening', detail: 'spoken' });
    await first.s.stop();
    audio.chain = 'none';
    const second = await spoken('bluetooth', { echo: chosen });
    expect(statuses(second.events).at(-1)).toMatchObject({ status: 'listening', detail: 'subtitles_only' });
    await second.s.stop();
  });

  it('keeps the microphone plain when the setting is off, and still speaks', async () => {
    const { s, events } = await spoken('speaker', { echo: { ...echo, echoCancellation: false } });
    expect(audio.starts[0].echoCancellation).toBe(false);
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'spoken' });
    await s.stop();
  });

  it('shows subtitles only when no chain could run on the loudspeaker', async () => {
    audio.chain = 'none';
    const { s, events } = await spoken('speaker');
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'subtitles_only' });
    await s.stop();
  });

  it('falls back to plain capture and subtitles when the processed start is refused', async () => {
    audio.fail = 'processed';
    const { s, events } = await spoken('speaker');
    expect(audio.starts.map((o) => o.echoCancellation)).toEqual([true, false]);
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'subtitles_only' });
    await s.stop();
  });

  it('does not say echo cancellation is unavailable when the backend granted no voice', async () => {
    lease.leaseKey.mockResolvedValue(grant);
    const events: SessionEvent[] = [];
    const s = startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, echo, listen, getRoute: async () => 'speaker', onRouteChange: () => () => {}, createPlayer: player, onEvent: (e) => events.push(e) });
    await flush();
    audio.captures.at(-1)!.emit();
    await flush();
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: undefined, voice: false });
    expect(streams.at(-1)!.ended).toBe(false);
    expect(lease.leaseKey).toHaveBeenCalledTimes(1);
    await s.stop();
  });

  it('restarts capture when the route changes, keeps the socket, and stops the player on the way out of the headphones', async () => {
    const { s, events, p, route } = await spoken('bluetooth');
    const sockets = streams.length;
    const before = audio.captures.at(-1)!;
    await route('speaker');
    expect(p.stopped).toBe(1);
    expect(before.stopped).toBe(true);
    expect(audio.starts.map((o) => o.echoCancellation)).toEqual([false, true]);
    expect(streams.length).toBe(sockets);
    expect(lease.leaseKey).toHaveBeenCalledTimes(1);
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'spoken' });
    await s.stop();
  });

  it('does not restart capture when the route changes but the mode does not', async () => {
    const { s, p, route } = await spoken('bluetooth');
    await route('headphones');
    expect(audio.starts).toHaveLength(1);
    expect(p.stopped).toBe(0);
    await s.stop();
  });

  it('restarts capture plain and keeps speaking when Bluetooth connects on the loudspeaker', async () => {
    const { s, events, route } = await spoken('speaker');
    await route('bluetooth');
    expect(audio.starts.map((o) => o.echoCancellation)).toEqual([true, false]);
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'spoken' });
    await s.stop();
  });

  it('keeps the voice off while capture is changing to the processed mode', async () => {
    const { s, route } = await spoken('bluetooth');
    let open!: () => void;
    audio.pending = new Promise((resolve) => { open = resolve; });
    const setOn = vi.fn();
    const speech = transcript.setSpeech.mock.calls.at(-1)![0] as { setOn(on: boolean): void };
    const original = speech.setOn.bind(speech);
    speech.setOn = (on) => { setOn(on); original(on); };
    await route('speaker');
    expect(setOn.mock.calls.at(-1)).toEqual([false]);
    open();
    await flush();
    expect(setOn.mock.calls.at(-1)).toEqual([true]);
    await s.stop();
  });

  it('settles on the last route when routes change during a restart', async () => {
    const { s, route } = await spoken('bluetooth');
    let open!: () => void;
    audio.pending = new Promise((resolve) => { open = resolve; });
    await route('speaker');
    await route('headphones');
    audio.pending = null;
    open();
    await flush();
    expect(audio.starts.map((o) => o.echoCancellation)).toEqual([false, true, false]);
    expect(audio.captures.filter((c) => !c.stopped)).toHaveLength(1);
    await s.stop();
  });

  it('applies a route change that arrives while capture is paused when it resumes', async () => {
    const { s, route } = await spoken('bluetooth');
    interruption({ type: 'began' });
    await flush();
    await route('speaker');
    expect(audio.starts).toHaveLength(1);
    interruption({ type: 'ended', shouldResume: true });
    await flush();
    expect(audio.starts.map((o) => o.echoCancellation)).toEqual([false, true]);
    await s.stop();
  });

  // The screen says listening: the capture paused at the end of a restart must not stay paused.
  it('resumes a capture paused at the end of a restart when the call ends meanwhile', async () => {
    const { s, route } = await spoken('bluetooth');
    let open!: () => void;
    let paused!: () => void;
    audio.pending = new Promise((resolve) => { open = resolve; });
    audio.pausing = new Promise((resolve) => { paused = resolve; });
    await route('speaker');
    interruption({ type: 'began' });
    open();
    await flush();
    expect(audio.captures.at(-1)!.paused).toBe(1);
    const starts = audio.starts.length;
    interruption({ type: 'ended', shouldResume: true });
    paused();
    await flush();
    expect(audio.starts).toHaveLength(starts + 1);
    await s.stop();
  });

  it('says subtitles only when the speech track will not open', async () => {
    const { s, events } = await spoken('speaker', { defaultPlayer: true });
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'spoken' });
    audio.trackFailed('no track');
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'subtitles_only' });
    await s.stop();
  });

  it('resumes in the same mode through the same capture, and re-reads the chain', async () => {
    const { s, events } = await spoken('speaker');
    const c = audio.captures.at(-1)!;
    interruption({ type: 'began' });
    await flush();
    expect(c.paused).toBe(1);
    audio.chain = 'none';
    interruption({ type: 'ended', shouldResume: true });
    await flush();
    expect(audio.captures).toHaveLength(1);
    expect(audio.starts.map((o) => o.echoCancellation)).toEqual([true, true]);
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'subtitles_only' });
    await s.stop();
  });

  it('counts the module stopping itself for an interruption as the pause, and resumes once', async () => {
    const { s } = await spoken('speaker');
    const c = audio.captures.at(-1)!;
    c.onStopped('interrupted');
    interruption({ type: 'began' });
    await flush();
    expect(c.paused).toBe(0);
    interruption({ type: 'ended', shouldResume: true });
    await flush();
    expect(audio.starts).toHaveLength(2);
    await s.stop();
  });

  it('survives a capture error with a restart, and gives up when no frame came since', async () => {
    const { s, events } = await spoken('speaker');
    audio.captures.at(-1)!.onStopped('error', 'read failed');
    await flush();
    expect(audio.starts).toHaveLength(2);
    expect(statuses(events).at(-1)?.status).toBe('listening');
    audio.captures.at(-1)!.onStopped('error', 'read failed');
    await flush();
    expect(audio.starts).toHaveLength(2);
    expect(statuses(events).at(-1)).toEqual({ type: 'status', status: 'error', detail: 'microphone_denied' });
    await s.stop();
  });

  it('ends with microphone_denied only when the module refuses to start, not when a chain is missing', async () => {
    audio.fail = 'always';
    const refused = await spoken('speaker');
    expect(statuses(refused.events).at(-1)).toEqual({ type: 'status', status: 'error', detail: 'microphone_denied' });
    audio.fail = null;
    audio.chain = 'none';
    const missing = await spoken('speaker');
    expect(statuses(missing.events).at(-1)?.status).toBe('listening');
    await missing.s.stop();
  });

  it('tells the screen the route and the chain with the listening status', async () => {
    const { s, events } = await spoken('speaker');
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', route: 'speaker', chain: 'vendor' });
    await s.stop();
  });

  it('stops a capture that started after the session stopped', async () => {
    let open!: () => void;
    audio.pending = new Promise((resolve) => { open = resolve; });
    const events: SessionEvent[] = [];
    const s = startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, echo, onEvent: (e) => events.push(e) });
    await flush();
    await s.stop();
    open();
    await flush();
    expect(audio.captures.at(-1)!.stopped).toBe(true);
  });

});

describe('the Android notification', () => {
  // Its Stop action ends the recording natively and tells a live app: the
  // session must end with it (lease released, 'stopped' said), or the account's
  // one lease stays held and the next foreground reconnects into a dead mic.
  it("Stop ends the session like the screen's Stop", async () => {
    const events: SessionEvent[] = [];
    await boot(events);
    expect(audio.notification.listeners.recordingNotificationStop).toBeTypeOf('function');
    audio.notification.listeners.recordingNotificationStop();
    await flush();
    expect(lease.sessionEnd).toHaveBeenCalledWith(expect.objectContaining({ leaseId: 'L1' }));
    expect(audio.notification.hide).toHaveBeenCalledTimes(1);
    expect(statuses(events).at(-1)?.status).toBe('stopped');
  });

  it('Pause and Resume are shown on screen, with the voice flag', async () => {
    const events: SessionEvent[] = [];
    const { s } = await boot(events);
    audio.notification.listeners.recordingNotificationPause();
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'paused', voice: false });
    audio.notification.listeners.recordingNotificationResume();
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: undefined, voice: false });
    await s.stop();
  });

  // The library's recorder is idle: capture is the module's, so Pause has to stop it here.
  it('Pause stops the capture and Resume starts it again', async () => {
    const { s, rec } = await boot([]);
    const starts = audio.starts.length;
    audio.notification.listeners.recordingNotificationPause();
    await flush();
    expect(rec.paused).toBe(1);
    audio.notification.listeners.recordingNotificationResume();
    await flush();
    expect(audio.starts).toHaveLength(starts + 1);
    await s.stop();
  });

  it('a call ending does not undo Pause', async () => {
    const events: SessionEvent[] = [];
    const { s } = await boot(events);
    const starts = audio.starts.length;
    audio.notification.listeners.recordingNotificationPause();
    await flush();
    const on = audio.manager.addSystemEventListener.mock.calls as unknown as Array<[string, (e: unknown) => void]>;
    const interruption = on.filter(([name]) => name === 'interruption').at(-1)![1];
    interruption({ type: 'began' });
    interruption({ type: 'ended', shouldResume: true });
    await flush();
    expect(audio.starts).toHaveLength(starts);
    expect(statuses(events).at(-1)).toMatchObject({ detail: 'paused' });
    await s.stop();
  });

  // The first listening is what the analytics count, with its detail: Pause during connect comes after it.
  it('Pause while connecting reports after the first listening', async () => {
    let settle!: () => void;
    lease.sessionStarted.mockImplementationOnce(() => new Promise<void>((resolve) => { settle = resolve; }));
    const events: SessionEvent[] = [];
    const s = startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, echo, onEvent: (e) => events.push(e) });
    await flush();
    audio.captures.at(-1)!.emit();
    await flush();
    audio.notification.listeners.recordingNotificationPause();
    expect(statuses(events).some((e) => e.status === 'listening')).toBe(false);
    settle();
    await flush();
    const listening = statuses(events).filter((e) => e.status === 'listening');
    expect(listening[0].detail).toBeUndefined();
    expect(listening.at(-1)).toMatchObject({ detail: 'paused' });
    await s.stop();
  });

  // A Pause tapped before the first grant must not look like the session
  // started: the screen's first 'listening' is what the analytics count.
  it('Pause before the stream is up reports nothing', async () => {
    let grantIt!: () => void;
    lease.leaseKey.mockImplementationOnce(() => new Promise((resolve) => { grantIt = () => resolve(grant); }));
    const events: SessionEvent[] = [];
    const s = startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, echo, onEvent: (e) => events.push(e) });
    await flush();
    audio.captures.at(-1)!.emit();
    await flush();
    audio.notification.listeners.recordingNotificationPause();
    expect(statuses(events).some((e) => e.status === 'listening')).toBe(false);
    grantIt();
    await flush();
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', voice: false });
    await s.stop();
  });
});

describe('the shared modules\' timers', () => {
  // The socket-open cut-off and the keepalive live in the shared stream, the
  // fin grace in the shared Utterances: all of them on the session's ticker.
  it('gives the stream the ticker as its clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    const events: SessionEvent[] = [];
    const { s, rec } = await boot(events);
    const clock = streams.at(-1)!.deps?.clock;
    expect(clock).toBeDefined();
    let fired = 0;
    clock!.setTimeout(() => { fired += 1; }, 1000);
    // time passes but no JS timer fires (none is advanced): nothing yet
    vi.setSystemTime(5_001_000);
    await flush();
    expect(fired).toBe(0);
    rec.emit(); // the audio callback ticks, and the timer fires
    expect(fired).toBe(1);
    await s.stop();
  });

  it('gives the transcript the same clock', async () => {
    const tr = { message: vi.fn(), reconnected: vi.fn(), setClock: vi.fn() };
    const events: SessionEvent[] = [];
    const s = startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript: tr, echo, onEvent: (e) => events.push(e) });
    await flush();
    expect(tr.setClock).toHaveBeenCalledWith(expect.objectContaining({ setTimeout: expect.any(Function), now: expect.any(Function) }));
    await s.stop();
  });
});

describe('a refused configuration', () => {
  // Soniox answers a bad language pair with a 400 and closes: retrying cannot
  // help, so the session ends with a named error instead of reconnecting forever.
  it('ends the session as invalid_config on a 400 from Soniox', async () => {
    const events: SessionEvent[] = [];
    const { rec } = await boot(events);
    streams.at(-1)!.handlers.onError('400' as never, 'invalid target_language' as never);
    streams.at(-1)!.handlers.onClose({ code: 1000, reason: '' } as never);
    await flush();
    expect(statuses(events).at(-1)).toEqual({ type: 'status', status: 'error', detail: 'invalid_config' });
    expect(rec.stopped).toBe(true);
    expect(lease.sessionEnd).toHaveBeenCalledWith(expect.objectContaining({ leaseId: 'L1' }));
    expect(lease.leaseKey).toHaveBeenCalledTimes(1);
  });
});

describe('what the screen is told about the voice', () => {
  const spokenGrant = { ...grant, streams: [...grant.streams, { role: 'par_tts', apiKey: 'tts-key', clientReferenceId: 'r1' }] };
  const player = () => ({ played: 0, stopped: 0, play() { this.played += 1; }, stop() { this.stopped += 1; }, queuedSeconds: () => 0, held: () => 0 });

  it('says whether the grant carries the voice, for the analytics', async () => {
    lease.leaseKey.mockResolvedValueOnce(spokenGrant);
    const events: SessionEvent[] = [];
    const s = startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, echo, listen: { voice: null, speed: 1 }, getRoute: async () => 'headphones', onRouteChange: () => () => {}, createPlayer: player, onEvent: (e) => events.push(e) });
    await flush();
    audio.captures.at(-1)!.emit();
    await flush();
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', voice: true });
    await s.stop();
  });

  it('says so too when there is no voice', async () => {
    const events: SessionEvent[] = [];
    const { s } = await boot(events);
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', voice: false });
    await s.stop();
  });
});

describe('the grant\'s streams', () => {
  const player = () => ({ played: 0, stopped: 0, play() { this.played += 1; }, stop() { this.stopped += 1; }, queuedSeconds: () => 0, held: () => 0 });

  it('opens the recognition socket with the par_stt stream whatever the order', async () => {
    lease.leaseKey.mockResolvedValueOnce({ ...grant, streams: [{ role: 'par_tts', apiKey: 'tts-key', clientReferenceId: 'r-tts' }, ...grant.streams] });
    const events: SessionEvent[] = [];
    const s = startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, echo, listen: { voice: null, speed: 1 }, getRoute: async () => 'headphones', onRouteChange: () => () => {}, createPlayer: player, onEvent: (e) => events.push(e) });
    await flush();
    audio.captures.at(-1)!.emit();
    await flush();
    expect(streams.at(-1)!.cfg).toMatchObject({ apiKey: 'k', clientReferenceId: 'r1' });
    expect(lease.sessionStarted).toHaveBeenCalledWith(expect.objectContaining({ role: 'par_stt' }));
    await s.stop();
  });

  it('reports the start for the recognition stream only: the backend refuses a TTS role', async () => {
    lease.leaseKey.mockResolvedValueOnce({ ...grant, streams: [...grant.streams, { role: 'par_tts', apiKey: 'tts-key', clientReferenceId: 'r-tts' }] });
    const events: SessionEvent[] = [];
    const s = startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, echo, listen: { voice: null, speed: 1 }, getRoute: async () => 'headphones', onRouteChange: () => () => {}, createPlayer: player, onEvent: (e) => events.push(e) });
    await flush();
    audio.captures.at(-1)!.emit();
    await flush();
    expect(lease.sessionStarted).toHaveBeenCalledTimes(1);
    expect(lease.sessionStarted).not.toHaveBeenCalledWith(expect.objectContaining({ role: 'par_tts' }));
    await s.stop();
  });

  it('reports a grant without a recognition stream by name', async () => {
    lease.leaseKey.mockResolvedValueOnce({ ...grant, streams: [{ role: 'par_tts', apiKey: 'tts-key', clientReferenceId: 'r-tts' }] });
    const events: SessionEvent[] = [];
    const { s } = await boot(events);
    expect(statuses(events).at(-1)).toMatchObject({ status: 'reconnecting', detail: 'missing_stt_stream' });
    await s.stop();
  });
});

describe('stop during the route lookup', () => {
  it('creates no player and no route subscription', async () => {
    let routeIt!: () => void;
    const created = { players: 0, subscriptions: 0 };
    const events: SessionEvent[] = [];
    const s = startSession({
      token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, echo, listen: { voice: null, speed: 1 },
      getRoute: () => new Promise((resolve) => { routeIt = () => resolve('speaker'); }),
      onRouteChange: () => { created.subscriptions += 1; return () => {}; },
      createPlayer: () => { created.players += 1; return { play() {}, stop() {}, queuedSeconds: () => 0, held: () => 0 }; },
      onEvent: (e) => events.push(e),
    });
    await flush();
    await s.stop();
    routeIt();
    await flush();
    expect(created).toEqual({ players: 0, subscriptions: 0 });
  });
});
