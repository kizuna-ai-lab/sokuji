# Soniox EU/JP Regions — Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Sokuji user run Soniox against the EU or Japan deployment instead of only the US one, for both BYOK Soniox and Kizuna AI managed Soniox.

**Architecture:** One module (`src/lib/soniox/regions.ts`) owns the `<service>.<region>.soniox.com` shape. The region then travels *with the keys it belongs to*, as a field on `SonioxCredentialBundle`, so a split Both session's two legs each carry their own region and pairing a US key with an EU host is unrepresentable. BYOK stores one API key and one voice selection per region; managed sends the region to the backend and dials whatever region the response comes back with.

**Tech Stack:** React 18 + TypeScript, Zustand, Vitest + jsdom, i18next (30 catalogs), Vite.

**Spec:** `docs/superpowers/specs/2026-08-15-soniox-regions-design.md`

## Global Constraints

- **Regional hostnames** are `<service>.<region>.soniox.com`, US carrying no infix:

  | Region | REST | STT RT | TTS RT |
  |---|---|---|---|
  | `us` | `api.soniox.com` | `stt-rt.soniox.com` | `tts-rt.soniox.com` |
  | `eu` | `api.eu.soniox.com` | `stt-rt.eu.soniox.com` | `tts-rt.eu.soniox.com` |
  | `jp` | `api.jp.soniox.com` | `stt-rt.jp.soniox.com` | `tts-rt.jp.soniox.com` |

  `eu.api.soniox.com` does not resolve — the infix goes **after** the service name.
- **Region values** are exactly `'us' | 'eu' | 'jp'`; `'us'` is the default everywhere.
- **`apiKey` keeps meaning the US/global key.** No settings migration: the field with no region suffix pairs with the host with no region infix.
- **The managed client trusts the region in the session-key RESPONSE**, never its own setting — a missing or unrecognized value normalizes to `'us'`.
- **Every new locale key must exist in all 30 catalogs.** `src/locales/locales.consistency.test.ts` asserts exact key parity, non-empty strings, and placeholder parity.
- TypeScript strict mode. English-only comments. Conventional commits.
- Run a single test file with `npm run test -- <path>`.

---

### Task 1: Region host table

**Files:**
- Create: `src/lib/soniox/regions.ts`
- Create: `src/lib/soniox/regions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type SonioxRegion = 'us' | 'eu' | 'jp'`; `SONIOX_REGIONS: readonly SonioxRegion[]`; `DEFAULT_SONIOX_REGION: SonioxRegion`; `SONIOX_REGION_LABELS: Record<SonioxRegion, string>`; `sonioxHosts(region): { api: string; sttRt: string; ttsRt: string }`; `asSonioxRegion(value: unknown): SonioxRegion`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/soniox/regions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  SONIOX_REGIONS,
  DEFAULT_SONIOX_REGION,
  SONIOX_REGION_LABELS,
  sonioxHosts,
  asSonioxRegion,
} from './regions';

describe('sonioxHosts', () => {
  it('gives US the region-less hosts', () => {
    expect(sonioxHosts('us')).toEqual({
      api: 'api.soniox.com',
      sttRt: 'stt-rt.soniox.com',
      ttsRt: 'tts-rt.soniox.com',
    });
  });

  it('puts the region infix AFTER the service name', () => {
    expect(sonioxHosts('eu')).toEqual({
      api: 'api.eu.soniox.com',
      sttRt: 'stt-rt.eu.soniox.com',
      ttsRt: 'tts-rt.eu.soniox.com',
    });
    expect(sonioxHosts('jp')).toEqual({
      api: 'api.jp.soniox.com',
      sttRt: 'stt-rt.jp.soniox.com',
      ttsRt: 'tts-rt.jp.soniox.com',
    });
  });

  // `eu.api.soniox.com` is the shape everyone reaches for first, and it is
  // NXDOMAIN. Asserting the negative keeps a "tidy-up" that flips the two
  // segments from silently breaking every non-US session.
  it('never produces the region-first shape, which does not resolve', () => {
    for (const region of SONIOX_REGIONS) {
      const hosts = sonioxHosts(region);
      for (const host of Object.values(hosts)) {
        expect(host).not.toMatch(new RegExp(`^${region}\\.`));
      }
    }
  });
});

describe('asSonioxRegion', () => {
  it('passes every known region through', () => {
    expect(SONIOX_REGIONS.map(asSonioxRegion)).toEqual([...SONIOX_REGIONS]);
  });

  // Unlike the backend's parser, this one DEFAULTS rather than returning null:
  // its inputs are a persisted setting and a backend response field, and both
  // must degrade to a working session rather than to a malformed hostname.
  it('falls back to us for anything unrecognized', () => {
    expect(asSonioxRegion('EU')).toBe('us');
    expect(asSonioxRegion('uk')).toBe('us');
    expect(asSonioxRegion(undefined)).toBe('us');
    expect(asSonioxRegion(null)).toBe('us');
    expect(asSonioxRegion(7)).toBe('us');
  });

  it('us is the default region', () => {
    expect(DEFAULT_SONIOX_REGION).toBe('us');
  });
});

