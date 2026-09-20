# Sentence Segmentation — Slice 5: One Mode, Three Ways — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the segmentation on/off switch with the three-way mode Amendment A2 describes — Off, By pause, By sentences (Auto or 1–5) — stored once and resolved per provider.

**Architecture:** One global mode, one global size, one global pause pair, all clamped on read to what the current provider offers. Each descriptor declares which of the three it offers through one optional capability. The settings section in General is the only surface; the pause sliders leave provider settings. Nothing about how a bubble is cut changes in this slice except which rule is allowed to run.

**Tech Stack:** TypeScript, React, Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-sentence-segmentation-design.md`, Amendment A2 (and A1 before it).

**Depends on:** slices 1–4, all landed on this branch.

**This is phase 1 of two.** Phase 2 adds the two genuinely new behaviours A2 implies: Auto on the local engines (punctuate an utterance without splitting it, where today they always build a stream) and splitting a server-definite segment every N sentences (where today `punctuateDefinite` never splits). Phase 1 ships the mode, and the capability table below encodes the phase-1 answer for every provider, including the two temporary gaps.

---

## Global Constraints

- **English only** in code, comments and commits; real translations in all 30 locale catalogs.
- **Typecheck baseline is 319 errors**; the bar is zero new ones.
- **Run the suite as** `npx vitest run --exclude ".superpowers/**"`. Four unhandled rejections in `settingsStore.nativeGate.test.ts` are pre-existing.
- **With the mode resolving to Off, every provider behaves exactly as it does on `main`.** That is the property the slice is judged on.
- **Never push, never open or edit a PR.** The controller commits per task.

## What each provider offers, in phase 1

One optional capability, declared only by descriptors that deviate from the default:

```ts
/** Which segmentation choices this provider offers. Absent means the default
 *  below: a provider whose boundaries a server decides. */
segmentation?: {
  /** The client cuts on its own silence timers, and the user may tune them. */
  pause?: boolean;
  /** Something else decides the boundary, so "punctuate, do not split" is a
   *  meaningful choice. */
  auto?: boolean;
  /** A bubble every N sentences is implementable here. */
  sizes?: boolean;
};
```

Default (no declaration): `{ pause: false, auto: true, sizes: false }`.

| Provider | phase 1 | phase 2 changes it to | why |
|---|---|---|---|
| OpenAI Live, OpenAI Translate (+ its Kizuna twin), Gemini | `{ pause: true, auto: false, sizes: true }` | — | their own timers cut; Auto would be the pause mode by another name |
| Soniox (+ twin), Volcengine ST, Volcengine AST2 (+ twin), Palabra, Zoom | default | `sizes: true` | splitting a definite segment is phase 2 |
| OpenAI Realtime and OpenAI-Compatible | default | — | its GA client attaches audio to items, so a split would strand the karaoke timing; the beta client shares the descriptor |
| Local Inference, Local Native | `{ pause: false, auto: false, sizes: true }` | `auto: true` | 1–5 is what slice 3 shipped; Auto needs them to stop building a stream, which is phase 2 |

The two phase-1 gaps — no Auto on the local engines, no sizes on the five splittable server-definite providers — are deviations from A2, recorded here and in the carry-forward, not silently shipped.

---

## Task 1: The mode, and the rules that resolve it

**Files:**
- Create: `src/lib/segmentation/segmentationMode.ts` (+ test)
- Modify: `src/stores/settingsStore.ts` (+ test)

**Interfaces:**
- Produces, and every later task uses exactly these:

```ts
export type SegmentationMode = 'off' | 'pause' | 'sentences';
/** 0 is Auto: punctuate, never seal. 1-5 seal every N sentences. */
export type SegmentationSize = 0 | 1 | 2 | 3 | 4 | 5;
export interface SegmentationOffer { pause: boolean; auto: boolean; sizes: boolean }

