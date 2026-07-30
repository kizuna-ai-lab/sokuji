# Soniox Advanced API Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose three unused Soniox real-time API features as provider settings: custom vocabulary (STT `context.terms` + `context.translation_terms`), endpoint tuning (`endpoint_sensitivity` + `endpoint_latency_adjustment_level`), and TTS speaking rate (`speed`).

**Architecture:** Five new scalar fields on `SonioxSettings` flow through the existing automatic settings machinery (zero store changes) into `buildSessionConfig`, which parses the two textarea strings into structured data and clamps the numbers. `SonioxClient` passes them to the two wire components, which include them in their first-frame/per-stream configs **only when non-default** — with default settings the wire is byte-identical to today. Spec: `docs/superpowers/specs/2026-07-30-soniox-advanced-features-design.md`.

**Tech Stack:** TypeScript + React, Zustand settings store, Vitest (+ @testing-library/react for UI wiring tests), i18next (30 locales).

## Global Constraints

- **All comments, code, and docs in English.** Conversation with the user is Chinese; the codebase is English-only.
- **Vitest is the correctness gate** — CI does not run tests; run them locally with `npx vitest run <path>`. Do NOT gate on `tsc` (the repo has ~113 pre-existing tsc errors; build is Vite/esbuild).
- **Default-neutral wire:** with default settings the STT first frame and TTS stream config must contain none of the new keys. Verified by tests in Tasks 2–4.
- **Documented ranges (clamp at `buildSessionConfig`):** `endpointSensitivity` ∈ [-1.0, 1.0] (default 0), `endpointLatencyAdjustmentLevel` ∈ {0,1,2,3} (default 0), `ttsSpeed` ∈ [0.7, 1.3] (default 1.0).
- **Vocabulary textareas:** raw strings in the store, `maxLength={4000}` each (Soniox context wire limit is 10,000 chars total; 4000+4000 leaves JSON-overhead headroom).
- **`context.general` / `context.text` are out of scope.** Speaker diarization is out of scope (separate spike, not in this PR).
- **Locale lockstep:** `src/locales/` has 30 `translation.json` files; `src/locales.consistency.test.ts` (path: `src/locales/locales.consistency.test.ts` — find it with `ls src/locales/*.test.ts` if the name differs) fails on any key-set mismatch vs `en`. All 30 files must change in the same task.
- **Conventional commits**, one commit per task, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Working directory is the git worktree `.claude/worktrees/soniox-342-advanced` (branch `worktree-soniox-342-advanced`). Never push or open a PR — the user approves those separately.

---

### Task 1: Provider layer — settings fields, vocabulary parsers, session config

**Files:**
- Modify: `src/services/providers/SonioxProviderConfig.ts` (interface at :9-17, defaults at :19-26, `buildSessionConfig` at :76-89)
- Modify: `src/services/interfaces/IClient.ts` (`SonioxSessionConfig` at :189-195)
- Create: `src/services/providers/SonioxProviderConfig.test.ts`

**Interfaces:**
- Consumes: nothing new (existing `defaultSonioxSettings`, `SessionConfig`).
- Produces (later tasks rely on these exact names):
  - `SonioxSettings` gains `vocabularyTerms: string`, `vocabularyTranslations: string`, `endpointSensitivity: number`, `endpointLatencyAdjustmentLevel: number`, `ttsSpeed: number`.
  - `export function parseVocabularyTerms(raw: string): string[]`
  - `export function parseVocabularyTranslations(raw: string): Array<{ source: string; target: string }>`
  - `SonioxSessionConfig` gains optional `context?: { terms?: string[]; translationTerms?: Array<{ source: string; target: string }> }`, `endpointSensitivity?: number`, `endpointLatencyAdjustmentLevel?: number`, `ttsSpeed?: number`.

**Store note (no action needed):** `settingsStore.ts` needs **zero changes** — the slice initial state (settingsStore.ts:688) and the update/persist registry (settingsStore.ts:633, 639) reference `defaultSonioxSettings` / `defaultKizunaSonioxSettings` directly, `updateSoniox` is `Partial<SonioxSettings>` generic, and load/persist iterates `Object.keys(defaults)`. The Kizuna twin's `defaultKizunaSonioxSettings = { ...defaultSonioxSettings }` (KizunaAISonioxProviderConfig.ts:9) inherits the new fields automatically. `descriptorRegistry.test.ts` references whole defaults objects and needs no edit either.

- [ ] **Step 1: Write the failing test**

