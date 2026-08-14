# MainPanel Seams S1 — Capability Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace six provider-identity dispatch ladders in `MainPanel.tsx` (and the one mirror in `SubtitleApp.tsx`) with static capability flags on `ProviderCapabilities`, so speech-mode vocabulary, PTT finalization, text input, text queueing, prompt-template source, and forced transport are answered by each provider's descriptor.

**Architecture:** Stage S1 of `docs/superpowers/specs/2026-08-13-mainpanel-provider-seams-design.md`. Six optional fields on `ProviderCapabilities` (only deviating descriptors declare them; twins inherit via their `...base` spread in `getConfig()`), one new pure predicate module (`speechMode.ts`, shared by both React trees), expectation-table invariants in `descriptorRegistry.test.ts`, then call-site replacement + deletion of the old ladders.

**Tech Stack:** TypeScript, React, zustand, vitest 4.

## Global Constraints

- Repo/worktree: `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/soniox-tts-v2`, branch `refactor/mainpanel-provider-seams`. All paths below are relative to that root.
- **Zero behavior change** for any UI-reachable state. The one sanctioned tightening: a `turnDetectionMode` value stored outside a provider's own settings-type vocabulary (unreachable via UI) no longer counts as push-gated for that provider — noted in Task 1.
- Full suite green at the end of every task: `npx vitest run` (2489+ tests). Production build must pass at the end of the stage: `npx vite build`.
- Rationale comments at replaced call sites **move with the code**, not get deleted.
- No new `Provider.X` comparisons anywhere. No new imports of provider-specific modules into `MainPanel.tsx`.
- Line numbers cited are valid at branch point `5d4633fa` + spec commit; verify with the quoted code before editing (grep the identifier if the line has drifted).
- Commit after every task; message style `refactor(providers): …` / `test(providers): …` matching repo history. Do not push; do not open PRs.

---

### Task 1: Capability fields + descriptor declarations + registry invariants

**Files:**
- Modify: `src/services/providers/ProviderConfig.ts` (interface, after `hasTranscriptKeywords`)
- Modify: `src/services/providers/OpenAIProviderConfig.ts` (capabilities literal at ~L279)
- Modify: `src/services/providers/GeminiProviderConfig.ts` (~L176)
- Modify: `src/services/providers/LocalInferenceProviderConfig.ts` (~L138)
- Modify: `src/services/providers/LocalNativeProviderConfig.ts` (~L186)
- Modify: `src/services/providers/VolcengineAST2ProviderConfig.ts` (~L133)
- Modify: `src/services/providers/PalabraAIProviderConfig.ts` (~L286)
- Test: `src/services/providers/descriptorRegistry.test.ts`

**Interfaces:**
- Consumes: existing `ProviderCapabilities`, `TransportType` (from `./ProviderDescriptor`).
- Produces: the six optional fields below, declared on exactly the descriptors listed; every later task reads them via `getDescriptor(p).getConfig().capabilities`.

- [ ] **Step 1: Write the failing expectation-table test**

Append to `src/services/providers/descriptorRegistry.test.ts`, following the file's existing pattern (iterate `ProviderConfigFactory.getAvailableProviders()`, look up a hand-written `Record<Provider, T>`, pass a per-id message to `expect`):

