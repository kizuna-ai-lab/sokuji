import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SonioxClient } from './SonioxClient';
import { ManagedSonioxSession, byokCredentials } from './ManagedSonioxSession';
import { SonioxSessionConfig } from '../interfaces/IClient';
import type { SonioxSttMessage, SonioxSttStreamHandlers, SonioxSttConfig } from './SonioxSttStream';
import type { SonioxTtsOptions, SonioxTtsStreamHandlers } from './SonioxTtsStream';

// --- Mock both wire components; capture instances for driving/inspecting the client ---
// (same style as SonioxClient.test.ts)
const sttInstances: MockStt[] = [];
class MockStt {
  handlers: SonioxSttStreamHandlers = {};
  config: SonioxSttConfig | null = null;
  ended = false;
  closed = false;
  constructor() { sttInstances.push(this); }
  setHandlers(h: SonioxSttStreamHandlers) { this.handlers = h; }
  connect(config: SonioxSttConfig) { this.config = config; return Promise.resolve(); }
  sendAudio() {}
  finalize() {}
  end() { this.ended = true; }
  close() { this.closed = true; }
  isOpen() { return !this.closed; }
  emit(msg: SonioxSttMessage) { this.handlers.onMessage?.(msg); }
}

const ttsInstances: MockTts[] = [];
class MockTts {
  handlers: SonioxTtsStreamHandlers = {};
  options: SonioxTtsOptions;
  closed = false;
  constructor(options: SonioxTtsOptions) { this.options = options; ttsInstances.push(this); }
  setHandlers(h: SonioxTtsStreamHandlers) { this.handlers = h; }
  connect() { return Promise.resolve(); }
  prewarm() {}
  sendText() {}
  endUtterance() {}
  close() { this.closed = true; }
  isOpen() { return !this.closed; }
}

// vi.fn() implementations must be `function`/`class` (not arrow functions) to be
// usable as constructors under vitest v4 — see https://vitest.dev/api/vi#vi-spyon.
vi.mock('./SonioxSttStream', () => ({ SonioxSttStream: vi.fn(function () { return new MockStt(); }) }));
vi.mock('./SonioxTtsStream', () => ({ SonioxTtsStream: vi.fn(function (o: SonioxTtsOptions) { return new MockTts(o); }) }));

const BASE_CONFIG: SonioxSessionConfig = {
  provider: 'soniox',
  model: 'stt-rt-v5',
  voice: 'Maya',
  sourceLanguage: 'zh',
  targetLanguage: 'en',
  bidirectional: false,
  textOnly: false,
};

// i18n-derived copy is matched loosely (house convention, see the TTS-degraded
// assertions below) — the point is which SENTENCE the user gets, not its exact
// punctuation.
const OUTAGE = /the connection was interrupted/i;
const SEGMENT_ENDED = /this segment has ended/i;
const BALANCE_USED_UP = /balance is used up/i;

const SESSION_TOKEN = 'better-auth-session-token-abc';

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
    // backend bound to the temporary key(s); the tests below assert THIS
    // exact value (not leaseId) reaches Soniox.
    clientReferenceId: 'sokuji1:acct-1:lease-abc-123',
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
 * The new construction shape: MainPanel acquires the session, then hands the
 * client the bundle for its role. Consumes whatever `mockFetch*` the test
 * installed, exactly as the client's own connect() used to.
 */
async function managedClient(textOnly = false) {
  const session = new ManagedSonioxSession({ sessionToken: SESSION_TOKEN });
  await session.acquire({ mode: 'speaker', textOnly, bothSplit: false });
  // `sttRole` is how this client names its own leg when it reports that Soniox
  // accepted the stream — MainPanel passes the same value it took the bundle
  // with (see managedSonioxArgFor).
  return new SonioxClient(session.credentialsFor(session.primarySttRole), {
    session,
    sttRole: session.primarySttRole,
  });
}

/**
 * Move the clock to the end of the 900 s grant `speechToSpeechResponse()` hands
 * out.
 *
 * Soniox only sends the granted-duration 403 when the grant is actually up, and
 * the client now checks that before reading a bare 403 as the cutoff — a
 * revoked key and a frozen wallet arrive as the identical frame. Must be called
 * AFTER acquire(), which is what latches the grant's start.
 */
function advanceToGrantEnd() {
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 900_000);
}

