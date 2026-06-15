# KizunaAI Frontend: Two Relay-Managed Providers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the realtime `KIZUNA_AI` provider with two relay-managed providers — `KIZUNA_AI_OPENAI_TRANSLATE` and `KIZUNA_AI_VOLCENGINE_AST2` — each the backend-relay twin of `OPENAI_TRANSLATE` / `VOLCENGINE_AST2`, authenticating with the Better Auth session token.

**Architecture:** Each `KIZUNA_AI_*` provider behaves exactly like its base provider except: session-token auth (`requiresAuth`), relay WS endpoint, hidden credential UI. Maximizes reuse — same settings interfaces, same session-config builders, same clients (with relay mode). `ClientFactory.createClient` signature is **unchanged** (the provider enum carries the routing).

**Tech Stack:** React + TypeScript, Zustand, Vitest, i18next.

**Spec:** `docs/superpowers/specs/2026-06-14-kizunaai-frontend-relay-engines-design.md`. **Depends on** backend relay `sokuji-backend#7`. **Branch:** `feat/kizunaai-relay-engines` (already created).

**Build order strategy:** ADD the two new providers first (keeping `KIZUNA_AI`), wire everything, and REMOVE `KIZUNA_AI` last (Task 11). This keeps `tsc` green between tasks; only the final removal touches every remaining reference.

**Typecheck:** `npx tsc --noEmit` (frontend tsconfig is clean). Tests: `npm run test -- <path>`.

---

## File Structure

| Path | Change |
|---|---|
| `src/types/Provider.ts` | add 2 enum values + `ProviderType`; add `isKizunaManagedProvider` / `kizunaBaseProvider`; update `SUPPORTED_PROVIDERS`; (Task 11) remove `KIZUNA_AI` |
| `src/utils/environment.ts` | add `getRelayWsUrl()` |
| `src/services/clients/OpenAITranslateGAClient.ts` | relay mode (`relay?: { wsUrl }`) |
| `src/services/clients/VolcengineAST2Client.ts` | relay mode (`relay?: { wsUrl, sessionToken }`, skip header injection) |
| `src/services/clients/ClientFactory.ts` | 2 new cases (signature unchanged) |
| `src/stores/settingsStore.ts` | 2 new slices + defaults + `getCurrentProviderSettings` + `createSessionConfig` + update actions + persistence; auth generalization; (Task 11) remove `kizunaai` |
| `src/services/providers/KizunaAIOpenAITranslateProviderConfig.ts` (new), `KizunaAIVolcengineAST2ProviderConfig.ts` (new) | relay-managed configs |
| `src/services/providers/ProviderConfigFactory.ts` | register the 2; (Task 11) drop old |
| `src/components/.../ProviderSpecificSettings.tsx`, `LanguageSection.tsx`, `ProviderSection.tsx` | reuse base-provider UI for twins; hide credential inputs |
| `src/components/MainPanel/MainPanel.tsx`, `SettingsInitializer.tsx`, `MainLayout.tsx`, `ClientOperations.ts`, `OnboardingContext.tsx` | convert `KIZUNA_AI` refs per twin principle |
| `src/locales/en/*` | displayName / labels |
| Test files alongside |

---

## Task 1: Provider enum + predicates

**Files:** Modify `src/types/Provider.ts`; Test `src/types/Provider.test.ts` (create).

- [ ] **Step 1: Write the failing test** at `src/types/Provider.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { Provider, isKizunaManagedProvider, kizunaBaseProvider } from "./Provider";

describe("kizuna-managed provider helpers", () => {
  it("identifies the two relay-managed providers", () => {
    expect(isKizunaManagedProvider(Provider.KIZUNA_AI_OPENAI_TRANSLATE)).toBe(true);
    expect(isKizunaManagedProvider(Provider.KIZUNA_AI_VOLCENGINE_AST2)).toBe(true);
    expect(isKizunaManagedProvider(Provider.OPENAI_TRANSLATE)).toBe(false);
  });
  it("maps each to its base provider", () => {
    expect(kizunaBaseProvider(Provider.KIZUNA_AI_OPENAI_TRANSLATE)).toBe(Provider.OPENAI_TRANSLATE);
    expect(kizunaBaseProvider(Provider.KIZUNA_AI_VOLCENGINE_AST2)).toBe(Provider.VOLCENGINE_AST2);
    expect(kizunaBaseProvider(Provider.OPENAI)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm run test -- src/types/Provider.test.ts` → FAIL (members/fns missing).

