# Client contract — Stage 1e-2b: LocalInference's sentence-cut jobs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LocalInference's third job shape on the new contract — with the display set to sentences and a size of 1–5, a translation job every N sentences *inside* an utterance, sealed as the ASR's partials arrive — so that plan 1e-3 can switch the app over without a user losing today's behaviour.

**Architecture:** One new unit, `src/providers/localInference/sentenceCut.ts`: today's seal cursor, truncated re-decode guard and `SentenceStream` wiring, ported out of `LocalInferenceClient` without its bubbles, over the runner's `Punctuator` through a small runtime shim. The adapter drives it: in the stream shape, partials feed the cut; its pending tail is the open source segment; each seal closes that segment and queues its job under the segment's own origin (one source segment and one origin per job). The runner learns whether a punctuation model can run for a run (`punctuationReady`), so a run without one never enters the stream shape. The voxtral worker's own punctuation endpoint turns off exactly when this stage seals. The development preview gets a real punctuator and a live check.

**Tech Stack:** TypeScript (strict), React 18, zustand, Web Workers (onnxruntime-web / transformers.js / sherpa-onnx wasm), Vitest, Vite, headless Chromium over the DevTools protocol.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — "The contract" (segments, origin, typed text), D6 (the origin is stated by the client), D7 (the job boundary is the local pipeline's decision; the display cut is L2's), "Migration" (LocalInference keeps the translation-job cut). The roadmap row for 1e-2b (`docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`) and plan 1e-2's ruling 1 bind this plan. The research note it rests on — today's stream shape end to end, with file:line references — is copied into this plan's workspace as `1e2b-stream.md`.

## Global Constraints

- Today's app path does not change: `src/services/**` (incl. `LocalInferenceClient.ts`), `src/components/MainPanel/**`, `src/components/Settings/**`, `electron/**`, `extension/**` are read only; LocalInference keeps working there exactly as today until plan 1e-3.
- `src/lib/segmentation/**` does not change: `SentenceStream`, `sealCursor`, `sentenceEnd`, `SegmentationRuntime`, `PunctuationRuntime` are used as they are. The engines and workers under `src/lib/local-inference/` do not change.
- `src/providers/**` imports no store but `modelStore` and `turnModeStore`, and never `PunctuationRuntime` (it pulls in the model manager and a worker). `src/lib/**` never imports React.
- No new locale keys.
- Record a caught failure with `reportError` / `reportWarning`, never `console.error` / `console.warn`; inside the adapter, failures are `degraded` / `failed` events and `frame`s, never `report()`.
- Every adapter obeys the contract's rules (`src/lib/contract/adapter.ts` and `conformance.ts`); every adapter test runs under `expectConformant`. Refs are never reused; typed text is answered by a source segment with exactly the typed text; nothing after `failed` / `closed` or after `stop()`; `stop()` ends the pipeline before its first `await`; frame payloads carry no audio, no credential, no string of 2048 characters or more.
- Gates for every task: `npx vitest run src` shows 0 failed (4 unhandled rejections from `settingsStore.nativeGate.test.ts` are the baseline), and this typecheck gate prints exactly the same **11 lines** it prints at this plan's start (the shell's `grep` is a ugrep wrapper that mis-parses this regex — use `command grep` exactly as written):

  ```
  npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts)|lib/modern-audio/BaseAudioRecorder|providers|components/(providers|Conversation|Subtitle|MainPanel/ExportButton|dev/(SpinePreview|SessionControls|OverlayPreview))|stores/(providerStore|turnModeStore|routingStore)|utils/(environment|conversationExport)|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
  ```

  The 11 lines: App.tsx TS6133 'React'; SubtitleApp.handleStart.test.tsx TS6133 'provider'; 6× SubtitleBar.test.tsx TS2322 'SessionControl'; analytics.ts TS6133; environment.ts TS2717; environment.ts TS2339. Do not fix them; do not add to them.
- Commits: conventional, English; every message ends with the implementing model's `Co-Authored-By` line and `Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28`. In this worktree the shell refuses compound git commands: run `git add` and `git commit -q -F - <<'EOF' … EOF` as separate calls. Never push.

## Rulings this plan makes

