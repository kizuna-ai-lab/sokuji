# Provider Descriptor Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "one provider" one deep module: every per-provider behavior (client construction, key validation, latest-model resolution, credential extraction, session-config building, language rules, i18n name) becomes a method on that provider's `ProviderDescriptor` class, dispatched through the existing `ProviderConfigFactory` registry — collapsing 142 `case Provider.` branches spread over 7 files.

**Architecture:** Extend the 13 existing `XProviderConfig` classes to implement a new `ProviderDescriptor` interface (a common `BaseProviderDescriptor` supplies defaults; kizuna twins already subclass their base providers and inherit the behavior). `ClientFactory` / `ClientOperations` stay as thin deprecated façades so their existing tests keep passing; `settingsStore`, `MainPanel`, `LanguageSection`, and `ProviderSection` switch to registry calls. Per-provider Settings interfaces and defaults move into the provider modules; `settingsStore` re-exports them for compatibility.

**Tech Stack:** TypeScript (strict), zustand, vitest, i18next. No new dependencies.

## Global Constraints

- `tsc` is NOT clean in this repo (~113 pre-existing errors). The correctness gate is `npm run test` (vitest). Do not try to make tsc clean; do not introduce NEW tsc errors in files you touch (compare before/after with `npx tsc --noEmit 2>&1 | grep <file>`).
- All comments and identifiers in English. Conventional commit format.
- Never `git push` — local commits only; publishing needs explicit user approval.
- Registration stays an explicit static block in `ProviderConfigFactory` — NO module-side-effect self-registration (import-order hazard, decided during design review).
- Existing tests must stay green after every task: `npm run test -- --run` (46+ files). Baseline before starting: run it once and record failures, if any, to distinguish pre-existing breakage.
- Do not modify: `src/services/providers/volcengineAST2LanguageSync.ts` (helper deliberately decoupled), any file under `extension/`, `electron/`.
- Work on a feature branch created from `main` (e.g. `refactor/provider-descriptor-registry`). One PR at the end; commit after every task.

## Design decisions already fixed (do not relitigate)

1. One full PR, task-by-task commits.
2. Descriptor = existing `XProviderConfig` classes gaining behavior methods; `getConfig()` keeps returning plain data.
3. `extractCredentials(slice, ctx)` is async for ALL providers; kizuna twins use `ctx.getAuthToken`.
4. Per-provider Settings interfaces + `defaultXxxSettings` move INTO provider modules; settingsStore re-exports.
5. `settingsSliceKey` field on descriptor + slice passed as a parameter to `buildSessionConfig` (never the whole store state).
6. MainPanel migrates to the descriptor path; the 7-arg `ClientFactory.createClient` façade survives only for its old test, marked `@deprecated`.
7. Language-rule statics get promoted to descriptor interface methods.
8. Dead code to delete: `getProviderDisplayName()` (Provider.ts:72-95, zero consumers), `SUPPORTED_PROVIDERS` + `isValidProvider` (Provider.ts:34-60, only consumer is ClientOperations which will delegate to the registry), `ProviderConfig.defaults` field (zero consumers — verified via grep).
9. Domain vocabulary: see `CONTEXT.md` (ProviderDescriptor, Provider Registry, Settings slice, Credentials, kizuna twins).

---

### Task 1: `ProviderDescriptor` interface, `BaseProviderDescriptor`, registry accessor

**Files:**
- Create: `src/services/providers/ProviderDescriptor.ts`
- Create: `src/services/providers/descriptorRegistry.test.ts`
- Modify: `src/services/providers/ProviderConfigFactory.ts` (Map value type + `getDescriptor`)
- Modify: `src/stores/settingsStore.ts:49-50` (move `TransportType`, re-export)
- Modify: all 11 base config classes — add `extends BaseProviderDescriptor` (list below)

**Interfaces:**
- Consumes: existing `ProviderConfig` type, `ProviderConfigFactory.configs` Map, `IClient`, `FilteredModel`, `ApiKeyValidationResult`.
- Produces (later tasks rely on these EXACT names):
  - `type TransportType = 'websocket' | 'webrtc'` (moved here)
  - `type Credentials = { ok: true; primary: string; secret?: string; endpoint?: string } | { ok: false; missing: string }`
  - `type CredentialCtx = { getAuthToken?: () => Promise<string | null> }`
  - `type ClientOptions = { transport: TransportType; webrtcOptions?: { inputDeviceId?: string; outputDeviceId?: string } }`
  - `interface ProviderDescriptor` with members: `getConfig()`, `settingsSliceKey`, `i18nKey?`, `supportsWebRTC`, `createClient(creds, options)`, `validateAndFetchModels(creds)`, `latestRealtimeModel(models)`, `extractCredentials(slice, ctx)`, `peekPrimaryCredential(slice)`, `buildSessionConfig(slice, systemInstructions)`, `resolveSourceLanguages()`, `resolveTargetLanguages(source)`, `reconcileTarget(source, currentTarget)`
  - `abstract class BaseProviderDescriptor implements ProviderDescriptor` with default implementations
  - `ProviderConfigFactory.getDescriptor(id: ProviderType): ProviderDescriptor`

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/providers/descriptorRegistry.test.ts
import { describe, it, expect, vi } from 'vitest';
// Force every feature flag on so ALL descriptors register regardless of build env.
vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isPalabraAIEnabled: () => true,
  isVolcengineSTEnabled: () => true,
  isVolcengineAST2Enabled: () => true,
  isZoomAIEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
  getRelayWsUrl: () => 'wss://r.example/v1',
}));
import { ProviderConfigFactory } from './ProviderConfigFactory';

