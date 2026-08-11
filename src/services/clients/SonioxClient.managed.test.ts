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
  return new SonioxClient(session.credentialsFor(session.primarySttRole), { session });
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
    stt.handlers.onTick?.(); // → handleBudgetExhausted() → stt.end()
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

    stt.handlers.onError?.('403', 'session duration exceeded');

    expect(errors).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(client.getConversationItems()).toHaveLength(0);
  });

  it('emits the segment-ended notice itself on the close that follows', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    const closeEvents: any[] = [];
    client.setEventHandlers({ onClose: (e) => closeEvents.push(e) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

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

describe('SonioxClient: exactly one leg announces the session-level outcome', () => {
  /**
   * Split Both runs two clients off one session, and the session holds ONE
   * exhaustion handler with last-registration-wins semantics. The participant
   * leg connects second, so without an owner it would take the announcement —
   * putting the balance notice in the wrong panel, ending the wrong stream, and
   * (if it registered and then failed to connect) leaving the handler pointing
   * at a client MainPanel has already dropped, so exhaustion would announce
   * nothing at all.
   */
  async function twoLegSession() {
    const session = new ManagedSonioxSession({ sessionToken: SESSION_TOKEN });
    await session.acquire({ mode: 'both', textOnly: true, bothSplit: true });
    return session;
  }

  it('a non-announcing leg does not register, so the announcing leg keeps the outcome', async () => {
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
