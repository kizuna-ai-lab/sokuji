# MainPanel Seams S2 — buildParticipantSessionConfig Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace MainPanel's 150-line, 11-branch `createParticipantSessionConfig` direction-reversal switch with a `buildParticipantSessionConfig` descriptor method — each provider's reversal logic (comments included) moves into its own descriptor; MainPanel keeps only the call, the notice emission, and the null-skip path.

**Architecture:** Stage S2 of `docs/superpowers/specs/2026-08-13-mainpanel-provider-seams-design.md`. New result type `{ config: SessionConfig | null; notices: [...] }`; base impl = `buildSessionConfig` + the generic participant overrides; nine descriptor overrides. The two local-provider helpers relocate out of `settingsStore.ts` (they read the MODEL stores, not settings state — and `LocalNativeProviderConfig.ts:12` already imports `useNativeModelStore`, so descriptor→model-store is established practice; the forbidden edge is descriptor→settingsStore, which cycles). A golden equivalence test pins old-vs-new across all 14 descriptors before the switch is deleted.

**Tech Stack:** TypeScript, React, zustand, vitest 4.

## Global Constraints

- Repo/worktree: `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/soniox-tts-v2`, branch `refactor/mainpanel-provider-seams` (S1 complete, HEAD ≈ `54d4ca01`). Paths relative to that root.
- **Zero behavior change.** The golden test (Task 6) is the stage's equivalence oracle; it must pass before the switch is deleted (Task 7) and is retired in Task 8.
- Full suite green at every task end: `npx vitest run` (2500 tests at stage start). `npx vite build` green at Tasks 7 and 8.
- Rationale comments in the switch branches **move verbatim** into the descriptors (palabra's code-space note, gemini's Live-Translate note, openai's transcription-hint note, local_native's model-re-resolution note, openai_translate's 13-targets note).
- Descriptors must never import `settingsStore` (import cycle). Importing the model stores is allowed (existing practice).
- No new `Provider.X` comparisons; MainPanel gains no new provider-specific imports — it LOSES four (`reverseTranscriptionDirection`, `reverseGeminiTranslationDirection`, `createParticipantLocal*Config`).
- Locate all edits by grepping quoted code, not line numbers. Commit per task, message styles as specified. Do not push.
- Sweeps use the generic pattern `Provider\.[A-Z_]+` (S1 lesson — never a hardcoded name list).

---

### Task 1: Relocate the local participant-config helpers

**Files:**
- Create: `src/services/providers/localParticipantConfig.ts`
- Modify: `src/stores/settingsStore.ts` (remove the two function bodies + private deps that move; add re-exports)
- Tests: existing `src/stores/settingsStore.test.ts` blocks keep passing unchanged (they import from settingsStore, which now re-exports)

**Interfaces:**
- Produces: `createParticipantLocalInferenceConfig` and `createParticipantLocalNativeConfig` importable from `'./localParticipantConfig'` by the Local descriptors (Task 5) with their EXACT current signatures and return types (copy the signatures verbatim when moving — Task 5 relies on `result.success`, `result.status.translationAvailable`, `result.status.asrFallback`, `result.status.asrModelId`, `result.status.asrOriginalModelId`, `result.detail`, `result.reason`, `result.config`, and for native: `result.translationAvailable`).

- [ ] **Step 1: Locate the movers**

In `src/stores/settingsStore.ts`: `createParticipantLocalInferenceConfig` (exported, ~L483) and `createParticipantLocalNativeConfig` (exported, ~L581), plus any module-private helpers ONLY they use — known: `readDebugNumber` (~L453); verify with grep whether `getParticipantModelStatus` / `recallModels` are settingsStore-private (grep their definitions; if defined in settingsStore.ts and used only by the movers, they move too; if imported from elsewhere, the import moves).

- [ ] **Step 2: Create the new module**

`src/services/providers/localParticipantConfig.ts` — header comment plus the moved code UNCHANGED:

```ts
/**
 * Participant-channel model re-resolution for the two local providers.
 *
 * Lived in settingsStore.ts by historical accident: these functions read the
 * MODEL stores (modelStore / nativeModelStore) — readiness state — not
 * settings state. They sit beside the descriptors because the descriptors'
 * buildParticipantSessionConfig is their caller, and a descriptor must never
 * import settingsStore (settingsStore imports every descriptor; the reverse
 * edge is a cycle). Descriptor→model-store is established practice
 * (LocalNativeProviderConfig already imports useNativeModelStore).
 */
```

Move the two exported functions + their private helpers verbatim; carry over exactly the imports their bodies need (from the settingsStore import list: model stores, `estimateModelMemoryByDevice`, `autoSelectNative`, `hardwareGated`, nativeCatalog/modelManifest imports, types). Do not edit any logic line.

- [ ] **Step 3: Re-export from settingsStore**

Where the two functions were, leave:

```ts
// Moved beside the descriptors (their caller since the S2 participant-config
// seam); re-exported here so existing importers keep working.
export { createParticipantLocalInferenceConfig, createParticipantLocalNativeConfig } from '../services/providers/localParticipantConfig';
```

Check `settingsStore.ts` still compiles without the moved private helpers (if any remaining settingsStore code used `readDebugNumber` etc., that helper does NOT move — export it from the new module's location instead, or leave it and import it; decide by grep, state the decision in the report).

- [ ] **Step 4: Run the suite**

Run: `npx vitest run src/stores/settingsStore.test.ts` then `npx vitest run`
Expected: all pass, unchanged test files.

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/localParticipantConfig.ts src/stores/settingsStore.ts
git commit -m "refactor(providers): move local participant-config helpers beside their caller

They read the model stores, not settings state; settingsStore re-exports
for existing importers. Prepares the S2 participant-config seam, whose
local overrides must call these without a descriptor→settingsStore cycle."
```

---

### Task 2: The seam — result type, base implementation, registry smoke test

**Files:**
- Modify: `src/services/providers/ProviderDescriptor.ts`
- Test: `src/services/providers/descriptorRegistry.test.ts`

**Interfaces:**
- Produces (all later tasks build on these exact names):

```ts
export interface ParticipantNotice {
  channel: 'error' | 'warning' | 'info';
  message: string;
}

export interface ParticipantSessionResult {
  /** null ⇒ this provider cannot run a participant leg right now; MainPanel
   *  maps null to the participant-skip path (splitParticipantFailure =
   *  'no-participant-config'). */
  config: SessionConfig | null;
  /** User-facing participant.error/.warning/.info events. Emitting them is
   *  MainPanel's job (side effects stay in the component). */
  notices: ParticipantNotice[];
}
```

- [ ] **Step 1: Write the failing registry smoke test**

Append to `descriptorRegistry.test.ts` (house pattern: iterate registry, per-id message):

```ts
describe('S2 buildParticipantSessionConfig', () => {
  it('every descriptor answers with a ParticipantSessionResult shape', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const slice = DEFAULTS_BY_SLICE[d.settingsSliceKey];
      const res = d.buildParticipantSessionConfig(slice, 'instr', { keepReplayAudio: false });
      expect(Array.isArray(res.notices), `notices array for ${id}`).toBe(true);
      if (res.config !== null) {
        expect(res.config.textOnly, `participant textOnly for ${id}`).toBe(true);
        expect(res.config.keepReplayAudio, `keepReplayAudio for ${id}`).toBe(false);
      }
    }
  });
});
```

(For the two local providers this exercises the real relocated helpers against empty model stores — a null + error notice is a valid shape here; the test asserts shape, not values. If store state leaks between tests, reset via the same mechanism settingsStore.test.ts's local blocks use — copy its setup.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/providers/descriptorRegistry.test.ts`
Expected: FAIL — `buildParticipantSessionConfig` is not a function.

