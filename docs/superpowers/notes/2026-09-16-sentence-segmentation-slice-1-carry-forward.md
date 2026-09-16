# Sentence segmentation — what slice 1 leaves for slices 2, 3 and 4

Slice 1 (foundation and runtime) is complete: twelve tasks, reviewed per task and
then as a whole branch. This note records what the later slices need and what the
work established, so none of it lives only in a scratch directory.

Nothing here is speculation. Every item is a landed interface, a measured figure,
or a ruling made during execution.

## The API slices 2 and 3 consume

`src/lib/segmentation/SegmentationRuntime.ts` — the interface the app layer sees:

- `PunctuationModelId = 'fireredpunc' | 'edge-punct-en' | 'sat-3l-sm'`
- `PunctuationResult { text, sentenceEnds, breakpoints, model }`
- `SegmentationRuntime { readonly enabled; punctuate(lang, text, opts?) }`

`PunctuationRuntime.ts` implements it and additionally exposes
**`retryDownload(model)`**, which the plan's Produces block omitted: only the
runtime holds per-model `'error'` state, so manual retry has to live there.
Slice 2's UI needs it.

`createPunctuationWorker.ts` is an isolated factory so the runtime can be tested
with the worker stubbed — stub at that seam, not deeper. `SentenceStream.ts` is
pure counting/gating/sealing with no I/O. `sentenceEnd.ts` holds the shared rule,
moved out of `OpenAILiveClient` (which shrank by 65 lines).

## Rulings that will otherwise be re-litigated

- **`baseLang` does not map Cantonese.** `baseLang('cantonese')` returns
  `'cantonese'` and `baseLang('yue')` returns `'yue'`; only `cmn` maps to `zh`.
  Both spellings route to FireRedPunc explicitly. Do not "fix" `baseLang` —
  `SentenceStream` depends on its current behaviour.
- **The app spells Cantonese `'cantonese'`, never `'yue'`** (`src/utils/languages.ts:62`;
  there is no `'yue'` key). `ModelManifestEntry.languages` uses the app's settings
  vocabulary because `getAsrModelsForLanguage`, `ModelManagementSection` and the
  `LanguageTags` renderer all compare against it. Two tests pin the spelling.
- **Manifest ids**: `punct-zh-fireredpunc`, `punct-en-edge`, `punct-multi-sat`,
  all `type: 'punctuation'`, deliberately excluded from every resolver pool.
  `StoragePage.tsx` carries a comment explaining the exclusion so nobody removes it.
- **Scoring vocabulary**: `summarize().boundary.f` is the sentence-end metric,
  `summarize().breakpoint.f` is the breakpoint metric (any mark). Reversing them
  produces a green test that means nothing.

## Standing project facts

- **Typecheck baseline: 319 errors across 154 files.** The bar is zero
  contribution, never a clean run. Verified on the final commit.
- **Suite: 4,399 tests.** The only failures are three `hfRevision` assertions in
  `modelManifest.punctuation.test.ts`, failing **by design** until the Hugging
  Face repositories are uploaded — an outward action needing explicit
  per-repository confirmation. The repos are staged locally; nothing is uploaded.
- **Four unhandled rejections** in `src/stores/settingsStore.nativeGate.test.ts`
  (`Cannot destructure property 'ready'` at `settingsStore.ts:892`) are
  **pre-existing and unrelated**: that file passes 16/16 in isolation and this
  branch touches nothing under `src/stores/`. Do not let them be attributed here.
- **Console ledger**: files under `src/lib/local-inference/workers/` are exempt;
  everything else stays at zero `console.error` / `console.warn`.

## Renderer memory — measured, and it changes two assumptions

Measured on a DGX Spark GB10 (Vulkan), n=3 for the sequential case, one machine.
Full tables in `2026-09-14-asr-punctuation-benchmark.md`.

Renderer working set never returns after unload: SaT **1,521 MB**, FireRedPunc
**767 MB**, Edge-Punct-en **235 MB**. Neither candidate fix recovers it — the
model bytes were already unreferenced, and `release()` returns ~0. A further
**240–472 MB (16–31%)** persists after releasing one model and loading another;
treat that as a range, since the weakest of three runs sits near the documented
noise ceiling.

