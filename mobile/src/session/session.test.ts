import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The native pieces are stood in for: a recorder that hands its callback back,
// a notification that records show/hide, a stream that records close/end. The
// lease calls are mocked per test. What is under test is the session's own
// sequencing: what it does on a terminal error, after stop(), when
// session-started fails after the socket opened, and after a close during connect().
const audio = vi.hoisted(() => ({
  recorders: [] as Array<{ cb: ((e: { buffer: unknown }) => void) | null; stopped: boolean; cleared: boolean }>,
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
  AudioRecorder: class {
    cb: ((e: { buffer: unknown }) => void) | null = null;
    stopped = false;
    cleared = false;
    constructor() { audio.recorders.push(this); }
    onAudioReady(_cfg: unknown, cb: (e: { buffer: unknown }) => void) { this.cb = cb; return { status: 'ok' }; }
    async start() { return { status: 'ok' }; }
    async stop() { this.stopped = true; }
    pause() {}
    resume() {}
    clearOnAudioReady() { this.cleared = true; }
  },
}));
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
const streams = vi.hoisted(() => [] as Array<{ handlers: Record<string, (...a: never[]) => void>; open: boolean; closed: boolean; ended: boolean; deps?: { clock?: FakeClock } }>);
vi.mock('@shared/providers/soniox/sttStream', () => ({
  SonioxSttStream: class {
    handlers: Record<string, (...a: never[]) => void> = {};
    open = false;
    closed = false;
    ended = false;
    deps?: { clock?: FakeClock };
    constructor(deps?: { clock?: FakeClock }) { this.deps = deps; streams.push(this); }
    setHandlers(h: Record<string, (...a: never[]) => void>) { this.handlers = h; }
    async connect() { this.open = true; }
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
const buffer = { sampleRate: 16000, length: 1600, getChannelData: () => new Float32Array(1600) };
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const statuses = (events: SessionEvent[]) => events.filter((e) => e.type === 'status');
const transcript = { message: vi.fn(), reconnected: vi.fn() };

async function boot(events: SessionEvent[]) {
  const s = startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, onEvent: (e) => events.push(e) });
  await flush();
  const rec = audio.recorders.at(-1)!;
  rec.cb!({ buffer });
  await flush();
  return { s, rec };
}

beforeEach(() => {
  vi.clearAllMocks();
  audio.recorders.length = 0;
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
    expect(rec.cleared).toBe(true);
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
  it('still hides the notification, ends the lease and reports stopped when the recorder refuses to stop', async () => {
    const events: SessionEvent[] = [];
    const { s, rec } = await boot(events);
    (rec as unknown as { stop: () => Promise<void> }).stop = async () => { throw new Error('busy'); };
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
    startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, onEvent: (e) => events.push(e) });
    await flush();
    expect(statuses(events).at(-1)).toEqual({ type: 'status', status: 'error', detail: 'boom' });
  });
});

