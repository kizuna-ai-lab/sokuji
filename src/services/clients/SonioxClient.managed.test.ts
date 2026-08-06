import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SonioxClient } from './SonioxClient';
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
 * first and second /soniox/session-key attempts must differ). Once the queue
 * is drained, further calls (e.g. the fire-and-forget /soniox/session-started
 * notification after a retry that succeeds) get a generic 200 — those calls
 * are not under test and must not throw from an unconfigured mock.
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

function sessionKeyCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => (url as string).includes('/soniox/session-key'));
}

function managedClient() {
  return new SonioxClient('', { managed: { sessionToken: SESSION_TOKEN } });
}

beforeEach(() => {
  sttInstances.length = 0;
  ttsInstances.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SonioxClient managed mode: session-key exchange', () => {
  it('POSTs /soniox/session-key with the better-auth session token in Authorization and mode: speech_to_speech for a non-text-only session', async () => {
    const fetchMock = mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });

    // First call is the session-key exchange itself; connect() also fires a
    // fire-and-forget session-started notification once the socket is up —
    // this test only cares about the session-key call.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/soniox/session-key');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'speech_to_speech' });
  });

  it('sends mode: text_only when the session config has textOnly: true', async () => {
    const fetchMock = mockFetchOnce(200, textOnlyResponse());
    const client = managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'text_only' });
  });
});

describe('SonioxClient managed mode: key routing (never leaks the session token to Soniox)', () => {
  it('the STT config frame carries api_key === sttApiKey — never the better-auth session token', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });

    const stt = sttInstances.at(-1)!;
    expect(stt.config!.apiKey).toBe('soniox-stt-temp-key');
    expect(stt.config!.apiKey).not.toBe(SESSION_TOKEN);
  });

  it('the TTS stream is constructed with ttsApiKey, not sttApiKey', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });

    const tts = ttsInstances.at(-1)!;
    expect(tts.options.apiKey).toBe('soniox-tts-temp-key');
    expect(tts.options.apiKey).not.toBe('soniox-stt-temp-key');
  });

  it('both the STT and TTS streams receive the same client_reference_id', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });

    const stt = sttInstances.at(-1)!;
    const tts = ttsInstances.at(-1)!;
    expect(stt.config!.clientReferenceId).toBeTruthy();
    expect(stt.config!.clientReferenceId).toBe(tts.options.clientReferenceId);
  });

  it('both sockets send the backend-issued clientReferenceId verbatim — not leaseId, and not two different values', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
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

describe('SonioxClient managed mode: missing clientReferenceId is a backend contract break', () => {
  it('rejects connect() rather than falling back to leaseId when clientReferenceId is absent from the response', async () => {
    const response = speechToSpeechResponse() as Record<string, unknown>;
    delete response.clientReferenceId;
    mockFetchOnce(200, response);
    const client = managedClient();

    await expect(client.connect({ ...BASE_CONFIG, textOnly: false })).rejects.toThrow(/clientReferenceId/);
    // No socket should have been opened with the known-to-be-rejected leaseId.
    expect(sttInstances).toHaveLength(0);
  });
});

describe('SonioxClient managed mode: session-key failures', () => {
  it('a 402 response rejects connect() with a message distinguishing insufficient balance from other failures', async () => {
    mockFetchOnce(402, { error: 'Insufficient balance' });
    const client = managedClient();
    await expect(client.connect({ ...BASE_CONFIG, textOnly: false })).rejects.toThrow(/insufficient balance/i);
  });

  it('a 503 (capacity) failure does NOT read as insufficient balance', async () => {
    mockFetchOnce(503, { error: 'Soniox capacity is temporarily full' });
    const client = managedClient();
    await expect(client.connect({ ...BASE_CONFIG, textOnly: false })).rejects.not.toThrow(/insufficient balance/i);
  });

  it('a 403 (frozen wallet) failure does NOT read as insufficient balance', async () => {
    mockFetchOnce(403, { error: 'Wallet is frozen' });
    const client = managedClient();
    await expect(client.connect({ ...BASE_CONFIG, textOnly: false })).rejects.not.toThrow(/insufficient balance/i);
  });

  it('never opens an STT stream when the session-key exchange fails', async () => {
    mockFetchOnce(402, { error: 'Insufficient balance' });
    const client = managedClient();
    await expect(client.connect({ ...BASE_CONFIG, textOnly: false })).rejects.toThrow();
    expect(sttInstances).toHaveLength(0);
  });
});

describe('SonioxClient managed mode: session lifecycle notifications (fire-and-forget)', () => {
  it('POSTs /soniox/session-started with the leaseId once the socket is open', async () => {
    const fetchMock = mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });

    const startedCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('/soniox/session-started'));
    expect(startedCall).toBeDefined();
    const [, init] = startedCall as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({ leaseId: 'lease-abc-123' });
  });

  it('POSTs /soniox/session-end with the leaseId on disconnect', async () => {
    const fetchMock = mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    await client.disconnect();

    const endCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('/soniox/session-end'));
    expect(endCall).toBeDefined();
    const [, init] = endCall as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ leaseId: 'lease-abc-123' });
  });

  it('BYOK disconnect never calls fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new SonioxClient('byok-key');
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    await client.disconnect();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('SonioxClient managed mode: cost meter wiring', () => {
  it('ticks the meter off the STT stream\'s existing keepalive interval, not a second timer', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;
    // The client wires an onTick handler onto the SAME SonioxSttStream
    // instance's handlers — there is no independent setInterval to observe,
    // so the handler's presence IS the "reuses the existing timer" contract.
    expect(stt.handlers.onTick).toBeInstanceOf(Function);
  });

  it('when the budget is exhausted, ends the STT stream gracefully (empty-frame end(), not close()) and surfaces a distinct error', async () => {
    mockFetchOnce(200, { ...speechToSpeechResponse(), budgetMicroUsd: 1, rateUsdPerHour: 3600 });
    const client = managedClient();
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
});

describe('SonioxClient BYOK mode is unaffected', () => {
  it('the single-argument constructor still works and never calls fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new SonioxClient('byok-key');
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    expect(fetchMock).not.toHaveBeenCalled();
    const stt = sttInstances.at(-1)!;
    expect(stt.config!.apiKey).toBe('byok-key');
    expect(stt.config!.clientReferenceId).toBeUndefined();
  });
});

describe('SonioxClient managed mode: 409 conflict — retry once using the backend\'s retryAfterMs', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries once and succeeds transparently when the second attempt is issued', async () => {
    const fetchMock = mockFetchSequence(
      { status: 409, body: { error: 'Another session is already active', retryAfterMs: 2500 } },
      { status: 200, body: speechToSpeechResponse() },
    );
    const client = managedClient();
    const connectPromise = client.connect({ ...BASE_CONFIG, textOnly: false });
    await vi.advanceTimersByTimeAsync(2500);
    await connectPromise;

    expect(client.isConnected()).toBe(true);
    expect(sessionKeyCalls(fetchMock)).toHaveLength(2);
  });

  it('waits exactly the backend-supplied retryAfterMs — not a fixed guess', async () => {
    const fetchMock = mockFetchSequence(
      { status: 409, body: { error: 'Another session is already active', retryAfterMs: 7000 } },
      { status: 200, body: speechToSpeechResponse() },
    );
    const client = managedClient();
    const connectPromise = client.connect({ ...BASE_CONFIG, textOnly: false });

    await vi.advanceTimersByTimeAsync(6999);
    expect(sessionKeyCalls(fetchMock)).toHaveLength(1); // retry has not fired yet

    await vi.advanceTimersByTimeAsync(1);
    await connectPromise;
    expect(sessionKeyCalls(fetchMock)).toHaveLength(2);
  });

  it('falls back to a default wait only when retryAfterMs is missing from the body', async () => {
    const fetchMock = mockFetchSequence(
      { status: 409, body: { error: 'Another session is already active' } }, // no retryAfterMs
      { status: 200, body: speechToSpeechResponse() },
    );
    const client = managedClient();
    const connectPromise = client.connect({ ...BASE_CONFIG, textOnly: false });
    await vi.advanceTimersByTimeAsync(3000);
    await connectPromise;

    expect(client.isConnected()).toBe(true);
    expect(sessionKeyCalls(fetchMock)).toHaveLength(2);
  });

  it('retries exactly once — a conflict on the retry itself rejects rather than retrying again', async () => {
    const fetchMock = mockFetchSequence(
      { status: 409, body: { error: 'Another session is already active', retryAfterMs: 100 } },
      { status: 409, body: { error: 'Another session is already active', retryAfterMs: 100 } },
    );
    const client = managedClient();
    const connectPromise = client.connect({ ...BASE_CONFIG, textOnly: false });
    const assertion = expect(connectPromise).rejects.toThrow(/already running|already active/i);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;

    expect(sessionKeyCalls(fetchMock)).toHaveLength(2);
    expect(sttInstances).toHaveLength(0); // never opened a socket on the failed path
  });
});

