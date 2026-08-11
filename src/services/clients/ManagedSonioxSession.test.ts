import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ManagedSonioxSession,
  primarySttRoleFor,
  byokCredentials,
  type ManagedSessionRequest,
} from './ManagedSonioxSession';

const SESSION_TOKEN = 'better-auth-session-token-abc';

// Same fixtures the client's managed suite used to carry — the session-key
// response is the session's business now, not a stream's.
function speechToSpeechResponse() {
  return {
    sttApiKey: 'soniox-stt-temp-key',
    ttsApiKey: 'soniox-tts-temp-key',
    expiresAt: '2026-07-25T00:01:00Z',
    maxSessionDurationSeconds: 900,
    budgetMicroUsd: 500_000,
    rateUsdPerHour: 0.6,
    sku: 'soniox:speech_to_speech',
    leaseId: 'lease-abc-123',
    // Distinct from leaseId on purpose — this is the namespaced string the
    // backend bound to the temporary key(s).
    clientReferenceId: 'sokuji1:acct-1:lease-abc-123',
  };
}

/**
 * What production actually answers since BE6: the flat fields stay (populated
 * from the primary leg) and `streams` carries one entry per Soniox stream, each
 * with the key and the FOUR-segment reference bound to it.
 */
function splitBothResponse() {
  return {
    // Flat fields = the primary leg, which for split Both is the speaker's STT.
    sttApiKey: 'key-spk-stt',
    ttsApiKey: 'key-spk-tts',
    expiresAt: '2026-07-25T00:01:00Z',
    maxSessionDurationSeconds: 900,
    budgetMicroUsd: 500_000,
    rateUsdPerHour: 2.5,
    sku: 'soniox:speech_to_speech',
    leaseId: 'lease-split-1',
    clientReferenceId: 'sokuji1:acct-1:lease-split-1:spk_stt',
    streams: [
      { role: 'spk_stt', apiKey: 'key-spk-stt', clientReferenceId: 'sokuji1:acct-1:lease-split-1:spk_stt', expiresAt: '2026-07-25T00:01:00Z' },
      { role: 'spk_tts', apiKey: 'key-spk-tts', clientReferenceId: 'sokuji1:acct-1:lease-split-1:spk_tts', expiresAt: '2026-07-25T00:05:00Z' },
      { role: 'par_stt', apiKey: 'key-par-stt', clientReferenceId: 'sokuji1:acct-1:lease-split-1:par_stt', expiresAt: '2026-07-25T00:03:00Z' },
    ],
  };
}

function textOnlyResponse() {
  return {
    sttApiKey: 'soniox-stt-temp-key-text-only',
    // ttsApiKey intentionally absent — text_only mode never gets one.
    expiresAt: '2026-07-25T00:01:00Z',
    maxSessionDurationSeconds: 900,
    budgetMicroUsd: 200_000,
    rateUsdPerHour: 0.12,
    sku: 'soniox:text_only',
    leaseId: 'lease-text-only-1',
    clientReferenceId: 'sokuji1:acct-1:lease-text-only-1',
  };
}

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/**
 * Queues distinct responses in call order (for the 409-retry tests, where the
 * first and second /soniox/session-key attempts must differ). Once drained,
 * further calls get a generic 200 — the fire-and-forget lifecycle POSTs are
 * not under test here and must not throw from an unconfigured mock.
 */