describe('Android background: setTimeout never fires', () => {
  // React Native pauses JS timers with the activity on Android, while the audio
  // callback keeps coming. Every wait must be driven by the audio callback (the
  // ticker): here the fake timers are never advanced, time moves only through
  // Date.now(), and the recorder's callback is the only thing that ticks.
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
      rec.cb!({ buffer });
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
    const s = startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, checkpointMs: 60000, onCheckpoint: () => checkpoints.push(Date.now()), onEvent: (e) => events.push(e) });
    await flush();
    const rec = audio.recorders.at(-1)!;
    for (let i = 0; i <= 1300; i++) {
      vi.setSystemTime(4_000_000 + i * 100);
      rec.cb!({ buffer });
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

  it('asks for the spoken shape and says so when headphones are in', async () => {
    lease.leaseKey.mockResolvedValueOnce(spokenGrant);
    const events: SessionEvent[] = [];
    const p = player();
    const s = startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, listen, getRoute: async () => 'bluetooth', onRouteChange: () => () => {}, createPlayer: () => p, onEvent: (e) => events.push(e) });
    await flush();
    audio.recorders.at(-1)!.cb!({ buffer });
    await flush();
    expect(lease.leaseKey.mock.calls[0][0]).toMatchObject({ participantSpeech: true });
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'spoken' });
    await s.stop();
  });

  it('asks for subtitles only, and says so, on the loudspeaker', async () => {
    const events: SessionEvent[] = [];
    const s = startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, listen, getRoute: async () => 'speaker', onRouteChange: () => () => {}, createPlayer: player, onEvent: (e) => events.push(e) });
    await flush();
    audio.recorders.at(-1)!.cb!({ buffer });
    await flush();
    expect(lease.leaseKey.mock.calls[0][0].participantSpeech).toBeUndefined();
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'subtitles_only' });
    await s.stop();
  });

  it('falls back to subtitles when the headphones come out mid-session, and speaks again when they return', async () => {
    lease.leaseKey.mockResolvedValueOnce(spokenGrant);
    let route = 'bluetooth';
    const routeCb: { fn: ((r: 'headphones' | 'bluetooth' | 'speaker' | 'other') => void) | null } = { fn: null };
    const events: SessionEvent[] = [];
    const p = player();
    const s = startSession({
      token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, listen,
      getRoute: async () => route as never,
      onRouteChange: (cb) => { routeCb.fn = cb; return () => { routeCb.fn = null; }; },
      createPlayer: () => p,
      onEvent: (e) => events.push(e),
    });
    await flush();
    audio.recorders.at(-1)!.cb!({ buffer });
    await flush();
    route = 'speaker';
    routeCb.fn?.('speaker');
    await flush();
    expect(p.stopped).toBe(1);
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'subtitles_only' });
    route = 'bluetooth';
    routeCb.fn?.('bluetooth');
    await flush();
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'spoken' });
    await s.stop();
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

  it('Pause and Resume are shown on screen', async () => {
    const events: SessionEvent[] = [];
    const { s } = await boot(events);
    audio.notification.listeners.recordingNotificationPause();
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'paused' });
    audio.notification.listeners.recordingNotificationResume();
    expect(statuses(events).at(-1)).toEqual({ type: 'status', status: 'listening', detail: undefined });
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
    rec.cb!({ buffer }); // the audio callback ticks, and the timer fires
    expect(fired).toBe(1);
    await s.stop();
  });

  it('gives the transcript the same clock', async () => {
    const tr = { message: vi.fn(), reconnected: vi.fn(), setClock: vi.fn() };
    const events: SessionEvent[] = [];
    const s = startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', transcript: tr, onEvent: (e) => events.push(e) });
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

describe('headphones plugged in mid-session', () => {
  const spokenGrant = { ...grant, leaseId: 'L2', streams: [...grant.streams, { role: 'par_tts', apiKey: 'tts-key', clientReferenceId: 'r1' }] };
  const player = () => ({ played: 0, stopped: 0, play() { this.played += 1; }, stop() { this.stopped += 1; }, queuedSeconds: () => 0, held: () => 0 });

  it('takes a new grant with the spoken shape and then speaks', async () => {
    lease.leaseKey.mockResolvedValueOnce(grant).mockResolvedValueOnce(spokenGrant);
    const routeCb: { fn: ((r: 'headphones' | 'bluetooth' | 'speaker' | 'other') => void) | null } = { fn: null };
    const events: SessionEvent[] = [];
    const s = startSession({
      token: 'tok', region: 'us', source: 'en', target: 'zh', transcript, listen: { voice: null, speed: 1 },
      getRoute: async () => 'speaker',
      onRouteChange: (cb) => { routeCb.fn = cb; return () => { routeCb.fn = null; }; },
      createPlayer: player,
      onEvent: (e) => events.push(e),
    });
    await flush();
    audio.recorders.at(-1)!.cb!({ buffer });
    await flush();
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'subtitles_only' });
    const first = streams.at(-1)!;
    routeCb.fn?.('headphones');
    await flush();
    // the running stream is ended for a fresh grant; Soniox then closes it
    expect(first.ended).toBe(true);
    first.handlers.onClose({ code: 1000, reason: '' } as never);
    await flush();
    expect(lease.leaseKey).toHaveBeenCalledTimes(2);
    expect(lease.leaseKey.mock.calls[1][0]).toMatchObject({ participantSpeech: true });
    expect(statuses(events).at(-1)).toMatchObject({ status: 'listening', detail: 'spoken' });
    await s.stop();
  });
});