- [ ] **Step 3: Add types + base implementation**

In `ProviderDescriptor.ts`: add the two interfaces above (exported, beside `ClientOptions`), the method on the `ProviderDescriptor` interface:

```ts
  /**
   * Session config for the participant (reverse-direction) channel.
   *
   * Base: buildSessionConfig(slice, swappedInstructions) + the generic
   * participant overrides — textOnly is forced true (the participant leg
   * never speaks), turn detection is overridden to OpenAI-shaped semantic
   * VAD (providers that don't read the field ignore it, exactly as before
   * the extraction). Providers whose direction lives in config fields
   * override to also reverse those fields.
   */
  buildParticipantSessionConfig(
    slice: unknown,
    swappedInstructions: string,
    shell: { keepReplayAudio: boolean },
  ): ParticipantSessionResult;
```

and in `BaseProviderDescriptor`:

```ts
  buildParticipantSessionConfig(
    slice: unknown,
    swappedInstructions: string,
    shell: { keepReplayAudio: boolean },
  ): ParticipantSessionResult {
    const config = {
      ...this.buildSessionConfig(slice, swappedInstructions),
      keepReplayAudio: shell.keepReplayAudio,
      textOnly: true,
      // Override turn detection to use semantic VAD for participant audio (OpenAI-compatible)
      turnDetection: {
        type: 'semantic_vad' as const,
        createResponse: true,
        interruptResponse: false,
        eagerness: 'high',
      },
    } as SessionConfig;
    return { config, notices: [] };
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/services/providers/descriptorRegistry.test.ts` then `npx vitest run`
Expected: PASS. (If the local descriptors' inherited base passes the shape test trivially now — they override in Task 5 — that is fine.)

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/ProviderDescriptor.ts src/services/providers/descriptorRegistry.test.ts
git commit -m "feat(providers): buildParticipantSessionConfig seam with base implementation"
```

---

### Task 3: Field-swap overrides — volcengine_ast2, soniox, palabraai, volcengine_st, zoom_ai

**Files:**
- Modify: `src/services/providers/VolcengineAST2ProviderConfig.ts`, `SonioxProviderConfig.ts`, `PalabraAIProviderConfig.ts`, `VolcengineSTProviderConfig.ts`, `ZoomAIProviderConfig.ts`
- Test: `src/services/providers/participantConfig.test.ts` (new)

**Interfaces:**
- Consumes: `ParticipantSessionResult`, base `buildParticipantSessionConfig` (Task 2).

- [ ] **Step 1: Write the failing table test**

`src/services/providers/participantConfig.test.ts` — environment vi.mock preamble copied from `speechMode.test.ts`, then:

```ts
import { ProviderConfigFactory } from './ProviderConfigFactory';
import { Provider } from '../../types/Provider';
import { defaultSonioxSettings } from './SonioxProviderConfig';
import { defaultVolcengineAST2Settings } from './VolcengineAST2ProviderConfig';
import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
import { defaultVolcengineSTSettings } from './VolcengineSTProviderConfig';
import { defaultZoomAISettings } from './ZoomAIProviderConfig';

const shell = { keepReplayAudio: false };

describe('participant config: direction lives in config fields', () => {
  it('soniox swaps sourceLanguage/targetLanguage', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.SONIOX);
    const slice = { ...defaultSonioxSettings, sourceLanguage: 'zh', targetLanguage: 'en' };
    const base = d.buildSessionConfig(slice, 'i') as { sourceLanguage?: string; targetLanguage?: string };
    const { config, notices } = d.buildParticipantSessionConfig(slice, 'i', shell);
    const c = config as { sourceLanguage?: string; targetLanguage?: string; textOnly?: boolean };
    expect(c.sourceLanguage).toBe(base.targetLanguage);
    expect(c.targetLanguage).toBe(base.sourceLanguage);
    expect(c.textOnly).toBe(true);
    expect(notices).toEqual([]);
  });

  it('volcengine_ast2 swaps sourceLanguage/targetLanguage (twin inherits)', () => {
    for (const id of [Provider.VOLCENGINE_AST2, Provider.KIZUNA_AI_VOLCENGINE_AST2]) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const slice = { ...defaultVolcengineAST2Settings, sourceLanguage: 'ja', targetLanguage: 'ko' };
      const base = d.buildSessionConfig(slice, 'i') as { sourceLanguage?: string; targetLanguage?: string };
      const c = d.buildParticipantSessionConfig(slice, 'i', shell).config as { sourceLanguage?: string; targetLanguage?: string };
      expect(c.sourceLanguage, `swap for ${id}`).toBe(base.targetLanguage);
      expect(c.targetLanguage, `swap for ${id}`).toBe(base.sourceLanguage);
    }
  });

  it('palabraai swaps sourceLanguage/targetLanguage', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.PALABRA_AI);
    const slice = { ...defaultPalabraAISettings, sourceLanguage: 'en', targetLanguage: 'es-mx' };
    const base = d.buildSessionConfig(slice, 'i') as { sourceLanguage?: string; targetLanguage?: string };
    const c = d.buildParticipantSessionConfig(slice, 'i', shell).config as { sourceLanguage?: string; targetLanguage?: string };
    expect(c.sourceLanguage).toBe(base.targetLanguage);
    expect(c.targetLanguage).toBe(base.sourceLanguage);
  });

  it('volcengine_st and zoom_ai rotate sourceLanguage through targetLanguages[0]', () => {
    for (const [id, defaults] of [
      [Provider.VOLCENGINE_ST, defaultVolcengineSTSettings],
      [Provider.ZOOM_AI, defaultZoomAISettings],
    ] as const) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const slice = { ...defaults };
      const base = d.buildSessionConfig(slice, 'i') as { sourceLanguage: string; targetLanguages: string[] };
      const c = d.buildParticipantSessionConfig(slice, 'i', shell).config as { sourceLanguage: string; targetLanguages: string[] };
      expect(c.sourceLanguage, `rotate for ${id}`).toBe(base.targetLanguages[0] || base.sourceLanguage);
      expect(c.targetLanguages, `rotate for ${id}`).toEqual([base.sourceLanguage]);
    }
  });
});
```

Run: `npx vitest run src/services/providers/participantConfig.test.ts` — Expected: FAIL (base impl doesn't swap).

- [ ] **Step 2: Add the five overrides**

Each override calls `super.buildParticipantSessionConfig(...)` then mutates its config — the branch code AND comment move verbatim from MainPanel. Pattern (Soniox shown; replicate per provider with its own branch body from `createParticipantSessionConfig` in `src/components/MainPanel/MainPanel.tsx` — locate each by grepping its comment):

```ts
  buildParticipantSessionConfig(
    slice: unknown,
    swappedInstructions: string,
    shell: { keepReplayAudio: boolean },
  ): ParticipantSessionResult {
    const result = super.buildParticipantSessionConfig(slice, swappedInstructions, shell);
    // Soniox carries direction in sourceLanguage/targetLanguage; reverse it so the
    // participant translates the other party's speech into the user's language.
    const sx = result.config as SonioxSessionConfig;
    [sx.sourceLanguage, sx.targetLanguage] = [sx.targetLanguage, sx.sourceLanguage];
    return result;
  }
