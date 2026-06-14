# KizunaAI Frontend Relay Engines — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-point the KizunaAI provider off the OpenAI Realtime proxy onto the two backend relay engines (OpenAI Translate + Volcengine AST 2.0), selectable via a `kizunaEngine` sub-setting, authenticating with the Better Auth session token.

**Architecture:** Keep the single `KIZUNA_AI` provider. Add a `kizunaEngine: 'translate' | 'doubao'` setting. The existing `OpenAITranslateGAClient` and `VolcengineAST2Client` gain a "relay mode" (configurable WS URL + `sokuji-auth.<token>` subprotocol + Volcengine skips header injection). `ClientFactory` routes `KIZUNA_AI` to the right relay client by engine; `createSessionConfig` derives the engine's session config from the existing `kizunaai` settings fields.

**Tech Stack:** React + TypeScript, Zustand, Vitest, i18next.

**Spec:** `docs/superpowers/specs/2026-06-14-kizunaai-frontend-relay-engines-design.md`. **Depends on** backend relay `sokuji-backend#7`.

**Branch:** create `feat/kizunaai-relay-engines` before Task 1.

**Typecheck note:** run `npx tsc --noEmit` (frontend tsconfig is clean today). Tests: `npm run test -- <path>`.

---

## File Structure

| Path | Change |
|---|---|
| `src/utils/environment.ts` | add `getRelayWsUrl()` (http→ws + `/v1`) |
| `src/stores/settingsStore.ts` | add `kizunaEngine` to `KizunaAISettings` + default + persistence; add `createKizunaTranslateSessionConfig`/`createKizunaDoubaoSessionConfig`; rewrite the `KIZUNA_AI` branch of `createSessionConfig` |
| `src/services/clients/OpenAITranslateGAClient.ts` | optional `relay?: { wsUrl }` constructor arg → relay URL + `sokuji-auth.<token>` subprotocol |
| `src/services/clients/VolcengineAST2Client.ts` | optional `relay?: { wsUrl, sessionToken }` → skip header injection, relay URL + subprotocol |
| `src/services/clients/ClientFactory.ts` | `createClient` gains `kizunaEngine?` param; rewrite `KIZUNA_AI` case to route to relay clients |
| `src/components/MainPanel/MainPanel.tsx` | thread `kizunaAISettings.kizunaEngine` into `createAIClient`→`createClient` |
| `src/services/providers/KizunaAIProviderConfig.ts` | drop `gpt-realtime-*` realtime models; reflect the two engines |
| `src/components/Settings/sections/ProviderSpecificSettings.tsx` | KizunaAI engine selector + conditional translate/doubao controls |
| `src/locales/*` (en + others) | i18n labels for the engine selector |
| Test files alongside the above |

**Resolved design decisions:**
- `kizunaEngine` threads through the single `createClient` caller (`MainPanel.createAIClient`).
- KizunaAI engine session config is **derived** from existing `kizunaai` fields — no new nested settings. The derived config carries `provider: 'openai_translate'` or `'volcengine_ast2'` so the relay client's existing type guard passes.
- Relay clients reuse all message/audio logic; only transport endpoint + auth change.

---

## Task 1: `getRelayWsUrl()` env helper

**Files:**
- Modify: `src/utils/environment.ts`
- Test: `src/utils/environment.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** at `src/utils/environment.test.ts`

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { getRelayWsUrl } from "./environment";

afterEach(() => { vi.unstubAllEnvs(); });

describe("getRelayWsUrl", () => {
  it("derives a wss /v1 URL from the default backend", () => {
    vi.stubEnv("VITE_BACKEND_URL", "");
    expect(getRelayWsUrl()).toBe("wss://sokuji.kizuna.ai/v1");
  });
  it("converts http backend to ws for local dev", () => {
    vi.stubEnv("VITE_BACKEND_URL", "http://localhost:8787");
    expect(getRelayWsUrl()).toBe("ws://localhost:8787/v1");
  });
  it("converts https backend to wss", () => {
    vi.stubEnv("VITE_BACKEND_URL", "https://example.com");
    expect(getRelayWsUrl()).toBe("wss://example.com/v1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- src/utils/environment.test.ts`
Expected: FAIL (`getRelayWsUrl` is not a function).

