# Palabra Platform API Key (Dual Auth Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add platform.palabra.ai single-API-key auth as a second auth mode on the existing `palabraai` provider, alongside the legacy app Client ID/Secret pair, switchable without losing either credential.

**Architecture:** Same provider, same client. `PalabraAIClient` takes a `PalabraCredentials` discriminated union and builds auth headers in one place (`authHeaders()`). The settings slice gains `authMode` + `apiKey` (flat fields; all three credential values persist independently). The descriptor maps platform mode into the existing shared `Credentials` contract as `{ ok, primary: apiKey }` with no `secret`; `createClient` branches on `secret` presence. Spec: `docs/superpowers/specs/2026-07-30-palabra-platform-api-key-design.md`.

**Tech Stack:** TypeScript, React, Zustand, vitest. No new dependencies.

## Global Constraints

- `livekit-client` stays pinned to exact `2.18.7` — do not touch `package.json` dependencies.
- Never fall back from one auth mode to the other automatically (spec: "A failing credential is never silently retried with the other kind").
- All code and comments in English. Conventional commit messages.
- The correctness gate is `npm run test` (vitest). `tsc` has ~113 pre-existing errors and is NOT a gate — do not try to make it clean, but do not add new errors in files you touch.
- Do not `git push` or open PRs — the user approves publish actions separately.
- Work on branch `feat/palabra-platform-auth` (already created; spec committed).
- API keys/secrets must never be committed, echoed to logs, or pasted into files. Use environment variables for live tests.

---

### Task 1: Live Bearer smoke test (GATE — do this before any code)

**Files:** none (scratch commands only; nothing committed)

**Interfaces:**
- Consumes: `PALABRA_API_KEY` env var (real platform key, ask the user to provide it in the shell); optionally `PALABRA_CLIENT_ID`/`PALABRA_CLIENT_SECRET` for the app-mode baseline.
- Produces: go/no-go decision. If the Bearer POST fails, STOP the plan and report — the design needs re-evaluation (see spec §Testing).

- [ ] **Step 1: Confirm the key is present without printing it**

Run: `[ -n "$PALABRA_API_KEY" ] && echo "key present" || echo "MISSING - ask user"`
Expected: `key present`. If missing, pause and ask the user to export it.

- [ ] **Step 2: Create a session with Bearer auth**

```bash
curl -s -X POST "https://api.palabra.ai/session-storage/session" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PALABRA_API_KEY" \
  -d '{"data": {"intent": "api"}}' | tee /tmp/palabra-smoke.json | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print('ok:', d.get('ok')); print('fields:', sorted(d.get('data',{}).keys()))"
```

Expected: `ok: True` and fields including `id`, `publisher`, `webrtc_url`, `ws_url`. **Gate: if this fails (401/403/missing fields), STOP and report to the user.**

- [ ] **Step 3: List sessions with Bearer auth (validation-endpoint check)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://api.palabra.ai/session-storage/sessions" \
  -H "Accept: application/json" -H "Authorization: Bearer $PALABRA_API_KEY"
```

Expected: `200`. This is the endpoint `validateApiKey` uses.

- [ ] **Step 4: Delete the smoke-test session (cleanup)**

```bash
SESSION_ID=$(python3 -c "import json; print(json.load(open('/tmp/palabra-smoke.json'))['data']['id'])")
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE \
  "https://api.palabra.ai/session-storage/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $PALABRA_API_KEY"
rm /tmp/palabra-smoke.json
```

Expected: `204` (or `200`).

- [ ] **Step 5: CORS preflight probe (informative, not a hard gate)**

```bash
curl -s -i -X OPTIONS "https://api.palabra.ai/session-storage/sessions" \
  -H "Origin: chrome-extension://abcdefghijklmnop" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization" | head -20
