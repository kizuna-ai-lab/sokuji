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