1. **The shape is decided once per session**, in the adapter's constructor: the stream shape iff the translation is an engine (`kind: 'engine'`), the config's `jobSentences` is 1–5, and the request carries a punctuator. `jobSentences` replaces 1e-2's `punctuateJobs`: absent — the display is not by sentences, one raw job per ASR final; 0 (Auto) — one job per final, punctuated first behind today's length gate; 1–5 — the stream shape. `request.punctuate` is read once per start, so today's per-session freeze (`LocalInferenceClient.ts` ~102-143) needs no code.
2. **A run gets a punctuator only when a model can run for it.** `RunnerDeps.punctuationReady?(): boolean`, read once when a run starts; false → neither that run's conversations nor its adapters get `punctuate`. A punctuator that is present but answers null all run would look like a model still loading, and the stream shape would then cut unpunctuated engines (sherpa zipformer) by length every ~100 characters instead of once per pause — a behaviour change in today's "pack not downloaded" case. Absent getter: `punctuate` alone decides (tests, and the preview before Task 5). Plan 1e-3 wires the app's from `PunctuationRuntime.enabled`.
3. **One source segment and one origin per job.** A seal closes the open source segment with the sealed text and queues its job under that segment's origin; the remainder opens the next source segment with a fresh origin. This is today's bubble behaviour, keeps pairing 1:1 in L2 and the exports, and is 1e-2's mapping ("one origin per translation job"). One origin per utterance would draw every source row of the utterance before every translation row (`src/lib/view/filter.ts`). Conformance has no rule on origin; `nextOrigin()` now counts jobs.
4. **Not every session streams.** AST and transcription-only (`kind: 'none'`) never do, and keep the worker's endpoint on: `none` queues no job, so seals would only cut the source display, which is L2's (D7). Today `none` streamed; this is a stated departure.
5. **Typed text stays one job** — its source segment must carry exactly the typed text (conformance `text-input-answered`), which a seal would split. Filled as a per-final job is (behind the length gate). Today long typed text was cut into N-sentence jobs; this is a stated departure.
6. **Seals are never filled in** (parity): a `sentences` chunk ends in a mark, a `length` chunk already had its model call, and the `end` tail is raw today. `SealedChunk.reason` makes "fill the `end` tail" a one-line follow-up if translation quality on unmarked engines asks for it (roadmap).
7. **The runtime shim** (`runtimeOver`): `SentenceStream` needs sentence ends, the `Punctuator` returns text; the shim rebuilds `sentenceEnds` / `breakpoints` from the answer with the shared rule (`sentenceEnd.ts`). FireRedPunc (zh) and Edge-Punct (en) count ends by that same rule; SaT (every other language) can lose an end the rule rejects — a period before a lowercase word in a text that shows casing — so such a chunk seals later or by length. Accepted and documented in the shim; widening `Punctuator` would touch L1, `fillIn` and 1a/1c-1's tests for a rare case. Each call is raced against **3 s** on the request's clock (today's `INFERENCE_TIMEOUT_MS`): a punctuator that never answers would otherwise leave the stream's call in flight forever, and its length fallback never fires. `observe` (seal counts for `translation_session_end`) is not carried: the runner sends no such analytics; plan 1e-3 decides (roadmap).
8. **The guard stays today's**: a final (or partial) that slices to nothing past the cursor is a truncated re-decode of the same utterance when its trimmed text is a prefix of the previous partial's — then no job; otherwise the cursor restarts. A re-decode that only recases or re-punctuates reads as different and re-seals (a duplicate job); a skeleton-prefix check is the natural widening, noted in the code, not built.
9. **Resets.** An ASR error, an empty final, `stop()` and a fatal failure all drop the utterance's cut (stream disposed, cursor 0) — today the stream survives the first two, and the next utterance can be sliced by a stale cursor. A seal whose text holds no letter or digit (a lone mark or bracket the cursor left behind) closes its segment and queues no job.
10. **Exactly one layer may seal**: the adapter tells the ASR `punctuationEndpoint: false` iff it runs the stream shape (only voxtral-webgpu reads it; `engines.ts` hard-codes `true` today). Every other session keeps the worker's endpoint on.
11. **A frame per seal**: `local.segmentation.seal` with `{ reason, text }`, through the adapter's `frame` (redacted, bounded).
12. **The preview wires a real punctuator** (a page-level `PunctuationRuntime`, as MainPanel builds one), `punctuationReady` from it, and `&punctuation=1` downloads the punctuation pack before autostart — the live check the roadmap asks for, and a dry run of plan 1e-3's wiring.

## File Structure

| File | Change |
|---|---|
| `src/lib/session/ports.ts`, `src/lib/session/run.ts`, `src/lib/session/runner.test.ts` | `punctuationReady`, read once per run (Task 1) |
| `src/providers/localInference/config.ts` (+ test) | `jobSentences` replaces `punctuateJobs` (Task 2) |
| `src/providers/localInference/engines.ts` (+ test) | `AsrInit.punctuationEndpoint` (Task 2) |
| `src/providers/localInference/adapter.ts` (+ test) | `Job.fill` (Task 2); the stream shape (Task 4) |
| `src/providers/localInference/sentenceCut.ts` (+ test) | new: the cut and the runtime shim (Task 3) |
| `src/components/dev/SpinePreview.tsx`, `scripts/dev/spine-local-probe.mjs` | the preview's punctuator, `&punctuation=1`, seal counts; the probe's `--sentences` mode (Task 5) |

---

### Task 1: The runner decides once whether a run gets a punctuator

**Files:** Modify `src/lib/session/ports.ts`, `src/lib/session/run.ts`; Test `src/lib/session/runner.test.ts`.

**Interfaces:**
- Produces: `RunnerDeps.punctuationReady?(): boolean` — read once when a run starts. False (or a getter that throws) → that run's `Conversation`s and every leg's `StartRequest` get `punctuate: undefined`. Absent → `deps.punctuate` as today.

- [ ] **Step 1: Write the failing tests** in `runner.test.ts`, beside the existing tests that inspect a `StartRequest` (find how they capture the request the fake adapter receives, and how a `Conversation`'s fill-in is observed — a segment closing without a sentence end gets the punctuator's answer):
  - `punctuationReady: () => false` with a `punctuate` → the adapter's request has no `punctuate`, and a closed source segment without a sentence end is not filled.
  - `punctuationReady: () => true` → both get it (the request's `punctuate` is the deps' function; the fill-in happens).
  - absent → both get it (today).
  - read once: a getter that flips to false after the start → the running run keeps its punctuator (count the getter's calls: exactly one per run).
  - a getter that throws → treated as false, reported once (`reportWarning`, dedupe key `port:punctuationReady`), and the start still goes on.
- [ ] **Step 2: Run** `npx vitest run src/lib/session/runner.test.ts` — the new tests fail (`punctuationReady` is ignored).
- [ ] **Step 3: Implement.** In `ports.ts`, beside `punctuate?`:

  ```ts
  /**
   * Whether a punctuation model can run for this run (the display is by
   * sentences, the pack is on disk, the device can hold it). Read once when a
   * run starts; false — or a getter that throws — and this run gets no
   * punctuator at all: an always-null one would look like a model still
   * loading, and LocalInference would cut unpunctuated speech by length
   * instead of by pause. Absent: `punctuate` alone decides.
   */
  punctuationReady?(): boolean;
  ```

  In `run.ts`, decide once where the run first needs it (before the `Conversation`s are built) and use that one value for the conversations and the requests, in place of the two `deps.punctuate` reads:

  ```ts
  const punctuate = this.punctuatorForRun();
  ```

  ```ts
  /** The run's punctuator, decided once (`RunnerDeps.punctuationReady`). */
  private punctuatorForRun(): Punctuator | undefined {
    const { deps } = this;
    if (!deps.punctuate || !deps.punctuationReady) return deps.punctuate;
    try {
      return deps.punctuationReady() ? deps.punctuate : undefined;
    } catch (error) {
      reportWarning('SessionRunner', `The punctuationReady port threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'port:punctuationReady' });
      return undefined;
    }
  }
  ```

  (Adapt the member access to how `run.ts` holds its deps; import `Punctuator` from where plan 1e-2's fix wave moved it — `src/lib/contract/adapter.ts`.)
- [ ] **Step 4: Run** the runner tests — pass; then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/session/ports.ts src/lib/session/run.ts src/lib/session/runner.test.ts
  git commit -m "feat(session): a run gets a punctuator only when a model can run for it"
  ```