```

- VolcengineAST2: same swap, with the original "Volcengine providers carry language direction in explicit config fields…" comment. (The kizuna twin inherits the override — no twin edit.)
- PalabraAI: same swap, with the FULL code-space comment block (API strips region suffix; the five sources that aren't valid targets; VALIDATION_ERROR surfacing) moved verbatim.
- VolcengineST and ZoomAI: the `oldSource` rotation bodies verbatim (`st.sourceLanguage = st.targetLanguages[0] || oldSource; st.targetLanguages = [oldSource];`).
Each file imports `ParticipantSessionResult` from `./ProviderDescriptor` and its own SessionConfig subtype from `../interfaces/IClient` (most already do).

- [ ] **Step 3: Run to verify pass, then full suite**

Run: `npx vitest run src/services/providers/participantConfig.test.ts` then `npx vitest run`
Expected: PASS / all green.

- [ ] **Step 4: Commit**

```bash
git add src/services/providers/VolcengineAST2ProviderConfig.ts src/services/providers/SonioxProviderConfig.ts src/services/providers/PalabraAIProviderConfig.ts src/services/providers/VolcengineSTProviderConfig.ts src/services/providers/ZoomAIProviderConfig.ts src/services/providers/participantConfig.test.ts
git commit -m "feat(providers): participant direction reversal for the field-swap providers"
```

---

### Task 4: Helper-based overrides — gemini, openai family, openai_translate

**Files:**
- Modify: `src/services/providers/GeminiProviderConfig.ts`, `OpenAIProviderConfig.ts`, `OpenAITranslateProviderConfig.ts`
- Test: extend `src/services/providers/participantConfig.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `participantConfig.test.ts`:

