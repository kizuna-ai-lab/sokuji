import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The native pieces are stood in for: a recorder that hands its callback back,
// a notification that records show/hide, a stream that records close/end. The
// lease calls are mocked per test. What is under test is the session's own
// sequencing: what it does on a terminal error, after stop(), when
// session-started fails after the socket opened, and after a close during connect().
const audio = vi.hoisted(() => ({
  recorders: [] as Array<{ cb: ((e: { buffer: unknown }) => void) | null; stopped: boolean; cleared: boolean }>,
  notification: { show: vi.fn(async () => {}), hide: vi.fn(async () => {}) },
  manager: {
    setAudioSessionOptions: vi.fn(),
    observeAudioInterruptions: vi.fn(),
    requestRecordingPermissions: vi.fn(async () => 'Granted'),
    requestNotificationPermissions: vi.fn(async () => 'Granted'),
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
    clearOnAudioReady() { this.cleared = true; }
  },
}));
vi.mock('./logFile', () => ({ openLogFile: () => 'memory', appendLog: () => {} }));
const lease = vi.hoisted(() => ({
  leaseKey: vi.fn(),
  sessionStarted: vi.fn(),
  sessionEnd: vi.fn(),
}));
vi.mock('./lease', () => lease);
const streams = vi.hoisted(() => [] as Array<{ handlers: Record<string, (...a: never[]) => void>; open: boolean; closed: boolean; ended: boolean }>);
vi.mock('@shared/providers/soniox/sttStream', () => ({
  SonioxSttStream: class {
    handlers: Record<string, (...a: never[]) => void> = {};
    open = false;
    closed = false;
    ended = false;
    constructor() { streams.push(this); }
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

async function boot(events: SessionEvent[]) {
  const s = startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', onEvent: (e) => events.push(e) });
  await flush();
  const rec = audio.recorders.at(-1)!;
  rec.cb!({ buffer });
  await flush();
  return { s, rec };
}

beforeEach(() => {
  vi.clearAllMocks();
  audio.recorders.length = 0;
  streams.length = 0;
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
    startSession({ token: 'tok', region: 'us', source: 'en', target: 'zh', onEvent: (e) => events.push(e) });
    await flush();
    expect(statuses(events).at(-1)).toEqual({ type: 'status', status: 'error', detail: 'boom' });
  });
});