- [ ] **Step 3: Implement** — add to `src/utils/environment.ts` (after `getApiUrl`)

```typescript
/**
 * The WebSocket base URL for the KizunaAI relay engines, e.g.
 * wss://sokuji.kizuna.ai/v1 . Callers append `/realtime/translations`
 * or `/ast/translate`.
 */
export function getRelayWsUrl(): string {
  const base = getBackendUrl().replace(/\/$/, "");
  const ws = base.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  return `${ws}/v1`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- src/utils/environment.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/environment.ts src/utils/environment.test.ts
git commit -m "feat(env): add getRelayWsUrl for KizunaAI relay engines"
```

---

## Task 2: `kizunaEngine` setting

**Files:**
- Modify: `src/stores/settingsStore.ts`

- [ ] **Step 1: Add the field to `KizunaAISettings`** — replace the alias (settingsStore.ts:80)

```typescript
export type KizunaEngine = 'translate' | 'doubao';
export interface KizunaAISettings extends OpenAICompatibleSettingsBase {
  kizunaEngine: KizunaEngine;
}
```

- [ ] **Step 2: Add the default** — in `defaultKizunaAISettings` (settingsStore.ts:274)

```typescript
const defaultKizunaAISettings: KizunaAISettings = {
  ...defaultOpenAICompatibleSettingsBase,
  transcriptModel: 'whisper-1',
  kizunaEngine: 'translate',
};
```

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit`
Expected: passes (the new field is persisted generically by `updateKizunaAI`'s `Object.entries` loop, and loaded by `loadProviderSettings('settings.kizunaai', defaultKizunaAISettings)` — no extra wiring needed).

- [ ] **Step 4: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat(settings): add kizunaEngine selector to KizunaAI settings"
```

---

## Task 3: KizunaAI engine session-config builders

**Files:**
- Modify: `src/stores/settingsStore.ts`
- Test: `src/stores/kizunaSessionConfig.test.ts` (create)

Context: the relay clients require a config whose `provider` is `'openai_translate'` / `'volcengine_ast2'` (their type guards). We derive those from the `kizunaai` fields. The existing builders `createOpenAITranslateSessionConfig` (settingsStore.ts:523) and `createVolcengineAST2SessionConfig` (settingsStore.ts:599) take the user-managed settings shapes; we add thin KizunaAI adapters that map `kizunaai` → those shapes, then reuse the builders.

- [ ] **Step 1: Write the failing test** at `src/stores/kizunaSessionConfig.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { createKizunaTranslateSessionConfig, createKizunaDoubaoSessionConfig } from "./settingsStore";
import { defaultKizunaAISettings } from "./settingsStore";

describe("KizunaAI engine session configs", () => {
  it("translate engine produces an openai_translate config from kizuna fields", () => {
    const s = { ...defaultKizunaAISettings, sourceLanguage: "en", targetLanguage: "zh", noiseReduction: "Near field" as const };
    const cfg: any = createKizunaTranslateSessionConfig(s, "instr");
    expect(cfg.provider).toBe("openai_translate");
    expect(cfg.model).toBe("gpt-realtime-translate");
    expect(cfg.targetLanguage).toBe("zh");
    expect(cfg.inputAudioNoiseReduction).toEqual({ type: "near_field" });
  });

  it("doubao engine produces a volcengine_ast2 config from kizuna fields", () => {
    const s = { ...defaultKizunaAISettings, sourceLanguage: "zh", targetLanguage: "en", turnDetectionMode: "Auto" as const };
    const cfg: any = createKizunaDoubaoSessionConfig(s, "instr");
    expect(cfg.provider).toBe("volcengine_ast2");
    expect(cfg.sourceLanguage).toBe("zh");
    expect(cfg.targetLanguage).toBe("en");
    expect(cfg.turnDetectionMode).toBe("Auto");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- src/stores/kizunaSessionConfig.test.ts`
Expected: FAIL (functions not exported). Also export `defaultKizunaAISettings` if not already exported — add `export` to its declaration (settingsStore.ts:274).

- [ ] **Step 3: Implement the two adapters** — add to `src/stores/settingsStore.ts` after `createVolcengineAST2SessionConfig` (settingsStore.ts:618). Reuse the existing builders.