```ts
describe('participant config: helper-based reversals', () => {
  it('gemini forces turnDetectionMode Auto and reverses translationConfig when present', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.GEMINI);
    const slice = { ...defaultGeminiSettings };
    const { config } = d.buildParticipantSessionConfig(slice, 'i', shell);
    const c = config as GeminiSessionConfig & { turnDetectionMode?: string };
    expect(c.turnDetectionMode).toBe('Auto');
    // Behavioural equality with the helper is asserted exactly: applying
    // reverseGeminiTranslationDirection to a fresh base+overrides copy must
    // yield the same object.
    const expected = {
      ...d.buildSessionConfig(slice, 'i'),
      keepReplayAudio: false,
      textOnly: true,
      turnDetection: { type: 'semantic_vad', createResponse: true, interruptResponse: false, eagerness: 'high' },
      turnDetectionMode: 'Auto',
    } as GeminiSessionConfig;
    reverseGeminiTranslationDirection(expected);
    expect(c).toEqual(expected);
  });

  it('openai and openai_compatible rebuild the transcription hint for the reversed direction', () => {
    for (const id of [Provider.OPENAI, Provider.OPENAI_COMPATIBLE]) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const slice = { ...DEFAULTS_BY_SLICE_LOCAL[d.settingsSliceKey] };
      const { config } = d.buildParticipantSessionConfig(slice, 'i', shell);
      const expected = {
        ...d.buildSessionConfig(slice, 'i'),
        keepReplayAudio: false,
        textOnly: true,
        turnDetection: { type: 'semantic_vad', createResponse: true, interruptResponse: false, eagerness: 'high' },
      } as OpenAISessionConfig;
      reverseTranscriptionDirection(expected);
      expect(config, `hint reversal for ${id}`).toEqual(expected);
    }
  });

  it('openai_translate swaps targetLanguage to the old sourceLanguage', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.OPENAI_TRANSLATE);
    const slice = { ...defaultOpenAITranslateSettings, sourceLanguage: 'ja', targetLanguage: 'en' };
    const base = d.buildSessionConfig(slice, 'i') as OpenAITranslateSessionConfig;
    const c = d.buildParticipantSessionConfig(slice, 'i', shell).config as OpenAITranslateSessionConfig;
    expect(c.targetLanguage).toBe(base.sourceLanguage ?? base.targetLanguage);
    expect(c.sourceLanguage).toBe(base.targetLanguage);
  });
});
```