---

### Task 2: The job cut's config, the endpoint flag, and a job that says whether to fill

**Files:** Modify `src/providers/localInference/config.ts`, `config.test.ts`, `engines.ts`, `engines.test.ts`, `adapter.ts`, `adapter.test.ts`.

**Interfaces:**
- Produces: `LocalInferenceConfig.jobSentences?: number` (replaces `punctuateJobs`); `AsrInit.punctuationEndpoint?: boolean` (default `true`); the adapter's `Job` gains `fill: boolean`.

- [ ] **Step 1: Write the failing tests.**
  - `config.test.ts`: display mode `sentences` with `sentencesPerRow` 0 → `jobSentences: 0`; with 3 → `3`; mode `off` or `pause` → `jobSentences` absent (the key not present). Replace every `punctuateJobs` expectation.
  - `engines.test.ts`: beside the test pinning `punctuationEndpoint: true` for a streaming engine, `init(…, { …, punctuationEndpoint: false })` reaches `StreamingAsrEngine.init` as `false`; omitted → `true`.
  - `adapter.test.ts`: every `punctuateJobs: true` fixture becomes `jobSentences: 0` and every `false` drops the key; the existing punctuated-job tests keep passing unchanged otherwise. Add: `jobSentences: 3` with a punctuator and an engine translation → until Task 4 the jobs are per final and filled (the Auto behaviour, plan 1e-2 ruling 1).
- [ ] **Step 2: Run** the three files — the new tests fail.
- [ ] **Step 3: Implement.**
  - `config.ts`: replace the `punctuateJobs` field with

    ```ts
    /**
     * The translation-job cut, from the display's segmentation (today's three
     * shapes): absent — the display is not by sentences, one raw job per ASR
     * final; 0 (Auto) — one job per final, punctuated first; 1–5 — a job every
     * N sentences inside the utterance (the stream shape, when a punctuator
     * runs).
     */
    jobSentences?: number;
    ```

    and in `buildLocalInference`, instead of `punctuateJobs: …`: `if (shared.segmentation.mode === 'sentences') config.jobSentences = shared.segmentation.sentencesPerRow;` (the stored size is clamped to 0–5 already).
  - `engines.ts`: `AsrInit` gains

    ```ts
    /** The voxtral worker's own sentence endpoint (default on): off only while the adapter's stream shape seals — exactly one layer may cut. */
    punctuationEndpoint?: boolean;
    ```

    and `asrOver`'s streaming branch passes `punctuationEndpoint: punctuationEndpoint ?? true` (replace the comment naming plan 1e-2b). `AsrEngine` ignores it.
  - `adapter.ts`: `Job` gains `fill: boolean` ("punctuate the text before translating: per-final and typed-text jobs under a sentences display; never a seal"). Every job built today sets `fill: this.config.jobSentences !== undefined`; `translated()` fills when `job.fill` and a punctuator is present (the length gate stays inside the punctuation helper).