function mockFetchSequence(...responses: Array<{ status: number; body: unknown }>) {
  const queue = [...responses];
  const fn = vi.fn(async () => {
    const next = queue.shift() ?? { status: 200, body: {} };
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function callsTo(fetchMock: ReturnType<typeof vi.fn>, path: string) {
  return fetchMock.mock.calls.filter(([url]) => (url as string).includes(path));
}

const SPEAKER_S2S: ManagedSessionRequest = { mode: 'speaker', textOnly: false, bothSplit: false };

function newSession(onEvent?: (type: string, data: unknown) => void) {
  return new ManagedSonioxSession({ sessionToken: SESSION_TOKEN, onEvent });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('primarySttRoleFor', () => {
  it('names the lease’s single STT role for every request shape', () => {
    expect(primarySttRoleFor({ mode: 'speaker', textOnly: false, bothSplit: false })).toBe('spk_stt');
    expect(primarySttRoleFor({ mode: 'speaker', textOnly: true, bothSplit: false })).toBe('spk_stt');
    // participant-only: the primary leg is NOT the speaker.
    expect(primarySttRoleFor({ mode: 'participant', textOnly: true, bothSplit: false })).toBe('par_stt');
    // shared Both mixes mic+system into one stream — calling that spk_* would be a lie.
    expect(primarySttRoleFor({ mode: 'both', textOnly: false, bothSplit: false })).toBe('mix_stt');
    expect(primarySttRoleFor({ mode: 'both', textOnly: false, bothSplit: true })).toBe('spk_stt');
  });
});

describe('byokCredentials', () => {
  it('puts the one user key in both slots and sends no reference', () => {
    expect(byokCredentials('user-key')).toEqual({ stt: 'user-key', tts: 'user-key' });
  });
});

describe('ManagedSonioxSession.acquire', () => {
  it('POSTs the MATRIX body with the better-auth token in Authorization', async () => {
    const fetchMock = mockFetchOnce(200, speechToSpeechResponse());
    await newSession().acquire(SPEAKER_S2S);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/soniox/session-key');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SESSION_TOKEN}`);
    // The AUDIO-shape vocabulary, not the legacy billing one. The backend tells
    // the two apart by the value of `mode` alone and checks the legacy one
    // first, so 'speaker' is what selects the matrix reading.
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'speaker', textOnly: false, bothSplit: false });
  });

  it('always sends all three fields — the backend defaults none of them', async () => {
    // `normalizeSessionShape` returns null (→ 400) when `textOnly` is missing
    // for speaker/both or `bothSplit` is missing for both. Deliberate: a client
    // bug that dropped one would otherwise silently buy the more expensive
    // synthesis path, or halve the price of what the user asked for.
    const fetchMock = mockFetchOnce(200, textOnlyResponse());
    await newSession().acquire({ mode: 'speaker', textOnly: true, bothSplit: false });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'speaker', textOnly: true, bothSplit: false });
  });

  it('declares bothSplit: true for a split Both session', async () => {
    const fetchMock = mockFetchOnce(200, splitBothResponse());
    await newSession().acquire({ mode: 'both', textOnly: false, bothSplit: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'both', textOnly: false, bothSplit: true });
  });

  it('files a per-stream response under EVERY issued STT role, TTS matched by side', async () => {
    mockFetchOnce(200, splitBothResponse());
    const session = newSession();
    await session.acquire({ mode: 'both', textOnly: false, bothSplit: true });

    // The speaker leg carries the session's only TTS key, and its own
    // four-segment reference — not the participant's, and not the lease's
    // three-segment base ref.
    expect(session.credentialsFor('spk_stt')).toEqual({
      stt: 'key-spk-stt',
      tts: 'key-spk-tts',
      clientReferenceId: 'sokuji1:acct-1:lease-split-1:spk_stt',
    });
    // A DIFFERENT key. Attribution is key-bound, so two legs sharing one key
    // are indistinguishable in the usage logs and the ended-mask could not be
    // driven at all.
    expect(session.credentialsFor('par_stt')).toEqual({
      stt: 'key-par-stt',
      clientReferenceId: 'sokuji1:acct-1:lease-split-1:par_stt',
    });
    expect(session.credentialsFor('spk_stt').stt)
      .not.toBe(session.credentialsFor('par_stt').stt);
    // par_tts is unreachable in v1: the participant config forces textOnly.
    expect(session.credentialsFor('par_stt').tts).toBeUndefined();
  });

  it('a TTS role is not a leg of its own — no bundle is filed under one', async () => {
    mockFetchOnce(200, splitBothResponse());
    const session = newSession();
    await session.acquire({ mode: 'both', textOnly: false, bothSplit: true });

    expect(session.hasRole('spk_tts')).toBe(false);
    expect(session.hasRole('mix_stt')).toBe(false);
  });

  it('rejects a per-stream response that is missing the primary leg', async () => {
    // Unreachable from a correct backend (it throws rather than answer one),
    // but the alternative here is a session that acquires a lease and then
    // fails at the speaker's credentialsFor with no lease released.
    const response = splitBothResponse();
    response.streams = response.streams.filter((s) => s.role !== 'spk_stt');
    mockFetchOnce(200, response);

    await expect(newSession().acquire({ mode: 'both', textOnly: false, bothSplit: true }))
      .rejects.toThrow(/spk_stt/);
  });

  it('falls back to the flat fields, under the primary STT role, when `streams` is absent', async () => {
    // Defensive only — production has answered with `streams` since BE6. A
    // rollback would leave single-stream shapes fully working and make split
    // fail LOUDLY on the participant's credentialsFor (inside the non-fatal
    // participant catch), which is the settled degradation. What it must never
    // do is hand the same key to both legs.
    mockFetchOnce(200, speechToSpeechResponse());
    const session = newSession();
    await session.acquire({ mode: 'both', textOnly: false, bothSplit: false });

    expect(session.primarySttRole).toBe('mix_stt');
    expect(session.credentialsFor('mix_stt')).toEqual({
      stt: 'soniox-stt-temp-key',
      tts: 'soniox-tts-temp-key',
      clientReferenceId: 'sokuji1:acct-1:lease-abc-123',
    });
    expect(session.leaseId).toBe('lease-abc-123');
  });

  it('omits the tts slot entirely for a text-only lease', async () => {
    mockFetchOnce(200, textOnlyResponse());
    const session = newSession();
    await session.acquire({ mode: 'speaker', textOnly: true, bothSplit: false });

    expect(session.credentialsFor('spk_stt').tts).toBeUndefined();
  });

  it('throws for a role that was never issued rather than handing back the primary bundle', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const session = newSession();
    await session.acquire(SPEAKER_S2S);

    expect(session.hasRole('par_stt')).toBe(false);
    expect(() => session.credentialsFor('par_stt')).toThrow(/par_stt/);
  });

  it('rejects rather than falling back to leaseId when clientReferenceId is absent', async () => {
    const response = speechToSpeechResponse() as Record<string, unknown>;
    delete response.clientReferenceId;
    mockFetchOnce(200, response);

    await expect(newSession().acquire(SPEAKER_S2S)).rejects.toThrow(/clientReferenceId/);
  });

  it('a 402 rejects with a message distinguishing insufficient balance', async () => {
    mockFetchOnce(402, { error: 'Insufficient balance' });
    await expect(newSession().acquire(SPEAKER_S2S)).rejects.toThrow(/insufficient balance/i);
  });

  it('a 503 (capacity) failure does NOT read as insufficient balance', async () => {
    mockFetchOnce(503, { error: 'Soniox capacity is temporarily full' });
    await expect(newSession().acquire(SPEAKER_S2S)).rejects.not.toThrow(/insufficient balance/i);
  });

  it('a 403 (frozen wallet) failure does NOT read as insufficient balance', async () => {
    mockFetchOnce(403, { error: 'Wallet is frozen' });
    await expect(newSession().acquire(SPEAKER_S2S)).rejects.not.toThrow(/insufficient balance/i);
  });
});