beforeEach(() => {
  sttInstances.length = 0;
  ttsInstances.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SonioxClient managed mode: key routing (never leaks the session token to Soniox)', () => {
  it('the STT config frame carries api_key === sttApiKey — never the better-auth session token', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });

    const stt = sttInstances.at(-1)!;
    expect(stt.config!.apiKey).toBe('soniox-stt-temp-key');
    expect(stt.config!.apiKey).not.toBe(SESSION_TOKEN);
  });

  it('the TTS stream is constructed with ttsApiKey, not sttApiKey', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });

    const tts = ttsInstances.at(-1)!;
    expect(tts.options.apiKey).toBe('soniox-tts-temp-key');
    expect(tts.options.apiKey).not.toBe('soniox-stt-temp-key');
  });

  it('both the STT and TTS streams receive the same client_reference_id', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });

    const stt = sttInstances.at(-1)!;
    const tts = ttsInstances.at(-1)!;
    expect(stt.config!.clientReferenceId).toBeTruthy();
    expect(stt.config!.clientReferenceId).toBe(tts.options.clientReferenceId);
  });

  it('both sockets send the backend-issued clientReferenceId verbatim — not leaseId, and not two different values', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });

    const stt = sttInstances.at(-1)!;
    const tts = ttsInstances.at(-1)!;
    // The exact string the backend computed and bound to the temporary keys —
    // not the bare leaseId, which the reconciler's parseClientRefId rejects.
    expect(stt.config!.clientReferenceId).toBe('sokuji1:acct-1:lease-abc-123');
    expect(tts.options.clientReferenceId).toBe('sokuji1:acct-1:lease-abc-123');
    expect(stt.config!.clientReferenceId).not.toBe('lease-abc-123');
    expect(tts.options.clientReferenceId).not.toBe('lease-abc-123');
  });
});