```

Expected: response headers contain `access-control-allow-headers` including `authorization` (case-insensitive). If OPTIONS is not answered meaningfully, note it — the definitive browser-context check happens in Task 7 acceptance. Record the result in the task report either way.

---

### Task 2: `PalabraAIClient` credential union + `authHeaders()`

**Files:**
- Modify: `src/services/clients/PalabraAIClient.ts` (constructor at lines ~140-145, static `validateApiKey` at ~150-201, `createSession` at ~404-438, `getUserSessions` at ~1064-1110, `deleteSession` at ~1115-1133)
- Modify: `src/services/clients/PalabraAIClient.test.ts` (constructor call at line 44; new describe block)
- Modify: `src/services/providers/PalabraAIProviderConfig.ts` (call-site adaptation only — `createClient` ~57-60, `validateAndFetchModels` ~73; platform branches come in Task 4)

**Interfaces:**
- Produces (Tasks 4+ rely on these exact shapes):

```typescript
// exported from src/services/clients/PalabraAIClient.ts
export type PalabraCredentials =
  | { kind: 'clientCredentials'; clientId: string; clientSecret: string }
  | { kind: 'apiKey'; apiKey: string };

// constructor
constructor(credentials: PalabraCredentials)

// static — same return type as before
static async validateApiKey(credentials: PalabraCredentials): Promise<ApiKeyValidationResult>
```

- [ ] **Step 1: Write the failing tests**

Append to `src/services/clients/PalabraAIClient.test.ts`:

```typescript
describe('PalabraAIClient auth headers', () => {
  it('builds ClientId/ClientSecret headers for app credentials', () => {
    const c = new PalabraAIClient({ kind: 'clientCredentials', clientId: 'id-1', clientSecret: 'sec-1' });
    expect((c as any).authHeaders()).toEqual({ ClientId: 'id-1', ClientSecret: 'sec-1' });
  });

  it('builds a Bearer Authorization header for a platform API key', () => {
    const c = new PalabraAIClient({ kind: 'apiKey', apiKey: 'pk-123' });
    expect((c as any).authHeaders()).toEqual({ Authorization: 'Bearer pk-123' });
  });
});

describe('PalabraAIClient.validateApiKey empty-credential short-circuit', () => {
  it('rejects an empty platform API key without a network call', async () => {
    const result = await PalabraAIClient.validateApiKey({ kind: 'apiKey', apiKey: '  ' });
    expect(result.valid).toBe(false);
  });

  it('rejects app credentials with a missing secret without a network call', async () => {
    const result = await PalabraAIClient.validateApiKey({
      kind: 'clientCredentials', clientId: 'id-1', clientSecret: '',
    });
    expect(result.valid).toBe(false);
  });
});
```

Also update the existing `beforeEach` (line 44):

```typescript
client = new PalabraAIClient({ kind: 'clientCredentials', clientId: 'test-id', clientSecret: 'test-secret' });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test -- src/services/clients/PalabraAIClient.test.ts`
Expected: new tests FAIL (constructor signature / `authHeaders` missing); pre-existing tests may fail to compile — that's fine at this step.

- [ ] **Step 3: Implement the client changes**

In `src/services/clients/PalabraAIClient.ts`:

3a. Add the exported union type above the class and replace the two credential fields:

```typescript
/**
 * Palabra has two credential systems: the legacy app.palabra.ai ClientId/ClientSecret
 * header pair and the platform.palabra.ai single API key (Authorization: Bearer).
 * Both hit the same endpoints; only the auth headers differ.
 */
export type PalabraCredentials =
  | { kind: 'clientCredentials'; clientId: string; clientSecret: string }
  | { kind: 'apiKey'; apiKey: string };