- [ ] **Step 3: Implement** in `src/types/Provider.ts`

Add to the `Provider` enum (keep `KIZUNA_AI` for now):
```typescript
  KIZUNA_AI_OPENAI_TRANSLATE = 'kizunaai_openai_translate',
  KIZUNA_AI_VOLCENGINE_AST2 = 'kizunaai_volcengine_ast2',
```
Add both to the `ProviderType` union. In `SUPPORTED_PROVIDERS`, replace the `...(isKizunaAIEnabled() ? [Provider.KIZUNA_AI] : [])` entry with:
```typescript
    ...(isKizunaAIEnabled() ? [Provider.KIZUNA_AI_OPENAI_TRANSLATE, Provider.KIZUNA_AI_VOLCENGINE_AST2] : []),
```
Append the helpers at the end of the file:
```typescript
export function isKizunaManagedProvider(p: Provider): boolean {
  return p === Provider.KIZUNA_AI_OPENAI_TRANSLATE || p === Provider.KIZUNA_AI_VOLCENGINE_AST2;
}

/** The user-managed base provider whose behavior/UI a kizuna-managed twin reuses. */
export function kizunaBaseProvider(p: Provider): Provider | undefined {
  if (p === Provider.KIZUNA_AI_OPENAI_TRANSLATE) return Provider.OPENAI_TRANSLATE;
  if (p === Provider.KIZUNA_AI_VOLCENGINE_AST2) return Provider.VOLCENGINE_AST2;
  return undefined;
}
```

- [ ] **Step 4: Run tests + typecheck** — `npm run test -- src/types/Provider.test.ts && npx tsc --noEmit` → PASS (enum switches without all-cases-covered may warn but not error; `KIZUNA_AI` still present so nothing breaks yet).

- [ ] **Step 5: Commit**

```bash
git add src/types/Provider.ts src/types/Provider.test.ts
git commit -m "feat(provider): add two relay-managed KizunaAI providers + predicates"
```

---

## Task 2: `getRelayWsUrl()` env helper

**Files:** Modify `src/utils/environment.ts`; Test `src/utils/environment.test.ts` (create if absent).

- [ ] **Step 1: Failing test** at `src/utils/environment.test.ts`

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { getRelayWsUrl } from "./environment";

afterEach(() => { vi.unstubAllEnvs(); });

describe("getRelayWsUrl", () => {
  it("derives a wss /v1 URL from the default backend", () => {
    vi.stubEnv("VITE_BACKEND_URL", "");
    expect(getRelayWsUrl()).toBe("wss://sokuji.kizuna.ai/v1");
  });
  it("converts http to ws for local dev", () => {
    vi.stubEnv("VITE_BACKEND_URL", "http://localhost:8787");
    expect(getRelayWsUrl()).toBe("ws://localhost:8787/v1");
  });
  it("converts https to wss", () => {
    vi.stubEnv("VITE_BACKEND_URL", "https://example.com");
    expect(getRelayWsUrl()).toBe("wss://example.com/v1");
  });
});
```

- [ ] **Step 2: Run → FAIL** (`getRelayWsUrl` missing).

- [ ] **Step 3: Implement** — add after `getApiUrl` in `src/utils/environment.ts`

```typescript
/** WebSocket base URL for the KizunaAI relay (e.g. wss://sokuji.kizuna.ai/v1).
 *  Callers append `/realtime/translations` or `/ast/translate`. */
export function getRelayWsUrl(): string {
  const base = getBackendUrl().replace(/\/$/, "");
  const ws = base.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  return `${ws}/v1`;
}
```

- [ ] **Step 4: Run → PASS** (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/environment.ts src/utils/environment.test.ts
git commit -m "feat(env): add getRelayWsUrl for KizunaAI relay providers"
```

---

## Task 3: `OpenAITranslateGAClient` relay mode