Add the needed imports (`defaultGeminiSettings`, `defaultOpenAITranslateSettings`, the two reversal helpers, the SessionConfig subtypes, and a small local `DEFAULTS_BY_SLICE_LOCAL` for the two openai slices — copy the mapping style from `descriptorRegistry.test.ts`).

Run: expect FAIL.

- [ ] **Step 2: Add the three overrides**

- `GeminiProviderConfig`: override = `super.build…` + spread `turnDetectionMode: 'Auto'` (with the "Force Auto mode for Gemini participant (no PTT for participant)" comment) + `reverseGeminiTranslationDirection(config)` with the full "Gemini's dialogue models need nothing here…" comment moved verbatim. Import the helper from its module (`./geminiTranslateModel` — same directory).
- `OpenAIProviderConfig`: override = `super…` + `reverseTranscriptionDirection(config)` with the full "OpenAI (and its compatible/Kizuna twins) carry the direction in `instructions`…" comment. OpenAI-Compatible inherits the override (its `config.provider` tag `cometapi` was only ever a MainPanel dispatch key; the override runs for both by inheritance).
- `OpenAITranslateProviderConfig`: override = `super…` + the target/source swap body and its full comment ("OpenAI Translate carries language direction only in `audio.output.language`…", the cast rationale included).