```

Replace `private clientId: string;` and `private clientSecret: string;` with `private credentials: PalabraCredentials;`, and the constructor:

```typescript
constructor(credentials: PalabraCredentials) {
  this.credentials = credentials;
  // Generate a unique instance ID that remains constant for this client instance
  this.instanceId = `palabra_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
```

3b. Add the header builders (static so `validateApiKey` can share it):

```typescript
private static authHeadersFor(credentials: PalabraCredentials): Record<string, string> {
  return credentials.kind === 'apiKey'
    ? { 'Authorization': `Bearer ${credentials.apiKey}` }
    : { 'ClientId': credentials.clientId, 'ClientSecret': credentials.clientSecret };
}

private authHeaders(): Record<string, string> {
  return PalabraAIClient.authHeadersFor(this.credentials);
}
```

3c. Rewrite `validateApiKey`'s signature and empty-check; keep the rest of its body (fetch of `/session-storage/sessions`, response handling, catch) unchanged except the headers:

```typescript
static async validateApiKey(credentials: PalabraCredentials): Promise<ApiKeyValidationResult> {
  try {
    const empty = credentials.kind === 'apiKey'
      ? !credentials.apiKey || credentials.apiKey.trim() === ''
      : !credentials.clientId || credentials.clientId.trim() === '' ||
        !credentials.clientSecret || credentials.clientSecret.trim() === '';
    if (empty) {
      return {
        valid: false,
        message: i18n.t('settings.errorValidatingApiKey'),
        validating: false
      };
    }

    // Test credentials by getting user sessions
    const response = await fetch(`${this.API_BASE_URL}/session-storage/sessions`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        ...PalabraAIClient.authHeadersFor(credentials),
      }
    });
    // ... rest of the method body unchanged ...
```

3d. In `createSession`, `getUserSessions`, `deleteSession`: replace the two literal `'ClientId': this.clientId, 'ClientSecret': this.clientSecret,` header lines with `...this.authHeaders(),`. In `createSession` also replace the body — `subscriber_count` is no longer in Palabra's `CreateSessionRequestV2` schema:

```typescript
body: JSON.stringify({
  data: {
    intent: 'api'
  }
})
```

3e. In `src/services/providers/PalabraAIProviderConfig.ts`, adapt the two call sites (app-mode mapping only; platform branches come in Task 4):

```typescript
// createClient body (keep the existing secret guard for now):
if (!creds.secret) throw new Error('Client secret is required for palabraai provider');
return new PalabraAIClient({ kind: 'clientCredentials', clientId: creds.primary, clientSecret: creds.secret });
```

```typescript
// validateAndFetchModels — replace the positional call:
const validation = await PalabraAIClient.validateApiKey({
  kind: 'clientCredentials', clientId: creds.primary, clientSecret: creds.secret,
});
```

(That call sits behind the existing `if (!creds.secret)` guard, so `creds.secret` is a definite `string` there.)

- [ ] **Step 4: Run the client tests, then the full suite**

Run: `npm run test -- src/services/clients/PalabraAIClient.test.ts`
Expected: PASS (all, including pre-existing).
Run: `npm run test`
Expected: PASS — descriptor registry and language tests must stay green.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/PalabraAIClient.ts src/services/clients/PalabraAIClient.test.ts src/services/providers/PalabraAIProviderConfig.ts
git commit -m "refactor(palabraai): parameterize client auth via PalabraCredentials union"
```

---

### Task 3: Settings fields + `authMode` migration

**Files:**
- Modify: `src/services/providers/PalabraAIProviderConfig.ts` (interface at lines 8-22, defaults at 24-38)
- Modify: `src/stores/settingsStore.ts` (exported migration fn near `migrateRejectedPalabraLanguages`; wiring in the load path at ~1212)
- Create: `src/stores/palabraAuthModeMigration.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:

```typescript
// PalabraAISettings gains (Task 4 + 5 read these):
authMode: 'app' | 'platform';   // default 'platform'
apiKey: string;                  // default ''

// exported from src/stores/settingsStore.ts (mirrors migrateRejectedPalabraLanguages):
export function migratePalabraAuthMode(
  storedAuthMode: string,
  slice: Pick<PalabraAISettings, 'clientId' | 'clientSecret'>
): Partial<Pick<PalabraAISettings, 'authMode'>>
```

**Why the extra `storedAuthMode` parameter:** `loadProviderSettings` fills every missing key with its default, per key. After loading, `authMode === 'platform'` is ambiguous — stored choice or injected default. The migration therefore probes the raw stored value separately with an empty-string sentinel default; `''` means "never stored".

- [ ] **Step 1: Write the failing tests**

Create `src/stores/palabraAuthModeMigration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { migratePalabraAuthMode } from './settingsStore';

describe('migratePalabraAuthMode', () => {
  it('keeps an explicitly stored app mode', () => {
    expect(migratePalabraAuthMode('app', { clientId: '', clientSecret: '' })).toEqual({});
  });

  it('keeps an explicitly stored platform mode even when legacy credentials exist', () => {
    expect(migratePalabraAuthMode('platform', { clientId: 'id', clientSecret: 'sec' })).toEqual({});
  });

  it('pins a legacy user (stored credentials, never chose a mode) to app', () => {
    expect(migratePalabraAuthMode('', { clientId: 'id', clientSecret: 'sec' })).toEqual({ authMode: 'app' });
  });

  it('pins to app when only one legacy field is present', () => {
    expect(migratePalabraAuthMode('', { clientId: 'id', clientSecret: '' })).toEqual({ authMode: 'app' });
    expect(migratePalabraAuthMode('', { clientId: '', clientSecret: 'sec' })).toEqual({ authMode: 'app' });
  });

  it('leaves a fresh install on the platform default', () => {
    expect(migratePalabraAuthMode('', { clientId: '', clientSecret: '' })).toEqual({ authMode: 'platform' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/stores/palabraAuthModeMigration.test.ts`
Expected: FAIL — `migratePalabraAuthMode` is not exported.

- [ ] **Step 3: Implement**

3a. `src/services/providers/PalabraAIProviderConfig.ts` — extend the interface and defaults:

```typescript
export interface PalabraAISettings {
  authMode: 'app' | 'platform';
  apiKey: string;
  clientId: string;
  clientSecret: string;
  // ... existing fields unchanged ...
}

export const defaultPalabraAISettings: PalabraAISettings = {
  authMode: 'platform',
  apiKey: '',
  clientId: '',
  clientSecret: '',
  // ... existing defaults unchanged ...
};
```

3b. `src/stores/settingsStore.ts` — add next to `migrateRejectedPalabraLanguages`:

```typescript
/**
 * Decide the auth mode for a persisted Palabra slice that predates authMode.
 * storedAuthMode is the RAW stored value probed with an empty-string sentinel
 * (loadProviderSettings merges defaults per key, so the merged slice cannot
 * distinguish "never stored" from "stored 'platform'"). A user with legacy
 * credentials who never chose a mode keeps working in app mode; everyone
 * else gets the platform default.
 */
export function migratePalabraAuthMode(
  storedAuthMode: string,
  slice: Pick<PalabraAISettings, 'clientId' | 'clientSecret'>
): Partial<Pick<PalabraAISettings, 'authMode'>> {
  if (storedAuthMode === 'app' || storedAuthMode === 'platform') return {};
  if (slice.clientId || slice.clientSecret) return { authMode: 'app' };
  return { authMode: 'platform' };
}
```

3c. Wire it into the load path — the existing palabra block becomes:

```typescript
// Drop persisted PalabraAI language codes the API rejects, so an existing
// user isn't left on a pair whose set_task fails validation.
const palabraSlice = loadedSlices.palabraai as PalabraAISettings | undefined;
if (palabraSlice) {
  Object.assign(palabraSlice, migrateRejectedPalabraLanguages(palabraSlice));
  // authMode predates some persisted slices; probe the raw stored value so a
  // default-injected 'platform' isn't mistaken for a user choice.
  const storedAuthMode = await service.getSetting('settings.palabraai.authMode', '');
  Object.assign(palabraSlice, migratePalabraAuthMode(storedAuthMode, palabraSlice));
}
```

- [ ] **Step 4: Run the migration tests, then the full suite**

Run: `npm run test -- src/stores/palabraAuthModeMigration.test.ts src/stores/palabraLanguageMigration.test.ts`
Expected: PASS.
Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/PalabraAIProviderConfig.ts src/stores/settingsStore.ts src/stores/palabraAuthModeMigration.test.ts
git commit -m "feat(palabraai): add authMode/apiKey settings with legacy-user migration"
```

---

### Task 4: Descriptor platform credential flow

**Files:**
- Modify: `src/services/providers/PalabraAIProviderConfig.ts` (`extractCredentials`, `peekPrimaryCredential`, `createClient`, `validateAndFetchModels`)
- Create: `src/services/providers/PalabraAIProviderConfig.test.ts`

**Interfaces:**
- Consumes: `PalabraCredentials` union and `validateApiKey(credentials)` from Task 2; `authMode`/`apiKey` settings fields from Task 3.
- Produces: descriptor behavior the UI (Task 5) relies on — `peekPrimaryCredential` returns the active mode's credential; `extractCredentials` encodes platform as `{ ok: true, primary: apiKey }` with **no** `secret` key.

- [ ] **Step 1: Write the failing tests**

Create `src/services/providers/PalabraAIProviderConfig.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../locales', () => ({
  default: { t: (key: string) => key }
}));
vi.mock('livekit-client', () => ({
  setLogLevel: vi.fn(),
  Room: class {}, RoomEvent: {}, TrackPublication: class {},
  RemoteParticipant: class {}, RemoteTrack: class {},
  RemoteAudioTrack: class {}, LocalAudioTrack: class {},
}));