**Files:** Modify `src/services/clients/OpenAITranslateGAClient.ts`; Test `OpenAITranslateGAClient.test.ts` (extend).

- [ ] **Step 1: Failing test** (add to the existing test file)

```typescript
import { describe, it, expect, vi } from "vitest";
import { OpenAITranslateGAClient } from "./OpenAITranslateGAClient";

describe("OpenAITranslateGAClient relay mode", () => {
  it("connects to the relay URL with a sokuji-auth subprotocol", async () => {
    const captured: { url?: string; protocols?: string[] } = {};
    const FakeWS: any = vi.fn(function (this: any, url: string, protocols: string[]) {
      captured.url = url; captured.protocols = protocols;
      this.readyState = 0; this.send = vi.fn(); this.close = vi.fn(); this.addEventListener = vi.fn();
      setTimeout(() => this.onopen?.(), 0);
    });
    FakeWS.OPEN = 1;
    const orig = globalThis.WebSocket;
    (globalThis as any).WebSocket = FakeWS;
    try {
      const client = new OpenAITranslateGAClient("sess_TOKEN", { wsUrl: "wss://r.example/v1/realtime/translations" });
      client.connect({ provider: "openai_translate", model: "gpt-realtime-translate", targetLanguage: "zh" } as any).catch(() => {});
      await new Promise((r) => setTimeout(r, 5));
      expect(captured.url).toContain("wss://r.example/v1/realtime/translations?model=");
      expect(captured.protocols).toContain("sokuji-auth.sess_TOKEN");
      expect(captured.protocols?.some((p) => p.startsWith("openai-insecure-api-key."))).toBe(false);
    } finally { (globalThis as any).WebSocket = orig; }
  });
});
```

- [ ] **Step 2: Run → FAIL** (constructor takes 1 arg).

- [ ] **Step 3: Implement** — in `OpenAITranslateGAClient.ts`, around line 108

```typescript
  private relay?: { wsUrl: string };

  constructor(apiKey: string, relay?: { wsUrl: string }) {
    this.apiKey = apiKey;
    this.relay = relay;
  }
```
In `connect()` (around line 487), replace the URL + WS construction:
```typescript
    const baseUrl = this.relay?.wsUrl ?? TRANSLATE_WS_URL;
    const url = `${baseUrl}?model=${encodeURIComponent(config.model)}`;
    const authProtocol = this.relay
      ? `sokuji-auth.${this.apiKey}`
      : `openai-insecure-api-key.${this.apiKey}`;
    this.ws = new WebSocket(url, ['realtime', authProtocol]);
```

- [ ] **Step 4: Run → PASS** (existing + relay test).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/OpenAITranslateGAClient.ts src/services/clients/OpenAITranslateGAClient.test.ts
git commit -m "feat(translate-client): add relay mode (relay URL + sokuji-auth subprotocol)"
```

---

## Task 4: `VolcengineAST2Client` relay mode

**Files:** Modify `src/services/clients/VolcengineAST2Client.ts`; Test `VolcengineAST2Client.test.ts` (extend).

Context: relay mode must NOT inject `X-Api-*` headers (relay does it server-side) and must open the WS against the relay URL with a `sokuji-auth.<token>` subprotocol. `connect()` (line 150) branches Electron→`connectViaElectronHeaderInjection`, Extension→`connectViaExtensionDNR`, else→`connectViaBrowserWebSocket`.

- [ ] **Step 1: Failing test** (add to the existing test file)

```typescript
import { describe, it, expect, vi } from "vitest";
import { VolcengineAST2Client } from "./VolcengineAST2Client";