```ts
describe('S1 capability flags', () => {
  const PUSH_GATED: Record<Provider, string[] | undefined> = {
    [Provider.OPENAI]: ['Disabled', 'Push-to-Translate'],
    [Provider.OPENAI_COMPATIBLE]: ['Disabled', 'Push-to-Translate'], // inherited from OpenAI via ...base
    [Provider.GEMINI]: ['Push-to-Talk', 'Push-to-Translate'],
    [Provider.LOCAL_INFERENCE]: ['Push-to-Talk', 'Push-to-Translate'],
    [Provider.LOCAL_NATIVE]: ['Push-to-Talk', 'Push-to-Translate'],
    [Provider.VOLCENGINE_AST2]: ['Push-to-Talk', 'Push-to-Translate'],
    [Provider.KIZUNA_AI_VOLCENGINE_AST2]: ['Push-to-Talk', 'Push-to-Translate'], // twin spread
    [Provider.OPENAI_TRANSLATE]: undefined,
    [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: undefined,
    [Provider.SONIOX]: undefined,
    [Provider.KIZUNA_AI_SONIOX]: undefined,
    [Provider.PALABRA_AI]: undefined,
    [Provider.VOLCENGINE_ST]: undefined,
    [Provider.ZOOM_AI]: undefined,
  };

  const TEXT_INPUT: Record<Provider, boolean | undefined> = {
    [Provider.OPENAI]: true,
    [Provider.OPENAI_COMPATIBLE]: true, // inherited
    [Provider.GEMINI]: true,
    [Provider.LOCAL_INFERENCE]: true,
    [Provider.LOCAL_NATIVE]: true,
    [Provider.OPENAI_TRANSLATE]: undefined,
    [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: undefined,
    [Provider.SONIOX]: undefined,
    [Provider.KIZUNA_AI_SONIOX]: undefined,
    [Provider.VOLCENGINE_AST2]: undefined,
    [Provider.KIZUNA_AI_VOLCENGINE_AST2]: undefined,
    [Provider.PALABRA_AI]: undefined,
    [Provider.VOLCENGINE_ST]: undefined,
    [Provider.ZOOM_AI]: undefined,
  };

  const QUEUES_TEXT: Provider[] = [Provider.OPENAI, Provider.OPENAI_COMPATIBLE];
  const LOCAL_PROMPT: Provider[] = [Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE];

  const PTT_FINALIZATION: Record<Provider, { silenceTailFrames?: number; response: string } | undefined> = {
    [Provider.LOCAL_INFERENCE]: { silenceTailFrames: 7, response: 'always' },
    [Provider.LOCAL_NATIVE]: { silenceTailFrames: 7, response: 'always' },
    [Provider.VOLCENGINE_AST2]: { silenceTailFrames: 5, response: 'server-decides' },
    [Provider.KIZUNA_AI_VOLCENGINE_AST2]: { silenceTailFrames: 5, response: 'server-decides' }, // twin spread
    [Provider.GEMINI]: { response: 'voice-gated-cancel' },
    [Provider.OPENAI]: undefined,
    [Provider.OPENAI_COMPATIBLE]: undefined,
    [Provider.OPENAI_TRANSLATE]: undefined,
    [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: undefined,
    [Provider.SONIOX]: undefined,
    [Provider.KIZUNA_AI_SONIOX]: undefined,
    [Provider.PALABRA_AI]: undefined,
    [Provider.VOLCENGINE_ST]: undefined,
    [Provider.ZOOM_AI]: undefined,
  };

  it('declares pushGatedModes exactly where the settings vocabulary has push-gated modes', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(caps.pushGatedModes, `pushGatedModes for ${id}`).toEqual(PUSH_GATED[id]);
    }
  });

  it('pushGatedModes entries are unique non-empty strings', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const modes = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities.pushGatedModes;
      if (!modes) continue;
      expect(modes.length, `non-empty list for ${id}`).toBeGreaterThan(0);
      expect(new Set(modes).size, `no duplicates for ${id}`).toBe(modes.length);
      for (const m of modes) expect(m, `non-empty mode string for ${id}`).toBeTruthy();
    }
  });

  it('declares supportsTextInput on exactly the five whitelisted providers', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(caps.supportsTextInput, `supportsTextInput for ${id}`).toBe(TEXT_INPUT[id]);
    }
  });

  it('queuesTextWhileResponding only on providers that also support text input', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(!!caps.queuesTextWhileResponding, `queuesTextWhileResponding for ${id}`).toBe(QUEUES_TEXT.includes(id));
      if (caps.queuesTextWhileResponding) {
        expect(caps.supportsTextInput, `queueing implies text input for ${id}`).toBe(true);
      }
    }
  });

  it('usesLocalPromptTemplate only on the local providers', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(!!caps.usesLocalPromptTemplate, `usesLocalPromptTemplate for ${id}`).toBe(LOCAL_PROMPT.includes(id));
    }
  });

  it('pttFinalization matches the behavior table, with valid frame counts', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      expect(caps.pttFinalization, `pttFinalization for ${id}`).toEqual(PTT_FINALIZATION[id]);
      const frames = caps.pttFinalization?.silenceTailFrames;
      if (frames !== undefined) {
        expect(Number.isInteger(frames) && frames > 0, `positive integer frames for ${id}`).toBe(true);
      }
    }
  });

  it('forcedTransport only on PalabraAI, and it names a real transport', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const caps = ProviderConfigFactory.getDescriptor(id).getConfig().capabilities;
      if (id === Provider.PALABRA_AI) {
        expect(caps.forcedTransport, `forcedTransport for ${id}`).toBe('webrtc');
      } else {
        expect(caps.forcedTransport, `no forcedTransport for ${id}`).toBeUndefined();
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/providers/descriptorRegistry.test.ts`
Expected: FAIL — TypeScript errors on unknown capability properties (or `undefined` mismatches once fields exist). The pre-existing 30 tests still pass.