const { PalabraAIProviderConfig, defaultPalabraAISettings } = await import('./PalabraAIProviderConfig');
const { PalabraAIClient } = await import('../clients/PalabraAIClient');

const descriptor = new PalabraAIProviderConfig();
const appSlice = { ...defaultPalabraAISettings, authMode: 'app' as const, clientId: 'id-1', clientSecret: 'sec-1' };
const platformSlice = { ...defaultPalabraAISettings, authMode: 'platform' as const, apiKey: 'pk-1' };

afterEach(() => vi.restoreAllMocks());

describe('extractCredentials', () => {
  it('maps platform mode to primary-only credentials (no secret key)', async () => {
    const creds = await descriptor.extractCredentials(platformSlice, {});
    expect(creds).toEqual({ ok: true, primary: 'pk-1' });
    expect('secret' in creds).toBe(false);
  });

  it('rejects platform mode without an API key', async () => {
    const creds = await descriptor.extractCredentials({ ...platformSlice, apiKey: '' }, {});
    expect(creds.ok).toBe(false);
  });

  it('maps app mode to primary+secret', async () => {
    expect(await descriptor.extractCredentials(appSlice, {}))
      .toEqual({ ok: true, primary: 'id-1', secret: 'sec-1' });
  });

  it('rejects app mode with a missing half of the pair', async () => {
    expect((await descriptor.extractCredentials({ ...appSlice, clientSecret: '' }, {})).ok).toBe(false);
    expect((await descriptor.extractCredentials({ ...appSlice, clientId: '' }, {})).ok).toBe(false);
  });

  it('app mode ignores a stale apiKey value; platform mode ignores stale clientId/clientSecret', async () => {
    expect(await descriptor.extractCredentials({ ...appSlice, apiKey: 'stale' }, {}))
      .toEqual({ ok: true, primary: 'id-1', secret: 'sec-1' });
    expect(await descriptor.extractCredentials({ ...platformSlice, clientId: 'stale', clientSecret: 'stale' }, {}))
      .toEqual({ ok: true, primary: 'pk-1' });
  });
});