```typescript
/** KizunaAI Translate engine: derive an OpenAI-Translate session config from
 *  the kizunaai settings (credentials live server-side at the relay). */
export function createKizunaTranslateSessionConfig(
  k: KizunaAISettings,
  systemInstructions: string
): OpenAITranslateSessionConfig {
  return createOpenAITranslateSessionConfig(
    {
      apiKey: '', // unused: relay holds the OpenAI key
      sourceLanguage: k.sourceLanguage,
      targetLanguage: k.targetLanguage as TranslateTargetLanguage,
      transcriptModel: 'gpt-realtime-whisper',
      noiseReduction: k.noiseReduction,
      transportType: 'websocket',
      userSilenceDuration: k.silenceDuration ?? 1.0,
      assistantSilenceDuration: k.silenceDuration ?? 0.5,
    },
    systemInstructions
  );
}

/** KizunaAI Doubao engine: derive a Volcengine AST2 session config from the
 *  kizunaai settings (credentials live server-side at the relay). */
export function createKizunaDoubaoSessionConfig(
  k: KizunaAISettings,
  systemInstructions: string
): VolcengineAST2SessionConfig {
  return createVolcengineAST2SessionConfig(
    {
      appId: '', // unused: relay holds the Volcengine creds
      accessToken: '',
      sourceLanguage: k.sourceLanguage,
      targetLanguage: k.targetLanguage,
      turnDetectionMode: k.turnDetectionMode as VolcengineAST2Settings['turnDetectionMode'],
      hotWordTableId: '',
      replacementTableId: '',
      glossaryTableId: '',
    },
    systemInstructions
  );
}
```
Note: confirm `OpenAICompatibleSettingsBase` has `silenceDuration` and `noiseReduction` fields (it does per settingsStore.ts:52–72). If `noiseReduction`'s type differs from `OpenAITranslateSettings.noiseReduction`, cast at the call site.

- [ ] **Step 4: Wire into `createSessionConfig`** — replace the `KIZUNA_AI` branch (settingsStore.ts:1643)

```typescript
        case Provider.KIZUNA_AI:
          config = state.kizunaai.kizunaEngine === 'doubao'
            ? createKizunaDoubaoSessionConfig(state.kizunaai, systemInstructions)
            : createKizunaTranslateSessionConfig(state.kizunaai, systemInstructions);
          break;
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test -- src/stores/kizunaSessionConfig.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/stores/settingsStore.ts src/stores/kizunaSessionConfig.test.ts
git commit -m "feat(settings): derive KizunaAI translate/doubao session configs by engine"
```

---

## Task 4: `OpenAITranslateGAClient` relay mode

**Files:**
- Modify: `src/services/clients/OpenAITranslateGAClient.ts`
- Test: `src/services/clients/OpenAITranslateGAClient.test.ts` (extend)

- [ ] **Step 1: Write the failing test** (add to the existing test file)

```typescript
import { describe, it, expect, vi } from "vitest";
import { OpenAITranslateGAClient } from "./OpenAITranslateGAClient";

describe("OpenAITranslateGAClient relay mode", () => {
  it("connects to the relay URL with a sokuji-auth subprotocol", async () => {
    const captured: { url?: string; protocols?: string[] } = {};
    const FakeWS: any = vi.fn(function (this: any, url: string, protocols: string[]) {
      captured.url = url; captured.protocols = protocols;
      this.readyState = 0; this.send = vi.fn(); this.close = vi.fn();
      this.addEventListener = vi.fn();
      setTimeout(() => this.onopen?.(), 0);
    });
    FakeWS.OPEN = 1;
    const orig = globalThis.WebSocket;
    (globalThis as any).WebSocket = FakeWS;
    try {
      const client = new OpenAITranslateGAClient("sess_TOKEN", { wsUrl: "wss://r.example/v1/realtime/translations" });
      // connect() will hang on waitForSessionCreated; only assert URL+protocol synchronously
      client.connect({ provider: "openai_translate", model: "gpt-realtime-translate", targetLanguage: "zh" } as any).catch(() => {});
      await new Promise((r) => setTimeout(r, 5));
      expect(captured.url).toContain("wss://r.example/v1/realtime/translations?model=");
      expect(captured.protocols).toContain("sokuji-auth.sess_TOKEN");
      expect(captured.protocols?.some((p) => p.startsWith("openai-insecure-api-key."))).toBe(false);
    } finally {
      (globalThis as any).WebSocket = orig;
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- src/services/clients/OpenAITranslateGAClient.test.ts`
Expected: FAIL (constructor takes 1 arg; URL/protocol assertions fail).