- [ ] **Step 4: Run** the three files, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/providers/localInference/config.ts src/providers/localInference/config.test.ts src/providers/localInference/engines.ts src/providers/localInference/engines.test.ts src/providers/localInference/adapter.ts src/providers/localInference/adapter.test.ts
  git commit -m "refactor(local): the job cut from the display's size, the endpoint flag, and per-job fill"
  ```

---

### Task 3: The cut — today's seal cursor over the runner's punctuator

**Files:** Create `src/providers/localInference/sentenceCut.ts`, `src/providers/localInference/sentenceCut.test.ts`.

**Interfaces:**
- Consumes: `SentenceStream`, `SealedChunk` (`src/lib/segmentation/SentenceStream`); `countSkeleton`, `offsetAfterSkeleton` (`sealCursor`); `sentenceEnds`, `breakpoints`, `baseLang` (`sentenceEnd`); `SegmentationRuntime`, `PunctuationModelId` (`SegmentationRuntime`); `Clock` (`src/lib/contract/clock`); `Punctuator` (`src/lib/contract/adapter`).
- Produces:
  - `PUNCTUATION_BUDGET_MS = 3000`
  - `runtimeOver(punctuate: Punctuator, clock: Clock): SegmentationRuntime`
  - `class SentenceCut` — `constructor(opts: SentenceCutOptions)`, `partial(raw: string): void`, `final(text: string): boolean` (false: a truncated re-decode of text already sealed — nothing more sealed), `reset(): void` (drop the utterance: its stream disposed, the cursor at 0; a late answer seals nothing).
  - `interface SentenceCutOptions { lang: string; sentences: number; runtime: SegmentationRuntime; onPending(tail: string): void; onSeal(chunk: SealedChunk): void }`

- [ ] **Step 1: Write the failing tests** in `sentenceCut.test.ts`. A harness:

  ```ts
  import { describe, expect, it } from 'vitest';
  import { createVirtualClock } from '../../lib/contract/clock';
  import type { Punctuator } from '../../lib/contract/adapter';
  import type { SealedChunk } from '../../lib/segmentation/SentenceStream';
  import { PUNCTUATION_BUDGET_MS, SentenceCut, runtimeOver } from './sentenceCut';

  function harness({ lang = 'en', sentences = 1, punctuate = (async () => null) as Punctuator } = {}) {
    const clock = createVirtualClock();
    const seals: SealedChunk[] = [];
    const pendings: string[] = [];
    const cut = new SentenceCut({
      lang, sentences, runtime: runtimeOver(punctuate, clock),
      onSeal: (chunk) => seals.push(chunk), onPending: (tail) => pendings.push(tail),
    });
    const texts = () => seals.map((s) => s.text.trim());
    return { cut, clock, seals, pendings, texts };
  }
  const settle = () => new Promise<void>((r) => setTimeout(r, 0));
  ```

  The cases (each is a today's `LocalInferenceClient.test.ts` / `SentenceStream.test.ts` case — the research note §5 names them; seal texts compared trimmed):
  1. **N=1, sealing as partials grow.** `partial('Sentence one is done. Sentence two begins')` → `['Sentence one is done.']`; `partial('Sentence one is done. Sentence two begins now yes. Sentence three starts')` → adds `'Sentence two begins now yes.'`; `partial('Sentence one is done. Sentence two begins now yes. Sentence three starts and ends well. Tail padding here')` → adds `'Sentence three starts and ends well.'`, and the last pending (trimmed) is `'Tail padding here'`.
  2. **An offline final at N=3.** `final('One is done. Two is done. Three is done. Four is done. Five is done. Six is done and finished well.')` returns `true` → `['One is done. Two is done. Three is done.', 'Four is done. Five is done. Six is done and finished well.']`.
  3. **A short utterance at N=3.** `final('Just one short sentence.')` → `['Just one short sentence.']`.
  4. **The cursor advances by what was consumed, not by the sealed text** (the model path inserts marks). Punctuator: `RAW = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet'` → `'alpha bravo charlie delta echo foxtrot golf hotel. india juliet'`, anything else null. `partial(RAW)`, `await settle()` → `['alpha bravo charlie delta echo foxtrot golf hotel.']`; `final(RAW + ' kilo')` → adds `'india juliet kilo'`; and the letters of all seals joined equal the final's letters (no letter lost or repeated). (Today's fixture put a period between digits, which the shared rule rejects — this one is lowercase with a space, so the casing guard stays off.)
  5. **The model's own casing and marks are the seal's text; the remainder stays raw.** Punctuator: `'the first sentence runs long enough to pass the gate the second one follows it'` → `'The first sentence runs long enough to pass the gate. The second one follows it'`. After `partial(raw)` and `await settle()`: seals `['The first sentence runs long enough to pass the gate.']`, last pending (trimmed) `'the second one follows it'`.
  6. **A final shorter than what was sealed.** `partial('First sentence done. Second begins')` → one seal; `final('Hi.')` returns `true` → adds `'Hi.'`.
  7. **A truncated re-decode.** `partial('First sentence done. Second begins')`; `final('First sentence done.')` returns `false`; seals stay `['First sentence done.']`.
  8. **The same with a leading-space partial** `' First sentence done. Second begins'` → `false`, one seal.
  9. **A dropped mark.** `partial(" Lorena and I have a wonderful family together. I'm pretty sure")`; `final("Lorena and I have a wonderful family together I'm pretty sure none of this would have happened.")` → `['Lorena and I have a wonderful family together.', "I'm pretty sure none of this would have happened."]`.
  10. **An added mark.** `partial('And so my fellow Americans, ask not what your country can do for you. When I was young')`; `final('And so, my fellow Americans, ask not what your country can do for you. When I was young there was an amazing publication.')` → `['And so my fellow Americans, ask not what your country can do for you.', 'When I was young there was an amazing publication.']` (no `'.'` seal).
  11. **zh, leading space** (`lang: 'zh'`). `partial(' 今天天气很好。我们出去走走吧然后去吃饭')`; `final('今天天气很好。我们出去走走吧然后去吃饭。')` → `['今天天气很好。', '我们出去走走吧然后去吃饭。']`.
  12. **zh, seam space.** `partial(' 第一段话说完了。 第二段话也说完了。第三段话正在说而且还没有完')` → two seals; `final('第一段话说完了。第二段话也说完了。第三段话正在说而且还没有完全结束。')` → adds `'第三段话正在说而且还没有完全结束。'`.
  13. **A hung punctuator is bounded.** Punctuator `() => new Promise(() => {})`; `partial` of a 120-character lowercase unmarked text with spaces (build it from repeated words) → no seal after `await settle()`; `clock.advance(PUNCTUATION_BUDGET_MS - 1)` + settle → still none; `clock.advance(1)` + settle → one seal with `reason: 'length'`.
  14. **`reset()` drops a model call in flight.** A punctuator whose promise the test holds; `partial` of a long unmarked text; `reset()`; resolve the held promise with a punctuated answer; settle → no seal, and no pending after the reset.
  15. **`runtimeOver`.** `punctuate` answers `'Hello there. General Kenobi'` → the result's `sentenceEnds` / `breakpoints` equal `sentenceEnds(text)` / `breakpoints(text)` from `sentenceEnd.ts`; answers null → null; rejects → null; `enabled` is true.
- [ ] **Step 2: Run** `npx vitest run src/providers/localInference/sentenceCut.test.ts` — fails (the module does not exist).
- [ ] **Step 3: Implement** `sentenceCut.ts`:

  ```ts
  import type { Clock } from '../../lib/contract/clock';
  import type { Punctuator } from '../../lib/contract/adapter';
  import { countSkeleton, offsetAfterSkeleton } from '../../lib/segmentation/sealCursor';
  import type { PunctuationModelId, SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';
  import { baseLang, breakpoints, sentenceEnds } from '../../lib/segmentation/sentenceEnd';
  import { SentenceStream, type SealedChunk } from '../../lib/segmentation/SentenceStream';

  /**
   * LocalInference's stream shape (plan 1e-2b): a translation job every N
   * sentences inside an utterance, ported from `LocalInferenceClient`
   * (~155-216, 725-821, 886-981) without its bubbles. `SentenceStream` does
   * the sealing; this keeps the cursor that turns an ASR's cumulative
   * hypotheses into the "text since the last seal" it expects, and the guard
   * against engines whose later text is not a growth of what was sealed.
   */

  /** A stalled punctuator must not stall sealing: today's runtime gives up after 3 s (`INFERENCE_TIMEOUT_MS`). */
  export const PUNCTUATION_BUDGET_MS = 3000;

  /** Which model today's runtime would run (`modelForLanguage`); `SentenceStream` never reads it — the type asks for one. */
  function modelFor(lang: string): PunctuationModelId {
    const base = baseLang(lang);
    if (base === 'zh' || base === 'yue' || base === 'cantonese') return 'fireredpunc';
    return base === 'en' ? 'edge-punct-en' : 'sat-3l-sm';
  }

  /**
   * `SentenceStream`'s runtime over the runner's `Punctuator`. The answer is
   * text; the stream needs its sentence ends, rebuilt here with the shared
   * rule. FireRedPunc and Edge-Punct count by that rule themselves; SaT can
   * lose an end the rule rejects (a period before a lowercase word in a text
   * that shows casing), so that chunk seals later or by length — accepted
   * (plan 1e-2b ruling 7). Each call is raced against the budget.
   */
  export function runtimeOver(punctuate: Punctuator, clock: Clock): SegmentationRuntime {
    return {
      enabled: true,
      punctuate: (lang, text) => new Promise((resolve) => {
        let settled = false;
        const finish = (out: string | null) => {
          if (settled) return;
          settled = true;
          cancel();
          resolve(out === null ? null : { text: out, sentenceEnds: sentenceEnds(out), breakpoints: breakpoints(out), model: modelFor(lang) });
        };
        const cancel = clock.setTimeout(() => finish(null), PUNCTUATION_BUDGET_MS);
        punctuate(lang, text).then(finish, () => finish(null));
      }),
    };
  }

  export interface SentenceCutOptions {
    /** The utterance's language (the leg's source). */
    lang: string;
    /** 1–5: how many sentences one job holds. */
    sentences: number;
    runtime: SegmentationRuntime;
    /** The unsealed tail of the utterance in progress, raw, whenever it changes. */
    onPending(tail: string): void;
    /** A sealed chunk: its text (a punctuation model's marks included) and why. */
    onSeal(chunk: SealedChunk): void;
  }

  export class SentenceCut {
    private stream: SentenceStream | null = null;
    /** Letters and digits of the utterance's raw text already inside seals (`sealCursor.ts`): the unit both a partial and its final agree on. */
    private sealed = 0;
    /** `sealed` when `lastPassed` was handed to the stream. */
    private sealedBase = 0;
    /** The exact text last handed to `update()`; whatever `onPending` reports is a suffix of it. */
    private lastPassed = '';
    /** The previous partial, unsliced: tells a truncated re-decode from new text. */
    private lastRaw = '';

    constructor(private readonly opts: SentenceCutOptions) {}

    /** A cumulative partial of the utterance in progress. */
    partial(raw: string): void {
      const previousRaw = this.lastRaw;
      this.lastRaw = raw;
      const stream = this.ensureStream();
      if (this.coversNothingNew(raw)) {
        // Retracted to what is sealed already: leave everything as it is — the next partial heals it.
        if (isTruncationOf(raw, previousRaw)) return;
        // The engine changed its mind entirely: start the cursor over.
        this.sealed = 0;
      }
      this.feed(stream, raw);
    }

    /**
     * The utterance's final: seals what is left, and the utterance is done.
     * False when the final is a truncated re-decode of text already sealed —
     * nothing more is sealed, and the caller closes what it shows without a job.
     */
    final(text: string): boolean {
      const previousRaw = this.lastRaw;
      const stream = this.ensureStream();
      let sealsTail = true;
      if (this.coversNothingNew(text)) {
        if (isTruncationOf(text, previousRaw)) sealsTail = false;
        else this.sealed = 0;
      }
      if (sealsTail) {
        this.feed(stream, text);
        stream.end();
      }
      this.reset();
      return sealsTail;
    }

    /** Drops the utterance in progress: its stream (a late model answer seals nothing) and the cursor. */
    reset(): void {
      this.stream?.dispose();
      this.stream = null;
      this.sealed = 0;
      this.lastRaw = '';
    }

    /** Everything this text holds is sealed already: slicing it would hand the stream an empty string. */
    private coversNothingNew(text: string): boolean {
      return text.length > 0 && offsetAfterSkeleton(text, this.sealed) >= text.length;
    }

    private ensureStream(): SentenceStream {
      if (this.stream) return this.stream;
      this.sealed = 0;
      this.stream = new SentenceStream({
        lang: this.opts.lang,
        runtime: this.opts.runtime,
        sentencesPerChunk: this.opts.sentences,
        onSeal: (chunk) => this.opts.onSeal(chunk),
        onPending: (tail) => {
          // Advanced by what the stream consumed, not by the sealed text: a
          // model seal carries inserted marks the raw text never had.
          this.sealed = this.sealedBase + countSkeleton(this.lastPassed) - countSkeleton(tail);
          this.opts.onPending(tail);
        },
      });
      return this.stream;
    }

    private feed(stream: SentenceStream, text: string): void {
      const relative = text.slice(offsetAfterSkeleton(text, this.sealed));
      this.sealedBase = this.sealed;
      this.lastPassed = relative;
      stream.update(relative);
    }
  }

  /**
   * A re-decode that retracted to text already sealed: its trimmed text is a
   * prefix of the previous partial's (trimmed: some engines' partials carry a
   * leading space their final does not). A re-decode that only recases or
   * re-punctuates reads as new text and re-seals; comparing skeletons would
   * catch it — not built (plan 1e-2b ruling 8).
   */
  function isTruncationOf(text: string, previousRaw: string): boolean {
    const trimmed = text.trim();
    return trimmed.length > 0 && previousRaw.trim().startsWith(trimmed);
  }
  ```

  If a ported case fails against this code, compare with the cited `LocalInferenceClient` lines before changing either; a test expectation changes only with a stated reason (flag it).
- [ ] **Step 4: Run** the file — pass; then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/providers/localInference/sentenceCut.ts src/providers/localInference/sentenceCut.test.ts
  git commit -m "feat(local): the sentence cut — today's seal cursor over the runner's punctuator"
  ```

---

### Task 4: The adapter runs the stream shape

**Files:** Modify `src/providers/localInference/adapter.ts`, `adapter.test.ts` (and `fakeEngines.ts` only if a test needs a hook it lacks).

**Interfaces:**
- Consumes: `SentenceCut`, `runtimeOver` (Task 3); `jobSentences`, `Job.fill`, `AsrInit.punctuationEndpoint` (Task 2).
- Produces: nothing new for later tasks; the preview (Task 5) runs it.

- [ ] **Step 1: Write the failing tests** (every one under `expectConformant`, with the fakes and a `punctuate` fake; `jobSentences: 1` and an engine translation unless stated):
  1. **The shape and the endpoint.** Stream config → `asr.inits[0].options.punctuationEndpoint === false`. `jobSentences: 0`, absent, no punctuator, `kind: 'ast'`, `kind: 'none'` → `true`, and partials behave as in 1e-2 (one cumulative source segment per utterance).
  2. **One source segment and one origin per job.** The three partials of Task 3's case 1 through the fake ASR → three source segments, each closed with its sealed text, origins `u1`, `u2`, `u3`; three jobs translated in order (`translation.calls`), each translation segment under its source's origin; a fourth source segment open showing `'Tail padding here'`. Then the final `'… Tail padding here.'` closes it and queues a fourth job under `u4`.
  3. **An offline final** (no partials) at `jobSentences: 3`: Task 3's case 2 → two source segments and two jobs, distinct origins.
  4. **A truncated final**: Task 3's case 7 → one job; the open source segment (showing the tail) is closed without a translation.
  5. **Seals are not filled.** `final('Sentence one is done. ' + TAIL)`, where `TAIL` starts with a capital (`'And then …'` — a period before a lowercase word in a cased text is not a sentence end, and nothing would seal) and runs at least 160 characters with no mark (above the Auto length gate, so a fill-in *would* change it), with a punctuator that ends any text with a period → two jobs: `'Sentence one is done.'` and `TAIL` exactly as sealed — no period added on the job path (the stream's own model call for the tail is answered after `end()` and ignored).
  6. **A seal without letters queues nothing.** `partial('Sentence one is done. Sentence two begins')`, then `final('Sentence one is done. (')` → jobs `['Sentence one is done.']` only; no source segment left open.
  7. **Resets.** After a seal, an ASR `onError` — then a new utterance's partials seal from a clean cursor (its first job holds its first sentence whole, no letter lost). The same with an empty final in place of the error.
  8. **`stop()` with a model call in flight** (a held punctuator promise, a long unmarked partial): `stop()`, then resolve it → nothing after the stop marker.
  9. **Typed text in the stream shape**: `appendText('Hello there. How are you doing today?')` → one source segment with exactly that text, one job; `text-input-answered` holds.
  10. **A frame per seal**: each seal emits `local.segmentation.seal` with its `reason` and text.
- [ ] **Step 2: Run** `npx vitest run src/providers/localInference/adapter.test.ts` — the new tests fail.
- [ ] **Step 3: Implement** in `adapter.ts`:
  - A field `private readonly cut: SentenceCut | null`, built in the constructor when ruling 1 says so: `new SentenceCut({ lang: request.context.direction.source, sentences: jobSentences, runtime: runtimeOver(request.punctuate, request.clock), onPending: (tail) => this.show(tail), onSeal: (chunk) => this.seal(chunk) })`.
  - `open()` passes `punctuationEndpoint: this.cut === null` to `asr.init`.
  - Extract the display half of `partial()` into `show(raw)` — trim; nothing when empty (no blank segment); open the source segment lazily with a fresh ref and origin; `segmentText` only when the text changed. `partial()` keeps its frame, its `ended` and AST returns, then `this.cut ? this.cut.partial(raw) : this.show(raw)`.
  - `seal({ text, reason })`: frame `local.segmentation.seal` `{ reason, text }`; `const t = text.trim()`; when `countSkeleton(t) === 0`, `abandonUtterance()` and return (ruling 9); otherwise `show(t)` (opens a segment when none is open — an `end()` sealing a tail no pending showed), then close the open segment and `enqueue({ text: t, origin, fill: false })` with that segment's origin.
  - `final()`: after the empty-final check (which now also calls `this.cut?.reset()`) and the `local.asr.end` frame, the stream shape does `if (!this.cut.final(text)) this.abandonUtterance();` and returns; the AST and per-final paths are unchanged.
  - The ASR `onError` handler also calls `this.cut?.reset()`; `stop()` calls it synchronously with the other teardown; `fatal()` too.
  - `nextOrigin()`'s doc says it counts jobs now (one origin per job).
- [ ] **Step 4: Run** the adapter tests, then the whole `src/providers/localInference` directory, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/providers/localInference/adapter.ts src/providers/localInference/adapter.test.ts
  git commit -m "feat(local): LocalInference seals a job every N sentences inside an utterance"
  ```

  (Add `fakeEngines.ts` to the `git add` only if you changed it.)

---

### Task 5: A real punctuator in the preview, checked live

**Files:** Modify `src/components/dev/SpinePreview.tsx` (+ its test if a behaviour fits one), `scripts/dev/spine-local-probe.mjs`.

**Interfaces:**
- Consumes: `RunnerDeps.punctuate` / `punctuationReady` (Task 1); the stream shape (Task 4); `PunctuationRuntime` (`src/lib/segmentation/PunctuationRuntime`), `useSegmentationStore` (`src/stores/segmentationStore`), the stored `segmentationMode` (`useSettingsStore`).
- Produces: preview parameter `&punctuation=1` (download the punctuation pack before autostart); the probe's `--sentences` mode.

- [ ] **Step 1: The preview.**
  - One `PunctuationRuntime` per page, built lazily beside `getPreviewRunner` (the way MainPanel's hook builds the app's, minus its telemetry): `isEnabled: () => useSettingsStore.getState().segmentationMode === 'sentences' && useSegmentationStore.getState().phase === 'ready'`.
  - The runner's deps: `punctuate: (lang, text) => runtime.punctuate(lang, text).then((r) => r?.text ?? null)` and `punctuationReady: () => runtime.enabled`.
  - On mount: `void useSegmentationStore.getState().refresh()` once. `&punctuation=1`: in the autostart effect, after `refresh()` has settled and when the phase is not `ready`, `await useSegmentationStore.getState().download()` before `runner.start()` (beside the `&models=` downloads); a failure is reported with the file's existing `reportError` pattern and the start still happens.
  - Seal counts for the probe: record the frames the runner hands the preview (a `frames` port on the preview runner) and expose a count of `local.segmentation.seal` frames by reason, the way `captured` reaches the page for the audio probe.
  - Everything else unchanged; the existing probes run on the fake as before.
- [ ] **Step 2: The probe's `--sentences` mode** in `scripts/dev/spine-local-probe.mjs`:
  - Fixture: `benchmark/test-speech-silence-speech.wav` with its silence cut to about 200 ms (find the gap by amplitude; write 16-bit mono PCM at the source rate into the probe's own temp dir, `$CLAUDE_JOB_DIR/tmp` else `os.tmpdir()`), so the two spoken parts arrive as one utterance.
  - URL: the default one plus `&cut=sentences:1&punctuation=1`.
  - Pass: at least two source rows with text, at least two translation rows with text, and at least one `local.segmentation.seal` frame with reason `sentences` — the seal count is what proves the cut, not the VAD, made the rows. Print the rows and the seal counts. Without `--sentences` the probe is unchanged.
  - Header: say what `--sentences` checks, and that `&punctuation=1` downloads the punctuation pack into the probe's profile (a first run is slow).
- [ ] **Step 3: The gates** — `npx vitest run src` (0 failed) and the typecheck gate (11 lines); `node --check` on the probe. Do not start a dev server or run the probes: the controller runs `node scripts/dev/spine-local-probe.mjs --sentences`, the default probe, and the four existing probes against a fresh vite after your commit. If the ASR puts no sentence end inside the joined utterance, the controller reports the transcript; the unit tests stand and the live check moves to jiangzhuo.
- [ ] **Step 4: Commit**

  ```bash
  git add src/components/dev scripts/dev/spine-local-probe.mjs
  git commit -m "test(dev): the preview punctuates, and a live check of sentence-cut jobs"
  ```

---

## Self-review

- Spec coverage: the roadmap's 1e-2b scope — the seal cursor (Task 3), the truncated re-decode guard (Task 3, ruling 8), the voxtral endpoint coupling (Tasks 2 and 4, ruling 10), over the runner's punctuator (Tasks 1 and 3, rulings 2 and 7), "vitest over scripted partials" (Tasks 3 and 4), "a live long utterance in the preview" (Task 5). Plan 1e-2's ruling 1 ("until it lands a size of 1–5 behaves as Auto") is retired by Task 4.
- Types: `jobSentences?: number` (Task 2) is read by Task 4; `Job.fill` (Task 2) is set false by seals (Task 4); `SentenceCut` / `runtimeOver` / `PUNCTUATION_BUDGET_MS` (Task 3) are what Task 4 imports; `punctuationReady` (Task 1) is what Task 5 wires.
- Departures from today, stated: `kind: 'none'` no longer streams (ruling 4); long typed text is one job (ruling 5); a stale cursor no longer survives an ASR error or an empty final (ruling 9); the analytics seal counts are not carried (ruling 7).