describe('peekPrimaryCredential', () => {
  it('returns the active mode credential', () => {
    expect(descriptor.peekPrimaryCredential(appSlice)).toBe('id-1');
    expect(descriptor.peekPrimaryCredential(platformSlice)).toBe('pk-1');
  });
});

describe('createClient', () => {
  it('builds an app-credential client when secret is present', () => {
    const client = descriptor.createClient({ ok: true, primary: 'id-1', secret: 'sec-1' }, { transport: 'websocket' } as any);
    expect((client as any).credentials).toEqual({ kind: 'clientCredentials', clientId: 'id-1', clientSecret: 'sec-1' });
  });

  it('builds a platform-key client when secret is absent', () => {
    const client = descriptor.createClient({ ok: true, primary: 'pk-1' }, { transport: 'websocket' } as any);
    expect((client as any).credentials).toEqual({ kind: 'apiKey', apiKey: 'pk-1' });
  });
});

describe('validateAndFetchModels', () => {
  it('validates a platform key (no secret) instead of demanding a client secret', async () => {
    const spy = vi.spyOn(PalabraAIClient, 'validateApiKey').mockResolvedValue({
      valid: true, message: 'ok', validating: false,
    });
    const result = await descriptor.validateAndFetchModels({ ok: true, primary: 'pk-1' });
    expect(spy).toHaveBeenCalledWith({ kind: 'apiKey', apiKey: 'pk-1' });
    expect(result.validation.valid).toBe(true);
    expect(result.models).toHaveLength(1);
  });

  it('validates app credentials as before', async () => {
    const spy = vi.spyOn(PalabraAIClient, 'validateApiKey').mockResolvedValue({
      valid: true, message: 'ok', validating: false,
    });
    await descriptor.validateAndFetchModels({ ok: true, primary: 'id-1', secret: 'sec-1' });
    expect(spy).toHaveBeenCalledWith({ kind: 'clientCredentials', clientId: 'id-1', clientSecret: 'sec-1' });
  });
});
```

- [ ] **Step 2: Run tests to verify the platform-path ones fail**

Run: `npm run test -- src/services/providers/PalabraAIProviderConfig.test.ts`
Expected: FAIL on platform-mode cases ("Both Client ID and Client Secret..." / secret guard throw); app-mode cases pass.

- [ ] **Step 3: Implement the descriptor branches**

In `src/services/providers/PalabraAIProviderConfig.ts` (import `PalabraCredentials` from the client module):

```typescript
async extractCredentials(slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
  const s = slice as PalabraAISettings;
  if (s?.authMode === 'platform') {
    if (!s.apiKey || s.apiKey.trim() === '') {
      return { ok: false, missing: 'API Key is required for Palabra AI' };
    }
    // No `secret` key: createClient/validateAndFetchModels decode its absence
    // as platform mode. Both ends of that convention live in Palabra's own files.
    return { ok: true, primary: s.apiKey };
  }
  if (!s?.clientId || !s?.clientSecret) {
    return { ok: false, missing: 'Both Client ID and Client Secret are required for Palabra AI' };
  }
  return { ok: true, primary: s.clientId, secret: s.clientSecret };
}