- [ ] **Step 3: Implement relay mode**

In `OpenAITranslateGAClient.ts`, add a private field and extend the constructor (around line 108):
```typescript
  private relay?: { wsUrl: string };

  constructor(apiKey: string, relay?: { wsUrl: string }) {
    this.apiKey = apiKey;
    this.relay = relay;
  }
```
In `connect()` (around line 487), replace the URL + WebSocket construction:
```typescript
    const baseUrl = this.relay?.wsUrl ?? TRANSLATE_WS_URL;
    const url = `${baseUrl}?model=${encodeURIComponent(config.model)}`;
    // Relay mode authenticates with the Better Auth session token; direct mode
    // uses the user's OpenAI key. Both ride the Sec-WebSocket-Protocol header.
    const authProtocol = this.relay
      ? `sokuji-auth.${this.apiKey}`
      : `openai-insecure-api-key.${this.apiKey}`;
    this.ws = new WebSocket(url, ['realtime', authProtocol]);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- src/services/clients/OpenAITranslateGAClient.test.ts`
Expected: PASS (existing tests + the new relay test).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/OpenAITranslateGAClient.ts src/services/clients/OpenAITranslateGAClient.test.ts
git commit -m "feat(translate-client): add relay mode (relay URL + sokuji-auth subprotocol)"
```

---

## Task 5: `VolcengineAST2Client` relay mode

**Files:**
- Modify: `src/services/clients/VolcengineAST2Client.ts`
- Test: `src/services/clients/VolcengineAST2Client.test.ts` (extend)

Context: in relay mode the client must NOT inject `X-Api-*` headers (the relay does that server-side) and must open the WS against the relay URL with a `sokuji-auth.<token>` subprotocol. The `connect()` dispatcher (VolcengineAST2Client.ts:150) currently branches Electron→`connectViaElectronHeaderInjection`, Extension→`connectViaExtensionDNR`, else→`connectViaBrowserWebSocket`. Relay mode short-circuits to a relay browser-WS path.

- [ ] **Step 1: Write the failing test** (add to the existing test file)

```typescript
import { describe, it, expect, vi } from "vitest";
import { VolcengineAST2Client } from "./VolcengineAST2Client";