Create `src/services/providers/SonioxProviderConfig.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  SonioxProviderConfig,
  defaultSonioxSettings,
  parseVocabularyTerms,
  parseVocabularyTranslations,
} from './SonioxProviderConfig';
import { SonioxSessionConfig } from '../interfaces/IClient';

describe('parseVocabularyTerms', () => {
  it('splits lines, trims, drops empties and dedupes', () => {
    expect(parseVocabularyTerms('  Kizuna AI \n\nSokuji\r\nSokuji\n   \nPipeWire'))
      .toEqual(['Kizuna AI', 'Sokuji', 'PipeWire']);
  });

  it('returns [] for empty input', () => {
    expect(parseVocabularyTerms('')).toEqual([]);
    expect(parseVocabularyTerms('  \n \n')).toEqual([]);
  });
});

describe('parseVocabularyTranslations', () => {
  it('splits each line on the FIRST = and trims both sides', () => {
    expect(parseVocabularyTranslations('Kizuna AI = 絆愛\na=b=c'))
      .toEqual([
        { source: 'Kizuna AI', target: '絆愛' },
        { source: 'a', target: 'b=c' },
      ]);
  });

  it('drops lines without = and lines with an empty side', () => {
    expect(parseVocabularyTranslations('no separator\n=target only\nsource only=\nok=fine'))
      .toEqual([{ source: 'ok', target: 'fine' }]);
  });

  it('returns [] for empty input', () => {
    expect(parseVocabularyTranslations('')).toEqual([]);
  });
});

describe('SonioxProviderConfig.buildSessionConfig', () => {
  const descriptor = new SonioxProviderConfig();
  const build = (patch: Partial<typeof defaultSonioxSettings>) =>
    descriptor.buildSessionConfig({ ...defaultSonioxSettings, ...patch }, '') as SonioxSessionConfig;

  it('emits no context and default numbers for default settings', () => {
    const cfg = build({});
    expect(cfg.context).toBeUndefined();
    expect(cfg.endpointSensitivity).toBe(0);
    expect(cfg.endpointLatencyAdjustmentLevel).toBe(0);
    expect(cfg.ttsSpeed).toBe(1.0);
  });

  it('parses vocabulary strings into a structured context', () => {
    const cfg = build({
      vocabularyTerms: 'Sokuji\nKizuna AI',
      vocabularyTranslations: 'Kizuna AI=絆愛',
    });
    expect(cfg.context).toEqual({
      terms: ['Sokuji', 'Kizuna AI'],
      translationTerms: [{ source: 'Kizuna AI', target: '絆愛' }],
    });
  });

  it('omits the empty half of the context', () => {
    expect(build({ vocabularyTerms: 'Sokuji' }).context).toEqual({ terms: ['Sokuji'] });
    expect(build({ vocabularyTranslations: 'a=b' }).context)
      .toEqual({ translationTerms: [{ source: 'a', target: 'b' }] });
  });

  it('clamps numbers to their documented ranges', () => {
    const cfg = build({ endpointSensitivity: 5, endpointLatencyAdjustmentLevel: 7, ttsSpeed: 2.0 });
    expect(cfg.endpointSensitivity).toBe(1);
    expect(cfg.endpointLatencyAdjustmentLevel).toBe(3);
    expect(cfg.ttsSpeed).toBe(1.3);
    const lo = build({ endpointSensitivity: -5, endpointLatencyAdjustmentLevel: -2, ttsSpeed: 0.1 });
    expect(lo.endpointSensitivity).toBe(-1);
    expect(lo.endpointLatencyAdjustmentLevel).toBe(0);
    expect(lo.ttsSpeed).toBe(0.7);
  });

  it('rounds fractional latency levels and falls back to defaults on non-finite input', () => {
    expect(build({ endpointLatencyAdjustmentLevel: 1.6 }).endpointLatencyAdjustmentLevel).toBe(2);
    const bad = build({
      endpointSensitivity: NaN as unknown as number,
      endpointLatencyAdjustmentLevel: NaN as unknown as number,
      ttsSpeed: NaN as unknown as number,
    });
    expect(bad.endpointSensitivity).toBe(0);
    expect(bad.endpointLatencyAdjustmentLevel).toBe(0);
    expect(bad.ttsSpeed).toBe(1.0);
  });

  it('tolerates a slice missing the new fields (pre-upgrade persisted state)', () => {
    const legacy = { ...defaultSonioxSettings } as Record<string, unknown>;
    delete legacy.vocabularyTerms;
    delete legacy.vocabularyTranslations;
    delete legacy.endpointSensitivity;
    delete legacy.endpointLatencyAdjustmentLevel;
    delete legacy.ttsSpeed;
    const cfg = descriptor.buildSessionConfig(legacy, '') as SonioxSessionConfig;
    expect(cfg.context).toBeUndefined();
    expect(cfg.endpointSensitivity).toBe(0);
    expect(cfg.endpointLatencyAdjustmentLevel).toBe(0);
    expect(cfg.ttsSpeed).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/providers/SonioxProviderConfig.test.ts`
Expected: FAIL — `parseVocabularyTerms` is not exported.

- [ ] **Step 3: Implement**

In `src/services/providers/SonioxProviderConfig.ts`, extend the interface and defaults (replace the existing blocks at :9-26):

```typescript
// Soniox Settings — single BYOK API key (extractCredentials inherited from base)
export interface SonioxSettings {
  apiKey: string;
  sourceLanguage: string;     // 'auto' | ISO code
  targetLanguage: string;
  /** Both mode: use one shared two_way session (true) vs two separate sessions (false). */
  bothModeSharedSession: boolean;
  voice: string;              // TTS voice, one of VOICES
  model: string;
  /** Custom vocabulary, one term per line (raw textarea text → context.terms). */
  vocabularyTerms: string;
  /** Preferred translations, one "source=target" per line (→ context.translation_terms). */
  vocabularyTranslations: string;
  /** Soniox endpoint_sensitivity, -1.0..1.0; 0 = server default. */
  endpointSensitivity: number;
  /** Soniox endpoint_latency_adjustment_level, 0..3; 0 = server default. */
  endpointLatencyAdjustmentLevel: number;
  /** TTS speaking rate, 0.7..1.3; 1.0 = normal. */
  ttsSpeed: number;
}

export const defaultSonioxSettings: SonioxSettings = {
  apiKey: '',
  sourceLanguage: 'auto',
  targetLanguage: 'en',
  bothModeSharedSession: true,
  voice: 'Maya',
  model: 'stt-rt-v5',
  vocabularyTerms: '',
  vocabularyTranslations: '',
  endpointSensitivity: 0,
  endpointLatencyAdjustmentLevel: 0,
  ttsSpeed: 1.0,
};
```

Add the parsers and a clamp helper right after the defaults (before `sonioxUsesSharedBothSession`):

```typescript
/** One term per line; trimmed, empties dropped, duplicates removed. */
export function parseVocabularyTerms(raw: string): string[] {
  const seen = new Set<string>();
  for (const line of raw.split('\n')) {
    const term = line.trim();
    if (term) seen.add(term);
  }
  return [...seen];
}

/** One "source=target" per line; split on the FIRST '=', both sides trimmed
 *  and required non-empty. Lines without '=' are ignored. */
export function parseVocabularyTranslations(raw: string): Array<{ source: string; target: string }> {
  const out: Array<{ source: string; target: string }> = [];
  for (const line of raw.split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const source = line.slice(0, eq).trim();
    const target = line.slice(eq + 1).trim();
    if (source && target) out.push({ source, target });
  }
  return out;
}

function clampNumber(value: unknown, min: number, max: number, dflt: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : dflt;
}
```