- [ ] **Step 3: Add the six fields to `ProviderCapabilities`**

In `src/services/providers/ProviderConfig.ts`, add `import type { TransportType } from './ProviderDescriptor';` at the top and append inside `ProviderCapabilities` after `hasTranscriptKeywords`:

```ts
  // ── S1 capability flags (spec: 2026-08-13-mainpanel-provider-seams) ──
  // Optional: only descriptors that deviate from the default declare them.
  // Kizuna twins and OpenAI-Compatible inherit via their `...base` spread.

  /** Speech-mode names from THIS provider's settings vocabulary that send
   *  audio only while the user holds Space. Encodes that 'Disabled' is
   *  OpenAI's spelling of push-to-talk. Undefined ⇒ no push-gated modes. */
  pushGatedModes?: string[];

  /** Provider accepts typed text input into a live session. Undefined ⇒ no. */
  supportsTextInput?: boolean;

  /** Text typed while the AI is responding is queued and flushed after
   *  response.done (capacity 1). Undefined ⇒ sent immediately. */
  queuesTextWhileResponding?: boolean;

  /** System instructions come from the local prompt template
   *  (getProcessedLocalPrompt) instead of the shared builder. Undefined ⇒ shared. */
  usesLocalPromptTemplate?: boolean;

  /** How a push-to-talk segment is finalized on release. Undefined ⇒
   *  { response: 'voice-gated' }: createResponse() only when enough voiced
   *  chunks were captured, otherwise skip.
   *  - silenceTailFrames: 100 ms zero frames appended first so a server/local
   *    VAD detects end-of-speech.
   *  - 'always': createResponse() unconditionally (local Silero VAD — for
   *    streaming ASR it flushes the pending utterance; for offline ASR it is
   *    harmless, the silence frames handle it).
   *  - 'server-decides': no client call; the server's own VAD closes the turn.
   *  - 'voice-gated-cancel': like the default, but too-little speech actively
   *    cancels the turn (cancelPttTurn) so no response is generated for silence. */
  pttFinalization?: {
    silenceTailFrames?: number;
    response: 'always' | 'server-decides' | 'voice-gated' | 'voice-gated-cancel';
  };

  /** Transport this provider must run on, overriding the user preference. */
  forcedTransport?: TransportType;
```

- [ ] **Step 4: Declare the flags on the six base descriptors**

Each edit appends to the existing `capabilities: { … }` literal (anchors: OpenAI ~L279, Gemini ~L176, LocalInference ~L138, LocalNative ~L186, VolcengineAST2 ~L133, PalabraAI ~L286). Do **not** touch OpenAICompatible/Kizuna twin files — they spread `...base`.

`OpenAIProviderConfig.ts`:
```ts
        // 'Disabled' is OpenAI's spelling of push-to-talk (the settings UI
        // renames it); 'Push-to-Translate' adds passthrough during idle.
        pushGatedModes: ['Disabled', 'Push-to-Translate'],
        supportsTextInput: true,
        queuesTextWhileResponding: true,
```

`GeminiProviderConfig.ts`:
```ts
        pushGatedModes: ['Push-to-Talk', 'Push-to-Translate'],
        supportsTextInput: true,
        // Too little speech actively cancels the turn so Gemini doesn't
        // generate a response for silence.
        pttFinalization: { response: 'voice-gated-cancel' },
```

`LocalInferenceProviderConfig.ts` and `LocalNativeProviderConfig.ts` (same block in both):
```ts
        pushGatedModes: ['Push-to-Talk', 'Push-to-Translate'],
        supportsTextInput: true,
        usesLocalPromptTemplate: true,
        // Silero VAD needs a 700 ms silence tail to detect end-of-speech;
        // createResponse always follows — for streaming ASR it flushes the
        // pending utterance, for offline ASR it is harmless.
        pttFinalization: { silenceTailFrames: 7, response: 'always' },
```

`VolcengineAST2ProviderConfig.ts`:
```ts
        pushGatedModes: ['Push-to-Talk', 'Push-to-Translate'],
        // 500 ms silence tail for the server VAD; AST2 creates the response
        // server-side, so the client never calls createResponse on release.
        pttFinalization: { silenceTailFrames: 5, response: 'server-decides' },
```