describe("VolcengineAST2Client relay mode", () => {
  it("connects to the relay URL with sokuji-auth and no header injection", async () => {
    const captured: { url?: string; protocols?: any } = {};
    const FakeWS: any = vi.fn(function (this: any, url: string, protocols?: any) {
      captured.url = url; captured.protocols = protocols;
      this.readyState = 0; this.binaryType = ""; this.send = vi.fn(); this.close = vi.fn(); this.addEventListener = vi.fn();
    });
    FakeWS.OPEN = 1;
    const orig = globalThis.WebSocket;
    (globalThis as any).WebSocket = FakeWS;
    try {
      const client = new VolcengineAST2Client("", "", undefined, { wsUrl: "wss://r.example/v1/ast/translate", sessionToken: "sess_TOKEN" });
      client.connect({ provider: "volcengine_ast2", model: "ast-v2-s2s", sourceLanguage: "zh", targetLanguage: "en" } as any).catch(() => {});
      await new Promise((r) => setTimeout(r, 5));
      expect(captured.url).toBe("wss://r.example/v1/ast/translate");
      const protos = Array.isArray(captured.protocols) ? captured.protocols : [captured.protocols];
      expect(protos).toContain("sokuji-auth.sess_TOKEN");
    } finally { (globalThis as any).WebSocket = orig; }
  });
});
```

- [ ] **Step 2: Run → FAIL** (constructor/relay path missing).

- [ ] **Step 3: Implement** — extend constructor (line 134)

```typescript
  private relay?: { wsUrl: string; sessionToken: string };

  constructor(appId: string, accessToken: string, resourceId: string = 'volc.service_type.10053', relay?: { wsUrl: string; sessionToken: string }) {
    this.appId = appId;
    this.accessToken = accessToken;
    this.resourceId = resourceId;
    this.relay = relay;
  }
```
In `connect()` (line 150), short-circuit relay mode before the platform branches:
```typescript
    if (this.relay) {
      return this.connectViaRelay();
    }
```
Read the existing `connectViaBrowserWebSocket` and extract its socket-wiring (onopen/onmessage/onclose, `binaryType`, keepalive, config send) into a private `wireWebSocket()` if not already reusable (pure refactor). Add:
```typescript
  private async connectViaRelay(): Promise<void> {
    this.websocket = new WebSocket(this.relay!.wsUrl, ['sokuji-auth.' + this.relay!.sessionToken]);
    this.websocket.binaryType = 'arraybuffer';
    this.wireWebSocket();
  }
```

- [ ] **Step 4: Run → PASS** (existing + relay test).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/VolcengineAST2Client.ts src/services/clients/VolcengineAST2Client.test.ts
git commit -m "feat(volcengine-client): add relay mode (relay URL + sokuji-auth, no header injection)"
```

---

## Task 5: Two settings slices + session-config cases

**Files:** Modify `src/stores/settingsStore.ts`; Test `src/stores/kizunaProviders.test.ts` (create).

Context: each new provider gets its own slice reusing the EXISTING interface, and `createSessionConfig` calls the EXISTING builders directly (no adapters).

- [ ] **Step 1: Failing test** at `src/stores/kizunaProviders.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { useSettingsStore } from "./settingsStore";
import { Provider } from "../types/Provider";

describe("KizunaAI relay providers — session config", () => {
  it("translate twin builds an openai_translate config from its own slice", () => {
    useSettingsStore.setState({ provider: Provider.KIZUNA_AI_OPENAI_TRANSLATE } as any);
    const cfg: any = useSettingsStore.getState().createSessionConfig("instr");
    expect(cfg.provider).toBe("openai_translate");
    expect(cfg.model).toBe("gpt-realtime-translate");
  });
  it("doubao twin builds a volcengine_ast2 config from its own slice", () => {
    useSettingsStore.setState({ provider: Provider.KIZUNA_AI_VOLCENGINE_AST2 } as any);
    const cfg: any = useSettingsStore.getState().createSessionConfig("instr");
    expect(cfg.provider).toBe("volcengine_ast2");
  });
});
```

- [ ] **Step 2: Run → FAIL** (default case returns openai config).

- [ ] **Step 3: Add the slices + defaults**

Near the existing defaults, add (reusing the existing default objects):
```typescript
const defaultKizunaOpenaiTranslateSettings: OpenAITranslateSettings = { ...defaultOpenAITranslateSettings };
const defaultKizunaVolcengineAst2Settings: VolcengineAST2Settings = { ...defaultVolcengineAST2Settings };
```
Add to the store state interface + initial state:
```typescript
  kizunaOpenaiTranslate: OpenAITranslateSettings;
  kizunaVolcengineAst2: VolcengineAST2Settings;
```
```typescript
    kizunaOpenaiTranslate: defaultKizunaOpenaiTranslateSettings,
    kizunaVolcengineAst2: defaultKizunaVolcengineAst2Settings,
```