Replace `buildSessionConfig` (:76-89) with:

```typescript
  buildSessionConfig(slice: unknown, systemInstructions: string): SessionConfig {
    const settings = slice as SonioxSettings;
    const terms = parseVocabularyTerms(settings.vocabularyTerms ?? '');
    const translationTerms = parseVocabularyTranslations(settings.vocabularyTranslations ?? '');
    return {
      provider: 'soniox',
      model: settings.model || 'stt-rt-v5',
      voice: settings.voice || 'Maya',
      instructions: systemInstructions,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      // Direction is derived from You/Others/Both at connect time; default one_way.
      // MainPanel sets bidirectional:true only for the shared-Both single-session path.
      bidirectional: false,
      ...(terms.length || translationTerms.length
        ? {
            context: {
              ...(terms.length ? { terms } : {}),
              ...(translationTerms.length ? { translationTerms } : {}),
            },
          }
        : {}),
      // Clamped here (single choke point); the wire components omit the keys
      // when these carry the server-default values.
      endpointSensitivity: clampNumber(settings.endpointSensitivity, -1, 1, 0),
      endpointLatencyAdjustmentLevel: Math.round(
        clampNumber(settings.endpointLatencyAdjustmentLevel, 0, 3, 0)
      ),
      ttsSpeed: clampNumber(settings.ttsSpeed, 0.7, 1.3, 1.0),
    } as SonioxSessionConfig;
  }
```

In `src/services/interfaces/IClient.ts`, extend `SonioxSessionConfig` (:189-195):

```typescript
export interface SonioxSessionConfig extends BaseSessionConfig {
  provider: 'soniox';
  sourceLanguage: string; // 'auto' | ISO code
  targetLanguage: string; // ISO code
  /** True only for Both mode with a shared single session (set by MainPanel). Drives two_way vs one_way. */
  bidirectional: boolean;
  /** Custom vocabulary parsed from settings; absent when both lists are empty. */
  context?: {
    terms?: string[];
    translationTerms?: Array<{ source: string; target: string }>;
  };
  /** Clamped -1.0..1.0; 0 (default) is omitted from the wire. */
  endpointSensitivity?: number;
  /** Clamped integer 0..3; 0 (default) is omitted from the wire. */
  endpointLatencyAdjustmentLevel?: number;
  /** Clamped 0.7..1.3; 1.0 (default) is omitted from the wire. */
  ttsSpeed?: number;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/providers/SonioxProviderConfig.test.ts`
Expected: PASS.

Also run the neighbors that consume these types:
`npx vitest run src/services/providers/descriptorRegistry.test.ts src/stores/settingsStore.test.ts src/services/providers/sonioxSharedBothSession.test.ts`
(If `src/stores/settingsStore.test.ts` does not exist under that exact name, run `npx vitest run src/stores/` instead.)
Expected: PASS with no edits to those files.

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/SonioxProviderConfig.ts src/services/providers/SonioxProviderConfig.test.ts src/services/interfaces/IClient.ts
git commit -m "feat(soniox): add vocabulary/endpoint/tts-speed settings and session-config plumbing (#342)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: STT wire — context and endpoint tuning in the first frame

**Files:**
- Modify: `src/services/clients/SonioxSttStream.ts` (`SonioxSttConfig` at :45-55, config frame at :102-114)
- Test: `src/services/clients/SonioxSttStream.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (the stream takes its own wire-shaped config).
- Produces: `SonioxSttConfig` gains `context?: { terms?: string[]; translation_terms?: Array<{ source: string; target: string }> }` (**snake_case** — this interface mirrors the wire), `endpointSensitivity?: number`, `endpointLatencyAdjustmentLevel?: number`. Task 4's `SonioxClient` fills these.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('SonioxSttStream', ...)` block in `src/services/clients/SonioxSttStream.test.ts` (the file already has the `openStream(config)` helper and `CONFIG` fixture at :34-45):

```typescript
  it('includes context and endpoint tuning in the first frame when configured', async () => {
    const { ws } = await openStream({
      ...CONFIG,
      context: {
        terms: ['Sokuji'],
        translation_terms: [{ source: 'Kizuna AI', target: '絆愛' }],
      },
      endpointSensitivity: -0.5,
      endpointLatencyAdjustmentLevel: 2,
    });
    const first = JSON.parse(ws.sent[0] as string);
    expect(first.context).toEqual({
      terms: ['Sokuji'],
      translation_terms: [{ source: 'Kizuna AI', target: '絆愛' }],
    });
    expect(first.endpoint_sensitivity).toBe(-0.5);
    expect(first.endpoint_latency_adjustment_level).toBe(2);
  });

  it('omits context and endpoint-tuning keys at their defaults (wire unchanged for existing users)', async () => {
    const { ws } = await openStream({
      ...CONFIG,
      endpointSensitivity: 0,
      endpointLatencyAdjustmentLevel: 0,
    });
    const first = JSON.parse(ws.sent[0] as string);
    expect('context' in first).toBe(false);
    expect('endpoint_sensitivity' in first).toBe(false);
    expect('endpoint_latency_adjustment_level' in first).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/clients/SonioxSttStream.test.ts`
Expected: FAIL — the first frame has no `context` / `endpoint_sensitivity` keys (and TypeScript flags the unknown config fields).

- [ ] **Step 3: Implement**

In `src/services/clients/SonioxSttStream.ts`, extend the config interface (:45-55):