Two consequences for slice 2, both needing a decision rather than a patch:

1. **The `deviceMemory ≤ 4` guard's *form* is correct** — a binary device gate,
   not a running budget. What deserves revisiting is the threshold, given one
   model can hold 1.5 GB. `navigator.deviceMemory` is coarse (rounded powers of
   two, absent on Safari and Firefox), so the missing-API fallback matters as
   much as the number.
2. **The 2-minute idle unload does not reclaim memory.** Whatever it is for, it
   is not that, and the spec currently implies otherwise.

## Open findings carried forward

The whole-branch review confirmed 29 per-task Minors unchanged, raised two to
Important (both fixed in the final round), and added seven of its own:

1. `PunctuationRuntime.ts` — `deviceMemoryGb()` falls back to 4 and the guard is
   `<= 4`, so **unknown** device memory disables the feature entirely. Latent
   (Chromium always reports it), but state the intent or use a sentinel.
2. Run results are matched by id only; `msg.result.model` is unchecked and
   `inferenceMs` is discarded — the very number the latency question needs.
3. The extended `ABBREVIATIONS` set **does** change `OpenAILiveClient`'s English
   behaviour: lowercase `b`, `e`, `z` and `ca`/`cf`/`av`/`apr`/`env`/`ud`/`sig`/
   `ing`/`avv` now suppress a cut, so "plan b. We go" no longer splits. All 73
   client tests still pass; worth a sentence in the module doc.
4. `punctuation-sat.ts` — `import('@huggingface/tokenizers')` has only ever run
   under node. Bundling it into a module worker is **unverified**; make it the
   first thing slice 3 proves.
5. `punctuation-core.ts` — the unprompted `ready` message carries meaningless
   `loadTimeMs: 0` / `device: 'wasm'`. Make them optional on that variant.
6. `PunctuationRuntime.ts` posts `{ type: 'boot' }`, not a member of
   `PunctuationWorkerInbound`, falling through the router's if-chain.
7. `punctuation-core.ts` types `InferenceSession`/`Tensor` as `any`; a two-method
   structural interface would keep both ORT entries honest at no cost.

The re-review of the final fixes added three more, all pre-existing and
non-blocking:

8. `SentenceStream.test.ts` — a test comment describing the pre-fix astral bug
   understates the damage by one character (says the space and the first `x`;
   the old code dropped the space and two). Comment only; the assertion is right.
9. `sealFromRule` — when `counted.length < n` it calls `tryLengthFallback` and
   returns `false`, so if that fallback performs a "length"-reason seal,
   `evaluate()`'s new loop does not re-check the remainder in the same tick; it
   waits for the next `update()`. Orthogonal to the sentence-counted path that
   was fixed, and never looped before either.
10. `applyResult`'s model-driven seal path seals one N-sentence group per model
    response and re-evaluates only when a `queued` tail exists. A single ~300-char
    call returning far more than N sentence-ends can therefore leave already-decided
    sentences sitting in `pending` until the next `update()`. Pre-existing, and
    outside what the offline-path fix targeted.

Also confirmed precisely: **`shaderF16Gate.consistency.test.ts` does not police
either worker entry** — neither is a candidate, because the model loading lives
in `_shared/`. An entry could delete its `bindCheckedWebGpuAdapter` call and
nothing would fail.

Two further items are decisions rather than defects, and are held for the
repository owner: the latency guard's 500 ms budget measured from enqueue (likely
to disable Chinese in the single-threaded extension, where the benchmark's own
figure is 394 ms and Chinese is 36% of speaker minutes), and the spec-versus-plan
disagreement about whether punctuation models appear in `StoragePage`'s
downloaded-model list.

## Process lessons

- Regenerate a task brief after **any** plan edit and grep it for the correction
  before dispatching. Two briefs went out stale before this became a rule.
- Land plan corrections **before** dispatching, never between dispatch and
  report — that drifted the review base five times.
- Check claims against live files, not against your own earlier prose. That
  caught a false consistency-test claim, a wrong `origin/main` conclusion, and a
  memory-guard "defect" that did not exist.
- A passing pre-check says nothing about cases absent from the fixture table: an
  eleven-row routing check passed and still missed `'cantonese'`.