- [ ] **Step 4: Wire `getCurrentProviderSettings` + `createSessionConfig`**

In `getCurrentProviderSettings` (settingsStore.ts:1544), add cases:
```typescript
        case Provider.KIZUNA_AI_OPENAI_TRANSLATE:
          return state.kizunaOpenaiTranslate;
        case Provider.KIZUNA_AI_VOLCENGINE_AST2:
          return state.kizunaVolcengineAst2;
```
In `createSessionConfig` (settingsStore.ts:1627), add cases:
```typescript
        case Provider.KIZUNA_AI_OPENAI_TRANSLATE:
          config = createOpenAITranslateSessionConfig(state.kizunaOpenaiTranslate, systemInstructions);
          break;
        case Provider.KIZUNA_AI_VOLCENGINE_AST2:
          config = createVolcengineAST2SessionConfig(state.kizunaVolcengineAst2, systemInstructions);
          break;
```

- [ ] **Step 5: Add update actions + persistence**

Add `updateKizunaOpenaiTranslate` / `updateKizunaVolcengineAst2` actions mirroring `updateOpenAITranslate` / `updateVolcengineAST2` (search those for the exact shape), but skip persisting credential fields (`apiKey`, `appId`, `accessToken`). Register loads in the settings-load section (near settingsStore.ts:1498): `loadProviderSettings('settings.kizunaOpenaiTranslate', defaultKizunaOpenaiTranslateSettings)` and the volcengine one; add the loaded values to the returned state object. Export hooks `useKizunaOpenaiTranslateSettings` / `useKizunaVolcengineAst2Settings` mirroring the existing ones.

- [ ] **Step 6: Run tests + typecheck** — `npm run test -- src/stores/kizunaProviders.test.ts && npx tsc --noEmit` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/stores/settingsStore.ts src/stores/kizunaProviders.test.ts
git commit -m "feat(settings): add kizuna translate/volcengine slices + session configs"
```

---

## Task 6: ClientFactory routing (signature unchanged)

**Files:** Modify `src/services/clients/ClientFactory.ts`; Test `ClientFactory.test.ts` (create).

- [ ] **Step 1: Failing test** at `src/services/clients/ClientFactory.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";
vi.mock("../../utils/environment", async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  getRelayWsUrl: () => "wss://r.example/v1",
}));
import { ClientFactory } from "./ClientFactory";
import { Provider } from "../../types/Provider";
import { OpenAITranslateGAClient } from "./OpenAITranslateGAClient";
import { VolcengineAST2Client } from "./VolcengineAST2Client";

describe("ClientFactory kizuna relay providers", () => {
  it("routes the translate twin to OpenAITranslateGAClient", () => {
    const c = ClientFactory.createClient("gpt-realtime-translate", Provider.KIZUNA_AI_OPENAI_TRANSLATE, "sess_TOKEN");
    expect(c).toBeInstanceOf(OpenAITranslateGAClient);
  });
  it("routes the doubao twin to VolcengineAST2Client", () => {
    const c = ClientFactory.createClient("ast-v2-s2s", Provider.KIZUNA_AI_VOLCENGINE_AST2, "sess_TOKEN");
    expect(c).toBeInstanceOf(VolcengineAST2Client);
  });
});
```

- [ ] **Step 2: Run → FAIL** (no cases).

- [ ] **Step 3: Implement** — in `ClientFactory.ts`, add `getRelayWsUrl` to the environment import, and add two cases (do NOT remove the `KIZUNA_AI` case yet — Task 11):
```typescript
      case Provider.KIZUNA_AI_OPENAI_TRANSLATE:
        if (!isKizunaAIEnabled()) throw new Error(`Provider ${provider} is not available in this build`);
        return new OpenAITranslateGAClient(apiKey, { wsUrl: `${getRelayWsUrl()}/realtime/translations` });

      case Provider.KIZUNA_AI_VOLCENGINE_AST2:
        if (!isKizunaAIEnabled()) throw new Error(`Provider ${provider} is not available in this build`);
        return new VolcengineAST2Client('', '', undefined, { wsUrl: `${getRelayWsUrl()}/ast/translate`, sessionToken: apiKey });