peekPrimaryCredential(slice: unknown): string {
  const s = slice as PalabraAISettings;
  return s?.authMode === 'platform' ? (s?.apiKey ?? '') : (s?.clientId ?? '');
}

createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
  return new PalabraAIClient(PalabraAIProviderConfig.toPalabraCredentials(creds));
}

async validateAndFetchModels(creds: Credentials): Promise<{
  validation: ApiKeyValidationResult; models: FilteredModel[];
}> {
  if (!creds.ok) {
    return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
  }
  const validation = await PalabraAIClient.validateApiKey(
    PalabraAIProviderConfig.toPalabraCredentials(creds)
  );
  return {
    validation,
    models: [{ id: 'realtime-translation', type: 'realtime', created: Date.now() / 1000 }],
  };
}

/**
 * secret present = app pair, absent = platform key. A deprecated-façade caller
 * passing a clientId without its secret now gets a Bearer 401 from validation
 * instead of the old tailored both-required message — acceptable degradation;
 * the live path (extractCredentials) always sets secret for app mode.
 */
private static toPalabraCredentials(creds: Credentials & { ok: true }): PalabraCredentials {
  return creds.secret !== undefined
    ? { kind: 'clientCredentials', clientId: creds.primary, clientSecret: creds.secret }
    : { kind: 'apiKey', apiKey: creds.primary };
}
```

This **deletes** the old `if (!creds.secret) throw` guard in `createClient` and the `if (!creds.secret) return "Both required"` legacy guard in `validateAndFetchModels`.

- [ ] **Step 4: Run the descriptor tests, then the full suite**

Run: `npm run test -- src/services/providers/PalabraAIProviderConfig.test.ts`
Expected: PASS.
Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/PalabraAIProviderConfig.ts src/services/providers/PalabraAIProviderConfig.test.ts
git commit -m "feat(palabraai): route platform API keys through the descriptor credential flow"
```

---

### Task 5: Settings UI + English locale keys

**Files:**
- Modify: `src/components/Settings/sections/ProviderSection.tsx` (Palabra block at ~758-795; `updateApiKey` switch case at ~305)
- Modify: `src/components/SettingsInitializer/SettingsInitializer.tsx` (validation-effect deps at ~117)
- Modify: `src/components/Settings/Settings.scss` (inside `.palabraai-credentials-group` at ~1217)
- Modify: `src/locales/en/translation.json` (`providers.palabraai` block at ~369)

**Interfaces:**
- Consumes: `authMode`/`apiKey` fields (Task 3); mode-aware `peekPrimaryCredential` (Task 4) — `getCurrentApiKey` needs no change, it already delegates to the descriptor.
- Produces: locale keys Task 6 replicates: `providers.palabraai.apiKeyPlaceholder`, `.authModePlatform`, `.authModeApp`.

- [ ] **Step 1: Replace the Palabra credential block in `ProviderSection.tsx`**

The existing block (two unconditional inputs) becomes:

```tsx
) : provider === Provider.PALABRA_AI ? (
  // PalabraAI has two auth systems: platform API key (Bearer) or the legacy
  // app Client ID/Secret pair. All three values persist; the toggle only
  // selects which are used.
  <div className="palabraai-credentials-group">
    <div className="palabraai-auth-mode">
      <label className="auth-mode-option">
        <input
          type="radio"
          name="palabraai-auth-mode"
          checked={palabraAISettings.authMode === 'platform'}
          onChange={() => updatePalabraAISettings({ authMode: 'platform' })}
          disabled={isSessionActive}
        />
        {t('providers.palabraai.authModePlatform', 'Platform API Key')}
      </label>
      <label className="auth-mode-option">
        <input
          type="radio"
          name="palabraai-auth-mode"
          checked={palabraAISettings.authMode === 'app'}
          onChange={() => updatePalabraAISettings({ authMode: 'app' })}
          disabled={isSessionActive}
        />
        {t('providers.palabraai.authModeApp', 'App Client ID/Secret')}
      </label>
    </div>
    {palabraAISettings.authMode === 'platform' ? (
      <div className="api-key-input-group">
        <input
          type="password"
          value={palabraAISettings.apiKey}
          onChange={(e) => updatePalabraAISettings({ apiKey: e.target.value })}
          placeholder={t('providers.palabraai.apiKeyPlaceholder', 'API Key')}
          className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
          disabled={isSessionActive}
        />
        <button
          className="validate-button"
          onClick={handleValidateApiKey}
          disabled={!palabraAISettings.apiKey || isValidating || isSessionActive}
          title={t('simpleSettings.validate')}
        >
          {isValidating ? <span className="spinner" /> : isApiKeyValid ? <CheckCircle size={16} /> : t('simpleSettings.validate')}
        </button>
      </div>
    ) : (
      <>
        <div className="api-key-input-group">
          <input
            type="password"
            value={palabraAISettings.clientId}
            onChange={(e) => updatePalabraAISettings({ clientId: e.target.value })}
            placeholder={t('providers.palabraai.clientIdPlaceholder', 'Client ID')}
            className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
            disabled={isSessionActive}
          />
        </div>
        <div className="api-key-input-group">
          <input
            type="password"
            value={palabraAISettings.clientSecret}
            onChange={(e) => updatePalabraAISettings({ clientSecret: e.target.value })}
            placeholder={t('providers.palabraai.clientSecretPlaceholder', 'Client Secret')}
            className={`api-key-input ${isApiKeyValid === true ? 'valid' : isApiKeyValid === false ? 'invalid' : ''}`}
            disabled={isSessionActive}
          />
          <button
            className="validate-button"
            onClick={handleValidateApiKey}
            disabled={!palabraAISettings.clientId || !palabraAISettings.clientSecret || isValidating || isSessionActive}
            title={t('simpleSettings.validate')}
          >
            {isValidating ? (
              <span className="spinner" />
            ) : isApiKeyValid ? (
              <CheckCircle size={16} />
            ) : (
              t('simpleSettings.validate')
            )}
          </button>
        </div>
      </>
    )}
  </div>
) : (
```

- [ ] **Step 2: Make the `updateApiKey` switch mode-aware**

Replace the `Provider.PALABRA_AI` case (~line 305):

```typescript
case Provider.PALABRA_AI:
  if (palabraAISettings.authMode === 'platform') {
    updatePalabraAISettings({ apiKey: value });
  } else {
    updatePalabraAISettings({ clientId: value });
  }
  break;
```

- [ ] **Step 3: Extend the auto-validation deps in `SettingsInitializer.tsx`**

In the deps array of the API-provider validation effect (~line 117), replace
`palabraAISettings.clientId, palabraAISettings.clientSecret,` with:

```typescript
palabraAISettings.authMode, palabraAISettings.apiKey,
palabraAISettings.clientId, palabraAISettings.clientSecret,
```

- [ ] **Step 4: Add the radio-row styles**

Inside `.palabraai-credentials-group` in `src/components/Settings/Settings.scss` (block starts ~line 1217), add:

```scss
.palabraai-auth-mode {
  display: flex;
  gap: 16px;

  .auth-mode-option {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 13px;

    input[type='radio'] {
      accent-color: #10a37f;
      margin: 0;
      cursor: pointer;
    }
  }
}
```