describe('SonioxClient managed mode: session lifecycle notifications (fire-and-forget)', () => {
  // The two tests that used to live here — "POSTs /soniox/session-started once
  // the socket is open" and "POSTs /soniox/session-end on disconnect" — moved
  // to ManagedSonioxSession.test.ts's own lifecycle describe. They asserted the
  // CLIENT drives the lease, which is exactly what this task removes; the
  // replacement contract ("SonioxClient sends no lease lifecycle traffic of its
  // own", at the bottom of this file) is their direct negation.
  it('BYOK disconnect never calls fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new SonioxClient(byokCredentials('byok-key'));
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    await client.disconnect();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('SonioxClient managed mode: cost meter wiring', () => {
  it('ticks the meter off the STT stream\'s existing keepalive interval, not a second timer', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;
    // The client wires an onTick handler onto the SAME SonioxSttStream
    // instance's handlers — there is no independent setInterval to observe,
    // so the handler's presence IS the "reuses the existing timer" contract.
    expect(stt.handlers.onTick).toBeInstanceOf(Function);
  });

  it('when the budget is exhausted, ends the STT stream gracefully (empty-frame end(), not close()) and surfaces a distinct error', async () => {
    mockFetchOnce(200, { ...speechToSpeechResponse(), budgetMicroUsd: 1, rateUsdPerHour: 3600 });
    const client = await managedClient();
    const errors: Array<{ code?: string; message?: string }> = [];
    client.setEventHandlers({ onError: (e) => errors.push(e) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    // Drive the meter's clock via the same tick hook the keepalive interval
    // would call. Force real elapsed time forward first — costMeter.start()
    // latched Date.now() at fetch time, and 3600 usd/hr for any measurable
    // elapsed time vastly exceeds the 1 µUSD budget.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
    stt.handlers.onTick?.();

    expect(stt.ended).toBe(true);   // graceful: the protocol's empty-text-frame end-of-stream
    expect(stt.closed).toBe(false); // NOT torn down abruptly via close()
    expect(errors.some((e) => e.code === 'budget_exhausted')).toBe(true);
  });

  // Regression: the test above stops at stt.end() and never simulates the
  // close that always follows it in production (the server flushes and
  // closes after receiving the empty-text-frame end-of-stream). That close
  // used to land in handleSttClose's bare-close fallthrough with no
  // announced outcome on record, which fired a SECOND, WRONG notice — the
  // generic "connection was interrupted" outage text — on top of the real
  // reason, and that wrong notice was the only item left standing (it was
  // emitted after, and thus overwrote nothing, but the balance message was
  // never itself an item to begin with — only onError, which is transient
  // local UI state MainPanel's teardown wipes). Drive the full sequence so
  // this cannot regress silently again.
  it('the full sequence — tick to exhaustion, end(), then the close that follows — ends with exactly one item, the balance message, not the outage notice', async () => {
    mockFetchOnce(200, { ...speechToSpeechResponse(), budgetMicroUsd: 1, rateUsdPerHour: 3600 });
    const client = await managedClient();
    const errors: Array<{ code?: string; message?: string }> = [];
    const closeEvents: any[] = [];
    client.setEventHandlers({ onError: (e) => errors.push(e), onClose: (e) => closeEvents.push(e) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
    stt.handlers.onTick?.(); // → session.finishSession('budget_exhausted') → stt.end()
    expect(stt.ended).toBe(true);

    // The close the server sends after flushing a graceful end() — exactly
    // what handleSttClose's bare-close fallthrough would otherwise treat as
    // an unannounced outage.
    stt.handlers.onClose?.({ code: 1000, reason: '' });

    const items = client.getConversationItems();
    expect(items).toHaveLength(1);
    expect(items[0].formatted?.text).toMatch(BALANCE_USED_UP);
    expect(items[0].formatted?.text).not.toMatch(OUTAGE);
    // onError still fires for analytics (api_error), same as before — and the
    // message it carries is localized, so a stable English original rides
    // along for the analytics side.
    expect(errors.some((e) => e.code === 'budget_exhausted')).toBe(true);
    expect(errors[0].rawMessage).toBe('Session budget exhausted');
    // No false session.connection_lost / second onError from the fallthrough.
    expect(errors).toHaveLength(1);
    expect(closeEvents).toHaveLength(1);
  });
});

describe('SonioxClient BYOK mode is unaffected', () => {
  it('the single-argument constructor still works and never calls fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new SonioxClient(byokCredentials('byok-key'));
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    expect(fetchMock).not.toHaveBeenCalled();
    const stt = sttInstances.at(-1)!;
    expect(stt.config!.apiKey).toBe('byok-key');
    expect(stt.config!.clientReferenceId).toBeUndefined();
  });
});

describe('SonioxClient managed mode: getManagedBudgetInfo', () => {
  it('is null before connect() but non-null as soon as the session is acquired', async () => {
    // The stub is needed now that the helper acquires a real session: the
    // allowance belongs to the SESSION, so the exchange has to happen.
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    // The allowance now belongs to the SESSION, which acquire() already
    // started, so the snapshot exists before any socket does.
    expect(client.getManagedBudgetInfo()).not.toBeNull();
  });

  it('is null for BYOK sessions even after connect() (no cost meter)', async () => {
    const client = new SonioxClient(byokCredentials('byok-key'));
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    expect(client.getManagedBudgetInfo()).toBeNull();
  });

  it('returns the session\'s budget/rate/start snapshot once connected', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    // BEFORE the acquire, not after it: the cost meter latches Date.now() inside
    // acquire(), so capturing the bound afterwards only passed while both calls
    // landed in the same millisecond — a ~1-in-N flake, observed failing by 1ms.
    const before = Date.now();
    const client = await managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });

    const info = client.getManagedBudgetInfo();
    expect(info).not.toBeNull();
    expect(info!.budgetMicroUsd).toBe(500_000);
    expect(info!.rateUsdPerHour).toBe(0.6);
    expect(info!.startedAtMs).toBeGreaterThanOrEqual(before);
  });

  it('survives reset() — the allowance belongs to the session, which outlives a client reset', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    expect(client.getManagedBudgetInfo()).not.toBeNull();

    // reset() runs at the TOP of connect() and must never clear the injected
    // bundle or session — they are readonly constructor fields.
    client.reset();
    expect(client.getManagedBudgetInfo()).not.toBeNull();
    expect(client.getManagedBudgetInfo()!.budgetMicroUsd).toBe(500_000);
  });
});

describe('SonioxClient managed mode: session-duration cutoff (403 error frame + close 1000)', () => {
  it('a managed-session 403 wire error does not push a generic error bubble or call onError', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    const errors: any[] = [];
    const updates: any[] = [];
    client.setEventHandlers({ onError: (e) => errors.push(e), onConversationUpdated: (d) => updates.push(d) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    // Soniox sends this 403 when the grant is up, and the client now checks
    // that before believing it — see 'a managed 403 far from the granted
    // duration is NOT read as the cutoff'.
    advanceToGrantEnd();
    stt.handlers.onError?.('403', 'session duration exceeded');

    expect(errors).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(client.getConversationItems()).toHaveLength(0);
  });

  it('emits the segment-ended notice on the close that follows — one leg, so this leg says it', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    const closeEvents: any[] = [];
    client.setEventHandlers({ onClose: (e) => closeEvents.push(e) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    advanceToGrantEnd();
    stt.handlers.onError?.('403', 'session duration exceeded');
    stt.handlers.onClose?.({ code: 1000, reason: '' });

    expect(closeEvents).toHaveLength(1);
    expect(closeEvents[0].code).toBe(1000);
    // No provider-specific field on the close: the notice is a normal item,
    // so it survives MainPanel's setItems(getConversationItems()) teardown.
    expect(closeEvents[0].sonioxDurationCutoff).toBeUndefined();
    const items = client.getConversationItems();
    expect(items).toHaveLength(1);
    expect(items[0].role).toBe('system');
    expect(items[0].formatted?.text).toMatch(SEGMENT_ENDED);
    // MainPanel sorts rendered items by `a.createdAt || 0` (MainPanel.tsx);
    // an item missing this field sorts to the very top of the transcript
    // instead of appearing where it actually happened.
    expect(items[0].createdAt).toBeGreaterThan(0);
  });

  it('a close with no preceding 403 reports a lost connection, not a cutoff', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    const closeEvents: any[] = [];
    client.setEventHandlers({ onClose: (e) => closeEvents.push(e) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    stt.handlers.onClose?.({ code: 1000, reason: '' });

    expect(closeEvents).toHaveLength(1);
    expect(client.getConversationItems().at(-1)!.formatted?.text).toMatch(OUTAGE);
  });

  it('BYOK: a mid-session 403 still surfaces as a normal error — BYOK has no granted duration', async () => {
    const client = new SonioxClient(byokCredentials('byok-key'));
    const errors: any[] = [];
    client.setEventHandlers({ onError: (e) => errors.push(e) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    stt.handlers.onError?.('403', 'invalid api key');

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('403');
  });

  it('the pending-cutoff flag does not leak into an unrelated close from a later session', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    // At the grant end, so the 403 really does set the flag this test is about.
    advanceToGrantEnd();
    sttInstances.at(-1)!.handlers.onError?.('403', 'session duration exceeded');

    // A fresh connect() calls reset() before anything else, which must clear
    // the flag set by the previous session's 403.
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;
    stt.handlers.onClose?.({ code: 1000, reason: '' });

    // A lost connection, not a second "segment ended".
    const text = client.getConversationItems().at(-1)!.formatted?.text;
    expect(text).toMatch(OUTAGE);
    expect(text).not.toMatch(SEGMENT_ENDED);
  });
});

describe('SonioxClient managed recoverable outages', () => {
  it('a managed 503 shows a localized notice, not the raw wire text', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    const errors: any[] = [];
    client.setEventHandlers({ onError: (e) => errors.push(e) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    stt.handlers.onError?.('503', 'service unavailable');

    const items = client.getConversationItems();
    expect(items).toHaveLength(1);
    expect(items[0].role).toBe('system');
    expect(items[0].type).toBe('error');
    expect(items[0].formatted?.text).toMatch(OUTAGE);
    expect(items[0].formatted?.text).not.toMatch(/^\[Soniox/);
    // onError still fires (api_error analytics) and carries the same words.
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('503');
    expect(errors[0].message).toMatch(OUTAGE);
    // ...but analytics must not be fed the localized sentence, or the same
    // failure arrives as one of 30 translations. The server's own words ride
    // along separately (buildApiErrorProps prefers them).
    expect(errors[0].rawMessage).toBe('service unavailable');
  });

  it('keeps the raw server text in the debug timeline', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    const events: any[] = [];
    client.setEventHandlers({ onRealtimeEvent: (e: any) => events.push(e.event) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    stt.handlers.onError?.('503', 'service unavailable');

    const lost = events.find((e) => e.type === 'session.connection_lost');
    expect(lost).toBeDefined();
    expect(lost.data).toMatchObject({ code: '503', message: 'service unavailable' });
  });
});

describe('SonioxClient sends no lease lifecycle traffic of its own', () => {
  it('a full managed connect/disconnect cycle POSTs nothing beyond the session’s own acquire', async () => {
    const fetchMock = mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    const callsAfterAcquire = fetchMock.mock.calls.length; // just the session-key exchange

    await client.connect({ ...BASE_CONFIG, textOnly: false });
    await client.disconnect();

    // The whole point of decision 7: session-started and session-end are
    // SESSION facts. MainPanel drives them; a stream must not. With two legs,
    // a client-driven session-end would fire on the first teardown while the
    // other leg was still streaming.
    expect(fetchMock.mock.calls).toHaveLength(callsAfterAcquire);
    expect(fetchMock.mock.calls.filter(([u]) => (u as string).includes('/soniox/session-started'))).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([u]) => (u as string).includes('/soniox/session-end'))).toHaveLength(0);
  });

  it('exhaustion still reaches the user through the client, driven by the session’s meter', async () => {
    mockFetchOnce(200, { ...speechToSpeechResponse(), budgetMicroUsd: 1, rateUsdPerHour: 3600 });
    const client = await managedClient();
    const errors: Array<{ code?: string }> = [];
    client.setEventHandlers({ onError: (e) => errors.push(e) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    // The tick is forwarded from the stream's keepalive to the SESSION now;
    // the handler's presence on the stream is still the "no second timer"
    // contract.
    expect(stt.handlers.onTick).toBeInstanceOf(Function);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
    stt.handlers.onTick?.();

    expect(stt.ended).toBe(true);
    expect(errors.some((e) => e.code === 'budget_exhausted')).toBe(true);
    expect(client.getConversationItems().at(-1)!.formatted?.text).toMatch(BALANCE_USED_UP);
  });
});

describe('SonioxClient: a leg is reported started only when Soniox ACCEPTS its stream', () => {
  /**
   * `SonioxSttStream.connect()` resolves inside `ws.onopen`, right after the
   * config frame is sent and BEFORE Soniox has looked at `api_key` — the same
   * fact `handleSttError`'s managed-503 gate already turns on ("connect()
   * resolves pre-validation"). A socket that opened is therefore not a stream
   * that ran: the participant key's start window can have lapsed while the user
   * sat on the OS screen-recording dialog, and the rejection arrives as an
   * error frame AFTER the open.
   *
   * That distinction is the lease's whole release rule. `markStarted` ORs this
   * leg's bit into `stt_started_mask` AND pushes `expires_at` out to the full
   * granted duration; the backend releases only when
   * `(ended & started) = started` (session-lease.ts `noteStreamEnded` /
   * `releaseSatisfiedOrExpired`), and ended bits come exclusively from Soniox
   * usage logs. A rejected stream produces no usage log, so a bit set for it can
   * never clear and the account 409s every subsequent Start for up to an hour.
   *
   * The first frame that reaches `onMessage` IS the proof: SonioxSttStream
   * routes anything carrying `error_code` to `onError` and returns, so a frame
   * the client sees got past authentication.
   */
  const startedBodies = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls
      .filter(([url]) => (url as string).includes('/soniox/session-started'))
      .map(([, init]) => JSON.parse((init as RequestInit).body as string));

  it('a socket that merely OPENED reports nothing — connect() resolves pre-validation', async () => {
    const fetchMock = mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    expect(startedBodies(fetchMock)).toEqual([]);
  });

  it('the first accepted frame reports THIS leg started, naming its own role', async () => {
    const fetchMock = mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });

    sttInstances.at(-1)!.emit({ tokens: [], final_audio_proc_ms: 0, total_audio_proc_ms: 1080 });

    // Even the empty inter-token frame Soniox emits while it processes audio is
    // proof — the point is that the server answered at all, not what it said.
    expect(startedBodies(fetchMock)).toEqual([{ leaseId: 'lease-abc-123', role: 'spk_stt' }]);
  });

  it('a stream Soniox REJECTS after the socket opened is never reported started', async () => {
    // The concrete trigger: a participant key whose start window lapsed behind
    // the OS permission dialog. The socket opens (there is no auth in the URL),
    // connect() resolves, and only then does the rejection arrive.
    const fetchMock = mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });

    const stt = sttInstances.at(-1)!;
    stt.handlers.onError?.('401', 'Invalid or expired temporary API key');
    stt.handlers.onClose?.({ code: 1008, reason: 'unauthorized' });

    expect(startedBodies(fetchMock)).toEqual([]);
  });

  it('reports once, not once per frame — a live stream delivers hundreds', async () => {
    const fetchMock = mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });

    const stt = sttInstances.at(-1)!;
    stt.emit({ tokens: [] });
    stt.emit({ tokens: [{ text: 'hello', is_final: true, translation_status: 'original' }] });
    stt.emit({ tokens: [], finished: true });

    expect(startedBodies(fetchMock)).toHaveLength(1);
  });

  it('each leg of a split session reports its OWN role, and only for the leg that was accepted', async () => {
    // The role must be this leg's own: on a two-stream lease the backend
    // answers 400 `role_required` for a roleless body and `role_not_issued`
    // for the other leg's role, and in both cases the lease is NOT extended.
    const fetchMock = mockFetchOnce(200, {
      ...speechToSpeechResponse(),
      leaseId: 'lease-split-1',
      streams: [
        { role: 'spk_stt', apiKey: 'k-spk', clientReferenceId: 'sokuji1:a:lease-split-1:spk_stt', expiresAt: 'x' },
        { role: 'par_stt', apiKey: 'k-par', clientReferenceId: 'sokuji1:a:lease-split-1:par_stt', expiresAt: 'x' },
      ],
    });
    const session = new ManagedSonioxSession({ sessionToken: SESSION_TOKEN });
    await session.acquire({ mode: 'both', textOnly: true, bothSplit: true });

    const speaker = new SonioxClient(session.credentialsFor('spk_stt'), { session, sttRole: 'spk_stt' });
    const participant = new SonioxClient(session.credentialsFor('par_stt'), {
      session,
      sttRole: 'par_stt',
      announcesSessionOutcome: false,
    });
    await speaker.connect({ ...BASE_CONFIG, textOnly: true });
    const speakerStt = sttInstances.at(-1)!;
    await participant.connect({ ...BASE_CONFIG, textOnly: true });
    const participantStt = sttInstances.at(-1)!;

    speakerStt.emit({ tokens: [] });
    expect(startedBodies(fetchMock)).toEqual([{ leaseId: 'lease-split-1', role: 'spk_stt' }]);

    // The participant leg's own key is rejected: its bit must stay clear, so
    // the lease is satisfied by the speaker alone rather than waiting forever.
    participantStt.handlers.onError?.('401', 'Invalid or expired temporary API key');
    expect(startedBodies(fetchMock)).toEqual([{ leaseId: 'lease-split-1', role: 'spk_stt' }]);

    participantStt.emit({ tokens: [] });
    expect(startedBodies(fetchMock)).toEqual([
      { leaseId: 'lease-split-1', role: 'spk_stt' },
      { leaseId: 'lease-split-1', role: 'par_stt' },
    ]);
  });

  it('BYOK reports nothing — there is no lease to extend', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new SonioxClient(byokCredentials('byok-key'));
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    sttInstances.at(-1)!.emit({ tokens: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('SonioxClient: exactly one leg announces the session-level outcome', () => {
  /**
   * Split Both runs two clients off one session. BOTH register as legs — the
   * session has to be able to end them both — but exactly one of them says the
   * sentence, and it must be the speaker: MainPanel's teardown renders
   * `speakerClientRef.current?.getConversationItems()`, so a balance notice
   * emitted on the participant leg is not merely misplaced, it is never shown.
   */
  async function twoLegSession() {
    const session = new ManagedSonioxSession({ sessionToken: SESSION_TOKEN });
    await session.acquire({ mode: 'both', textOnly: true, bothSplit: true });
    return session;
  }

  it('a non-announcing leg never takes the outcome, however it connects', async () => {
    mockFetchOnce(200, {
      ...speechToSpeechResponse(),
      budgetMicroUsd: 1,
      rateUsdPerHour: 3600,
      streams: [
        { role: 'spk_stt', apiKey: 'k-spk', clientReferenceId: 'sokuji1:a:l:spk_stt', expiresAt: 'x' },
        { role: 'par_stt', apiKey: 'k-par', clientReferenceId: 'sokuji1:a:l:par_stt', expiresAt: 'x' },
      ],
    });
    const session = await twoLegSession();

    const speaker = new SonioxClient(session.credentialsFor('spk_stt'), { session });
    const participant = new SonioxClient(session.credentialsFor('par_stt'), {
      session,
      announcesSessionOutcome: false,
    });
    const speakerErrors: Array<{ code?: string }> = [];
    const participantErrors: Array<{ code?: string }> = [];
    speaker.setEventHandlers({ onError: (e) => speakerErrors.push(e) });
    participant.setEventHandlers({ onError: (e) => participantErrors.push(e) });

    await speaker.connect({ ...BASE_CONFIG, textOnly: true });
    // Second, exactly as MainPanel connects them.
    await participant.connect({ ...BASE_CONFIG, textOnly: true });

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
    session.tick(Date.now());

    expect(speakerErrors.some((e) => e.code === 'budget_exhausted')).toBe(true);
    expect(participantErrors).toHaveLength(0);
  });

  it('a non-announcing leg’s disconnect does not disarm the announcer', async () => {
    // The participant can die mid-session while the speaker keeps streaming.
    // Clearing a handler it never set would silently leave the rest of that
    // session with no exhaustion announcement at all.
    mockFetchOnce(200, {
      ...speechToSpeechResponse(),
      budgetMicroUsd: 1,
      rateUsdPerHour: 3600,
      streams: [
        { role: 'spk_stt', apiKey: 'k-spk', clientReferenceId: 'sokuji1:a:l:spk_stt', expiresAt: 'x' },
        { role: 'par_stt', apiKey: 'k-par', clientReferenceId: 'sokuji1:a:l:par_stt', expiresAt: 'x' },
      ],
    });
    const session = await twoLegSession();

    const speaker = new SonioxClient(session.credentialsFor('spk_stt'), { session });
    const participant = new SonioxClient(session.credentialsFor('par_stt'), {
      session,
      announcesSessionOutcome: false,
    });
    const speakerErrors: Array<{ code?: string }> = [];
    speaker.setEventHandlers({ onError: (e) => speakerErrors.push(e) });
    await speaker.connect({ ...BASE_CONFIG, textOnly: true });
    await participant.connect({ ...BASE_CONFIG, textOnly: true });

    await participant.disconnect();

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
    session.tick(Date.now());
    expect(speakerErrors.some((e) => e.code === 'budget_exhausted')).toBe(true);
  });
});

describe('SonioxClient as a session leg: session-level endings are announced exactly once', () => {
  /**
   * Split Both runs TWO SonioxClients off ONE lease, and therefore off one
   * `max_session_duration_seconds`. Both legs take the cutoff 403 within the
   * same second, and before this the "segment ended" notice was emitted by
   * whichever leg's close arrived — twice under split, and on the participant
   * leg (whose conversation items MainPanel never renders) if it won the race.
   *
   * The session owns the sentence now. These tests drive the real
   * ManagedSonioxSession, because the routing is the whole behaviour: a fake
   * session would only re-assert the client's half of it.
   */
  const splitResponse = (overrides: Record<string, unknown> = {}) => ({
    ...speechToSpeechResponse(),
    leaseId: 'lease-split-1',
    streams: [
      { role: 'spk_stt', apiKey: 'k-spk', clientReferenceId: 'sokuji1:a:lease-split-1:spk_stt', expiresAt: 'x' },
      { role: 'par_stt', apiKey: 'k-par', clientReferenceId: 'sokuji1:a:lease-split-1:par_stt', expiresAt: 'x' },
    ],
    ...overrides,
  });

  /** The two legs MainPanel builds for a managed split Both session, connected
   *  in the order it connects them (speaker first, participant second). */
  async function splitLegs(overrides: Record<string, unknown> = {}) {
    mockFetchOnce(200, splitResponse(overrides));
    const session = new ManagedSonioxSession({ sessionToken: SESSION_TOKEN });
    await session.acquire({ mode: 'both', textOnly: true, bothSplit: true });

    const speaker = new SonioxClient(session.credentialsFor('spk_stt'), {
      session,
      sttRole: 'spk_stt',
    });
    const participant = new SonioxClient(session.credentialsFor('par_stt'), {
      session,
      sttRole: 'par_stt',
      // The bit MainPanel's managedSonioxArgFor computes: the participant's
      // items are never rendered, so it must not be the one that speaks.
      announcesSessionOutcome: false,
    });
    await speaker.connect({ ...BASE_CONFIG, textOnly: true });
    const speakerStt = sttInstances.at(-1)!;
    await participant.connect({ ...BASE_CONFIG, textOnly: true });
    const participantStt = sttInstances.at(-1)!;
    return { session, speaker, participant, speakerStt, participantStt };
  }

  it('both legs 403ing in the same second produce ONE notice, on the speaker', async () => {
    const { speaker, participant, speakerStt, participantStt } = await splitLegs();
    advanceToGrantEnd();

    // Both keys share one granted duration, so both closes arrive together.
    speakerStt.handlers.onError?.('403', 'session duration exceeded');
    speakerStt.handlers.onClose?.({ code: 1000, reason: '' });
    participantStt.handlers.onError?.('403', 'session duration exceeded');
    participantStt.handlers.onClose?.({ code: 1000, reason: '' });

    const speakerItems = speaker.getConversationItems();
    expect(speakerItems).toHaveLength(1);
    expect(speakerItems[0].formatted?.text).toMatch(SEGMENT_ENDED);
    // Not merely "not twice on the speaker": the participant's list is never
    // rendered, so a notice here is invisible rather than duplicated.
    expect(participant.getConversationItems()).toHaveLength(0);
  });

  it('the leg that did NOT notice is still ended gracefully', async () => {
    const { speakerStt, participantStt } = await splitLegs();
    advanceToGrantEnd();

    // Only the participant's 403 arrives; the speaker's socket is still open.
    participantStt.handlers.onError?.('403', 'session duration exceeded');
    participantStt.handlers.onClose?.({ code: 1000, reason: '' });

    // Graceful empty-text-frame end-of-stream on BOTH, not an abrupt close —
    // before this the speaker would have kept streaming (and billing) until
    // its own 403 arrived.
    expect(participantStt.ended).toBe(true);
    expect(speakerStt.ended).toBe(true);
    expect(speakerStt.closed).toBe(false);
  });

  it('the ended leg\'s own close cannot layer an outage notice on top of the real reason', async () => {
    const { speaker, participant, speakerStt, participantStt } = await splitLegs();
    advanceToGrantEnd();

    participantStt.handlers.onError?.('403', 'session duration exceeded');
    participantStt.handlers.onClose?.({ code: 1000, reason: '' });
    // The close the server sends after the graceful end() the session just
    // triggered on the speaker. With no outcome on record it would reach
    // handleSttClose's bare-close fallthrough and say "the connection was
    // interrupted" — contradicting "this segment has ended".
    speakerStt.handlers.onClose?.({ code: 1000, reason: '' });

    const texts = speaker.getConversationItems().map((i) => i.formatted?.text ?? '');
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(SEGMENT_ENDED);
    expect(texts.some((t) => OUTAGE.test(t))).toBe(false);
    expect(participant.getConversationItems()).toHaveLength(0);
  });

  it('keeps emitting session.duration_cutoff once PER LEG — two 403s is the expected shape', async () => {
    const { speaker, participant, speakerStt, participantStt } = await splitLegs();
    advanceToGrantEnd();
    // Per-leg telemetry is deliberately NOT deduped: both keys really did take
    // a 403, and collapsing them would hide a leg dying alone.
    const events: Array<{ type: string }> = [];
    speaker.setEventHandlers({ onRealtimeEvent: (e: any) => events.push(e.event) });
    participant.setEventHandlers({ onRealtimeEvent: (e: any) => events.push(e.event) });

    speakerStt.handlers.onError?.('403', 'session duration exceeded');
    speakerStt.handlers.onClose?.({ code: 1000, reason: '' });
    participantStt.handlers.onError?.('403', 'session duration exceeded');
    participantStt.handlers.onClose?.({ code: 1000, reason: '' });

    expect(events.filter((e) => e.type === 'session.duration_cutoff')).toHaveLength(2);
  });

  it('exhaustion ends the participant leg too — it would otherwise stream on an empty balance', async () => {
    const { speaker, participant, speakerStt, participantStt } =
      await splitLegs({ budgetMicroUsd: 1, rateUsdPerHour: 3600 });
    const speakerErrors: Array<{ code?: string }> = [];
    const participantErrors: Array<{ code?: string }> = [];
    speaker.setEventHandlers({ onError: (e) => speakerErrors.push(e) });
    participant.setEventHandlers({ onError: (e) => participantErrors.push(e) });

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
    // Either leg's keepalive may be the one that trips the meter.
    participantStt.handlers.onTick?.();

    expect(speakerErrors.some((e) => e.code === 'budget_exhausted')).toBe(true);
    expect(participantErrors).toHaveLength(0);
    expect(speaker.getConversationItems().at(-1)!.formatted?.text).toMatch(BALANCE_USED_UP);
    expect(participant.getConversationItems()).toHaveLength(0);
    expect(speakerStt.ended).toBe(true);
    expect(participantStt.ended).toBe(true);
  });

  it('announceSessionOutcome pushes an item that SURVIVES MainPanel’s setItems overwrite', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    const errors: any[] = [];
    const events: any[] = [];
    client.setEventHandlers({ onError: (e) => errors.push(e), onRealtimeEvent: (e: any) => events.push(e.event) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });

    client.announceSessionOutcome({
      text: 'Your session balance is used up.',
      realtimeEvent: 'session.budget_exhausted',
      analytics: { code: 'budget_exhausted', rawMessage: 'Session budget exhausted' },
    });

    // MainPanel's teardown is literally this: setItems(client.getConversationItems()).
    // An item held only in React state would not be in this array.
    const rendered = client.getConversationItems();
    expect(rendered).toHaveLength(1);
    expect(rendered[0].role).toBe('system');
    expect(rendered[0].formatted?.text).toMatch(BALANCE_USED_UP);
    expect(rendered[0].createdAt).toBeGreaterThan(0);
    expect(errors).toEqual([
      { code: 'budget_exhausted', message: 'Your session balance is used up.', rawMessage: 'Session budget exhausted' },
    ]);
    expect(events.some((e) => e.type === 'session.budget_exhausted')).toBe(true);
  });

  it('announceSessionOutcome without analytics stays out of the api_error channel', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    const errors: any[] = [];
    client.setEventHandlers({ onError: (e) => errors.push(e) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });

    // The cutoff's notice shape: a normal end-of-segment is not an error, and
    // routing it to onError would drown the api_error dashboard in non-errors.
    client.announceSessionOutcome({ text: 'This segment has ended.' });

    expect(client.getConversationItems()).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });

  it('endForSessionOutcome ends the stream gracefully, once, and suppresses the outage notice', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    client.endForSessionOutcome();
    client.endForSessionOutcome(); // the second leg's 403 re-enters finishSession

    expect(stt.ended).toBe(true);   // protocol's empty-text-frame end-of-stream
    expect(stt.closed).toBe(false); // not torn down abruptly

    // The close that always follows a graceful end() must NOT add
    // "the connection was interrupted" on top of the session's real reason.
    stt.handlers.onClose?.({ code: 1000, reason: '' });
    expect(client.getConversationItems()).toHaveLength(0);
  });

  it('a managed 403 far from the granted duration is NOT read as the cutoff', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    const errors: any[] = [];
    client.setEventHandlers({ onError: (e) => errors.push(e) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    // A revoked key or a frozen wallet looks exactly like the cutoff on the
    // wire. At t=0 of a 15-minute grant it is not the cutoff. No clock
    // advance: the session was acquired moments ago.
    stt.handlers.onError?.('403', 'forbidden');
    stt.handlers.onClose?.({ code: 1006, reason: '' });

    const text = client.getConversationItems().at(-1)!.formatted?.text;
    // Deliberately the SAME treatment BYOK gives a mid-session 403: the raw
    // server words, and onError under a groupable code. Not "this segment has
    // ended", which would tell a user whose key just died to tap Start; and
    // not the recoverable-outage sentence either, which says "tap Start
    // Session in a moment to continue" and invites the identical refused
    // retry — the very thing the margin exists to stop.
    expect(text).not.toMatch(SEGMENT_ENDED);
    expect(text).not.toMatch(OUTAGE);
    expect(text).toMatch(/forbidden/);
    expect(errors.some((e) => e.code === '403')).toBe(true);
  });

  it('a disconnected leg is detached, so the session neither announces on it nor ends it again', async () => {
    const { session, speaker, participant, participantStt } =
      await splitLegs({ budgetMicroUsd: 1, rateUsdPerHour: 3600 });
    const speakerErrors: Array<{ code?: string }> = [];
    speaker.setEventHandlers({ onError: (e) => speakerErrors.push(e) });

    await participant.disconnect();
    participantStt.ended = false; // disconnect()'s own end() is not the one under test

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
    session.tick(Date.now());

    // The speaker still announces — a leg standing down must not disarm it.
    expect(speakerErrors.some((e) => e.code === 'budget_exhausted')).toBe(true);
    expect(participantStt.ended).toBe(false);
  });
});
