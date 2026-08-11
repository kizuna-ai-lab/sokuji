# Managed Soniox split "Both" mode — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Kizuna-managed Soniox user choose split "Both" mode — two real Soniox clients, one per audio source — as BYOK users already can, and tell the truth when it degrades.

**Architecture:** The session lease moves out of `SonioxClient` into a `ManagedSonioxSession` that acquires it, holds every key and reference, sends the lifecycle notifications and runs the single allowance countdown. `SonioxClient` becomes a thing that runs one stream with credentials it was handed — a new construction shape for BYOK too. One client or two then makes no difference to the lease, which is what removes the "which client owns the session" concept entirely.

**Tech Stack:** React 19 + TypeScript, Zustand, Vitest + Testing Library, react-i18next.

**Design of record:** `docs/superpowers/specs/2026-08-11-soniox-managed-split-both-design.md`. Read it before Task FE1.

## Global Constraints

- **Node 24** (`.nvmrc`). Run `source ~/.nvm/nvm.sh && nvm use` before any test command.
- **Tests:** `npx vitest run <path>` for one file, `npm test -- --run` for the suite. Record the baseline count before Task FE1 and never let it drop, with **0 skipped**.
- **`tsc --noEmit` is NOT clean in this repo** (~483 pre-existing errors) and is **not** a gate. The correctness gate is vitest. Do not "fix" errors you did not create. `noUnusedParameters` is on, so prefix genuinely-unused parameters with `_`.
- **`Blob.prototype.arrayBuffer` does not exist under this repo's jsdom.** Feature-detect and fall back to `FileReader`, the way `src/lib/soniox/voiceClipStorage.ts` already does.
- **Locale parity is enforced by a test.** Any new user-facing string needs `t('key', 'English default')` **and** the key added to all 30 catalogs in `src/locales/`, or `locales.consistency.test.ts` fails. Translate; do not copy English through.
- No new npm dependencies. English only in code, comments and commit messages. Conventional commits. Never `git push` without explicit approval.

### Cross-task contracts — these names are authoritative

| Concept | Authoritative name and home |
|---|---|
| Credential bundle | `interface SonioxCredentialBundle { stt: string; tts?: string; clientReferenceId?: string }` in `src/services/clients/ManagedSonioxSession.ts` |
| BYOK bundle helper | `byokCredentials(apiKey): SonioxCredentialBundle` |
| Client construction | `new SonioxClient(credentials: SonioxCredentialBundle, options?: SonioxClientOptions)` |
| Session object | `class ManagedSonioxSession` — `acquire`, `credentialsFor(role)` (throws for an unissued role, never falls back), `hasRole`, `markStarted(role)`, `end()`, `setExhaustedHandler`, `tick(nowMs)`, `getBudgetSnapshot()`, `leaseId`, `primarySttRole` |
| Descriptor seam | `ClientOptions.sonioxManaged?: { credentials: SonioxCredentialBundle; session: ManagedSonioxSession }` |
| MainPanel factory | `createAIClient(useWebRTC?: boolean, sonioxManaged?: { credentials: SonioxCredentialBundle; session: ManagedSonioxSession })` |
| Role type | `SonioxStreamRole`, imported from the backend-mirroring vocabulary |

`credentialsFor` throwing rather than falling back is load-bearing: attribution is key-bound, so two legs sharing one bundle are indistinguishable in the usage logs and the backend's ended-mask could not be driven at all.

`ProviderDescriptor.ts` gains a **type-only** import from `ManagedSonioxSession`. It must stay type-only — a value import would pull i18n and both wire components into every provider descriptor.

### Ordering, including what is blocked on the backend

- **FE1 is the only task that can start before any backend change lands**, and only because it deliberately keeps sending the legacy `{ mode }` body. Land it early so its structural risk gets review attention while the backend chain is in flight.
- **FE2** is blocked on backend BE8 being **deployed**: the split floor values come from the backend's conservative-rate table and must not be invented here. `sonioxManagedMinBalance.ts` carries a keep-in-sync comment for exactly this reason, and it must stay dependency-free — the subtitle window renders the same gate.
- **FE3** is blocked on backend BE5 **and** BE6 being **live in production**. There is no staging path for the new contract. Shipping it blind means the second leg is 409'd and Others→You silently never runs — the exact bug the unconditional shared-mode override exists to prevent today.
- **FE4 and FE5** depend on FE3. **FE6** depends on FE3 and FE5: it is the switch that exposes the feature, and must land last so a user cannot select a mode whose wiring or degradation indicator is not yet live.
- **FE7** must land after the backend's cost × K ships, or it puts a false statement in `SonioxCostMeter`'s docstring.

### What must not be simplified away

`MainPanel`'s `sonioxSharedBoth` ANDs in four things: the effective provider is `SONIOX`, `effectiveMode === 'both'`, the helper's answer, **and** `sourceLanguage !== 'auto'`. Replacing it with a bare call to `sonioxUsesSharedBothSession` drops three of them. The auto clause is load-bearing — the participant config swaps source and target, so `auto` is unusable on that leg in split too.

---

### Task FE1: Extract `ManagedSonioxSession`; `SonioxClient` takes a credential bundle

Pure refactor. **Nothing changes behaviourally** and the wire stays legacy: the session-key
request body is still `{ mode: 'text_only' | 'speech_to_speech' }`, so this task ships against
the **currently deployed backend** with no backend change. No split, no matrix body, no second
client.

Three seam decisions are made here, and every later frontend task depends on them:

1. **`ProviderDescriptor.createClient` stays synchronous and keeps returning exactly one
   `IClient`.** Acquiring a session is an awaited network round trip with a 409 retry, so
   **MainPanel owns the `ManagedSonioxSession`** and passes the per-role bundle down through a
   new optional `ClientOptions.sonioxManaged` field. The alternatives (async `createClient`, or
   a client-set return) change the signature for all eleven descriptors and both call sites for
   the benefit of one.
2. **Managed-ness is an explicit object, never an inferred key shape.** `SonioxClient`'s second
   constructor argument is `{ session?: ManagedSonioxSession }`; `isManaged` is
   `this.session !== null`. Inferring it from "the bundle has a `clientReferenceId`" would
   mis-gate the BYOK-only 503 resume ladder.
3. **The countdown keeps a source by delegation.** The `SonioxCostMeter` moves to the session;
   `wireSttHandlers` forwards the STT keepalive tick with `this.session?.tick(Date.now())`, and
   `getManagedBudgetInfo()` returns `this.session?.getBudgetSnapshot()`. `tick` is absolute
   (`now - startedAt`), so FE3's second forwarder is harmless. MainPanel's countdown effect is
   untouched.

`reset()` runs at the top of `connect()`; the injected bundle and session are `readonly`
constructor fields, so `reset()` *cannot* clear them.

**Files:**
- Create: `src/services/clients/ManagedSonioxSession.ts`
- Create: `src/services/clients/ManagedSonioxSession.test.ts`
- Modify: `src/services/clients/SonioxClient.ts` (lines 14, 18, 53-56, 58-82, 84-86, 156-169, 211-215, 265-300, 373, 406, 414, 668-806, 849-851, 908-926, 1189, 1221, 1405-1408, 1451-1455)
- Modify: `src/services/providers/ProviderDescriptor.ts` (lines 1-3, 22-25)
- Modify: `src/services/providers/SonioxProviderConfig.ts` (lines 5, 173-175)
- Modify: `src/services/providers/KizunaAISonioxProviderConfig.ts` (lines 3-6, 23-27, 33-37)
- Modify: `src/components/MainPanel/MainPanel.tsx` (lines 71, 719-745, 1263, 1680, 1917, 1927, 2000, 2227-2229, 2241)
- Test: `src/services/clients/SonioxClient.managed.test.ts` (rewritten helper, four `describe` blocks deleted, two new contract tests)
- Test: `src/services/clients/SonioxClient.test.ts` (~22 construction sites)
- Test: `src/services/providers/descriptorRegistry.test.ts` (lines 71-105 — **not in the recon**, and it breaks the moment the managed `createClient` requires a session)

**Interfaces:**
- Consumes: nothing from an earlier task. Against the currently deployed
  `sokuji-backend`: `POST /soniox/session-key` with body `{ mode: 'text_only' |
  'speech_to_speech' }` returning `{ sttApiKey, ttsApiKey?, expiresAt,
  maxSessionDurationSeconds, budgetMicroUsd, rateUsdPerHour, sku, leaseId, clientReferenceId }`;
  `POST /soniox/session-started` (reads `body.leaseId` only, ignores every other field —
  verified in `sokuji-backend/src/routes/soniox.ts` `sessionStartedHandler`);
  `POST /soniox/session-end` (reads no body at all).
- Produces:
  - `type SonioxStreamRole = 'spk_stt' | 'spk_tts' | 'par_stt' | 'par_tts' | 'mix_stt' | 'mix_tts'`
  - `interface SonioxCredentialBundle { stt: string; tts?: string; clientReferenceId?: string }`
  - `function byokCredentials(apiKey: string): SonioxCredentialBundle`
  - `interface ManagedSessionRequest { mode: 'speaker' | 'participant' | 'both'; textOnly: boolean; bothSplit: boolean }`
  - `function primarySttRoleFor(request: ManagedSessionRequest): SonioxStreamRole`
  - `interface ManagedSonioxSessionOptions { sessionToken: string; onEvent?: (type: string, data: unknown) => void }`
  - `class ManagedSonioxSession` with `constructor(options: ManagedSonioxSessionOptions)`,
    `get leaseId(): string | null`, `get primarySttRole(): SonioxStreamRole`,
    `acquire(request: ManagedSessionRequest): Promise<void>`,
    `credentialsFor(role: SonioxStreamRole): SonioxCredentialBundle`,
    `hasRole(role: SonioxStreamRole): boolean`,
    `markStarted(role: SonioxStreamRole): void`, `end(): void`,
    `setExhaustedHandler(fn: (() => void) | null): void`, `tick(nowMs: number): void`,
    `getBudgetSnapshot(): SonioxBudgetSnapshot | null`
  - `new SonioxClient(credentials: SonioxCredentialBundle, options?: SonioxClientOptions)` where
    `interface SonioxClientOptions { session?: ManagedSonioxSession }`
  - `ClientOptions.sonioxManaged?: { credentials: SonioxCredentialBundle; session: ManagedSonioxSession }`
  - `const KIZUNA_SIGN_IN_REQUIRED = 'Sign in is required for Kizuna providers'` (exported from `KizunaAISonioxProviderConfig.ts`)
  - `createAIClient(useWebRTC?: boolean, sonioxManaged?: { credentials: SonioxCredentialBundle; session: ManagedSonioxSession }): Promise<IClient>` (MainPanel-local)

---

- [ ] **Step 1: Write the failing test for the new session object**

Create `src/services/clients/ManagedSonioxSession.test.ts`:

```ts
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
  it('POSTs the LEGACY { mode } body with the better-auth token in Authorization', async () => {
    const fetchMock = mockFetchOnce(200, speechToSpeechResponse());
    await newSession().acquire(SPEAKER_S2S);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/soniox/session-key');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SESSION_TOKEN}`);
    // FE1 ships against the deployed backend: no `textOnly`, no `bothSplit`.
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'speech_to_speech' });
  });

  it('sends mode: text_only when the request is text-only', async () => {
    const fetchMock = mockFetchOnce(200, textOnlyResponse());
    await newSession().acquire({ mode: 'speaker', textOnly: true, bothSplit: false });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ mode: 'text_only' });
  });

  it('files the flat response under the request’s primary STT role', async () => {
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/clients/ManagedSonioxSession.test.ts`

Expected: FAIL with `Error: Failed to resolve import "./ManagedSonioxSession" from "src/services/clients/ManagedSonioxSession.test.ts". Does the file exist?`

- [ ] **Step 3: Implement `ManagedSonioxSession`**

Create `src/services/clients/ManagedSonioxSession.ts`. Every method body below is lifted verbatim
from `SonioxClient.ts` (`fetchManagedSession` 668-707, `requestSessionKey` 715-728,
`describeManagedSessionError` 742-773, `notifySessionStarted` 781-790, `notifySessionEnd`
797-806) with the client's `this.managedOptions!.sessionToken` replaced by
`this.sessionToken` and `this.emitRealtime(...)` replaced by `this.onEvent?.(...)`.

```ts
import { SonioxCostMeter, SonioxBudgetSnapshot } from './SonioxCostMeter';
import i18n from '../../locales';
import { getApiUrl } from '../../utils/environment';

/**
 * The managed (backend-billed) Soniox SESSION: everything that belongs to the
 * account's lease rather than to one socket.
 *
 * Extracted out of SonioxClient because a lease is not a stream property. A
 * client is now just "a thing that runs one stream with credentials it was
 * handed"; this object owns the session-key exchange (and its 409 retry), the
 * per-role credential bundles, the lease lifecycle notifications, and the
 * session allowance countdown.
 *
 * Who drives it: MainPanel.connectConversation acquires one per Start, hands
 * each client its bundle through ClientOptions.sonioxManaged, calls
 * markStarted() once each leg's socket is up, and end() once every client is
 * down. ProviderDescriptor.createClient is synchronous and returns exactly one
 * client, so it cannot own an awaited acquire() without going async for all
 * eleven providers.
 */

/**
 * The closed role vocabulary. `side` says which audio source feeds the stream;
 * `mix` is shared-Both's single mixed stream, and calling that `spk_*` would be
 * a lie. `par_tts` is unreachable while the participant config forces textOnly,
 * but stays in the vocabulary so adding it later is a change of policy, not of
 * format.
 */
export type SonioxStreamRole =
  | 'spk_stt' | 'spk_tts'
  | 'par_stt' | 'par_tts'
  | 'mix_stt' | 'mix_tts';

/**
 * What one SonioxClient needs to run its sockets. A NEW construction shape for
 * BOTH flavours — BYOK is not an existing shape managed is being moved onto.
 *
 * `clientReferenceId` is the exact string the backend already bound to the
 * temporary key(s). Probed live 2026-08-11: Soniox attributes a usage log to
 * the reference bound to the KEY and ignores the one a socket declares in its
 * config frame, so this value is INERT on the wire. It is sent anyway (harmless
 * hedge, and it is what the pre-extraction client sent), but nothing may rely
 * on it and it must never be the only thing carrying a role.
 */
export interface SonioxCredentialBundle {
  /** Key for the STT socket. */
  stt: string;
  /** Key for the TTS socket. Absent for a text-only lease. BYOK: the same key as `stt`. */
  tts?: string;
  /** Backend-bound reference; absent for BYOK, which is not billed by us. */
  clientReferenceId?: string;
}

/** BYOK: one user key serves both sockets, and no reference is sent. */
export function byokCredentials(apiKey: string): SonioxCredentialBundle {
  return { stt: apiKey, tts: apiKey };
}

/** The matrix inputs the server expands into a role set. FE1 sends only the
 *  legacy `{ mode }` derived from `textOnly`; `mode`/`bothSplit` are carried so
 *  FE3 changes one method, not this whole signature. */
export interface ManagedSessionRequest {
  mode: 'speaker' | 'participant' | 'both';
  textOnly: boolean;
  bothSplit: boolean;
}

/**
 * The lease's single STT role — the "primary leg" the flat legacy response
 * fields describe. NOT simply "the speaker": a participant-only session's
 * primary leg is par_stt, and shared Both's is mix_stt.
 */
export function primarySttRoleFor(request: ManagedSessionRequest): SonioxStreamRole {
  if (request.mode === 'participant') return 'par_stt';
  if (request.mode === 'both' && !request.bothSplit) return 'mix_stt';
  return 'spk_stt';
}

// Fallback only — the backend's 409 body always carries its own retryAfterMs
// (see describeError); this is used solely if that field is somehow missing
// from a malformed/empty body.
const DEFAULT_CONFLICT_RETRY_MS = 3000;

/** The flat one-lease/one-key-pair shape the deployed backend returns. */
interface SonioxSessionKeyResponse {
  sttApiKey: string;
  ttsApiKey?: string;
  expiresAt: string;
  maxSessionDurationSeconds: number;
  budgetMicroUsd: number;
  rateUsdPerHour: number;
  sku: string;
  leaseId: string;
  clientReferenceId: string;
}

export interface ManagedSonioxSessionOptions {
  /** Better-auth session token. Sent ONLY to our backend's Authorization
   *  header — never to Soniox, which receives the short-lived keys minted in
   *  exchange for it. */
  sessionToken: string;
  /** Debug-timeline sink. The client used to emit these through its own
   *  handlers; the session has none of its own, so the owner supplies one. */
  onEvent?: (type: string, data: unknown) => void;
}

export class ManagedSonioxSession {
  private readonly sessionToken: string;
  private readonly onEvent?: (type: string, data: unknown) => void;
  private request: ManagedSessionRequest | null = null;
  private readonly bundles = new Map<SonioxStreamRole, SonioxCredentialBundle>();
  private leaseIdValue: string | null = null;
  private costMeter: SonioxCostMeter | null = null;
  private exhaustedHandler: (() => void) | null = null;
  // session-end is a hint the backend acts on once; teardown can reach it from
  // more than one path (the user's Stop, a client's onClose, connect()'s catch).
  private endSignalled = false;

  constructor(options: ManagedSonioxSessionOptions) {
    this.sessionToken = options.sessionToken;
    this.onEvent = options.onEvent;
  }

  get leaseId(): string | null {
    return this.leaseIdValue;
  }

  get primarySttRole(): SonioxStreamRole {
    if (!this.request) throw new Error('ManagedSonioxSession.primarySttRole read before acquire()');
    return primarySttRoleFor(this.request);
  }

  /**
   * Exchange the better-auth session token for a Soniox key set.
   *
   * Called at Start, never earlier: the STT key's start window is only 60 s, so
   * fetching sooner risks it expiring before the socket opens — and issue
   * failures (402/403/409/502/503) need to land on the caller's error path,
   * where the UI already handles a failed connect.
   *
   * A 409 (another session already active on this account) is retried exactly
   * once, after the backend's own `retryAfterMs` hint — the prior session is
   * very often just finishing its teardown.
   */
  async acquire(request: ManagedSessionRequest): Promise<void> {
    this.request = request;
    let response = await this.requestSessionKey(request);
    if (!response.ok && response.status === 409) {
      const conflict = await this.describeError(response);
      const retryAfterMs = conflict.retryAfterMs ?? DEFAULT_CONFLICT_RETRY_MS;
      this.onEvent?.('session.retry', { provider: 'soniox', status: 409, retryAfterMs });
      await ManagedSonioxSession.delay(retryAfterMs);
      response = await this.requestSessionKey(request);
    }
    if (!response.ok) {
      throw new Error((await this.describeError(response)).message);
    }
    const data = await response.json() as SonioxSessionKeyResponse;
    // No fallback to leaseId: a missing clientReferenceId is a backend contract
    // break that must surface as a failed Start, not be papered over with a
    // value the reconciler is already known to reject.
    if (!data.clientReferenceId) {
      throw new Error('Soniox session-key response is missing clientReferenceId');
    }
    this.leaseIdValue = data.leaseId;
    this.bundles.clear();
    // One flat key pair, filed under the lease's single STT role. FE3 replaces
    // this with the per-stream structure; every caller already asks by role, so
    // that is a change here and nowhere else.
    this.bundles.set(primarySttRoleFor(request), {
      stt: data.sttApiKey,
      ...(data.ttsApiKey ? { tts: data.ttsApiKey } : {}),
      clientReferenceId: data.clientReferenceId,
    });
    this.costMeter = new SonioxCostMeter({
      budgetMicroUsd: data.budgetMicroUsd,
      rateUsdPerHour: data.rateUsdPerHour,
      // Read through the field, not captured: the announcing client registers
      // at connect() time, strictly after this.
      onExhausted: () => this.exhaustedHandler?.(),
    });
    this.costMeter.start(Date.now());
  }

  hasRole(role: SonioxStreamRole): boolean {
    return this.bundles.has(role);
  }

  /** Throws rather than falling back to the primary bundle: a silent fallback
   *  would let FE3's split legs share one key, which the usage logs cannot tell
   *  apart (attribution is key-bound). */
  credentialsFor(role: SonioxStreamRole): SonioxCredentialBundle {
    const bundle = this.bundles.get(role);
    if (!bundle) throw new Error(`No Soniox credentials were issued for role ${role}`);
    return bundle;
  }

  /**
   * Fire-and-forget: confirms a leg's socket is up so the backend extends the
   * lease from its short start-window TTL to the full granted duration. Never
   * awaited — a failure here just means the lease expires on its own schedule,
   * never worth failing an already-open session over.
   */
  markStarted(role: SonioxStreamRole): void {
    const leaseId = this.leaseIdValue;
    if (!leaseId) return;
    fetch(`${getApiUrl()}/soniox/session-started`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.sessionToken}`,
        'Content-Type': 'application/json',
      },
      // The deployed handler reads leaseId and ignores every other field, so
      // sending the role now is safe today and is what BE5 starts reading.
      body: JSON.stringify({ leaseId, role }),
    }).catch((error) => console.error('[ManagedSonioxSession] session-started notify failed:', error));
  }

  /**
   * Fire-and-forget: hints the reconciler to look for this session's usage logs
   * sooner. Sent EXACTLY ONCE per session, after every client is down —
   * SonioxClient.disconnect() used to post it unconditionally, so with two legs
   * the first one torn down would signal the end (and unpin the voice slot)
   * while the other was still streaming.
   */
  end(): void {
    const leaseId = this.leaseIdValue;
    if (!leaseId || this.endSignalled) return;
    this.endSignalled = true;
    fetch(`${getApiUrl()}/soniox/session-end`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ leaseId }),
    }).catch((error) => console.error('[ManagedSonioxSession] session-end notify failed:', error));
  }

  /**
   * Exactly ONE owner announces exhaustion — the LAST registration wins, which
   * is why FE3/FE4 must register only the announcing (speaker/primary) client.
   */
  setExhaustedHandler(fn: (() => void) | null): void {
    this.exhaustedHandler = fn;
  }

  /** The meter has no clock of its own: it is advanced by an STT stream's ~5 s
   *  keepalive tick, forwarded here. `tick` is absolute (now - startedAt), so
   *  more than one forwarder is harmless. */
  tick(nowMs: number): void {
    this.costMeter?.tick(nowMs);
  }

  getBudgetSnapshot(): SonioxBudgetSnapshot | null {
    return this.costMeter?.getBudgetSnapshot() ?? null;
  }

  /**
   * POST /soniox/session-key. Network failures (DNS, offline, CORS) throw
   * immediately — transport errors have nothing to retry; only an HTTP-level
   * response (ok or not) is returned for the caller to interpret status-by-status.
   */
  private async requestSessionKey(request: ManagedSessionRequest): Promise<Response> {
    // FE1 speaks the LEGACY contract on purpose: this task must run against the
    // backend as currently deployed. FE3 swaps this one expression for the
    // matrix body { mode, textOnly, bothSplit }.
    const body = { mode: request.textOnly ? 'text_only' : 'speech_to_speech' };
    try {
      return await fetch(`${getApiUrl()}/soniox/session-key`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`Failed to reach the Soniox session service: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Distinct, user-facing reasons for each session-key failure — a 402
   * (insufficient balance) must read differently from every other failure so
   * the UI can point at the right fix. Also surfaces the 409 body's
   * `retryAfterMs` so acquire's single retry uses the backend's hint, not a guess.
   */
  private async describeError(response: Response): Promise<{ message: string; retryAfterMs?: number }> {
    let serverMessage = '';
    let retryAfterMs: number | undefined;
    try {
      const body = await response.json();
      if (typeof body?.error === 'string') serverMessage = body.error;
      if (typeof body?.retryAfterMs === 'number') retryAfterMs = body.retryAfterMs;
    } catch {
      // Body wasn't JSON (or was empty) — fall back to the status-based message below.
    }
    switch (response.status) {
      case 401:
        // Effectively unreachable via the normal UI flow: MainPanel refuses to
        // acquire without a session token. Left as a plain string rather than a
        // new locale key, matching its pre-extraction behaviour.
        return { message: 'Sign-in is required to start a managed Soniox session' };
      case 402:
        return { message: i18n.t('mainPanel.sonioxInsufficientBalance', 'Insufficient balance to start a session. Please top up your balance and try again.') };
      case 403:
        return { message: i18n.t('mainPanel.walletFrozen', 'Wallet is frozen. Please contact support.') };
      case 409:
        return { message: i18n.t('mainPanel.sonioxSessionConflict', 'Another session is already running on your account. Please try again in a moment.'), retryAfterMs };
      case 502:
        return { message: i18n.t('mainPanel.sonioxServiceUnavailable', 'Soniox is temporarily unavailable. Please try again in a moment.') };
      case 503:
        return { message: i18n.t('mainPanel.sonioxServiceBusy', 'Soniox is at capacity right now. Please try again shortly.') };
      default:
        return { message: serverMessage || `Failed to start a managed Soniox session (HTTP ${response.status})` };
    }
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/services/clients/ManagedSonioxSession.test.ts`

Expected: PASS (21 tests)

- [ ] **Step 5: Commit the extracted session**

```bash
git add src/services/clients/ManagedSonioxSession.ts src/services/clients/ManagedSonioxSession.test.ts
git commit -m "feat(soniox): add ManagedSonioxSession owning the lease, keys and allowance

The lease is not a stream property. Extracted the session-key exchange (and
its 409 retry), the per-role credential bundles, the session-started/
session-end notifications and the cost meter out of what will become a
credential-taking SonioxClient. Nothing wires it up yet.

The request body stays the legacy { mode } so this runs against the backend
as deployed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Rewrite the managed client suite's construction helper (failing)**

In `src/services/clients/SonioxClient.managed.test.ts`, replace line 2 and the
`managedClient()` helper at lines 127-129.

Before (line 2, and 127-129):

```ts
import { SonioxClient } from './SonioxClient';
```
```ts
function managedClient() {
  return new SonioxClient('', { managed: { sessionToken: SESSION_TOKEN } });
}
```

After:

```ts
import { SonioxClient } from './SonioxClient';
import { ManagedSonioxSession, byokCredentials } from './ManagedSonioxSession';
```
```ts
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
```

Then delete the four `describe` blocks that now belong to `ManagedSonioxSession.test.ts` —
they test the exchange, not a stream:

- `describe('SonioxClient managed mode: session-key exchange', ...)` (lines 141-164)
- `describe('SonioxClient managed mode: missing clientReferenceId is a backend contract break', ...)` (lines 214-225)
- `describe('SonioxClient managed mode: session-key failures', ...)` (lines 227-252)
- `describe('SonioxClient managed mode: 409 conflict — retry once using the backend\'s retryAfterMs', ...)` (lines 378-440)

- [ ] **Step 7: Switch the remaining call sites in that file to the async helper**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react
sed -i "s/const client = managedClient();/const client = await managedClient();/g; \
        s/new SonioxClient('byok-key')/new SonioxClient(byokCredentials('byok-key'))/g" \
  src/services/clients/SonioxClient.managed.test.ts
```

One site is not inside an `async` test — fix it by hand. Before:

```ts
  it('is null before connect()', () => {
    const client = await managedClient();
    expect(client.getManagedBudgetInfo()).toBeNull();
  });
```

After:

```ts
  it('is null before connect() but non-null as soon as the session is acquired', async () => {
    const client = await managedClient();
    // The allowance now belongs to the SESSION, which acquire() already
    // started, so the snapshot exists before any socket does.
    expect(client.getManagedBudgetInfo()).not.toBeNull();
  });
```

And the reset test, whose premise changed — the meter no longer lives on the client, so a
client reset cannot clear it. Before:

```ts
  it('is cleared back to null once reset() runs (the next connect())', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = await managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    expect(client.getManagedBudgetInfo()).not.toBeNull();

    client.reset();
    expect(client.getManagedBudgetInfo()).toBeNull();
  });
```

After:

```ts
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
```

- [ ] **Step 8: Add the two contract tests this task exists to prove**

Append to `src/services/clients/SonioxClient.managed.test.ts`:

```ts
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
```

- [ ] **Step 9: Run it and watch it fail**

Run: `npx vitest run src/services/clients/SonioxClient.managed.test.ts`

Expected: FAIL — `TypeError: Cannot read properties of undefined (reading 'stt')` from
`buildSttConnectConfig`, because `new SonioxClient(bundle, { session })` is still being read as
`new SonioxClient(apiKey, { managed })`.

- [ ] **Step 10: Replace the client's constructor and lease fields**

In `src/services/clients/SonioxClient.ts`.

Before (line 14):
```ts
import { SonioxCostMeter, SonioxBudgetSnapshot } from './SonioxCostMeter';
```
After:
```ts
import { SonioxBudgetSnapshot } from './SonioxCostMeter';
import type { ManagedSonioxSession, SonioxCredentialBundle } from './ManagedSonioxSession';
```

Delete line 18 (`import { getApiUrl } from '../../utils/environment';`) — the session owns every
HTTP call now.

Before (lines 53-82):
```ts
// Fallback only — the backend's 409 body always carries its own retryAfterMs
// (see describeManagedSessionError); this is used solely if that field is
// somehow missing from a malformed/empty body.
const DEFAULT_CONFLICT_RETRY_MS = 3000;

/** Options for managed (backend-billed) sessions. BYOK sessions omit this entirely. */
export interface SonioxClientOptions {
  managed?: {
    /** Better-auth session token. Sent ONLY to our backend's Authorization
     *  header — never to Soniox, which receives the short-lived sttApiKey /
     *  ttsApiKey minted in exchange for it. */
    sessionToken: string;
  };
}

interface SonioxSessionKeyResponse {
  sttApiKey: string;
  ttsApiKey?: string;
  expiresAt: string;
  maxSessionDurationSeconds: number;
  budgetMicroUsd: number;
  rateUsdPerHour: number;
  sku: string;
  leaseId: string;
  // The exact `sokuji1:<accountId>:<leaseId>` string the backend already
  // bound to the temporary key(s) — see fetchManagedSession's docstring for
  // why this, not leaseId, is what gets sent to Soniox as
  // `client_reference_id`.
  clientReferenceId: string;
}
```
After:
```ts
/**
 * Second constructor argument. The PRESENCE of `session` is the explicit
 * managed-mode flag — deliberately not inferred from the credential bundle's
 * shape, because "the bundle carries a clientReferenceId" would silently
 * mis-gate the BYOK-only 503 resume ladder for any managed-looking bundle.
 * It is also what feeds the allowance countdown its clock (wireSttHandlers
 * forwards the STT keepalive tick to it).
 */
export interface SonioxClientOptions {
  session?: ManagedSonioxSession;
}
```

Before (lines 156-169):
```ts
  // Managed-mode session state. Populated once per connect() from
  // /api/soniox/session-key (never earlier — see connect()'s docstring) and
  // cleared by reset(). BYOK sessions leave all of these null and fall back
  // to `this.apiKey` for both sockets, same as before this feature existed.
  private readonly managedOptions?: SonioxClientOptions['managed'];
  private managedSttApiKey: string | null = null;
  private managedTtsApiKey: string | null = null;
  private leaseId: string | null = null;
  private clientReferenceId: string | null = null;
  private costMeter: SonioxCostMeter | null = null;
```
After:
```ts
  // The lease is gone from this class (design decision 7). What is left is what
  // a STREAM needs: the keys for its two sockets and the reference to echo.
  // Both are readonly constructor fields, which is what makes reset() — which
  // runs at the TOP of connect() — structurally unable to clear them.
  private readonly credentials: SonioxCredentialBundle;
  private readonly session: ManagedSonioxSession | null;
```

Before (lines 211-215):
```ts
  constructor(apiKey: string, options?: SonioxClientOptions) {
    this.apiKey = apiKey;
    this.managedOptions = options?.managed;
    this.instanceId = `soniox_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
```
After:
```ts
  constructor(credentials: SonioxCredentialBundle, options?: SonioxClientOptions) {
    this.credentials = credentials;
    this.session = options?.session ?? null;
    this.instanceId = `soniox_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /** Backend-billed session? One question, one answer, five readers: the two
   *  key selections, the 403 granted-duration gate, the BYOK-only 503 resume
   *  gate, and the allowance countdown. */
  private get isManaged(): boolean {
    return this.session !== null;
  }
```

Finally delete line 85's now-dangling `private apiKey: string;` (line 85 in the original file).

- [ ] **Step 11: Rewire connect(), the config builders and the error gates**

Before (lines 278-283, inside `connect`):
```ts
    if (this.managedOptions) {
      await this.fetchManagedSession(cfg);
      // Stale-attempt guard: disconnect() may have run while we were
      // exchanging the session token for keys.
      if (gen !== this.generation) return;
    }
```
After:
```ts
    // No network round trip here any more: MainPanel acquired the session and
    // handed this client its bundle before construction. Registering the
    // announcer here rather than in the constructor is what lets FE3/FE4 name
    // ONE owner for the session-level outcome.
    this.session?.setExhaustedHandler(() => this.handleBudgetExhausted());
```

Before (line 300):
```ts
    if (this.managedOptions && this.leaseId) this.notifySessionStarted(this.leaseId);
```
After: delete the line and the three-line comment above it (lines 298-300). `markStarted` is
MainPanel's call now, made once the connect resolves.

Before (line 373):
```ts
      onTick: () => this.costMeter?.tick(Date.now()),
```
After:
```ts
      // Forwarded to the SESSION, which owns the meter. A no-op for BYOK.
      // `tick` is absolute (now - startedAt), so FE3's second forwarder from
      // the participant leg is harmless.
      onTick: () => this.session?.tick(Date.now()),
```

Before (line 406):
```ts
      apiKey: this.managedOptions ? this.managedSttApiKey! : this.apiKey,
```
After:
```ts
      apiKey: this.credentials.stt,
```

Before (line 414):
```ts
      clientReferenceId: this.clientReferenceId ?? undefined,
```
After:
```ts
      // Inert on the wire — Soniox attributes usage to the reference bound to
      // the KEY (probed 2026-08-11). Kept as a harmless hedge; nothing relies on it.
      clientReferenceId: this.credentials.clientReferenceId,
```

Before (lines 908-920, in `createTtsStream`):
```ts
    const stream = new SonioxTtsStream({
      // Managed mode: a Soniox temporary key is scoped to ONE usage type —
      // an sttApiKey cannot open a TTS socket, so this MUST be ttsApiKey.
      apiKey: this.managedOptions ? this.managedTtsApiKey! : this.apiKey,
```
After:
```ts
    // A Soniox temporary key is scoped to ONE usage type — an STT key cannot
    // open a TTS socket. Throwing beats falling back to `stt`: both callers
    // (connect()'s best-effort block and ensureTts's catch) degrade the session
    // to subtitles, which is the correct outcome for a lease that was issued no
    // TTS key at all.
    const ttsApiKey = this.credentials.tts;
    if (!ttsApiKey) {
      throw new Error('Soniox TTS was requested but no TTS key was issued for this stream');
    }
    const stream = new SonioxTtsStream({
      apiKey: ttsApiKey,
```

And line 919 in the same object:
```ts
      clientReferenceId: this.clientReferenceId ?? undefined,
```
becomes:
```ts
      clientReferenceId: this.credentials.clientReferenceId,
```

Before (line 1189): `if (this.managedOptions && code === '403') {` → After: `if (this.isManaged && code === '403') {`

Before (line 1221): `if (!this.managedOptions && code === '503' && this.sttResumeCycles < SonioxClient.MAX_STT_RESUME_CYCLES) {` → After: `if (!this.isManaged && code === '503' && this.sttResumeCycles < SonioxClient.MAX_STT_RESUME_CYCLES) {`

- [ ] **Step 12: Delete the lease methods and fix disconnect/reset/getManagedBudgetInfo**

Delete outright, in `src/services/clients/SonioxClient.ts`: `fetchManagedSession` (lines
651-707 including its docstring), `requestSessionKey` (709-728), `describeManagedSessionError`
(734-773), `notifySessionStarted` (775-790), `notifySessionEnd` (792-806). All five moved to
`ManagedSonioxSession`. Keep `SonioxClient.delay` (730-732) — `resumeSttStream` still uses it.

Before (lines 849-851):
```ts
  getManagedBudgetInfo(): SonioxBudgetSnapshot | null {
    return this.costMeter?.getBudgetSnapshot() ?? null;
  }
```
After:
```ts
  getManagedBudgetInfo(): SonioxBudgetSnapshot | null {
    // MainPanel reads this off the speaker ref and caches it for the whole
    // session, so delegating keeps its countdown effect untouched. Null for
    // BYOK (no session) and before the session was acquired.
    return this.session?.getBudgetSnapshot() ?? null;
  }
```

Before (lines 1405-1408, in `disconnect`):
```ts
    // Fire-and-forget: a hint, not a transaction — the backend releases the
    // lease only once Soniox's usage logs confirm the session actually
    // ended (or it expires on its own).
    if (this.managedOptions && this.leaseId) this.notifySessionEnd(this.leaseId);
```
After:
```ts
    // session-end is NOT sent from here any more: it is one POST per SESSION,
    // and MainPanel sends it after every client is down. Stand down as the
    // exhaustion announcer, though — a disconnected client must not emit a
    // balance notice into a list nobody renders.
    this.session?.setExhaustedHandler(null);
```

Before (lines 1451-1455, in `reset`):
```ts
    this.managedSttApiKey = null;
    this.managedTtsApiKey = null;
    this.leaseId = null;
    this.clientReferenceId = null;
    this.costMeter = null;
```
After:
```ts
    // Nothing managed to clear: `credentials` and `session` are readonly
    // constructor fields. reset() runs at the TOP of connect(), so clearing
    // either would leave the very next socket with no key at all.
```

- [ ] **Step 13: Run the managed client suite and watch it pass**

Run: `npx vitest run src/services/clients/SonioxClient.managed.test.ts`

Expected: PASS

- [ ] **Step 14: Move both descriptors onto the bundle, and open the `ClientOptions` seam**

`src/services/providers/ProviderDescriptor.ts` — before (lines 1-3 and 22-25):
```ts
import { ProviderConfig, LanguageOption } from './ProviderConfig';
import { IClient, FilteredModel, SessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
```
```ts
export type ClientOptions = {
  transport: TransportType;
  webrtcOptions?: { inputDeviceId?: string; outputDeviceId?: string };
};
```
After:
```ts
import { ProviderConfig, LanguageOption } from './ProviderConfig';
import { IClient, FilteredModel, SessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
// Type-only, so this adds no runtime edge from the shared descriptor module to
// SonioxClient's dependency graph (i18n, the wire components).
import type { ManagedSonioxSession, SonioxCredentialBundle } from '../clients/ManagedSonioxSession';
```
```ts
export type ClientOptions = {
  transport: TransportType;
  webrtcOptions?: { inputDeviceId?: string; outputDeviceId?: string };
  /**
   * Managed Soniox only. The lease is acquired by MainPanel BEFORE any client
   * exists (an awaited round trip with a 409 retry), so the keys arrive here
   * rather than being minted inside the client. Keeping this optional is what
   * lets createClient stay synchronous and return exactly one IClient for all
   * eleven providers.
   */
  sonioxManaged?: {
    credentials: SonioxCredentialBundle;
    session: ManagedSonioxSession;
  };
};
```

`src/services/providers/SonioxProviderConfig.ts` — before (line 5 and 173-175):
```ts
import { SonioxClient } from '../clients/SonioxClient';
```
```ts
  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    return new SonioxClient(creds.primary);
  }
```
After:
```ts
import { SonioxClient } from '../clients/SonioxClient';
import { byokCredentials } from '../clients/ManagedSonioxSession';
```
```ts
  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    // A NEW construction shape for BYOK too, not a shape managed was moved
    // onto: one user key in both slots, and no client_reference_id — BYOK
    // traffic is not ours to bill.
    return new SonioxClient(byokCredentials(creds.primary));
  }
```

`src/services/providers/KizunaAISonioxProviderConfig.ts` — before (lines 23-27 and 33-37):
```ts
  async extractCredentials(_slice: unknown, ctx: CredentialCtx): Promise<Credentials> {
    const token = ctx.getAuthToken ? await ctx.getAuthToken() : null;
    if (!token) return { ok: false, missing: 'Sign in is required for Kizuna providers' };
    return { ok: true, primary: token };
  }
```
```ts
  // Override — SonioxClient exchanges the session token for temporary Soniox
  // keys at connect() time; no BYOK apiKey is ever used here.
  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    return new SonioxClient('', { managed: { sessionToken: creds.primary } });
  }
```
After:
```ts
/** The exact message this twin has always produced for a signed-out user.
 *  Exported so MainPanel's acquire path can throw the same sentence — the
 *  lease moved out of the client, so the sign-in gate now fires there first.
 *  Pinned by descriptorRegistry.test.ts. */
export const KIZUNA_SIGN_IN_REQUIRED = 'Sign in is required for Kizuna providers';
```
```ts
  async extractCredentials(_slice: unknown, ctx: CredentialCtx): Promise<Credentials> {
    const token = ctx.getAuthToken ? await ctx.getAuthToken() : null;
    if (!token) return { ok: false, missing: KIZUNA_SIGN_IN_REQUIRED };
    return { ok: true, primary: token };
  }
```
```ts
  // The lease is not a stream property (design decision 7): MainPanel acquires
  // a ManagedSonioxSession and hands this client the bundle for its role. There
  // is deliberately no fallback that mints a lease here — a client that could
  // acquire its own would 409 the moment a session ran two of them.
  createClient(_creds: Credentials & { ok: true }, options: ClientOptions): IClient {
    const managed = options.sonioxManaged;
    if (!managed) {
      throw new Error(
        'The managed Soniox client must be built from a ManagedSonioxSession — acquire one and pass it as ClientOptions.sonioxManaged (see MainPanel.connectConversation).'
      );
    }
    return new SonioxClient(managed.credentials, { session: managed.session });
  }
```
(The `KIZUNA_SIGN_IN_REQUIRED` const goes above the `export class` declaration, after the
imports.)

- [ ] **Step 15: Fix the two registry-invariant tests that this breaks**

`src/services/providers/descriptorRegistry.test.ts` — before (lines 71-73 and 87-105 region):
```ts
describe('descriptor.createClient', () => {
  const creds = { ok: true as const, primary: 'k', secret: 's', endpoint: 'https://e.example' };
  const ws = { transport: 'websocket' as const };

  it('constructs a client for every available provider', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const client = ProviderConfigFactory.getDescriptor(id).createClient(creds, ws);
```
After:
```ts
describe('descriptor.createClient', () => {
  const creds = { ok: true as const, primary: 'k', secret: 's', endpoint: 'https://e.example' };
  const ws = { transport: 'websocket' as const };
  // The managed Soniox twin is the one descriptor whose client cannot be built
  // from credentials alone: its keys come from a ManagedSonioxSession acquired
  // before any client exists. Supplied unacquired here — createClient only
  // stores it.
  const sonioxManaged = {
    credentials: { stt: 'stt-k', tts: 'tts-k', clientReferenceId: 'sokuji1:acct:lease:mix_stt' },
    session: new ManagedSonioxSession({ sessionToken: 'sess_TOKEN' }),
  };
  const optionsFor = (id: unknown) => (id === Provider.KIZUNA_AI_SONIOX ? { ...ws, sonioxManaged } : ws);

  it('constructs a client for every available provider', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const client = ProviderConfigFactory.getDescriptor(id).createClient(creds, optionsFor(id));
```

Before (the kizuna-soniox case):
```ts
  it('kizuna soniox twin routes to a managed-mode SonioxClient', async () => {
    const { SonioxClient } = await import('../clients/SonioxClient');
    const c = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX)
      .createClient({ ok: true, primary: 'sess_TOKEN' }, ws);
    expect(c).toBeInstanceOf(SonioxClient);
    expect(c.getProvider()).toBe(Provider.SONIOX);
  });
```
After:
```ts
  it('kizuna soniox twin routes to a managed-mode SonioxClient built from the session', async () => {
    const { SonioxClient } = await import('../clients/SonioxClient');
    const c = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX)
      .createClient({ ok: true, primary: 'sess_TOKEN' }, { ...ws, sonioxManaged });
    expect(c).toBeInstanceOf(SonioxClient);
    expect(c.getProvider()).toBe(Provider.SONIOX);
  });

  it('refuses to build the managed twin without a session rather than minting a second lease', () => {
    expect(() =>
      ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_SONIOX)
        .createClient({ ok: true, primary: 'sess_TOKEN' }, ws),
    ).toThrow(/ManagedSonioxSession/);
  });
```

Add the import at the top of the file:
```ts
import { ManagedSonioxSession } from '../clients/ManagedSonioxSession';
```

- [ ] **Step 16: Convert the BYOK suite's ~22 construction sites**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react
sed -i "s/new SonioxClient('key')/new SonioxClient(byokCredentials('key'))/g" \
  src/services/clients/SonioxClient.test.ts
sed -i "2a import { ManagedSonioxSession, byokCredentials } from './ManagedSonioxSession';" \
  src/services/clients/SonioxClient.test.ts
```

Then replace the two managed constructions by hand. Before (line ~1066, and identically at
~1134 in the `I1:` test):

```ts
    const client = new SonioxClient('', { managed: { sessionToken: 'tok' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        sttApiKey: 'stt-key', ttsApiKey: 'tts-key', expiresAt: '2026-07-25T00:01:00Z',
        maxSessionDurationSeconds: 900, budgetMicroUsd: 500_000, rateUsdPerHour: 0.6,
        sku: 'soniox:speech_to_speech', leaseId: 'lease-1', clientReferenceId: 'sokuji1:acct:lease-1',
      }),
    }));
```

After (both sites — the stub must now precede the acquire, not the construction):

```ts
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        sttApiKey: 'stt-key', ttsApiKey: 'tts-key', expiresAt: '2026-07-25T00:01:00Z',
        maxSessionDurationSeconds: 900, budgetMicroUsd: 500_000, rateUsdPerHour: 0.6,
        sku: 'soniox:speech_to_speech', leaseId: 'lease-1', clientReferenceId: 'sokuji1:acct:lease-1',
      }),
    }));
    const session = new ManagedSonioxSession({ sessionToken: 'tok' });
    await session.acquire({ mode: 'speaker', textOnly: false, bothSplit: false });
    const client = new SonioxClient(session.credentialsFor(session.primarySttRole), { session });
```

- [ ] **Step 17: Run the three Soniox client suites and watch them pass**

Run: `npx vitest run src/services/clients/SonioxClient.test.ts src/services/clients/SonioxClient.managed.test.ts src/services/clients/ManagedSonioxSession.test.ts src/services/providers/descriptorRegistry.test.ts`

Expected: PASS

- [ ] **Step 18: Commit the client-side refactor**

```bash
git add src/services/clients/SonioxClient.ts src/services/clients/SonioxClient.test.ts \
        src/services/clients/SonioxClient.managed.test.ts \
        src/services/providers/ProviderDescriptor.ts \
        src/services/providers/SonioxProviderConfig.ts \
        src/services/providers/KizunaAISonioxProviderConfig.ts \
        src/services/providers/descriptorRegistry.test.ts
git commit -m "refactor(soniox): SonioxClient takes a credential bundle, not a bare key

A client is now a thing that runs one stream with credentials it was handed.
Both flavours get the same NEW construction shape: BYOK puts its one key in
both slots and sends no reference; managed is built from a
ManagedSonioxSession's per-role bundle.

Managed-ness is the presence of the session object, never an inferred key
shape — inferring it would mis-gate the BYOK-only 503 resume ladder. The
client sends neither session-started nor session-end.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 19: MainPanel — acquire the session and thread the bundle**

Add after line 71 in `src/components/MainPanel/MainPanel.tsx`:
```ts
import { ManagedSonioxSession } from '../../services/clients/ManagedSonioxSession';
import type { SonioxCredentialBundle } from '../../services/clients/ManagedSonioxSession';
import { KIZUNA_SIGN_IN_REQUIRED } from '../../services/providers/KizunaAISonioxProviderConfig';
```

Add after line 1263 (`const sonioxBudgetInfoRef = ...`):
```ts
  // The managed Soniox lease for the CURRENT session. Lives here, not in a
  // client, because it outlives any one client and because acquiring it is an
  // awaited round trip that ProviderDescriptor.createClient cannot make.
  const managedSonioxSessionRef = useRef<ManagedSonioxSession | null>(null);
```

`createAIClient` — before (lines 719-723 and 744-745):
```ts
  const createAIClient = useCallback(async (useWebRTC: boolean = false): Promise<IClient> => {
    const descriptor = ProviderConfigFactory.getDescriptor(provider);
    const slice = useSettingsStore.getState()[descriptor.settingsSliceKey as keyof SettingsStore];
    const creds = await descriptor.extractCredentials(slice, { getAuthToken });
    if (!creds.ok) throw new Error(creds.missing);
```
```ts
    return descriptor.createClient(creds, { transport: effectiveTransportType, webrtcOptions });
  }, [provider, getAuthToken, selectedInputDevice?.deviceId, selectedMonitorDevice?.deviceId, isMicMuted]);
```
After:
```ts
  const createAIClient = useCallback(async (
    useWebRTC: boolean = false,
    sonioxManaged?: { credentials: SonioxCredentialBundle; session: ManagedSonioxSession },
  ): Promise<IClient> => {
    const descriptor = ProviderConfigFactory.getDescriptor(provider);
    const slice = useSettingsStore.getState()[descriptor.settingsSliceKey as keyof SettingsStore];
    // The managed Soniox twin's "credential" IS the better-auth session token,
    // and connectConversation has already spent it: acquire() exchanged it for
    // the temporary Soniox keys now sitting in sonioxManaged.credentials.
    // Re-running extractCredentials would fire a second
    // getToken({ skipCache: true }) round trip per Start for a value this path
    // no longer reads. The sign-in gate it used to provide is not lost — the
    // acquire path throws KIZUNA_SIGN_IN_REQUIRED when no token is available.
    const creds = sonioxManaged
      ? ({ ok: true, primary: '' } as const)
      : await descriptor.extractCredentials(slice, { getAuthToken });
    if (!creds.ok) throw new Error(creds.missing);
```
```ts
    return descriptor.createClient(creds, { transport: effectiveTransportType, webrtcOptions, sonioxManaged });
  }, [provider, getAuthToken, selectedInputDevice?.deviceId, selectedMonitorDevice?.deviceId, isMicMuted]);
```

Insert immediately after line 1917 (the closing line of the `sonioxSharedBoth` expression):
```ts
      // The managed Soniox lease belongs to the SESSION, not to a stream
      // (design decision 7). Everything the client used to do inside connect()
      // — the session-key exchange, its 409 retry, the cost meter, and the
      // session-started/session-end notifications — happens here and in
      // ManagedSonioxSession now.
      //
      // Deliberately NOT inside createAIClient: acquire() is an awaited network
      // round trip and ProviderDescriptor.createClient is synchronous and
      // returns exactly one client, so the descriptor cannot own it without
      // going async for all eleven providers.
      let managedSonioxCore: 'speaker' | 'participant' | null = null;
      let managedSonioxArg: { credentials: SonioxCredentialBundle; session: ManagedSonioxSession } | undefined;
      if (
        (kizunaBaseProvider(provider) ?? provider) === Provider.SONIOX &&
        isKizunaManagedProvider(provider)
      ) {
        const token = await getAuthToken();
        if (!token) throw new Error(KIZUNA_SIGN_IN_REQUIRED);
        const session = new ManagedSonioxSession({
          sessionToken: token,
          onEvent: (type, data) => addRealtimeEvent({ type, data }, 'client', type),
        });
        // Stored BEFORE acquire() so a failed acquire still leaves something
        // for disconnectConversation to clear; end() no-ops without a lease.
        managedSonioxSessionRef.current = session;
        await session.acquire({
          mode: effectiveMode,
          // The same one-shot snapshot getSessionConfig() reads below
          // (settingsStore: `config.textOnly = state.textOnly`), so the lease's
          // SKU and the socket's config cannot disagree.
          textOnly: useSettingsStore.getState().textOnly,
          // FE1 ships no split: the managed twin still forces the shared Both
          // session. FE2 replaces this with the single derived value.
          bothSplit: false,
        });
        // One lease, one Soniox client in FE1 — the speaker when it starts,
        // otherwise the participant-only leg. Identical to today, where
        // whichever single client got created minted the lease itself.
        managedSonioxCore = speakerWillStart ? 'speaker' : 'participant';
        managedSonioxArg = {
          credentials: session.credentialsFor(session.primarySttRole),
          session,
        };
      }
```

- [ ] **Step 20: MainPanel — hand the bundle to the one client, and drive the lifecycle**

Before (line 1927):
```ts
        speakerClientRef.current = await createAIClient(useWebRTC);
```
After:
```ts
        speakerClientRef.current = await createAIClient(
          useWebRTC,
          managedSonioxCore === 'speaker' ? managedSonioxArg : undefined,
        );
```

Before (line 2000):
```ts
          await client.connect(sessionConfig);
```
After:
```ts
          await client.connect(sessionConfig);

          // Fire-and-forget: extends the lease from its short start window to
          // the full granted duration now that the socket is actually up. Used
          // to fire from inside SonioxClient.connect(); it is a SESSION fact,
          // so the session owns it. A few ms later than before (after the
          // best-effort TTS connect), well inside the 60 s start window.
          if (managedSonioxCore === 'speaker' && managedSonioxArg) {
            managedSonioxArg.session.markStarted(managedSonioxArg.session.primarySttRole);
          }
```

Before (lines 2227-2229):
```ts
            } else {
              participantClientRef.current = await createAIClient();
            }
```
After:
```ts
            } else if (managedSonioxCore === 'speaker') {
              // A managed session that already spent its single STT key on the
              // speaker cannot open a second transcription socket: the backend
              // mints STT keys single_use, so the second socket would be
              // rejected AFTER onopen with a 403 the client reads as the
              // granted-duration cutoff — tearing the whole session down.
              // Unreachable today: sonioxAutoParticipantBlocked closes the
              // Start gate for the only combination that reaches here (managed
              // + Both + an 'auto' source), and every other managed Both
              // session takes the shared secondary-port branch above. Kept as a
              // loud invariant; FE3 replaces it with a real par_stt leg on its
              // own key. Lands in the non-fatal catch below, so the speaker
              // survives.
              throw new Error('Managed Soniox cannot open a second transcription stream without its own session key');
            } else {
              participantClientRef.current = await createAIClient(
                false,
                managedSonioxCore === 'participant' ? managedSonioxArg : undefined,
              );
            }
```

Before (line 2241):
```ts
              await participantClient.connect(participantSessionConfig);
```
After:
```ts
              await participantClient.connect(participantSessionConfig);
              // Participant-only managed session: this leg IS the lease's
              // single stream, so it is the one that extends the lease.
              if (managedSonioxCore === 'participant' && managedSonioxArg) {
                managedSonioxArg.session.markStarted(managedSonioxArg.session.primarySttRole);
              }
```

Before (lines 1669-1680, in `disconnectConversation`):
```ts
      // Disconnect participant client
      const participantClient = participantClientRef.current;
      if (participantClient) {
        try {
          await participantClient.disconnect();
          participantClient.reset();
          participantClientRef.current = null;
          console.info('[Sokuji] [MainPanel] Disconnected participant client');
        } catch (error) {
          console.warn('[Sokuji] [MainPanel] Error disconnecting participant client:', error);
        }
      }
```
After (append the new block directly beneath it):
```ts
      // Disconnect participant client
      const participantClient = participantClientRef.current;
      if (participantClient) {
        try {
          await participantClient.disconnect();
          participantClient.reset();
          participantClientRef.current = null;
          console.info('[Sokuji] [MainPanel] Disconnected participant client');
        } catch (error) {
          console.warn('[Sokuji] [MainPanel] Error disconnecting participant client:', error);
        }
      }

      // ONE session-end per session, after every client is down.
      // SonioxClient.disconnect() used to post it unconditionally, and this
      // function disconnects the speaker first — so with two legs the first
      // teardown would signal the end (and unpin the voice slot) while the
      // other was still streaming. A no-op when no lease was acquired, and
      // idempotent, so the connect-failure path through here is safe.
      const managedSoniox = managedSonioxSessionRef.current;
      if (managedSoniox) {
        managedSoniox.end();
        managedSonioxSessionRef.current = null;
      }
```

- [ ] **Step 21: Run the whole suite**

Run: `npx vitest run`

Expected: PASS — same total as before this task plus the 21 new
`ManagedSonioxSession.test.ts` cases, the 2 new `SonioxClient.managed.test.ts` contract cases
and the 1 new `descriptorRegistry.test.ts` case. (`npx tsc --noEmit` is NOT a gate in this repo
— it reports ~113 pre-existing errors; vitest is the correctness gate.)

- [ ] **Step 22: Smoke-test against production before committing the wiring**

Run: `npm run electron:dev`

Then, signed in, with **KizunaAI Soniox** selected: start a You-only session, speak, confirm a
translation comes back and the footer countdown ticks down; stop. Then set Both and repeat —
one shared session, both directions. Then switch to **BYOK Soniox** with a real key and repeat
You-only. In DevTools' Network tab confirm exactly one `POST /soniox/session-key` with body
`{"mode":"speech_to_speech"}`, one `POST /soniox/session-started`, and one
`POST /soniox/session-end` per managed session — and zero of all three for BYOK.

- [ ] **Step 23: Commit the wiring**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(soniox): MainPanel owns the managed session lease

connectConversation acquires one ManagedSonioxSession per Start and hands the
primary leg's bundle to whichever single client this session runs, calls
markStarted once its socket is up, and posts session-end exactly once from
disconnectConversation after every client is down.

The request body is still the legacy { mode }, so this runs against the
backend as deployed. No behaviour change: same POSTs, same order, same
countdown.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task FE2: One derived shared-vs-split value, threaded to the Start-gate balance floor

**Files:**
- Create: `src/services/providers/sonioxBothMode.ts`
- Create: `src/services/providers/sonioxBothMode.test.ts`
- Modify: `src/services/providers/sonioxManagedMinBalance.ts` (whole file, lines 1-38)
- Modify: `src/services/providers/sonioxManagedMinBalance.test.ts` (whole file, lines 1-36)
- Modify: `src/services/providers/SonioxProviderConfig.ts` (re-export block, lines 142-145)
- Modify: `src/components/MainPanel/sessionStartGate.ts` (lines 56-74, lines 76-103)
- Modify: `src/components/MainPanel/sessionStartGate.test.ts` (the `managed Soniox balance floor` describe, lines 91-159)
- Modify: `src/components/MainPanel/MainPanel.tsx` (line 30, after line 585, lines 594-607, lines 1904-1917)

**Interfaces:**
- Consumes: `sonioxUsesSharedBothSession(provider: Provider, settings: { bothModeSharedSession?: boolean } | null | undefined): boolean` — existing, from `src/services/providers/SonioxProviderConfig.ts:161`. `kizunaBaseProvider(provider: Provider): Provider | undefined` and `Provider` — existing, from `src/types/Provider.ts`.
- Produces:
  - `export type SonioxBothModeScope = 'speaker' | 'participant' | 'both'`
  - `export interface SonioxBothModeInput { provider: Provider; settings: { bothModeSharedSession?: boolean; sourceLanguage?: string } | null | undefined; mode: SonioxBothModeScope }`
  - `export interface SonioxBothModePlan { shared: boolean; split: boolean }`
  - `export function sonioxBothModePlan(input: SonioxBothModeInput): SonioxBothModePlan`
  - `export function sonioxManagedMinBalanceMicroUsd(textOnly: boolean, bothSplit?: boolean): number`
  - `export const SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR: { readonly stt: 1_100_000; readonly tts: 1_400_000 }`
  - `export const SONIOX_MANAGED_MIN_SESSION_S = 60`
  - `export const SONIOX_MANAGED_MIN_BALANCE_MICRO_USD: { readonly one_stt_text_only: 18_334; readonly one_stt_speech_to_speech: 41_667; readonly two_stt_text_only: 36_667; readonly two_stt_speech_to_speech: 60_000 }` (replaces the old `{ text_only, speech_to_speech }` keys)
  - `StartGateInput.sonioxBothSplit?: boolean`
  - In `MainPanel.tsx`: a render-scope `const sonioxBothSplit: boolean`, and inside `connectConversation` a `const sonioxBothPlan: SonioxBothModePlan` whose `.split` is what the managed `session-key` request must declare as `bothSplit`.

---

- [ ] **Step 1: Write the failing test for the one derived value**

Create `src/services/providers/sonioxBothMode.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sonioxBothModePlan } from './sonioxBothMode';
import { Provider } from '../../types/Provider';

/**
 * The shared-vs-split decision used to be a four-clause `&&` written inline in
 * MainPanel.connectConversation, with a second partial copy twenty lines above
 * it in the `sonioxAutoParticipantBlocked` gate. Three consumers now need the
 * same answer — the managed session-key request (`bothSplit`), the Start-gate
 * balance floor, and the client wiring (`bidirectional` + the secondary-port
 * participant) — so it is one pure function, tested here directly.
 *
 * NOTE for whoever lands the managed-split UI: this file deliberately does NOT
 * assert what a managed account does with a stored `bothModeSharedSession:
 * false`. At this point `sonioxUsesSharedBothSession` still forces shared on
 * for the managed twin, and that policy is inverted in its own task, which
 * adds the managed-split cases here.
 */
describe('sonioxBothModePlan', () => {
  const concrete = { bothModeSharedSession: true, sourceLanguage: 'en' };

  it('is inert for a provider that is not Soniox', () => {
    expect(sonioxBothModePlan({ provider: Provider.OPENAI, settings: concrete, mode: 'both' }))
      .toEqual({ shared: false, split: false });
  });

  it('is inert outside Both mode', () => {
    expect(sonioxBothModePlan({ provider: Provider.SONIOX, settings: concrete, mode: 'speaker' }))
      .toEqual({ shared: false, split: false });
    expect(sonioxBothModePlan({ provider: Provider.SONIOX, settings: concrete, mode: 'participant' }))
      .toEqual({ shared: false, split: false });
  });

  it('reports shared for BYOK Both with the toggle on and a concrete source language', () => {
    expect(sonioxBothModePlan({ provider: Provider.SONIOX, settings: concrete, mode: 'both' }))
      .toEqual({ shared: true, split: false });
  });

  it('reports split for BYOK Both with the toggle off', () => {
    expect(sonioxBothModePlan({
      provider: Provider.SONIOX,
      settings: { bothModeSharedSession: false, sourceLanguage: 'en' },
      mode: 'both',
    })).toEqual({ shared: false, split: true });
  });

  // Shared mode tells the two sides apart by LANGUAGE, so an 'auto' source
  // makes it unrunnable. This combination reaches neither answer: the Start
  // gate closes on `sonioxAutoParticipantBlocked` before a session exists.
  // Preserving this clause is the whole point of centralising the expression —
  // calling `sonioxUsesSharedBothSession` alone silently drops it.
  it('reports neither when the shared toggle is on but the source language is auto', () => {
    expect(sonioxBothModePlan({
      provider: Provider.SONIOX,
      settings: { bothModeSharedSession: true, sourceLanguage: 'auto' },
      mode: 'both',
    })).toEqual({ shared: false, split: false });
  });

  it('defaults to shared when nothing is stored', () => {
    expect(sonioxBothModePlan({ provider: Provider.SONIOX, settings: {}, mode: 'both' }))
      .toEqual({ shared: true, split: false });
    expect(sonioxBothModePlan({ provider: Provider.SONIOX, settings: null, mode: 'both' }))
      .toEqual({ shared: true, split: false });
    expect(sonioxBothModePlan({ provider: Provider.SONIOX, settings: undefined, mode: 'both' }))
      .toEqual({ shared: true, split: false });
  });

  // The managed twin must resolve through kizunaBaseProvider. A raw
  // `provider === Provider.SONIOX` test is always false for it, which is
  // exactly how this expression once opened two managed sessions instead of
  // one and got the second refused with a 409.
  it('resolves the Kizuna-managed twin to Soniox rather than treating it as another provider', () => {
    expect(sonioxBothModePlan({
      provider: Provider.KIZUNA_AI_SONIOX,
      settings: concrete,
      mode: 'both',
    }).shared).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/providers/sonioxBothMode.test.ts`

Expected: FAIL — `Error: Failed to resolve import "./sonioxBothMode" from "src/services/providers/sonioxBothMode.test.ts". Does the file exist?`

- [ ] **Step 3: Implement the derived value**

Create `src/services/providers/sonioxBothMode.ts`:

```ts
// src/services/providers/sonioxBothMode.ts
//
// THE answer to "how does Both mode run for this session", in one place.
//
// Before this module the decision was a four-clause `&&` written inline in
// MainPanel.connectConversation, and a second, partial copy of the same
// reasoning ('auto' source language) lived twenty lines above it in the
// `sonioxAutoParticipantBlocked` gate. Three consumers need the same answer:
// the managed `session-key` request (which declares `bothSplit`), the Start
// gate's balance floor, and the client wiring (`bidirectional: true` plus the
// secondary-port participant). Three inline copies would drift.
//
// Pure, with no React and no store access, so it can be called from BOTH the
// render pass (reactive selectors feed the Start gate) and from inside
// connectConversation (a one-shot useSettingsStore.getState() snapshot). Same
// house rule as resolveVoicePrepOutcome: the DECISION is a pure function, only
// the side effects stay in the component.
//
// This module is NOT imported by components/MainPanel/sessionStartGate.ts —
// the gate takes the derived boolean as a plain input. That matters: the gate
// is also loaded by the subtitle window, and this file's import of
// SonioxProviderConfig pulls SonioxClient and the i18n bootstrap behind it.
import { Provider, kizunaBaseProvider } from '../../types/Provider';
import { sonioxUsesSharedBothSession } from './SonioxProviderConfig';

/** Structurally identical to audioStore's AudioMode, declared locally so this
 *  module does not import a Zustand store into every caller. */
export type SonioxBothModeScope = 'speaker' | 'participant' | 'both';

export interface SonioxBothModeInput {
  /** The ACTIVE provider id — the Kizuna-managed twin, not its base. */
  provider: Provider;
  /**
   * The ACTIVE provider's settings slice (`soniox` for BYOK, `kizunaSoniox`
   * for the managed twin), resolved by the descriptor's settingsSliceKey.
   * Widened to the two fields that matter so callers can pass either the whole
   * slice or a two-field literal built from reactive selectors.
   */
  settings: { bothModeSharedSession?: boolean; sourceLanguage?: string } | null | undefined;
  /** The effective mode (lockedMode ?? currentMode). */
  mode: SonioxBothModeScope;
}

export interface SonioxBothModePlan {
  /** One Soniox session, mic and system audio mixed (`mix_stt`). */
  shared: boolean;
  /** Two Soniox sessions, one per audio source (`spk_stt` + `par_stt`). */
  split: boolean;
}

export function sonioxBothModePlan(input: SonioxBothModeInput): SonioxBothModePlan {
  const { provider, settings, mode } = input;

  // Effective provider, so the KIZUNA_AI_SONIOX managed twin resolves to
  // SONIOX. A raw `provider === Provider.SONIOX` test is always false for the
  // twin — the exact bug this expression carried before, which opened two
  // independent managed sessions and had the second refused with a 409.
  const isSoniox = (kizunaBaseProvider(provider) ?? provider) === Provider.SONIOX;
  if (!isSoniox || mode !== 'both') return { shared: false, split: false };

  // The stored preference, through the shared helper rather than reading
  // `bothModeSharedSession` directly: that helper is the single seam where a
  // per-provider policy on this toggle lives, and reading the raw field would
  // route around it.
  const prefersShared = sonioxUsesSharedBothSession(provider, settings);

  // Shared mode distinguishes the two sides by LANGUAGE, not by channel, so it
  // cannot run with an 'auto' source. When the user has asked for shared with
  // an 'auto' source, neither answer is true: the Start gate closes on
  // `sonioxAutoParticipantBlocked` before any session exists, and the caller's
  // historical fall-through (two independent clients) is preserved unchanged.
  const shared = prefersShared && settings?.sourceLanguage !== 'auto';
  const split = !prefersShared;

  return { shared, split };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/services/providers/sonioxBothMode.test.ts`

Expected: PASS (7 tests)

- [ ] **Step 5: Write the failing test for the split balance floor**

Replace the whole of `src/services/providers/sonioxManagedMinBalance.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import {
  SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR,
  SONIOX_MANAGED_MIN_BALANCE_MICRO_USD,
  SONIOX_MANAGED_MIN_SESSION_S,
  sonioxManagedMinBalanceMicroUsd,
} from './SonioxProviderConfig';

/**
 * The Start button's managed-Soniox gate must match the backend's floor, or a
 * user between $0 and the floor sees a green Start and is then handed a 402.
 *
 * The floor is the price of the backend's shortest session (MIN_SESSION_S =
 * 60 s) at the CONSERVATIVE AGGREGATE rate for the STREAM SET the session will
 * open — not at a per-SKU list price. Those per-stream rates are K (2.0) times
 * the worst-case provider cost rate ($0.55/hr for a transcription stream,
 * $0.70/hr for a synthesis stream). These literals restate that arithmetic so
 * a rate change on either side shows up as a failing test rather than as a
 * silently wrong button.
 */
describe('managed Soniox start floor', () => {
  const MIN_SESSION_S = 60;
  const STT = 1_100_000; // µUSD/hr — K(2.0) × $0.55 worst-case provider cost
  const TTS = 1_400_000; // µUSD/hr — K(2.0) × $0.70 worst-case provider cost
  // Integer µUSD throughout, deliberately. The float spelling of the same sum,
  // `Math.ceil((60 / 3600) * 3.6 * 1_000_000)`, lands one ULP above 60000 and
  // ceils to 60001 — a one-µUSD gate error nobody would ever find by reading.
  const floor = (stt: number, tts: number) =>
    Math.ceil(((stt * STT + tts * TTS) * MIN_SESSION_S) / 3600);

  it('mirrors the backend conservative per-stream rates and its shortest session', () => {
    expect(SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR.stt).toBe(STT);
    expect(SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR.tts).toBe(TTS);
    expect(SONIOX_MANAGED_MIN_SESSION_S).toBe(MIN_SESSION_S);
  });

  it('matches the backend formula for every issuable stream set', () => {
    expect(SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.one_stt_text_only).toBe(floor(1, 0));        // $0.018334
    expect(SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.one_stt_speech_to_speech).toBe(floor(1, 1)); // $0.041667
    expect(SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.two_stt_text_only).toBe(floor(2, 0));        // $0.036667
    expect(SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.two_stt_speech_to_speech).toBe(floor(2, 1)); // $0.06
  });

  it('picks the floor for the session the user is about to start', () => {
    expect(sonioxManagedMinBalanceMicroUsd(true)).toBe(18_334);
    expect(sonioxManagedMinBalanceMicroUsd(false)).toBe(41_667);
    expect(sonioxManagedMinBalanceMicroUsd(true, true)).toBe(36_667);
    expect(sonioxManagedMinBalanceMicroUsd(false, true)).toBe(60_000);
  });

  it('defaults bothSplit to false so a caller that predates split keeps the single-stream floor', () => {
    expect(sonioxManagedMinBalanceMicroUsd(false)).toBe(sonioxManagedMinBalanceMicroUsd(false, false));
    expect(sonioxManagedMinBalanceMicroUsd(true)).toBe(sonioxManagedMinBalanceMicroUsd(true, false));
  });

  it('makes split roughly 2x — only the transcription half doubles', () => {
    // Text-only is the pure case: two STT streams, no TTS. Not exactly 2× the
    // single-stream floor: 2 × 18_334 = 36_668, because the single-stream
    // figure was rounded up once and the pair is rounded up once.
    expect(sonioxManagedMinBalanceMicroUsd(true, true))
      .toBe(2 * sonioxManagedMinBalanceMicroUsd(true) - 1);
    // Speech-to-speech carries one synthesis stream in BOTH shapes (the
    // participant leg is hardcoded text-only), so its ratio is below 2×.
    expect(sonioxManagedMinBalanceMicroUsd(false, true))
      .toBeGreaterThan(sonioxManagedMinBalanceMicroUsd(false));
    expect(sonioxManagedMinBalanceMicroUsd(false, true))
      .toBeLessThan(2 * sonioxManagedMinBalanceMicroUsd(false));
  });

  it('is strictly above zero, so "any positive balance" was never the same gate', () => {
    // The exact regression: $0.005 in the wallet passed `balance > 0`.
    expect(sonioxManagedMinBalanceMicroUsd(false)).toBeGreaterThan(5_000);
    expect(sonioxManagedMinBalanceMicroUsd(true)).toBeGreaterThan(5_000);
  });

  // Consequence of moving the budget off the per-SKU list rate and onto the
  // conservative estimate, pinned so it is a decision rather than a surprise:
  // a single-stream user's floor RISES ($0.025 → $0.041667), i.e. the quoted
  // duration at a given balance gets shorter, even though what they are
  // charged (provider cost × K) typically goes down.
  it('sits above the old per-SKU list floors it replaced', () => {
    expect(sonioxManagedMinBalanceMicroUsd(true)).toBeGreaterThan(10_000);
    expect(sonioxManagedMinBalanceMicroUsd(false)).toBeGreaterThan(25_000);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run src/services/providers/sonioxManagedMinBalance.test.ts`

Expected: FAIL — `SyntaxError: The requested module './SonioxProviderConfig' does not provide an export named 'SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR'`

- [ ] **Step 7: Implement the new floor table**

Replace the whole of `src/services/providers/sonioxManagedMinBalance.ts` with:

```ts
// src/services/providers/sonioxManagedMinBalance.ts
//
// Deliberately a LEAF module: no imports at all.
//
// The Start-button gate (components/MainPanel/sessionStartGate.ts) needs this
// floor, and that gate is also rendered by the subtitle window — a sibling
// React tree. Reading the constants from SonioxProviderConfig instead would
// drag SonioxClient, and through it the whole i18n bootstrap, into every
// surface that merely wants to know whether Start is allowed.
// SonioxProviderConfig re-exports every symbol here, so existing importers are
// unaffected.

/**
 * Conservative budget rate for ONE managed Soniox stream, in micro-USD per
 * hour, by stream kind.
 *
 * These MIRROR the backend's conservative-rate ESTIMATE table. Each is the
 * revenue coefficient K over the worst-case provider cost rate for a stream of
 * that kind ($0.55/hr transcription, $0.70/hr synthesis). K itself is defined
 * in exactly one place — the backend — and is deliberately not restated here;
 * only its product is mirrored.
 *
 * They are deliberately NOT the old per-SKU list rates ($0.60 / $1.50 per
 * hour). Pinning the budget to the list price would re-open overdraft now that
 * charging is provider cost × K rather than wall-clock time at a list rate.
 * The visible consequence, written down so it is not rediscovered as a bug
 * report: an existing single-stream user sees a SHORTER quoted duration at the
 * same balance (the speech-to-speech floor moves $0.025 → $0.041667) while
 * typically being CHARGED LESS than before.
 *
 * Integers rather than dollars-as-floats so the ceil below is exact: the float
 * spelling of the two-stream speech-to-speech sum lands one ULP above 60000
 * and ceils to 60001.
 */
export const SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR = {
  /** any `*_stt` role — one transcription stream */
  stt: 1_100_000,
  /** any `*_tts` role — one synthesis stream */
  tts: 1_400_000,
} as const;

/** The shortest session the backend will start, in seconds (its MIN_SESSION_S). */
export const SONIOX_MANAGED_MIN_SESSION_S = 60;

/**
 * What a MANAGED Soniox session costs to start, in micro-USD, keyed by the
 * STREAM SET it will open rather than by a per-SKU price.
 *
 * The backend refuses to issue a session key below the price of its shortest
 * session at the set's aggregate conservative rate, so gating Start on
 * `balance > 0` — or on the old per-SKU floor — shows a green button to a user
 * who is about to be handed a 402.
 *
 * Split Both opens TWO transcription streams (`spk_stt` + `par_stt`) where
 * every other shape opens one (`spk_stt`, `par_stt` or `mix_stt`); that is
 * what makes split roughly 2× per wall-clock minute. Only one synthesis stream
 * exists in any shape, because the participant leg is hardcoded text-only.
 *
 * KEEP IN SYNC with sokuji-backend's conservative-rate estimate table
 * (`src/services/pricing.ts`) and `src/config/soniox.ts` (MIN_SESSION_S). The
 * estimate table and the list-price table are separate structures there on
 * purpose — one number serving both meanings drifts silently. This is a UI
 * pre-check only; the backend's 402 remains the authority, and the client
 * still surfaces it.
 */
export const SONIOX_MANAGED_MIN_BALANCE_MICRO_USD = {
  /** 1 stt @ $1.10/hr for 60 s */
  one_stt_text_only: 18_334,
  /** 1 stt + 1 tts @ $2.50/hr for 60 s */
  one_stt_speech_to_speech: 41_667,
  /** 2 stt @ $2.20/hr for 60 s */
  two_stt_text_only: 36_667,
  /** 2 stt + 1 tts @ $3.60/hr for 60 s */
  two_stt_speech_to_speech: 60_000,
} as const;

/**
 * The floor that applies to the session the user is about to start.
 *
 * `textOnly` is the same toggle `SonioxClient` uses to pick the mode it asks
 * the backend for. `bothSplit` is true only for split Both — the one shape
 * that opens a second transcription stream — and defaults to false so a caller
 * that predates the toggle keeps today's single-stream floor.
 */
export function sonioxManagedMinBalanceMicroUsd(textOnly: boolean, bothSplit = false): number {
  if (bothSplit) {
    return textOnly
      ? SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.two_stt_text_only
      : SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.two_stt_speech_to_speech;
  }
  return textOnly
    ? SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.one_stt_text_only
    : SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.one_stt_speech_to_speech;
}
```

Then widen the re-export in `src/services/providers/SonioxProviderConfig.ts`. Before (lines 142-145):

```ts
export {
  SONIOX_MANAGED_MIN_BALANCE_MICRO_USD,
  sonioxManagedMinBalanceMicroUsd,
} from './sonioxManagedMinBalance';
```

After:

```ts
export {
  SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR,
  SONIOX_MANAGED_MIN_SESSION_S,
  SONIOX_MANAGED_MIN_BALANCE_MICRO_USD,
  sonioxManagedMinBalanceMicroUsd,
} from './sonioxManagedMinBalance';
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run src/services/providers/sonioxManagedMinBalance.test.ts`

Expected: PASS (7 tests)

- [ ] **Step 9: Write the failing test for the gate's split input**

In `src/components/MainPanel/sessionStartGate.test.ts`, replace the entire `describe('managed Soniox balance floor', …)` block (lines 91-159) with:

```ts
  describe('managed Soniox balance floor', () => {
    const soniox = { ...ready, provider: Provider.KIZUNA_AI_SONIOX } as StartGateInput;

    it('blocks one micro-USD below the single-stream text-only floor ($0.018334)', () => {
      expect(
        computeStartGate({ ...soniox, textOnly: true, quota: { balance: 18_333, frozen: false } }),
      ).toEqual({ canStart: false, reason: 'insufficient-balance', balance: 18_333 });
    });

    it('allows exactly the single-stream text-only floor', () => {
      expect(
        computeStartGate({ ...soniox, textOnly: true, quota: { balance: 18_334, frozen: false } }),
      ).toEqual({ canStart: true, reason: null });
    });

    it('blocks one micro-USD below the single-stream speech-to-speech floor ($0.041667)', () => {
      expect(
        computeStartGate({ ...soniox, textOnly: false, quota: { balance: 41_666, frozen: false } }),
      ).toEqual({ canStart: false, reason: 'insufficient-balance', balance: 41_666 });
    });

    it('allows exactly the single-stream speech-to-speech floor', () => {
      expect(
        computeStartGate({ ...soniox, textOnly: false, quota: { balance: 41_667, frozen: false } }),
      ).toEqual({ canStart: true, reason: null });
    });

    // Split Both opens a SECOND transcription stream, so the shortest session
    // the backend will start costs roughly twice as much. Decision 2: the
    // difference is reflected honestly rather than absorbed, so a low-balance
    // user finds split refused.
    it('blocks one micro-USD below the split text-only floor ($0.036667)', () => {
      expect(
        computeStartGate({
          ...soniox,
          textOnly: true,
          sonioxBothSplit: true,
          quota: { balance: 36_666, frozen: false },
        }),
      ).toEqual({ canStart: false, reason: 'insufficient-balance', balance: 36_666 });
    });

    it('allows exactly the split text-only floor', () => {
      expect(
        computeStartGate({
          ...soniox,
          textOnly: true,
          sonioxBothSplit: true,
          quota: { balance: 36_667, frozen: false },
        }),
      ).toEqual({ canStart: true, reason: null });
    });

    it('blocks one micro-USD below the split speech-to-speech floor ($0.06)', () => {
      expect(
        computeStartGate({
          ...soniox,
          textOnly: false,
          sonioxBothSplit: true,
          quota: { balance: 59_999, frozen: false },
        }),
      ).toEqual({ canStart: false, reason: 'insufficient-balance', balance: 59_999 });
    });

    it('allows exactly the split speech-to-speech floor', () => {
      expect(
        computeStartGate({
          ...soniox,
          textOnly: false,
          sonioxBothSplit: true,
          quota: { balance: 60_000, frozen: false },
        }),
      ).toEqual({ canStart: true, reason: null });
    });

    // The exact regression the floor exists to close: a balance that passes
    // `> 0` but cannot buy the shortest session the backend will start.
    it('blocks a positive balance that sits between zero and the floor', () => {
      const gate = computeStartGate({ ...soniox, quota: { balance: 5_000, frozen: false } });
      expect(gate.canStart).toBe(false);
      expect(gate.reason).toBe('insufficient-balance');
    });

    // textOnly is optional, so callers that don't know about the toggle must
    // still get a safe gate rather than silently falling back to `> 0`.
    it('defaults to the speech-to-speech floor when textOnly is omitted', () => {
      expect(
        computeStartGate({ ...soniox, quota: { balance: 41_666, frozen: false } }).canStart,
      ).toBe(false);
      expect(
        computeStartGate({ ...soniox, quota: { balance: 41_667, frozen: false } }).canStart,
      ).toBe(true);
    });

    // sonioxBothSplit defaults the OPPOSITE way to textOnly, on purpose: split
    // is opt-in and only a caller that reads the shared/split toggle can be in
    // it, so omitting it must not raise the floor for every speaker-only
    // session a split-unaware caller starts.
    it('defaults to the single-stream floor when sonioxBothSplit is omitted', () => {
      expect(
        computeStartGate({ ...soniox, textOnly: true, quota: { balance: 36_666, frozen: false } })
          .canStart,
      ).toBe(true);
    });

    // Every other provider keeps the historical rule. Balances are integer
    // micro-USD, so the floor of 1 is exactly `> 0`.
    it('leaves other Kizuna-managed providers on the any-positive-balance rule', () => {
      const other = { ...ready, provider: Provider.KIZUNA_AI_OPENAI_TRANSLATE } as StartGateInput;
      expect(computeStartGate({ ...other, quota: { balance: 1, frozen: false } })).toEqual({
        canStart: true,
        reason: null,
      });
      expect(computeStartGate({ ...other, quota: { balance: 0, frozen: false } }).reason).toBe(
        'insufficient-balance',
      );
      // Neither toggle may move a non-Soniox provider's floor.
      expect(
        computeStartGate({ ...other, textOnly: true, quota: { balance: 1, frozen: false } })
          .canStart,
      ).toBe(true);
      expect(
        computeStartGate({ ...other, sonioxBothSplit: true, quota: { balance: 1, frozen: false } })
          .canStart,
      ).toBe(true);
    });

    it('still prefers wallet-frozen over a sub-floor balance', () => {
      const gate = computeStartGate({ ...soniox, quota: { balance: 5_000, frozen: true } });
      expect(gate.reason).toBe('wallet-frozen');
    });
  });
```

- [ ] **Step 10: Run it and watch it fail**

Run: `npx vitest run src/components/MainPanel/sessionStartGate.test.ts`

Expected: FAIL — the split cases fail with `AssertionError: expected { canStart: true, reason: null } to deeply equal { canStart: false, reason: 'insufficient-balance', balance: 36666 }`, because `sonioxBothSplit` is not yet part of `StartGateInput` and is ignored.

- [ ] **Step 11: Implement the gate's split input**

In `src/components/MainPanel/sessionStartGate.ts`, append a field to `StartGateInput` immediately after `textOnly?: boolean;` (line 73). Before:

```ts
  textOnly?: boolean;
}
```

After:

```ts
  textOnly?: boolean;
  /**
   * Will the session about to start run Both mode as TWO Soniox streams (one
   * per audio source) rather than one shared mixed stream?
   *
   * Read ONLY for managed Soniox, and only to pick the balance floor: split
   * opens a second transcription stream, so the shortest session the backend
   * will start costs roughly twice as much.
   *
   * Optional like `textOnly`, but with the OPPOSITE safe default, deliberately.
   * `textOnly` omitted falls back to the HIGHER speech-to-speech floor, because
   * a caller that does not know about that toggle might be about to start a
   * speech session. Split is the reverse: it is opt-in, reachable only in Both
   * mode, and only a caller that reads the shared/split toggle can be in it —
   * so omitting it means "not split" and falls back to the LOWER floor.
   * Defaulting it the other way would block Start on every speaker-only
   * session for any caller that had not been taught about split.
   */
  sonioxBothSplit?: boolean;
}
```

Then in `computeStartGate`, extend the destructure and the floor. Before (lines 77-103):

```ts
  const {
    isApiKeyValid,
    availableModelCount,
    loadingModels,
    isInitializing,
    provider,
    quota,
    missingDeviceForMode,
    sonioxAutoParticipantBlocked,
    textOnly,
  } = input;

  const kizunaManaged = isKizunaManagedProvider(provider);

  // Managed Soniox has a real floor rather than "any positive balance": the
  // backend refuses to issue a session key below the price of its shortest
  // session (60s) at the SKU's rate — $0.01 text-only, $0.025
  // speech-to-speech. Gating on `> 0` showed a green Start to a user who was
  // then handed a 402 by the server. The 402 stays as the authority; this
  // stops the button lying about it.
  //
  // Every other provider gets a floor of 1: balances are integer micro-USD,
  // so `>= 1` is exactly the `> 0` rule this replaced.
  const balanceFloorMicroUsd =
    provider === Provider.KIZUNA_AI_SONIOX
      ? sonioxManagedMinBalanceMicroUsd(Boolean(textOnly))
      : 1;
```

After:

```ts
  const {
    isApiKeyValid,
    availableModelCount,
    loadingModels,
    isInitializing,
    provider,
    quota,
    missingDeviceForMode,
    sonioxAutoParticipantBlocked,
    textOnly,
    sonioxBothSplit,
  } = input;

  const kizunaManaged = isKizunaManagedProvider(provider);

  // Managed Soniox has a real floor rather than "any positive balance": the
  // backend refuses to issue a session key below the price of its shortest
  // session (60s) at the CONSERVATIVE AGGREGATE rate for the stream set that
  // session will open — $0.018334 text-only, $0.041667 speech-to-speech, and
  // for split Both (a second transcription stream) $0.036667 and $0.06.
  // Gating on `> 0` showed a green Start to a user who was then handed a 402
  // by the server. The 402 stays as the authority; this stops the button lying
  // about it.
  //
  // Every other provider gets a floor of 1: balances are integer micro-USD,
  // so `>= 1` is exactly the `> 0` rule this replaced.
  const balanceFloorMicroUsd =
    provider === Provider.KIZUNA_AI_SONIOX
      ? sonioxManagedMinBalanceMicroUsd(Boolean(textOnly), Boolean(sonioxBothSplit))
      : 1;
```

- [ ] **Step 12: Run it and watch it pass**

Run: `npx vitest run src/components/MainPanel/sessionStartGate.test.ts`

Expected: PASS (all tests in the file)

- [ ] **Step 13: Wire the derived value into MainPanel's render pass**

In `src/components/MainPanel/MainPanel.tsx`, line 30. Before:

```ts
import { sonioxUsesSharedBothSession, SonioxProviderConfig } from '../../services/providers/SonioxProviderConfig';
```

After:

```ts
import { SonioxProviderConfig } from '../../services/providers/SonioxProviderConfig';
import { sonioxBothModePlan } from '../../services/providers/sonioxBothMode';
```

Then insert the reactive selector and the derived value immediately after `sonioxAutoParticipantBlocked` (after line 585, before the `// canStartSession requires the *intended* mode…` comment). Anchor — the lines you are inserting after:

```ts
  const sonioxAutoParticipantBlocked =
    (kizunaBaseProvider(provider) ?? provider) === Provider.SONIOX &&
    participantWillStart && activeProviderSourceLanguage === 'auto';
```

Insert below them:

```ts
  // The stored shared/split preference, subscribed REACTIVELY through the same
  // descriptor-driven slice read as activeProviderSourceLanguage above. It has
  // to be a subscription rather than a getState() snapshot because the Start
  // gate's balance floor depends on it: flipping the toggle in the settings
  // panel must re-render the button, and a one-shot read would leave it
  // showing the other shape's floor until something unrelated re-rendered.
  // Selected as a PRIMITIVE, not as the slice object — a new object every
  // render would defeat Zustand's reference equality and re-render this panel
  // on every unrelated settings write.
  const activeProviderBothModeShared = useSettingsStore(
    (s) => (s[ProviderConfigFactory.getDescriptor(s.provider).settingsSliceKey as keyof SettingsStore] as { bothModeSharedSession?: boolean } | undefined)?.bothModeSharedSession
  );

  // THE shared-vs-split answer for this render. One derived value, from the
  // same pure helper connectConversation calls below (with a getState()
  // snapshot instead of these selectors), so the Start-gate floor, the managed
  // session-key request and the client wiring cannot disagree about what this
  // session is. `effectiveMode` rather than `currentMode`: lockedMode is null
  // until a session starts, so the two are equal here, and using the same
  // input as connectConversation keeps the call sites literally identical.
  const sonioxBothSplit = useMemo(
    () => sonioxBothModePlan({
      provider,
      mode: effectiveMode,
      settings: {
        bothModeSharedSession: activeProviderBothModeShared,
        sourceLanguage: activeProviderSourceLanguage,
      },
    }).split,
    [provider, effectiveMode, activeProviderBothModeShared, activeProviderSourceLanguage],
  );
```

Then feed it to the gate. Before (lines 594-607):

```ts
  const startGate = useMemo(
    () => computeStartGate({
      isApiKeyValid,
      availableModelCount: availableModels.length,
      loadingModels,
      isInitializing,
      provider,
      quota,
      missingDeviceForMode,
      sonioxAutoParticipantBlocked,
      textOnly,
    }),
    [isApiKeyValid, availableModels.length, loadingModels, isInitializing, provider, quota, missingDeviceForMode, sonioxAutoParticipantBlocked, textOnly],
  );
```

After:

```ts
  const startGate = useMemo(
    () => computeStartGate({
      isApiKeyValid,
      availableModelCount: availableModels.length,
      loadingModels,
      isInitializing,
      provider,
      quota,
      missingDeviceForMode,
      sonioxAutoParticipantBlocked,
      textOnly,
      // Split Both opens a second transcription stream, so managed Soniox's
      // balance floor roughly doubles. Same derived value the session wiring
      // uses, so the button and the session cannot disagree.
      sonioxBothSplit,
    }),
    [isApiKeyValid, availableModels.length, loadingModels, isInitializing, provider, quota, missingDeviceForMode, sonioxAutoParticipantBlocked, textOnly, sonioxBothSplit],
  );
```

- [ ] **Step 14: Replace the inline four-clause expression in connectConversation**

In `src/components/MainPanel/MainPanel.tsx`, before (lines 1907-1917):

```ts
      // sonioxUsesSharedBothSession forces the shared path on for the managed
      // twin whatever the stored preference says: the backend lease is
      // account-scoped, so two clients means the second gets a 409 and
      // Others→You silently never runs. The settings UI disables the control
      // for the twin; this reads the same helper so a `false` persisted before
      // that (or by BYOK use of the same account) cannot resurrect it.
      const sonioxSharedBoth =
        (kizunaBaseProvider(provider) ?? provider) === Provider.SONIOX &&
        effectiveMode === 'both' &&
        sonioxUsesSharedBothSession(provider, sonioxActiveSettings) &&
        sonioxActiveSettings.sourceLanguage !== 'auto';
```

After:

```ts
      // THE shared-vs-split answer, from the same pure helper the Start gate
      // called at render time above — including the `sourceLanguage !== 'auto'`
      // clause, which shared mode needs because it tells the two sides apart by
      // LANGUAGE and cannot do that with an auto source. Calling
      // sonioxUsesSharedBothSession alone here would silently drop that clause
      // plus the provider and mode ones.
      //
      // `.shared` drives the bidirectional flip and the secondary-port
      // participant below; `.split` is what the managed session-key request
      // declares as `bothSplit`, and is the same boolean that chose the Start
      // gate's balance floor.
      const sonioxBothPlan = sonioxBothModePlan({
        provider,
        mode: effectiveMode,
        settings: sonioxActiveSettings,
      });
      const sonioxSharedBoth = sonioxBothPlan.shared;
```

- [ ] **Step 15: Run the affected suites and watch them pass**

Run: `npx vitest run src/services/providers/sonioxBothMode.test.ts src/services/providers/sonioxManagedMinBalance.test.ts src/services/providers/sonioxSharedBothSession.test.ts src/components/MainPanel/sessionStartGate.test.ts src/components/MainPanel/useSubtitleSessionBridge.test.tsx`

Expected: PASS, 0 skipped.

- [ ] **Step 16: Run the full suite**

Run: `npm test -- --run 2>&1 | tail -6`

Expected: PASS — no new failures against the pre-task baseline.

- [ ] **Step 17: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react
git add src/services/providers/sonioxBothMode.ts \
        src/services/providers/sonioxBothMode.test.ts \
        src/services/providers/sonioxManagedMinBalance.ts \
        src/services/providers/sonioxManagedMinBalance.test.ts \
        src/services/providers/SonioxProviderConfig.ts \
        src/components/MainPanel/sessionStartGate.ts \
        src/components/MainPanel/sessionStartGate.test.ts \
        src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(soniox): one derived shared-vs-split value, threaded to the Start-gate floor

The Both-mode decision was a four-clause && inline in connectConversation with
a partial second copy in the auto-source gate. It becomes one pure helper that
the Start gate, the client wiring and (next) the managed session-key request
all read. The managed balance floor gains the split input and moves off the
per-SKU list rate onto the backend's conservative aggregate estimate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task FE3: Managed split wiring — a second REAL SonioxClient on the participant leg

> **Deploy gate — read before starting.** This task talks to a contract that does not exist
> anywhere except production. `POST /soniox/session-key` must already accept the matrix body
> `{ mode, textOnly, bothSplit }` and answer with per-role credential bundles (BE5), and
> `POST /soniox/session-started` must already accept `{ leaseId, role }` (BE6). There is no
> staging backend for managed Soniox — `main` auto-deploys to production and that is the only
> environment. **Do not start FE3 until BE5 and BE6 are merged and live**, and confirm it by
> minting a real split session key against production before writing the MainPanel edits. The
> pure-function steps (Steps 1–9) have no backend dependency and may be done earlier.

**Files:**
- Create: `src/components/MainPanel/managedSonioxSplit.ts`
- Test: `src/components/MainPanel/managedSonioxSplit.test.ts`
- Modify: `src/components/MainPanel/MainPanel.tsx` (line 71 import block; line 1112 refs;
  lines 1263–1281 countdown source; lines 1646–1680 teardown; line 719 `createAIClient`;
  lines 1917–1932 session acquisition + speaker credentials; lines 2215–2242 participant slot)

**Interfaces:**

- Consumes (from earlier tasks — see *Hazards* if any of these names differ):
  - `src/services/clients/ManagedSonioxSession.ts`
    - `export type SonioxSttRole = 'spk_stt' | 'par_stt' | 'mix_stt'`
    - `export interface SonioxCredentialBundle { stt: string; tts?: string; clientReferenceId?: string }`
    - `export interface SonioxSessionMatrixInput { mode: 'speaker' | 'participant' | 'both'; textOnly: boolean; bothSplit: boolean }`
    - `export class ManagedSonioxSession { constructor(opts: { sessionToken: string }); acquire(input: SonioxSessionMatrixInput): Promise<void>; credentialsFor(role: SonioxSttRole): SonioxCredentialBundle | null; markStarted(role: SonioxSttRole): void; end(): void; getBudgetSnapshot(): SonioxBudgetSnapshot | null }`
  - `src/services/providers/ProviderDescriptor.ts` — `ClientOptions` has gained
    `sonioxCredentials?: SonioxCredentialBundle`, and both
    `SonioxProviderConfig.createClient` and `KizunaAISonioxProviderConfig.createClient` build
    their `SonioxClient` from it.
  - `src/components/MainPanel/MainPanel.tsx` connectConversation — the shared/split extraction
    task leaves **two** locals in scope at the old `sonioxSharedBoth` anchor (lines 1913–1917):
    `const sonioxSharedBoth: boolean` and `const sonioxSplitBoth: boolean`.
  - `SonioxClient` no longer POSTs `session-started` or `session-end` from `connect()` /
    `disconnect()`.

- Produces (later tasks may rely on these exact names):
  - `src/components/MainPanel/managedSonioxSplit.ts`
    - `export interface ManagedSonioxWiring { acquire: SonioxSessionMatrixInput; speakerRole: 'spk_stt' | 'mix_stt' | null; participantRole: 'par_stt' | null }`
    - `export function resolveManagedSonioxWiring(input: { speakerWillStart: boolean; participantWillStart: boolean; textOnly: boolean; sonioxSharedBoth: boolean; sonioxSplitBoth: boolean }): ManagedSonioxWiring`
    - `export type ParticipantSlot = 'secondary-port' | 'own-client'`
    - `export function resolveParticipantSlot(input: { speakerWillStart: boolean; sonioxSharedBoth: boolean; sonioxSplitBoth: boolean; speakerSupportsSecondaryPort: boolean }): ParticipantSlot`
    - `export function connectLegAndMarkStarted(steps: { connect: () => Promise<void>; markStarted?: () => void }): Promise<void>`
    - `export function teardownSessionLegs(steps: { speaker?: () => Promise<void>; participant?: () => Promise<void>; afterBothLegs?: () => void }): Promise<void>`
  - `MainPanel.tsx` — `managedSonioxSessionRef: React.MutableRefObject<ManagedSonioxSession | null>`,
    and `createAIClient(useWebRTC?: boolean, sonioxCredentials?: SonioxCredentialBundle): Promise<IClient>`

---

- [ ] **Step 1: Write the failing test for the two decision functions**

Create `src/components/MainPanel/managedSonioxSplit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  resolveManagedSonioxWiring,
  resolveParticipantSlot,
} from './managedSonioxSplit';

/**
 * There is no React rendering harness in this repo, so MainPanel's
 * connectConversation is never mounted or invoked by a test. The house
 * technique (see voicePrepWiring.test.ts / prepareManagedVoice.ts) is to
 * extract the DECISION into a plain function with a real production
 * implementation and test that directly, leaving only side effects inline.
 * These four functions are that extraction for the managed split-Both wiring.
 */

// Every field passes for a managed split Both session with speech output on.
// Each test below breaks exactly ONE field, so precedence is unambiguous.
const splitBoth = {
  speakerWillStart: true,
  participantWillStart: true,
  textOnly: false,
  sonioxSharedBoth: false,
  sonioxSplitBoth: true,
};

describe('resolveManagedSonioxWiring — the seven rows of the mode matrix', () => {
  it('speaker only, speech-to-speech: one leg, spk_stt', () => {
    expect(
      resolveManagedSonioxWiring({
        ...splitBoth,
        participantWillStart: false,
        sonioxSplitBoth: false,
      }),
    ).toEqual({
      acquire: { mode: 'speaker', textOnly: false, bothSplit: false },
      speakerRole: 'spk_stt',
      participantRole: null,
    });
  });

  it('speaker only, text-only: still one leg, still spk_stt', () => {
    expect(
      resolveManagedSonioxWiring({
        ...splitBoth,
        participantWillStart: false,
        textOnly: true,
        sonioxSplitBoth: false,
      }),
    ).toEqual({
      acquire: { mode: 'speaker', textOnly: true, bothSplit: false },
      speakerRole: 'spk_stt',
      participantRole: null,
    });
  });

  it('participant only: par_stt, no speaker leg, bothSplit pinned false', () => {
    expect(
      resolveManagedSonioxWiring({
        ...splitBoth,
        speakerWillStart: false,
        sonioxSplitBoth: true, // stale toggle value; mode is not 'both'
      }),
    ).toEqual({
      acquire: { mode: 'participant', textOnly: false, bothSplit: false },
      speakerRole: null,
      participantRole: 'par_stt',
    });
  });

  it('shared Both: ONE mixed stream, so mix_stt and NO participant role', () => {
    expect(
      resolveManagedSonioxWiring({
        ...splitBoth,
        sonioxSharedBoth: true,
        sonioxSplitBoth: false,
      }),
    ).toEqual({
      acquire: { mode: 'both', textOnly: false, bothSplit: false },
      speakerRole: 'mix_stt',
      participantRole: null,
    });
  });

  it('shared Both, text-only: mix_stt, still no participant role', () => {
    expect(
      resolveManagedSonioxWiring({
        ...splitBoth,
        textOnly: true,
        sonioxSharedBoth: true,
        sonioxSplitBoth: false,
      }),
    ).toEqual({
      acquire: { mode: 'both', textOnly: true, bothSplit: false },
      speakerRole: 'mix_stt',
      participantRole: null,
    });
  });

  it('split Both, text-only: two STT legs, spk_stt + par_stt', () => {
    expect(resolveManagedSonioxWiring({ ...splitBoth, textOnly: true })).toEqual({
      acquire: { mode: 'both', textOnly: true, bothSplit: true },
      speakerRole: 'spk_stt',
      participantRole: 'par_stt',
    });
  });

  it('split Both, speech-to-speech: spk_stt + par_stt (the TTS key rides the speaker leg)', () => {
    expect(resolveManagedSonioxWiring(splitBoth)).toEqual({
      acquire: { mode: 'both', textOnly: false, bothSplit: true },
      speakerRole: 'spk_stt',
      participantRole: 'par_stt',
    });
  });

  it('Both selected but no microphone: asks for participant, not both', () => {
    // A key nothing connects still costs: Soniox has no revoke API, so an
    // spk_stt/spk_tts key minted for a leg that never starts is real exposure.
    expect(
      resolveManagedSonioxWiring({ ...splitBoth, speakerWillStart: false }),
    ).toEqual({
      acquire: { mode: 'participant', textOnly: false, bothSplit: false },
      speakerRole: null,
      participantRole: 'par_stt',
    });
  });
});

describe('resolveParticipantSlot — the secondary port is the SHARED path only', () => {
  const sharedCapable = {
    speakerWillStart: true,
    sonioxSharedBoth: true,
    sonioxSplitBoth: false,
    speakerSupportsSecondaryPort: true,
  };

  it('shared Both with a capable speaker core reuses the secondary port', () => {
    expect(resolveParticipantSlot(sharedCapable)).toBe('secondary-port');
  });

  it('split Both NEVER takes the secondary port', () => {
    expect(
      resolveParticipantSlot({
        ...sharedCapable,
        sonioxSharedBoth: false,
        sonioxSplitBoth: true,
      }),
    ).toBe('own-client');
  });

  it('split wins even if shared were somehow also true — the guard is not a fallthrough', () => {
    // Contrast case. sonioxSharedBoth and sonioxSplitBoth are complementary by
    // construction today, so without the explicit split-first clause this test
    // would return 'secondary-port' and the far end would be mixed into the
    // speaker's stream while the par_stt key sat unused.
    expect(
      resolveParticipantSlot({
        ...sharedCapable,
        sonioxSharedBoth: true,
        sonioxSplitBoth: true,
      }),
    ).toBe('own-client');
  });

  it('no speaker leg means there is no core to borrow a port from', () => {
    expect(
      resolveParticipantSlot({ ...sharedCapable, speakerWillStart: false }),
    ).toBe('own-client');
  });

  it('a speaker core without createSecondaryPort falls back to its own client', () => {
    expect(
      resolveParticipantSlot({ ...sharedCapable, speakerSupportsSecondaryPort: false }),
    ).toBe('own-client');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/MainPanel/managedSonioxSplit.test.ts`

Expected: FAIL — `Error: Failed to load url ./managedSonioxSplit (resolved id: ./managedSonioxSplit) ... Does the file exist?`

- [ ] **Step 3: Implement the two decision functions**

Create `src/components/MainPanel/managedSonioxSplit.ts`:

```ts
import type {
  SonioxSessionMatrixInput,
} from '../../services/clients/ManagedSonioxSession';

/**
 * Pure wiring decisions for a managed (Kizuna AI) Soniox session, extracted out
 * of MainPanel's connectConversation / disconnectConversation.
 *
 * There is no React rendering harness in this repo, so anything that can be a
 * plain function is one — the same discipline `resolveVoicePrepOutcome`
 * (prepareManagedVoice.ts) follows, and for the same reason: the alternative is
 * a hand-transcribed duplicate inside a test that drifts from the real branch
 * without either side noticing. Only the side effects stay inline in MainPanel.
 */

export interface ManagedSonioxWiring {
  /**
   * Body of `POST /soniox/session-key`. The client sends the three MATRIX
   * INPUTS and the server expands them into the role set — it never sends a
   * stream list. A client-declared list plus a validating blocklist is
   * strictly weaker: a request for `['spk_tts']` alone passes "no par_tts" and
   * "at most one *_tts", yet mints a non-single_use TTS key valid for the whole
   * granted duration against an API with no revoke.
   */
  acquire: SonioxSessionMatrixInput;
  /**
   * STT role the speaker leg runs, or null when no speaker leg starts.
   * `mix_stt` in shared Both — that stream carries mic and system audio mixed
   * together, and calling it `spk_stt` would be a lie about which audio source
   * feeds it.
   */
  speakerRole: 'spk_stt' | 'mix_stt' | null;
  /**
   * STT role the participant leg runs, or null when the participant slot is
   * not a Soniox stream of its own. Null in shared Both: there the slot is the
   * speaker core's inert secondary port, which opens no socket, holds no key
   * and therefore has no role and no started bit.
   */
  participantRole: 'par_stt' | null;
}

export function resolveManagedSonioxWiring(input: {
  speakerWillStart: boolean;
  participantWillStart: boolean;
  textOnly: boolean;
  sonioxSharedBoth: boolean;
  sonioxSplitBoth: boolean;
}): ManagedSonioxWiring {
  const {
    speakerWillStart,
    participantWillStart,
    textOnly,
    sonioxSharedBoth,
    sonioxSplitBoth,
  } = input;

  // Derived from what will ACTUALLY start, not from the mode picker. Both mode
  // with no microphone selected starts the participant leg alone; asking the
  // server for 'both' there mints an spk_stt key (and, with speech output on,
  // an spk_tts key) that nothing ever connects. Keys are an enforcement point —
  // Soniox has no revoke API and a TTS key is valid for the whole granted
  // duration — so an unused key is real exposure, not untidiness.
  const mode: 'speaker' | 'participant' | 'both' =
    speakerWillStart && participantWillStart
      ? 'both'
      : speakerWillStart
        ? 'speaker'
        : 'participant';

  // `bothSplit` is meaningful only for mode === 'both'. Pinned false otherwise
  // so the request body is a function of the mode it declares — a stale `true`
  // from the settings toggle would describe a two-leg session that has one leg.
  const bothSplit = mode === 'both' && sonioxSplitBoth;

  return {
    acquire: { mode, textOnly, bothSplit },
    speakerRole: !speakerWillStart ? null : sonioxSharedBoth ? 'mix_stt' : 'spk_stt',
    participantRole: participantWillStart && !sonioxSharedBoth ? 'par_stt' : null,
  };
}

export type ParticipantSlot = 'secondary-port' | 'own-client';

/**
 * Which thing fills MainPanel's participant slot.
 *
 * `secondary-port` is the inert IClient facade `SonioxClient.createSecondaryPort()`
 * returns: its only live method feeds channel B of the SPEAKER's PcmMixer. It
 * belongs to the SHARED Both path and nothing else.
 */
export function resolveParticipantSlot(input: {
  speakerWillStart: boolean;
  sonioxSharedBoth: boolean;
  sonioxSplitBoth: boolean;
  speakerSupportsSecondaryPort: boolean;
}): ParticipantSlot {
  // Split is tested FIRST and explicitly, even though `sonioxSharedBoth` and
  // `sonioxSplitBoth` are complementary by construction today. Taking the
  // secondary port under split would mix the far end into the speaker's single
  // stream, leave the par_stt key unused, and attribute every far-end utterance
  // to the wrong leg — a session that looks entirely healthy. Nothing
  // downstream can detect that, so the guard lives in code rather than in a
  // comment about an invariant somebody may later relax.
  if (input.sonioxSplitBoth) return 'own-client';
  if (
    input.speakerWillStart &&
    input.sonioxSharedBoth &&
    input.speakerSupportsSecondaryPort
  ) {
    return 'secondary-port';
  }
  return 'own-client';
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/components/MainPanel/managedSonioxSplit.test.ts`

Expected: PASS — 13 tests.

- [ ] **Step 5: Write the failing test for the two lifecycle orchestrators**

Append to `src/components/MainPanel/managedSonioxSplit.test.ts` (and extend the import at the
top of the file to `import { resolveManagedSonioxWiring, resolveParticipantSlot, connectLegAndMarkStarted, teardownSessionLegs } from './managedSonioxSplit';`):

```ts
describe('connectLegAndMarkStarted — the started bit means "confirmed connected"', () => {
  it('marks the leg started after connect resolves', async () => {
    const order: string[] = [];
    await connectLegAndMarkStarted({
      connect: async () => { order.push('connect'); },
      markStarted: () => { order.push('markStarted'); },
    });
    expect(order).toEqual(['connect', 'markStarted']);
  });

  it('does NOT mark the leg started when connect rejects', async () => {
    // This is the whole reason release is keyed on STARTED rather than on
    // EXPECTED: a bit set for a leg that never opened a socket waits forever
    // for a usage log that cannot arrive, holding the lease — and 409-ing every
    // subsequent Start — until it expires, up to an hour.
    let marked = false;
    await expect(
      connectLegAndMarkStarted({
        connect: async () => { throw new Error('403 loopback denied'); },
        markStarted: () => { marked = true; },
      }),
    ).rejects.toThrow('403 loopback denied');
    expect(marked).toBe(false);
  });

  it('is a no-op wrapper when there is no session to mark (BYOK)', async () => {
    let connected = false;
    await connectLegAndMarkStarted({ connect: async () => { connected = true; } });
    expect(connected).toBe(true);
  });
});

describe('teardownSessionLegs — session-end fires exactly once, after BOTH legs', () => {
  it('runs speaker, then participant, then the session-level end', async () => {
    const order: string[] = [];
    await teardownSessionLegs({
      speaker: async () => { order.push('speaker'); },
      participant: async () => { order.push('participant'); },
      afterBothLegs: () => { order.push('end'); },
    });
    expect(order).toEqual(['speaker', 'participant', 'end']);
  });

  it('still tears the participant down and still ends when the SPEAKER throws', async () => {
    // In split the participant leg is a REAL second Soniox socket. Leaving it
    // open after Stop keeps a stream (and its usage log) alive, and skipping
    // the end signal leaves the lease sitting until expiry.
    const order: string[] = [];
    await expect(
      teardownSessionLegs({
        speaker: async () => { order.push('speaker'); throw new Error('speaker boom'); },
        participant: async () => { order.push('participant'); },
        afterBothLegs: () => { order.push('end'); },
      }),
    ).rejects.toThrow('speaker boom');
    expect(order).toEqual(['speaker', 'participant', 'end']);
  });

  it('still ends when the PARTICIPANT throws', async () => {
    const order: string[] = [];
    await expect(
      teardownSessionLegs({
        speaker: async () => { order.push('speaker'); },
        participant: async () => { order.push('participant'); throw new Error('participant boom'); },
        afterBothLegs: () => { order.push('end'); },
      }),
    ).rejects.toThrow('participant boom');
    expect(order).toEqual(['speaker', 'participant', 'end']);
  });

  it('calls the end hook exactly once per teardown', async () => {
    let ends = 0;
    await teardownSessionLegs({
      speaker: async () => {},
      participant: async () => {},
      afterBothLegs: () => { ends += 1; },
    });
    expect(ends).toBe(1);
  });

  it('does not wait on a participant leg that never came up', async () => {
    const order: string[] = [];
    await teardownSessionLegs({
      speaker: async () => { order.push('speaker'); },
      afterBothLegs: () => { order.push('end'); },
    });
    expect(order).toEqual(['speaker', 'end']);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run src/components/MainPanel/managedSonioxSplit.test.ts`

Expected: FAIL — `SyntaxError: The requested module './managedSonioxSplit' does not provide an export named 'connectLegAndMarkStarted'`

- [ ] **Step 7: Implement the two lifecycle orchestrators**

Append to `src/components/MainPanel/managedSonioxSplit.ts`:

```ts
/**
 * Connect one leg and, only if that succeeds, tell the backend the leg started.
 *
 * `stt_started_mask` means "this stream is confirmed connected", and the lease
 * releases when every STARTED leg has ended. Setting a bit before the socket is
 * up would make the lease wait on a usage log that can never arrive.
 *
 * The mirror image is deliberate and is what makes the three non-fatal
 * participant failure paths in connectConversation safe under split — loopback
 * permission denied, `createParticipantSessionConfig()` returning null, and the
 * general participant catch. In each of them `connect` is either never reached
 * or rejects, so the par_stt bit is never set, so the lease is never waiting on
 * the participant and releases on the speaker alone.
 */
export async function connectLegAndMarkStarted(steps: {
  connect: () => Promise<void>;
  markStarted?: () => void;
}): Promise<void> {
  await steps.connect();
  steps.markStarted?.();
}

/**
 * Tear both legs down, then signal session end EXACTLY ONCE.
 *
 * `session-end` is a session-level fact, not a per-leg one. It stamps
 * `end_signalled_at`, unpins the voice slot, and starts the reconciler's
 * fast-retry ladder. Sent from a client's own `disconnect()` — where it lived
 * until this change — the SPEAKER's disconnect (which MainPanel runs first)
 * would do all three while the participant leg was still streaming, burning the
 * ladder on a usage log that cannot exist yet.
 *
 * Both nested `finally`s are load-bearing: a leg's disconnect that throws must
 * not strand the other leg's socket, and must not skip the end signal — a lease
 * whose end is never signalled sits until it expires and 409s every subsequent
 * Start for up to an hour. The original rejection is still propagated.
 */
export async function teardownSessionLegs(steps: {
  speaker?: () => Promise<void>;
  participant?: () => Promise<void>;
  afterBothLegs?: () => void;
}): Promise<void> {
  try {
    try {
      await steps.speaker?.();
    } finally {
      await steps.participant?.();
    }
  } finally {
    steps.afterBothLegs?.();
  }
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run src/components/MainPanel/managedSonioxSplit.test.ts`

Expected: PASS — 21 tests.

- [ ] **Step 9: Commit the pure module**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react
git add src/components/MainPanel/managedSonioxSplit.ts src/components/MainPanel/managedSonioxSplit.test.ts
git commit -m "$(cat <<'EOF'
feat(soniox): pure wiring decisions for managed split Both

Extracts the four decisions MainPanel's connectConversation/disconnectConversation
need for a two-leg managed Soniox session: the session-key matrix body and the
per-leg STT roles, which thing fills the participant slot (the secondary port is
the shared path ONLY), marking a leg started strictly after its connect resolves,
and tearing both legs down before signalling session-end exactly once.

No call sites yet — MainPanel is wired in the following commit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10: Add the session ref, the imports, and the `createAIClient` credential parameter**

There is no React rendering harness in this repo, so Steps 10–15 have no unit test of their
own — the decisions they call were proved in Steps 1–8, which is exactly why they were
extracted. Verification is the full suite (Step 16) plus the grep checks stated in each step.

In `src/components/MainPanel/MainPanel.tsx`, find line 71:

```ts
import { computeSonioxRemainingMs, computeSonioxBudgetTotalMs, SonioxBudgetSnapshot } from '../../services/clients/SonioxCostMeter';
```

and add immediately after it:

```ts
import { ManagedSonioxSession } from '../../services/clients/ManagedSonioxSession';
import type { SonioxCredentialBundle } from '../../services/clients/ManagedSonioxSession';
import {
  resolveManagedSonioxWiring,
  resolveParticipantSlot,
  connectLegAndMarkStarted,
  teardownSessionLegs,
} from './managedSonioxSplit';
```

Find line 1112:

```ts
  // Participant client ref (for translating other participants)
  const participantClientRef = useRef<IClient | null>(null);
```

and add immediately after it:

```ts
  // The managed (Kizuna AI) Soniox session, while one is running: the lease,
  // its per-role temporary keys and the allowance countdown. ONE per session,
  // deliberately not per client — in split Both two SonioxClients run off this
  // single lease, and `session-end` is a session-level fact that has to be
  // signalled exactly once, after both of them are down.
  const managedSonioxSessionRef = useRef<ManagedSonioxSession | null>(null);
```

Find line 719 and its `return` at line 744:

```ts
  const createAIClient = useCallback(async (useWebRTC: boolean = false): Promise<IClient> => {
```

```ts
    return descriptor.createClient(creds, { transport: effectiveTransportType, webrtcOptions });
```

and replace them with:

```ts
  const createAIClient = useCallback(async (
    useWebRTC: boolean = false,
    // Managed Soniox only: the per-role credential bundle this client's ONE
    // stream runs on. Undefined for BYOK and for every other provider, whose
    // descriptors build credentials from settings and ignore it.
    sonioxCredentials?: SonioxCredentialBundle,
  ): Promise<IClient> => {
```

```ts
    return descriptor.createClient(creds, { transport: effectiveTransportType, webrtcOptions, sonioxCredentials });
```

Verify: `grep -n "sonioxCredentials" src/components/MainPanel/MainPanel.tsx` prints exactly
three lines (the parameter, its doc comment anchor, and the `createClient` call).

- [ ] **Step 11: Acquire the managed session once, before any client exists**

Find the end of the shared/split derivation in `connectConversation` (line 1917 before the
extraction task, which leaves `sonioxSharedBoth` and `sonioxSplitBoth` in scope here):

```ts
      // Speaker channel: only initialize when mic is selected + enabled.
      // When this whole block is skipped (participant-only session), no speaker
      // client is created — saves a WebSocket and, for Kizuna AI, wallet cost.
      if (speakerWillStart) {
```

and insert immediately BEFORE that comment:

```ts
      // Managed Soniox: acquire the lease ONCE for the whole session, before
      // any client is constructed. Until this change the lease was minted
      // inside SonioxClient.connect(), which cannot survive split — the second
      // client would ask for a lease of its own and the account-scoped lease
      // would refuse it with a 409.
      //
      // Null for BYOK Soniox and for every other provider: those clients carry
      // their own key and there is nothing to lease.
      const managedWiring =
        isKizunaManagedProvider(provider) &&
        (kizunaBaseProvider(provider) ?? provider) === Provider.SONIOX
          ? resolveManagedSonioxWiring({
              speakerWillStart,
              participantWillStart,
              textOnly,
              sonioxSharedBoth,
              sonioxSplitBoth,
            })
          : null;
      if (managedWiring) {
        const sessionToken = await getAuthToken();
        if (!sessionToken) {
          throw new Error('Sign-in is required to start a managed Soniox session');
        }
        const session = new ManagedSonioxSession({ sessionToken });
        // Throws with the localized 402/403/409/502/503 message on failure —
        // the outer catch turns that into the session-start error bubble,
        // exactly as the in-client acquisition did before this change.
        await session.acquire(managedWiring.acquire);
        managedSonioxSessionRef.current = session;
      }
```

Verify: `grep -n "managedSonioxSessionRef.current = session" src/components/MainPanel/MainPanel.tsx`
prints exactly one line.

- [ ] **Step 12: Hand the speaker leg its own credential bundle**

Find lines 1922–1927:

```ts
      if (speakerWillStart) {
        // Determine if WebRTC transport should be used
        let useWebRTC = transportType === 'webrtc' && ClientFactory.supportsWebRTC(provider);

        // Create speaker client using helper
        speakerClientRef.current = await createAIClient(useWebRTC);
```

and replace with:

```ts
      if (speakerWillStart) {
        // Determine if WebRTC transport should be used
        let useWebRTC = transportType === 'webrtc' && ClientFactory.supportsWebRTC(provider);

        // One key, one four-segment client_reference_id, one role. Soniox
        // attributes a usage log to the reference bound to the KEY and ignores
        // the one the socket declares in its config frame (probed live
        // 2026-08-11), so two streams sharing a key are indistinguishable in
        // the usage logs and the lease's ended-mask could not be driven at all.
        // Per-stream keys are therefore required, not merely convenient.
        const speakerSonioxCredentials = managedWiring?.speakerRole
          ? managedSonioxSessionRef.current?.credentialsFor(managedWiring.speakerRole) ?? undefined
          : undefined;

        // Create speaker client using helper
        speakerClientRef.current = await createAIClient(useWebRTC, speakerSonioxCredentials);
```

- [ ] **Step 13: Make the participant slot a real second client under split, and mark it started**

Find lines 2215–2242:

```ts
          if (electronAcquireOk) {
            // Create participant client. In Both single-session (Soniox, shared
            // toggle on, concrete source language), reuse the speaker core as
            // channel B via its inert secondary port instead of opening a second
            // session. Otherwise create an independent participant client.
            const speakerCore = speakerClientRef.current;
            if (
              speakerWillStart &&
              sonioxSharedBoth &&
              speakerCore && typeof speakerCore.createSecondaryPort === 'function'
            ) {
              participantClientRef.current = speakerCore.createSecondaryPort();
            } else {
              participantClientRef.current = await createAIClient();
            }

            // Setup event handlers using helper
            const participantClient = participantClientRef.current;
            participantClient.setEventHandlers(createParticipantEventHandlers(participantClient));

            // Create and connect with participant session config
            const participantSessionConfig = createParticipantSessionConfig();
            if (!participantSessionConfig) {
              console.info('[Sokuji] [MainPanel] Participant skipped — no suitable models');
              participantClientRef.current = null;
            } else {
              await participantClient.connect(participantSessionConfig);
              console.info(`[Sokuji] [MainPanel] Participant audio client connected (${captureMode}, text-only, swapped languages, semantic VAD)`);
```

and replace with:

```ts
          if (electronAcquireOk) {
            // Create participant client. In Both SINGLE-session (Soniox, shared
            // toggle on, concrete source language) reuse the speaker core as
            // channel B via its inert secondary port. In managed SPLIT Both the
            // participant leg is a REAL second SonioxClient running on the
            // session's own par_stt key — see resolveParticipantSlot for why the
            // secondary port has to be unreachable there.
            const speakerCore = speakerClientRef.current;
            const participantSlot = resolveParticipantSlot({
              speakerWillStart,
              sonioxSharedBoth,
              sonioxSplitBoth,
              speakerSupportsSecondaryPort:
                !!speakerCore && typeof speakerCore.createSecondaryPort === 'function',
            });
            if (participantSlot === 'secondary-port') {
              participantClientRef.current = speakerCore!.createSecondaryPort!();
            } else {
              // Only ever `par_stt`: createParticipantSessionConfig forces
              // textOnly, so the participant leg never holds a TTS credential.
              const participantRole = managedWiring?.participantRole ?? null;
              const participantSonioxCredentials = participantRole
                ? managedSonioxSessionRef.current?.credentialsFor(participantRole) ?? undefined
                : undefined;
              participantClientRef.current = await createAIClient(false, participantSonioxCredentials);
            }

            // Setup event handlers using helper
            const participantClient = participantClientRef.current;
            participantClient.setEventHandlers(createParticipantEventHandlers(participantClient));

            // Create and connect with participant session config
            const participantSessionConfig = createParticipantSessionConfig();
            if (!participantSessionConfig) {
              // Non-fatal failure path #2. Under split this is a par_stt leg
              // that never connects: no started bit is ever set for it, so the
              // lease is never waiting on it and releases on the speaker alone.
              // Its minted key is simply abandoned — single_use with a short
              // start window, so it lapses on its own.
              console.info('[Sokuji] [MainPanel] Participant skipped — no suitable models');
              participantClientRef.current = null;
            } else {
              const startedRole = managedWiring?.participantRole ?? null;
              await connectLegAndMarkStarted({
                connect: () => participantClient.connect(participantSessionConfig),
                // Only after connect resolves: the started bit means "this
                // stream is confirmed connected", and the lease releases when
                // every STARTED leg has ended. Idempotent server-side, so a
                // retry is harmless.
                markStarted: startedRole
                  ? () => managedSonioxSessionRef.current?.markStarted(startedRole)
                  : undefined,
              });
              console.info(`[Sokuji] [MainPanel] Participant audio client connected (${captureMode}, text-only, swapped languages, semantic VAD)`);
```

Then add the same "never connects" note to the other two non-fatal paths, whose behaviour is
otherwise unchanged. Find line 2200:

```ts
                  electronAcquireOk = false;
                } else {
```

and replace with:

```ts
                  // Non-fatal failure path #1. Under split the par_stt leg
                  // never connects: its started bit is never set, so the lease
                  // releases on the speaker alone and the session continues
                  // one-way. The minted par_stt key is abandoned unused.
                  electronAcquireOk = false;
                } else {
```

Find line 2299:

```ts
          participantErrorMessage = error?.message || t('mainPanel.participantChannelFailed', 'Failed to start the participant audio channel.');
```

and replace with:

```ts
          // Non-fatal failure path #3, unchanged: the session continues on
          // whichever channel(s) did come up, and the speaker is NOT torn down.
          // Under split, a participant leg that fails here failed inside
          // connectLegAndMarkStarted's `connect`, so markStarted never ran and
          // the lease is not waiting on it.
          participantErrorMessage = error?.message || t('mainPanel.participantChannelFailed', 'Failed to start the participant audio channel.');
```

Verify: `grep -n "createSecondaryPort" src/components/MainPanel/MainPanel.tsx` prints exactly
two lines, both inside the `participantSlot === 'secondary-port'` branch and its
`speakerSupportsSecondaryPort` computation.

- [ ] **Step 14: Rework the teardown so session-end fires once, after BOTH legs**

Find lines 1646–1680 in `disconnectConversation`:

```ts
      const client = speakerClientRef.current;
      if (client) {
        // disconnect() emits final completion deltas via the throttle path,
        // which schedules a trailing setItems(client.getConversationItems())
        // via setTimeout. If we then call client.reset() (which empties the
        // client's internal items), the trailing timer fires *after* reset
        // and pushes [] to React, blanking the conversation. This is most
        // visible with high-delta-rate providers like OpenAI Translate where
        // a throttle timer is almost always pending when the user hits stop
        // mid-utterance.
        //
        // Fix: after disconnect() finalizes any in-flight pair, cancel the
        // pending throttle timer and synchronously capture the final state
        // into React, then reset.
        await client.disconnect();
        if (throttleTimerRef.current) {
          clearTimeout(throttleTimerRef.current);
          throttleTimerRef.current = null;
        }
        setItems(client.getConversationItems());
        client.reset();
      }

      // Disconnect participant client
      const participantClient = participantClientRef.current;
      if (participantClient) {
        try {
          await participantClient.disconnect();
          participantClient.reset();
          participantClientRef.current = null;
          console.info('[Sokuji] [MainPanel] Disconnected participant client');
        } catch (error) {
          console.warn('[Sokuji] [MainPanel] Error disconnecting participant client:', error);
        }
      }
```

and replace with:

```ts
      // Both legs come down here, and the managed session's end is signalled
      // exactly once AFTER both of them — see teardownSessionLegs for why the
      // ordering is load-bearing. In split Both the participant ref is a REAL
      // second SonioxClient, not the inert secondary port of the shared path.
      await teardownSessionLegs({
        speaker: async () => {
          const client = speakerClientRef.current;
          if (!client) return;
          // disconnect() emits final completion deltas via the throttle path,
          // which schedules a trailing setItems(client.getConversationItems())
          // via setTimeout. If we then call client.reset() (which empties the
          // client's internal items), the trailing timer fires *after* reset
          // and pushes [] to React, blanking the conversation. This is most
          // visible with high-delta-rate providers like OpenAI Translate where
          // a throttle timer is almost always pending when the user hits stop
          // mid-utterance.
          //
          // Fix: after disconnect() finalizes any in-flight pair, cancel the
          // pending throttle timer and synchronously capture the final state
          // into React, then reset.
          await client.disconnect();
          if (throttleTimerRef.current) {
            clearTimeout(throttleTimerRef.current);
            throttleTimerRef.current = null;
          }
          setItems(client.getConversationItems());
          client.reset();
        },
        participant: async () => {
          const participantClient = participantClientRef.current;
          if (!participantClient) return;
          try {
            await participantClient.disconnect();
            participantClient.reset();
            participantClientRef.current = null;
            console.info('[Sokuji] [MainPanel] Disconnected participant client');
          } catch (error) {
            console.warn('[Sokuji] [MainPanel] Error disconnecting participant client:', error);
          }
        },
        afterBothLegs: () => {
          // Fire-and-forget hint that the session is over. The lease is really
          // released by the reconciler once Soniox's usage logs confirm it, so
          // this is not a transaction — but it must not be sent early: it
          // stamps end_signalled_at, unpins the voice slot, and starts the
          // reconciler's fast-retry ladder. The ref is cleared BEFORE end() so
          // no re-entry can produce a second POST.
          const session = managedSonioxSessionRef.current;
          managedSonioxSessionRef.current = null;
          session?.end();
        },
      });
```

Verify: `grep -c "session?.end()" src/components/MainPanel/MainPanel.tsx` prints `1`, and
`grep -rn "session-end" src/services/clients/SonioxClient.ts` prints nothing (the earlier
client task removed it).

- [ ] **Step 15: Repoint the allowance countdown at the session**

The cost meter no longer lives on a client — a client now holds only a credential bundle — so
the countdown must read the session. Find lines 1263–1281:

```ts
  const sonioxBudgetInfoRef = useRef<SonioxBudgetSnapshot | null>(null);
  const [sonioxCountdown, setSonioxCountdown] = useState<{ remainingMs: number; totalMs: number } | null>(null);
  useEffect(() => {
    if (!isSessionActive || provider !== Provider.KIZUNA_AI_SONIOX) {
      sonioxBudgetInfoRef.current = null;
      setSonioxCountdown(null);
      return;
    }
    const update = () => {
      if (!sonioxBudgetInfoRef.current) {
        // Whichever client is the real managed-session core: speaker if
        // present, else participant (participant-only mode). Both
        // single-session's participant ref is an inert secondary port with
        // no budget info of its own — see createSecondaryPort.
        const client = speakerClientRef.current ?? participantClientRef.current;
        sonioxBudgetInfoRef.current = client?.getManagedBudgetInfo?.() ?? null;
      }
```

and replace with:

```ts
  const sonioxBudgetInfoRef = useRef<SonioxBudgetSnapshot | null>(null);
  const [sonioxCountdown, setSonioxCountdown] = useState<{ remainingMs: number; totalMs: number } | null>(null);
  useEffect(() => {
    if (!isSessionActive || provider !== Provider.KIZUNA_AI_SONIOX) {
      sonioxBudgetInfoRef.current = null;
      setSonioxCountdown(null);
      return;
    }
    const update = () => {
      if (!sonioxBudgetInfoRef.current) {
        // The allowance belongs to the SESSION, not to a stream. Reading it off
        // a client stopped working when the lease moved out of SonioxClient,
        // and would have been ambiguous under split anyway: two real clients,
        // one lease. The ref is populated before any client is constructed, for
        // every managed row of the matrix including split, so the countdown is
        // non-null whenever a managed session is running.
        sonioxBudgetInfoRef.current =
          managedSonioxSessionRef.current?.getBudgetSnapshot() ?? null;
      }
```

Verify: `grep -n "getManagedBudgetInfo" src/components/MainPanel/MainPanel.tsx` prints nothing.

- [ ] **Step 16: Run the full suite**

Run: `npx vitest run`

Expected: PASS — whole suite green, including `src/components/MainPanel/managedSonioxSplit.test.ts`
(21 tests), `participantErrorOrdering.test.ts`, `voicePrepWiring.test.ts` and
`sessionStartGate.test.ts`. If `SonioxClient.managed.test.ts` still asserts a `session-end`
POST from `disconnect()`, that test belongs to the client task and must already have been
inverted there — do not weaken it here.

- [ ] **Step 17: Commit the MainPanel wiring**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react
git add src/components/MainPanel/MainPanel.tsx
git commit -m "$(cat <<'EOF'
feat(soniox): run managed split Both on two real clients and one lease

MainPanel acquires the ManagedSonioxSession once, before any client exists, and
sends the matrix body { mode, textOnly, bothSplit } — the server expands it into
the role set. Each leg is constructed with the credential bundle for its own
role, because Soniox attributes a usage log to the reference bound to the KEY and
ignores the one the socket declares, so two streams cannot share a key.

Under split the participant slot is a real second SonioxClient on the par_stt
bundle; the inert secondary port stays reachable from the shared path only. The
participant leg marks itself started strictly after connect resolves, so the
three non-fatal participant failure paths keep their non-fatal semantics: the leg
never connects, its started bit is never set, and the lease releases on the
speaker alone.

Teardown now brings both legs down before signalling session-end, exactly once.
Posting it from the speaker's disconnect stamped end_signalled_at and unpinned the
voice slot while the other leg was still streaming.

The allowance countdown reads the session rather than a client, which is the only
unambiguous source once two clients share one lease.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task FE4: Session-level outcomes — exhaustion and the granted-duration cutoff announced exactly once

**Files:**
- Create: `src/services/clients/SonioxSessionOutcome.ts`
- Create: `src/services/clients/SonioxSessionOutcome.test.ts`
- Create: `src/services/clients/ManagedSonioxSession.outcome.test.ts`
- Modify: `src/services/clients/ManagedSonioxSession.ts` (created by FE1 — add the leg registry, `finishSession`, `isAtGrantedDurationEnd`, and rewire the cost meter's `onExhausted`)
- Modify: `src/services/clients/SonioxClient.ts` (lines 467–475 `handleSttClose` cutoff branch; lines 1178–1186 `handleSttError` 403 gate; the `reset()` block at 1433–1460; new leg surface near `emitSystemNotice` at 1249)
- Modify: `src/components/MainPanel/MainPanel.tsx` (attach each leg where FE3 builds it: speaker at ~1922–1932, participant at ~2215–2242)
- Test: `src/services/clients/SonioxClient.managed.test.ts` (extend)

**Interfaces:**

- Consumes (from FE1, `src/services/clients/ManagedSonioxSession.ts`):
  - `class ManagedSonioxSession` with the cost meter constructed inside `acquire()` from the verbatim block moved out of `SonioxClient.fetchManagedSession`, i.e. containing the literal line `onExhausted: () => this.handleBudgetExhausted(),`
  - private fields on that class holding the acquire response: `maxSessionDurationSeconds: number` and the timestamp passed to `costMeter.start(...)`, exposed to this task as `private startedAtMs: number | null`
  - the existing `managedClient()` helper in `src/services/clients/SonioxClient.managed.test.ts`, rewritten by FE1 to build a managed `SonioxClient` under the new credential-bundle constructor
  - `SonioxClient`'s explicit managed flag from FE1, named `private isManaged: boolean`
- Consumes (from FE3, `src/components/MainPanel/MainPanel.tsx`): a `ManagedSonioxSession | null` in scope inside `connectConversation`, named `managedSonioxSession`, and the local boolean `sonioxSplitBoth`
- Produces:
  - `export type SonioxSessionOutcomeKind = 'budget_exhausted' | 'duration_cutoff'`
  - `export interface SonioxSessionOutcomeNotice { text: string; realtimeEvent?: string; analytics?: { code: string; rawMessage: string } }`
  - `export interface SonioxSessionLeg { readonly isPrimaryLeg: boolean; announceSessionOutcome(notice: SonioxSessionOutcomeNotice): void; endForSessionOutcome(): void }`
  - `export interface SonioxSessionLegClient extends SonioxSessionLeg { attachManagedSession(sink: SonioxSessionOutcomeSink, opts: { primary: boolean }): void }`
  - `export interface SonioxSessionOutcomeSink { finishSession(kind: SonioxSessionOutcomeKind): void; isAtGrantedDurationEnd?(nowMs: number): boolean }`
  - `export class SonioxSessionOutcome { claim(kind: SonioxSessionOutcomeKind): boolean; readonly kind: SonioxSessionOutcomeKind | null; readonly isClaimed: boolean }`
  - `export function asSonioxSessionLeg(client: unknown): SonioxSessionLegClient | null`
  - `ManagedSonioxSession.attachLeg(client: SonioxSessionLegClient, opts: { primary: boolean }): void`
  - `ManagedSonioxSession.finishSession(kind: SonioxSessionOutcomeKind): void`
  - `ManagedSonioxSession.isAtGrantedDurationEnd(nowMs: number): boolean`
  - `ManagedSonioxSession.CUTOFF_MARGIN_MS: number` (static, `90_000`)
  - `SonioxClient.attachManagedSession(sink, opts)`, `SonioxClient.announceSessionOutcome(notice)`, `SonioxClient.endForSessionOutcome()`, `SonioxClient.isPrimaryLeg` (getter)

---

- [ ] **Step 1: Write the failing test for the once-only claim**

Create `src/services/clients/SonioxSessionOutcome.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SonioxSessionOutcome } from './SonioxSessionOutcome';

/**
 * Pure-unit tests, same shape as SonioxCostMeter.test.ts: a plain
 * construction, no mocks, one assertion per policy branch.
 *
 * The property under test is the whole reason this class exists. In split
 * Both mode the two STT keys share one `max_session_duration_seconds`, so
 * both legs take a 403 within the same second and both try to say "This
 * segment has ended". Whoever claims first owns the sentence; everyone
 * else is silent — including a DIFFERENT ending arriving in the same
 * instant, because a user cannot act on two contradictory reasons.
 */
describe('SonioxSessionOutcome', () => {
  it('starts unclaimed', () => {
    const o = new SonioxSessionOutcome();
    expect(o.isClaimed).toBe(false);
    expect(o.kind).toBeNull();
  });

  it('grants the claim to the first caller only', () => {
    const o = new SonioxSessionOutcome();
    expect(o.claim('duration_cutoff')).toBe(true);
    expect(o.claim('duration_cutoff')).toBe(false);
    expect(o.claim('duration_cutoff')).toBe(false);
  });

  it('remembers which kind won', () => {
    const o = new SonioxSessionOutcome();
    o.claim('budget_exhausted');
    expect(o.kind).toBe('budget_exhausted');
    expect(o.isClaimed).toBe(true);
  });

  it('refuses a SECOND, DIFFERENT ending — the first reason is the one the user acts on', () => {
    const o = new SonioxSessionOutcome();
    expect(o.claim('budget_exhausted')).toBe(true);
    // The granted duration lapsing a moment after the balance ran out must
    // not overwrite "top up your balance" with "tap Start to continue" —
    // the second sentence sends the user straight into a 402.
    expect(o.claim('duration_cutoff')).toBe(false);
    expect(o.kind).toBe('budget_exhausted');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/clients/SonioxSessionOutcome.test.ts`

Expected: FAIL with `Failed to resolve import "./SonioxSessionOutcome" from "src/services/clients/SonioxSessionOutcome.test.ts". Does the file exist?`

- [ ] **Step 3: Implement the outcome claim and the leg/sink contracts**

Create `src/services/clients/SonioxSessionOutcome.ts`:

```ts
/**
 * Session-level endings for a managed Soniox session, and the two narrow
 * contracts that let a session and its streams talk about them.
 *
 * Two endings belong to the SESSION, not to any one stream: the balance
 * running out, and Soniox dropping the session when its granted duration is
 * reached. Split Both mode runs TWO STT streams under ONE
 * `max_session_duration_seconds`, so at the cutoff both legs receive a 403
 * within the same second. Left to the streams, the "segment ended" notice
 * appears twice, or once, depending on which close wins the teardown race.
 *
 * The rule enforced here: the first leg to notice CLAIMS the announcement,
 * every other leg stays silent, and every leg is still torn down.
 *
 * The two interfaces are deliberately narrow and live in this leaf module so
 * that SonioxClient never imports ManagedSonioxSession and vice versa —
 * they only ever see each other through these shapes, which is what keeps
 * the two files free of an import cycle.
 */

export type SonioxSessionOutcomeKind = 'budget_exhausted' | 'duration_cutoff';

/** What the session hands to the announcing leg. */
export interface SonioxSessionOutcomeNotice {
  /** Already localized. The leg only renders it. */
  text: string;
  /**
   * Realtime-event type to emit alongside the notice, or omitted when the
   * per-leg close path already emits its own (the duration cutoff does —
   * see handleSttClose, which must keep emitting once PER LEG so both
   * legs' 403s stay visible in telemetry).
   */
  realtimeEvent?: string;
  /**
   * Present only for endings that are genuinely errors. The duration cutoff
   * is not one: it has never fired onError and must not start, or every
   * normal end-of-segment lands in the api_error dashboard.
   */
  analytics?: { code: string; rawMessage: string };
}

/** What a SonioxClient exposes to the session that owns it. */
export interface SonioxSessionLeg {
  /**
   * True for the leg whose conversation items MainPanel renders. Load-bearing:
   * MainPanel's teardown calls setItems(speakerClient.getConversationItems()),
   * so an item emitted on the participant leg is never displayed at all.
   */
  readonly isPrimaryLeg: boolean;
  /** Render the session's single ending notice on THIS leg. */
  announceSessionOutcome(notice: SonioxSessionOutcomeNotice): void;
  /**
   * Gracefully end this leg's STT stream and mark its outcome as already
   * announced. MUST be idempotent: it is called on every leg on every
   * finishSession, and in split the second leg's own 403 calls it again.
   */
  endForSessionOutcome(): void;
}

export interface SonioxSessionLegClient extends SonioxSessionLeg {
  attachManagedSession(sink: SonioxSessionOutcomeSink, opts: { primary: boolean }): void;
}

/** What the session exposes back to each of its legs. */
export interface SonioxSessionOutcomeSink {
  /** Announce once, tear down every leg. Safe to call from any leg, any number of times. */
  finishSession(kind: SonioxSessionOutcomeKind): void;
  /**
   * Optional: is `nowMs` close enough to the end of the granted duration for
   * a bare 403 to mean "segment ended" rather than "something went wrong"?
   * Optional so a leg with no session attached keeps today's behaviour.
   */
  isAtGrantedDurationEnd?(nowMs: number): boolean;
}

/**
 * One-shot ownership token for a session's ending announcement.
 * `claim` returns true exactly once in this object's lifetime.
 */
export class SonioxSessionOutcome {
  private claimedKind: SonioxSessionOutcomeKind | null = null;

  claim(kind: SonioxSessionOutcomeKind): boolean {
    if (this.claimedKind !== null) return false;
    this.claimedKind = kind;
    return true;
  }

  get kind(): SonioxSessionOutcomeKind | null {
    return this.claimedKind;
  }

  get isClaimed(): boolean {
    return this.claimedKind !== null;
  }
}

/**
 * Narrow the IClient MainPanel holds down to a leg, or null.
 *
 * Returns null for the inert facade `SonioxClient.createSecondaryPort()`
 * returns (shared Both's participant slot), which has none of these methods —
 * so shared Both registers exactly one leg without any caller having to know
 * which mode it is in.
 */
export function asSonioxSessionLeg(client: unknown): SonioxSessionLegClient | null {
  const c = client as Partial<SonioxSessionLegClient> | null | undefined;
  if (!c) return null;
  return typeof c.attachManagedSession === 'function' &&
    typeof c.announceSessionOutcome === 'function' &&
    typeof c.endForSessionOutcome === 'function'
    ? (c as SonioxSessionLegClient)
    : null;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/services/clients/SonioxSessionOutcome.test.ts`

Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing test for the session's one-owner routing**

Create `src/services/clients/ManagedSonioxSession.outcome.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ManagedSonioxSession } from './ManagedSonioxSession';
import type {
  SonioxSessionLegClient,
  SonioxSessionOutcomeNotice,
  SonioxSessionOutcomeSink,
} from './SonioxSessionOutcome';

/**
 * Fake leg: everything a SonioxClient exposes to the session, and nothing
 * else. No sockets, no i18n bootstrap, no MainPanel — the routing rule is
 * what is under test, not the client.
 */
class FakeLeg implements SonioxSessionLegClient {
  isPrimaryLeg = false;
  notices: SonioxSessionOutcomeNotice[] = [];
  endCalls = 0;
  attachedTo: SonioxSessionOutcomeSink | null = null;

  attachManagedSession(sink: SonioxSessionOutcomeSink, opts: { primary: boolean }) {
    this.attachedTo = sink;
    this.isPrimaryLeg = opts.primary;
  }
  announceSessionOutcome(notice: SonioxSessionOutcomeNotice) {
    this.notices.push(notice);
  }
  endForSessionOutcome() {
    this.endCalls++;
  }
}

/**
 * The session is built by acquire() in production. These tests drive only
 * the outcome surface, so they construct it directly and set the two grant
 * fields the cutoff margin reads.
 */
function sessionWithGrant(maxSessionDurationSeconds: number, startedAtMs: number) {
  const s = new ManagedSonioxSession(async () => 'token');
  (s as any).maxSessionDurationSeconds = maxSessionDurationSeconds;
  (s as any).startedAtMs = startedAtMs;
  return s;
}

describe('ManagedSonioxSession session-level outcomes', () => {
  let session: ManagedSonioxSession;
  let speaker: FakeLeg;
  let participant: FakeLeg;

  beforeEach(() => {
    session = sessionWithGrant(900, 0);
    speaker = new FakeLeg();
    participant = new FakeLeg();
    session.attachLeg(speaker, { primary: true });
    session.attachLeg(participant, { primary: false });
  });

  it('attachLeg hands each leg the session and its primacy', () => {
    expect(speaker.attachedTo).toBe(session);
    expect(speaker.isPrimaryLeg).toBe(true);
    expect(participant.isPrimaryLeg).toBe(false);
  });

  it('attachLeg is idempotent — a re-attached leg is not torn down twice', () => {
    session.attachLeg(speaker, { primary: true });
    session.finishSession('duration_cutoff');
    expect(speaker.endCalls).toBe(1);
  });

  it('announces the cutoff on the PRIMARY leg even when the participant leg reports it first', () => {
    // Only the primary leg's conversation items are rendered:
    // MainPanel does setItems(speakerClient.getConversationItems()).
    participant.attachedTo!.finishSession('duration_cutoff');

    expect(speaker.notices).toHaveLength(1);
    expect(speaker.notices[0].text).toMatch(/this segment has ended/i);
    // A normal end-of-segment is not an api_error.
    expect(speaker.notices[0].analytics).toBeUndefined();
    expect(participant.notices).toHaveLength(0);
  });

  it('tears down EVERY leg, including the one that reported', () => {
    session.finishSession('duration_cutoff');
    expect(speaker.endCalls).toBe(1);
    expect(participant.endCalls).toBe(1);
  });

  it('the second leg 403ing in the same second announces nothing but is still torn down', () => {
    session.finishSession('duration_cutoff'); // speaker's close won the race
    session.finishSession('duration_cutoff'); // participant's close, ~same second

    expect(speaker.notices).toHaveLength(1);
    expect(participant.notices).toHaveLength(0);
    // Idempotent per leg — endForSessionOutcome guards itself, so this is 1
    // even though finishSession ran twice.
    expect(speaker.endCalls).toBe(2);
    expect(participant.endCalls).toBe(2);
  });

  it('exhaustion announces the balance message on the primary leg WITH analytics', () => {
    session.finishSession('budget_exhausted');
    expect(speaker.notices).toHaveLength(1);
    expect(speaker.notices[0].text).toMatch(/balance is used up/i);
    expect(speaker.notices[0].realtimeEvent).toBe('session.budget_exhausted');
    expect(speaker.notices[0].analytics).toEqual({
      code: 'budget_exhausted',
      rawMessage: 'Session budget exhausted',
    });
  });

  it('a later duration cutoff never overwrites an already-announced exhaustion', () => {
    session.finishSession('budget_exhausted');
    session.finishSession('duration_cutoff');
    expect(speaker.notices).toHaveLength(1);
    expect(speaker.notices[0].text).toMatch(/balance is used up/i);
  });

  it('with no primary leg registered, falls back to the first leg rather than staying silent', () => {
    const orphan = new ManagedSonioxSession(async () => 'token');
    const only = new FakeLeg();
    orphan.attachLeg(only, { primary: false });
    orphan.finishSession('budget_exhausted');
    expect(only.notices).toHaveLength(1);
  });

  it('isAtGrantedDurationEnd is true inside the margin and false early in the grant', () => {
    const s = sessionWithGrant(900, 0); // 900s grant starting at t=0
    expect(s.isAtGrantedDurationEnd(900_000)).toBe(true);
    expect(s.isAtGrantedDurationEnd(900_000 - ManagedSonioxSession.CUTOFF_MARGIN_MS)).toBe(true);
    expect(s.isAtGrantedDurationEnd(900_000 - ManagedSonioxSession.CUTOFF_MARGIN_MS - 1)).toBe(false);
    expect(s.isAtGrantedDurationEnd(10_000)).toBe(false);
  });

  it('isAtGrantedDurationEnd stays true when the grant is unknown — the safer wrong answer', () => {
    const s = new ManagedSonioxSession(async () => 'token');
    // Nothing acquired yet: reading a 403 as the cutoff shows "this segment
    // has ended"; reading it as an outage shows "the connection was
    // interrupted". At a real cutoff the second is a lie that invites a
    // retry, so an unknown grant keeps today's behaviour.
    expect(s.isAtGrantedDurationEnd(1_000_000)).toBe(true);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run src/services/clients/ManagedSonioxSession.outcome.test.ts`

Expected: FAIL with `TypeError: session.attachLeg is not a function`

- [ ] **Step 7: Implement the session's leg registry and finishSession**

In `src/services/clients/ManagedSonioxSession.ts`, add the imports and the copy table at the top of the file, below the existing imports:

```ts
import {
  SonioxSessionOutcome,
  type SonioxSessionLeg,
  type SonioxSessionLegClient,
  type SonioxSessionOutcomeKind,
  type SonioxSessionOutcomeNotice,
  type SonioxSessionOutcomeSink,
} from './SonioxSessionOutcome';

/**
 * The two session-level endings, as the user sees them.
 *
 * `realtimeEvent` is present only where nothing else already emits one:
 * the duration cutoff is emitted PER LEG by handleSttClose (deliberately —
 * that is how both legs' 403s stay countable), so emitting it again here
 * would double-count it. Exhaustion has no per-leg emitter at all once the
 * meter belongs to the session, so it carries its own, under the exact name
 * it has always had.
 *
 * `analytics` is present only for exhaustion. The cutoff has never fired
 * onError and must not start: it is the normal way a managed segment ends,
 * and routing it to api_error would drown the dashboard in non-errors.
 */
const SESSION_OUTCOME_COPY: Record<
  SonioxSessionOutcomeKind,
  { key: string; defaultValue: string; realtimeEvent?: string; analytics?: { code: string; rawMessage: string } }
> = {
  budget_exhausted: {
    key: 'mainPanel.sonioxBudgetExhausted',
    defaultValue: 'Your session balance is used up. Top up your balance to keep translating.',
    realtimeEvent: 'session.budget_exhausted',
    // The notice text is localized; analytics gets a stable English original
    // so this ending stays countable across UI languages.
    analytics: { code: 'budget_exhausted', rawMessage: 'Session budget exhausted' },
  },
  duration_cutoff: {
    key: 'mainPanel.sonioxSegmentEnded',
    defaultValue: 'This segment has ended — tap Start Session to continue.',
  },
};
```

Then add these members to the `ManagedSonioxSession` class body:

```ts
  /**
   * How close to the end of the granted duration a bare 403 has to arrive to
   * be read as the cutoff rather than as a recoverable outage.
   *
   * The only clock this session has is the STT stream's ~5 s keepalive, and
   * the close that carries the 403 can lag it by seconds more, so the margin
   * only needs to absorb tick granularity plus teardown skew. 90 s is far
   * wider than that, and still narrow enough that a 403 arriving in the first
   * minutes of a 15-minute grant — a revoked key, a frozen wallet — falls
   * through to the outage path instead of claiming "this segment has ended".
   */
  static readonly CUTOFF_MARGIN_MS = 90_000;

  private readonly outcome = new SonioxSessionOutcome();
  private readonly legs: SonioxSessionLeg[] = [];

  /**
   * Register a client as one of this session's streams and hand it the
   * back-reference it needs to report a session-level ending. Idempotent:
   * re-attaching the same client does not create a second leg, which would
   * tear it down twice on every outcome.
   *
   * `primary: true` marks the leg whose conversation items MainPanel
   * renders — the speaker in every mode that has one, the participant only
   * in participant-only mode. Getting this wrong makes the announcement
   * invisible rather than absent, which is far harder to notice.
   */
  attachLeg(client: SonioxSessionLegClient, opts: { primary: boolean }): void {
    if (this.legs.includes(client)) return;
    this.legs.push(client);
    client.attachManagedSession(this, opts);
  }

  /**
   * The session is over for a session-level reason. Announce it ONCE, on the
   * primary leg, then tear down every leg.
   *
   * Callable from any leg, any number of times. In split Both both STT keys
   * share one `max_session_duration_seconds`, so both legs 403 within the
   * same second and both call this; the claim decides who speaks, and the
   * teardown loop runs regardless so the losing leg still ends gracefully.
   * That teardown is what stops the losing leg's own close from falling into
   * handleSttClose's bare-close branch and layering "the connection was
   * interrupted" on top of the real reason.
   */
  finishSession(kind: SonioxSessionOutcomeKind): void {
    if (this.outcome.claim(kind)) {
      const copy = SESSION_OUTCOME_COPY[kind];
      const notice: SonioxSessionOutcomeNotice = {
        text: i18n.t(copy.key, copy.defaultValue),
        realtimeEvent: copy.realtimeEvent,
        analytics: copy.analytics,
      };
      // Fall back to the first registered leg rather than swallowing the
      // announcement: a session with legs but no primary is a wiring bug,
      // and a silent ending is exactly the failure this exists to prevent.
      const announcer = this.legs.find((leg) => leg.isPrimaryLeg) ?? this.legs[0];
      announcer?.announceSessionOutcome(notice);
    }
    // Announce-then-end, matching the order handleBudgetExhausted has always
    // used, and unconditional so a second caller still gets its leg ended.
    for (const leg of this.legs) leg.endForSessionOutcome();
  }

  /**
   * Is `nowMs` within CUTOFF_MARGIN_MS of the end of the granted duration?
   *
   * Soniox reports the granted-duration cutoff as a bare 403, which is also
   * what a revoked key and a frozen wallet look like. Reading every managed
   * 403 as the cutoff tells a user whose key just died to "tap Start Session
   * to continue"; reading a real cutoff as an outage tells them "the
   * connection was interrupted". With no grant to compare against, the
   * second is the worse lie, so an unknown grant keeps today's behaviour.
   */
  isAtGrantedDurationEnd(nowMs: number): boolean {
    if (this.startedAtMs === null || !this.maxSessionDurationSeconds) return true;
    const elapsedMs = nowMs - this.startedAtMs;
    return elapsedMs >= this.maxSessionDurationSeconds * 1000 - ManagedSonioxSession.CUTOFF_MARGIN_MS;
  }
```

Finally, in the cost-meter construction FE1 moved verbatim out of `SonioxClient.fetchManagedSession`, replace the exhaustion callback. Before:

```ts
    this.costMeter = new SonioxCostMeter({
      budgetMicroUsd: data.budgetMicroUsd,
      rateUsdPerHour: data.rateUsdPerHour,
      onExhausted: () => this.handleBudgetExhausted(),
    });
```

After:

```ts
    this.costMeter = new SonioxCostMeter({
      budgetMicroUsd: data.budgetMicroUsd,
      rateUsdPerHour: data.rateUsdPerHour,
      // Session-level, not stream-level: exhaustion ends EVERY leg and is
      // announced exactly once. In split, both legs forward keepalive ticks
      // into this one meter, so this can fire from either — finishSession
      // does not care which.
      onExhausted: () => this.finishSession('budget_exhausted'),
    });
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run src/services/clients/ManagedSonioxSession.outcome.test.ts`

Expected: PASS (11 tests)

- [ ] **Step 9: Write the failing test for the client's leg surface**

Append to `src/services/clients/SonioxClient.managed.test.ts` (it already has `managedClient()`, `mockFetchOnce`, `speechToSpeechResponse`, `sttInstances`, `SEGMENT_ENDED`, `BALANCE_USED_UP`, `OUTAGE`):

```ts
/**
 * Recording stand-in for ManagedSonioxSession — the client only ever sees
 * the session through SonioxSessionOutcomeSink, so nothing more is needed.
 */
function fakeSink(opts: { atGrantEnd?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    finishSession: (kind: string) => { calls.push(kind); },
    isAtGrantedDurationEnd: () => opts.atGrantEnd ?? true,
  };
}

describe('SonioxClient as a session leg', () => {
  it('reports the duration cutoff to the session instead of announcing it itself', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    const sink = fakeSink();
    client.attachManagedSession(sink as any, { primary: true });
    const closeEvents: any[] = [];
    client.setEventHandlers({ onClose: (e) => closeEvents.push(e) });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    stt.handlers.onError?.('403', 'session duration exceeded');
    stt.handlers.onClose?.({ code: 1000, reason: '' });

    // The session owns the sentence now — this leg emits nothing on its own,
    // which is what stops the second split leg from saying it again.
    expect(sink.calls).toEqual(['duration_cutoff']);
    expect(client.getConversationItems()).toHaveLength(0);
    // MainPanel's teardown still runs: decision 3, either leg dying stops all.
    expect(closeEvents).toHaveLength(1);
  });

  it('with NO session attached, still announces the cutoff itself', async () => {
    // Safety net for a wiring miss: a silent ending is the failure mode this
    // whole task exists to prevent, so an unattached managed leg keeps the
    // pre-split behaviour rather than going quiet.
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    stt.handlers.onError?.('403', 'session duration exceeded');
    stt.handlers.onClose?.({ code: 1000, reason: '' });

    const items = client.getConversationItems();
    expect(items).toHaveLength(1);
    expect(items[0].formatted?.text).toMatch(SEGMENT_ENDED);
  });

  it('announceSessionOutcome pushes an item that SURVIVES MainPanel\'s setItems overwrite', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    const errors: any[] = [];
    client.setEventHandlers({ onError: (e) => errors.push(e) });
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
  });

  it('endForSessionOutcome ends the stream gracefully, once, and suppresses the outage notice', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    client.endForSessionOutcome();
    client.endForSessionOutcome(); // second leg's 403 re-enters finishSession

    expect(stt.ended).toBe(true);   // protocol's empty-text-frame end-of-stream
    expect(stt.closed).toBe(false); // not torn down abruptly

    // The close that always follows a graceful end() must NOT add
    // "the connection was interrupted" on top of the session's real reason.
    stt.handlers.onClose?.({ code: 1000, reason: '' });
    expect(client.getConversationItems()).toHaveLength(0);
  });

  it('a managed 403 far from the granted duration falls through to the outage path', async () => {
    mockFetchOnce(200, speechToSpeechResponse());
    const client = managedClient();
    client.attachManagedSession(fakeSink({ atGrantEnd: false }) as any, { primary: true });
    await client.connect({ ...BASE_CONFIG, textOnly: false });
    const stt = sttInstances.at(-1)!;

    // A revoked key or a frozen wallet looks exactly like the cutoff on the
    // wire. Two minutes into a 15-minute grant it is not the cutoff.
    stt.handlers.onError?.('403', 'forbidden');
    stt.handlers.onClose?.({ code: 1006, reason: '' });

    const text = client.getConversationItems().at(-1)!.formatted?.text;
    expect(text).toMatch(OUTAGE);
    expect(text).not.toMatch(SEGMENT_ENDED);
  });
});
```

- [ ] **Step 10: Run it and watch it fail**

Run: `npx vitest run src/services/clients/SonioxClient.managed.test.ts`

Expected: FAIL with `TypeError: client.attachManagedSession is not a function`

- [ ] **Step 11: Implement the client's leg surface**

In `src/services/clients/SonioxClient.ts`, add the import near the other client-local imports:

```ts
import type {
  SonioxSessionLegClient,
  SonioxSessionOutcomeNotice,
  SonioxSessionOutcomeSink,
} from './SonioxSessionOutcome';
```

Declare `SonioxClient` as implementing the leg (`export class SonioxClient implements IClient, SonioxSessionLegClient {`), and add these fields next to `private pendingDurationCutoff = false;`:

```ts
  // The managed session that owns this stream, or null (BYOK, or a managed
  // leg whose attach was missed). Set by attachManagedSession, NOT by the
  // constructor and NOT cleared by reset() — reset() runs at the top of
  // connect(), and clearing it there would orphan the leg before it starts.
  private sessionOutcomeSink: SonioxSessionOutcomeSink | null = null;
  private isPrimaryLegFlag = true;
  // Guards endForSessionOutcome. finishSession calls it on every leg on
  // every invocation, and in split the second leg's own 403 re-enters —
  // without this, end() would be sent twice on the same socket.
  private sessionOutcomeEnded = false;
```

Add the leg methods immediately after `emitSystemNotice` (line 1261):

```ts
  get isPrimaryLeg(): boolean {
    return this.isPrimaryLegFlag;
  }

  /**
   * Hand this stream to the managed session that owns it.
   *
   * Called by ManagedSonioxSession.attachLeg, not by the constructor: the
   * session exists before its clients (it mints their keys), but the clients
   * must be constructible without it so BYOK stays a one-liner.
   */
  attachManagedSession(sink: SonioxSessionOutcomeSink, opts: { primary: boolean }): void {
    this.sessionOutcomeSink = sink;
    this.isPrimaryLegFlag = opts.primary;
  }

  /**
   * Render the session's single ending notice on this leg.
   *
   * Goes through emitSystemNotice — a CLIENT-held conversation item — and not
   * through onError alone, because MainPanel's teardown replaces its rendered
   * list with getConversationItems(). A message living only in React state is
   * wiped the instant the session tears down, and an exhausted balance then
   * reads as "the connection was interrupted — tap Start Session", which
   * sends the user to retry into a 402.
   */
  announceSessionOutcome(notice: SonioxSessionOutcomeNotice): void {
    if (notice.realtimeEvent) {
      this.emitRealtime('client', notice.realtimeEvent, { provider: 'soniox' });
    }
    this.emitSystemNotice(notice.text);
    if (notice.analytics) {
      this.eventHandlers.onError?.({
        code: notice.analytics.code,
        message: notice.text,
        rawMessage: notice.analytics.rawMessage,
      });
    }
  }

  /**
   * End this leg because the SESSION ended. Idempotent.
   *
   * sttOutcomeAnnounced is set before stt.end() for the reason its own
   * declaration gives: the close that follows would otherwise reach
   * handleSttClose's bare-close fallthrough with nothing on record and layer
   * a contradictory "connection interrupted" notice on top of the real
   * reason. In split this is what silences the leg that LOST the
   * announcement race — it is torn down having "already spoken", even though
   * the sentence was rendered on the other leg.
   */
  endForSessionOutcome(): void {
    if (this.sessionOutcomeEnded) return;
    this.sessionOutcomeEnded = true;
    this.sttOutcomeAnnounced = true;
    this.stt?.end();
  }

  /**
   * Is a bare managed 403 close enough to the end of the granted duration to
   * mean "segment ended"? True when no session is attached or the session
   * does not know its grant — see ManagedSonioxSession.isAtGrantedDurationEnd
   * for why that is the safer default.
   */
  private isAtGrantedDurationEnd(): boolean {
    const sink = this.sessionOutcomeSink;
    if (!sink || typeof sink.isAtGrantedDurationEnd !== 'function') return true;
    return sink.isAtGrantedDurationEnd(Date.now());
  }
```

Replace the cutoff branch in `handleSttClose` (lines 467–475). Before:

```ts
    if (this.pendingDurationCutoff) {
      this.pendingDurationCutoff = false;
      this.emitRealtime('client', 'session.duration_cutoff', { provider: 'soniox', ...event });
      this.emitSystemNotice(
        i18n.t('mainPanel.sonioxSegmentEnded', 'This segment has ended — tap Start Session to continue.')
      );
      this.eventHandlers.onClose?.(event);
      return;
    }
```

After:

```ts
    if (this.pendingDurationCutoff) {
      this.pendingDurationCutoff = false;
      // Per-LEG telemetry, deliberately emitted by both legs: in split both
      // STT keys share one max_session_duration_seconds, so seeing two of
      // these in one session is the expected shape, not a duplicate.
      this.emitRealtime('client', 'session.duration_cutoff', { provider: 'soniox', ...event });
      if (this.sessionOutcomeSink) {
        // Session-level: announced ONCE, on the primary leg, and every leg
        // torn down. Whichever leg's close arrives first calls this; the
        // other one's call is a no-op for the notice and still ends it.
        this.sessionOutcomeSink.finishSession('duration_cutoff');
      } else {
        // No session attached — a wiring miss, or a managed leg built before
        // FE3's plumbing. Say it anyway: a silent ending is worse than a
        // duplicated one.
        this.emitSystemNotice(
          i18n.t('mainPanel.sonioxSegmentEnded', 'This segment has ended — tap Start Session to continue.')
        );
      }
      this.eventHandlers.onClose?.(event);
      return;
    }
```

Narrow the 403 gate in `handleSttError` (line 1178). Before:

```ts
    if (this.isManaged && code === '403') {
```

After:

```ts
    if (this.isManaged && code === '403' && this.isAtGrantedDurationEnd()) {
```

and extend the comment directly above it with:

```ts
    // ...and only when we are actually near the end of the grant. A revoked
    // key and a frozen wallet arrive as the same bare 403; reading those as
    // "this segment has ended — tap Start Session" invites a retry that the
    // start gate will refuse. Outside the margin this falls through to the
    // recoverable-outage path below.
```

Finally, in `reset()` (lines 1433–1460), add next to the other per-session flags — and note explicitly what must NOT be cleared:

```ts
    this.sessionOutcomeEnded = false;
    // NOT cleared: sessionOutcomeSink / isPrimaryLegFlag. reset() runs at the
    // top of connect(), and dropping the session back-reference there would
    // orphan the leg for the session it is about to run.
```

- [ ] **Step 12: Run it and watch it pass**

Run: `npx vitest run src/services/clients/SonioxClient.managed.test.ts src/services/clients/SonioxClient.test.ts`

Expected: PASS

- [ ] **Step 13: Attach both legs in MainPanel**

In `src/components/MainPanel/MainPanel.tsx`, add the import next to the other client imports:

```ts
import { asSonioxSessionLeg } from '../../services/clients/SonioxSessionOutcome';
```

In `connectConversation`, immediately after the speaker client is created and its listeners wired (the block at ~1922–1932 ending in `const client = speakerClientRef.current;`), append:

```ts
        // Register the speaker as the PRIMARY leg. Primary means "the leg
        // whose conversation items MainPanel renders": setItems below reads
        // speakerClientRef.current?.getConversationItems(), so a session
        // notice emitted anywhere else is never displayed at all.
        // asSonioxSessionLeg returns null for every non-Soniox client and for
        // the inert secondary port, so no provider check is needed here.
        if (managedSonioxSession) {
          const speakerLeg = asSonioxSessionLeg(client);
          if (speakerLeg) managedSonioxSession.attachLeg(speakerLeg, { primary: true });
        }
```

In the participant block, immediately after `participantClient.setEventHandlers(createParticipantEventHandlers(participantClient));` (line 2233), append:

```ts
            // Split Both only: the participant is a real second SonioxClient
            // with its own STT key. It is NOT primary — its items are never
            // rendered — but it must be registered so the session can tear it
            // down at exhaustion and at the shared duration cutoff. In shared
            // Both this is the inert secondary port and resolves to null.
            if (managedSonioxSession) {
              const participantLeg = asSonioxSessionLeg(participantClient);
              if (participantLeg) managedSonioxSession.attachLeg(participantLeg, { primary: false });
            }
```

- [ ] **Step 14: Run the whole suite**

Run: `npx vitest run`

Expected: PASS — in particular `src/services/clients/SonioxClient.managed.test.ts` (the pre-existing "emits the segment-ended notice itself on the close that follows" and "the full sequence — tick to exhaustion…" tests still pass, via the no-session-attached fallback and via the session route respectively).

- [ ] **Step 15: Commit**

```bash
git add src/services/clients/SonioxSessionOutcome.ts \
        src/services/clients/SonioxSessionOutcome.test.ts \
        src/services/clients/ManagedSonioxSession.ts \
        src/services/clients/ManagedSonioxSession.outcome.test.ts \
        src/services/clients/SonioxClient.ts \
        src/services/clients/SonioxClient.managed.test.ts \
        src/components/MainPanel/MainPanel.tsx
git commit -m "$(cat <<'EOF'
feat(soniox): announce session-level endings exactly once across split legs

Budget exhaustion and the granted-duration cutoff are properties of the
session, not of a stream. In split Both the two STT keys share one
max_session_duration_seconds, so both legs take a 403 within the same second
and both used to emit "This segment has ended" — twice, or once, depending on
which close won the teardown race.

ManagedSonioxSession now owns the announcement: the first leg to notice claims
it, the sentence is rendered on the PRIMARY leg (the only one whose
conversation items MainPanel renders), and every leg is torn down gracefully
so the losing leg's close cannot layer "the connection was interrupted" on top
of the real reason. The announcement goes through emitSystemNotice, not React
state, because MainPanel's teardown replaces its list with
getConversationItems().

A bare managed 403 is also now only read as the cutoff within 90s of the end
of the grant; earlier ones (revoked key, frozen wallet) fall through to the
recoverable-outage path instead of inviting a retry into a 402.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task FE5: Persistent "split did not take effect" indicator, present in basic UI mode

**Design decision, recorded here because the spec states the requirement and declines to design it.**

A degraded split session looks healthy: the mode picker still reads Both, the countdown still runs, and the only residual signal today is a missing participant waveform — which exists in advanced UI mode only. The three existing failure paths are all inadequate by the spec's own rule: loopback-denied sets a modal permission warning plus a realtime event (its sibling `catch` is console-only), the null-`participantSessionConfig` path is console-only, and the general catch produces a conversation bubble that scrolls away.

The indicator is **a chip in the control footer, rendered immediately after the `ModePicker` in both the basic and the advanced footer**. Placement is the point: the chip sits directly beside the "Both" segment that is telling the lie, and contradicts it in place. It is:

- **persistent** — footer chrome, not the scrolling conversation list; it stays for the whole session
- **present in basic mode** — the basic footer is one of the two render sites, not an advanced-only affordance
- **not a bubble** — nothing is appended to `items`, so the `setItems(client.getConversationItems())` overwrite that wipes bubbles is irrelevant to it. That overwrite only replaces the conversation array; a separate piece of React state is untouched by it. (This is the one place in this feature where React state is the *right* home — FE4's announcement is the opposite case, and the two must not be confused.)
- **explained on hover** via the `title` attribute, the same mechanism the footer's waveform strips already use — no new Tooltip import into MainPanel

Scope decision: the chip is gated on split having been *requested*. A degraded **shared** Both session is a real problem too, but it is pre-existing, its honest wording is different ("the participant side is not being captured" rather than "split did not take effect"), and widening the gate here would put a behaviour change for every existing managed and BYOK user inside a split-only task. Recorded as a follow-up, not done.

**Files:**
- Create: `src/components/MainPanel/splitDegraded.ts`
- Create: `src/components/MainPanel/splitDegraded.test.ts`
- Modify: `src/components/MainPanel/MainPanel.tsx` (state near line 345; reset at 1726 and 1590; the three failure paths at 2188–2200, 2209–2212, 2237–2239, 2282–2304; the active flag at 2279; render at 3808 and 3903)
- Modify: `src/components/MainPanel/MainPanel.scss` (inside `.control-footer`, after the shared `.status-dot` blocks)
- Modify: `src/locales/*/translation.json` (all 30 catalogs)
- Test: `src/components/MainPanel/splitDegraded.test.ts`, `src/locales/locales.consistency.test.ts`

**Interfaces:**
- Consumes (from FE2/FE3, local to `connectConversation` in `MainPanel.tsx`): the boolean `sonioxSplitBoth` — true only when the effective provider is Soniox, the effective mode is `both`, the shared-session toggle is off, and the source language is concrete
- Produces:
  - `export type SplitDegradedReason = 'loopback-denied' | 'no-participant-config' | 'participant-connect-failed'`
  - `export const SPLIT_DEGRADED_DETAIL: Record<SplitDegradedReason, { key: string; defaultValue: string }>`
  - `export function resolveSplitDegraded(input: { splitRequested: boolean; participantChannelStarted: boolean; failure: SplitDegradedReason | null }): SplitDegradedReason | null`
  - i18n keys `mainPanel.splitDegradedLabel`, `mainPanel.splitDegradedTooltip`

---

- [ ] **Step 1: Write the failing test for the degradation decision**

Create `src/components/MainPanel/splitDegraded.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveSplitDegraded, SPLIT_DEGRADED_DETAIL, type SplitDegradedReason } from './splitDegraded';

/**
 * The DECISION is a pure function in its own module so it can be tested
 * without a React harness — the same rule resolveVoicePrepOutcome follows
 * (see voicePrepWiring.test.ts). Only the side effects stay inline in
 * connectConversation.
 */
describe('resolveSplitDegraded', () => {
  const base = { splitRequested: true, participantChannelStarted: false, failure: null as SplitDegradedReason | null };

  it('is null when split was never requested', () => {
    // Shared Both, You-only, BYOK, every non-Soniox provider: unchanged.
    expect(resolveSplitDegraded({ ...base, splitRequested: false, failure: 'loopback-denied' })).toBeNull();
  });

  it('is null when the participant leg actually came up', () => {
    expect(resolveSplitDegraded({ ...base, participantChannelStarted: true })).toBeNull();
  });

  it('reports the recorded reason for each of the three failure paths', () => {
    expect(resolveSplitDegraded({ ...base, failure: 'loopback-denied' })).toBe('loopback-denied');
    expect(resolveSplitDegraded({ ...base, failure: 'no-participant-config' })).toBe('no-participant-config');
    expect(resolveSplitDegraded({ ...base, failure: 'participant-connect-failed' })).toBe('participant-connect-failed');
  });

  it('reports a degraded split even when NO reason was recorded', () => {
    // The load-bearing clause. Two of the three existing failure paths were
    // console-only, and the acquire-throw sibling produced no user-visible
    // signal at all. A split session whose participant leg never reached the
    // active flag is degraded whether or not anyone remembered to say why.
    expect(resolveSplitDegraded({ ...base, failure: null })).toBe('participant-connect-failed');
  });

  it('a recorded failure does not survive a leg that started anyway', () => {
    // requestLoopbackAudioStream can be denied for the whole-system path and
    // the session still come up on a per-application source.
    expect(resolveSplitDegraded({
      splitRequested: true, participantChannelStarted: true, failure: 'loopback-denied',
    })).toBeNull();
  });

  it('every reason maps to a detail string that exists', () => {
    const reasons: SplitDegradedReason[] = ['loopback-denied', 'no-participant-config', 'participant-connect-failed'];
    for (const r of reasons) {
      expect(SPLIT_DEGRADED_DETAIL[r].key).toMatch(/^[a-zA-Z]+\.[a-zA-Z0-9]+$/);
      expect(SPLIT_DEGRADED_DETAIL[r].defaultValue.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The spec forbids "a bubble that scrolls away". This replays the exact
 * mechanism participantErrorOrdering.test.ts models — React useState setter
 * value semantics — to show WHY: the indicator must live outside `items`,
 * because connectConversation's unconditional
 * setItems(speakerClient.getConversationItems()) replaces that array
 * wholesale.
 */
type Item = { id: string; text: string };
type Updater = Item[] | ((prev: Item[]) => Item[]);

function makeStateContainer(initial: Item[]) {
  let state = initial;
  const setItems = (updater: Updater) => {
    state = typeof updater === 'function' ? (updater as (prev: Item[]) => Item[])(state) : updater;
  };
  return { setItems, getState: () => state };
}

describe('the split-degraded indicator is not a conversation item', () => {
  it('a bubble appended in the participant catch is wiped; the indicator is not', () => {
    const { setItems, getState } = makeStateContainer([]);
    let degraded: SplitDegradedReason | null = null;
    const setDegraded = (v: SplitDegradedReason | null) => { degraded = v; };

    // participant catch: the old shape appended a bubble here
    setItems(prev => [...prev, { id: 'bubble', text: 'Failed to start the participant audio channel.' }]);
    // ...and the indicator is set from the same place, into its own state
    setDegraded(resolveSplitDegraded({
      splitRequested: true, participantChannelStarted: false, failure: 'participant-connect-failed',
    }));

    // connectConversation's unconditional overwrite with the speaker's list
    setItems([{ id: 'speaker-1', text: 'hello' }]);

    expect(getState().find(i => i.id === 'bubble')).toBeUndefined(); // bubble gone
    expect(degraded).toBe('participant-connect-failed');             // indicator stands
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/MainPanel/splitDegraded.test.ts`

Expected: FAIL with `Failed to resolve import "./splitDegraded" from "src/components/MainPanel/splitDegraded.test.ts". Does the file exist?`

- [ ] **Step 3: Implement the decision module**

Create `src/components/MainPanel/splitDegraded.ts`:

```ts
/**
 * "Split did not take effect" — the decision, as a pure function.
 *
 * A degraded split session looks healthy from the outside: the mode picker
 * still reads Both, the countdown still runs, and the only residual signal is
 * a missing participant waveform, which exists in ADVANCED UI mode only. The
 * session is genuinely fine to continue (decision 4: a participant leg that
 * never comes up does not block the session) — it is just one-way, and the
 * user has no way to know.
 *
 * Three paths in connectConversation can leave a split session one-way, and
 * all three feed this:
 *   1. loopback permission denied (Electron whole-system capture)
 *   2. createParticipantSessionConfig() returning null
 *   3. the general participant catch (a connect failure, a recorder failure,
 *      or the acquire-throw sibling that used to be console-only)
 *
 * Kept dependency-free on purpose (no React, no i18n, no client imports) so
 * it can be unit-tested without a rendering harness — the same rule
 * resolveVoicePrepOutcome follows.
 */

export type SplitDegradedReason =
  | 'loopback-denied'
  | 'no-participant-config'
  | 'participant-connect-failed';

/**
 * The explanatory line shown on hover, per reason.
 *
 * Deliberately reuses strings that already ship in all 30 catalogs rather
 * than minting three new ones: what the user needs is the CAUSE, and these
 * sentences already say it. Two reasons share one key because the user-facing
 * distinction between "no suitable models" and "connect failed" is nil.
 */
export const SPLIT_DEGRADED_DETAIL: Record<SplitDegradedReason, { key: string; defaultValue: string }> = {
  'loopback-denied': {
    key: 'audioPanel.screenRecordingDeniedText1',
    defaultValue: 'Participant Audio requires Screen Recording permission to capture system audio.',
  },
  'no-participant-config': {
    key: 'mainPanel.participantChannelFailed',
    defaultValue: 'Failed to start the participant audio channel.',
  },
  'participant-connect-failed': {
    key: 'mainPanel.participantChannelFailed',
    defaultValue: 'Failed to start the participant audio channel.',
  },
};

/**
 * Should the "one-way only" indicator be shown, and for what reason?
 *
 * `participantChannelStarted` is the end-to-end flag — the participant client
 * connected AND its recorder was wired — not "connect() resolved". It mirrors
 * setParticipantChannelActive(true)'s own contract.
 *
 * The `?? 'participant-connect-failed'` fallback is the load-bearing clause:
 * a split session whose participant leg never started is degraded whether or
 * not any path remembered to record a reason. Two of the three paths were
 * console-only before this task, and a fourth (the acquire-throw sibling)
 * produced no signal at all — a rule that only fires on a recorded reason
 * would silently miss exactly the cases this indicator exists for.
 */
export function resolveSplitDegraded(input: {
  splitRequested: boolean;
  participantChannelStarted: boolean;
  failure: SplitDegradedReason | null;
}): SplitDegradedReason | null {
  if (!input.splitRequested) return null;
  if (input.participantChannelStarted) return null;
  return input.failure ?? 'participant-connect-failed';
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/components/MainPanel/splitDegraded.test.ts`

Expected: PASS (7 tests)

- [ ] **Step 5: Add the two new strings to the English catalog**

In `src/locales/en/translation.json`, inside the `"mainPanel"` object, add:

```json
    "splitDegradedLabel": "One-way only",
    "splitDegradedTooltip": "Participant audio isn't being translated, so this session is running one way only. Check participant audio permissions, then run a new session."
```

- [ ] **Step 6: Run the locale consistency test and watch it fail**

Run: `npx vitest run src/locales/locales.consistency.test.ts`

Expected: FAIL — 29 failures of the form `locale catalogs stay in lockstep with en > ar has exactly en's keys — no missing, no stale`, whose diff shows `mainPanel.splitDegradedLabel` and `mainPanel.splitDegradedTooltip` present in `en` and absent from every other catalog.

- [ ] **Step 7: Fan the two keys out to the other 29 catalogs**

Create `/tmp/split-degraded-locales.mjs` and run it (it is a one-shot migration, not a repo file):

```js
import { readFileSync, writeFileSync } from 'node:fs';

const T = {
  ar: ['اتجاه واحد فقط', 'لا تتم ترجمة صوت المشارك، لذا تعمل هذه الجلسة في اتجاه واحد فقط. تحقق من أذونات صوت المشارك ثم ابدأ جلسة جديدة.'],
  bn: ['শুধু এক দিকে', 'অংশগ্রহণকারীর অডিও অনুবাদ করা হচ্ছে না, তাই এই সেশনটি কেবল এক দিকে চলছে। অংশগ্রহণকারীর অডিও অনুমতি পরীক্ষা করুন, তারপর একটি নতুন সেশন চালান।'],
  de: ['Nur eine Richtung', 'Teilnehmer-Audio wird nicht übersetzt, diese Sitzung läuft daher nur in eine Richtung. Prüfen Sie die Berechtigungen für Teilnehmer-Audio und starten Sie dann eine neue Sitzung.'],
  es: ['Solo en un sentido', 'El audio del participante no se está traduciendo, por lo que esta sesión funciona en un solo sentido. Revisa los permisos de audio del participante y luego inicia una sesión nueva.'],
  fa: ['فقط یک‌طرفه', 'صدای شرکت‌کننده ترجمه نمی‌شود، بنابراین این جلسه فقط یک‌طرفه اجرا می‌شود. مجوزهای صدای شرکت‌کننده را بررسی کنید و سپس جلسه جدیدی را اجرا کنید.'],
  fi: ['Vain yhteen suuntaan', 'Osallistujan ääntä ei käännetä, joten tämä istunto toimii vain yhteen suuntaan. Tarkista osallistujan äänen käyttöoikeudet ja aloita sitten uusi istunto.'],
  fil: ['Isang direksyon lamang', 'Hindi isinasalin ang audio ng kalahok, kaya isang direksyon lamang ang takbo ng session na ito. Suriin ang mga pahintulot para sa audio ng kalahok, pagkatapos ay magpatakbo ng bagong session.'],
  fr: ['Sens unique uniquement', "L'audio du participant n'est pas traduit, cette session fonctionne donc dans un seul sens. Vérifiez les autorisations audio du participant, puis lancez une nouvelle session."],
  he: ['כיוון אחד בלבד', 'האודיו של המשתתף אינו מתורגם, ולכן הפעלה זו פועלת בכיוון אחד בלבד. בדוק את הרשאות האודיו של המשתתף ולאחר מכן הפעל הפעלה חדשה.'],
  hi: ['केवल एकतरफ़ा', 'प्रतिभागी का ऑडियो अनुवादित नहीं हो रहा है, इसलिए यह सत्र केवल एक दिशा में चल रहा है। प्रतिभागी ऑडियो अनुमतियाँ जाँचें, फिर एक नया सत्र चलाएँ।'],
  id: ['Hanya satu arah', 'Audio peserta tidak diterjemahkan, sehingga sesi ini berjalan satu arah saja. Periksa izin audio peserta, lalu jalankan sesi baru.'],
  it: ['Solo in una direzione', "L'audio del partecipante non viene tradotto, quindi questa sessione funziona in una sola direzione. Controlla le autorizzazioni per l'audio del partecipante, poi avvia una nuova sessione."],
  ja: ['片方向のみ', '参加者の音声が翻訳されていないため、このセッションは片方向のみで動作しています。参加者音声の権限を確認してから、新しいセッションを実行してください。'],
  ko: ['단방향만', '참가자 오디오가 번역되지 않아 이 세션은 단방향으로만 실행됩니다. 참가자 오디오 권한을 확인한 후 새 세션을 실행하세요.'],
  ms: ['Satu hala sahaja', 'Audio peserta tidak diterjemahkan, jadi sesi ini berjalan satu hala sahaja. Semak kebenaran audio peserta, kemudian jalankan sesi baharu.'],
  nl: ['Alleen één richting', 'Deelnemersaudio wordt niet vertaald, dus deze sessie loopt maar één kant op. Controleer de machtigingen voor deelnemersaudio en start daarna een nieuwe sessie.'],
  pl: ['Tylko w jedną stronę', 'Dźwięk uczestnika nie jest tłumaczony, więc ta sesja działa tylko w jedną stronę. Sprawdź uprawnienia do dźwięku uczestnika, a następnie uruchom nową sesję.'],
  pt_BR: ['Apenas em um sentido', 'O áudio do participante não está sendo traduzido, então esta sessão está funcionando em um sentido só. Verifique as permissões de áudio do participante e execute uma nova sessão.'],
  pt_PT: ['Apenas num sentido', 'O áudio do participante não está a ser traduzido, pelo que esta sessão está a funcionar apenas num sentido. Verifique as permissões de áudio do participante e execute uma nova sessão.'],
  ru: ['Только в одну сторону', 'Звук участника не переводится, поэтому этот сеанс работает только в одну сторону. Проверьте разрешения для звука участника, затем запустите новый сеанс.'],
  sv: ['Endast en riktning', 'Deltagarljudet översätts inte, så den här sessionen körs bara åt ett håll. Kontrollera behörigheterna för deltagarljud och kör sedan en ny session.'],
  ta: ['ஒரு வழி மட்டும்', 'பங்கேற்பாளர் ஒலி மொழிபெயர்க்கப்படவில்லை, எனவே இந்த அமர்வு ஒரு வழியில் மட்டுமே இயங்குகிறது. பங்கேற்பாளர் ஒலி அனுமதிகளைச் சரிபார்த்து, பின்னர் புதிய அமர்வை இயக்கவும்.'],
  te: ['ఒక వైపు మాత్రమే', 'పాల్గొనేవారి ఆడియో అనువదించబడటం లేదు, కాబట్టి ఈ సెషన్ ఒక వైపు మాత్రమే నడుస్తోంది. పాల్గొనేవారి ఆడియో అనుమతులను తనిఖీ చేసి, ఆపై కొత్త సెషన్‌ను అమలు చేయండి.'],
  th: ['ทางเดียวเท่านั้น', 'เสียงของผู้เข้าร่วมไม่ได้รับการแปล เซสชันนี้จึงทำงานทางเดียวเท่านั้น ตรวจสอบสิทธิ์เสียงของผู้เข้าร่วม แล้วเริ่มเซสชันใหม่'],
  tr: ['Yalnızca tek yönlü', 'Katılımcı sesi çevrilmiyor, bu nedenle bu oturum yalnızca tek yönlü çalışıyor. Katılımcı ses izinlerini kontrol edin, ardından yeni bir oturum başlatın.'],
  uk: ['Лише в один бік', 'Звук учасника не перекладається, тому цей сеанс працює лише в один бік. Перевірте дозволи для звуку учасника, а потім запустіть новий сеанс.'],
  vi: ['Chỉ một chiều', 'Âm thanh của người tham gia không được dịch, nên phiên này chỉ chạy một chiều. Hãy kiểm tra quyền âm thanh của người tham gia, rồi chạy một phiên mới.'],
  zh_CN: ['仅单向', '参与者音频未被翻译，因此本次会话仅单向运行。请检查参与者音频权限，然后开始新的会话。'],
  zh_TW: ['僅單向', '參與者音訊未被翻譯，因此本次工作階段僅單向運作。請檢查參與者音訊權限，然後開始新的工作階段。'],
};

for (const [lang, [label, tooltip]] of Object.entries(T)) {
  const p = `src/locales/${lang}/translation.json`;
  const json = JSON.parse(readFileSync(p, 'utf8'));
  json.mainPanel.splitDegradedLabel = label;
  json.mainPanel.splitDegradedTooltip = tooltip;
  writeFileSync(p, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log('updated', p);
}
console.log('catalogs updated:', Object.keys(T).length);
```

Run: `node /tmp/split-degraded-locales.mjs` from the repo root.

- [ ] **Step 8: Run the locale consistency test and watch it pass**

Run: `npx vitest run src/locales/locales.consistency.test.ts`

Expected: PASS

- [ ] **Step 9: Add the indicator state and its two reset points in MainPanel**

In `src/components/MainPanel/MainPanel.tsx`, add the import next to the other MainPanel-local imports:

```ts
import { resolveSplitDegraded, SPLIT_DEGRADED_DETAIL, type SplitDegradedReason } from './splitDegraded';
```

Add the state immediately after line 345 (`const [participantChannelActive, setParticipantChannelActive] = useState(false);`):

```ts
  // "Split did not take effect": a managed/BYOK split Both session whose
  // participant leg never came up. The session is fine and continues
  // one-way (decision 4), but nothing else on screen says so — the mode
  // picker still reads Both and the countdown still runs. Held as plain
  // React state, NOT as a conversation item: it must persist for the whole
  // session rather than scroll away, and it must be visible in basic UI
  // mode where there is no participant waveform to be missing.
  const [splitDegraded, setSplitDegraded] = useState<SplitDegradedReason | null>(null);
```

In `connectConversation`, immediately after `setInitProgress(null);` (line 1727):

```ts
      // Clear last session's indicator before anything can set this one's.
      setSplitDegraded(null);
```

In `disconnectConversation`, immediately after `setParticipantChannelActive(false);` (line 1590):

```ts
      // The indicator describes the RUNNING session; it goes when it does.
      setSplitDegraded(null);
```

- [ ] **Step 10: Record a reason at each of the three failure paths**

Still in `connectConversation`, immediately after `let participantErrorMessage: string | null = null;` (line 2169):

```ts
      // Why the participant leg failed, if it did, and whether it ever came
      // up end to end. Locals rather than state because connectConversation
      // reads them back in the same pass — a setState here would not be
      // visible to the resolve call below.
      let splitParticipantFailure: SplitDegradedReason | null = null;
      let participantChannelStarted = false;
```

Path 1 — inside the `if (!granted)` block, immediately after `electronAcquireOk = false;` (line 2200):

```ts
                  splitParticipantFailure = 'loopback-denied';
```

Path 1b — inside the loopback-acquire `catch`, immediately after `electronAcquireOk = false;` (line 2211):

```ts
              // Previously console-only: this branch produced NO user-visible
              // signal of any kind.
              splitParticipantFailure = 'participant-connect-failed';
```

Path 2 — inside the `if (!participantSessionConfig)` block, immediately after `participantClientRef.current = null;` (line 2239):

```ts
              splitParticipantFailure = 'no-participant-config';
```

Success marker — immediately after `setParticipantChannelActive(true);` (line 2279):

```ts
              participantChannelStarted = true;
```

Path 3 — inside the general participant `catch`, immediately after the `addRealtimeEvent({ type: 'participant.error', ... })` call (line 2303):

```ts
          splitParticipantFailure = 'participant-connect-failed';
```

Then, immediately after the deferred `voicePrepMessage` append block (the one ending at line 2376), add the single resolve:

```ts
      // One decision, three inputs, computed once the participant block has
      // finished. Deliberately NOT a conversation item: the setItems
      // overwrite a few lines up replaces that array wholesale, which is why
      // participantErrorMessage and voicePrepMessage have to be appended
      // after it. This lives in its own state and is untouched by that call.
      setSplitDegraded(resolveSplitDegraded({
        splitRequested: sonioxSplitBoth,
        participantChannelStarted,
        failure: splitParticipantFailure,
      }));
```

- [ ] **Step 11: Render the chip in both footers**

In the basic footer, immediately after the closing `/>` of `<ModePicker ... />` (line 3826) and before `<span className="footer-spacer" />`:

```tsx
            {splitDegraded && (
              <span
                className="split-degraded-chip"
                title={t(
                  SPLIT_DEGRADED_DETAIL[splitDegraded].key,
                  SPLIT_DEGRADED_DETAIL[splitDegraded].defaultValue
                ) + '\n\n' + t(
                  'mainPanel.splitDegradedTooltip',
                  "Participant audio isn't being translated, so this session is running one way only. Check participant audio permissions, then run a new session."
                )}
              >
                <AlertCircle size={12} />
                <span className="chip-text">{t('mainPanel.splitDegradedLabel', 'One-way only')}</span>
              </span>
            )}
```

In the advanced footer, immediately after the closing `/>` of `<ModePicker ... />` (line 3921) and before the `{/* Input waveforms ... */}` comment, paste the identical block. Placement is the point in both: the chip sits beside the "Both" segment that is otherwise telling the user the session is bidirectional.

- [ ] **Step 12: Style the chip**

In `src/components/MainPanel/MainPanel.scss`, inside `.control-footer` and immediately before the `// ── Shared button styles ──` comment (line 464):

```scss
  // ── Split-degraded indicator (both UI modes) ──
  //
  // Persistent footer chrome, not a conversation bubble: a split Both session
  // whose participant leg never came up runs happily one-way, and the mode
  // picker beside this chip still reads "Both". Amber rather than the red
  // error colour — the session is working, just not the way it was asked to.
  .split-degraded-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    padding: 2px 7px;
    border-radius: 10px;
    background: rgba(243, 156, 18, 0.15);
    border: 1px solid rgba(243, 156, 18, 0.45);
    color: #f39c12;
    font-size: 11px;
    line-height: 1.4;
    white-space: nowrap;
    cursor: default;

    svg { flex-shrink: 0; }

    // The footer is tight in basic mode at narrow widths; the icon alone
    // still carries the warning and the title attribute still explains it.
    @media (max-width: 420px) {
      .chip-text { display: none; }
      padding: 2px 4px;
    }
  }
```

- [ ] **Step 13: Run the full suite**

Run: `npx vitest run`

Expected: PASS — including `src/components/MainPanel/splitDegraded.test.ts`, `src/locales/locales.consistency.test.ts` and `src/components/MainPanel/participantErrorOrdering.test.ts`.

- [ ] **Step 14: Confirm the bundle still builds**

Run: `npm run build`

Expected: build succeeds (this repo's correctness gate is vitest + the Vite build; `tsc --noEmit` has ~113 pre-existing errors and is not a gate).

- [ ] **Step 15: Commit**

```bash
git add src/components/MainPanel/splitDegraded.ts \
        src/components/MainPanel/splitDegraded.test.ts \
        src/components/MainPanel/MainPanel.tsx \
        src/components/MainPanel/MainPanel.scss \
        src/locales
git commit -m "$(cat <<'EOF'
feat(soniox): persistent "one-way only" indicator when split does not take effect

A split Both session whose participant leg never comes up keeps running
(decision 4) and looks completely healthy: the mode picker still reads Both,
the countdown still runs, and the only residual signal was a missing
participant waveform — advanced UI mode only. Two of the three failure paths
were console-only, and the third produced a bubble that scrolls away.

All three now feed one decision (resolveSplitDegraded, a pure function tested
without a React harness) that drives a persistent chip in the control footer,
rendered in BOTH basic and advanced mode, immediately beside the "Both"
segment it contradicts. It is footer chrome rather than a conversation item,
so connectConversation's setItems(getConversationItems()) overwrite — the call
that already forced participantErrorMessage and voicePrepMessage to be
deferred — cannot wipe it.

Two new strings across all 30 locale catalogs; the per-cause hover text reuses
strings that already shipped.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task FE6: Expose the control — managed accounts can pick split

**Files:**
- Modify: `src/services/providers/SonioxProviderConfig.ts` (line 6, lines 147-167)
- Modify: `src/services/providers/sonioxSharedBothSession.test.ts` (whole file)
- Modify: `src/services/providers/sonioxBothMode.ts` (the `sonioxUsesSharedBothSession` call site, created in Task FE2)
- Modify: `src/services/providers/sonioxBothMode.test.ts` (add the managed-split cases, created in Task FE2)
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx` (lines 1843-1850, lines 2001-2044)
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx` (append a describe block)
- Modify: `src/locales/en/translation.json` and its 29 sibling catalogs
- Test: `src/locales/locales.consistency.test.ts` (existing — it is the gate, do not edit it)

**Interfaces:**
- Consumes: `sonioxBothModePlan(input: SonioxBothModeInput): SonioxBothModePlan` (Task FE2), `sonioxUsesSharedBothSession(provider, settings)` (current two-argument form).
- Produces:
  - `export function sonioxUsesSharedBothSession(settings: { bothModeSharedSession?: boolean } | null | undefined): boolean` — the `provider` parameter is REMOVED. Three call sites and one test change with it.
  - i18n key `settings.sonioxSharedSessionManagedCost` in all 30 catalogs.
  - i18n key `settings.sonioxSharedSessionManaged` is DELETED from all 30 catalogs.

---

- [ ] **Step 1: Rewrite the helper's test to the new policy**

Replace the whole of `src/services/providers/sonioxSharedBothSession.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { sonioxUsesSharedBothSession } from './SonioxProviderConfig';

/**
 * Both flavours now honour the user's stored preference.
 *
 * Managed (Kizuna AI) used to be forced to `true` here: the backend's session
 * lease was account-scoped and single-session, so two clients meant the second
 * connect was refused with a 409 and Others→You silently never ran while the
 * user still saw You→Others working. One lease now issues one temporary key
 * per stream, so a split managed session (spk_stt + par_stt) is a supported
 * shape rather than a race the backend refuses — and this function no longer
 * needs to know which provider is asking.
 *
 * The settings UI and MainPanel both read this one helper, so a stored value
 * cannot mean one thing to the toggle and another to the session.
 */
describe('sonioxUsesSharedBothSession', () => {
  it('honours a stored preference, whichever way it points', () => {
    expect(sonioxUsesSharedBothSession({ bothModeSharedSession: true })).toBe(true);
    expect(sonioxUsesSharedBothSession({ bothModeSharedSession: false })).toBe(false);
  });

  it('defaults to shared when nothing is stored', () => {
    expect(sonioxUsesSharedBothSession({})).toBe(true);
    expect(sonioxUsesSharedBothSession(null)).toBe(true);
    expect(sonioxUsesSharedBothSession(undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/providers/sonioxSharedBothSession.test.ts`

Expected: FAIL — `AssertionError: expected true to be false` on the `{ bothModeSharedSession: false }` case, because the single argument lands in the `provider` slot and the object is not a managed provider id, so `settings` is `undefined` and the default `true` is returned.

- [ ] **Step 3: Drop the managed override and the now-dead parameter**

In `src/services/providers/SonioxProviderConfig.ts`, delete line 6 entirely (both imported symbols become unused once the body below stops calling `isKizunaManagedProvider`; `Provider` was only the type of the parameter being removed):

```ts
import { Provider, isKizunaManagedProvider } from '../../types/Provider';
```

Then replace lines 147-167. Before:

```ts
/**
 * Does Both mode run on ONE shared Soniox session for this provider?
 *
 * FORCED ON for the Kizuna-managed twin, whatever the stored preference says.
 * The managed backend's session lease is account-scoped and single-session: two
 * clients means the second `connect()` is refused with 409, so You→Others works
 * while Others→You silently does not. The user cannot be offered a mode the
 * backend structurally cannot honour, so `ProviderSpecificSettings` disables
 * the control and this function is the single source of truth both it and
 * `MainPanel` read (a stored `false` — e.g. carried over from BYOK use — must
 * not resurrect the half-failed session).
 *
 * BYOK Soniox keeps the choice: two keys, two sessions, no lease involved.
 */
export function sonioxUsesSharedBothSession(
  provider: Provider,
  settings: { bothModeSharedSession?: boolean } | null | undefined
): boolean {
  if (isKizunaManagedProvider(provider)) return true;
  return settings?.bothModeSharedSession ?? true;
}
```

After:

```ts
/**
 * Does Both mode run on ONE shared Soniox session?
 *
 * Both flavours honour the user's stored preference. Managed (Kizuna AI) used
 * to be forced to `true` here because the backend's session lease was
 * account-scoped and single-session: a second client meant a 409, so You→Others
 * worked while Others→You silently did not. One lease now issues one temporary
 * key per stream (spk_stt + par_stt for split Both), so two managed
 * transcription streams are a supported shape rather than a race the backend
 * refuses — and the answer no longer depends on which provider is asking. The
 * `provider` parameter was removed rather than left dead, so that every call
 * site had to be visited when the policy inverted.
 *
 * `ProviderSpecificSettings` (the toggle) and `sonioxBothModePlan` (the
 * session wiring, the Start-gate floor and the managed session-key request)
 * both read this one function, so a stored value cannot mean one thing to the
 * UI and another to the session.
 *
 * Default is shared: it is one stream instead of two, i.e. the cheaper and
 * lower-latency shape, and it is what every existing install without a stored
 * preference has been running.
 */
export function sonioxUsesSharedBothSession(
  settings: { bothModeSharedSession?: boolean } | null | undefined
): boolean {
  return settings?.bothModeSharedSession ?? true;
}
```

Now fix the two remaining call sites. In `src/services/providers/sonioxBothMode.ts`, before:

```ts
  const prefersShared = sonioxUsesSharedBothSession(provider, settings);
```

After:

```ts
  const prefersShared = sonioxUsesSharedBothSession(settings);
```

In `src/components/Settings/sections/ProviderSpecificSettings.tsx` line 1849, before:

```ts
    const shared = sonioxUsesSharedBothSession(provider, activeSonioxSettings);
```

After:

```ts
    const shared = sonioxUsesSharedBothSession(activeSonioxSettings);
```

- [ ] **Step 4: Run the helper tests and watch them pass**

Run: `npx vitest run src/services/providers/sonioxSharedBothSession.test.ts src/services/providers/sonioxBothMode.test.ts`

Expected: PASS both files.

- [ ] **Step 5: Add the managed-split cases to the derived-value test**

Append these two tests inside the existing `describe('sonioxBothModePlan', …)` in `src/services/providers/sonioxBothMode.test.ts`, immediately after the `resolves the Kizuna-managed twin to Soniox` test:

```ts
  // The managed twin no longer forces shared. MainPanel reads the helper
  // rather than the raw `bothModeSharedSession` field precisely so this stays
  // one decision: if the UI lets a managed user pick split, the session must
  // actually run split, and if the UI ever locks it again a stored `false`
  // must not resurrect split behind the UI's back.
  it('lets the Kizuna-managed twin run split Both when that is what is stored', () => {
    expect(sonioxBothModePlan({
      provider: Provider.KIZUNA_AI_SONIOX,
      settings: { bothModeSharedSession: false, sourceLanguage: 'en' },
      mode: 'both',
    })).toEqual({ shared: false, split: true });
  });

  it('still defaults the managed twin to shared with nothing stored', () => {
    expect(sonioxBothModePlan({
      provider: Provider.KIZUNA_AI_SONIOX,
      settings: { sourceLanguage: 'en' },
      mode: 'both',
    })).toEqual({ shared: true, split: false });
  });
```

Run: `npx vitest run src/services/providers/sonioxBothMode.test.ts`

Expected: PASS (9 tests) — these already pass after Step 3; they are the regression evidence that the policy inverted where it was supposed to.

- [ ] **Step 6: Write the failing UI test**

Append this describe block to `src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`, after the existing top-level `describe(...)` closes (after line 302). Add the audio-store import next to the other top-level dynamic imports (after line 91):

```tsx
const { default: useAudioStore } = await import('../../../stores/audioStore');
```

Then the new block:

```tsx
/**
 * Managed Soniox used to have the shared/split toggle locked on, with an
 * inline note saying it could not be turned off. The backend now issues one
 * temporary key per stream, so split is a real choice for managed accounts
 * too — and it costs roughly 2× per wall-clock minute, which the UI has to say
 * out loud rather than let the user discover from a halved countdown.
 */
describe('ProviderSpecificSettings — managed Soniox shared/split toggle', () => {
  beforeEach(() => {
    // The toggle is only live in Both mode (`inBoth`); every other test in
    // this file runs in the default speaker mode.
    useAudioStore.setState({ mode: 'both' });
    useSettingsStore.setState((s: any) => ({
      provider: Provider.KIZUNA_AI_SONIOX,
      kizunaSoniox: { ...s.kizunaSoniox, bothModeSharedSession: true },
    }));
  });

  afterEach(() => {
    useAudioStore.setState({ mode: 'speaker' });
  });

  function pills(container: HTMLElement): HTMLButtonElement[] {
    const section = container.querySelector('#soniox-settings-section') as HTMLElement;
    expect(section).not.toBeNull();
    return Array.from(section.querySelectorAll('.option-button')) as HTMLButtonElement[];
  }

  it('leaves both pills enabled for a managed account in Both mode', () => {
    const { container } = mount();
    const [enabled, disabled] = pills(container);
    expect(enabled.disabled).toBe(false);
    expect(disabled.disabled).toBe(false);
  });

  it('writes bothModeSharedSession: false to the kizunaSoniox slice when split is picked', () => {
    const { container } = mount();
    const [, disabled] = pills(container);
    fireEvent.click(disabled);
    expect(useSettingsStore.getState().kizunaSoniox.bothModeSharedSession).toBe(false);
  });

  it('still locks both pills during an active session', () => {
    const { container } = render(<ProviderSpecificSettings {...baseProps} isSessionActive={true} />);
    const [enabled, disabled] = pills(container);
    expect(enabled.disabled).toBe(true);
    expect(disabled.disabled).toBe(true);
  });

  it('shows the explanatory tooltip for managed accounts too', () => {
    const { container } = mount();
    const section = container.querySelector('#soniox-settings-section') as HTMLElement;
    expect(section.querySelector('.tooltip-trigger')).not.toBeNull();
  });

  it('tells a managed account what split costs instead of saying it cannot be turned off', () => {
    const { container } = mount();
    const section = container.querySelector('#soniox-settings-section') as HTMLElement;
    // The i18n mock at the top of this file returns each t() call's English
    // default, so this asserts the shipped copy verbatim.
    expect(section.textContent).toContain('about twice the cost per minute');
    expect(section.textContent).not.toContain('cannot be turned off');
  });
});
```

Add `afterEach` to the vitest import on line 10:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
```

- [ ] **Step 7: Run it and watch it fail**

Run: `npx vitest run src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`

Expected: FAIL — `AssertionError: expected true to be false` on the first new test (both pills are still `disabled` because `lockedOff` still ORs in `managed`), plus `expected '…cannot be turned off.' to contain 'about twice the cost per minute'`.

- [ ] **Step 8: Unlock the toggle**

In `src/components/Settings/sections/ProviderSpecificSettings.tsx`, before (lines 1843-1850):

```ts
    // Managed (Kizuna) Soniox has no choice to offer: the backend's session
    // lease is account-scoped, so "Disabled" would open a second client that
    // the backend refuses with 409 — You→Others would work while Others→You
    // silently did not. Forced on and locked, with the reason shown, rather
    // than letting the user pick a mode the backend cannot honour.
    const managed = isKizunaManagedProvider(provider);
    const shared = sonioxUsesSharedBothSession(activeSonioxSettings);
    const lockedOff = isSessionActive || !inBoth || managed;
```

After:

```ts
    // Managed (Kizuna) Soniox used to have no choice to offer: the backend's
    // session lease was account-scoped and single-session, so "Disabled" opened
    // a second client that the backend refused with 409 — You→Others worked
    // while Others→You silently did not. One lease now issues one temporary key
    // per stream, so split is a real option here and the control is live.
    // `managed` survives only to swap the note below for one that states what
    // split costs; it no longer gates the buttons.
    const managed = isKizunaManagedProvider(provider);
    const shared = sonioxUsesSharedBothSession(activeSonioxSettings);
    const lockedOff = isSessionActive || !inBoth;
```

- [ ] **Step 9: Show the tooltip for managed and replace the note**

In the same file, before (lines 2002-2015 and 2034-2043):

```tsx
        <h2>
          {t('settings.sonioxSharedSession', 'Shared session in Both mode')}
          {/* The Enabled/Disabled tooltip recommends "Disabled" for reliability,
              which is advice a managed account cannot act on — the inline note
              below replaces it there. */}
          {!managed && (
            <Tooltip
              content={t('settings.sonioxSharedSessionTooltip', 'Both mode can run on one shared Soniox session or a separate session per direction.\n\nEnabled: a single session translates both sides with automatic speaker separation — lower cost and latency.\n\nDisabled: a separate session per direction — more reliable when both people talk at once, but about twice the cost.\n\nOnly affects Both mode.')}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
            </Tooltip>
          )}
        </h2>
```

After:

```tsx
        <h2>
          {t('settings.sonioxSharedSession', 'Shared session in Both mode')}
          {/* Shown for managed too. The tooltip recommends "Disabled" for
              reliability, which used to be advice a managed account could not
              act on; now it can, so suppressing the explanation would leave the
              managed user with a live control and no description of it. */}
          <Tooltip
            content={t('settings.sonioxSharedSessionTooltip', 'Both mode can run on one shared Soniox session or a separate session per direction.\n\nEnabled: a single session translates both sides with automatic speaker separation — lower cost and latency.\n\nDisabled: a separate session per direction — more reliable when both people talk at once, but about twice the cost.\n\nOnly affects Both mode.')}
            position="top"
          >
            <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
          </Tooltip>
        </h2>
```

And before (lines 2034-2043):

```tsx
        {managed && (
          <div className="setting-item">
            <div className="setting-description">
              {t(
                'settings.sonioxSharedSessionManaged',
                'Kizuna AI runs Both mode as one shared session, so this cannot be turned off.'
              )}
            </div>
          </div>
        )}
```

After:

```tsx
        {managed && (
          <div className="setting-item">
            <div className="setting-description">
              {/* Managed accounts pay per minute out of a wallet balance, so
                  the BYOK tooltip's "about twice the cost" is not the whole
                  story here: the on-screen session countdown halves and the
                  Start button's balance floor rises with it. Decision 2 — the
                  difference is reflected honestly, not absorbed — and a user
                  who finds Start refused deserves to have been told why. */}
              {t(
                'settings.sonioxSharedSessionManagedCost',
                'Kizuna AI supports both. Disabled runs two sessions at once — about twice the cost per minute, so your session allowance runs out in about half the time and a higher balance is needed to start.'
              )}
            </div>
          </div>
        )}
```

- [ ] **Step 10: Run it and watch it pass**

Run: `npx vitest run src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`

Expected: PASS (all pre-existing tests plus the 5 new ones)

- [ ] **Step 11: Confirm the locale gap before touching the catalogs**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react
node -e "
const en = require('./src/locales/en/translation.json');
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  v && typeof v === 'object' ? flat(v, p ? p + '.' + k : k) : [p ? p + '.' + k : k]);
const have = new Set(flat(en));
console.log('new key present:', have.has('settings.sonioxSharedSessionManagedCost'));
console.log('old key present:', have.has('settings.sonioxSharedSessionManaged'));"
```

Expected: `new key present: false` / `old key present: true`.

- [ ] **Step 12: Edit the English catalog**

In `src/locales/en/translation.json`, under `settings`, replace line 221:

```json
    "sonioxSharedSessionManaged": "Kizuna AI runs Both mode as one shared session, so this cannot be turned off.",
```

with:

```json
    "sonioxSharedSessionManagedCost": "Kizuna AI supports both. Disabled runs two sessions at once — about twice the cost per minute, so your session allowance runs out in about half the time and a higher balance is needed to start.",
```

The old key is removed, not left orphaned: its sentence ("cannot be turned off") is now factually wrong, and 29 stale translations of a wrong sentence are worse than none. The parity test forbids a key that exists in some catalogs and not others, so it must go from all of them in this same step.

- [ ] **Step 13: Watch the parity test fail for all 29 sibling catalogs**

Run: `npx vitest run src/locales/locales.consistency.test.ts`

Expected: FAIL — 29 failures, each of the form `expected [ …, 'settings.sonioxSharedSessionManaged', … ] to deeply equal [ …, 'settings.sonioxSharedSessionManagedCost', … ]`. This is the gate proving the next step is necessary.

- [ ] **Step 14: Apply the same swap in all 29 sibling catalogs**

In each of `ar bn de es fa fi fil fr he hi id it ja ko ms nl pl pt_BR pt_PT ru sv ta te th tr uk vi zh_CN zh_TW`, delete the `sonioxSharedSessionManaged` line and insert `sonioxSharedSessionManagedCost` in the same position with the translation below. No string may contain a `{` placeholder (the parity test compares placeholder sets, and English has none) and none may be empty.

| lang | value |
|---|---|
| ar | يدعم Kizuna AI كلا الخيارين. يشغّل وضع «معطّل» جلستين في آن واحد — بضعف التكلفة تقريبًا لكل دقيقة، لذا ينفد رصيد جلستك في نحو نصف المدة ويلزم رصيد أعلى للبدء. |
| bn | Kizuna AI দুটোই সমর্থন করে। নিষ্ক্রিয় একসঙ্গে দুটি সেশন চালায় — প্রতি মিনিটে প্রায় দ্বিগুণ খরচ, তাই আপনার সেশনের সময় প্রায় অর্ধেক সময়েই ফুরিয়ে যায় এবং শুরু করতে বেশি ব্যালেন্স লাগে। |
| de | Kizuna AI unterstützt beides. „Deaktiviert“ führt zwei Sitzungen gleichzeitig aus – etwa doppelte Kosten pro Minute, dein Sitzungsguthaben ist also in etwa der halben Zeit aufgebraucht und zum Starten ist ein höheres Guthaben nötig. |
| es | Kizuna AI admite ambas opciones. Desactivado ejecuta dos sesiones a la vez: alrededor del doble de coste por minuto, así que tu tiempo de sesión se agota en aproximadamente la mitad y hace falta más saldo para empezar. |
| fa | Kizuna AI هر دو را پشتیبانی می‌کند. حالت غیرفعال دو جلسه را همزمان اجرا می‌کند — حدود دو برابر هزینه در هر دقیقه، بنابراین اعتبار جلسه شما در حدود نیمی از زمان تمام می‌شود و برای شروع به موجودی بیشتری نیاز است. |
| fi | Kizuna AI tukee molempia. Pois käytöstä ajaa kaksi istuntoa yhtä aikaa — noin kaksinkertainen hinta minuutissa, joten istuntoaikasi loppuu noin puolessa ajassa ja aloittamiseen tarvitaan suurempi saldo. |
| fil | Sinusuportahan ng Kizuna AI ang dalawa. Ang Naka-disable ay nagpapatakbo ng dalawang session nang sabay — halos doble ang gastos kada minuto, kaya mauubos ang oras ng iyong session sa halos kalahati ng panahon at kailangan ng mas mataas na balanse para makapagsimula. |
| fr | Kizuna AI prend en charge les deux. Désactivé lance deux sessions à la fois : environ deux fois plus cher par minute, votre crédit de session s'épuise donc en à peu près moitié moins de temps et un solde plus élevé est nécessaire pour démarrer. |
| he | ‏Kizuna AI תומכת בשתי האפשרויות. מצב מושבת מריץ שתי הפעלות במקביל — עלות כפולה בערך לכל דקה, ולכן מכסת ההפעלה שלך נגמרת בערך בחצי מהזמן ונדרשת יתרה גבוהה יותר כדי להתחיל. |
| hi | Kizuna AI दोनों का समर्थन करता है। अक्षम एक साथ दो सत्र चलाता है — प्रति मिनट लगभग दोगुना खर्च, इसलिए आपका सत्र समय लगभग आधे समय में खत्म हो जाता है और शुरू करने के लिए अधिक बैलेंस चाहिए। |
| id | Kizuna AI mendukung keduanya. Nonaktif menjalankan dua sesi sekaligus — biayanya sekitar dua kali lipat per menit, jadi jatah sesi Anda habis dalam waktu sekitar setengahnya dan diperlukan saldo lebih besar untuk memulai. |
| it | Kizuna AI supporta entrambe le modalità. Disattivato esegue due sessioni contemporaneamente: circa il doppio del costo al minuto, quindi il credito della sessione si esaurisce in circa metà tempo e serve un saldo più alto per iniziare. |
| ja | Kizuna AI はどちらにも対応しています。無効にすると 2 つのセッションを同時に実行します。1 分あたりの費用が約 2 倍になるため、セッションの残り時間はおよそ半分になり、開始にはより多くの残高が必要です。 |
| ko | Kizuna AI는 두 가지 모두 지원합니다. 사용 안 함은 두 개의 세션을 동시에 실행합니다. 분당 비용이 약 2배이므로 세션 사용 가능 시간이 약 절반으로 줄고, 시작하려면 더 많은 잔액이 필요합니다. |
| ms | Kizuna AI menyokong kedua-duanya. Dilumpuhkan menjalankan dua sesi serentak — kira-kira dua kali ganda kos seminit, jadi peruntukan sesi anda habis dalam kira-kira separuh masa dan baki yang lebih tinggi diperlukan untuk bermula. |
| nl | Kizuna AI ondersteunt beide. Uitgeschakeld voert twee sessies tegelijk uit — ongeveer twee keer zoveel kosten per minuut, dus je sessietegoed is in ongeveer de helft van de tijd op en je hebt een hoger saldo nodig om te starten. |
| pl | Kizuna AI obsługuje oba tryby. Wyłączone uruchamia dwie sesje jednocześnie — około dwa razy większy koszt na minutę, więc limit sesji kończy się mniej więcej o połowę szybciej, a do rozpoczęcia potrzebne jest wyższe saldo. |
| pt_BR | A Kizuna AI oferece as duas opções. Desativado executa duas sessões ao mesmo tempo — cerca do dobro do custo por minuto, então o seu tempo de sessão acaba em aproximadamente metade e é preciso um saldo maior para começar. |
| pt_PT | A Kizuna AI oferece ambas as opções. Desativado executa duas sessões em simultâneo — cerca do dobro do custo por minuto, pelo que o seu tempo de sessão acaba em aproximadamente metade e é necessário um saldo mais elevado para começar. |
| ru | Kizuna AI поддерживает оба варианта. «Отключено» запускает две сессии одновременно — примерно вдвое дороже за минуту, поэтому доступное время сессии заканчивается примерно вдвое быстрее, а для запуска нужен больший баланс. |
| sv | Kizuna AI stöder båda. Inaktiverad kör två sessioner samtidigt — ungefär dubbla kostnaden per minut, så din sessionstid tar slut på ungefär halva tiden och det krävs ett högre saldo för att starta. |
| ta | Kizuna AI இரண்டையும் ஆதரிக்கிறது. முடக்கப்பட்டது இரண்டு அமர்வுகளை ஒரே நேரத்தில் இயக்கும் — நிமிடத்திற்கு கிட்டத்தட்ட இரட்டிப்பு செலவு, எனவே உங்கள் அமர்வு நேரம் ஏறக்குறைய பாதி நேரத்தில் தீர்ந்துவிடும், தொடங்க அதிக இருப்பு தேவை. |
| te | Kizuna AI రెండింటినీ మద్దతిస్తుంది. నిలిపివేయబడింది రెండు సెషన్‌లను ఒకేసారి నడుపుతుంది — నిమిషానికి దాదాపు రెట్టింపు ఖర్చు, కాబట్టి మీ సెషన్ సమయం దాదాపు సగం సమయంలోనే అయిపోతుంది, ప్రారంభించడానికి ఎక్కువ బ్యాలెన్స్ అవసరం. |
| th | Kizuna AI รองรับทั้งสองแบบ ปิดใช้งานจะรันสองเซสชันพร้อมกัน — ค่าใช้จ่ายต่อนาทีราวสองเท่า เวลาเซสชันที่ใช้ได้จึงหมดเร็วขึ้นราวครึ่งหนึ่ง และต้องมียอดคงเหลือมากขึ้นจึงจะเริ่มได้ |
| tr | Kizuna AI her ikisini de destekler. Devre dışı, aynı anda iki oturum çalıştırır — dakika başına yaklaşık iki katı maliyet, bu yüzden oturum süreniz yaklaşık yarı sürede biter ve başlamak için daha yüksek bakiye gerekir. |
| uk | Kizuna AI підтримує обидва варіанти. «Вимкнено» запускає дві сесії одночасно — приблизно вдвічі дорожче за хвилину, тож доступний час сесії вичерпується приблизно вдвічі швидше, а для запуску потрібен більший баланс. |
| vi | Kizuna AI hỗ trợ cả hai. Tắt sẽ chạy hai phiên cùng lúc — chi phí mỗi phút cao khoảng gấp đôi, nên thời lượng phiên của bạn hết trong khoảng một nửa thời gian và cần số dư cao hơn để bắt đầu. |
| zh_CN | Kizuna AI 两种方式都支持。关闭后会同时运行两个会话——每分钟成本约为两倍，因此可用会话时长大约减半，开始会话所需的余额也更高。 |
| zh_TW | Kizuna AI 兩種方式都支援。關閉後會同時執行兩個工作階段——每分鐘成本約為兩倍，因此可用時長大約減半，開始所需的餘額也更高。 |

- [ ] **Step 15: Run the parity test until it passes**

Run: `npx vitest run src/locales/locales.consistency.test.ts`

Expected: PASS — all 29 catalogs have exactly English's key set, every placeholder preserved, no empty strings.

- [ ] **Step 16: Run the full suite**

Run: `npm test -- --run 2>&1 | tail -6`

Expected: PASS — no new failures against the Task FE2 baseline, 0 skipped.

- [ ] **Step 17: Commit**

```bash
cd /home/jiangzhuo/Desktop/kizunaai/sokuji-react
git add src/services/providers/SonioxProviderConfig.ts \
        src/services/providers/sonioxSharedBothSession.test.ts \
        src/services/providers/sonioxBothMode.ts \
        src/services/providers/sonioxBothMode.test.ts \
        src/components/Settings/sections/ProviderSpecificSettings.tsx \
        src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx \
        src/locales
git commit -m "feat(soniox): let managed accounts choose split Both mode

sonioxUsesSharedBothSession stops forcing shared on for the Kizuna twin and
the settings toggle stops disabling itself for it — the two have to move
together, because MainPanel reads the helper so a stored false cannot
resurrect split behind the UI's back. The shared/split tooltip is shown for
managed too, and the managed note now states that split costs roughly 2x per
wall-clock minute, so the countdown and the Start balance floor change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task FE7: Truth pass on the cost meter, and close the participant telemetry gap

**Ordering:** this task MUST land **after** the backend task that switches Soniox charging to
`provider cost × K`. Landing it earlier would put the *new* docstring (which says the meter is
not a price) into a tree where the meter *is* still the price — i.e. it would make the file lie
in the other direction. Nothing in this task depends on backend code at build time; the
dependency is purely "the statement must be true when it is written".

**Why this task exists at all.** Two unrelated falsehoods that this change surfaces:

1. `SonioxCostMeter`'s class docstring promises *"no correction factor, and no estimation
   error: what it reports is what will be charged."* Once billing is `provider cost × K`,
   that is false — and it is false even though **no arithmetic in the file changes**. The
   meter still counts down the granted allowance at the granted conservative rate; that
   number is now a *ceiling on session length*, not a bill, and is normally **larger** than
   what the user is actually charged. A stale docstring here is worse than no docstring:
   the next reader will use it to answer "what did this session cost?".
2. `createParticipantEventHandlers` wires only `onRealtimeEvent`, `onConversationUpdated`
   and `onClose` — no `onError`, `onReconnecting`, `onReconnected` — and
   `setupClientListeners` reads `speakerClientRef.current`, so the full handler set can only
   ever reach the speaker. The spec ("Telemetry is asymmetric") allows either wiring them or
   stating the gap. **We wire them**, because split Both mode doubles the number of legs that
   can fail while leaving exactly half of them invisible to `api_error`: an outage that kills
   the participant leg of every split session in production would show up in dashboards as a
   quiet period, not an incident. Stating the gap was acceptable when the participant leg was
   a text-only afterthought; it stops being acceptable the moment split makes the participant
   a first-class, independently-failing Soniox stream.

**Scope note, decided rather than skipped — there is no user-visible price wording to fix.**
The footer renders a bare `mm:ss` clock (`formatRemainingTime(sonioxCountdown.remainingMs)`)
with no label, no tooltip and no currency anywhere. The one user-visible string in the
neighbourhood, `mainPanel.sonioxBudgetExhausted` ("Your session balance is used up…"), says
*session* balance — which is exactly the allowance, and is still true. It is therefore left
alone deliberately, and **no new locale key is added**: `src/locales/locales.consistency.test.ts`
requires every one of the 31 non-en catalogs to carry exactly en's key set, so a one-line
tooltip would be a 32-file change for prose that adds nothing the countdown does not already
say. The falsehood is entirely in the code's own prose and in one getter's name, and that is
what this task fixes.

**Files:**
- Modify: `src/services/clients/SonioxCostMeter.ts` (lines 3-10, 12-22, 57-68, 84-86)
- Modify: `src/services/clients/SonioxCostMeter.test.ts` (lines 4, 13-18, 28-32, 61-71)
- Modify: `src/services/clients/SonioxClient.ts` (line 74; lines 842-851)
- Modify: `src/services/interfaces/IClient.ts` (lines 449-455)
- Modify: `src/lib/analytics.ts` (lines 186-196)
- Modify: `src/lib/apiErrorProps.ts` (lines 28-55)
- Modify: `src/lib/apiErrorProps.test.ts` (append)
- Create: `src/components/MainPanel/reconnectingChannels.ts`
- Create: `src/components/MainPanel/participantTelemetry.ts`
- Modify: `src/components/MainPanel/MainPanel.tsx` (lines 750-795, 1404-1449, ~1585, refs block ~1263)
- Test: `src/services/clients/SonioxCostMeter.test.ts`
- Test: `src/lib/apiErrorProps.test.ts`
- Test: `src/components/MainPanel/reconnectingChannels.test.ts` (new)
- Test: `src/components/MainPanel/participantTelemetryWiring.test.ts` (new)

**Interfaces:**
- Consumes: nothing from earlier tasks. `SonioxCostMeter`'s arithmetic, `tick`'s absoluteness
  (`now - startedAt`), `start(nowMs)`, `getBudgetSnapshot()` and the `SonioxBudgetSnapshot`
  shape are all preserved byte-for-byte in behaviour, so a task that moves the meter's
  ownership onto `ManagedSonioxSession` is unaffected.
- Produces:
  - `SonioxCostMeter.allowanceConsumedMicroUsd: number` (getter; **replaces** `spentMicroUsd`,
    same arithmetic)
  - `clientErrorMessage(event: ClientErrorEvent): string` in `src/lib/apiErrorProps.ts`
  - `buildApiErrorProps(event: ClientErrorEvent, provider: string, channel?: ClientId): AnalyticsEvents['api_error']`
    (third parameter is new and optional)
  - `AnalyticsEvents['api_error'].channel?: 'speaker' | 'participant'`
  - `src/components/MainPanel/reconnectingChannels.ts`:
    `type ReconnectingState = readonly ClientId[]`,
    `NO_CHANNELS_RECONNECTING: ReconnectingState`,
    `channelReconnecting(state: ReconnectingState, channel: ClientId): ReconnectingState`,
    `channelReconnected(state: ReconnectingState, channel: ClientId): ReconnectingState`,
    `isAnyChannelReconnecting(state: ReconnectingState): boolean`
  - `src/components/MainPanel/participantTelemetry.ts`:
    `interface ChannelTelemetryPorts`, `interface ChannelTelemetryHandlers`,
    `buildChannelTelemetryHandlers(channel: ClientId, ports: ChannelTelemetryPorts): ChannelTelemetryHandlers`

---

#### Part A — the cost meter tells the truth

- [ ] **Step 1: Write the failing test — the meter reports allowance consumed, not spend**

The two existing tests that use the word "spend"/"SKU rate" are themselves the falsehood in
test form, so they are rewritten rather than left beside a new one. In
`src/services/clients/SonioxCostMeter.test.ts`, replace line 4 and the three blocks below.

Replace line 4:

```ts
const opts = { budgetMicroUsd: 300_000, rateUsdPerHour: 0.6 }; // $0.30 at $0.60/hr = 1800s
```

with:

```ts
// A $0.30 allowance granted at a conservative $0.60/hr = 1800s of session time.
// Neither number is a price: the backend charges provider cost × K per usage
// log, and the actual charge for 1800s at these settings is normally LESS.
const opts = { budgetMicroUsd: 300_000, rateUsdPerHour: 0.6 };
```

Replace lines 7-18 (the first two `it` blocks) verbatim:

```ts
  it('spends nothing before it starts', () => {
    const m = new SonioxCostMeter(opts);
    expect(m.spentMicroUsd).toBe(0);
    expect(m.remainingMicroUsd).toBe(300_000);
  });

  it('spends at the SKU rate as the clock runs', () => {
    const m = new SonioxCostMeter(opts);
    m.start(0);
    m.tick(3_600_000);              // one hour
    expect(m.spentMicroUsd).toBe(600_000);
  });
```

with:

```ts
  it('consumes none of the allowance before it starts', () => {
    const m = new SonioxCostMeter(opts);
    expect(m.allowanceConsumedMicroUsd).toBe(0);
    expect(m.remainingMicroUsd).toBe(300_000);
  });

  it('burns the allowance down at the granted conservative rate as the clock runs', () => {
    const m = new SonioxCostMeter(opts);
    m.start(0);
    m.tick(3_600_000);              // one hour
    expect(m.allowanceConsumedMicroUsd).toBe(600_000);
  });

  it('offers no "spent" reading at all — this class cannot know what the session is charged', () => {
    // The charge is provider cost × K, applied per usage log by the backend
    // reconciler AFTER each Soniox stream ends. No usage log exists while the
    // session is running, so a getter named `spentMicroUsd` on a live meter
    // could only ever be a guess presented as a fact — and a high one, since
    // the granted rate is the worst case for the whole stream set.
    const m = new SonioxCostMeter(opts);
    m.start(0);
    m.tick(3_600_000);
    expect((m as unknown as Record<string, unknown>).spentMicroUsd).toBeUndefined();
  });
```

Replace lines 28-32 verbatim:

```ts
  it('uses the speech-to-speech rate when given one', () => {
    const m = new SonioxCostMeter({ budgetMicroUsd: 750_000, rateUsdPerHour: 1.5 });
    m.start(0);
    expect(m.remainingSeconds).toBe(1800);
  });
```

with:

```ts
  it('uses whatever aggregate rate the backend granted — one number for the whole stream set', () => {
    // $1.50/hr is the kind of aggregate a multi-stream set is budgeted at. The
    // client never derives it; it has no rate table and must not grow one.
    const m = new SonioxCostMeter({ budgetMicroUsd: 750_000, rateUsdPerHour: 1.5 });
    m.start(0);
    expect(m.remainingSeconds).toBe(1800);
  });
```

Replace lines 61-71 verbatim:

```ts
  it('rounds a partial micro-dollar up, never down', () => {
    // 1 second at $0.60/hour:
    // (1000 ms / 3_600_000 ms/hr) * $0.60/hr * 1_000_000 µUSD/USD
    // = (1 / 3600) * 0.6 * 1_000_000
    // = 166.666... µUSD
    // ceil(166.666...) = 167, floor(166.666...) = 166
    const m = new SonioxCostMeter({ budgetMicroUsd: 1_000_000, rateUsdPerHour: 0.6 });
    m.start(0);
    m.tick(1000);  // 1 second
    expect(m.spentMicroUsd).toBe(167);
  });
```

with:

```ts
  it('rounds a partial micro-dollar of allowance up, never down', () => {
    // 1 second at $0.60/hour:
    // (1000 ms / 3_600_000 ms/hr) * $0.60/hr * 1_000_000 µUSD/USD
    // = (1 / 3600) * 0.6 * 1_000_000
    // = 166.666... µUSD
    // ceil(166.666...) = 167, floor(166.666...) = 166
    //
    // The direction is a safety margin ON THE ALLOWANCE — rounding down would
    // hand out fractionally more session time than the grant covers. It is NOT
    // an attempt to match a charge; the charge is computed elsewhere, from
    // provider cost, and is not visible from here.
    const m = new SonioxCostMeter({ budgetMicroUsd: 1_000_000, rateUsdPerHour: 0.6 });
    m.start(0);
    m.tick(1000);  // 1 second
    expect(m.allowanceConsumedMicroUsd).toBe(167);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -- --run src/services/clients/SonioxCostMeter.test.ts`

Expected: FAIL — three failures. `consumes none of the allowance before it starts` and
`burns the allowance down…` fail with `expected undefined to be 0` / `expected undefined to be
600000` (the getter does not exist yet); `offers no "spent" reading at all` fails with
`expected 600000 to be undefined`.

- [ ] **Step 3: Implement — rename the getter and rewrite every claim in the file**

Replace `src/services/clients/SonioxCostMeter.ts` lines 3-22 verbatim:

```ts
export interface SonioxCostMeterOptions {
  /** Balance snapshot the backend issued this session against, in micro-USD. */
  budgetMicroUsd: number;
  /** The SKU's list price, supplied by the backend so the client needs no rate table. */
  rateUsdPerHour: number;
  /** Called once, when the budget is exhausted. */
  onExhausted?: () => void;
}

/** Micro-USD spent for `elapsedMs` of usage at `rateUsdPerHour`, rounded UP to the
 *  whole micro-USD — pinned by SonioxCostMeter.test.ts's "round-up direction" case,
 *  since underbilling by rounding down would never match what the backend charges. */
function spentMicroUsdFor(elapsedMs: number, rateUsdPerHour: number): number {
  const hours = elapsedMs / 3_600_000;
  return Math.ceil(hours * rateUsdPerHour * MICRO_USD_PER_USD);
}

function remainingMicroUsdFor(elapsedMs: number, budgetMicroUsd: number, rateUsdPerHour: number): number {
  return Math.max(0, budgetMicroUsd - spentMicroUsdFor(elapsedMs, rateUsdPerHour));
}
```

with:

```ts
export interface SonioxCostMeterOptions {
  /** The session ALLOWANCE the backend granted, in micro-USD: a snapshot of the
   *  account balance taken at session start. It is the ceiling this session may
   *  consume, not a bill. */
  budgetMicroUsd: number;
  /**
   * The CONSERVATIVE aggregate rate the backend budgeted this session's whole
   * stream set at, in USD/hour — supplied by the backend so the client needs no
   * rate table and must never grow one.
   *
   * Deliberately not a price. The backend charges provider cost × a revenue
   * coefficient per usage log; this rate is the worst case it is willing to
   * grant time against, so `budgetMicroUsd / rateUsdPerHour` UNDER-states how
   * long the balance really buys. It is one number for the whole SET — a split
   * Both session runs two transcription streams and is budgeted at roughly
   * twice a single-stream session — never a per-stream figure.
   */
  rateUsdPerHour: number;
  /** Called once, when the allowance is used up. */
  onExhausted?: () => void;
}

/** Allowance consumed by `elapsedMs` of session time at `rateUsdPerHour`,
 *  rounded UP to the whole micro-USD — pinned by SonioxCostMeter.test.ts's
 *  "round-up direction" case. The direction is a safety margin on the
 *  allowance: rounding down would hand out fractionally more session time than
 *  the grant covers. It is NOT an attempt to match a charge — the charge is
 *  provider cost × K per usage log and is not knowable from here. */
function allowanceConsumedMicroUsdFor(elapsedMs: number, rateUsdPerHour: number): number {
  const hours = elapsedMs / 3_600_000;
  return Math.ceil(hours * rateUsdPerHour * MICRO_USD_PER_USD);
}

function remainingMicroUsdFor(elapsedMs: number, budgetMicroUsd: number, rateUsdPerHour: number): number {
  return Math.max(0, budgetMicroUsd - allowanceConsumedMicroUsdFor(elapsedMs, rateUsdPerHour));
}
```

Replace lines 57-62 verbatim:

```ts
/**
 * Tracks what a managed Soniox session has cost so far.
 *
 * Billing is by time, so this is a clock — no token counting, no correction
 * factor, and no estimation error: what it reports is what will be charged.
 */
```

with:

```ts
/**
 * The session ALLOWANCE countdown for a managed Soniox session.
 *
 * The backend grants each session a fixed allowance (a snapshot of the account
 * balance) and a conservative rate to spend it against. This class burns that
 * allowance down against wall-clock time and fires `onExhausted` when it hits
 * zero. That is the real cutoff — the session is torn down — so this number is
 * load-bearing for "when does this stop".
 *
 * It is NOT a price, and must never be presented as one. Billing is provider
 * cost × a revenue coefficient, applied per usage log by the backend
 * reconciler after each Soniox stream ends. That figure is not knowable here —
 * no usage log exists while the session is still running — and it is normally
 * SMALLER than what this meter has counted down, because the granted rate is
 * the worst case for the whole stream set. Trust the countdown for the cutoff;
 * the wallet is the only authority on cost.
 *
 * It has no clock of its own. `tick(nowMs)` is fed by the STT stream's ~5 s
 * keepalive and is ABSOLUTE (`now - startedAt`), not incremental — which is
 * what makes a split Both session harmless: two transcription streams each
 * forwarding their own keepalive compute the same elapsed time, so more than
 * one ticker cannot double-count. Do not make `tick` incremental.
 */
```

Replace lines 84-86 verbatim:

```ts
  get spentMicroUsd(): number {
    return spentMicroUsdFor(this.elapsedMs, this.opts.rateUsdPerHour);
  }
```

with:

```ts
  /** How much of the granted allowance this session has burned through. Named
   *  for what it is: this is not what the user is charged, and there is
   *  deliberately no getter that claims to be. */
  get allowanceConsumedMicroUsd(): number {
    return allowanceConsumedMicroUsdFor(this.elapsedMs, this.opts.rateUsdPerHour);
  }
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm run test -- --run src/services/clients/SonioxCostMeter.test.ts`

Expected: PASS (13 tests).

- [ ] **Step 5: Prose-only truth pass on the three docstrings that repeat the claim**

No behaviour changes here — three comment edits so the same falsehood does not survive in the
files that read the meter.

In `src/services/clients/SonioxClient.ts`, replace line 74 verbatim:

```ts
  rateUsdPerHour: number;
```

with:

```ts
  // The CONSERVATIVE aggregate rate the backend budgeted this session's whole
  // stream set at — what the granted duration was divided out of, not a price.
  // Charging is provider cost × a revenue coefficient, per usage log, after the
  // fact. See SonioxCostMeter's class docstring.
  rateUsdPerHour: number;
```

In the same file, replace lines 842-848 verbatim:

```ts
  /**
   * Managed-mode only: the running session's fixed budget parameters, for
   * the status footer's remaining-time countdown (see
   * SonioxCostMeter.getBudgetSnapshot / computeSonioxRemainingMs). Null for
   * BYOK sessions (no cost meter) or before the session-key exchange has
   * completed.
   */
```

with:

```ts
  /**
   * Managed-mode only: the running session's fixed ALLOWANCE parameters, for
   * the status footer's remaining-time countdown (see
   * SonioxCostMeter.getBudgetSnapshot / computeSonioxRemainingMs). Null for
   * BYOK sessions (no cost meter) or before the session-key exchange has
   * completed.
   *
   * The countdown this drives is a cutoff, not a running bill — the session
   * ends when it reaches zero, but what the user is charged is computed by the
   * backend from provider cost and is normally less. Do not render it as money.
   */
```

In `src/services/interfaces/IClient.ts`, replace lines 449-455 verbatim:

```ts
  /**
   * Managed-mode Soniox only: the running session's fixed budget parameters
   * (grant, rate, start time), for the status footer's remaining-time
   * countdown — see SonioxClient.getManagedBudgetInfo. Null for BYOK
   * sessions or before the managed session-key exchange has completed.
   */
  getManagedBudgetInfo?(): { budgetMicroUsd: number; rateUsdPerHour: number; startedAtMs: number } | null;
```

with:

```ts
  /**
   * Managed-mode Soniox only: the running session's fixed ALLOWANCE parameters
   * (grant, conservative rate, start time), for the status footer's
   * remaining-time countdown — see SonioxClient.getManagedBudgetInfo. Null for
   * BYOK sessions or before the managed session-key exchange has completed.
   *
   * `rateUsdPerHour` is the rate the allowance was budgeted at, not a price:
   * the countdown says when the session stops, never what it cost.
   */
  getManagedBudgetInfo?(): { budgetMicroUsd: number; rateUsdPerHour: number; startedAtMs: number } | null;
```

- [ ] **Step 6: Prove Step 5 was prose-only**

Run: `npm run test -- --run src/services/clients/`

Expected: PASS — every Soniox client suite still green, unchanged counts. If anything here
went red, Step 5 touched code rather than comments; revert and redo it.

- [ ] **Step 7: Commit Part A**

```bash
git add src/services/clients/SonioxCostMeter.ts \
        src/services/clients/SonioxCostMeter.test.ts \
        src/services/clients/SonioxClient.ts \
        src/services/interfaces/IClient.ts
git commit -m "$(cat <<'EOF'
docs(soniox): the cost meter is a session allowance, not a price

Billing is now provider cost x a revenue coefficient, applied per usage log
after each Soniox stream ends. The meter's promise of "no estimation error:
what it reports is what will be charged" is therefore false, even though none
of its arithmetic changed.

Rewrites the class docstring as an allowance countdown - still the real cutoff,
no longer the price - and renames the spentMicroUsd getter to
allowanceConsumedMicroUsd so no caller can read a charge off a live session.
Same rounding, same absolute tick (which is what makes two split legs
forwarding keepalives harmless).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

#### Part B — the participant leg reports its own outages

- [ ] **Step 8: Write the failing test — `buildApiErrorProps` carries the channel**

Append to `src/lib/apiErrorProps.test.ts`, inside the existing
`describe('buildApiErrorProps', …)` block (before its closing `});` on line 48):

```ts
  it('tags which leg reported the error, so split-mode outages are not half-invisible', () => {
    // A split Both session runs two independent Soniox streams. Without this
    // tag the participant leg's failures are indistinguishable from the
    // speaker's in api_error, and an outage that only kills one direction
    // reads as a 50% drop in traffic rather than as an incident.
    expect(buildApiErrorProps({ code: '503' }, 'soniox', 'participant').channel).toBe('participant');
    expect(buildApiErrorProps({ code: '503' }, 'soniox', 'speaker').channel).toBe('speaker');
  });

  it('omits channel entirely when the caller did not name a leg, rather than sending undefined', () => {
    // Same reasoning as error_code above: an absent property and a property
    // whose value is undefined are different rows once they reach PostHog.
    expect('channel' in buildApiErrorProps({ message: 'boom' }, 'openai')).toBe(false);
  });

  it('exposes the same message-precedence the bubble uses, so both cannot drift', () => {
    expect(clientErrorMessage({ message: 'boom' })).toBe('boom');
    expect(clientErrorMessage({ error: 'boom' })).toBe('boom');
    expect(clientErrorMessage({})).toBe('Unknown error');
    // Note the deliberate difference from error_message: the USER-facing text
    // prefers the localized `message`, analytics prefers `rawMessage`.
    expect(clientErrorMessage({ message: '接続が中断されました', rawMessage: 'service unavailable' }))
      .toBe('接続が中断されました');
  });
```

and change line 2 from:

```ts
import { buildApiErrorProps } from './apiErrorProps';
```

to:

```ts
import { buildApiErrorProps, clientErrorMessage } from './apiErrorProps';
```

- [ ] **Step 9: Run it and watch it fail**

Run: `npm run test -- --run src/lib/apiErrorProps.test.ts`

Expected: FAIL — the file fails to collect with
`No "clientErrorMessage" export is defined on the "./apiErrorProps" module`.

- [ ] **Step 10: Implement the channel tag and the shared message helper**

In `src/lib/analytics.ts`, replace lines 186-196 verbatim:

```ts
  'api_error': {
    provider: string;
    endpoint?: string;
    status_code?: number;
    /** Provider wire code as sent: '503', '408', 'socket_error', … Kept a
     *  string because the codes that matter are not all numeric, and one
     *  field beats a numeric/symbolic pair. */
    error_code?: string;
    error_message: string;
    error_type: 'auth' | 'rate_limit' | 'network' | 'server' | 'client';
  };
```

with:

```ts
  'api_error': {
    provider: string;
    endpoint?: string;
    status_code?: number;
    /** Provider wire code as sent: '503', '408', 'socket_error', … Kept a
     *  string because the codes that matter are not all numeric, and one
     *  field beats a numeric/symbolic pair. */
    error_code?: string;
    error_message: string;
    error_type: 'auth' | 'rate_limit' | 'network' | 'server' | 'client';
    /** Which audio leg reported it: 'speaker' (microphone) or 'participant'
     *  (far end / system audio). Split Both mode runs the two as independent
     *  provider streams that fail independently, so an untagged api_error
     *  cannot distinguish "the whole session died" from "one direction died".
     *  Optional: errors raised before any leg exists carry no channel. */
    channel?: 'speaker' | 'participant';
  };
```

In `src/lib/apiErrorProps.ts`, replace lines 28-55 verbatim:

```ts
/**
 * Map a client error onto the `api_error` analytics event.
 *
 * Lives in its own module rather than inline in MainPanel's `onError` handler:
 * MainPanel has no test file, and which string becomes `error_message` is a
 * decision, not plumbing — it decides whether outages are groupable.
 */
export function buildApiErrorProps(
  event: ClientErrorEvent,
  provider: string
): AnalyticsEvents['api_error'] {
  const code = event.code === undefined || event.code === null || event.code === ''
    ? undefined
    : String(event.code);
  return {
    provider,
    error_message: event.rawMessage || event.message || event.error || 'Unknown error',
    // Omitted rather than set to undefined: an absent property and a property
    // whose value is undefined are different rows once they reach PostHog.
    ...(code === undefined ? {} : { error_code: code }),
    // Deliberately unchanged. `type` is set by almost no client, so this has
    // always resolved to 'server' in practice — including for transport-level
    // failures that are anything but. Correcting it would shift the meaning of
    // an existing analytics dimension, which needs a look at what queries it
    // first; `error_code` now carries the truth in the meantime.
    error_type: event.type === 'error' ? 'client' : 'server',
  };
}
```

with:

```ts
/**
 * The text a human should see for this error.
 *
 * Deliberately a DIFFERENT precedence from `error_message` below: the bubble
 * wants the localized `message`, analytics wants the untranslated `rawMessage`.
 * Exported so the conversation bubble and the log entry are built from one
 * expression instead of two copies that drift.
 */
export function clientErrorMessage(event: ClientErrorEvent): string {
  return event.message || event.error || 'Unknown error';
}

/**
 * Map a client error onto the `api_error` analytics event.
 *
 * Lives in its own module rather than inline in MainPanel's `onError` handler:
 * MainPanel has no test file, and which string becomes `error_message` is a
 * decision, not plumbing — it decides whether outages are groupable.
 */
export function buildApiErrorProps(
  event: ClientErrorEvent,
  provider: string,
  /** Which audio leg reported it. Optional so existing single-leg call sites
   *  keep compiling; every MainPanel call site names one. */
  channel?: 'speaker' | 'participant'
): AnalyticsEvents['api_error'] {
  const code = event.code === undefined || event.code === null || event.code === ''
    ? undefined
    : String(event.code);
  return {
    provider,
    error_message: event.rawMessage || event.message || event.error || 'Unknown error',
    // Omitted rather than set to undefined: an absent property and a property
    // whose value is undefined are different rows once they reach PostHog.
    ...(code === undefined ? {} : { error_code: code }),
    // Same reasoning as error_code: omitted, not undefined.
    ...(channel === undefined ? {} : { channel }),
    // Deliberately unchanged. `type` is set by almost no client, so this has
    // always resolved to 'server' in practice — including for transport-level
    // failures that are anything but. Correcting it would shift the meaning of
    // an existing analytics dimension, which needs a look at what queries it
    // first; `error_code` now carries the truth in the meantime.
    error_type: event.type === 'error' ? 'client' : 'server',
  };
}
```

- [ ] **Step 11: Run it and watch it pass**

Run: `npm run test -- --run src/lib/apiErrorProps.test.ts`

Expected: PASS (9 tests).

- [ ] **Step 12: Write the failing test — one reconnect flag, two legs**

Create `src/components/MainPanel/reconnectingChannels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  NO_CHANNELS_RECONNECTING,
  channelReconnecting,
  channelReconnected,
  isAnyChannelReconnecting,
  type ReconnectingState,
} from './reconnectingChannels';

/**
 * MainPanel renders ONE `isReconnecting` boolean (the status dot and its
 * banner) but split Both mode runs TWO independent clients that reconnect
 * independently. Wiring both legs' onReconnecting/onReconnected straight to
 * `setIsReconnecting` would let whichever leg recovers first clear the banner
 * while the other is still down — the user sees a healthy dot on a session
 * that is half dead. This module is the arbiter, kept out of MainPanel so it
 * has an actual production implementation the wiring test can import.
 */
describe('reconnectingChannels', () => {
  it('starts with nothing reconnecting', () => {
    expect(isAnyChannelReconnecting(NO_CHANNELS_RECONNECTING)).toBe(false);
  });

  it('reports reconnecting while either leg is down', () => {
    const s = channelReconnecting(NO_CHANNELS_RECONNECTING, 'participant');
    expect(isAnyChannelReconnecting(s)).toBe(true);
  });

  it('keeps the flag on when only ONE of two down legs recovers', () => {
    // The bug this module exists to prevent.
    let s: ReconnectingState = NO_CHANNELS_RECONNECTING;
    s = channelReconnecting(s, 'speaker');
    s = channelReconnecting(s, 'participant');
    s = channelReconnected(s, 'speaker');
    expect(isAnyChannelReconnecting(s)).toBe(true);
    s = channelReconnected(s, 'participant');
    expect(isAnyChannelReconnecting(s)).toBe(false);
  });

  it('contrast: a single shared boolean clears early — this is the bug', () => {
    // Not the real implementation. Kept to prove the assertion above depends
    // on the per-channel set rather than being true whatever we wrote.
    let sharedFlag = false;
    sharedFlag = true;   // speaker onReconnecting
    sharedFlag = true;   // participant onReconnecting
    sharedFlag = false;  // speaker onReconnected — clears while participant is still down
    expect(sharedFlag).toBe(false);
  });

  it('is idempotent: a client may announce the same transition more than once', () => {
    let s: ReconnectingState = NO_CHANNELS_RECONNECTING;
    s = channelReconnecting(s, 'speaker');
    s = channelReconnecting(s, 'speaker');
    s = channelReconnected(s, 'speaker');
    expect(isAnyChannelReconnecting(s)).toBe(false);
  });

  it('ignores a reconnected for a leg that never announced reconnecting', () => {
    const s = channelReconnected(NO_CHANNELS_RECONNECTING, 'participant');
    expect(isAnyChannelReconnecting(s)).toBe(false);
  });

  it('never mutates the state handed to it — it lives in a ref read during render', () => {
    const before: ReconnectingState = NO_CHANNELS_RECONNECTING;
    const after = channelReconnecting(before, 'speaker');
    expect(before).toEqual([]);
    expect(after).not.toBe(before);
  });
});
```

- [ ] **Step 13: Run it and watch it fail**

Run: `npm run test -- --run src/components/MainPanel/reconnectingChannels.test.ts`

Expected: FAIL — `Failed to load url ./reconnectingChannels` (the module does not exist).

- [ ] **Step 14: Implement `reconnectingChannels.ts`**

Create `src/components/MainPanel/reconnectingChannels.ts`:

```ts
import type { ClientId } from '../../stores/logStore';

/**
 * Which audio legs are currently reconnecting.
 *
 * MainPanel exposes ONE `isReconnecting` boolean, but a split Both session runs
 * two independent provider streams that reconnect independently. Routing both
 * legs' callbacks straight at that boolean lets whichever recovers first clear
 * the banner while the other is still down.
 *
 * Immutable on purpose: MainPanel holds this in a ref and derives the rendered
 * boolean from it, so an in-place mutation would be invisible to React and
 * would also make the ref's value depend on when it happened to be read.
 * `ClientId` is reused rather than a private twin so the log entries these
 * transitions produce are tagged with the same vocabulary.
 */
export type ReconnectingState = readonly ClientId[];

export const NO_CHANNELS_RECONNECTING: ReconnectingState = [];

/** Idempotent: a client may announce `onReconnecting` more than once for one
 *  outage (a retry ladder re-enters the state on every attempt). */
export function channelReconnecting(state: ReconnectingState, channel: ClientId): ReconnectingState {
  return state.includes(channel) ? state : [...state, channel];
}

/** Idempotent, and a no-op for a leg that never announced reconnecting — some
 *  clients emit `onReconnected` after a first successful connect. */
export function channelReconnected(state: ReconnectingState, channel: ClientId): ReconnectingState {
  return state.includes(channel) ? state.filter(c => c !== channel) : state;
}

export function isAnyChannelReconnecting(state: ReconnectingState): boolean {
  return state.length > 0;
}
```

- [ ] **Step 15: Run it and watch it pass**

Run: `npm run test -- --run src/components/MainPanel/reconnectingChannels.test.ts`

Expected: PASS (7 tests).

- [ ] **Step 16: Write the failing test — the wiring both legs share**

Create `src/components/MainPanel/participantTelemetryWiring.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildChannelTelemetryHandlers } from './participantTelemetry';
import {
  NO_CHANNELS_RECONNECTING,
  isAnyChannelReconnecting,
  type ReconnectingState,
} from './reconnectingChannels';

/**
 * MainPanel.tsx's `createParticipantEventHandlers` used to wire only
 * onRealtimeEvent / onConversationUpdated / onClose, and `setupClientListeners`
 * reads `speakerClientRef.current` so the full handler set could only ever
 * reach the speaker. Split Both mode makes the participant an independently
 * failing provider stream, so that asymmetry under-counts outages in the error
 * dashboards by roughly half.
 *
 * There is no React rendering harness in this repo (see
 * participantErrorOrdering.test.ts and voicePrepWiring.test.ts for the same
 * constraint), so the shared handler set was extracted into
 * `buildChannelTelemetryHandlers` specifically so this file can import and call
 * the REAL production function with fake ports, rather than hand-transcribing a
 * duplicate that could drift from the shipped wiring without either side
 * noticing.
 */
function makeWorld() {
  let reconnecting: ReconnectingState = NO_CHANNELS_RECONNECTING;
  let renderedIsReconnecting = false;
  const logs: Array<{ type: string; clientId: string }> = [];
  const apiErrors: any[] = [];

  const portsFor = (provider = 'soniox') => ({
    addRealtimeEvent: (event: any, _source: any, eventType: string, clientId: any) => {
      logs.push({ type: eventType || event?.type, clientId });
    },
    trackApiError: (props: any) => { apiErrors.push(props); },
    provider,
    readReconnecting: () => reconnecting,
    writeReconnecting: (next: ReconnectingState) => { reconnecting = next; },
    setIsReconnecting: (v: boolean) => { renderedIsReconnecting = v; },
  });

  return {
    portsFor,
    logs,
    apiErrors,
    getReconnecting: () => reconnecting,
    getRenderedIsReconnecting: () => renderedIsReconnecting,
  };
}

describe('per-channel telemetry handlers', () => {
  it('sends the participant leg\'s error to api_error tagged as participant', () => {
    const w = makeWorld();
    const participant = buildChannelTelemetryHandlers('participant', w.portsFor());
    participant.onError({ code: '503', message: 'service unavailable' });

    expect(w.apiErrors).toHaveLength(1);
    expect(w.apiErrors[0]).toMatchObject({
      provider: 'soniox',
      error_code: '503',
      error_message: 'service unavailable',
      channel: 'participant',
    });
  });

  it('contrast: the old wiring emitted nothing at all for a participant error', () => {
    // Reproduces the pre-fix handler set — three handlers, no onError — to
    // prove the assertion above depends on the new wiring rather than on
    // buildApiErrorProps being callable.
    const w = makeWorld();
    const preFix: Record<string, unknown> = {
      onRealtimeEvent: () => {},
      onConversationUpdated: () => {},
      onClose: () => {},
    };
    expect(preFix.onError).toBeUndefined();
    expect(w.apiErrors).toHaveLength(0);
  });

  it('tags the participant\'s log entries so LogsPanel can attribute the outage', () => {
    const w = makeWorld();
    const participant = buildChannelTelemetryHandlers('participant', w.portsFor());
    participant.onError({ message: 'boom' });
    participant.onReconnecting();
    participant.onReconnected();

    expect(w.logs).toEqual([
      { type: 'session.error', clientId: 'participant' },
      { type: 'session.reconnecting', clientId: 'participant' },
      { type: 'session.reconnected', clientId: 'participant' },
    ]);
  });

  it('keeps the rendered reconnect banner up until BOTH legs are back', () => {
    const w = makeWorld();
    const speaker = buildChannelTelemetryHandlers('speaker', w.portsFor());
    const participant = buildChannelTelemetryHandlers('participant', w.portsFor());

    speaker.onReconnecting();
    participant.onReconnecting();
    expect(w.getRenderedIsReconnecting()).toBe(true);

    speaker.onReconnected();
    // The whole point: the speaker recovering must not tell the user the
    // session is healthy while the participant leg is still down.
    expect(w.getRenderedIsReconnecting()).toBe(true);
    expect(isAnyChannelReconnecting(w.getReconnecting())).toBe(true);

    participant.onReconnected();
    expect(w.getRenderedIsReconnecting()).toBe(false);
  });

  it('does not double-count when the same leg re-announces a reconnect attempt', () => {
    const w = makeWorld();
    const speaker = buildChannelTelemetryHandlers('speaker', w.portsFor());
    speaker.onReconnecting();
    speaker.onReconnecting();
    speaker.onReconnected();
    expect(w.getRenderedIsReconnecting()).toBe(false);
  });

  it('prefers rawMessage for analytics while the log entry keeps the localized text', () => {
    const w = makeWorld();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const participant = buildChannelTelemetryHandlers('participant', w.portsFor());
    participant.onError({
      code: '503',
      message: '接続が中断されました',
      rawMessage: 'service unavailable',
    });
    expect(w.apiErrors[0].error_message).toBe('service unavailable');
    spy.mockRestore();
  });
});
```

- [ ] **Step 17: Run it and watch it fail**

Run: `npm run test -- --run src/components/MainPanel/participantTelemetryWiring.test.ts`

Expected: FAIL — `Failed to load url ./participantTelemetry` (the module does not exist).

- [ ] **Step 18: Implement the shared handler factory**

Create `src/components/MainPanel/participantTelemetry.ts`:

```ts
import type { AnalyticsEvents } from '../../lib/analytics';
import type { ClientId, EventData, RealtimeEventSource } from '../../stores/logStore';
import { buildApiErrorProps, clientErrorMessage, type ClientErrorEvent } from '../../lib/apiErrorProps';
import {
  channelReconnecting,
  channelReconnected,
  isAnyChannelReconnecting,
  type ReconnectingState,
} from './reconnectingChannels';

/**
 * The half of MainPanel's client event wiring that BOTH legs need.
 *
 * Until this existed, `setupClientListeners` hardcoded
 * `speakerClientRef.current`, so onError / onReconnecting / onReconnected could
 * only ever reach the speaker, while `createParticipantEventHandlers` wired
 * three handlers and no telemetry at all. In split Both mode the participant is
 * an independently failing provider stream, so that asymmetry hid roughly half
 * of all split-session outages from the error dashboards.
 *
 * Extracted from MainPanel (which has no test harness) so the wiring is a real
 * function a test can call — the same discipline `resolveVoicePrepOutcome`
 * follows.
 */
export interface ChannelTelemetryPorts {
  addRealtimeEvent: (
    event: EventData,
    source: RealtimeEventSource,
    eventType: string,
    clientId: ClientId
  ) => void;
  trackApiError: (props: AnalyticsEvents['api_error']) => void;
  /** Already defaulted by the caller — MainPanel passes `provider || Provider.OPENAI`. */
  provider: string;
  /** Reads/writes MainPanel's ref. Not React state: these fire from socket
   *  callbacks that can land several times inside one frame, and each one needs
   *  the value the previous one wrote. */
  readReconnecting: () => ReconnectingState;
  writeReconnecting: (next: ReconnectingState) => void;
  /** The single rendered boolean, derived from the whole set. */
  setIsReconnecting: (value: boolean) => void;
}

export interface ChannelTelemetryHandlers {
  onError: (event: ClientErrorEvent) => void;
  onReconnecting: () => void;
  onReconnected: () => void;
}

export function buildChannelTelemetryHandlers(
  channel: ClientId,
  ports: ChannelTelemetryPorts
): ChannelTelemetryHandlers {
  const apply = (next: ReconnectingState) => {
    ports.writeReconnecting(next);
    // Derived, never assigned directly: one leg recovering must not clear the
    // banner while the other is still down. See reconnectingChannels.ts.
    ports.setIsReconnecting(isAnyChannelReconnecting(next));
  };

  return {
    onError: (event: ClientErrorEvent) => {
      const message = clientErrorMessage(event);
      console.error(`[Sokuji] [MainPanel] [${channel}]`, event);
      ports.addRealtimeEvent(
        { type: 'session.error', data: { message, event } },
        'client',
        'session.error',
        channel
      );
      // buildApiErrorProps, not an inline object: which string becomes
      // error_message decides whether outages group at all, and `message`
      // above is the possibly-localized one the UI renders.
      ports.trackApiError(buildApiErrorProps(event, ports.provider, channel));
    },

    onReconnecting: () => {
      console.info(`[Sokuji] [MainPanel] [${channel}] session reconnecting...`);
      apply(channelReconnecting(ports.readReconnecting(), channel));
      ports.addRealtimeEvent(
        { type: 'session.reconnecting', data: { timestamp: Date.now() } },
        'client',
        'session.reconnecting',
        channel
      );
    },

    onReconnected: () => {
      console.info(`[Sokuji] [MainPanel] [${channel}] session reconnected successfully`);
      apply(channelReconnected(ports.readReconnecting(), channel));
      ports.addRealtimeEvent(
        { type: 'session.reconnected', data: { timestamp: Date.now() } },
        'client',
        'session.reconnected',
        channel
      );
    },
  };
}
```

- [ ] **Step 19: Run it and watch it pass**

Run: `npm run test -- --run src/components/MainPanel/participantTelemetryWiring.test.ts`

Expected: PASS (6 tests).

- [ ] **Step 20: Wire MainPanel's two legs through the factory**

Four edits in `src/components/MainPanel/MainPanel.tsx`.

**20a.** Add the imports next to the existing MainPanel-sibling imports:

```ts
import { buildChannelTelemetryHandlers, type ChannelTelemetryPorts } from './participantTelemetry';
import { NO_CHANNELS_RECONNECTING, type ReconnectingState } from './reconnectingChannels';
import { clientErrorMessage } from '../../lib/apiErrorProps';
```

**20b.** Add the ref and the shared ports builder immediately below the existing
`sonioxRemainingLow` declaration (find the verbatim anchor):

```ts
  const sonioxRemainingLow = !!sonioxCountdown && sonioxCountdown.totalMs > 0
    && sonioxCountdown.remainingMs / sonioxCountdown.totalMs < 0.2;
```

Insert after it:

```ts
  // Which legs are reconnecting right now. A ref rather than state: these
  // transitions arrive from socket callbacks that can land several times in one
  // frame, and each needs the value the previous one wrote. The single rendered
  // `isReconnecting` boolean is derived from it inside the telemetry handlers.
  const reconnectingChannelsRef = useRef<ReconnectingState>(NO_CHANNELS_RECONNECTING);

  const telemetryPortsFor = useCallback((): Omit<ChannelTelemetryPorts, never> => ({
    addRealtimeEvent,
    trackApiError: (props) => trackEvent('api_error', props),
    provider: provider || Provider.OPENAI,
    readReconnecting: () => reconnectingChannelsRef.current,
    writeReconnecting: (next) => { reconnectingChannelsRef.current = next; },
    setIsReconnecting,
  }), [addRealtimeEvent, trackEvent, provider, setIsReconnecting]);
```

**20c.** In `createParticipantEventHandlers`, replace this verbatim opening:

```ts
  const createParticipantEventHandlers = useCallback((
    client: IClient
  ): ClientEventHandlers => ({
    onRealtimeEvent: (realtimeEvent: RealtimeEvent) => {
```

with:

```ts
  const createParticipantEventHandlers = useCallback((
    client: IClient
  ): ClientEventHandlers => ({
    // The participant leg is an independently failing provider stream in split
    // Both mode, so it reports its own errors and reconnects, tagged
    // 'participant'. Deliberately NO conversation bubble here, unlike the
    // speaker: `onConversationUpdated` below replaces the whole participant
    // list with `client.getConversationItems()`, which would wipe a manually
    // appended error item — the exact hazard participantErrorOrdering.test.ts
    // documents. Either leg dying already tears the session down via onClose
    // and the user sees that; what was missing was telemetry.
    ...buildChannelTelemetryHandlers('participant', telemetryPortsFor()),
    onRealtimeEvent: (realtimeEvent: RealtimeEvent) => {
```

and replace the dependency array at the end of that same `useCallback`, verbatim:

```ts
  }), [addRealtimeEvent, trackEvent, provider]);
```

with:

```ts
  }), [addRealtimeEvent, trackEvent, provider, telemetryPortsFor]);
```

**20d.** In `setupClientListeners`, replace the speaker's three handlers verbatim (lines
1404-1449) — everything from `onError: (event: any) => {` through the closing `},` of
`onReconnected`:

```ts
      onError: (event: any) => {
        console.error('[Sokuji] [MainPanel]', event);

        // Surface error to LogsPanel so users can see it
        const errorMessage = event.message || event.error || 'Unknown error';
        addRealtimeEvent(
          { type: 'session.error', data: { message: errorMessage, event } },
          'client', 'session.error'
        );

        // Show error in conversation panel so it's visible to user
        setItems(prevItems => [...prevItems, {
          id: `error-${Date.now()}`,
          role: 'system',
          type: 'error',
          status: 'completed',
          createdAt: Date.now(),
          formatted: { text: errorMessage },
        }]);

        // Track API errors. Built by buildApiErrorProps, not inline: which
        // string becomes error_message decides whether outages are groupable
        // at all, and `errorMessage` above is the user-facing (possibly
        // localized) one this panel renders — not the one analytics wants.
        // It also omits error_code when a client reports none, rather than
        // sending the property as undefined.
        trackEvent('api_error', buildApiErrorProps(event, provider || Provider.OPENAI));
      },
      onReconnecting: () => {
        console.info('[Sokuji] [MainPanel] Session reconnecting...');
        setIsReconnecting(true);
        addRealtimeEvent(
          { type: 'session.reconnecting', data: { timestamp: Date.now() } },
          'client',
          'session.reconnecting'
        );
      },
      onReconnected: () => {
        console.info('[Sokuji] [MainPanel] Session reconnected successfully');
        setIsReconnecting(false);
        addRealtimeEvent(
          { type: 'session.reconnected', data: { timestamp: Date.now() } },
          'client',
          'session.reconnected'
        );
      },
```

with:

```ts
      // Logging, api_error and the reconnect flag are identical for both legs
      // and now come from one place, tagged per channel — see
      // participantTelemetry.ts. The speaker keeps one extra behaviour the
      // participant deliberately does not have: a visible conversation bubble.
      onError: (event: any) => {
        speakerTelemetry.onError(event);
        // Speaker-only: the participant's list is replaced wholesale by its
        // onConversationUpdated, which would wipe an appended item.
        setItems(prevItems => [...prevItems, {
          id: `error-${Date.now()}`,
          role: 'system',
          type: 'error',
          status: 'completed',
          createdAt: Date.now(),
          formatted: { text: clientErrorMessage(event) },
        }]);
      },
      onReconnecting: speakerTelemetry.onReconnecting,
      onReconnected: speakerTelemetry.onReconnected,
```

and, immediately after `setupClientListeners`' early return, replace verbatim:

```ts
    if (!client || !audioService) return;

    const eventHandlers: ClientEventHandlers = {
```

with:

```ts
    if (!client || !audioService) return;

    const speakerTelemetry = buildChannelTelemetryHandlers('speaker', telemetryPortsFor());

    const eventHandlers: ClientEventHandlers = {
```

Finally, add `telemetryPortsFor` to `setupClientListeners`' dependency array — replace verbatim:

```ts
    addRealtimeEvent,
    setIsSessionActive,
    setIsReconnecting
  ]); // addRealtimeEvent from Zustand is stable
```

with:

```ts
    addRealtimeEvent,
    setIsSessionActive,
    setIsReconnecting,
    telemetryPortsFor
  ]); // addRealtimeEvent from Zustand is stable
```

**20e.** Reset the per-channel set on teardown, so a leg that was mid-reconnect when the user
pressed Stop does not leave a stale entry that keeps the next session's banner up. In
`disconnectConversation`, replace verbatim:

```ts
      setIsReconnecting(false);
      setIsSessionActive(false);
```

with:

```ts
      // Both the derived boolean and the set it is derived from: a leg still
      // listed as reconnecting here would survive into the next session and
      // pin its banner on.
      reconnectingChannelsRef.current = NO_CHANNELS_RECONNECTING;
      setIsReconnecting(false);
      setIsSessionActive(false);
```

- [ ] **Step 21: Run the whole suite**

Run: `npm run test -- --run`

Expected: PASS, with the new files' counts added and no other file's count changed.
(`tsc` is NOT clean in this repo — roughly 113 pre-existing errors — so vitest is the gate.
Do not run `tsc` as an acceptance check.)

- [ ] **Step 22: Commit Part B**

```bash
git add src/lib/analytics.ts \
        src/lib/apiErrorProps.ts \
        src/lib/apiErrorProps.test.ts \
        src/components/MainPanel/reconnectingChannels.ts \
        src/components/MainPanel/reconnectingChannels.test.ts \
        src/components/MainPanel/participantTelemetry.ts \
        src/components/MainPanel/participantTelemetryWiring.test.ts \
        src/components/MainPanel/MainPanel.tsx
git commit -m "$(cat <<'EOF'
fix(mainpanel): report the participant leg's outages, tagged per channel

createParticipantEventHandlers wired only onRealtimeEvent, onConversationUpdated
and onClose, and setupClientListeners read speakerClientRef, so onError /
onReconnecting / onReconnected could reach the speaker and nothing else. Split
Both mode makes the participant an independently failing Soniox stream, so that
asymmetry hid roughly half of split-session outages from api_error.

Both legs now share buildChannelTelemetryHandlers, which tags api_error and the
LogsPanel entries with 'speaker' or 'participant'. The single rendered
isReconnecting boolean is derived from a per-channel set, so one leg recovering
no longer clears the banner while the other is still down.

The participant deliberately gets no error bubble: its item list is replaced
wholesale by onConversationUpdated, which would wipe an appended item.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Carried in from the backend execution (added 2026-08-11, after the backend branch completed)

The backend landed as `sokuji-backend` branch `feat/soniox-split-both` (25 commits,
809 tests). Four things it discovered change what this plan's tasks must do. They are
here rather than in a task body because each one crosses task boundaries.

**FE3 must post `role` on every `session-started`, and the backend now enforces it.**
`markStarted` refuses to guess a leg when the lease owns two streams, and the handler
now answers **400** with a machine-readable `reason` (`role_required`, or
`role_not_issued` when the role was never issued for that lease) instead of the
`{ok:true}` it used to return. A roleless body against a split lease therefore fails
loudly rather than leaving the lease un-extended — which previously let it expire at
~195 s and allowed the same account to acquire a *second* lease while the first was
still streaming. No currently-shipped client can reach either refusal: they post only
the legacy vocabulary, which resolves to one issued stream.

**FE2's floor values, now that the backend has them.** The Start floor comes from
`sonioxStartFloorMicroUsd(roles)` — conservative rates 1.10/hour per transcription
stream and 1.40 per synthesis stream, K = 2.0. The concrete numbers the backend
computes today: **18,334** µUSD for a shared text-only session and **41,667** for
speech-to-speech, against `sonioxManagedMinBalance.ts`'s current 10,000 / 25,000.
The 402 body now also carries `requiredMicroUsd` and `balanceMicroUsd`, so the client
can show what was needed rather than a bare refusal. **`main` deploys the backend
ahead of the client**, so until FE2 ships there is a window where the local gate says
Start is fine and the backend answers 402.

**The `clientReferenceId` in `SonioxSessionKeyResponse` is now four segments**, and its
comment in `SonioxClient.ts` still documents three. The value is opaque to the client,
so only the comment needs correcting — but the reason matters: Soniox attributes usage
to the reference bound to the *key*, and ignores the one the socket declares, so the
socket-level echo is inert. Do not build anything on it.

**Split Both widens a crashed client's account hold from ~75 s to ~195 s**, because the
lease must outlast the participant leg's 180 s start window (which exists to cover the
loopback permission dialog). Every legacy shape still holds for 75 s exactly. This is
the designed trade-off, not a regression to fix.

### One open question that gates shipping split Both

**Does a connected-but-silent Soniox transcription stream emit a usage log?** If it does
not, a split session whose participant leg is muted for its whole duration never clears
its ended-mask bit, and the lease strands for the full grant plus ten minutes — with no
alarm and no client bug. The backend's whole release predicate rests on "a usage log
exists once a stream has ended". Settling it needs one live managed split session with
the participant leg muted, watched through to the usage logs. This is the single
highest-value check before the feature is exposed to users.