```typescript
export interface SonioxSttConfig {
  apiKey: string;
  model: string;
  sampleRate: number;
  languageHints?: string[];
  translation: SonioxTranslationConfig;
  /** Custom vocabulary, wire-shaped (snake_case). Omitted from the config frame when absent. */
  context?: {
    terms?: string[];
    translation_terms?: Array<{ source: string; target: string }>;
  };
  /** endpoint_sensitivity, -1.0..1.0. 0/undefined = omit (server default). v5-only. */
  endpointSensitivity?: number;
  /** endpoint_latency_adjustment_level, 0..3. 0/undefined = omit (server default). v5-only. */
  endpointLatencyAdjustmentLevel?: number;
  // Managed-mode only: correlates this session's usage logs back to the
  // backend's billing lease. BYOK sessions omit it (the field is simply
  // absent from the wire config).
  clientReferenceId?: string;
}
```

Extend the first-frame config in `ws.onopen` (insert after the `max_endpoint_delay_ms: 500,` line at :109):

```typescript
          // 0 is the server default for both tuning knobs, so falsy checks
          // double as the "omit at default" rule (negative sensitivity is truthy).
          ...(config.endpointSensitivity ? { endpoint_sensitivity: config.endpointSensitivity } : {}),
          ...(config.endpointLatencyAdjustmentLevel
            ? { endpoint_latency_adjustment_level: config.endpointLatencyAdjustmentLevel }
            : {}),
          ...(config.context ? { context: config.context } : {}),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/clients/SonioxSttStream.test.ts`
Expected: PASS — including the pre-existing first-frame test (`sends explicit raw-PCM config as the first frame`), which must not need edits.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/SonioxSttStream.ts src/services/clients/SonioxSttStream.test.ts
git commit -m "feat(soniox): send context and endpoint tuning in the STT config frame (#342)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: TTS wire — speaking rate in the per-stream config

**Files:**
- Modify: `src/services/clients/SonioxTtsStream.ts` (`SonioxTtsOptions` at :32-40, `openStream()` at :285-299)
- Test: `src/services/clients/SonioxTtsStream.test.ts`

**Interfaces:**
- Produces: `SonioxTtsOptions` gains `speed?: number` (0.7..1.3; undefined/1.0 = omit). Task 4's `SonioxClient.createTtsStream()` fills it.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('SonioxTtsStream', ...)` block in `src/services/clients/SonioxTtsStream.test.ts` (reuse its `OPTS` fixture at :33 and `MockWebSocket`; note `ws.jsonSent()` returns parsed JSON messages):

```typescript
  it('includes speed in the stream config when not the default rate', async () => {
    const t = new SonioxTtsStream({ ...OPTS, speed: 0.8 });
    const p = t.connect();
    MockWebSocket.instances.at(-1)!.open();
    await p;
    const ws = MockWebSocket.instances.at(-1)!;
    t.sendText('Hi', 'en');
    expect(ws.jsonSent()[0]).toMatchObject({ stream_id: 'utt-1', speed: 0.8 });
  });

  it('omits speed at the default rate (undefined or 1.0)', async () => {
    for (const speed of [undefined, 1.0]) {
      const t = new SonioxTtsStream({ ...OPTS, speed });
      const p = t.connect();
      MockWebSocket.instances.at(-1)!.open();
      await p;
      const ws = MockWebSocket.instances.at(-1)!;
      t.sendText('Hi', 'en');
      expect('speed' in ws.jsonSent()[0]).toBe(false);
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/clients/SonioxTtsStream.test.ts`
Expected: FAIL — no `speed` key in the stream config (and TypeScript flags the unknown option).

- [ ] **Step 3: Implement**

In `src/services/clients/SonioxTtsStream.ts`, extend the options interface (:32-40):

```typescript
export interface SonioxTtsOptions {
  apiKey: string;
  voice: string;
  model: string;
  sampleRate: number;
  /** Speaking rate 0.7..1.3; undefined or 1.0 (the server default) is omitted from the wire. */
  speed?: number;
  // Managed-mode only: must match the STT stream's clientReferenceId, or the
  // TTS half of the session cannot be attributed to the billing lease.
  clientReferenceId?: string;
}
```

Extend `openStream()`'s config message (insert after the `sample_rate` line at :293):

```typescript
      ...(this.options.speed != null && this.options.speed !== 1.0 ? { speed: this.options.speed } : {}),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/clients/SonioxTtsStream.test.ts`
Expected: PASS — including the pre-existing `lazily opens a per-utterance stream with full config` test, unedited.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/SonioxTtsStream.ts src/services/clients/SonioxTtsStream.test.ts
git commit -m "feat(soniox): support the TTS speed parameter in the per-stream config (#342)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: SonioxClient — pass session config through to both wires

**Files:**
- Modify: `src/services/clients/SonioxClient.ts` (`stt.connect({...})` call at :261-268, `createTtsStream()` at :551-568)
- Test: `src/services/clients/SonioxClient.test.ts`