- [ ] **Step 3: Run tests + full suite**

Run: `npx vitest run src/services/providers/participantConfig.test.ts` then `npx vitest run`
Expected: PASS / all green.

- [ ] **Step 4: Commit**

```bash
git add src/services/providers/GeminiProviderConfig.ts src/services/providers/OpenAIProviderConfig.ts src/services/providers/OpenAITranslateProviderConfig.ts src/services/providers/participantConfig.test.ts
git commit -m "feat(providers): participant reversal for gemini, openai family, openai_translate"
```

---

### Task 5: Local overrides — null paths and notices

**Files:**
- Modify: `src/services/providers/LocalInferenceProviderConfig.ts`, `LocalNativeProviderConfig.ts`
- Test: extend `src/services/providers/participantConfig.test.ts`

**Interfaces:**
- Consumes: the relocated helpers (Task 1) and `ParticipantNotice` (Task 2).

- [ ] **Step 1: Write the failing tests**

Mock the helper module so store state is irrelevant, mirroring how `settingsStore.test.ts` drives the same outcomes:

```ts
vi.mock('./localParticipantConfig', () => ({
  createParticipantLocalInferenceConfig: vi.fn(),
  createParticipantLocalNativeConfig: vi.fn(),
}));
```

Cases (drive the mocks per case, assert the mapping):
- local_inference success + translationAvailable + no asrFallback → `{ config: result.config, notices: [] }`
- local_inference failure reason 'memory_exceeded' → `{ config: null, notices: [{ channel: 'warning', message: detail }] }`
- local_inference failure other reason → `{ config: null, notices: [{ channel: 'error', message: detail }] }`
- local_inference success, `translationAvailable: false` → notice `{ channel: 'warning', message: 'No translation model for <target> → <source> — transcription only' }` (exact template from the old branch)
- local_inference success, `asrFallback` → notice `{ channel: 'info', message: 'Using <asrModelId> instead of <asrOriginalModelId> for ASR' }`
- local_native failure → `{ config: null, notices: [{ channel: 'error', message: detail }] }`
- local_native success, `translationAvailable: false` → warning with the native template (`No translation model for <source> → <target> — transcription only` — NOTE the direction differs from local_inference's template; preserve each verbatim)
- both: the helper receives the BASE participant config (textOnly/semantic-vad already applied) as its argument, same as the old switch passed it.

Run: expect FAIL.

- [ ] **Step 2: Add the two overrides**

Each override: `const base = super.buildParticipantSessionConfig(...)`, call its helper with `base.config as <X>SessionConfig`, translate the result-object exactly as the old branch did — but **collect notices instead of calling addRealtimeEvent** (that was the reviewer-mandated design change; MainPanel emits them). Move the old branch comments verbatim (local_native's "Native ASR/translate carry the translation direction in sourceLanguage/targetLanguage AND in the chosen model ids…" note). Import the helpers from `'./localParticipantConfig'`.

- [ ] **Step 3: Run tests + full suite**

Expected: PASS / all green.

- [ ] **Step 4: Commit**

```bash
git add src/services/providers/LocalInferenceProviderConfig.ts src/services/providers/LocalNativeProviderConfig.ts src/services/providers/participantConfig.test.ts
git commit -m "feat(providers): local participant overrides return null-or-config plus notices"
```

---

### Task 6: Golden equivalence test — old switch vs new seam

**Files:**
- Create: `src/services/providers/participantConfigGolden.test.ts` (temporary; retired in Task 8)

- [ ] **Step 1: Build the fixture**

Copy the ENTIRE body of `createParticipantSessionConfig` from `src/components/MainPanel/MainPanel.tsx` (grep `Helper to create session config for participant mode`) into the test file as a plain function, with EXACTLY these mechanical adaptations and no others:
1. Signature: `function oldCreateParticipantSessionConfig(provider: Provider, slice: unknown, swappedInstructions: string, shell: { textOnly: boolean; keepReplayAudio: boolean }, notices: ParticipantNotice[]): SessionConfig | null`
2. The instructions ternary at the top is DELETED (both paths reduce to the passed `swappedInstructions` string — the old code chose which builder produced it; the golden compares downstream of that choice, which S1 already made capability-driven).
3. `createSessionConfig(swappedSystemInstructions)` → inline what settingsStore's `createSessionConfig` does: `const cfg = ProviderConfigFactory.getDescriptor(provider).buildSessionConfig(slice, swappedInstructions); (cfg as SessionConfig).textOnly = shell.textOnly; (cfg as SessionConfig).keepReplayAudio = shell.keepReplayAudio; const baseConfig = cfg;`
4. Every `addRealtimeEvent({ type: 'participant.X', data: { message } }, 'client', 'participant.X')` → `notices.push({ channel: '<X>', message })` where X maps error/warning/info.
5. Imports: the two reversal helpers, the two local helpers (from `'./localParticipantConfig'`), the SessionConfig subtypes — same modules the real code uses.

- [ ] **Step 2: Write the comparison**

```ts
describe('GOLDEN: buildParticipantSessionConfig ≡ old createParticipantSessionConfig', () => {
  const shell = { textOnly: false, keepReplayAudio: false };
  it('produces identical config and notices for every registered descriptor on default slices', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const slice = DEFAULTS_BY_SLICE[d.settingsSliceKey];
      const oldNotices: ParticipantNotice[] = [];
      const oldConfig = oldCreateParticipantSessionConfig(id, slice, 'swapped-instr', shell, oldNotices);
      const res = d.buildParticipantSessionConfig(slice, 'swapped-instr', { keepReplayAudio: shell.keepReplayAudio });
      expect(res.config, `config equal for ${id}`).toEqual(oldConfig);
      expect(res.notices, `notices equal for ${id}`).toEqual(oldNotices);
    }
  });
});
```

Plus mocked-local variants: with `vi.mock('./localParticipantConfig')` driving each of the local outcome shapes from Task 5, run BOTH paths against the same mock and assert config+notices equality (this proves the null/notice mapping, which default slices can't reach deterministically). Also add non-default-direction slices for the swap providers (soniox zh→en, ast2 ja→ko, palabra en→es-mx, translate ja→en) to exercise the swaps against real values. Copy `DEFAULTS_BY_SLICE` construction from `descriptorRegistry.test.ts` (same imports), plus the environment vi.mock preamble.

- [ ] **Step 3: Run**

Run: `npx vitest run src/services/providers/participantConfigGolden.test.ts`
Expected: PASS. Any mismatch is a Task 2-5 bug — fix THERE, never by adjusting the fixture (the fixture is the oracle).

- [ ] **Step 4: Commit**

```bash
git add src/services/providers/participantConfigGolden.test.ts
git commit -m "test(providers): golden equivalence of the participant seam against the old switch"
```

---

### Task 7: MainPanel replacement — delete the switch

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Replace the function body**

`createParticipantSessionConfig` (grep its doc comment) becomes:

```ts
  /**
   * Session config for the participant channel. All per-provider direction
   * reversal lives in the descriptors (buildParticipantSessionConfig); this
   * callback owns only the store reads and the side effects — emitting the
   * descriptor's notices and returning null for the participant-skip path.
   */
  const createParticipantSessionConfig = useCallback((): SessionConfig | null => {
    const descriptor = ProviderConfigFactory.getDescriptor(provider);
    const swappedSystemInstructions = descriptor.getConfig().capabilities.usesLocalPromptTemplate
      ? getProcessedLocalPrompt(true)
      : getProcessedSystemInstructions(true);
    const slice = useSettingsStore.getState()[descriptor.settingsSliceKey as keyof SettingsStore];
    const { config, notices } = descriptor.buildParticipantSessionConfig(slice, swappedSystemInstructions, {
      keepReplayAudio: useSettingsStore.getState().keepReplayAudio,
    });
    for (const n of notices) {
      const type = `participant.${n.channel === 'error' ? 'error' : n.channel === 'warning' ? 'warning' : 'info'}` as const;
      addRealtimeEvent({ type, data: { message: n.message } }, 'client', type);
    }
    return config;
  }, [provider, getProcessedLocalPrompt, getProcessedSystemInstructions, addRealtimeEvent]);
```

Then delete the now-unused MainPanel imports: `reverseTranscriptionDirection`, `reverseGeminiTranslationDirection`, `createParticipantLocalInferenceConfig`, `createParticipantLocalNativeConfig`, and any SessionConfig subtype imports used ONLY by the deleted branches (grep each before removing; `GeminiSessionConfig`, `OpenAITranslateSessionConfig`, `TranslateTargetLanguage`, `VolcengineAST2SessionConfig`, `VolcengineSTSessionConfig`, `ZoomAISessionConfig`, `PalabraAISessionConfig`, `LocalNativeSessionConfig`, `LocalInferenceSessionConfig`, `OpenAISessionConfig` are candidates — keep any that other code still uses; `SonioxSessionConfig` is used elsewhere). Also verify `createSessionConfig` (the hook value) is still used by `getSessionConfig` — it is; keep it and drop it only from THIS callback's deps.

Note the deliberate change: the shell's `textOnly` no longer feeds the participant path at all (the old code read it then overrode to true; the base seam forces true). The golden test already proved output equality.

- [ ] **Step 2: Verify and gate**

- `grep -n "reverseTranscriptionDirection\|reverseGeminiTranslationDirection\|createParticipantLocalInferenceConfig\|createParticipantLocalNativeConfig" src/components/MainPanel/MainPanel.tsx` → no hits.
- `npx vitest run` → all green (golden still passing proves equivalence held through the replacement).
- `npx vite build` → success.

- [ ] **Step 3: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(mainpanel): participant session config comes from the descriptors

The 11-branch direction-reversal switch is gone; each provider's
reversal (comments included) lives in its descriptor's
buildParticipantSessionConfig override. MainPanel keeps the store reads,
emits the descriptor's notices, and maps null to the participant-skip
path — side effects stay in the component."
```

---

### Task 8: Stage close-out

**Files:**
- Delete: `src/services/providers/participantConfigGolden.test.ts`
- Modify: ledger only (no code)

- [ ] **Step 1: Retire the golden fixture**

The golden test's oracle (the copied old switch) is now dead code duplicating eleven descriptors' logic — exactly what this stage removed from MainPanel. The durable coverage lives in `participantConfig.test.ts` (per-provider) + `descriptorRegistry.test.ts` (shape). Delete the golden file.

```bash
git rm src/services/providers/participantConfigGolden.test.ts
```

- [ ] **Step 2: Final sweep and gates**

- Generic sweep: `grep -nE "Provider\.[A-Z_]+" src/components/MainPanel/MainPanel.tsx` — classify every hit; all must be S3+ territory (analytics fallbacks, kizuna-soniox lease/voice-prep, local revalidation, both-mode plan). Any participant/direction-related hit = BLOCKED.
- `grep -n "config.provider === " src/components/MainPanel/MainPanel.tsx` → no hits (the switch was the only user).
- `npx vitest run` → all green. `npx vite build` → success.

- [ ] **Step 3: Commit**

```bash
git commit -m "test(providers): retire the participant golden fixture

The per-provider tests and the registry shape invariant are the durable
coverage; the fixture was a verbatim copy of the deleted MainPanel
switch, kept only to prove old ≡ new before the deletion landed."
```

---

## Self-review notes (already applied)

- **Spec coverage**: S2 spec = result type ✓ (T2), base + overrides with comments ✓ (T2-5), golden ✓ (T6), MainPanel null/notice mapping ✓ (T7), capture retired ✓ (T8). The helper relocation (T1) is S2-enabling work the spec's import-cycle analysis (S4 finding) implied but did not stage; it is named here as such.
- **Deliberate deltas from the old code**, each proven equivalent by the golden: notices replace direct addRealtimeEvent calls (reviewer-mandated); the dead `textOnly` shell read disappears; `config.provider === 'cometapi'` dispatch becomes OpenAI-family inheritance.
- **Type consistency**: `ParticipantNotice`/`ParticipantSessionResult`/`buildParticipantSessionConfig(slice, swappedInstructions, shell)` used identically in T2-T7.