/** The mode this provider actually runs, given what the user chose. */
export function resolveSegmentationMode(stored: SegmentationMode, offer: SegmentationOffer): SegmentationMode;
/** The size this provider actually uses, given what the user chose. */
export function resolveSegmentationSize(stored: number, offer: SegmentationOffer): SegmentationSize;
```

Rules, and the tests that pin them:
- `pause` on a provider without pause resolves to `off`; on one with it, stays.
- `sentences` stays everywhere — every provider offers at least one of Auto or sizes.
- `off` stays everywhere.
- Auto (0) on a provider without Auto resolves to the default 3; a size 1–5 on a provider without sizes resolves to 0.
- A stored value outside 0–5, or a mode string from an older build, resolves to the default for that provider (`pause` where offered, else `off`; size 3 or 0).

- [ ] **Step 1: Write the failing tests** for the two resolvers, one case per rule above, plus the three real offers from the table.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement the module.** Pure, no imports from stores or React.
- [ ] **Step 4: Change the settings.** In `settingsStore.ts`, replace `sentenceSegmentation: boolean` with `segmentationMode: SegmentationMode`, default `'pause'`; widen `sentenceSegmentationChunkSentences` to 0–5 (0 = Auto), default 3, clamped on read and write as it is today; add `segmentationSourcePause: number` and `segmentationTranslationPause: number`, both 1.5, in seconds, clamped to 0.1–3. Delete `userSilenceDuration` / `assistantSilenceDuration` from the OpenAI Live and OpenAI Translate slices and their defaults.
- [ ] **Step 5: Run, typecheck, commit.** Other files still read the removed fields; list those errors in the commit body rather than fixing them here.

---

## Task 2: What each provider offers

**Files:**
- Modify: `src/services/providers/ProviderConfig.ts`, the descriptors in the table above
- Test: `src/services/providers/descriptorRegistry.test.ts`

- [ ] **Step 1: Write the failing test.** In the registry invariant test, assert the phase-1 table verbatim: every provider id mapped to its resolved `SegmentationOffer`. That table is the specification; a new provider that forgets to think about it inherits the default and this test is where that shows up.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Add the capability** to `ProviderCapabilities` beside the other optional S1 flags, with the doc comment above, and declare it on the descriptors that deviate. Remember the Kizuna twins inherit through their `...base` spread — check each rather than assuming.
- [ ] **Step 4: Run, typecheck, commit.**

---

## Task 3: The section becomes a mode

**Files:**
- Modify: `src/components/Settings/sections/SentenceSegmentationSection.tsx` (+ `.scss`, `.test.tsx`)
- Modify: `src/components/Settings/sections/ProviderSpecificSettings.tsx`
- Modify: `src/locales/*/translation.json` (all 30)

- [ ] **Step 1: Write the failing tests.** The section renders the three modes, with By pause absent where the provider does not offer it; choosing By sentences with the models absent opens A1's confirmation and does not change the mode until it is confirmed; the size control shows Auto only where offered and 1–5 only where offered, and is absent entirely when a provider offers just one of them; the pause sliders appear only in By pause; the delete link and the low-memory rule behave as they do today.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Rebuild the section.** The toggle becomes a segmented control of the three modes, built like the existing Sentences-per-bubble control (`.segmented-control` / `.segmented-option`, which the section already styles). Below it: the size control when the mode is By sentences, the two pause sliders when it is By pause, then the pack's state and the delete link exactly as they are.
- [ ] **Step 4: Move the pause sliders here.** Delete `renderSilenceDurationOnlySetting` and its call site from `ProviderSpecificSettings.tsx`; the same two sliders, now reading the global settings, live in this section. Keep the single slider inside the turn-detection block — that one is OpenAI Realtime's server-side VAD and has nothing to do with this.
- [ ] **Step 5: Locales, all 30 in this commit.** New keys for the three mode labels and Auto; remove `silenceDurationTranslateTooltip` and any other key left with no reader (grep each before removing). The per-provider tooltip line A2 dropped is not added.
- [ ] **Step 6: Run, typecheck, commit.**

---

## Task 4: The clients read one pause pair

**Files:**
- Modify: `src/services/interfaces/IClient.ts`, `OpenAILiveClient.ts`, `OpenAITranslateGAClient.ts`, `OpenAITranslateWebRTCClient.ts`, `GeminiClient.ts`, the four descriptors, and the tests
- Modify: `src/components/MainPanel/clientOptions.ts`

- [ ] **Step 1: Write the failing tests.** Each client takes its two timeouts from the session config; Gemini, which has never had them, now does; each falls back to 1.5 s when the field is absent, which is what its own tests will exercise.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.** The two values ride in through the same `ClientOptions` hop the segmentation runtime uses, or through each provider's `buildSessionConfig` — pick whichever matches how that client already receives session values, and say which in the report. Gemini's `INPUT_SEGMENT_SILENCE_MS` / `ASSISTANT_SEGMENT_SILENCE_MS` become the fallback rather than the value; keep the comment recording where the 2 s came from and add that 1.5 s is the new default, with 1.5x rather than 2x of margin over its measured 1 s fragment gaps.
- [ ] **Step 4: Run, typecheck, commit.**

---

## Task 5: Only By sentences runs the stage

**Files:**
- Modify: `src/components/MainPanel/useSegmentationRuntime.ts`, `src/components/MainPanel/MainPanel.tsx`
- Test: `src/components/MainPanel/useSegmentationRuntime.test.ts`

- [ ] **Step 1: Write the failing test.** The runtime reports itself enabled only when the resolved mode is `sentences` (and the pack is ready, and the memory guard passes, as today); `off` and `pause` both leave it disabled.
- [ ] **Step 2: Run and watch it fail.**
- [ ] **Step 3: Implement.** `useSegmentationRuntime`'s `isEnabled` reads the resolved mode instead of the boolean. MainPanel passes the resolved size as `sentencesPerChunk`; a resolved size of 0 (Auto) cannot reach a client in phase 1, because no provider offers both Auto and a stream — assert that rather than handling it, so phase 2 has to come back here.
- [ ] **Step 4: Run, typecheck, commit.**

---

## Task 6: Look at it, and write down what phase 2 owes

**Files:**
- Create: `docs/superpowers/notes/2026-09-20-sentence-segmentation-slice-5-carry-forward.md`

- [ ] **Step 1: Run everything.** Full suite green, typecheck at 319.
- [ ] **Step 2: Render the section** in the three modes, on a provider that offers each, at 450 and 300 px, in de, ru, ja and ar — the recipe is in the slice 3b note. Fix what looks wrong before writing.
- [ ] **Step 3: Write the note.** What shipped, the two phase-1 gaps from the capability table, and what phase 2 must do: Auto on the local engines, splitting a definite segment every N sentences, and the audio question that keeps OpenAI Realtime on Auto forever.
- [ ] **Step 4: Commit.**

---

## Done when

- The section offers Off / By pause / By sentences, each provider seeing only what it can do, and the pause sliders live there rather than in provider settings.
- One stored mode, one stored size, one stored pause pair, resolved per provider on read, with `pause` as the default that means By pause on three providers and Off on the rest.
- Choosing By sentences for the first time asks before downloading, exactly as A1 specified.
- With the resolved mode Off, every provider behaves as it does on `main`.
- `npx vitest run --exclude ".superpowers/**"` is green and `npx tsc --noEmit` stays at 319.