describe('SONIOX_REGION_LABELS', () => {
  it('labels every region', () => {
    for (const region of SONIOX_REGIONS) {
      expect(SONIOX_REGION_LABELS[region]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/soniox/regions.test.ts`
Expected: FAIL — cannot resolve `./regions`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/soniox/regions.ts`:

```ts
/**
 * Soniox regional deployments.
 *
 * Soniox runs one project per region, each with its OWN API key, reachable only
 * on its own hosts. The region is therefore part of the CREDENTIAL, not a
 * routing preference layered on top of one — which is why it travels on
 * SonioxCredentialBundle rather than living in a module-level "current region".
 *
 * Host shape verified against soniox.com/docs/data-residency and DNS-resolved
 * on 2026-08-15: `<service>.<region>.soniox.com`, US carrying NO infix. The
 * region-first shape everyone reaches for first (`eu.api.soniox.com`) is
 * NXDOMAIN, and regions.test.ts pins the negative.
 *
 * This is the ONLY place in the client where that shape exists.
 */

export type SonioxRegion = 'us' | 'eu' | 'jp';

export const SONIOX_REGIONS: readonly SonioxRegion[] = ['us', 'eu', 'jp'] as const;

export const DEFAULT_SONIOX_REGION: SonioxRegion = 'us';

/**
 * Dropdown labels. Deliberately NOT locale keys: these follow the same rule the
 * language dropdown already uses — a place is named in its own language — so
 * adding a region does not mean editing 30 catalogs before it can be offered.
 */
export const SONIOX_REGION_LABELS: Record<SonioxRegion, string> = {
  us: 'United States',
  eu: 'European Union',
  jp: '日本 (Japan)',
};

export interface SonioxHosts {
  /** REST API: key validation, voice cloning. */
  api: string;
  /** Real-time STT+translation WebSocket. */
  sttRt: string;
  /** Real-time TTS — WebSocket for sessions, HTTPS for one-shot previews. */
  ttsRt: string;
}

export function sonioxHosts(region: SonioxRegion): SonioxHosts {
  const infix = region === 'us' ? '' : `.${region}`;
  return {
    api: `api${infix}.soniox.com`,
    sttRt: `stt-rt${infix}.soniox.com`,
    ttsRt: `tts-rt${infix}.soniox.com`,
  };
}

/**
 * Narrow an untrusted value to a region, defaulting to US.
 *
 * Two untrusted sources feed this: a persisted settings value written by an
 * older or newer build, and the backend's session-key response (which an
 * older backend omits entirely). Both must degrade to a working session — a
 * malformed hostname would fail every connect with a DNS error nobody can act
 * on. This is the opposite choice from the backend's `parseSonioxRegion`,
 * which returns null so a REQUEST can be refused; that distinction is
 * deliberate and the two must not be unified.
 */
export function asSonioxRegion(value: unknown): SonioxRegion {
  return typeof value === 'string' && (SONIOX_REGIONS as readonly string[]).includes(value)
    ? (value as SonioxRegion)
    : DEFAULT_SONIOX_REGION;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/soniox/regions.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/soniox/regions.ts src/lib/soniox/regions.test.ts
git commit -m "feat(soniox): region host table

The <service>.<region>.soniox.com shape lives in exactly one module, with a
negative test pinning that the infix follows the service name -- the
region-first shape everyone reaches for first is NXDOMAIN. asSonioxRegion
defaults rather than rejecting, because its inputs are a persisted setting and
a backend response field and both must degrade to a working session."
```

---

### Task 2: The two session WebSockets take a region

**Files:**
- Modify: `src/services/clients/SonioxSttStream.ts` (delete `STT_URL`, add `SonioxSttConfig.region`)
- Modify: `src/services/clients/SonioxTtsStream.ts` (delete `TTS_URL`, add `SonioxTtsOptions.region`)
- Modify: `src/services/clients/SonioxSttStream.test.ts`, `src/services/clients/SonioxTtsStream.test.ts`

**Interfaces:**
- Consumes: `sonioxHosts`, `SonioxRegion` (Task 1).
- Produces: `SonioxSttConfig.region: SonioxRegion` (required); `SonioxTtsOptions.region: SonioxRegion` (required).

- [ ] **Step 1: Write the failing test**

Append to `src/services/clients/SonioxSttStream.test.ts`:

```ts
import { SONIOX_REGIONS, sonioxHosts } from '../../lib/soniox/regions';

describe('SonioxSttStream regional endpoints', () => {
  it.each(SONIOX_REGIONS)('opens the %s transcribe socket', async (region) => {
    const { ws } = await openStream({ ...CONFIG, region });
    expect(ws.url).toBe(`wss://${sonioxHosts(region).sttRt}/transcribe-websocket`);
  });
});
```

and add `region: 'us' as const,` to the shared `CONFIG` object at the top of that file.

Append to `src/services/clients/SonioxTtsStream.test.ts` (mirroring that file's own socket-opening helper):

```ts
import { SONIOX_REGIONS, sonioxHosts } from '../../lib/soniox/regions';

describe('SonioxTtsStream regional endpoints', () => {
  it.each(SONIOX_REGIONS)('opens the %s tts socket', async (region) => {
    const stream = new SonioxTtsStream({
      apiKey: 'k', voice: 'v', model: 'tts-rt-v2', sampleRate: 24000, region,
    });
    const connecting = stream.connect();
    MockWebSocket.instances[0].open();
    await connecting;
    expect(MockWebSocket.instances[0].url)
      .toBe(`wss://${sonioxHosts(region).ttsRt}/tts-websocket`);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/services/clients/SonioxSttStream.test.ts src/services/clients/SonioxTtsStream.test.ts`
Expected: FAIL — the EU/JP cases see the US URL.

- [ ] **Step 3: Write minimal implementation**

In `SonioxSttStream.ts`, delete `const STT_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';`, add the import, add the field to `SonioxSttConfig`:

```ts
import { sonioxHosts, type SonioxRegion } from '../../lib/soniox/regions';
```

```ts
  /** Which Soniox deployment this stream's `apiKey` belongs to. Required: a key
   *  and a host are one credential, and defaulting would silently dial US with
   *  a regional key. */
  region: SonioxRegion;
```

and in `connect`, replace `new WebSocket(STT_URL)` with:

```ts
      const ws = new WebSocket(`wss://${sonioxHosts(config.region).sttRt}/transcribe-websocket`);
```

In `SonioxTtsStream.ts`, delete `const TTS_URL = ...`, add the same import, add `region: SonioxRegion;` to `SonioxTtsOptions` with the same docstring, and in `connect` use:

```ts
      const ws = new WebSocket(`wss://${sonioxHosts(this.options.region).ttsRt}/tts-websocket`);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/services/clients/SonioxSttStream.test.ts src/services/clients/SonioxTtsStream.test.ts`
Expected: PASS. TypeScript will now flag every construction site missing `region` — leave those to Task 4, which supplies them from the credential bundle.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/SonioxSttStream.ts src/services/clients/SonioxTtsStream.ts src/services/clients/SonioxSttStream.test.ts src/services/clients/SonioxTtsStream.test.ts
git commit -m "feat(soniox): session websockets dial their credential's region

region is required on both configs, not defaulted: a key and a host are one
credential, and a default would silently send a regional key to the US host."
```

---

### Task 3: The three REST callers take a region

**Files:**
- Modify: `src/services/clients/SonioxTtsRest.ts` (delete `TTS_REST_URL`)
- Modify: `src/services/clients/SonioxVoicesClient.ts` (delete `VOICES_URL`)
- Modify: `src/services/clients/SonioxClient.ts` (delete `AUTH_PROBE_URL`, `validateApiKeyAndFetchModels` gains a region)
- Modify: `src/services/providers/SonioxProviderConfig.ts` (the one caller of `validateApiKeyAndFetchModels`)
- Modify: `src/services/clients/SonioxTtsRest.test.ts`, `src/services/clients/SonioxVoicesClient.test.ts`, `src/services/clients/SonioxClient.test.ts`
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx:269` and `src/components/Settings/sections/sonioxPreviewSample.ts` (the two `SonioxVoicesClient` / `synthesizeOnce` call sites — pass `'us'` here; Task 6 gives them the real region)

**Interfaces:**
- Consumes: `sonioxHosts`, `SonioxRegion` (Task 1).
- Produces: `SonioxTtsRestOptions.region: SonioxRegion`; `new SonioxVoicesClient(apiKey: string, region: SonioxRegion)`; `SonioxClient.validateApiKeyAndFetchModels(apiKey: string, region: SonioxRegion)`.

- [ ] **Step 1: Write the failing test**

Append to `src/services/clients/SonioxTtsRest.test.ts`:

```ts
import { SONIOX_REGIONS, sonioxHosts } from '../../lib/soniox/regions';

describe('regional endpoints', () => {
  it.each(SONIOX_REGIONS)('posts one-shot TTS to the %s host', async (region) => {
    const spy = mockOkAudio();          // this file's existing fetch stub helper
    await synthesizeOnce({ apiKey: 'k', voice: 'v', language: 'en', text: 'hi', region });
    const [url] = spy.mock.calls[0] as [string];
    expect(String(url)).toBe(`https://${sonioxHosts(region).ttsRt}/tts`);
  });
});
```

Append to `src/services/clients/SonioxVoicesClient.test.ts`:

```ts
import { SONIOX_REGIONS, sonioxHosts } from '../../lib/soniox/regions';

describe('regional endpoints', () => {
  it.each(SONIOX_REGIONS)('lists voices from the %s host', async (region) => {
    const spy = mockOk({ voices: [] });  // this file's existing fetch stub helper
    await new SonioxVoicesClient('k', region).list();
    const [url] = spy.mock.calls[0] as [string];
    expect(String(url)).toContain(`https://${sonioxHosts(region).api}/v1/voices`);
  });
});
```

Append to `src/services/clients/SonioxClient.test.ts`:

```ts
import { SONIOX_REGIONS, sonioxHosts } from '../../lib/soniox/regions';

describe('validateApiKeyAndFetchModels regional probe', () => {
  it.each(SONIOX_REGIONS)('probes the %s auth endpoint', async (region) => {
    const spy = vi.fn(async () => new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', spy);
    await SonioxClient.validateApiKeyAndFetchModels('k', region);
    const [url] = spy.mock.calls[0] as unknown as [string];
    expect(url).toBe(`https://${sonioxHosts(region).api}/v1/auth/temporary-api-key`);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/services/clients/SonioxTtsRest.test.ts src/services/clients/SonioxVoicesClient.test.ts src/services/clients/SonioxClient.test.ts`
Expected: FAIL — extra arguments rejected; EU/JP cases see US URLs.

- [ ] **Step 3: Write minimal implementation**

`SonioxTtsRest.ts` — delete `const TTS_REST_URL = 'https://tts-rt.soniox.com/tts';`, add `region: SonioxRegion;` to `SonioxTtsRestOptions`, and build the URL inside `synthesizeOnce`:

```ts
  const url = `https://${sonioxHosts(opts.region).ttsRt}/tts`;
```

`SonioxVoicesClient.ts` — delete `const VOICES_URL = 'https://api.soniox.com/v1/voices';`, give the class a constructor and a per-instance base:

```ts
export class SonioxVoicesClient {
  private readonly voicesUrl: string;

  /** `region` is required: voice MANAGEMENT needs the permanent project key,
   *  and a project belongs to exactly one region — a cloned voice's UUID does
   *  not exist in the others. */
  constructor(private readonly apiKey: string, region: SonioxRegion) {
    this.voicesUrl = `https://${sonioxHosts(region).api}/v1/voices`;
  }
  // ...replace every VOICES_URL reference with this.voicesUrl
}
```

(If the class currently takes `apiKey` some other way, keep that shape and add `region` beside it — the point is the per-instance `voicesUrl`.)

`SonioxClient.ts` — delete `const AUTH_PROBE_URL = ...`, add the import, and change the static:

```ts
  /** Validate the key with a cheap temporary-key probe (201 = valid), against
   *  the region the key belongs to. A key probed on the wrong region's host
   *  answers 401 and would be reported as invalid. */
  static async validateApiKeyAndFetchModels(apiKey: string, region: SonioxRegion): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    // ...
      const response = await fetch(`https://${sonioxHosts(region).api}/v1/auth/temporary-api-key`, {
    // ...
  }
```

`SonioxProviderConfig.validateAndFetchModels` — pass the region through, reading it off the credentials carrier Task 5 will populate; for now:

```ts
    return SonioxClient.validateApiKeyAndFetchModels(creds.primary, asSonioxRegion(creds.endpoint));
```

- [ ] **Step 4: Give the two UI call sites an explicit `'us'`**

`ProviderSpecificSettings.tsx:269`:
```ts
      ? byokVoiceSource(new SonioxVoicesClient(activeSonioxSettings.apiKey, 'us'))
```

In `sonioxPreviewSample.ts` (or wherever `synthesizeOnce` is called), add `region: 'us',` to the options object. Both become real in Task 6.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- src/services/clients/ src/services/providers/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/clients/SonioxTtsRest.ts src/services/clients/SonioxVoicesClient.ts src/services/clients/SonioxClient.ts src/services/providers/SonioxProviderConfig.ts src/services/clients/SonioxTtsRest.test.ts src/services/clients/SonioxVoicesClient.test.ts src/services/clients/SonioxClient.test.ts src/components/Settings/sections/ProviderSpecificSettings.tsx src/components/Settings/sections/sonioxPreviewSample.ts
git commit -m "feat(soniox): REST callers dial their key's region

Voice cloning, one-shot TTS previews and the key-validation probe each take a
region. A key probed against the wrong region's host answers 401 and would be
reported to the user as invalid, which is the failure this closes."
```

---

### Task 4: The credential bundle carries the region

**Files:**
- Modify: `src/services/clients/ManagedSonioxSession.ts` (`SonioxCredentialBundle`, `byokCredentials`, `fileBundles`)
- Modify: `src/services/clients/SonioxClient.ts` (`buildSttConnectConfig`, `createTtsStream`)
- Modify: `src/services/providers/SonioxProviderConfig.ts` (`createClient`)
- Modify: `src/services/clients/SonioxClient.test.ts`, `src/services/clients/SonioxClient.managed.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: `SonioxCredentialBundle.region: SonioxRegion`; `byokCredentials(apiKey: string, region: SonioxRegion): SonioxCredentialBundle`.

- [ ] **Step 1: Write the failing test**

Append to `src/services/clients/SonioxClient.test.ts`:

```ts
import { byokCredentials } from './ManagedSonioxSession';

describe('the client dials its bundle\'s region', () => {
  it('opens the STT socket on the bundle region, not a global default', async () => {
    const client = new SonioxClient(byokCredentials('k', 'eu'));
    void client.connect({ ...BASE_CONFIG, textOnly: true });
    await Promise.resolve();
    expect(MockWebSocket.instances[0].url)
      .toBe('wss://stt-rt.eu.soniox.com/transcribe-websocket');
  });

  it('opens the TTS socket on the same region as the STT socket', async () => {
    const client = new SonioxClient(byokCredentials('k', 'jp'));
    void client.connect({ ...BASE_CONFIG, textOnly: false });
    MockWebSocket.instances[0].open();
    await Promise.resolve();
    const urls = MockWebSocket.instances.map((w) => w.url);
    expect(urls).toContain('wss://tts-rt.jp.soniox.com/tts-websocket');
  });
});
```

(`BASE_CONFIG` / `MockWebSocket` are this file's existing fixtures — reuse them; adapt the await-shape to however the file already drives `connect`.)

Append to `src/services/clients/SonioxClient.managed.test.ts`:

```ts
// Two legs, two bundles: the region is per BUNDLE, so a split session cannot
// have one leg drift onto another region's host.
it('each managed leg dials the region of its own bundle', async () => {
  const speaker = new SonioxClient(
    { stt: 'k1', tts: 't1', clientReferenceId: 'r1', region: 'eu' },
    { session: fakeSession(), sttRole: 'spk_stt' },
  );
  void speaker.connect({ ...BASE_CONFIG, textOnly: true });
  await Promise.resolve();
  expect(MockWebSocket.instances[0].url)
    .toBe('wss://stt-rt.eu.soniox.com/transcribe-websocket');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/services/clients/SonioxClient.test.ts src/services/clients/SonioxClient.managed.test.ts`
Expected: FAIL — `byokCredentials` takes one argument; `region` is not on the bundle.

- [ ] **Step 3: Write minimal implementation**

In `ManagedSonioxSession.ts`, add to `SonioxCredentialBundle`:

```ts
  /**
   * Which Soniox deployment these keys belong to.
   *
   * On the BUNDLE rather than on the client or a module global, because a split
   * Both session runs two clients at once and a global would be one mutable
   * cell shared by both legs and by any settings change made mid-session.
   * Binding it here makes "dial an EU host with a US key" unrepresentable
   * rather than merely a bug we test for.
   */
  region: SonioxRegion;
```

```ts
/** BYOK: one user key serves both sockets, and no reference is sent. */
export function byokCredentials(apiKey: string, region: SonioxRegion): SonioxCredentialBundle {
  return { stt: apiKey, tts: apiKey, region };
}
```

In `SonioxClient.buildSttConnectConfig`, add to the returned object:

```ts
      region: this.credentials.region,
```

In `SonioxClient.createTtsStream`, add to the `new SonioxTtsStream({ ... })` options:

```ts
      region: this.credentials.region,
```

In `SonioxProviderConfig.createClient`:

```ts
  createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
    return new SonioxClient(byokCredentials(creds.primary, asSonioxRegion(creds.endpoint)));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/services/clients/`
Expected: PASS. TypeScript now flags any bundle literal in tests missing `region`; add `region: 'us'` to each.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/ManagedSonioxSession.ts src/services/clients/SonioxClient.ts src/services/providers/SonioxProviderConfig.ts src/services/clients/SonioxClient.test.ts src/services/clients/SonioxClient.managed.test.ts
git commit -m "feat(soniox): the credential bundle carries its region

Not a module global: a split Both session runs two clients at once, so a
global would be one mutable cell shared by both legs and by any mid-session
settings change. On the bundle, pairing a US key with an EU host is
unrepresentable rather than merely tested for."
```

---

### Task 5: Per-region BYOK keys, voices and credential extraction

**Files:**
- Modify: `src/services/providers/SonioxProviderConfig.ts` (`SonioxSettings`, `defaultSonioxSettings`, `extractCredentials`, `peekPrimaryCredential`, `buildSessionConfig`, plus two new field helpers)
- Modify: `src/stores/settingsStore.ts` (`kizunaSoniox`'s `neverPersist` list)
- Modify: `src/services/providers/SonioxProviderConfig.test.ts`, `src/stores/settingsStore.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 4.
- Produces: `SonioxSettings.region/apiKeyEu/apiKeyJp/voiceEu/voiceJp`; `sonioxKeyField(region): 'apiKey'|'apiKeyEu'|'apiKeyJp'`; `sonioxVoiceField(region): 'voice'|'voiceEu'|'voiceJp'`; `extractCredentials` setting `endpoint` to the region.

- [ ] **Step 1: Write the failing test**

Append to `src/services/providers/SonioxProviderConfig.test.ts`:

```ts
import { sonioxKeyField, sonioxVoiceField, defaultSonioxSettings } from './SonioxProviderConfig';

describe('per-region field helpers', () => {
  it('maps regions to key fields, US keeping the suffix-less name', () => {
    expect(sonioxKeyField('us')).toBe('apiKey');
    expect(sonioxKeyField('eu')).toBe('apiKeyEu');
    expect(sonioxKeyField('jp')).toBe('apiKeyJp');
  });

  it('maps regions to voice fields the same way', () => {
    expect(sonioxVoiceField('us')).toBe('voice');
    expect(sonioxVoiceField('eu')).toBe('voiceEu');
    expect(sonioxVoiceField('jp')).toBe('voiceJp');
  });

  it('defaults to the us region', () => {
    expect(defaultSonioxSettings.region).toBe('us');
  });
});

describe('extractCredentials', () => {
  const config = new SonioxProviderConfig();

  it('picks the active region\'s key', async () => {
    const creds = await config.extractCredentials(
      { ...defaultSonioxSettings, region: 'eu', apiKey: 'us-key', apiKeyEu: 'eu-key' },
      {},
    );
    expect(creds).toMatchObject({ ok: true, primary: 'eu-key' });
  });

  // endpoint is part of settingsStore's validation cache key, so three regions
  // are three cache entries -- switching region re-validates with no new
  // mechanism, and two regions holding the same key string never share a verdict.
  it('carries the region in endpoint so validation is cached per region', async () => {
    const creds = await config.extractCredentials(
      { ...defaultSonioxSettings, region: 'jp', apiKeyJp: 'jp-key' },
      {},
    );
    expect(creds).toMatchObject({ ok: true, endpoint: 'jp' });
  });

  it('reports missing when the active region has no key, even if another does', async () => {
    const creds = await config.extractCredentials(
      { ...defaultSonioxSettings, region: 'eu', apiKey: 'us-key' },
      {},
    );
    expect(creds.ok).toBe(false);
  });

  it('peekPrimaryCredential shows the active region\'s key', () => {
    expect(config.peekPrimaryCredential(
      { ...defaultSonioxSettings, region: 'eu', apiKey: 'us-key', apiKeyEu: 'eu-key' },
    )).toBe('eu-key');
  });
});

describe('buildSessionConfig', () => {
  it('uses the active region\'s voice selection', () => {
    const config = new SonioxProviderConfig();
    const session = config.buildSessionConfig(
      { ...defaultSonioxSettings, region: 'eu', voice: 'us-voice', voiceEu: 'eu-voice' },
      'instructions',
    );
    expect(session).toMatchObject({ voice: 'eu-voice' });
  });
});
```

Append to `src/stores/settingsStore.test.ts`:

```ts
// No migration by design: `apiKey` keeps meaning the US/global key, so a
// previously-stored value is still the key used when region is 'us'.
it('an existing persisted soniox apiKey still loads as the us key', async () => {
  setStoredSetting('settings.soniox.apiKey', 'legacy-key');
  await useSettingsStore.getState().loadSettings();
  const slice = useSettingsStore.getState().soniox;
  expect(slice.region).toBe('us');
  expect(slice.apiKey).toBe('legacy-key');
});
```

(`setStoredSetting` stands for this file's existing settings-service stub helper.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/services/providers/SonioxProviderConfig.test.ts src/stores/settingsStore.test.ts`
Expected: FAIL — the helpers do not exist; `extractCredentials` is the inherited base one.

- [ ] **Step 3: Write minimal implementation**

In `SonioxProviderConfig.ts`, extend the interface and defaults:

```ts
export interface SonioxSettings {
  /**
   * Which Soniox deployment to use. Keys are region-scoped (Soniox issues a
   * separate key per regional project), so this selects a whole credential,
   * not just a route.
   */
  region: SonioxRegion;
  /** US/global project key. The suffix-less name pairs with the infix-less
   *  host, which is also what makes this backward compatible: a value stored
   *  before regions existed is still exactly what it was. */
  apiKey: string;
  apiKeyEu: string;
  apiKeyJp: string;
  /** TTS voice for the US project. A cloned voice is a UUID INSIDE one
   *  project, so each region needs its own selection — sharing one field
   *  would send a UUID to a region where it does not exist. */
  voice: string;
  voiceEu: string;
  voiceJp: string;
  // ...existing fields unchanged
}

export const defaultSonioxSettings: SonioxSettings = {
  region: DEFAULT_SONIOX_REGION,
  apiKey: '',
  apiKeyEu: '',
  apiKeyJp: '',
  voice: SONIOX_DEFAULT_VOICE,
  voiceEu: SONIOX_DEFAULT_VOICE,
  voiceJp: SONIOX_DEFAULT_VOICE,
  // ...existing defaults unchanged
};

/** The settings field holding a region's API key. The ONLY mapping from region
 *  to storage — every reader and writer goes through this. */
export function sonioxKeyField(region: SonioxRegion): 'apiKey' | 'apiKeyEu' | 'apiKeyJp' {
  return region === 'us' ? 'apiKey' : region === 'eu' ? 'apiKeyEu' : 'apiKeyJp';
}

/** The settings field holding a region's selected voice. Same rule, same reason. */
export function sonioxVoiceField(region: SonioxRegion): 'voice' | 'voiceEu' | 'voiceJp' {
  return region === 'us' ? 'voice' : region === 'eu' ? 'voiceEu' : 'voiceJp';
}
```

Add the two overrides to the class:

```ts
  async extractCredentials(slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
    const settings = slice as SonioxSettings;
    const region = asSonioxRegion(settings?.region);
    const apiKey = settings?.[sonioxKeyField(region)] ?? '';
    if (!apiKey) return { ok: false, missing: 'API key is required for soniox' };
    // `endpoint` is the carrier, not an abuse of it: it is what the store's
    // validation cache is keyed on, so three regions become three cache entries
    // with no new mechanism — and two regions holding the same key string never
    // share a verdict.
    return { ok: true, primary: apiKey, endpoint: region };
  }

  peekPrimaryCredential(slice: unknown): string {
    const settings = slice as SonioxSettings;
    return settings?.[sonioxKeyField(asSonioxRegion(settings?.region))] ?? '';
  }
```

In `buildSessionConfig`, replace `settings.voice || SONIOX_DEFAULT_VOICE` with:

```ts
      voice: settings[sonioxVoiceField(asSonioxRegion(settings.region))] || SONIOX_DEFAULT_VOICE,
```

In `settingsStore.ts`, extend the managed twin's never-persist list:

```ts
  kizunaSoniox: { defaults: defaultKizunaSonioxSettings, neverPersist: ['apiKey', 'apiKeyEu', 'apiKeyJp'], persistErrors: 'swallow' },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/services/providers/ src/stores/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/SonioxProviderConfig.ts src/services/providers/SonioxProviderConfig.test.ts src/stores/settingsStore.ts src/stores/settingsStore.test.ts
git commit -m "feat(soniox): one API key and one voice selection per region

Soniox issues a separate key per regional project, so a single field would
make a valid key look invalid the moment the user switched region. apiKey
keeps meaning the US/global key, which is what makes this migration-free.
extractCredentials puts the region in `endpoint`, which the store already
keys its validation cache on -- switching region re-validates for free."
```

---

### Task 6: Region selector, and the UI reads the active region

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx` (region `<select>`, `sonioxVoiceSource`)
- Modify: `src/components/Settings/sections/ProviderSection.tsx:324` (the generic key setter)
- Modify: `src/components/Settings/sections/SonioxVoiceSection.tsx` (read/write the region's voice field)
- Modify: all 30 `src/locales/*/translation.json`
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`, `src/components/Settings/sections/ProviderSection.soniox.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 3 and 5.
- Produces: two locale keys `settings.sonioxRegion`, `settings.sonioxRegionTooltip`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`:

```tsx
import { SONIOX_REGION_LABELS } from '../../../lib/soniox/regions';

it('renders a region selector listing all three deployments', () => {
  renderSonioxSettings();                       // this file's existing render helper
  const select = screen.getByLabelText(/region/i);
  expect(select).toBeInTheDocument();
  for (const label of Object.values(SONIOX_REGION_LABELS)) {
    expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
  }
});

it('writes the chosen region to the active soniox slice', async () => {
  const { updateSoniox } = renderSonioxSettings();
  await userEvent.selectOptions(screen.getByLabelText(/region/i), 'eu');
  expect(updateSoniox).toHaveBeenCalledWith({ region: 'eu' });
});

// A region change mid-session would swap hosts under a live socket.
it('disables the selector while a session is active', () => {
  renderSonioxSettings({ isSessionActive: true });
  expect(screen.getByLabelText(/region/i)).toBeDisabled();
});
```

Append to `src/components/Settings/sections/ProviderSection.soniox.test.tsx`:

```tsx
it('types into the ACTIVE region\'s key field, not always apiKey', async () => {
  const { updateSoniox } = renderProviderSection({
    provider: Provider.SONIOX,
    soniox: { ...defaultSonioxSettings, region: 'jp' },
  });
  await userEvent.type(screen.getByPlaceholderText(/api key/i), 'x');
  expect(updateSoniox).toHaveBeenCalledWith({ apiKeyJp: 'x' });
});

it('shows the active region\'s stored key', () => {
  renderProviderSection({
    provider: Provider.SONIOX,
    soniox: { ...defaultSonioxSettings, region: 'eu', apiKey: 'us-key', apiKeyEu: 'eu-key' },
  });
  expect(screen.getByDisplayValue('eu-key')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx src/components/Settings/sections/ProviderSection.soniox.test.tsx`
Expected: FAIL — no region control; the setter always writes `apiKey`.

- [ ] **Step 3: Add the two locale keys to `en`**

In `src/locales/en/translation.json`, inside the `settings` object, alphabetically beside the other `soniox*` keys:

```json
    "sonioxRegion": "Region",
    "sonioxRegionTooltip": "Soniox runs separate deployments per region, each with its own API key. Your audio is processed and stored in the region you pick. Applies from the next session.",
```

- [ ] **Step 4: Add the same two keys to the other 29 catalogs**

`locales.consistency.test.ts` asserts exact key parity and no empty strings, so every catalog needs both keys. Translate the two English strings above into each catalog's language, at the same `settings.*` path:

`ar`, `bn`, `de`, `es`, `fa`, `fi`, `fil`, `fr`, `he`, `hi`, `id`, `it`, `ja`, `ko`, `ms`, `nl`, `pl`, `pt_BR`, `pt_PT`, `ru`, `sv`, `ta`, `te`, `th`, `tr`, `uk`, `vi`, `zh_CN`, `zh_TW`.

Neither string contains a placeholder, so the placeholder-parity assertion is satisfied by construction. Region *names* are not locale keys — they come from `SONIOX_REGION_LABELS`, deliberately, so adding a region later never means touching 30 files.

Verify with: `npm run test -- src/locales/locales.consistency.test.ts`

- [ ] **Step 5: Render the selector**

At the top of `renderSonioxSettings` in `ProviderSpecificSettings.tsx`, above `<SonioxVoiceSection …>`:

```tsx
        <div className="settings-section" id="soniox-region-section">
          <h2>
            {t('settings.sonioxRegion', 'Region')}
            <Tooltip
              content={t('settings.sonioxRegionTooltip', 'Soniox runs separate deployments per region, each with its own API key. Your audio is processed and stored in the region you pick. Applies from the next session.')}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
            </Tooltip>
          </h2>
          <div className="setting-item">
            <label className="setting-label" htmlFor="soniox-region-select">
              {t('settings.sonioxRegion', 'Region')}
            </label>
            <select
              id="soniox-region-select"
              value={asSonioxRegion(activeSonioxSettings.region)}
              // Switching hosts under a live socket is not a thing the session
              // can survive, so this is inert while one is running.
              disabled={isSessionActive}
              onChange={(e) => updateActiveSonioxSettings({ region: asSonioxRegion(e.target.value) })}
            >
              {SONIOX_REGIONS.map((region) => (
                <option key={region} value={region}>{SONIOX_REGION_LABELS[region]}</option>
              ))}
            </select>
          </div>
        </div>
```

- [ ] **Step 6: Make the voice source and the key setter region-aware**

`ProviderSpecificSettings.tsx`, the `sonioxVoiceSource` memo — replace the body and dependency list:

```tsx
  const sonioxRegion = asSonioxRegion(activeSonioxSettings.region);
  const sonioxApiKeyForRegion = activeSonioxSettings[sonioxKeyField(sonioxRegion)];
  const sonioxVoiceSource = useMemo<VoiceLibrarySource | null>(() => {
    // ...unchanged managed branch
    return provider === Provider.SONIOX && sonioxApiKeyForRegion
      ? byokVoiceSource(new SonioxVoicesClient(sonioxApiKeyForRegion, sonioxRegion))
      : null;
  }, [provider, sonioxApiKeyForRegion, sonioxRegion, userId]);
```

`ProviderSection.tsx:324`:

```ts
      case Provider.SONIOX:
        // The generic input edits the ACTIVE region's key: three regions mean
        // three independent credentials, and writing them all to `apiKey` would
        // overwrite the US key every time the user pasted a regional one.
        updateSonioxSettings({ [sonioxKeyField(asSonioxRegion(sonioxSettings.region))]: value });
        break;
```

In `SonioxVoiceSection.tsx`, replace every `settings.voice` read and `onUpdate({ voice })` write with the region's field via `sonioxVoiceField(asSonioxRegion(settings.region))`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test -- src/components/Settings/ src/locales/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx src/components/Settings/sections/ProviderSection.tsx src/components/Settings/sections/SonioxVoiceSection.tsx src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx src/components/Settings/sections/ProviderSection.soniox.test.tsx src/locales
git commit -m "feat(soniox): region selector, shared by BYOK and the managed twin

One control writing through updateActiveSonioxSettings, the same way the
voice and vocabulary controls already serve both flavours. The generic API
key input now edits the ACTIVE region's field -- writing every region to
apiKey would overwrite the US key each time a regional one was pasted.
Region names come from SONIOX_REGION_LABELS rather than locale keys, so
adding a region later never means editing 30 catalogs."
```

---

### Task 7: The managed session requests and honours a region

**Files:**
- Modify: `src/services/clients/ManagedSonioxSession.ts` (`ManagedSessionRequest`, `SonioxSessionKeyResponse`, `requestSessionKey`, `fileBundles`)
- Modify: `src/services/providers/KizunaAISonioxProviderConfig.ts` (`acquireSessionResources`, `prepareToStart`)
- Modify: `src/services/clients/ManagedVoicesClient.ts` (carry the region)
- Modify: `src/services/providers/managedVoicePrep.ts` (pass it through)
- Modify: `src/services/providers/ProviderDescriptor.ts` (`AcquireSessionResourcesContext.region`)
- Modify: `src/components/MainPanel/MainPanel.tsx` (populate `ctx.region` from the active slice)
- Modify: `src/services/clients/ManagedSonioxSession.test.ts` (or the file that covers `acquire`)

**Interfaces:**
- Consumes: Tasks 1, 4 and 5.
- Produces: `ManagedSessionRequest.region: SonioxRegion`; `SonioxSessionKeyResponse.region?: string`; every bundle filed carrying the response's region.

- [ ] **Step 1: Write the failing test**

Append to `src/services/clients/ManagedSonioxSession.test.ts`:

```ts
describe('region', () => {
  it('sends the requested region in the session-key body', async () => {
    const fetchSpy = mockSessionKeyResponse({ region: 'eu' });   // file's existing helper
    const session = new ManagedSonioxSession({ sessionToken: 't' });
    await session.acquire({ mode: 'speaker', textOnly: true, bothSplit: false, region: 'eu' });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ region: 'eu' });
  });

  // The RESPONSE is authoritative. A settings change between request and
  // connect must never pair one region's keys with another region's hosts.
  it('files bundles with the region from the RESPONSE, not the request', async () => {
    mockSessionKeyResponse({ region: 'jp' });
    const session = new ManagedSonioxSession({ sessionToken: 't' });
    await session.acquire({ mode: 'speaker', textOnly: true, bothSplit: false, region: 'eu' });
    expect(session.credentialsFor('spk_stt').region).toBe('jp');
  });

  it('normalizes a missing region (older backend) to us', async () => {
    mockSessionKeyResponse({ region: undefined });
    const session = new ManagedSonioxSession({ sessionToken: 't' });
    await session.acquire({ mode: 'speaker', textOnly: true, bothSplit: false, region: 'eu' });
    expect(session.credentialsFor('spk_stt').region).toBe('us');
  });

  it('normalizes an unrecognized response region to us', async () => {
    mockSessionKeyResponse({ region: 'atlantis' });
    const session = new ManagedSonioxSession({ sessionToken: 't' });
    await session.acquire({ mode: 'speaker', textOnly: true, bothSplit: false, region: 'us' });
    expect(session.credentialsFor('spk_stt').region).toBe('us');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/services/clients/ManagedSonioxSession.test.ts`
Expected: FAIL — `region` is not in the request type, and bundles have no region.

- [ ] **Step 3: Write minimal implementation**

In `ManagedSonioxSession.ts`:

```ts
export interface ManagedSessionRequest {
  mode: 'speaker' | 'participant' | 'both';
  textOnly: boolean;
  bothSplit: boolean;
  /** Which Soniox regional project should mint this session's keys. The backend
   *  refuses a region it has no project key for rather than serving US. */
  region: SonioxRegion;
}
```

Add `region?: string;` to `SonioxSessionKeyResponse`, and include `region: request.region` in `requestSessionKey`'s body literal.

In `fileBundles`, resolve the region once and stamp it on every bundle:

```ts
    // The RESPONSE's region, never the request's. The backend is the authority
    // on which project actually minted these keys, and a settings change
    // between request and connect must not pair one region's keys with
    // another's hosts. A missing field (an older backend) or an unrecognized
    // value normalizes to us — asSonioxRegion's whole job.
    const region = asSonioxRegion(data.region);
```

and add `region,` to both the fallback `this.bundles.set(primary, { … })` literal and the per-stream one inside the loop.

In `KizunaAISonioxProviderConfig.acquireSessionResources`, read the region off the slice and include it in the acquire body. The context already carries the wiring; add the slice's region via the descriptor's own settings access, mirroring how `prepareToStart` reads `(slice as { voice?: string })?.voice`:

```ts
    const wiring = resolveManagedSonioxWiring({ /* unchanged */ });
    // ...
    await session.acquire({ ...wiring.acquire, region: asSonioxRegion(ctx.region) });
```

Add `region: SonioxRegion` to `AcquireSessionResourcesContext` in `ProviderDescriptor.ts` and populate it at MainPanel's call site from the active provider slice, so the descriptor is not reaching into the store itself.

In `prepareToStart`, pass the region into `ManagedVoicesClient` so the voice is claimed in the region the session will run in:

```ts
        client: new ManagedVoicesClient(ports.getAuthToken, asSonioxRegion((slice as SonioxSettings)?.region)),
```

and read the built-in check against the region's voice field:

```ts
    const voice = (slice as SonioxSettings)?.[sonioxVoiceField(asSonioxRegion((slice as SonioxSettings)?.region))];
```

In `ManagedVoicesClient`, accept the region and send it:

```ts
  constructor(
    private readonly getToken: () => Promise<string | null>,
    private readonly region: SonioxRegion = 'us',
  ) {}
```

and include `region: this.region` in the JSON body of every mutating request (the backend reserves the slot in that region).

In `managedVoicePrep.ts`, no signature change is needed — it receives the already-regional `client`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/services/clients/ src/services/providers/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/ManagedSonioxSession.ts src/services/clients/ManagedVoicesClient.ts src/services/providers/KizunaAISonioxProviderConfig.ts src/services/providers/ProviderDescriptor.ts src/services/providers/managedVoicePrep.ts src/services/clients/ManagedSonioxSession.test.ts src/components/MainPanel/MainPanel.tsx
git commit -m "feat(soniox): managed sessions request a region and honour the reply

The RESPONSE is authoritative, not the setting: a settings change between
request and connect must never pair one region's keys with another region's
hosts. A missing field (older backend) or an unrecognized value normalizes to
us, so neither client/backend version pairing can route audio somewhere the
user did not ask for."
```

---

### Task 8: Extension CSP

**Files:**
- Modify: `extension/manifest.json` (the `content_security_policy.extension_pages` `connect-src` list)
- Modify: `extension/manifest.consistency.test.ts`

**Interfaces:**
- Consumes: the host table's output (Task 1) as literal origins.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Write the failing test**

Append to `extension/manifest.consistency.test.ts`:

```ts
it('allows every Soniox regional origin', () => {
  const csp = manifest.content_security_policy.extension_pages;
  for (const origin of [
    'https://api.eu.soniox.com', 'https://api.jp.soniox.com',
    'wss://stt-rt.eu.soniox.com', 'wss://stt-rt.jp.soniox.com',
    'wss://tts-rt.eu.soniox.com', 'wss://tts-rt.jp.soniox.com',
    // tts-rt needs BOTH schemes: the one-shot voice preview is HTTPS while the
    // session stream is WSS, and a wss:// entry does not cover https://. The US
    // host already carries the pair for exactly this reason.
    'https://tts-rt.eu.soniox.com', 'https://tts-rt.jp.soniox.com',
  ]) {
    expect(csp).toContain(origin);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- extension/manifest.consistency.test.ts`
Expected: FAIL — none of the eight origins are listed.

- [ ] **Step 3: Write minimal implementation**

In `extension/manifest.json`, append the eight origins to the existing `connect-src` list, immediately after the current `https://tts-rt.soniox.com` entry:

```
https://api.eu.soniox.com https://api.jp.soniox.com wss://stt-rt.eu.soniox.com wss://stt-rt.jp.soniox.com wss://tts-rt.eu.soniox.com wss://tts-rt.jp.soniox.com https://tts-rt.eu.soniox.com https://tts-rt.jp.soniox.com
```

- [ ] **Step 4: Run the full suite**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/manifest.json extension/manifest.consistency.test.ts
git commit -m "feat(soniox): allow the EU and JP origins in the extension CSP

Eight entries, not six: tts-rt needs both schemes because the one-shot voice
preview is HTTPS while the session stream is WSS, and a wss:// entry does not
cover https://. The US host already carries that pair."
```

---

## Manual verification

After Task 8, with the backend deployed and both regional secrets set:

1. Settings → Soniox → Region → European Union. The API key field should go blank (the EU key slot is empty), not show the US key.
2. Paste an EU project key. Validation should pass against `api.eu.soniox.com` — confirm in DevTools Network.
3. Start a session. The STT socket should be `wss://stt-rt.eu.soniox.com/transcribe-websocket`.
4. Switch back to United States. The US key and its voice selection should both still be there.
5. Repeat 1-3 for Kizuna AI Soniox and confirm `/soniox/session-key` carries `region: "eu"` and the response echoes it.
6. Point at a region whose backend secret is unset and confirm Start fails with a clear message rather than connecting to the US.

## Self-Review

**Spec coverage.** Decision 1 → Task 4; decision 2 → Task 1; decision 3 → Task 5; decision 4 → Tasks 5 and 6; decision 5 → Task 7; decision 6 → backend plan; decision 7 → backend plan; decision 8 → Task 6 (one shared control). Architecture sections map: *Client* → Tasks 1-3 and 5-6, *Managed contract* → Task 7, *Extension CSP* → Task 8. The spec's error-handling table is covered by Task 5 (missing key → `ok: false`), Task 1 (unknown persisted region → `us`) and Task 7 (missing/unknown response region → `us`).

**Placeholder scan.** No TBD/TODO. Several steps name a helper the target test file already owns (`mockOkAudio`, `mockOk`, `BASE_CONFIG`, `renderSonioxSettings`, `setStoredSetting`, `mockSessionKeyResponse`) instead of reproducing it; each says so, and the assertions are given in full — those helpers differ per file and inventing names would be worse than pointing at them. Task 6 Step 4 asks for 29 translations rather than listing 58 strings; the English source, the exact key path, the catalog list and the verifying command are all given.

**Type consistency.** `SonioxRegion` is the single region type throughout. `asSonioxRegion` (client, defaults) is consistently distinguished from the backend's `parseSonioxRegion` (returns null) — Task 1's docstring states why they must not be unified. `sonioxKeyField` / `sonioxVoiceField` are defined in Task 5 and used in Tasks 6 and 7 with the same signatures. `byokCredentials(apiKey, region)` is defined in Task 4 and used there and in Task 3's `createClient`. `SonioxCredentialBundle.region` is required in Task 4 and read in Tasks 4 and 7.