describe('ManagedSonioxSession: 409 conflict — retry once using the backend’s retryAfterMs', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits exactly the backend-supplied retryAfterMs and then succeeds', async () => {
    const fetchMock = mockFetchSequence(
      { status: 409, body: { error: 'Another session is already active', retryAfterMs: 7000 } },
      { status: 200, body: speechToSpeechResponse() },
    );
    const events: Array<{ type: string; data: any }> = [];
    const session = newSession((type, data) => events.push({ type, data }));
    const acquiring = session.acquire(SPEAKER_S2S);

    await vi.advanceTimersByTimeAsync(6999);
    expect(callsTo(fetchMock, '/soniox/session-key')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await acquiring;
    expect(callsTo(fetchMock, '/soniox/session-key')).toHaveLength(2);
    expect(session.leaseId).toBe('lease-abc-123');
    // The debug timeline keeps its 409 milestone now that the client no longer
    // owns the exchange.
    expect(events.find((e) => e.type === 'session.retry')?.data).toMatchObject({ status: 409, retryAfterMs: 7000 });
  });

  it('falls back to a default wait only when retryAfterMs is missing from the body', async () => {
    const fetchMock = mockFetchSequence(
      { status: 409, body: { error: 'Another session is already active' } },
      { status: 200, body: speechToSpeechResponse() },
    );
    const acquiring = newSession().acquire(SPEAKER_S2S);
    await vi.advanceTimersByTimeAsync(3000);
    await acquiring;
    expect(callsTo(fetchMock, '/soniox/session-key')).toHaveLength(2);
  });

  it('retries exactly once — a conflict on the retry itself rejects', async () => {
    const fetchMock = mockFetchSequence(
      { status: 409, body: { error: 'Another session is already active', retryAfterMs: 100 } },
      { status: 409, body: { error: 'Another session is already active', retryAfterMs: 100 } },
    );
    const acquiring = newSession().acquire(SPEAKER_S2S);
    const assertion = expect(acquiring).rejects.toThrow(/already running|already active/i);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(callsTo(fetchMock, '/soniox/session-key')).toHaveLength(2);
  });
});