**Interfaces:**
- Consumes: `SonioxSessionConfig.context/endpointSensitivity/endpointLatencyAdjustmentLevel/ttsSpeed` (Task 1), `SonioxSttConfig.context` (snake_case, Task 2), `SonioxTtsOptions.speed` (Task 3).
- Produces: nothing new (client is the glue).

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block at the end of `src/services/clients/SonioxClient.test.ts` (the file's harness — `connectedClient(cfg)` at :69-75 — returns `{ stt, tts }` mock instances; `stt.config` is the config object the client passed to `SonioxSttStream.connect`, `tts.options` the options passed to the `SonioxTtsStream` constructor):

```typescript
describe('SonioxClient advanced-feature passthrough (#342)', () => {
  it('maps session-config context to the wire shape and forwards endpoint tuning', async () => {
    const { stt } = await connectedClient({
      context: {
        terms: ['Sokuji'],
        translationTerms: [{ source: 'Kizuna AI', target: '絆愛' }],
      },
      endpointSensitivity: 0.5,
      endpointLatencyAdjustmentLevel: 3,
    });
    expect(stt.config).toMatchObject({
      context: {
        terms: ['Sokuji'],
        translation_terms: [{ source: 'Kizuna AI', target: '絆愛' }],
      },
      endpointSensitivity: 0.5,
      endpointLatencyAdjustmentLevel: 3,
    });
  });

  it('sends no context when the session config has none', async () => {
    const { stt } = await connectedClient();
    expect((stt.config as { context?: unknown }).context).toBeUndefined();
  });

  it('passes ttsSpeed to the TTS stream options', async () => {
    const { tts } = await connectedClient({ ttsSpeed: 0.8 });
    expect((tts!.options as { speed?: number }).speed).toBe(0.8);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/clients/SonioxClient.test.ts`
Expected: the three new tests FAIL (`stt.config.context` undefined when configured; `tts.options.speed` undefined); all pre-existing tests still pass.

- [ ] **Step 3: Implement**

In `src/services/clients/SonioxClient.ts`, inside `connect()` just before the `await this.stt.connect({...})` call (:261), build the wire-shaped context:

```typescript
    // Map the session config's camelCase context to the wire's snake_case.
    // buildSessionConfig only sets `context` when at least one list is non-empty.
    const sttContext = cfg.context
      ? {
          ...(cfg.context.terms?.length ? { terms: cfg.context.terms } : {}),
          ...(cfg.context.translationTerms?.length
            ? { translation_terms: cfg.context.translationTerms }
            : {}),
        }
      : undefined;
```

Then extend the `stt.connect` call (:261-268):

```typescript
    await this.stt.connect({
      apiKey: this.managedOptions ? this.managedSttApiKey! : this.apiKey,
      model: cfg.model || STT_MODEL,
      sampleRate: SAMPLE_RATE,
      languageHints,
      translation,
      ...(sttContext ? { context: sttContext } : {}),
      endpointSensitivity: cfg.endpointSensitivity,
      endpointLatencyAdjustmentLevel: cfg.endpointLatencyAdjustmentLevel,
      clientReferenceId: this.clientReferenceId ?? undefined,
    });
```

Extend `createTtsStream()` (:551-568) — add one option line after `sampleRate: SAMPLE_RATE,`:

```typescript
      speed: this.currentConfig?.ttsSpeed,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/clients/SonioxClient.test.ts src/services/clients/SonioxClient.managed.test.ts`
Expected: PASS, with `SonioxClient.managed.test.ts` untouched (all new session-config fields are optional).

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/SonioxClient.ts src/services/clients/SonioxClient.test.ts
git commit -m "feat(soniox): thread vocabulary, endpoint tuning and TTS speed through the client (#342)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Settings UI — speed slider, vocabulary textareas, endpoint controls

**Files:**
- Modify: `src/components/Settings/sections/LocalSettingsControls.tsx` (`TtsSpeedControl` at :25-50)
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx` (`renderSonioxSettings` at :1714-1780)
- Create: `src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`

**Interfaces:**
- Consumes: `activeSonioxSettings` / `updateActiveSonioxSettings` (ProviderSpecificSettings.tsx:187-195 — already route BYOK vs Kizuna twin), the five `SonioxSettings` fields from Task 1, `TtsSpeedControl`.
- Produces: `TtsSpeedControl` gains optional `min?: number; max?: number; step?: number` props (defaults 0.5 / 2.0 / 0.1 — the two existing call sites at :1806 and :1918 must behave identically without edits). New DOM ids for tests: `#soniox-vocabulary-terms`, `#soniox-vocabulary-translations`, `#soniox-endpoint-sensitivity`, `#soniox-endpoint-latency-level`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`. It follows the mutation-verified harness of `LanguageSection.soniox.test.tsx` (real component + real settingsStore; mocks only for i18n/analytics/auth/ServiceFactory and the heavy child sections that render null for Soniox anyway):

```tsx
/**
 * Mutation-verified wiring tests for the Soniox advanced settings (#342):
 * each control must actually write its field to the ACTIVE soniox slice
 * (BYOK `soniox`, or `kizunaSoniox` for the managed twin). Mounts the real
 * ProviderSpecificSettings against the real settingsStore — the #339 lesson:
 * per-provider switches/routing fail silently, only real write-path tests
 * catch a missing case.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_k: string, def?: string) => def ?? _k,
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('../../../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}));

vi.mock('../../../lib/auth/hooks', () => ({
  useAuth: () => ({ getToken: async () => null }),
}));

vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_k: string, d: unknown) => d,
      setSetting: async () => undefined,
    }),
  },
}));

// Heavy local-provider sections; all render null for provider=SONIOX but pull
// large import graphs — stub them out.
vi.mock('./ModelManagementSection', () => ({ ModelManagementSection: () => null }));
vi.mock('./NativeModelManagementSection', () => ({ NativeModelManagementSection: () => null }));
vi.mock('./EngineSection', () => ({ EngineSection: () => null }));

const { default: useSettingsStore } = await import('../../../stores/settingsStore');
const { Provider } = await import('../../../types/Provider');
const { SonioxProviderConfig } = await import('../../../services/providers/SonioxProviderConfig');
const { default: ProviderSpecificSettings } = await import('./ProviderSpecificSettings');

const baseProps = {
  config: new SonioxProviderConfig().getConfig(),
  isSessionActive: false,
  isPreviewExpanded: false,
  setIsPreviewExpanded: () => {},
  getProcessedSystemInstructions: () => '',
  availableModels: [],
  loadingModels: false,
  fetchAvailableModels: async () => {},
};

function mount() {
  return render(<ProviderSpecificSettings {...baseProps} />);
}

describe('ProviderSpecificSettings — Soniox advanced settings wiring (#342)', () => {
  beforeEach(() => {
    useSettingsStore.setState((s: any) => ({
      provider: Provider.SONIOX,
      soniox: {
        ...s.soniox,
        vocabularyTerms: '',
        vocabularyTranslations: '',
        endpointSensitivity: 0,
        endpointLatencyAdjustmentLevel: 0,
        ttsSpeed: 1.0,
      },
    }));
  });

  it('writes the terms textarea to soniox.vocabularyTerms and caps it at 4000 chars', () => {
    const { container } = mount();
    const el = container.querySelector('#soniox-vocabulary-terms') as HTMLTextAreaElement;
    expect(el.getAttribute('maxlength')).toBe('4000');
    fireEvent.change(el, { target: { value: 'Sokuji\nKizuna AI' } });
    expect(useSettingsStore.getState().soniox.vocabularyTerms).toBe('Sokuji\nKizuna AI');
  });

  it('writes the translations textarea to soniox.vocabularyTranslations and caps it at 4000 chars', () => {
    const { container } = mount();
    const el = container.querySelector('#soniox-vocabulary-translations') as HTMLTextAreaElement;
    expect(el.getAttribute('maxlength')).toBe('4000');
    fireEvent.change(el, { target: { value: 'Kizuna AI=絆愛' } });
    expect(useSettingsStore.getState().soniox.vocabularyTranslations).toBe('Kizuna AI=絆愛');
  });

  it('writes the sensitivity slider to soniox.endpointSensitivity as a number', () => {
    const { container } = mount();
    const el = container.querySelector('#soniox-endpoint-sensitivity') as HTMLInputElement;
    fireEvent.change(el, { target: { value: '0.5' } });
    expect(useSettingsStore.getState().soniox.endpointSensitivity).toBe(0.5);
  });

  it('writes the latency-level select to soniox.endpointLatencyAdjustmentLevel as a number', () => {
    const { container } = mount();
    const el = container.querySelector('#soniox-endpoint-latency-level') as HTMLSelectElement;
    fireEvent.change(el, { target: { value: '2' } });
    expect(useSettingsStore.getState().soniox.endpointLatencyAdjustmentLevel).toBe(2);
  });

  it('writes the TTS speed slider (0.7–1.3 range) to soniox.ttsSpeed', () => {
    const { container } = mount();
    const el = container.querySelector('input[min="0.7"]') as HTMLInputElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('max')).toBe('1.3');
    fireEvent.change(el, { target: { value: '0.8' } });
    expect(useSettingsStore.getState().soniox.ttsSpeed).toBe(0.8);
  });

  it('routes writes to the kizunaSoniox slice for the managed twin', () => {
    useSettingsStore.setState((s: any) => ({
      provider: Provider.KIZUNA_AI_SONIOX,
      kizunaSoniox: { ...s.kizunaSoniox, vocabularyTerms: '' },
      soniox: { ...s.soniox, vocabularyTerms: '' },
    }));
    const { container } = mount();
    const el = container.querySelector('#soniox-vocabulary-terms') as HTMLTextAreaElement;
    fireEvent.change(el, { target: { value: 'Managed term' } });
    expect(useSettingsStore.getState().kizunaSoniox.vocabularyTerms).toBe('Managed term');
    expect(useSettingsStore.getState().soniox.vocabularyTerms).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`
Expected: FAIL — `#soniox-vocabulary-terms` (and the other new ids) not found.
If the mount itself crashes on some unrelated module import, add a `vi.mock('<that module>', () => ({ ... }))` stub returning nulls/no-ops — mechanical, keep the real settingsStore unmocked.

- [ ] **Step 3: Implement**

**(a)** In `src/components/Settings/sections/LocalSettingsControls.tsx`, give `TtsSpeedControl` optional bounds (replace :25-50):

```tsx
export const TtsSpeedControl: React.FC<{
  value: number;
  onChange: (speed: number) => void;
  disabled: boolean;
  /** Slider bounds; defaults match the local providers' 0.5–2.0 range. */
  min?: number;
  max?: number;
  step?: number;
  /** Extra rows (e.g. a voice/speaker picker) rendered under the speed slider. */
  children?: React.ReactNode;
}> = ({ value, onChange, disabled, min = 0.5, max = 2.0, step = 0.1, children }) => {
  const { t } = useTranslation();
  return (
    <div className="settings-section">
      <h2>{t('settings.ttsSettings', 'Speech Synthesis (TTS) Settings')}</h2>
      <div className="setting-item">
        <div className="setting-label">
          <span>{t('settings.ttsSpeed', 'Speech Speed')}</span>
          <span className="setting-value">{value.toFixed(1)}x</span>
        </div>
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="slider" disabled={disabled}
        />
      </div>
      {children}
    </div>
  );
};
```

**(b)** In `src/components/Settings/sections/ProviderSpecificSettings.tsx`, rework `renderSonioxSettings` to return a fragment: the three new sections FIRST, then the existing shared-session section verbatim. Replace the `return (` at :1734 through the closing `);` at :1779 with (the shared-session `<div className="settings-section" id="soniox-settings-section">…</div>` block stays byte-identical — it is elided below as `{/* existing shared-session section unchanged */}`; keep the real code):

```tsx
    return (
      <>
        <TtsSpeedControl
          value={activeSonioxSettings.ttsSpeed}
          onChange={(ttsSpeed) => updateActiveSonioxSettings({ ttsSpeed })}
          disabled={isSessionActive}
          min={0.7}
          max={1.3}
          step={0.1}
        />

        <div className="settings-section" id="soniox-vocabulary-section">
          <h2>
            {t('settings.sonioxVocabulary', 'Custom Vocabulary')}
            <Tooltip
              content={t('settings.sonioxVocabularyTooltip', 'Bias recognition toward important names and jargon, and force preferred translations. Applies from the next session.')}
              position="top"
            >
              <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
            </Tooltip>
          </h2>
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.sonioxVocabularyTerms', 'Terms')}</span>
              <Tooltip
                content={t('settings.sonioxVocabularyTermsTooltip', 'Improves recognition of uncommon words — names, jargon, product names.')}
                position="top"
              >
                <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
              </Tooltip>
            </div>
            <textarea
              id="soniox-vocabulary-terms"
              className="system-instructions"
              placeholder={t('settings.sonioxVocabularyTermsPlaceholder', 'One term per line')}
              maxLength={4000}
              value={activeSonioxSettings.vocabularyTerms}
              onChange={(e) => updateActiveSonioxSettings({ vocabularyTerms: e.target.value })}
              disabled={isSessionActive}
            />
          </div>
          <div className="setting-item">
            <div className="setting-label">
              <span>{t('settings.sonioxVocabularyTranslations', 'Preferred Translations')}</span>
              <Tooltip
                content={t('settings.sonioxVocabularyTranslationsTooltip', 'Forces how specific terms are translated. Entries are directional — in two-way mode add a reverse line to force both directions.')}
                position="top"
              >
                <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '8px' }} />
              </Tooltip>
            </div>
            <textarea
              id="soniox-vocabulary-translations"
              className="system-instructions"
              placeholder={t('settings.sonioxVocabularyTranslationsPlaceholder', 'One source=target per line')}
              maxLength={4000}
              value={activeSonioxSettings.vocabularyTranslations}
              onChange={(e) => updateActiveSonioxSettings({ vocabularyTranslations: e.target.value })}
              disabled={isSessionActive}
            />
          </div>
        </div>

        <div className="settings-section" id="soniox-endpoint-section">
          <h2>{t('settings.sonioxEndpointTuning', 'Endpoint Detection Tuning')}</h2>
          <div className="setting-item">
            <div className="setting-label">
              <span>
                {t('settings.sonioxEndpointSensitivity', 'Endpoint Sensitivity')}
                <Tooltip
                  content={t('settings.sonioxEndpointSensitivityTooltip', 'Higher values end utterances sooner — lower latency but more risk of premature cut-offs. Lower values wait longer before finalizing. 0 is the Soniox default.')}
                  position="top"
                >
                  <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                </Tooltip>
              </span>
              <span className="setting-value">{activeSonioxSettings.endpointSensitivity.toFixed(1)}</span>
            </div>
            <input
              id="soniox-endpoint-sensitivity"
              type="range" min="-1" max="1" step="0.1"
              value={activeSonioxSettings.endpointSensitivity}
              onChange={(e) => updateActiveSonioxSettings({ endpointSensitivity: parseFloat(e.target.value) })}
              className="slider" disabled={isSessionActive}
            />
          </div>
          <div className="setting-item">
            <div className="setting-label">
              <span>
                {t('settings.sonioxEndpointLatencyLevel', 'Latency Reduction Level')}
                <Tooltip
                  content={t('settings.sonioxEndpointLatencyLevelTooltip', 'Progressively more aggressive latency reduction when closing an utterance. 0 is the default behavior.')}
                  position="top"
                >
                  <CircleHelp className="tooltip-trigger" size={14} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                </Tooltip>
              </span>
            </div>
            <select
              id="soniox-endpoint-latency-level"
              className="select-dropdown"
              value={activeSonioxSettings.endpointLatencyAdjustmentLevel}
              onChange={(e) => updateActiveSonioxSettings({ endpointLatencyAdjustmentLevel: parseInt(e.target.value, 10) })}
              disabled={isSessionActive}
            >
              <option value={0}>{`0 — ${t('settings.sonioxLatencyLevelDefault', 'Default')}`}</option>
              <option value={1}>{`1 — ${t('settings.sonioxLatencyLevelLower', 'Lower latency')}`}</option>
              <option value={2}>{`2 — ${t('settings.sonioxLatencyLevelEvenLower', 'Even lower latency')}`}</option>
              <option value={3}>{`3 — ${t('settings.sonioxLatencyLevelMost', 'Most aggressive')}`}</option>
            </select>
          </div>
        </div>

        {/* existing shared-session section unchanged */}
      </>
    );
```

Note: `TtsSpeedControl` is already imported at :67. The `h2` for `ttsSettings` uses the en value `'Speech Synthesis (TTS) Settings'` (locales/en/translation.json:158) — updating the inline default from `'TTS Settings'` to match is part of change (a).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx src/components/Settings/sections/NativeModelManagementSection.test.tsx src/components/Settings/sections/ModelManagementSection.test.tsx`
Expected: PASS — the two local-provider section tests confirm the `TtsSpeedControl` default-props change didn't disturb the 0.5–2.0 call sites.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/sections/LocalSettingsControls.tsx src/components/Settings/sections/ProviderSpecificSettings.tsx src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx
git commit -m "feat(soniox): settings UI for vocabulary, endpoint tuning and TTS speed (#342)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Locales — add the 17 new keys to all 30 translation files

**Files:**
- Modify: `src/locales/<locale>/translation.json` for all 30 locales (`ar bn de en es fa fi fil fr he hi id it ja ko ms nl pl pt_BR pt_PT ru sv ta te th tr uk vi zh_CN zh_TW`)

**Interfaces:**
- Consumes: the exact `t()` keys used in Task 5.
- Produces: nothing downstream; gated by the locales consistency test.

The 17 keys (all under the top-level `settings` object), with their English values — these must match Task 5's inline defaults byte-for-byte:

| Key | en value |
|---|---|
| `sonioxVocabulary` | `Custom Vocabulary` |
| `sonioxVocabularyTooltip` | `Bias recognition toward important names and jargon, and force preferred translations. Applies from the next session.` |
| `sonioxVocabularyTerms` | `Terms` |
| `sonioxVocabularyTermsTooltip` | `Improves recognition of uncommon words — names, jargon, product names.` |
| `sonioxVocabularyTermsPlaceholder` | `One term per line` |
| `sonioxVocabularyTranslations` | `Preferred Translations` |
| `sonioxVocabularyTranslationsTooltip` | `Forces how specific terms are translated. Entries are directional — in two-way mode add a reverse line to force both directions.` |
| `sonioxVocabularyTranslationsPlaceholder` | `One source=target per line` |
| `sonioxEndpointTuning` | `Endpoint Detection Tuning` |
| `sonioxEndpointSensitivity` | `Endpoint Sensitivity` |
| `sonioxEndpointSensitivityTooltip` | `Higher values end utterances sooner — lower latency but more risk of premature cut-offs. Lower values wait longer before finalizing. 0 is the Soniox default.` |
| `sonioxEndpointLatencyLevel` | `Latency Reduction Level` |
| `sonioxEndpointLatencyLevelTooltip` | `Progressively more aggressive latency reduction when closing an utterance. 0 is the default behavior.` |
| `sonioxLatencyLevelDefault` | `Default` |
| `sonioxLatencyLevelLower` | `Lower latency` |
| `sonioxLatencyLevelEvenLower` | `Even lower latency` |
| `sonioxLatencyLevelMost` | `Most aggressive` |

- [ ] **Step 1: Locate the consistency test and run it as the failing test**

Run: `ls src/locales/*.test.ts src/locales/**/*.test.ts 2>/dev/null; grep -rln "no missing, no stale" src --include="*.test.ts"` to find the exact consistency test path (referred to as `locales.consistency.test.ts`).
Then add the 17 keys to **`src/locales/en/translation.json` only**, inserted immediately after the `"sonioxAutoParticipantWarning"` line (:219) so the Soniox keys stay grouped. Keep the file's 2-space indentation and escape nothing beyond standard JSON.
Run: `npx vitest run <path-to-consistency-test>`
Expected: FAIL — 29 locales are missing the 17 new keys. This proves the test actually guards the change.

- [ ] **Step 2: Translate and insert into the remaining 29 locales**

For each of the 29 non-English locales, translate the 17 values into that language (you are a capable translator — translate meaningfully, do not copy English, except proper nouns like "Soniox"). Insert them after that locale's `"sonioxAutoParticipantWarning"` key with a Node script so ordering and formatting stay uniform. Write the script to the job tmp directory (NOT into the repo), pattern:

```javascript
// insert-soniox-keys.mjs — run: node insert-soniox-keys.mjs /abs/path/to/src/locales
import fs from 'node:fs';
import path from 'node:path';

const KEYS = [
  'sonioxVocabulary', 'sonioxVocabularyTooltip', 'sonioxVocabularyTerms',
  'sonioxVocabularyTermsTooltip', 'sonioxVocabularyTermsPlaceholder',
  'sonioxVocabularyTranslations', 'sonioxVocabularyTranslationsTooltip',
  'sonioxVocabularyTranslationsPlaceholder', 'sonioxEndpointTuning',
  'sonioxEndpointSensitivity', 'sonioxEndpointSensitivityTooltip',
  'sonioxEndpointLatencyLevel', 'sonioxEndpointLatencyLevelTooltip',
  'sonioxLatencyLevelDefault', 'sonioxLatencyLevelLower',
  'sonioxLatencyLevelEvenLower', 'sonioxLatencyLevelMost',
];

// One entry per locale; en is already done by hand. Values MUST be real
// translations, filled in by the implementer.
const TRANSLATIONS = {
  ja: {
    sonioxVocabulary: 'カスタム語彙',
    /* ...remaining 16 keys... */
  },
  /* ...remaining 28 locales... */
};

const root = process.argv[2];
for (const [locale, values] of Object.entries(TRANSLATIONS)) {
  const file = path.join(root, locale, 'translation.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const settings = data.settings;
  const rebuilt = {};
  for (const [k, v] of Object.entries(settings)) {
    rebuilt[k] = v;
    if (k === 'sonioxAutoParticipantWarning') {
      for (const key of KEYS) rebuilt[key] = values[key];
    }
  }
  if (Object.keys(rebuilt).length !== Object.keys(settings).length + KEYS.length) {
    throw new Error(`${locale}: anchor key not found or key collision`);
  }
  data.settings = rebuilt;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`${locale} ok`);
}
```

Before writing, check en/translation.json's exact indentation (`head -3 src/locales/en/translation.json`) and trailing-newline convention, and mirror them (adjust the `JSON.stringify` third argument if the file uses a different indent).

Give native-quality attention to `de`, `ja`, `zh_CN`, `zh_TW` (the #339 convention); machine-quality is acceptable for the rest.

- [ ] **Step 3: Run the consistency test to verify it passes**

Run: `npx vitest run <path-to-consistency-test>`
Expected: PASS — key sets in lockstep, placeholders intact, no empty values.

- [ ] **Step 4: Spot-check rendering**

Run: `npx vitest run src/components/Settings/sections/ProviderSpecificSettings.soniox.test.tsx`
Expected: still PASS (the i18n mock uses inline defaults, so this simply guards against syntax damage to imports).
Also `git diff --stat src/locales/` must show exactly 30 files changed.

- [ ] **Step 5: Commit**

```bash
git add src/locales
git commit -m "feat(soniox): locale strings for vocabulary, endpoint tuning and TTS speed (#342)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Full-suite verification

**Files:** none (verification only; fix regressions if any appear).

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: ALL tests pass (baseline before this branch was fully green; any failure is a regression from Tasks 1–6 — fix it, do not skip it).

- [ ] **Step 2: Production build sanity**

Run: `npm run build`
Expected: build completes (esbuild catches syntax-level breakage in the touched TSX).

- [ ] **Step 3: Verify wire neutrality one last time**

Run: `npx vitest run src/services/clients/ src/services/providers/SonioxProviderConfig.test.ts`
Expected: PASS — the default-omission tests (Task 2 Step 1 second test, Task 3 Step 1 second test, Task 1 default-settings test) are the byte-identical-wire guarantee.

- [ ] **Step 4: Commit (only if fixes were needed)**

```bash
git add -A && git commit -m "fix(soniox): full-suite fixes for advanced settings (#342)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Out of scope for this plan

- **Speaker diarization spike** — separate throwaway experiment against the live API; requires a user-provided Soniox API key; runs outside this branch and produces a findings report, not code.
- **Pushing the branch / opening a PR** — requires the user's explicit per-action approval.
- `context.general` / `context.text`, `max_endpoint_delay_ms` exposure, multi-speaker UI.