describe("VolcengineAST2Client relay mode", () => {
  it("connects to the relay URL with sokuji-auth and no header injection", async () => {
    const captured: { url?: string; protocols?: any } = {};
    const FakeWS: any = vi.fn(function (this: any, url: string, protocols?: any) {
      captured.url = url; captured.protocols = protocols;
      this.readyState = 0; this.binaryType = ""; this.send = vi.fn(); this.close = vi.fn();
      this.addEventListener = vi.fn();
    });
    FakeWS.OPEN = 1;
    const orig = globalThis.WebSocket;
    (globalThis as any).WebSocket = FakeWS;
    try {
      const client = new VolcengineAST2Client("", "", undefined, {
        wsUrl: "wss://r.example/v1/ast/translate", sessionToken: "sess_TOKEN",
      });
      client.connect({ provider: "volcengine_ast2", model: "ast-v2-s2s", sourceLanguage: "zh", targetLanguage: "en" } as any).catch(() => {});
      await new Promise((r) => setTimeout(r, 5));
      expect(captured.url).toBe("wss://r.example/v1/ast/translate");
      // subprotocol carries the session token
      const protos = Array.isArray(captured.protocols) ? captured.protocols : [captured.protocols];
      expect(protos).toContain("sokuji-auth.sess_TOKEN");
    } finally {
      (globalThis as any).WebSocket = orig;
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- src/services/clients/VolcengineAST2Client.test.ts`
Expected: FAIL (constructor signature + relay path missing).

- [ ] **Step 3: Implement relay mode**

Extend the constructor (VolcengineAST2Client.ts:134):
```typescript
  private relay?: { wsUrl: string; sessionToken: string };

  constructor(
    appId: string,
    accessToken: string,
    resourceId: string = 'volc.service_type.10053',
    relay?: { wsUrl: string; sessionToken: string }
  ) {
    this.appId = appId;
    this.accessToken = accessToken;
    this.resourceId = resourceId;
    this.relay = relay;
  }
```
In `connect()` (VolcengineAST2Client.ts:150), short-circuit relay mode BEFORE the platform branches:
```typescript
    this.currentConfig = config;
    this.keepReplayAudio = config.keepReplayAudio ?? false;
    // ...existing state reset...
    if (this.relay) {
      return this.connectViaRelay();
    }
    if (isElectron() && window.electron?.invoke) {
      return this.connectViaElectronHeaderInjection();
    }
    // ...unchanged...
```
Add `connectViaRelay` next to the other connect helpers. It mirrors `connectViaBrowserWebSocket` but uses the relay URL + `sokuji-auth` subprotocol and sets no auth headers. Read the existing `connectViaBrowserWebSocket` (search the file) and copy its socket-wiring (onopen/onmessage/onclose/binaryType, keepalive, config send), changing only:
- the WebSocket construction to: `new WebSocket(this.relay!.wsUrl, ['sokuji-auth.' + this.relay!.sessionToken])`
- skip any header-registration calls.

```typescript
  private async connectViaRelay(): Promise<void> {
    // Relay handles X-Api-* auth server-side; we authenticate via the subprotocol.
    this.websocket = new WebSocket(this.relay!.wsUrl, ['sokuji-auth.' + this.relay!.sessionToken]);
    this.websocket.binaryType = 'arraybuffer';
    this.wireWebSocket(); // reuse the existing onopen/onmessage/onclose/keepalive setup
  }
```
If `connectViaBrowserWebSocket` inlines its socket-wiring rather than exposing a reusable `wireWebSocket()`, extract that wiring into a private `wireWebSocket()` method first (pure refactor, no behavior change) and call it from both paths.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- src/services/clients/VolcengineAST2Client.test.ts`
Expected: PASS (existing + relay test). If the existing tests touched header injection, ensure they still pass (relay path is only taken when `relay` is set).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/VolcengineAST2Client.ts src/services/clients/VolcengineAST2Client.test.ts
git commit -m "feat(volcengine-client): add relay mode (relay URL + sokuji-auth, no header injection)"
```

---

## Task 6: ClientFactory routing + MainPanel threading

**Files:**
- Modify: `src/services/clients/ClientFactory.ts`
- Modify: `src/components/MainPanel/MainPanel.tsx`
- Test: `src/services/clients/ClientFactory.test.ts` (create or extend)

- [ ] **Step 1: Write the failing test** at `src/services/clients/ClientFactory.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/environment", async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  getRelayWsUrl: () => "wss://r.example/v1",
}));

import { ClientFactory } from "./ClientFactory";
import { Provider } from "../../types/Provider";
import { OpenAITranslateGAClient } from "./OpenAITranslateGAClient";
import { VolcengineAST2Client } from "./VolcengineAST2Client";

describe("ClientFactory KizunaAI engine routing", () => {
  it("routes translate engine to OpenAITranslateGAClient", () => {
    const c = ClientFactory.createClient("gpt-realtime-translate", Provider.KIZUNA_AI, "sess_TOKEN", undefined, undefined, "websocket", undefined, "translate");
    expect(c).toBeInstanceOf(OpenAITranslateGAClient);
  });
  it("routes doubao engine to VolcengineAST2Client", () => {
    const c = ClientFactory.createClient("ast-v2-s2s", Provider.KIZUNA_AI, "sess_TOKEN", undefined, undefined, "websocket", undefined, "doubao");
    expect(c).toBeInstanceOf(VolcengineAST2Client);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- src/services/clients/ClientFactory.test.ts`
Expected: FAIL (8th param not accepted; KIZUNA_AI still returns OpenAIClient).

- [ ] **Step 3: Add the param + relay imports to `ClientFactory.ts`**

Add imports at top:
```typescript
import { getApiUrl, getRelayWsUrl, isKizunaAIEnabled, isVolcengineSTEnabled, isVolcengineAST2Enabled } from '../../utils/environment';
import type { KizunaEngine } from '../../stores/settingsStore';
```
Extend the signature (ClientFactory.ts:40):
```typescript
  static createClient(
    model: string,
    provider: ProviderType,
    apiKey: string,
    clientSecret?: string,
    customEndpoint?: string,
    transportType?: TransportType,
    webrtcOptions?: WebRTCClientOptions,
    kizunaEngine?: KizunaEngine
  ): IClient {
```
Replace the `KIZUNA_AI` case (ClientFactory.ts:111):
```typescript
      case Provider.KIZUNA_AI:
        if (!isKizunaAIEnabled()) {
          throw new Error(`Provider ${provider} is not available in this build`);
        }
        // apiKey is the Better Auth session token. The relay holds the real
        // provider credentials; we connect WS-only with a sokuji-auth subprotocol.
        if (kizunaEngine === 'doubao') {
          return new VolcengineAST2Client('', '', undefined, {
            wsUrl: `${getRelayWsUrl()}/ast/translate`,
            sessionToken: apiKey,
          });
        }
        return new OpenAITranslateGAClient(apiKey, {
          wsUrl: `${getRelayWsUrl()}/realtime/translations`,
        });
```
Remove the now-unused `OpenAIClient` import only if no other case uses it (the `OPENAI_COMPATIBLE` case still uses `OpenAIClient` — keep the import).

- [ ] **Step 4: Thread the engine in `MainPanel.tsx`** (createAIClient, line 532)

Add to the `createAIClient` body before the return:
```typescript
    const kizunaEngine = provider === Provider.KIZUNA_AI ? kizunaAISettings.kizunaEngine : undefined;
```
and pass it as the 8th arg to `ClientFactory.createClient(...)`. Add `kizunaAISettings.kizunaEngine` to the `useCallback` dependency array.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test -- src/services/clients/ClientFactory.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/clients/ClientFactory.ts src/components/MainPanel/MainPanel.tsx src/services/clients/ClientFactory.test.ts
git commit -m "feat(client-factory): route KizunaAI to relay engines by kizunaEngine"
```

---

## Task 7: KizunaAIProviderConfig — reflect engines, drop realtime models

**Files:**
- Modify: `src/services/providers/KizunaAIProviderConfig.ts`

Context: it currently extends `OpenAIProviderConfig` and exposes realtime models (filtered `gpt-realtime-2`), default model `gpt-realtime-mini`. With engines, the model is implied by the engine, so the realtime model list is dead.

- [ ] **Step 1: Update the config** — set the default model to the translate model, drop the realtime model list, and keep `requiresAuth: true`.

Read the current file, then change `models` to the two engine-implied models and `defaults.model` to `'gpt-realtime-translate'`:
```typescript
      models: [
        { id: 'gpt-realtime-translate', name: 'KizunaAI Translate' },
        { id: 'ast-v2-s2s', name: 'KizunaAI Doubao' },
      ],
      defaults: {
        ...baseConfig.defaults,
        model: 'gpt-realtime-translate',
      },
```
Keep `requiresAuth: true`, `id: 'kizunaai'`, `displayName`, `apiKeyLabel`/placeholder. Remove the `gpt-realtime-mini` / realtime-specific defaults (threshold/prefixPadding/silenceDuration overrides may stay; they're harmless and reused by the derived translate config's silence mapping).

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/services/providers/KizunaAIProviderConfig.ts
git commit -m "feat(kizuna-config): reflect translate/doubao engines, drop realtime models"
```

---

## Task 8: UI — KizunaAI engine selector

**Files:**
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx`
- Modify: i18n locale files (`src/locales/en/*` at minimum)

Context: `ProviderSpecificSettings.tsx` renders provider sections via `provider === Provider.KIZUNA_AI` blocks (lines 354, 387, 400, …). Add an engine selector and make the KizunaAI sub-controls follow it (Translate vs Doubao). Reuse the existing translate/volcengine control markup as the pattern.

- [ ] **Step 1: Add the engine selector control** in the `Provider.KIZUNA_AI` render branch (around line 354). Use the existing select/dropdown component pattern already used for, e.g., `turnDetectionMode`. Bind it to `kizunaAISettings.kizunaEngine` via `updateKizunaAI({ kizunaEngine: value })`.

```tsx
{provider === Provider.KIZUNA_AI && (
  <div className="setting-row">
    <label>{t('settings.kizunaEngine.label')}</label>
    <select
      value={kizunaAISettings.kizunaEngine}
      onChange={(e) => updateKizunaAI({ kizunaEngine: e.target.value as KizunaEngine })}
    >
      <option value="translate">{t('settings.kizunaEngine.translate')}</option>
      <option value="doubao">{t('settings.kizunaEngine.doubao')}</option>
    </select>
  </div>
)}
```
Import `KizunaEngine` from the store. Read the file to match the actual control/className conventions and the `updateKizunaAI`/`useKizunaAISettings` hooks already in use.

- [ ] **Step 2: Gate engine-specific controls.** Where KizunaAI currently shows realtime controls (voice/model/temperature), restrict them: for `kizunaEngine === 'translate'` show the translate-relevant controls (target language, noise reduction, silence), for `'doubao'` show source/target language + turn detection. The shared language controls already exist; conditionally render the engine-specific extras using `kizunaAISettings.kizunaEngine`.

- [ ] **Step 3: Add i18n keys** to `src/locales/en/` (the settings namespace):
```
"settings.kizunaEngine.label": "Engine",
"settings.kizunaEngine.translate": "Translate (OpenAI)",
"settings.kizunaEngine.doubao": "Doubao (Volcengine)"
```
Add the same keys to other locale files with English fallback (i18next already falls back to en, so non-en files can be added incrementally — note which were left for follow-up).

- [ ] **Step 4: Typecheck + manual UI check**

Run: `npx tsc --noEmit`
Then `npm run dev`, open settings with KizunaAI selected, confirm the engine dropdown appears and toggles the sub-controls. (No automated UI test required for this task.)

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/ProviderSpecificSettings.tsx src/locales/
git commit -m "feat(ui): add KizunaAI engine selector (translate/doubao)"
```

---

## Task 9: Remove dead realtime KizunaAI bits + full verification

**Files:**
- Modify: any remaining references to the old realtime KizunaAI path

- [ ] **Step 1: Search for dead references**

Run:
```bash
grep -rnE "gpt-realtime-mini|OpenAIClient\(apiKey, getApiUrl" src --include='*.ts' --include='*.tsx'
```
Resolve any remaining KizunaAI→realtime assumptions (e.g. transportType webrtc handling specific to KizunaAI in `updateKizunaAI` at settingsStore.ts:1072 — KizunaAI is WS-only now, so the webrtc-forcing branch is dead for KizunaAI; leave generic behavior intact but confirm it can't force KizunaAI into webrtc).

- [ ] **Step 2: Confirm KizunaAI never selects WebRTC.** In `MainPanel.createAIClient`, KizunaAI must pass `transportType: 'websocket'`. Verify the `useWebRTC` flag is never true for KizunaAI (the relay is WS-only). If a transport toggle is exposed for KizunaAI, hide/force it to websocket.

- [ ] **Step 3: Full suite + typecheck**

Run: `npm run test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 4: Manual end-to-end smoke (requires backend relay running + signed in)**

Sign in, select KizunaAI → Translate engine, run a translation, confirm audio flows and a session completes. Switch to Doubao engine, repeat. Confirm in the backend `wallet_ledger` that `event_type='use'` rows appear (validates the full FE→relay→meter loop). Record the result.

- [ ] **Step 5: Commit any cleanup**

```bash
git add -A
git commit -m "chore(kizuna): remove dead realtime path; verify WS-only relay engines"
```

---

## Self-Review Notes (for the executor)

- **Type-guard alignment:** the KizunaAI session config MUST carry `provider: 'openai_translate'` (translate) or `'volcengine_ast2'` (doubao) so the relay client's `isOpenAITranslateSessionConfig` / `isVolcengineAST2SessionConfig` guard passes. The Task 3 adapters guarantee this by reusing the existing builders.
- **Credentials:** relay-mode clients ignore provider keys; the session token rides the `sokuji-auth.<token>` subprotocol. The backend `relayAuthMiddleware` parses exactly that prefix.
- **No WebRTC for KizunaAI** (relay is WS-only) — enforced in Tasks 6/9.
- **User-managed providers untouched:** `OPENAI_TRANSLATE` / `VOLCENGINE_AST2` keep their direct URLs, keys, `EphemeralTokenService`, and Volcengine header injection (relay mode is only entered when the `relay` constructor arg is set).
- **Follow-up:** non-en i18n strings for the engine selector may be added incrementally (en fallback covers them).