describe('provider registry descriptors', () => {
  it('returns a descriptor for every available provider', () => {
    const ids = ProviderConfigFactory.getAvailableProviders();
    expect(ids.length).toBe(11);
    for (const id of ids) {
      const d = ProviderConfigFactory.getDescriptor(id);
      expect(d.getConfig().id).toBe(id);
      expect(typeof d.settingsSliceKey).toBe('string');
    }
  });

  it('slice keys are unique', () => {
    const keys = ProviderConfigFactory.getAvailableProviders()
      .map(id => ProviderConfigFactory.getDescriptor(id).settingsSliceKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run src/services/providers/descriptorRegistry.test.ts`
Expected: FAIL — `getDescriptor is not a function` / `settingsSliceKey` undefined.

- [ ] **Step 3: Create `ProviderDescriptor.ts`**

```typescript
// src/services/providers/ProviderDescriptor.ts
import { ProviderConfig, LanguageOption } from './ProviderConfig';
import { IClient, FilteredModel, SessionConfig } from '../interfaces/IClient';
import { ApiKeyValidationResult } from '../interfaces/ISettingsService';

/** Transport for realtime providers. Moved here from settingsStore so the
 *  services layer no longer imports from stores. settingsStore re-exports it. */
export type TransportType = 'websocket' | 'webrtc';

/** Normalized credentials produced by a descriptor from its settings slice.
 *  `missing` carries the user-facing message shown when validation is attempted
 *  with incomplete fields (e.g. "Both Client ID and Client Secret are required
 *  for Palabra AI"). Callers never name provider-specific fields. */
export type Credentials =
  | { ok: true; primary: string; secret?: string; endpoint?: string }
  | { ok: false; missing: string };

export type CredentialCtx = {
  /** Better Auth session-token accessor — required only by the kizuna twins. */
  getAuthToken?: () => Promise<string | null>;
};

export type ClientOptions = {
  transport: TransportType;
  webrtcOptions?: { inputDeviceId?: string; outputDeviceId?: string };
};

/**
 * The deep module for one provider. Everything the app needs to know about a
 * provider is answered here; callers dispatch via
 * ProviderConfigFactory.getDescriptor(provider) instead of switching on the enum.
 * See CONTEXT.md ("ProviderDescriptor").
 */
export interface ProviderDescriptor {
  getConfig(): ProviderConfig;
  /** zustand slice in SettingsStore holding this provider's persisted settings. */
  readonly settingsSliceKey: string;
  /** i18n namespace under `providers.*`; defaults to getConfig().id. */
  readonly i18nKey?: string;
  /** True for providers that can run over WebRTC transport. */
  readonly supportsWebRTC: boolean;

  createClient(creds: Credentials & { ok: true }, options: ClientOptions): IClient;
  validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }>;
  latestRealtimeModel(models: FilteredModel[]): string;

  extractCredentials(slice: unknown, ctx: CredentialCtx): Promise<Credentials>;
  /** Sync read of what the user has typed as the primary credential — for UI
   *  display only (ProviderSection key indicator). '' when not applicable. */
  peekPrimaryCredential(slice: unknown): string;

  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig;

  resolveSourceLanguages(): LanguageOption[];
  resolveTargetLanguages(source: string): LanguageOption[];
  reconcileTarget(source: string, currentTarget: string): string;
}

/** Shared defaults. Subclasses override only what differs from the common case
 *  (single apiKey credential, model list from config, unrestricted languages). */
export abstract class BaseProviderDescriptor implements ProviderDescriptor {
  abstract getConfig(): ProviderConfig;
  abstract readonly settingsSliceKey: string;
  readonly i18nKey?: string;
  readonly supportsWebRTC: boolean = false;

  abstract createClient(creds: Credentials & { ok: true }, options: ClientOptions): IClient;
  abstract validateAndFetchModels(creds: Credentials): Promise<{
    validation: ApiKeyValidationResult; models: FilteredModel[];
  }>;
  abstract buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig;

  latestRealtimeModel(models: FilteredModel[]): string {
    return models[0]?.id ?? this.getConfig().models[0]?.id ?? '';
  }

  async extractCredentials(slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
    const apiKey = (slice as { apiKey?: string })?.apiKey ?? '';
    if (!apiKey) return { ok: false, missing: `API key is required for ${this.getConfig().id}` };
    return { ok: true, primary: apiKey };
  }

  peekPrimaryCredential(slice: unknown): string {
    return (slice as { apiKey?: string })?.apiKey ?? '';
  }

  resolveSourceLanguages(): LanguageOption[] {
    return this.getConfig().languages;
  }

  resolveTargetLanguages(_source: string): LanguageOption[] {
    const cfg = this.getConfig();
    return cfg.targetLanguages ?? cfg.languages;
  }

  reconcileTarget(source: string, currentTarget: string): string {
    const allowed = this.resolveTargetLanguages(source).map(l => l.value);
    return allowed.includes(currentTarget) ? currentTarget : (allowed[0] ?? currentTarget);
  }
}
```

Note: `createClient` / `validateAndFetchModels` / `buildSessionConfig` are declared `abstract` here but implemented per provider in Tasks 2, 3, 6. To keep the build green until then, in THIS task declare them abstract and make each config class `abstract`-satisfying with temporary bodies that `throw new Error('not migrated yet: <method>')`. Tasks 2/3/6 replace those bodies. (`settingsSliceKey` is assigned NOW — see table below.)

- [ ] **Step 4: Wire the 11 base classes**

Each class changes from `export class XProviderConfig {` to `export class XProviderConfig extends BaseProviderDescriptor {`, gains `readonly settingsSliceKey = '<key>'` (and `i18nKey` where noted), and the three temporary throwing methods. The kizuna twin classes already `extends` their base — they only override `settingsSliceKey` (and later, credentials):

| Class file | settingsSliceKey | i18nKey (only if ≠ id) | supportsWebRTC |
|---|---|---|---|
| OpenAIProviderConfig.ts | `'openai'` | — | `true` |
| OpenAICompatibleProviderConfig.ts | `'openaiCompatible'` | `'openaiCompatible'` | `true` |
| OpenAITranslateProviderConfig.ts | `'openaiTranslate'` | — | `true` |
| GeminiProviderConfig.ts | `'gemini'` | — | `false` |
| PalabraAIProviderConfig.ts | `'palabraai'` | — | `false` |
| VolcengineSTProviderConfig.ts | `'volcengineST'` | — | `false` |
| VolcengineAST2ProviderConfig.ts | `'volcengineAST2'` | — | `false` |
| ZoomAIProviderConfig.ts | `'zoomAI'` | — | `false` |
| LocalInferenceProviderConfig.ts | `'localInference'` | — | `false` |
| KizunaAIOpenAITranslateProviderConfig.ts | `'kizunaOpenaiTranslate'` (override) | — | inherit |
| KizunaAIVolcengineAST2ProviderConfig.ts | `'kizunaVolcengineAst2'` (override) | — | inherit |

(Slice keys are the EXACT existing field names in `SettingsStore` — settingsStore.ts:385-395.)

In `ProviderConfigFactory.ts`: change the private Map type and add the accessor; keep `getConfig`/`getAllConfigs`/`getAvailableProviders`/`isProviderSupported`/`registerProvider` as-is (their bodies still work):

```typescript
import { ProviderDescriptor } from './ProviderDescriptor';
// delete the local `interface ProviderConfigInstance` — ProviderDescriptor replaces it

export class ProviderConfigFactory {
  private static configs: Map<ProviderType, ProviderDescriptor> = new Map();
  // ... static block unchanged ...

  static getDescriptor(providerId: ProviderType): ProviderDescriptor {
    const d = this.configs.get(providerId);
    if (!d) throw new Error(`Unsupported provider: ${providerId}`);
    return d;
  }
```

`registerProvider(providerId, config: ProviderDescriptor)` — update the param type. `getConfigInstance` keeps working (same Map) — leave it, Task 10 deletes it if unused.

In `settingsStore.ts` replace lines 49-50 with a re-export so ~10 existing importers keep compiling:

```typescript
// Transport type moved to the services layer; re-exported for existing importers.
export type { TransportType } from '../services/providers/ProviderDescriptor';
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- --run src/services/providers/ src/services/clients/ClientFactory.test.ts src/services/ClientOperations.test.ts`
Expected: PASS (new registry test + existing ZoomAIProviderConfig/ClientFactory/ClientOperations tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(providers): introduce ProviderDescriptor interface and registry accessor"
```

---

### Task 2: `createClient` moves onto descriptors

**Files:**
- Modify: 11 config classes (replace the throwing `createClient` stubs)
- Modify: `src/services/clients/ClientFactory.ts` (switch → façade)
- Test: extend `src/services/providers/descriptorRegistry.test.ts`

**Interfaces:**
- Consumes: `Credentials & {ok:true}`, `ClientOptions` from Task 1.
- Produces: working `descriptor.createClient(creds, options)` for all 11; `ClientFactory.createClient` (old 7-arg signature) delegating.

- [ ] **Step 1: Write the failing test** (append to descriptorRegistry.test.ts)

```typescript
import { Provider } from '../../types/Provider';
import { OpenAITranslateGAClient } from '../clients/OpenAITranslateGAClient';
import { VolcengineAST2Client } from '../clients/VolcengineAST2Client';

describe('descriptor.createClient', () => {
  const creds = { ok: true as const, primary: 'k', secret: 's', endpoint: 'https://e.example' };
  const ws = { transport: 'websocket' as const };

  it('constructs a client for every available provider', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const client = ProviderConfigFactory.getDescriptor(id).createClient(creds, ws);
      expect(client.getProvider()).toBe(id === Provider.KIZUNA_AI_OPENAI_TRANSLATE ? Provider.OPENAI_TRANSLATE
        : id === Provider.KIZUNA_AI_VOLCENGINE_AST2 ? Provider.VOLCENGINE_AST2
        : id === Provider.OPENAI_COMPATIBLE ? Provider.OPENAI
        : id);
    }
  });

  it('kizuna translate twin routes to relay OpenAITranslateGAClient', () => {
    const c = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_OPENAI_TRANSLATE)
      .createClient({ ok: true, primary: 'sess_TOKEN' }, ws);
    expect(c).toBeInstanceOf(OpenAITranslateGAClient);
  });

  it('kizuna doubao twin routes to relay VolcengineAST2Client', () => {
    const c = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_VOLCENGINE_AST2)
      .createClient({ ok: true, primary: 'sess_TOKEN' }, ws);
    expect(c).toBeInstanceOf(VolcengineAST2Client);
  });
});
```

Note on the first assertion: `getProvider()` returns what each client reports today — the kizuna twins reuse base clients and OPENAI_COMPATIBLE uses OpenAIClient. Verify actual return values by reading each client's `getProvider()` before finalizing; adjust the expectation table to the observed values, do NOT change client behavior.

- [ ] **Step 2: Run test — expect FAIL** with `not migrated yet: createClient`.

- [ ] **Step 3: Move each ClientFactory switch arm into its class**

The bodies below are the EXACT current arms (ClientFactory.ts:59-160) re-expressed with `creds`/`options`. Feature-flag `throw` guards are dropped — an unregistered provider already fails at `getDescriptor`. Implementations:

```typescript
// OpenAIProviderConfig.ts
createClient(creds: Credentials & { ok: true }, options: ClientOptions): IClient {
  if (options.transport === 'webrtc') {
    return new OpenAIWebRTCClient({
      apiKey: creds.primary,
      inputDeviceId: options.webrtcOptions?.inputDeviceId,
      outputDeviceId: options.webrtcOptions?.outputDeviceId,
    });
  }
  return new OpenAIGAClient(creds.primary);
}

// OpenAICompatibleProviderConfig.ts
createClient(creds: Credentials & { ok: true }, options: ClientOptions): IClient {
  if (!creds.endpoint) throw new Error('Custom endpoint is required for openai_compatible provider');
  if (options.transport === 'webrtc') {
    return new OpenAIWebRTCClient({
      apiKey: creds.primary,
      apiHost: creds.endpoint,
      inputDeviceId: options.webrtcOptions?.inputDeviceId,
      outputDeviceId: options.webrtcOptions?.outputDeviceId,
    });
  }
  return new OpenAIClient(creds.primary, creds.endpoint);
}

// OpenAITranslateProviderConfig.ts
createClient(creds: Credentials & { ok: true }, options: ClientOptions): IClient {
  if (options.transport === 'webrtc') {
    return new OpenAITranslateWebRTCClient({
      apiKey: creds.primary,
      inputDeviceId: options.webrtcOptions?.inputDeviceId,
      outputDeviceId: options.webrtcOptions?.outputDeviceId,
    });
  }
  return new OpenAITranslateGAClient(creds.primary);
}

// GeminiProviderConfig.ts
createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
  return new GeminiClient(creds.primary);
}

// PalabraAIProviderConfig.ts  (creds.secret is guaranteed by extractCredentials, Task 5)
createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
  if (!creds.secret) throw new Error('Client secret is required for palabraai provider');
  return new PalabraAIClient(creds.primary, creds.secret);
}

// VolcengineSTProviderConfig.ts
createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
  if (!creds.secret) throw new Error('Secret Access Key is required for volcengine_st provider');
  return new VolcengineSTClient(creds.primary, creds.secret);
}

// VolcengineAST2ProviderConfig.ts
createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
  if (!creds.secret) throw new Error('Access Token is required for volcengine_ast2 provider');
  return new VolcengineAST2Client(creds.primary, creds.secret);
}

// ZoomAIProviderConfig.ts
createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
  if (!creds.secret) throw new Error('API Secret is required for zoom_ai provider');
  return new ZoomAIClient(creds.primary, creds.secret);
}

// LocalInferenceProviderConfig.ts
createClient(_creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
  return new LocalInferenceClient();
}

// KizunaAIOpenAITranslateProviderConfig.ts (override — relay wsUrl)
createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
  return new OpenAITranslateGAClient(creds.primary, {
    wsUrl: `${getRelayWsUrl()}/realtime/translations`,
  });
}

// KizunaAIVolcengineAST2ProviderConfig.ts (override — relay session token)
createClient(creds: Credentials & { ok: true }, _options: ClientOptions): IClient {
  return new VolcengineAST2Client('', '', undefined, {
    wsUrl: `${getRelayWsUrl()}/ast/translate`,
    sessionToken: creds.primary,
  });
}
```

Each file adds the client import it needs (e.g. `import { ZoomAIClient } from '../clients/ZoomAIClient'`) and `import { getRelayWsUrl } from '../../utils/environment'` for the twins. `LocalInferenceClient` skips the empty-key check by design (no credentials) — its `extractCredentials` override comes in Task 5.

- [ ] **Step 4: Collapse ClientFactory to a façade**

Replace the whole switch body (keep `supportsWebRTC` reading the descriptor):

```typescript
/**
 * @deprecated Thin façade kept for legacy tests. New code resolves the
 * descriptor via ProviderConfigFactory.getDescriptor(provider) directly.
 */
export class ClientFactory {
  static createClient(
    model: string, provider: ProviderType, apiKey: string,
    clientSecret?: string, customEndpoint?: string,
    transportType?: TransportType, webrtcOptions?: WebRTCClientOptions
  ): IClient {
    void model;
    return ProviderConfigFactory.getDescriptor(provider).createClient(
      { ok: true, primary: apiKey, secret: clientSecret, endpoint: customEndpoint },
      { transport: transportType ?? 'websocket', webrtcOptions }
    );
  }

  static supportsWebRTC(provider: ProviderType): boolean {
    return ProviderConfigFactory.getDescriptor(provider).supportsWebRTC;
  }

  static usesNativeAudioCapture(provider: ProviderType, transportType?: TransportType): boolean {
    return transportType === 'webrtc' && this.supportsWebRTC(provider);
  }
}
```

Behavior note: the old `if (!apiKey) throw` pre-check disappears from the façade; after Task 7 all production callers pass through `extractCredentials`, which enforces it. `LOCAL_INFERENCE` no longer short-circuits before the key check — same observable result (LocalInference never had a key).

- [ ] **Step 5: Run tests**

Run: `npm run test -- --run src/services/`
Expected: PASS including the untouched `ClientFactory.test.ts`.

- [ ] **Step 6: Commit** — `git commit -am "refactor(providers): move client construction onto descriptors"`

---

### Task 3: Validation + latest-model onto descriptors; kill the parallel availability registry

**Files:**
- Modify: 11 config classes (replace `validateAndFetchModels` stubs; override `latestRealtimeModel` where non-default)
- Modify: `src/services/ClientOperations.ts` (two switches → façade)
- Modify: `src/types/Provider.ts` (delete dead code)
- Test: extend `descriptorRegistry.test.ts`

**Interfaces:**
- Consumes: `Credentials` from Task 1; each client's existing static `validateApiKeyAndFetchModels` / `getLatestRealtimeModel`.
- Produces: `descriptor.validateAndFetchModels(creds)`, `descriptor.latestRealtimeModel(models)`; `ClientOperations.*` delegating; `Provider.ts` without `SUPPORTED_PROVIDERS` / `isValidProvider` / `getProviderDisplayName`.

- [ ] **Step 1: Failing test** (append)

```typescript
describe('descriptor.validateAndFetchModels', () => {
  it('rejects incomplete credentials with the provider-specific message', async () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.PALABRA_AI);
    const r = await d.validateAndFetchModels({ ok: false, missing: 'Both Client ID and Client Secret are required for Palabra AI' });
    expect(r.validation.valid).toBe(false);
    expect(r.validation.message).toMatch(/Client ID and Client Secret/);
    expect(r.models).toEqual([]);
  });

  it('kizuna twins validate statically from a non-empty token', async () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
    const ok = await d.validateAndFetchModels({ ok: true, primary: 'sess_TOKEN' });
    expect(ok.validation.valid).toBe(true);
    expect(ok.models[0].id).toBe('gpt-realtime-translate');
    const bad = await d.validateAndFetchModels({ ok: false, missing: 'Sign in is required for Kizuna relay providers' });
    expect(bad.validation.valid).toBe(false);
  });
});

describe('descriptor.latestRealtimeModel', () => {
  it('fixed-model providers return their identifier', () => {
    expect(ProviderConfigFactory.getDescriptor(Provider.ZOOM_AI).latestRealtimeModel([])).toBe('zoom-scribe-translator-v1');
    expect(ProviderConfigFactory.getDescriptor(Provider.VOLCENGINE_AST2).latestRealtimeModel([])).toBe('ast-v2-s2s');
    expect(ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_VOLCENGINE_AST2).latestRealtimeModel([])).toBe('ast-v2-s2s');
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`not migrated yet: validateAndFetchModels`).

- [ ] **Step 3: Implement per class**

Shared guard shape — every implementation starts with:

```typescript
async validateAndFetchModels(creds: Credentials) {
  if (!creds.ok) {
    return { validation: { valid: false, message: creds.missing, validating: false }, models: [] };
  }
  // ...provider-specific below
}
```

Provider-specific bodies (exact moves of ClientOperations.ts:29-140 arms; drop the per-arm "both required" checks — `!creds.ok` covers them because Task 5's `extractCredentials` produces those messages):

| Class | body after the guard |
|---|---|
| OpenAIProviderConfig | `return OpenAIClient.validateApiKeyAndFetchModels(creds.primary);` |
| OpenAICompatibleProviderConfig | `if (!creds.endpoint) return { validation: { valid: false, message: 'Custom API endpoint is required for OpenAI Compatible provider', validating: false }, models: [] }; return OpenAIClient.validateApiKeyAndFetchModels(creds.primary, creds.endpoint);` |
| OpenAITranslateProviderConfig | `return OpenAITranslateGAClient.validateApiKeyAndFetchModels(creds.primary);` |
| GeminiProviderConfig | `return GeminiClient.validateApiKeyAndFetchModels(creds.primary);` |
| PalabraAIProviderConfig | `const validation = await PalabraAIClient.validateApiKey(creds.primary, creds.secret!); return { validation, models: [{ id: 'realtime-translation', type: 'realtime', created: Date.now() / 1000 }] };` |
| VolcengineSTProviderConfig | `return VolcengineSTClient.validateApiKeyAndFetchModels(creds.primary, creds.secret!);` |
| VolcengineAST2ProviderConfig | `return VolcengineAST2Client.validateApiKeyAndFetchModels(creds.primary, creds.secret!);` |
| ZoomAIProviderConfig | `return ZoomAIClient.validateApiKeyAndFetchModels(creds.primary, creds.secret!);` |
| LocalInferenceProviderConfig | keep the throwing stub REPLACED by: `return { validation: { valid: false, message: 'local inference readiness is model-based', validating: false }, models: [] };` — settingsStore's LOCAL_INFERENCE arm short-circuits before ever calling this (it gates on modelStore, settingsStore.ts:1206-1271, untouched by this plan). |
| Both kizuna twins (one override in EACH twin class) | `return { validation: { valid: true, message: '', validating: false }, models: [{ id: this.latestRealtimeModel([]), type: 'realtime', created: Date.now() / 1000 }] };` (the `!creds.ok` guard already rejected signed-out; copy the explanatory comment block from ClientOperations.ts about relay twins verbatim) |

`latestRealtimeModel` overrides (base default returns `models[0]?.id ?? config.models[0]?.id`):

| Class | override |
|---|---|
| OpenAIProviderConfig | `latestRealtimeModel(models: FilteredModel[]) { return OpenAIClient.getLatestRealtimeModel(models); }` |
| OpenAICompatibleProviderConfig | same as OpenAI (inherits if you subclass; they don't — repeat the one-liner) |
| GeminiProviderConfig | `return GeminiClient.getLatestRealtimeModel(models);` |
| OpenAITranslateProviderConfig | `return models[0]?.id ?? 'gpt-realtime-translate';` |
| all others | base default suffices — VERIFY each config's `models[0].id` equals the old hardcoded string: palabraai `realtime-translation`, volcengine_st `speech-translate-v1`, volcengine_ast2 `ast-v2-s2s`, zoom_ai `zoom-scribe-translator-v1`. If a config's models list is empty or differs, add an explicit override with the old string. |

- [ ] **Step 4: Façade ClientOperations + clean Provider.ts**

```typescript
/**
 * @deprecated Thin façade kept for legacy callers/tests. New code resolves the
 * descriptor via ProviderConfigFactory.getDescriptor(provider) directly.
 */
export class ClientOperations {
  static async validateApiKeyAndFetchModels(
    apiKey: string, provider: ProviderType, clientSecret?: string, customEndpoint?: string
  ) {
    return ProviderConfigFactory.getDescriptor(provider).validateAndFetchModels(
      apiKey
        ? { ok: true, primary: apiKey, secret: clientSecret, endpoint: customEndpoint }
        : { ok: false, missing: `API key is required for ${provider}` }
    );
  }

  static getLatestRealtimeModel(filteredModels: FilteredModel[], provider: ProviderType): string {
    return ProviderConfigFactory.getDescriptor(provider).latestRealtimeModel(filteredModels);
  }

  static getSupportedProviders(): ProviderType[] {
    return ProviderConfigFactory.getAvailableProviders();
  }

  static isSupportedProvider(provider: string): provider is ProviderType {
    return ProviderConfigFactory.isProviderSupported(provider as ProviderType);
  }
}
```

Delete all client imports from ClientOperations.ts (now unused). In `src/types/Provider.ts` delete: `SUPPORTED_PROVIDERS` (lines 34-45), `isValidProvider` (58-60), `getProviderDisplayName` (72-95), and the now-unused feature-flag imports on line 5. Keep: enum, `ProviderType`, `OPENAI_COMPATIBLE_PROVIDERS`, `isOpenAICompatible`, `isKizunaManagedProvider`, `kizunaBaseProvider`. Then `grep -rn "SUPPORTED_PROVIDERS\|isValidProvider\|getProviderDisplayName" src/` must return zero non-test hits (fix any test that referenced them by switching to `ClientOperations.getSupportedProviders()` under the Task-1 env mock).

Behavior change (accepted in design review): `getSupportedProviders()` now reflects platform gates (registry) instead of the flag-only list — this FIXES the two-registries divergence (OPENAI_COMPATIBLE outside Electron, VOLCENGINE_AST2 outside Electron/Extension no longer falsely reported).

- [ ] **Step 5: Run** `npm run test -- --run src/services/ src/types/` — PASS, including untouched `ClientOperations.test.ts`.

- [ ] **Step 6: Commit** — `git commit -am "refactor(providers): move validation and model resolution onto descriptors, single availability registry"`

---

### Task 4: Settings interfaces + defaults move into provider modules; delete dead `ProviderConfig.defaults`

**Files:**
- Modify: 11 base config classes (receive their Settings interface + defaults const)
- Modify: `src/stores/settingsStore.ts` (delete moved decls; import + re-export)
- Modify: `src/services/providers/ProviderConfig.ts` (delete `defaults` field, lines 78-94)
- Modify: all 13 config classes' `getConfig()` (delete the `defaults: {...}` block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export interface XxxSettings` + `export const defaultXxxSettings: XxxSettings` from each provider module; settingsStore re-exports every one of them (existing importers like MainPanel/LanguageSection keep their import paths).

- [ ] **Step 1: Move the declarations**

Source blocks in settingsStore.ts → destination files. Move VERBATIM (interfaces at 52-183, defaults at ~240-370 — locate each `defaultXxxSettings` by name):

| Move | Destination |
|---|---|
| `OpenAICompatibleSettingsBase` (52-73) + `OpenAISettings` alias (80) + `defaultOpenAICompatibleSettingsBase` + `defaultOpenAISettings` | `OpenAIProviderConfig.ts` |
| `OpenAICompatibleSettings` (75-78) + `defaultOpenAICompatibleSettings` | `OpenAICompatibleProviderConfig.ts` (imports the Base from OpenAIProviderConfig) |
| `OpenAITranslateSettings` (82-100) + `defaultOpenAITranslateSettings` | `OpenAITranslateProviderConfig.ts` |
| `GeminiSettings` (102-116) + `defaultGeminiSettings` | `GeminiProviderConfig.ts` |
| `PalabraAISettings` (118-133) + `defaultPalabraAISettings` | `PalabraAIProviderConfig.ts` |
| `VolcengineSTSettings` (135-141) + `defaultVolcengineSTSettings` | `VolcengineSTProviderConfig.ts` |
| `ZoomAISettings` (143-149) + `defaultZoomAISettings` | `ZoomAIProviderConfig.ts` |
| `VolcengineAST2Settings` (151-164) + `defaultVolcengineAST2Settings` | `VolcengineAST2ProviderConfig.ts` |
| `LocalInferenceSettings` (166-183) + `defaultLocalInferenceSettings` | `LocalInferenceProviderConfig.ts` |
| `defaultKizunaOpenaiTranslateSettings` (350) | `KizunaAIOpenAITranslateProviderConfig.ts` |
| `defaultKizunaVolcengineAst2Settings` (351) | `KizunaAIVolcengineAST2ProviderConfig.ts` |

`OpenAITranslateSettings` references `TranslateTargetLanguage` from `../interfaces/IClient` — adjust that import in its new home. In settingsStore.ts, add one consolidated import of all moved names plus re-exports:

```typescript
import {
  OpenAISettings, defaultOpenAISettings, OpenAICompatibleSettingsBase,
} from '../services/providers/OpenAIProviderConfig';
// ... one import line per provider module ...
export type {
  OpenAISettings, OpenAICompatibleSettings, OpenAICompatibleSettingsBase,
  OpenAITranslateSettings, GeminiSettings, PalabraAISettings,
  VolcengineSTSettings, ZoomAISettings, VolcengineAST2Settings, LocalInferenceSettings,
};
```

- [ ] **Step 2: Delete dead `defaults`**

Remove `defaults: { ... }` from the `ProviderConfig` interface (ProviderConfig.ts:78-94) and from every config class's `getConfig()` return. Verified dead: `grep -rn "\.defaults" src/ --include='*.ts*' | grep -v ProviderConfig` → only a comment in volcengineAST2LanguageSync.ts (leave the comment). If `ZoomAIProviderConfig.test.ts` asserts on `defaults`, update that test to drop the assertion.

- [ ] **Step 3: Run FULL suite** — `npm run test -- --run`. Expected: PASS. This task is pure declaration motion; any failure means a missed re-export — chase with `npx tsc --noEmit 2>&1 | grep -i "has no exported member"`.

- [ ] **Step 4: Commit** — `git commit -am "refactor(providers): settings types and defaults live in their provider modules"`

---

### Task 5: `extractCredentials` + `peekPrimaryCredential`; rewire settingsStore.validateApiKey and ProviderSection

**Files:**
- Modify: config classes needing non-default credentials (list below)
- Modify: `src/stores/settingsStore.ts:1298-1421` (three per-provider chains → descriptor calls)
- Modify: `src/components/Settings/sections/ProviderSection.tsx:176-196` (fourth copy → `peekPrimaryCredential`)
- Test: extend `descriptorRegistry.test.ts`

**Interfaces:**
- Consumes: `Credentials`, `CredentialCtx` from Task 1.
- Produces: `await descriptor.extractCredentials(slice, ctx)` used by settingsStore now and MainPanel in Task 7.

- [ ] **Step 1: Failing test** (append)

```typescript
describe('descriptor.extractCredentials', () => {
  it('normalizes each provider credential shape', async () => {
    const cases: Array<[Provider, object, { primary: string; secret?: string; endpoint?: string }]> = [
      [Provider.OPENAI, { apiKey: 'sk-1' }, { primary: 'sk-1' }],
      [Provider.OPENAI_COMPATIBLE, { apiKey: 'k', customEndpoint: 'https://e' }, { primary: 'k', endpoint: 'https://e' }],
      [Provider.PALABRA_AI, { clientId: 'id', clientSecret: 'sec' }, { primary: 'id', secret: 'sec' }],
      [Provider.VOLCENGINE_ST, { accessKeyId: 'ak', secretAccessKey: 'sk' }, { primary: 'ak', secret: 'sk' }],
      [Provider.VOLCENGINE_AST2, { appId: 123, accessToken: 'tok' }, { primary: '123', secret: 'tok' }],
      [Provider.ZOOM_AI, { apiKey: 'zk', apiSecret: 'zs' }, { primary: 'zk', secret: 'zs' }],
    ];
    for (const [id, slice, want] of cases) {
      const got = await ProviderConfigFactory.getDescriptor(id).extractCredentials(slice, {});
      expect(got).toEqual({ ok: true, ...want });
    }
  });

  it('two-field providers report both-required when either is missing', async () => {
    const r = await ProviderConfigFactory.getDescriptor(Provider.PALABRA_AI)
      .extractCredentials({ clientId: 'id', clientSecret: '' }, {});
    expect(r).toEqual({ ok: false, missing: 'Both Client ID and Client Secret are required for Palabra AI' });
  });

  it('kizuna twin resolves the auth token from ctx', async () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
    expect(await d.extractCredentials({}, { getAuthToken: async () => 'sess_T' }))
      .toEqual({ ok: true, primary: 'sess_T' });
    expect((await d.extractCredentials({}, {})).ok).toBe(false);
    expect((await d.extractCredentials({}, { getAuthToken: async () => null })).ok).toBe(false);
  });

  it('local inference needs no credentials', async () => {
    expect(await ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE).extractCredentials({}, {}))
      .toEqual({ ok: true, primary: '' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (base default extracts `apiKey`; Palabra/Volcengine/Zoom/kizuna/local don't match).

- [ ] **Step 3: Implement overrides** (base default covers OpenAI / OpenAITranslate / Gemini):

```typescript
// OpenAICompatibleProviderConfig.ts
async extractCredentials(slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
  const s = slice as OpenAICompatibleSettings;
  if (!s?.apiKey) return { ok: false, missing: 'API key is required for openai_compatible' };
  return { ok: true, primary: s.apiKey, endpoint: s.customEndpoint };
}

// PalabraAIProviderConfig.ts
async extractCredentials(slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
  const s = slice as PalabraAISettings;
  if (!s?.clientId || !s?.clientSecret) {
    return { ok: false, missing: 'Both Client ID and Client Secret are required for Palabra AI' };
  }
  return { ok: true, primary: s.clientId, secret: s.clientSecret };
}
peekPrimaryCredential(slice: unknown): string { return (slice as PalabraAISettings)?.clientId ?? ''; }

// VolcengineSTProviderConfig.ts
async extractCredentials(slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
  const s = slice as VolcengineSTSettings;
  if (!s?.accessKeyId || !s?.secretAccessKey) {
    return { ok: false, missing: 'Both Access Key ID and Secret Access Key are required for Volcengine Speech Translate' };
  }
  return { ok: true, primary: s.accessKeyId, secret: s.secretAccessKey };
}
peekPrimaryCredential(slice: unknown): string { return (slice as VolcengineSTSettings)?.accessKeyId ?? ''; }

// VolcengineAST2ProviderConfig.ts  (appId may be numeric in old persisted state — String() it, matching settingsStore.ts:1350)
async extractCredentials(slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
  const s = slice as VolcengineAST2Settings;
  if (!s?.appId || !s?.accessToken) {
    return { ok: false, missing: 'Both APP ID and Access Token are required for Doubao AST 2.0' };
  }
  return { ok: true, primary: String(s.appId), secret: String(s.accessToken) };
}
peekPrimaryCredential(slice: unknown): string { return String((slice as VolcengineAST2Settings)?.appId ?? ''); }

// ZoomAIProviderConfig.ts
async extractCredentials(slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
  const s = slice as ZoomAISettings;
  if (!s?.apiKey || !s?.apiSecret) {
    return { ok: false, missing: 'Both API Key and API Secret are required for Zoom AI Services' };
  }
  return { ok: true, primary: s.apiKey, secret: s.apiSecret };
}

// LocalInferenceProviderConfig.ts
async extractCredentials(_slice: unknown, _ctx: CredentialCtx): Promise<Credentials> {
  return { ok: true, primary: '' };
}
peekPrimaryCredential(): string { return ''; }

// Add ONE shared override in EACH kizuna twin class (they don't share a common parent besides their bases):
async extractCredentials(_slice: unknown, ctx: CredentialCtx): Promise<Credentials> {
  const token = ctx.getAuthToken ? await ctx.getAuthToken() : null;
  if (!token) return { ok: false, missing: 'Sign in is required for Kizuna relay providers' };
  return { ok: true, primary: token };
}
peekPrimaryCredential(): string { return ''; }
```

- [ ] **Step 4: Rewire `settingsStore.validateApiKey`**

Replace the three chains. The LOCAL_INFERENCE arm ABOVE this code (1206-1271) is untouched. New shape for lines ~1298-1428 (keep surrounding logic identical):

```typescript
const descriptor = ProviderConfigFactory.getDescriptor(provider);
const currentSettings = state.getCurrentProviderSettings();
const creds = await descriptor.extractCredentials(currentSettings, { getAuthToken });

// Empty/incomplete credentials: silent reset, same as before (no error banner while typing).
if (!creds.ok || (!creds.primary && provider !== Provider.PALABRA_AI)) {
  set({
    isApiKeyValid: null, availableModels: [], validationMessage: '',
    isValidating: false, isValidated: false, validationError: null,
  });
  return { valid: false, message: '', validating: false };
}

const cacheKey = `${provider}:${creds.primary}:${creds.secret ?? ''}:${creds.endpoint ?? ''}`;
// ... existing cache lookup unchanged ...

const result = await service.validateApiKeyAndFetchModels(
  creds.primary, provider, creds.secret, creds.endpoint
);
```

Notes: (a) the PALABRA_AI special-case in the emptiness check mirrors the old line 1366 exactly; with `extractCredentials` returning `ok:false` when either Palabra field is missing, `!creds.ok` already covers it — keep the condition simple: `if (!creds.ok) { ...reset... }` is sufficient IF Palabra's override rejects empty pairs (it does). Use just `if (!creds.ok)`. (b) The old kizuna branch `isKizunaManagedProvider(provider) && getAuthToken` is fully absorbed. (c) cacheKey format change only invalidates the in-memory 5-minute cache once — harmless. Delete the now-unused `PalabraAISettings`/`VolcengineSTSettings`/`ZoomAISettings`/`VolcengineAST2Settings` casts and the 1412-1421 clientSecret chain.

- [ ] **Step 5: Rewire ProviderSection.tsx:176-196**

Replace the whole `switch (provider)` credential getter with:

```typescript
const getStoredPrimaryCredential = (provider: ProviderType): string => {
  const descriptor = ProviderConfigFactory.getDescriptor(provider);
  const slice = useSettingsStore.getState()[descriptor.settingsSliceKey as keyof SettingsStore];
  return descriptor.peekPrimaryCredential(slice);
};
```

(Match the existing function name at line ~175 — read the surrounding code and keep the same name/usage; only the body changes. Remove per-provider settings hook imports that become unused.)

- [ ] **Step 6: Run FULL suite** — `npm run test -- --run`. `settingsStore.test.ts` exercises validateApiKey paths (568 lines) — must stay green.

- [ ] **Step 7: Commit** — `git commit -am "refactor(providers): descriptors own credential extraction; four hand-copied chains collapse"`

---

### Task 6: `buildSessionConfig` + slice access via `settingsSliceKey`

**Files:**
- Modify: 9 base config classes (builders move in from settingsStore.ts:498-689)
- Modify: `src/stores/settingsStore.ts` — `createSessionConfig` (1715-1758) and `getCurrentProviderSettings` (1628-1655) become registry shells; delete the 8 free builder functions
- Test: extend `descriptorRegistry.test.ts`

**Interfaces:**
- Consumes: `settingsSliceKey` (Task 1), moved Settings types (Task 4).
- Produces: `descriptor.buildSessionConfig(slice, systemInstructions): SessionConfig`.

- [ ] **Step 1: Failing test** (append)

```typescript
import { defaultZoomAISettings } from './ZoomAIProviderConfig';
import { defaultGeminiSettings } from './GeminiProviderConfig';

describe('descriptor.buildSessionConfig', () => {
  it('builds a config whose provider tag matches, for every provider, from defaults', () => {
    // Expected wire tags (kizuna twins reuse their base tag; compatible uses 'openai').
    const wireTag: Record<string, string> = {
      openai: 'openai', openai_compatible: 'openai', openai_translate: 'openai_translate',
      gemini: 'gemini', palabraai: 'palabraai', volcengine_st: 'volcengine_st',
      volcengine_ast2: 'volcengine_ast2', zoom_ai: 'zoom_ai', local_inference: 'local_inference',
      kizunaai_openai_translate: 'openai_translate', kizunaai_volcengine_ast2: 'volcengine_ast2',
    };
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      // Import each default from its module; a lookup map is fine:
      const cfg = d.buildSessionConfig((DEFAULTS_BY_SLICE as any)[d.settingsSliceKey], 'instr');
      expect(cfg.provider).toBe(wireTag[id]);
    }
  });

  it('zoom session config is text-only with a single target', () => {
    const cfg: any = ProviderConfigFactory.getDescriptor(Provider.ZOOM_AI)
      .buildSessionConfig({ ...defaultZoomAISettings, sourceLanguage: 'ja-JP', targetLanguage: 'en-US' }, 'sys');
    expect(cfg).toMatchObject({ provider: 'zoom_ai', textOnly: true, targetLanguages: ['en-US'] });
  });

  it('gemini config carries VAD tuning through', () => {
    const cfg: any = ProviderConfigFactory.getDescriptor(Provider.GEMINI)
      .buildSessionConfig({ ...defaultGeminiSettings, vadSilenceDurationMs: 900 }, 'sys');
    expect(cfg.vadSilenceDurationMs).toBe(900);
  });
});
```

Build `DEFAULTS_BY_SLICE` in the test from the per-module default exports (all importable after Task 4): `{ openai: defaultOpenAISettings, openaiCompatible: defaultOpenAICompatibleSettings, ... kizunaOpenaiTranslate: defaultKizunaOpenaiTranslateSettings, ... }`.

- [ ] **Step 2: Run — expect FAIL** (`not migrated yet: buildSessionConfig`).

- [ ] **Step 3: Move the builders**

Each `createXxxSessionConfig` function body (settingsStore.ts:498-689, quoted in full in the repo — move verbatim) becomes `buildSessionConfig(slice: unknown, systemInstructions: string)` on its class, starting with a typed local: `const settings = slice as XxxSettings;`. Mapping:

| settingsStore function (lines) | destination class |
|---|---|
| `createOpenAISessionConfig` (498-539) | OpenAIProviderConfig — ALSO used by OpenAICompatibleProviderConfig: make Compatible extend nothing new; give OpenAICompatibleProviderConfig `buildSessionConfig` that simply calls a shared protected helper OR duplicates via `OpenAIProviderConfig.prototype` — cleanest: export the moved function as a module-level helper `buildOpenAISessionConfig(settings, instructions)` in OpenAIProviderConfig.ts and have both classes' methods delegate to it. |
| `createOpenAITranslateSessionConfig` (541-560) | OpenAITranslateProviderConfig (kizuna translate twin inherits) |
| `createGeminiSessionConfig` (562-579) | GeminiProviderConfig |
| `createPalabraAISessionConfig` (581-602) | PalabraAIProviderConfig |
| `createVolcengineSTSessionConfig` (604-615) | VolcengineSTProviderConfig |
| `createZoomAISessionConfig` (617-629) | ZoomAIProviderConfig |
| `createVolcengineAST2SessionConfig` (631-650) | VolcengineAST2ProviderConfig (kizuna AST2 twin inherits) |
| `createLocalInferenceSessionConfig` (652-689) | LocalInferenceProviderConfig — carries its imports along: `getManifestEntry`, `getTtsModelsForLanguage`, `getTranslationModel` from `../../lib/local-inference/...` and `buildDefaultLocalPrompt` (find their current import paths at the top of settingsStore.ts and replicate). |

- [ ] **Step 4: Shell out settingsStore**

```typescript
getCurrentProviderSettings: () => {
  const state = get();
  const descriptor = ProviderConfigFactory.getDescriptor(state.provider);
  return state[descriptor.settingsSliceKey as keyof SettingsStore] as ProviderSettingsUnion;
},

createSessionConfig: (systemInstructions) => {
  const state = get();
  const descriptor = ProviderConfigFactory.getDescriptor(state.provider);
  const slice = state[descriptor.settingsSliceKey as keyof SettingsStore];
  const config = descriptor.buildSessionConfig(slice, systemInstructions);
  config.textOnly = state.textOnly;          // cross-provider fields stay in the shell
  config.keepReplayAudio = state.keepReplayAudio;
  return config;
},
```

`ProviderSettingsUnion` is whatever union type `getCurrentProviderSettings` returns today — keep the existing return type annotation. The old `default:` arm that silently fell back to the OpenAI slice is GONE — `getDescriptor` throws on unknown providers instead (this was bug f660c715's root cause; failing loud is the fix). Also update the THIRD copy of this mapping, `useCurrentTurnDetectionMode` (settingsStore.ts:1880-1892): re-implement over `getCurrentProviderSettings()` / the slice lookup instead of its own switch, preserving its current fallback for slices without `turnDetectionMode`.

- [ ] **Step 5: Rewire LanguageSection's duplicate slice map**

`LanguageSection.tsx:136-161` has a `useMemo` re-deriving current provider settings with its own switch. Replace with a store subscription through the descriptor:

```typescript
const currentProviderSettings = useSettingsStore(
  (s) => s[ProviderConfigFactory.getDescriptor(s.provider).settingsSliceKey as keyof SettingsStore]
) as Record<string, any>;
```

(Selector returns the slice object itself — reference-stable under zustand, re-renders only when the slice or provider changes. Delete the useMemo and its dependency list.)

- [ ] **Step 6: Run FULL suite** — settingsStore tests assert `createSessionConfig` outputs (settingsStore.test.ts:167-219 and providerSettings tests) — must stay green byte-for-byte on config shapes.

- [ ] **Step 7: Commit** — `git commit -am "refactor(providers): descriptors build session configs; slice dispatch via settingsSliceKey"`

---

### Task 7: MainPanel migrates to the descriptor path

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx` — `createAIClient` (501-544), the primary-credential switch (~1445-1497), and both call sites of `createAIClient`

**Interfaces:**
- Consumes: `extractCredentials`, `createClient`, `supportsWebRTC` from earlier tasks.
- Produces: no new interface; deletes the last two hand-copied credential chains.

- [ ] **Step 1: Read both call sites of `createAIClient`** (`grep -n "createAIClient(" src/components/MainPanel/MainPanel.tsx`) to see what `modelName`/`apiKey` they pass — the apiKey each passes comes from the ~1445-1497 switch; the participant client path reuses it.

- [ ] **Step 2: Rewrite `createAIClient`**

```typescript
/**
 * Create the AI client for the current provider via its descriptor.
 * Credential shapes live in each provider's descriptor — MainPanel no longer
 * names provider-specific fields.
 */
const createAIClient = useCallback(async (useWebRTC: boolean = false): Promise<IClient> => {
  const descriptor = ProviderConfigFactory.getDescriptor(provider);
  const slice = useSettingsStore.getState()[descriptor.settingsSliceKey as keyof SettingsStore];
  const creds = await descriptor.extractCredentials(slice, { getAuthToken });
  if (!creds.ok) throw new Error(creds.missing);

  // PalabraAI (LiveKit) is treated as 'webrtc' for unified native-capture handling.
  const effectiveTransportType = (useWebRTC || provider === Provider.PALABRA_AI) ? 'webrtc' : 'websocket';
  const usesNativeCapture = effectiveTransportType === 'webrtc' &&
    (descriptor.supportsWebRTC || provider === Provider.PALABRA_AI);

  const webrtcOptions = usesNativeCapture ? {
    inputDeviceId: !isMicMuted ? selectedInputDevice?.deviceId : undefined,
    outputDeviceId: selectedMonitorDevice?.deviceId,
  } : undefined;

  return descriptor.createClient(creds, { transport: effectiveTransportType, webrtcOptions });
}, [provider, getAuthToken, selectedInputDevice?.deviceId, selectedMonitorDevice?.deviceId, isMicMuted]);
```

CAREFUL, verify against current code before writing: (1) today `usesNativeAudioCapture` returns false for PalabraAI (ClientFactory.ts:179-183 — Palabra uses appendInputAudio) yet `webrtcOptions` was only built when `usesNativeCapture` — mirror the EXACT current truth table: `usesNativeCapture = ClientFactory.usesNativeAudioCapture(provider, effectiveTransportType)` which is `transport==='webrtc' && supportsWebRTC(provider)` — Palabra is NOT in supportsWebRTC, so drop the `|| provider === Provider.PALABRA_AI` from `usesNativeCapture` (keep it only in `effectiveTransportType`). (2) The function becomes async and loses its `(modelName, apiKey)` params — update BOTH call sites: they currently do the 1445-1497 switch to compute `apiKey` then call `createAIClient(modelName, apiKey, useWebRTC)`; after the change they just `await createAIClient(useWebRTC)` and the whole 1445-1497 switch block is DELETED (including its kizuna `freshToken` sub-branch — `extractCredentials` owns that now). `modelName` was already ignored by the factory (`void model`) — confirm the call sites don't use it for anything else before deleting its computation; if the model name feeds `getSessionConfig` or logging, leave THAT usage intact and only remove the client-creation argument.

- [ ] **Step 3: Kill the leftover secret chain** — delete lines 524-533 (`let clientSecret ...` chain); it's inside the old `createAIClient` and disappears with the rewrite. Remove now-unused imports (`ClientFactory` — if only `usesNativeAudioCapture` remains, inline it as shown; per-provider settings hooks that were only feeding credentials).

- [ ] **Step 4: Manual smoke check** (no MainPanel tests exist): `npm run dev`, open the app, verify: OpenAI session starts (or fails with API error — not a TypeError), provider switching keeps working, no console errors on the config panel. Then `npm run test -- --run` for regressions.

- [ ] **Step 5: Commit** — `git commit -am "refactor(main-panel): session start goes through provider descriptors"`

---

### Task 8: Language rules onto the interface

**Files:**
- Modify: `ZoomAIProviderConfig.ts`, `OpenAITranslateProviderConfig.ts`, `PalabraAIProviderConfig.ts`, `VolcengineSTProviderConfig.ts`, `VolcengineAST2ProviderConfig.ts`, `OpenAIProviderConfig.ts` (statics → instance overrides)
- Modify: `src/components/Settings/sections/LanguageSection.tsx` (drop concrete imports at lines 42-43; call sites 234/332/334/362/375/546)
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx` (grep for the same statics — verifier confirmed it shares `reconcileTarget`)
- Test: extend `descriptorRegistry.test.ts`

**Interfaces:**
- Consumes: base `resolveSourceLanguages`/`resolveTargetLanguages`/`reconcileTarget` defaults from Task 1.
- Produces: overrides preserving current static behavior; statics kept as one-line delegates to the instance methods until all callers migrate IN THIS TASK, then deleted.

- [ ] **Step 1: Failing test** (append)

```typescript
describe('descriptor language rules', () => {
  it('zoom: non-English sources can only target English', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.ZOOM_AI);
    expect(d.resolveTargetLanguages('ja-JP').map(l => l.value)).toEqual(['en-US']);
    expect(d.reconcileTarget('ja-JP', 'fr-FR')).toBe('en-US');
    expect(d.reconcileTarget('en-US', 'ja-JP')).toBe('ja-JP');
  });

  it('openai translate restricts targets to the fixed 13', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.OPENAI_TRANSLATE);
    expect(d.resolveTargetLanguages('any').length).toBe(13);
  });

  it('default providers pass their config languages through', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.GEMINI);
    expect(d.resolveSourceLanguages()).toBe(d.getConfig().languages);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** on the zoom/translate cases (base default returns full language lists).

- [ ] **Step 3: Implement overrides by MOVING each static body into the instance method** (exemplar for Zoom — the other classes follow the identical pattern with their own statics, whose exact bodies are in their files at the lines the review verified: OpenAITranslateProviderConfig.ts:115, PalabraAIProviderConfig.ts:111, VolcengineAST2ProviderConfig.ts:29-33, VolcengineSTProviderConfig.ts:49-54, OpenAIProviderConfig.ts:76):

```typescript
// ZoomAIProviderConfig.ts — statics become instance overrides
resolveSourceLanguages(): LanguageOption[] { return ZoomAIProviderConfig.SOURCE_LANGUAGES; }
resolveTargetLanguages(source: string): LanguageOption[] {
  return ZoomAIProviderConfig.PAIRS[source] ?? ZoomAIProviderConfig.EN_ONLY;
}
reconcileTarget(source: string, currentTarget: string): string {
  const allowed = this.resolveTargetLanguages(source).map(l => l.value);
  return allowed.includes(currentTarget) ? currentTarget : (allowed[0] || 'en-US');
}
```

For each class: if the static is used ONLY by LanguageSection/ProviderSpecificSettings (grep each static name repo-wide), delete the static after migrating callers. If something else consumes it (e.g. a client or test), keep the static as `static getSourceLanguages() { return new ZoomAIProviderConfig().resolveSourceLanguages(); }`-style delegate — but prefer migrating the caller.

- [ ] **Step 4: Migrate LanguageSection + ProviderSpecificSettings call sites** — each `ZoomAIProviderConfig.getSourceLanguages()` → `ProviderConfigFactory.getDescriptor(provider).resolveSourceLanguages()` etc.; the provider-identity branches AROUND these calls (e.g. `if (provider === Provider.ZOOM_AI)`) collapse where the descriptor default now gives the right answer for every provider. Do NOT restructure unrelated JSX; this is a call-site swap, and where a `provider === ZOOM_AI` check guards zoom-only UI copy (not language data), leave the check.

- [ ] **Step 5: Run FULL suite + commit** — `git commit -am "refactor(providers): language rules are descriptor interface methods"`

---

### Task 9: i18n names through the descriptor; ProviderSection info switch collapses

**Files:**
- Modify: `src/components/Settings/sections/ProviderSection.tsx` (`getProviderInfoById` switch at ~275)
- Test: extend `descriptorRegistry.test.ts`

**Interfaces:**
- Consumes: `i18nKey` (Task 1).
- Produces: name/description resolved as `t(\`providers.${descriptor.i18nKey ?? id}.name\`)`.

- [ ] **Step 1: Failing test** (append)

```typescript
import en from '../../locales/en/translation.json';

describe('descriptor i18n keys', () => {
  it('every available provider has name+description in the en catalog', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const key = d.i18nKey ?? id;
      const entry = (en as any).providers?.[key];
      expect(entry?.name, `providers.${key}.name`).toBeTruthy();
      expect(entry?.description, `providers.${key}.description`).toBeTruthy();
    }
  });
});
```

(Adjust the relative import path to the locales file from the test's location; if `description` is missing for some provider in en/translation.json, the test documents it — check the catalog first and assert only on fields that exist for all, or add the missing en entries.)

- [ ] **Step 2: Run** — likely PASS immediately for names (catalog verified: all 11 ids present; `openaiCompatible` handled by Task 1's i18nKey). If it fails, fix the specific gap it names.

- [ ] **Step 3: Collapse `getProviderInfoById`** — replace the ~27-case switch with:

```typescript
const getProviderInfoById = (providerId: ProviderType) => {
  const descriptor = ProviderConfigFactory.getDescriptor(providerId);
  const key = descriptor.i18nKey ?? providerId;
  return {
    name: t(`providers.${key}.name`),
    icon: PROVIDER_ICONS[providerId] ?? DefaultProviderIcon,
    description: t(`providers.${key}.description`),
  };
};
```

`PROVIDER_ICONS` is a plain `Record<ProviderType, ComponentType>` map built from the icon imports ALREADY at the top of ProviderSection.tsx (icons are React components and stay in the UI layer — decided in design review). Preserve any per-case special props the old switch attached (read it fully first; if some cases carry extra fields like badges, keep a small override map for just those fields, not a switch).

- [ ] **Step 4: Run FULL suite + commit** — `git commit -am "refactor(providers): provider display info resolves through descriptor i18n keys"`

---

### Task 10: Registry invariant test, docs, final sweep

**Files:**
- Modify: `src/services/providers/descriptorRegistry.test.ts` (final invariants)
- Modify: `CLAUDE.md` ("Adding a New AI Provider" section)
- Modify: `src/services/providers/ProviderConfigFactory.ts` (drop `getConfigInstance` if now unused)

- [ ] **Step 1: Add the cross-cutting invariants** (append)

```typescript
describe('registry invariants', () => {
  it('descriptor config id equals its registry key', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      expect(ProviderConfigFactory.getDescriptor(id).getConfig().id).toBe(id);
    }
  });

  it('every settingsSliceKey exists in the settings store defaults', async () => {
    const { useSettingsStore } = await import('../../stores/settingsStore');
    const state = useSettingsStore.getState() as Record<string, unknown>;
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const key = ProviderConfigFactory.getDescriptor(id).settingsSliceKey;
      expect(state[key], `slice '${key}' for ${id}`).toBeTypeOf('object');
    }
  });

  it('extractCredentials on an empty slice never returns ok (except credential-free providers)', async () => {
    const credentialFree = new Set([Provider.LOCAL_INFERENCE]);
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      if (credentialFree.has(id) || id.startsWith('kizunaai')) continue;
      const r = await ProviderConfigFactory.getDescriptor(id).extractCredentials({}, {});
      expect(r.ok, id).toBe(false);
    }
  });
});
```

(The settingsStore import inside the test is dynamic to avoid hoisting it above the env mock. If constructing the store in a test env needs the service mocks other store tests use, copy the setup lines from `settingsStore.test.ts`'s top.)

- [ ] **Step 2: Dead-code sweep** — `grep -rn "getConfigInstance\|ProviderConfigInstance" src/` → migrate/remove leftovers; `grep -rn "case Provider\." src/ --include='*.ts*' | wc -l` → record the number in the PR description (expect roughly 142 → ~60; remaining legitimate branches live in ProviderSpecificSettings/UI copy and settingsStore update actions, which are candidate 2's scope, plus logStore/analytics).

- [ ] **Step 3: Rewrite CLAUDE.md "Adding a New AI Provider"**

```markdown
### Adding a New AI Provider
1. Create the client class implementing `IClient` in `src/services/clients/`
2. Create `XProviderConfig` in `src/services/providers/` extending `BaseProviderDescriptor`:
   settings interface + defaults, `settingsSliceKey`, `createClient`, `validateAndFetchModels`,
   `extractCredentials`, `buildSessionConfig`, language overrides if restricted
3. Register it in `ProviderConfigFactory`'s static block (behind its feature flag)
4. Add the enum value in `src/types/Provider.ts` and the settings slice + update action in `settingsStore.ts`
5. Add `providers.<id>.name/.description` to locales
The registry invariant test (`descriptorRegistry.test.ts`) fails loudly on anything missed.
```

- [ ] **Step 4: Full verification** — `npm run test -- --run` (all green), `npm run build` (Vite build succeeds), targeted tsc check: `npx tsc --noEmit 2>&1 | grep -E "providers/|ClientFactory|ClientOperations|settingsStore|MainPanel|ProviderSection|LanguageSection" ` — no NEW errors vs the baseline recorded at start.

- [ ] **Step 5: Commit** — `git commit -am "test(providers): registry invariants; docs for the descriptor recipe"`

---

## Self-Review Notes (already applied)

- **Coverage vs design decisions:** ①createClient=Task 2, ②validate=Task 3, ③latestModel=Task 3, ④credentials=Task 5, ⑤sessionConfig=Task 6, ⑥i18n/gating=Tasks 3+9, language rules=Task 8, Settings migration=Task 4, MainPanel=Task 7, dead code=Tasks 3+4+10. All eight fixed decisions have a task.
- **Known intentional behavior changes** (call out in PR description): loud throw instead of silent OpenAI-slice fallback for unknown providers; `getSupportedProviders()` now platform-gated; validation cacheKey format; feature-flag errors surface as `Unsupported provider` from the registry instead of per-provider messages.
- **Out of scope (do not drift into):** settings update-action fan-out (review candidate 2), ProviderSpecificSettings capability-driven rendering (candidate 12), logStore/analytics provider branches, subtitle `PROVIDER_STATE_KEY` (candidate 9's scope).