`PalabraAIProviderConfig.ts`:
```ts
        // LiveKit-based: always webrtc transport, regardless of the user's
        // transport preference. (Capture is still appendInputAudio — see
        // supportsWebRTC, which stays false.)
        forcedTransport: 'webrtc',
```

- [ ] **Step 5: Run the registry test, then the full suite**

Run: `npx vitest run src/services/providers/descriptorRegistry.test.ts`
Expected: PASS (30 pre-existing + 7 new).
Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/providers/ProviderConfig.ts src/services/providers/OpenAIProviderConfig.ts src/services/providers/GeminiProviderConfig.ts src/services/providers/LocalInferenceProviderConfig.ts src/services/providers/LocalNativeProviderConfig.ts src/services/providers/VolcengineAST2ProviderConfig.ts src/services/providers/PalabraAIProviderConfig.ts src/services/providers/descriptorRegistry.test.ts
git commit -m "feat(providers): S1 capability flags on ProviderCapabilities

Six optional fields — pushGatedModes, supportsTextInput,
queuesTextWhileResponding, usesLocalPromptTemplate, pttFinalization,
forcedTransport — declared on the six deviating base descriptors; twins
inherit through their ...base spread. Registry expectation tables pin
every descriptor's answer.

Stage S1 of docs/superpowers/specs/2026-08-13-mainpanel-provider-seams-design.md."
```

---

### Task 2: `speechMode.ts` pure predicate

**Files:**
- Create: `src/services/providers/speechMode.ts`
- Test: `src/services/providers/speechMode.test.ts`

**Interfaces:**
- Consumes: `ProviderConfigFactory.getDescriptor`, `capabilities.pushGatedModes` (Task 1).
- Produces: `isPushGatedMode(provider: ProviderType, mode: string): boolean` — Tasks 3 and 4 import it.

- [ ] **Step 1: Write the failing test**

`src/services/providers/speechMode.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isPalabraAIEnabled: () => true,
  isLocalNativeEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
  getRelayWsUrl: () => 'wss://r.example/v1',
}));

import { isPushGatedMode } from './speechMode';
import { Provider } from '../../types/Provider';