```

- [ ] **Step 4: Run tests + typecheck** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/ClientFactory.ts src/services/clients/ClientFactory.test.ts
git commit -m "feat(client-factory): route kizuna relay providers to relay clients"
```

---

## Task 7: Auth-token sourcing generalization

**Files:** Modify `src/stores/settingsStore.ts`, `src/components/MainPanel/MainPanel.tsx`.

Context: the session-token flow is `KIZUNA_AI`-specific today. Generalize so both new providers fetch the token.

- [ ] **Step 1: settingsStore `validateApiKey`** — at the two `provider === Provider.KIZUNA_AI` checks (settingsStore.ts ~1214 and ~1251), broaden to include the managed providers:
```typescript
import { isKizunaManagedProvider } from "../types/Provider";
// ...
if (provider === Provider.KIZUNA_AI || isKizunaManagedProvider(provider)) { /* ensureKizunaApiKey path */ }
// and:
} else if ((provider === Provider.KIZUNA_AI || isKizunaManagedProvider(provider)) && getAuthToken) {
  apiKey = await getAuthToken() || '';
```

- [ ] **Step 2: MainPanel apiKey sourcing** — in `connectConversation` (MainPanel.tsx ~1437), where `case Provider.KIZUNA_AI:` fetches the fresh token, add the same handling for the two new providers (either add `case Provider.KIZUNA_AI_OPENAI_TRANSLATE:` / `case Provider.KIZUNA_AI_VOLCENGINE_AST2:` falling through to the KizunaAI token logic, or guard with `isKizunaManagedProvider(provider)`).

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` → no errors.

- [ ] **Step 4: Commit**

```bash
git add src/stores/settingsStore.ts src/components/MainPanel/MainPanel.tsx
git commit -m "feat(auth): source session token for kizuna relay providers"
```

---

## Task 8: Provider config classes + registration

**Files:** Create `src/services/providers/KizunaAIOpenAITranslateProviderConfig.ts`, `KizunaAIVolcengineAST2ProviderConfig.ts`; Modify `ProviderConfigFactory.ts`.

- [ ] **Step 1: Create `KizunaAIOpenAITranslateProviderConfig.ts`** — extend the base config, override identity + requiresAuth. Read `OpenAITranslateProviderConfig` to match its `getConfig()` shape.
```typescript
import { OpenAITranslateProviderConfig } from './OpenAITranslateProviderConfig';
import { ProviderConfig } from './ProviderConfig';

export class KizunaAIOpenAITranslateProviderConfig extends OpenAITranslateProviderConfig {
  getConfig(): ProviderConfig {
    const base = super.getConfig();
    return {
      ...base,
      id: 'kizunaai_openai_translate',
      displayName: 'KizunaAI Translate',
      requiresAuth: true,
      apiKeyLabel: 'Kizuna AI Access',
      apiKeyPlaceholder: 'Authentication managed automatically',
    };
  }
}
```

- [ ] **Step 2: Create `KizunaAIVolcengineAST2ProviderConfig.ts`** analogously, extending `VolcengineAST2ProviderConfig`, `id: 'kizunaai_volcengine_ast2'`, `displayName: 'KizunaAI Doubao'`, `requiresAuth: true`. (Read the base config first to confirm the field names it exposes.)

- [ ] **Step 3: Register in `ProviderConfigFactory.ts`** — inside the `isKizunaAIEnabled()` block, register both (keep the old `KIZUNA_AI` registration for now — removed in Task 11):
```typescript
  ProviderConfigFactory.configs.set(Provider.KIZUNA_AI_OPENAI_TRANSLATE, new KizunaAIOpenAITranslateProviderConfig());
  ProviderConfigFactory.configs.set(Provider.KIZUNA_AI_VOLCENGINE_AST2, new KizunaAIVolcengineAST2ProviderConfig());