(Inherit text colors from the surrounding theme; `#10a37f` is the app's primary action color.)

- [ ] **Step 5: Add the English locale keys**

In `src/locales/en/translation.json`, extend the `providers.palabraai` block:

```json
"palabraai": {
  "name": "Palabra AI",
  "description": "Specialized translation AI",
  "clientIdPlaceholder": "Client ID",
  "clientSecretPlaceholder": "Client Secret",
  "apiKeyPlaceholder": "API Key",
  "authModePlatform": "Platform API Key",
  "authModeApp": "App Client ID/Secret"
}
```

- [ ] **Step 6: Run the full suite and a production build**

Run: `npm run test`
Expected: PASS.
Run: `npm run build`
Expected: builds without new errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/Settings/sections/ProviderSection.tsx src/components/SettingsInitializer/SettingsInitializer.tsx src/components/Settings/Settings.scss src/locales/en/translation.json
git commit -m "feat(palabraai): auth mode toggle UI with per-mode credential inputs"
```

---

### Task 6: Locale sweep (all remaining locales)

**Files:**
- Modify: every `src/locales/<lng>/translation.json` except `en` that has a `providers.palabraai` block (30 of 32 locales have `clientIdPlaceholder` today — match that distribution; skip a locale only if it has no `providers.palabraai` block at all).

**Interfaces:**
- Consumes: the three key names from Task 5: `apiKeyPlaceholder`, `authModePlatform`, `authModeApp`.

- [ ] **Step 1: Add the three keys to each locale**

For each locale file, add translated values inside `providers.palabraai`, keeping key order consistent with `en`. Translation guidance: "API Key" is a product noun — most locales keep it as "API Key"/local transliteration (follow how each locale already translates `soniox.apiKeyPlaceholder` or `simpleSettings.apiKeyPlaceholder`); "Platform" and "App" refer to Palabra's product names and stay untranslated in most languages. Examples:

- `zh`: `"apiKeyPlaceholder": "API 密钥"`, `"authModePlatform": "Platform API 密钥"`, `"authModeApp": "App Client ID/Secret"`
- `ja`: `"apiKeyPlaceholder": "APIキー"`, `"authModePlatform": "Platform APIキー"`, `"authModeApp": "App Client ID/Secret"`
- `de`: `"apiKeyPlaceholder": "API-Schlüssel"`, `"authModePlatform": "Platform-API-Schlüssel"`, `"authModeApp": "App Client-ID/Secret"`

- [ ] **Step 2: Verify coverage and JSON validity**

```bash
for f in src/locales/*/translation.json; do
  python3 -c "import json;json.load(open('$f'))" || echo "INVALID: $f"
done
grep -rl "authModePlatform" src/locales/ | wc -l
grep -rl "clientIdPlaceholder" src/locales/ | wc -l
```

Expected: no `INVALID` lines; the two counts are equal (new keys everywhere the old palabra keys exist).

- [ ] **Step 3: Run the full suite**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/locales
git commit -m "chore(i18n): add Palabra auth mode keys to all locales"
```

---

### Task 7: Full verification + live acceptance (user in the loop)

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything above; real credentials from the user (both kinds — confirmed available).

- [ ] **Step 1: Full suite + build from a clean state**

Run: `npm run test` then `npm run build`
Expected: all green, build succeeds.

- [ ] **Step 2: Migration spot-check in dev**

Run `npm run dev`, and with the user (or via devtools console against the running app):
1. Simulate a legacy user: with stored `clientId`/`clientSecret` and no stored `authMode`, reload — the Palabra settings must open in **App** mode with both values intact.
2. Toggle to Platform, reload — must stay Platform (choice persisted), and clientId/clientSecret must still be present when toggling back.

- [ ] **Step 3: Live acceptance — platform mode (user performs)**

Ask the user to: enter the platform API key, validate (expect green check), start a session, and speak a few sentences. Checklist to confirm together:
- transcriptions AND translated audio arrive (Palabra's known regression mode is "connected but zero transcriptions" — an idle-looking session is a FAIL, not a pass);
- no repeating `NegotiationError: negotiation timed out` in the console;
- the one expected harmless log: a failed WebSocket + 404 on `/rtc/v1` before the v0 fallback on first connect.

- [ ] **Step 4: Live acceptance — app mode regression (user performs)**

Switch to App mode with the legacy credentials and repeat the same checklist. Both modes passing is the acceptance bar.

- [ ] **Step 5: Report results**

Summarize both live runs (pass/fail per checklist item) to the user. Do NOT push or open a PR — the user decides the next step.