describe('isPushGatedMode', () => {
  it("treats 'Disabled' as push-gated for the OpenAI family only", () => {
    expect(isPushGatedMode(Provider.OPENAI, 'Disabled')).toBe(true);
    expect(isPushGatedMode(Provider.OPENAI_COMPATIBLE, 'Disabled')).toBe(true);
    expect(isPushGatedMode(Provider.GEMINI, 'Disabled')).toBe(false);
  });

  it("treats 'Push-to-Talk' and 'Push-to-Translate' as push-gated where the vocabulary has them", () => {
    for (const p of [Provider.GEMINI, Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE, Provider.VOLCENGINE_AST2]) {
      expect(isPushGatedMode(p, 'Push-to-Talk'), `PTT for ${p}`).toBe(true);
      expect(isPushGatedMode(p, 'Push-to-Translate'), `PTTr for ${p}`).toBe(true);
    }
    expect(isPushGatedMode(Provider.OPENAI, 'Push-to-Translate')).toBe(true);
  });

  it('never push-gated for providers without a speech-mode vocabulary (mode falls back to Auto)', () => {
    for (const p of [Provider.SONIOX, Provider.KIZUNA_AI_SONIOX, Provider.OPENAI_TRANSLATE, Provider.PALABRA_AI, Provider.VOLCENGINE_ST, Provider.ZOOM_AI]) {
      expect(isPushGatedMode(p, 'Auto'), `Auto for ${p}`).toBe(false);
      expect(isPushGatedMode(p, 'Push-to-Talk'), `PTT for ${p}`).toBe(false);
    }
  });

  it("'Auto' / 'Normal' / 'Semantic' are never push-gated", () => {
    expect(isPushGatedMode(Provider.OPENAI, 'Normal')).toBe(false);
    expect(isPushGatedMode(Provider.OPENAI, 'Semantic')).toBe(false);
    expect(isPushGatedMode(Provider.GEMINI, 'Auto')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/providers/speechMode.test.ts`
Expected: FAIL — cannot resolve `./speechMode`.

- [ ] **Step 3: Implement**

`src/services/providers/speechMode.ts`:
```ts
/**
 * Speech-mode vocabulary questions, answered from ProviderCapabilities.
 *
 * A mode is "push-gated" when audio reaches the provider only while the user
 * holds Space. Which mode NAMES mean that is per-provider vocabulary
 * ('Disabled' is OpenAI's spelling of push-to-talk), declared as
 * capabilities.pushGatedModes — this module is the one place that reads it,
 * shared by MainPanel and the subtitle window so the two can never disagree.
 */
import { ProviderConfigFactory } from './ProviderConfigFactory';
import type { ProviderType } from '../../types/Provider';

export function isPushGatedMode(provider: ProviderType, mode: string): boolean {
  const modes = ProviderConfigFactory.getDescriptor(provider).getConfig().capabilities.pushGatedModes;
  return modes?.includes(mode) ?? false;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/services/providers/speechMode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/providers/speechMode.ts src/services/providers/speechMode.test.ts
git commit -m "feat(providers): isPushGatedMode reads the vocabulary from capabilities"
```

---

### Task 3: Replace `isPttLikeMode` in MainPanel (both call families)

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx` (delete L109-116; edit ~L385-394 and ~L2360-2365)

**Interfaces:**
- Consumes: `isPushGatedMode` (Task 2). MainPanel already has `provider` in scope and imports nothing new besides the predicate.

- [ ] **Step 1: Delete the module-scope function**

Remove L109-116 (`isPttLikeMode` + its doc comment) and add the import next to the existing ProviderConfigFactory import (L29):

```ts
import { isPushGatedMode } from '../../services/providers/speechMode';
```

- [ ] **Step 2: Replace the `canHoldToSpeak` memo (~L385-394)**

```ts
  // True when the active mode uses space-hold to send audio (PTT, OpenAI's 'Disabled',
  // or Push-to-Translate). Derives directly from currentTurnDetectionMode so the
  // keyboard handler stays in sync with mode changes without imperative setters.
  const canHoldToSpeak = useMemo(
    () => isPushGatedMode(provider, currentTurnDetectionMode),
    [provider, currentTurnDetectionMode]
  );
```

(Note the added `provider` dep — the old function was vocabulary-global, the predicate is per-provider.)

- [ ] **Step 3: Replace the direct string comparison at ~L2360-2365**

Old:
```ts
        const isPushToTranslateMode = currentTurnDetectionMode === 'Push-to-Translate';
        const isPureManualMode =
          currentTurnDetectionMode === 'Disabled' || currentTurnDetectionMode === 'Push-to-Talk';
```
New (preserving the comment above it):
```ts
        const isPushToTranslateMode = currentTurnDetectionMode === 'Push-to-Translate';
        // Push-gated minus Push-to-Translate = key-hold-only ("pure manual").
        // 'Disabled' (OpenAI) and 'Push-to-Talk' (others) both land here, via
        // each provider's declared vocabulary instead of a hardcoded pair.
        const isPureManualMode =
          isPushGatedMode(provider, currentTurnDetectionMode) && !isPushToTranslateMode;
```

- [ ] **Step 4: Verify no `isPttLikeMode` remains and the suite passes**

Run: `grep -n "isPttLikeMode" src/ -r` → no hits.
Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(mainpanel): dispatch push-gated modes on capabilities, not vocabulary"
```

---

### Task 4: Replace the SubtitleApp mirror

**Files:**
- Modify: `src/components/Subtitle/SubtitleApp.tsx` (~L154-159; `provider` already in scope from `useProvider()` at L102)

**Interfaces:**
- Consumes: `isPushGatedMode` (Task 2). Import-hygiene note: SubtitleApp already loads the descriptor graph transitively through settingsStore, so this adds no new weight.

- [ ] **Step 1: Replace the inline mirror**

Old (L154-159):
```ts
  // Mirrors isPttLikeMode in MainPanel — modes that send audio only while
  // the user holds Space.
  const canHoldToSpeak =
    turnDetectionMode === 'Push-to-Talk' ||
    turnDetectionMode === 'Push-to-Translate' ||
    turnDetectionMode === 'Disabled';
```
New:
```ts
  // Modes that send audio only while the user holds Space — the same
  // capabilities-driven predicate MainPanel uses, so the two windows can
  // never disagree about what counts as push-gated.
  const canHoldToSpeak = isPushGatedMode(provider, turnDetectionMode);
```
Add the import: `import { isPushGatedMode } from '../../services/providers/speechMode';`

- [ ] **Step 2: Run the suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/Subtitle/SubtitleApp.tsx
git commit -m "refactor(subtitle): share the push-gated predicate instead of mirroring it"
```

---

### Task 5: `supportsTextInput` from capabilities

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx` (~L376-383)

- [ ] **Step 1: Replace the hardcoded whitelist**

Old:
```ts
  // supportsTextInput is true for providers that support text input
  const supportsTextInput = useMemo(() => {
    return provider === Provider.OPENAI ||
           provider === Provider.GEMINI ||
           provider === Provider.OPENAI_COMPATIBLE ||
           provider === Provider.LOCAL_INFERENCE ||
           provider === Provider.LOCAL_NATIVE;
  }, [provider]);
```
New:
```ts
  // Whether the text-input row renders is the provider's own claim.
  const supportsTextInput = useMemo(
    () => ProviderConfigFactory.getDescriptor(provider).getConfig().capabilities.supportsTextInput ?? false,
    [provider]
  );
```

- [ ] **Step 2: Run the suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(mainpanel): text-input availability from capabilities"
```

---

### Task 6: `queuesTextWhileResponding` from capabilities

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx` (~L3066 inside `handleSendText`)

- [ ] **Step 1: Replace the enum pair**

Old:
```ts
    // If AI is responding (OpenAI), queue the message for later
    if (isAIResponding && (provider === Provider.OPENAI || provider === Provider.OPENAI_COMPATIBLE)) {
```
New:
```ts
    // Providers that declare it queue text typed mid-response (capacity 1)
    // and flush it after response.done; everyone else sends immediately.
    // isAIResponding only ever becomes true for OpenAI-shaped clients
    // (response.created/.done), so this is belt-and-braces for them.
    if (isAIResponding && ProviderConfigFactory.getDescriptor(provider).getConfig().capabilities.queuesTextWhileResponding) {
```
Check the `useCallback` dep array for `handleSendText` still lists `provider` (it does today; keep it).

- [ ] **Step 2: Run the suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(mainpanel): mid-response text queueing from capabilities"
```

---

### Task 7: `usesLocalPromptTemplate` from capabilities

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx` (~L757-765 `getSessionConfig`, ~L934-938 `createParticipantSessionConfig`)

- [ ] **Step 1: Replace both ternaries**

At ~L757-765:
```ts
  const getSessionConfig = useCallback((): SessionConfig => {
    // Local providers build instructions from the local prompt template;
    // everyone else uses the shared system-instructions builder.
    const systemInstructions = ProviderConfigFactory.getDescriptor(provider).getConfig().capabilities.usesLocalPromptTemplate
      ? getProcessedLocalPrompt(false)
      : getProcessedSystemInstructions();

    // Use the type-safe createSessionConfig from SettingsContext
    return createSessionConfig(systemInstructions);
  }, [provider, getProcessedLocalPrompt, getProcessedSystemInstructions, createSessionConfig]);
```
At ~L934-938 (same substitution, `(true)` args):
```ts
    const swappedSystemInstructions = ProviderConfigFactory.getDescriptor(provider).getConfig().capabilities.usesLocalPromptTemplate
      ? getProcessedLocalPrompt(true)
      : getProcessedSystemInstructions(true);
```
Keep the dep arrays as they are (both already list `provider` and the two builders).

- [ ] **Step 2: Run the suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(mainpanel): instruction source from capabilities"
```

---

### Task 8: PTT finalization driven by `pttFinalization`

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx` (delete `usesLocalSileroVad` L118-122; rewrite the finalization block ~L2992-3047 inside `stopRecording`)

**Interfaces:**
- Consumes: `capabilities.pttFinalization` (Task 1). The `kizunaBaseProvider` normalization at the top of the block becomes unnecessary — twins inherit the capability through their `...base` spread — but **only for this block**; do not touch other `kizunaBaseProvider` uses.

- [ ] **Step 1: Delete `usesLocalSileroVad` (L118-122) and rewrite the block**

The block keeps its structure (recorder guard, `isPushToTranslate` pause gating, `MIN_VOICE_CHUNKS`); only the provider branching changes:

```ts
    try {
      const recorder = audioService.getRecorder();
      const isPushToTranslate = currentTurnDetectionMode === 'Push-to-Translate';

      // How this provider's PTT release is finalized is its descriptor's
      // claim. Twins inherit their base's declaration through the ...base
      // spread, which is what the old kizunaBaseProvider() normalization
      // here existed to reproduce.
      const finalization =
        ProviderConfigFactory.getDescriptor(provider).getConfig().capabilities.pttFinalization
        ?? { response: 'voice-gated' as const };

      // For Push-to-translate, recorder.isRecording() is always true (continuous capture).
      // For pure PTT, only proceed if the recorder was actually started by startRecording.
      if (recorder.isRecording()) {
        // Trailing silence frames help a server/local VAD detect end of speech.
        if (finalization.silenceTailFrames && client) {
          const silenceFrameSize = 2400; // 24kHz * 0.1s = 2400 samples per 100ms frame (client downsamples to 16kHz internally)
          for (let i = 0; i < finalization.silenceTailFrames; i++) {
            // New buffer each iteration — worker postMessage transfers (detaches) the ArrayBuffer
            client.appendInputAudio(new Int16Array(silenceFrameSize));
          }
          console.debug(`[Sokuji] [MainPanel] PTT: Sent ${finalization.silenceTailFrames * 100}ms silence frames for VAD end detection`);
        }

        // Stop recording — but only for pure PTT. Push-to-translate keeps the recorder
        // running; the unified passthrough useEffect will re-enable passthrough now that
        // isRecording is false (because of setIsRecording(false) earlier in stopRecording).
        if (!isPushToTranslate) {
          await audioService.pauseRecording();
        }

        // Only create response if we detected enough voice audio (prevents empty requests)
        const MIN_VOICE_CHUNKS = 5; // At least 5 non-silent chunks (~0.5 seconds of speech)
        if (client) {
          switch (finalization.response) {
            case 'always':
              // Local Silero VAD: for streaming ASR createResponse flushes the
              // pending utterance; for offline ASR it's harmless (silence frames handle it).
              client.createResponse();
              break;
            case 'server-decides':
              // The server's own VAD closes the turn; the client stays silent.
              break;
            case 'voice-gated-cancel':
              if (pttVoiceChunkCountRef.current >= MIN_VOICE_CHUNKS) {
                client.createResponse();
              } else {
                // No meaningful speech detected — reset speaking state without sending
                // activityEnd so the provider doesn't generate a response for silence.
                client.cancelPttTurn?.();
                console.debug(`[Sokuji] [MainPanel] PTT: turn cancelled - only ${pttVoiceChunkCountRef.current} voice chunks detected (minimum: ${MIN_VOICE_CHUNKS})`);
              }
              break;
            case 'voice-gated':
              if (pttVoiceChunkCountRef.current >= MIN_VOICE_CHUNKS) {
                // Model drift prevention is handled by the silent anchor mechanism (useEffect)
                client.createResponse();
              } else {
                console.debug(`[Sokuji] [MainPanel] PTT: Skipping response - only ${pttVoiceChunkCountRef.current} voice chunks detected (minimum: ${MIN_VOICE_CHUNKS})`);
              }
              break;
          }
        }
      }
    } catch (error) {
```
Keep the existing `catch` block and the `useCallback` deps `[isRecording, provider, currentTurnDetectionMode]` unchanged. If `kizunaBaseProvider` and/or `Provider` are now unused imports in MainPanel, leave them if other sites still use them (they do — verify with grep before removing anything).

- [ ] **Step 2: Verify equivalence by table**

The old→new mapping this rewrite must preserve (check each against the deleted code):
- local ×2 (and nothing else) got 7 frames + unconditional createResponse → `{7,'always'}` ✓
- VOLCENGINE_AST2 + its kizuna twin got 5 frames + no createResponse → `{5,'server-decides'}` + twin inherits ✓
- GEMINI got no frames + chunk-gated createResponse/cancelPttTurn → `{'voice-gated-cancel'}` ✓
- everyone else got no frames + chunk-gated createResponse/skip-log → default `'voice-gated'` ✓

Run: `grep -n "usesLocalSileroVad" src/ -r` → no hits.

- [ ] **Step 3: Run the suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(mainpanel): PTT finalization from capabilities

The silence-tail length and the release response policy were a
three-way enum ladder (local Silero, AST2 server VAD, Gemini
cancel-on-silence) plus a kizunaBaseProvider normalization that existed
only to make the twin inherit AST2's branch. All four behaviors are now
the descriptors' own pttFinalization claims; twins inherit through the
...base spread."
```

---

### Task 9: `forcedTransport` from capabilities

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx` (~L817-819 inside `createAIClient`)

- [ ] **Step 1: Replace the enum branch**

Old:
```ts
    // Determine transport type based on provider and useWebRTC flag.
    // For PalabraAI (LiveKit), treat as 'webrtc' mode for unified handling.
    const effectiveTransportType = (useWebRTC || provider === Provider.PALABRA_AI) ? 'webrtc' : 'websocket';
```
New:
```ts
    // Transport: the provider's own forcedTransport claim wins (PalabraAI's
    // LiveKit always runs webrtc regardless of the user preference);
    // otherwise the user's choice, already gated by supportsWebRTC upstream.
    const effectiveTransportType =
      descriptor.getConfig().capabilities.forcedTransport ?? (useWebRTC ? 'webrtc' : 'websocket');
```
(`descriptor` is already in scope in `createAIClient` — it is fetched a few lines above at ~L803.) The `usesNativeCapture` line directly below stays untouched.

- [ ] **Step 2: Run the suite and build**

Run: `npx vitest run`
Expected: all pass.
Run: `npx vite build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(mainpanel): transport override from capabilities"
```

---

### Task 10: `supportsWebRTC` re-documentation + stage close-out

**Files:**
- Modify: `src/services/providers/ProviderDescriptor.ts` (~L77, the `supportsWebRTC` doc comment)
- Modify: `docs/superpowers/specs/2026-08-13-mainpanel-provider-seams-design.md` (two corrections)

- [ ] **Step 1: Re-document `supportsWebRTC`**

Old:
```ts
  /** True for providers that can run over WebRTC transport. */
  readonly supportsWebRTC: boolean;
```
New:
```ts
  /** True when the CLIENT owns audio capture over WebRTC transport
   *  (MediaStreamTrack) and MainPanel must not start the native recorder.
   *  NOT "can run over webrtc": PalabraAI always runs webrtc transport yet
   *  declares false, because its capture path is appendInputAudio. See
   *  capabilities.forcedTransport for transport selection. */
  readonly supportsWebRTC: boolean;
```

- [ ] **Step 2: Correct the spec against implementation findings**

In `docs/superpowers/specs/2026-08-13-mainpanel-provider-seams-design.md`:
1. Replace the invariant `pushGatedModes ⊆ capabilities.turnDetection.modes` with: `pushGatedModes entries are unique non-empty strings drawn from the provider's settings vocabulary (turnDetection.modes is a settings-UI list — often empty — and is NOT a superset of the speech-mode vocabulary)`.
2. In the Tier-1 `pttFinalization` sketch, replace `response: 'always' | 'server-decides'` with `response: 'always' | 'server-decides' | 'voice-gated' | 'voice-gated-cancel'` (the implemented reality: Gemini cancels on silence; the default is voice-gated).

- [ ] **Step 3: Final S1 sweep**

Run and verify:
- `grep -nE "Provider\.(OPENAI|GEMINI|LOCAL_INFERENCE|LOCAL_NATIVE|VOLCENGINE_AST2|PALABRA_AI|OPENAI_COMPATIBLE)\b" src/components/MainPanel/MainPanel.tsx` — none of the hits belong to the six S1 mechanisms (remaining hits are S2+ territory: participant config, anchors, analytics, WebRTC fallback).
- `npx vitest run` → all pass.
- `npx vite build` → success.

- [ ] **Step 4: Commit**

```bash
git add src/services/providers/ProviderDescriptor.ts docs/superpowers/specs/2026-08-13-mainpanel-provider-seams-design.md
git commit -m "docs(providers): say what supportsWebRTC actually means; true up the S1 spec

supportsWebRTC gates native WebRTC capture, not webrtc transport —
PalabraAI has always been the counterexample. The spec's pushGatedModes
invariant assumed turnDetection.modes was the speech-mode vocabulary; it
is a settings-UI list, so the invariant now checks the list's own shape
instead. pttFinalization gained the two response modes the real code
has (voice-gated, voice-gated-cancel)."
```

---

## Self-review notes (already applied)

- **Spec coverage**: S1 spec items → Task 1 (flags + invariants), Tasks 3-9 (the six ladders + SubtitleApp mirror), Task 10 (supportsWebRTC re-doc). The spec's `excludesNativeCapture` was dropped by the spec itself. Two spec corrections surfaced by fact-gathering are folded into Task 10 rather than left to drift.
- **Sanctioned behavior tightening** (Task 1): `pushGatedModes` is per-provider vocabulary; a mode string stored outside the provider's settings type (unreachable via UI) is no longer push-gated for it. Everything UI-reachable behaves identically.
- **Type consistency**: `isPushGatedMode(provider: ProviderType, mode: string)` is the only cross-task symbol besides the capability fields; Tasks 3-4 use exactly that signature.