describe('SonioxClient managed mode: getManagedBudgetInfo', () => {
  it('is null before connect()', () => {
    const client = managedClient();
    expect(client.getManagedBudgetInfo()).toBeNull();
  });

  it('is null for BYOK sessions even after connect() (no cost meter)', async () => {
    const client = new SonioxClient('byok-key');
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    expect(client.getManagedBudgetInfo()).toBeNull();
  });

  it('returns the session\'s budget/rate/start snapshot once connected', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    const before = Date.now();
    await client.connect({ ...BASE_CONFIG, textOnly: false });

    const info = client.getManagedBudgetInfo();
    expect(info).not.toBeNull();
    expect(info!.budgetMicroUsd).toBe(500_000);
    expect(info!.rateUsdPerHour).toBe(0.6);
    expect(info!.startedAtMs).toBeGreaterThanOrEqual(before);
  });

  it('is cleared back to null once reset() runs (the next connect())', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    expect(client.getManagedBudgetInfo()).not.toBeNull();

    client.reset();
    expect(client.getManagedBudgetInfo()).toBeNull();
  });
});

describe('SonioxClient managed mode: session-duration cutoff (403 error frame + close 1000)', () => {
  it('a managed-session 403 wire error does not push a generic error bubble or call onError', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
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
    const client = managedClient();
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
  });

  it('a close with no preceding 403 reports a lost connection, not a cutoff', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    const closeEvents: any[] = [];
    client.setEventHandlers({ onClose: (e) => closeEvents.push(e) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    stt.handlers.onClose?.({ code: 1000, reason: '' });

    expect(closeEvents).toHaveLength(1);
    expect(client.getConversationItems().at(-1)!.formatted?.text).toMatch(OUTAGE);
  });

  it('BYOK: a mid-session 403 still surfaces as a normal error — BYOK has no granted duration', async () => {
    const client = new SonioxClient('byok-key');
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
    const client = managedClient();
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
    const client = managedClient();
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
  });

  it('keeps the raw server text in the debug timeline', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
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