describe('ManagedSonioxSession: lifecycle notifications (fire-and-forget)', () => {
  it('markStarted POSTs /soniox/session-started with the leaseId and the role', async () => {
    const fetchMock = mockFetchOnce(200, speechToSpeechResponse());
    const session = newSession();
    await session.acquire(SPEAKER_S2S);
    session.markStarted('spk_stt');

    const [, init] = callsTo(fetchMock, '/soniox/session-started')[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SESSION_TOKEN}`);
    // The deployed handler reads body.leaseId and ignores every other field
    // (sokuji-backend routes/soniox.ts sessionStartedHandler), so shipping the
    // role now is safe and is exactly what BE5 starts reading.
    expect(JSON.parse(init.body as string)).toEqual({ leaseId: 'lease-abc-123', role: 'spk_stt' });
  });

  it('end POSTs /soniox/session-end exactly once with the leaseId', async () => {
    const fetchMock = mockFetchOnce(200, speechToSpeechResponse());
    const session = newSession();
    await session.acquire(SPEAKER_S2S);
    session.end();
    session.end(); // teardown can run twice; the backend must not see two hints

    expect(callsTo(fetchMock, '/soniox/session-end')).toHaveLength(1);
    const [, init] = callsTo(fetchMock, '/soniox/session-end')[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ leaseId: 'lease-abc-123' });
  });

  it('markStarted and end are no-ops when no lease was ever acquired', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const session = newSession();
    session.markStarted('spk_stt');
    session.end();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ManagedSonioxSession: noteStreamAccepted — the observation that earns a started bit', () => {
  /**
   * A leg's client reports "Soniox accepted my stream" on EVERY frame it
   * receives, because a frame is the only proof there is (SonioxSttStream routes
   * anything with `error_code` to `onError` instead). Deciding what that
   * observation is worth belongs here, with the lease: the first report per role
   * becomes a `session-started`, and the hundreds that follow are the same fact
   * restated. `markStarted` is itself idempotent server-side (the mask is ORed
   * and the expiry MAX()-ed), so this dedupe is about not flooding the backend
   * at ~8 requests a second, not about correctness of the mask.
   */
  const startedBodies = (fetchMock: ReturnType<typeof vi.fn>) =>
    callsTo(fetchMock, '/soniox/session-started')
      .map(([, init]) => JSON.parse((init as RequestInit).body as string));

  it('turns the first report for a role into one session-started, and the rest into nothing', async () => {
    const fetchMock = mockFetchOnce(200, speechToSpeechResponse());
    const session = newSession();
    await session.acquire(SPEAKER_S2S);

    session.noteStreamAccepted('spk_stt');
    session.noteStreamAccepted('spk_stt');
    session.noteStreamAccepted('spk_stt');

    expect(startedBodies(fetchMock)).toEqual([{ leaseId: 'lease-abc-123', role: 'spk_stt' }]);
  });

  it('reports each leg of a split lease separately — one bit per stream', async () => {
    const fetchMock = mockFetchOnce(200, splitBothResponse());
    const session = newSession();
    await session.acquire({ mode: 'both', textOnly: false, bothSplit: true });

    session.noteStreamAccepted('spk_stt');
    session.noteStreamAccepted('par_stt');
    session.noteStreamAccepted('spk_stt');

    expect(startedBodies(fetchMock)).toEqual([
      { leaseId: 'lease-split-1', role: 'spk_stt' },
      { leaseId: 'lease-split-1', role: 'par_stt' },
    ]);
  });

  it('is a no-op when no lease was ever acquired', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    newSession().noteStreamAccepted('spk_stt');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ManagedSonioxSession: the session allowance countdown', () => {
  it('has no snapshot before acquire and carries the response’s numbers after it', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const session = newSession();
    expect(session.getBudgetSnapshot()).toBeNull();

    const before = Date.now();
    await session.acquire(SPEAKER_S2S);
    const info = session.getBudgetSnapshot();
    expect(info).not.toBeNull();
    expect(info!.budgetMicroUsd).toBe(500_000);
    expect(info!.rateUsdPerHour).toBe(0.6);
    expect(info!.startedAtMs).toBeGreaterThanOrEqual(before);
  });

  it('fires the exhaustion handler exactly once, and honours a handler registered AFTER acquire', async () => {
    mockFetchOnce(200, { ...speechToSpeechResponse(), budgetMicroUsd: 1, rateUsdPerHour: 3600 });
    const session = newSession();
    await session.acquire(SPEAKER_S2S);

    // Late binding matters: SonioxClient registers at connect() time, which is
    // strictly after MainPanel has acquired the session.
    const onExhausted = vi.fn();
    session.setExhaustedHandler(onExhausted);

    session.tick(Date.now() + 5_000);
    session.tick(Date.now() + 10_000);
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it('setExhaustedHandler(null) stops the announcement', async () => {
    mockFetchOnce(200, { ...speechToSpeechResponse(), budgetMicroUsd: 1, rateUsdPerHour: 3600 });
    const session = newSession();
    await session.acquire(SPEAKER_S2S);
    const onExhausted = vi.fn();
    session.setExhaustedHandler(onExhausted);
    session.setExhaustedHandler(null);

    session.tick(Date.now() + 5_000);
    expect(onExhausted).not.toHaveBeenCalled();
  });
});