```

- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/KizunaAIOpenAITranslateProviderConfig.ts src/services/providers/KizunaAIVolcengineAST2ProviderConfig.ts src/services/providers/ProviderConfigFactory.ts
git commit -m "feat(provider-config): add relay-managed kizuna provider configs"
```

---

## Task 9: UI — reuse base-provider rendering, hide credentials

**Files:** Modify `ProviderSpecificSettings.tsx`, `LanguageSection.tsx`, `ProviderSection.tsx`; locales.

- [ ] **Step 1: Render twins like their base.** In `ProviderSpecificSettings.tsx` and `LanguageSection.tsx`, every `provider === Provider.OPENAI_TRANSLATE` condition should also fire for `KIZUNA_AI_OPENAI_TRANSLATE`, and every `VOLCENGINE_AST2` condition for `KIZUNA_AI_VOLCENGINE_AST2`. Use the helper:
```typescript
import { kizunaBaseProvider, isKizunaManagedProvider } from '../../../types/Provider';
const effectiveProvider = kizunaBaseProvider(provider) ?? provider;
// then branch on effectiveProvider for the translate/volcengine sections,
// but read/write the kizuna slice when isKizunaManagedProvider(provider).
```
Wire the controls to the correct slice: when `isKizunaManagedProvider(provider)`, read `kizunaOpenaiTranslate`/`kizunaVolcengineAst2` and call `updateKizunaOpenaiTranslate`/`updateKizunaVolcengineAst2`; otherwise the existing user-managed slices. (Read the current section code to thread this cleanly.)

- [ ] **Step 2: Hide credential inputs** for managed providers — where the apiKey / appId / accessToken inputs render, wrap with `{!isKizunaManagedProvider(provider) && ( ... )}`.

- [ ] **Step 3: i18n** — add `displayName` strings if the dropdown pulls labels from locales; add to `src/locales/en/` and let i18next fall back for other locales (note as follow-up). Confirm the provider dropdown in `ProviderSection.tsx` shows the two new entries with sensible labels/icons.

- [ ] **Step 4: Typecheck + manual UI check** — `npx tsc --noEmit`, then `npm run dev`: select each KizunaAI provider, confirm language/translation controls show and NO credential input shows.

- [ ] **Step 5: Commit**

```bash
git add src/components/ src/locales/
git commit -m "feat(ui): render kizuna relay providers via base-provider controls; hide credentials"
```

---

## Task 10: Migration (stored `'kizunaai'` → translate twin)

**Files:** Modify the settings load path (`settingsStore.ts` load and/or `SettingsInitializer.tsx`).

- [ ] **Step 1: Failing test** — add to `src/stores/kizunaProviders.test.ts`:
```typescript
import { migrateLegacyKizunaProvider } from "./settingsStore";
it("migrates a legacy 'kizunaai' provider to the translate twin", () => {
  expect(migrateLegacyKizunaProvider("kizunaai" as any)).toBe(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
  expect(migrateLegacyKizunaProvider(Provider.OPENAI)).toBe(Provider.OPENAI);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — export a small migrator in `settingsStore.ts`:
```typescript
export function migrateLegacyKizunaProvider(p: Provider | string): Provider {
  return (p as string) === 'kizunaai' ? Provider.KIZUNA_AI_OPENAI_TRANSLATE : (p as Provider);
}
```
Apply it where the persisted `provider` is loaded (settings load): `provider: migrateLegacyKizunaProvider(loadedProvider)`. If the old `settings.kizunaai` slice has `sourceLanguage`/`targetLanguage`, copy them into `kizunaOpenaiTranslate` during load (best-effort; ignore realtime-only fields).

- [ ] **Step 4: Run → PASS; typecheck.**

- [ ] **Step 5: Commit**

```bash
git add src/stores/settingsStore.ts src/stores/kizunaProviders.test.ts src/components/SettingsInitializer/SettingsInitializer.tsx
git commit -m "feat(settings): migrate legacy kizunaai provider to translate twin"
```

---

## Task 11: Remove the realtime `KIZUNA_AI` path + final verification

**Files:** `Provider.ts`, `settingsStore.ts`, `ClientFactory.ts`, `ProviderConfigFactory.ts`, `KizunaAIProviderConfig.ts` (delete), and any remaining references.

- [ ] **Step 1: Find all remaining references**

Run:
```bash
grep -rnE "Provider\.KIZUNA_AI\b|KIZUNA_AI =|kizunaai:|KizunaAISettings|defaultKizunaAISettings|gpt-realtime-mini|new OpenAIClient\(apiKey, getApiUrl" src --include='*.ts' --include='*.tsx' | grep -v "KIZUNA_AI_"
```

- [ ] **Step 2: Remove them.** Delete from `Provider.ts`: the `KIZUNA_AI` enum member, its `ProviderType` union entry, and any `OPENAI_COMPATIBLE_PROVIDERS` entry. Delete from `settingsStore.ts`: the `kizunaai` slice/state/default, `KizunaAISettings`, `defaultKizunaAISettings`, the `KIZUNA_AI` cases in `getCurrentProviderSettings`/`createSessionConfig`, the `updateKizunaAI` action, and the now-redundant `provider === Provider.KIZUNA_AI ||` halves of the Task-7 conditions (keep only `isKizunaManagedProvider`). Delete the `KIZUNA_AI` case in `ClientFactory.ts` and its `KizunaAIProviderConfig` registration; delete `src/services/providers/KizunaAIProviderConfig.ts`. Convert remaining mechanical refs in `MainPanel.tsx`, `ClientOperations.ts`, `SettingsInitializer.tsx`, `MainLayout.tsx`, `OnboardingContext.tsx`, `vite-env.d.ts` (each becomes `isKizunaManagedProvider(...)` or the two providers).

- [ ] **Step 2b: Generalize behavior-critical KIZUNA_AI sites (not just removal).** Two sites need the two new providers handled, found during Task 7:
  - `settingsStore.ts` `getTurnDetectionMode` (`case Provider.KIZUNA_AI: return state.kizunaai.turnDetectionMode;`) → add `case Provider.KIZUNA_AI_VOLCENGINE_AST2: return state.kizunaVolcengineAst2.turnDetectionMode;` (the translate twin has no turn-detection; return whatever `OPENAI_TRANSLATE` returns there, or its default).
  - `MainPanel.tsx` no-interruption gate (the `provider === ... || provider === Provider.KIZUNA_AI` condition around line 2089 that prevents user audio from interrupting AI output) → include both new providers via `isKizunaManagedProvider(provider)`. **Critical:** missing this lets the new providers be interrupted, violating the project's no-interruption rule.

- [ ] **Step 3: Confirm KizunaAI is WS-only** — ensure neither new provider can select WebRTC (`transportType: 'websocket'`); the relay is WS-only. Check `MainPanel.createAIClient`'s `useWebRTC`/`effectiveTransportType` is never webrtc for these providers.

- [ ] **Step 4: Full suite + typecheck**

Run: `npm run test && npx tsc --noEmit`
Expected: all green, no `Provider.KIZUNA_AI` references remain (re-run the Step-1 grep → empty).

- [ ] **Step 5: Manual end-to-end smoke** (backend relay running + signed in): select KizunaAI Translate, run a translation; select KizunaAI Doubao, run one. Confirm audio flows and `event_type='use'` rows appear in the backend `wallet_ledger`. Record the result.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(kizuna): remove realtime KIZUNA_AI provider; relay providers only"
```

---

## Self-Review Notes (for the executor)

- **Type-guard alignment:** the twin session config carries `provider: 'openai_translate'` / `'volcengine_ast2'` (the existing builders set these), matching the relay clients' guards.
- **Reuse over derivation:** there are NO adapter functions — each twin uses its own slice + the existing builder directly (this is why two providers is simpler than the earlier sub-engine design).
- **Credentials:** relay-mode clients ignore provider keys; the session token rides `sokuji-auth.<token>`.
- **WebRTC excluded** (relay is WS-only) — enforced in Task 11.
- **User-managed providers untouched** (relay mode only entered when the `relay` constructor arg is set).
- **Build order:** `KIZUNA_AI` stays until Task 11 so `tsc` is green between tasks; Task 11 is the single breaking-then-fixing removal.
- **Follow-up:** non-en i18n strings may be added incrementally (en fallback covers them).
