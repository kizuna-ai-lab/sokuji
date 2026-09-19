# Sentence Segmentation — Slice 3b: One Opt-In Download — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sentence segmentation an opt-in feature whose three punctuation models download together, once, after the user confirms — and which does nothing at all until all three are on disk.

**Architecture:** The setting flips from on-by-default to off-by-default. Turning it on opens a confirmation listing the three models and their combined size; confirming downloads all three, one after another, through `ModelManager`. `segmentationStore` stops tracking per-model status and tracks that one download instead ("the pack"): its phase, bytes done, and error. `PunctuationRuntime` loses its lazy download entirely — it only loads what is already on disk — and `runtime.enabled` becomes "the toggle is on AND the pack is ready AND the memory guard passes". Clients read `enabled` once, at connect, so a download finishing mid-session cannot make two layers seal at once.

**Tech Stack:** TypeScript, React, Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-sentence-segmentation-design.md`, Amendment A1 (2026-09-20) and the sections it lists.

## Global Constraints

- **TDD.** Every task writes its failing test first and runs it to see it fail before implementing.
- **English in code, comments and docs.** Chat with the repository owner is Chinese; nothing in the repo is.
- **30 locale catalogs.** `src/locales/*/translation.json`. `locales.consistency.test.ts` enforces an identical key set across all of them, so a key is added or removed in all 30 in the same commit. Real translations, never English placeholders in a non-English catalog.
- **Typecheck baseline is 319 errors** (`npx tsc --noEmit`). Zero new ones.
- **No `console.error` / `console.warn`.** `reportWarning` / `reportError` from `src/lib/diagnostics/report.ts`, per CLAUDE.md. `src/stores` and `src/services` are at zero and `consoleLedger.consistency.test.ts` fails if one comes back.
- **Run the suite as** `npx vitest run --exclude ".superpowers/**"` — an unfiltered run picks up reviewer scratch copies under `.superpowers/` and reports failures that are not real.
- **Model sizes are facts from the manifest**, never hand-written numbers: FireRedPunc `punct-zh-fireredpunc` 163,040,199 B, Edge-Punct `punct-en-edge` 7,639,930 B, SaT `punct-multi-sat` 251,042,560 B, total 421,722,689 B (402.2 MB through `formatBytes`).
- **Never push, never open or edit a PR.** The controller commits per task; the branch is pushed only when the repository owner says so.

---

## File Structure

| File | Change |
|---|---|
| `src/stores/settingsStore.ts` (+ `.test.ts`) | default `false`; `sentenceSegmentationNoticeShown` deleted |
| `src/stores/segmentationStore.ts` (+ `.test.ts`) | rewritten: the pack, not per-model status |
| `src/lib/segmentation/PunctuationRuntime.ts` (+ `.test.ts`) | no downloads; `enabled` includes the memory guard; `isLowMemoryDevice` exported |
| `src/components/MainPanel/useSegmentationRuntime.ts` (+ `.test.ts` if present) | `isEnabled` = toggle AND pack ready; refresh on mount |
| `src/services/clients/LocalInferenceClient.ts`, `LocalNativeClient.ts` (+ tests) | read `enabled` once per session |
| `src/components/Settings/sections/SentenceSegmentationSection.tsx` (+ `.scss`, `.test.tsx`) | rewritten: toggle, N, download state, delete link |
| `src/components/Settings/sections/SegmentationDownloadModal.tsx` (+ `.test.tsx`) | **new** — the confirmation |
| `src/components/Settings/engine/StoragePage.tsx` (+ `.test.tsx`) | punctuation models filtered out; Clear all refreshes the pack |
| `src/locales/*/translation.json` | new download-state keys; three orphaned keys removed |
| `docs/superpowers/notes/2026-09-20-sentence-segmentation-slice-3b-carry-forward.md` | **new** |

---

## Task 1: The setting defaults to off

**Files:**
- Modify: `src/stores/settingsStore.ts`
- Test: `src/stores/settingsStore.test.ts`

**Interfaces:**
- Consumes: nothing from this slice.
- Produces: `sentenceSegmentation` still `boolean` with the same actions and hooks; `sentenceSegmentationNoticeShown`, `markSentenceSegmentationNoticeShown`, `useSentenceSegmentationNoticeShown` and `useMarkSentenceSegmentationNoticeShown` no longer exist.

- [ ] **Step 1: Write the failing test**

In `settingsStore.test.ts`, alongside the existing segmentation cases:

```typescript
it('defaults sentence segmentation to off', () => {
  expect(useSettingsStore.getState().sentenceSegmentation).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

`npx vitest run src/stores/settingsStore.test.ts` — fails with `true`.

- [ ] **Step 3: Flip the default and delete the notice flag**

In `settingsStore.ts`: `sentenceSegmentation: false` in the defaults (around line 169). Then delete every trace of the notice flag — the two interface declarations, the default, the action `markSentenceSegmentationNoticeShown`, the `getSetting` load and the object property it feeds, and both hooks. `grep -rn "NoticeShown" src` must come back empty except for locale files, which have none.

The setting's doc comment currently reads "On by default; see the design's D12." Replace it with the A1 rule: off by default, and the feature is inert until the three models are downloaded.

- [ ] **Step 4: Delete the notice flag's own test block**

Remove the `describe('sentenceSegmentationNoticeShown', …)` block (around `settingsStore.test.ts:436`).

- [ ] **Step 5: Run and commit**

```bash
npx vitest run src/stores/settingsStore.test.ts
npx tsc --noEmit 2>&1 | grep -c "error TS"   # 319
git add src/stores/settingsStore.ts src/stores/settingsStore.test.ts
git commit -m "feat(segmentation): default the stage to off and drop the notice flag"
```

---

## Task 2: `segmentationStore` owns the one download

**Files:**
- Rewrite: `src/stores/segmentationStore.ts`
- Rewrite: `src/stores/segmentationStore.test.ts`

**Interfaces:**
- Consumes: `MODEL_IDS` from `PunctuationRuntime`, `getManifestEntry` / `getModelSizeMb` from `modelManifest`, `ModelManager`.
- Produces, and every later task uses exactly these names:

```typescript
export type PackPhase = 'unknown' | 'missing' | 'downloading' | 'ready' | 'error';

export interface PackModel {
  model: PunctuationModelId;
  manifestId: string;
  /** The manifest's display name, e.g. "FireRedPunc (Chinese)". */
  name: string;
  sizeBytes: number;
}

/** The three models, in manifest order, with their sizes read from the manifest. */
export const PACK_MODELS: PackModel[];
export const PACK_TOTAL_BYTES: number;

interface SegmentationStore {
  phase: PackPhase;
  /** Bytes on disk or fetched so far, summed over the three models. */
  downloadedBytes: number;
  error: string | null;
  /** Ask the disk. Never interrupts an in-flight download. */
  refresh(): Promise<void>;
  /** Download every model that is not already on disk, one after another. */
  download(): Promise<void>;
  /** Abort the in-flight download. Finished files stay for the next resume. */
  cancel(): void;
  /** Delete all three models' files. */
  deleteModels(): Promise<void>;
}

export const useSegmentationPhase: () => PackPhase;
export const useSegmentationProgress: () => { downloadedBytes: number; totalBytes: number };
```

- [ ] **Step 1: Write the failing tests**

Rewrite `segmentationStore.test.ts` against a mocked `ModelManager` (`vi.mock('../lib/local-inference/ModelManager')`, an object with `isModelReady`, `downloadModel`, `cancelDownload`, `deleteModel`). Cases:

```typescript
it('pins the pack against the manifest', () => {
  expect(PACK_MODELS.map((m) => m.manifestId))
    .toEqual(['punct-zh-fireredpunc', 'punct-en-edge', 'punct-multi-sat']);
  expect(PACK_TOTAL_BYTES).toBe(421_722_689);
});

it('refresh reports ready only when all three are on disk', async () => { … });
it('refresh reports missing, and counts the models that are there', async () => { … });
it('download skips a model already on disk and sums progress over the rest', async () => { … });
it('download ends ready and leaves downloadedBytes at the total', async () => { … });
it('a failed model stops the download, records the message and leaves phase error', async () => { … });
it('cancel aborts the in-flight model, leaves phase missing, and keeps what is downloaded', async () => { … });
it('a resolution that lands after a cancel cannot flip the phase to ready', async () => { … });
it('deleteModels deletes all three and reports missing', async () => { … });
it('refresh during a download does not touch the phase', async () => { … });
```

The pinned total is what makes a manifest size edit visible here rather than in the user's face.

- [ ] **Step 2: Run them and watch them fail**

`npx vitest run src/stores/segmentationStore.test.ts`.

- [ ] **Step 3: Implement the store**

Derive the roster from the manifest, so a size or a file list that changes in the manifest changes here too:

```typescript
export const PACK_MODELS: PackModel[] = (Object.keys(MODEL_IDS) as PunctuationModelId[])
  .map((model) => {
    const manifestId = MODEL_IDS[model];
    const entry = getManifestEntry(manifestId);
    if (!entry) throw new Error(`Punctuation model missing from the manifest: ${manifestId}`);
    const variant = entry.variants[Object.keys(entry.variants)[0]];
    return {
      model,
      manifestId,
      name: entry.name,
      sizeBytes: variant.files.reduce((sum, f) => sum + f.sizeBytes, 0),
    };
  });

export const PACK_TOTAL_BYTES = PACK_MODELS.reduce((sum, m) => sum + m.sizeBytes, 0);
```

`download()`:
- bump a module-level `generation` counter and capture it; every write back into the store checks it is still current, so a late resolution after a `cancel()` or a second `download()` cannot flip the phase;
- set `phase: 'downloading'`, `error: null`;
- for each model in order: `isModelReady` → if true, add its `sizeBytes` to a running `completed` total and continue; else `downloadModel(manifestId, p => set({ downloadedBytes: completed + p.downloadedBytes }))`, then `completed += sizeBytes`;
- on success set `phase: 'ready'`, `downloadedBytes: PACK_TOTAL_BYTES`;
- on an `AbortError` (that is `cancel()`) set `phase: 'missing'` and leave `downloadedBytes` where it is;
- on any other failure set `phase: 'error'` with `describeCause(err)`, and `reportWarning('Segmentation', …, { dedupeKey: 'segmentation:download' })`.

`cancel()` calls `ModelManager.getInstance().cancelDownload(manifestId)` for the model currently in flight (track it in a module-level variable) and bumps the generation.

`refresh()` returns early while `phase === 'downloading'`. Otherwise it asks `isModelReady` for all three and sets `ready`/`missing` with `downloadedBytes` summed over the models that are there. A model whose `isModelReady` throws counts as missing.

`deleteModels()` calls `ModelManager.getInstance().deleteModel(manifestId)` for all three, then `refresh()`. Deleting a model that was never downloaded is not an error.

Keep the store free of UI concerns: it stores bytes, never formatted strings.

- [ ] **Step 4: Run, typecheck and commit**

```bash
npx vitest run src/stores/segmentationStore.test.ts
npx tsc --noEmit 2>&1 | grep -c "error TS"
git add src/stores/segmentationStore.ts src/stores/segmentationStore.test.ts
git commit -m "feat(segmentation): track the three models as one download"
```

Other files still import the old store API at this point, so the full suite is red until Task 3 and Task 5 land. That is expected; the typecheck count is the gate that matters here, and it will show those call sites.

---

## Task 3: The runtime stops downloading, and `enabled` means ready

**Files:**
- Modify: `src/lib/segmentation/PunctuationRuntime.ts`
- Modify: `src/components/MainPanel/useSegmentationRuntime.ts`
- Test: `src/lib/segmentation/PunctuationRuntime.test.ts`, and the hook's test if one exists

**Interfaces:**
- Consumes: `useSegmentationStore` (`phase`, `refresh`) from Task 2.
- Produces: `export function isLowMemoryDevice(): boolean` from `PunctuationRuntime.ts`; `PunctuationRuntimeOptions` without `onDownloadProgress`; no `retryDownload`.

- [ ] **Step 1: Write the failing tests**

In `PunctuationRuntime.test.ts`:

```typescript
it('never downloads a model that is not on disk', async () => {
  // isModelReady false → punctuate() returns null, downloadModel is never called,
  // and onStatus reports 'error' with a reason naming the missing files.
});

it('loads a model that is already on disk', async () => { … });

it('is disabled on a low-memory device even when the toggle is on', () => {
  // localStorage 'debug:device-memory' = '4' → runtime.enabled === false
});
```

Delete the tests that covered `startDownload` / `retryDownload` and the download-progress callback.

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Change the runtime**

```typescript
/** Exported so the settings section and the app-level hook apply the same gate
 *  the runtime does, instead of keeping their own copy of the threshold. */
export function isLowMemoryDevice(): boolean {
  return deviceMemoryGb() <= MIN_DEVICE_MEMORY_GB;
}

get enabled(): boolean {
  return this.opts.isEnabled() && !isLowMemoryDevice();
}
```

Delete `startDownload`, `retryDownload` and `onDownloadProgress`. In `prepareModel`, the `'not-downloaded'` branch becomes:

```typescript
if (!alreadyReady) {
  // A1: nothing downloads here. The section owns the download, and
  // `enabled` is false until all three models are on disk — so reaching
  // this means the files went away underneath us (storage cleared, or a
  // delete from another surface). Rule-only for the rest of the session.
  state.status = 'error';
  this.opts.onStatus?.(model, 'error', 'model files missing');
  return false;
}
```

`punctuate()` keeps its own memory check; route it through `isLowMemoryDevice()` so there is one threshold in the file.

- [ ] **Step 4: Change the hook**

```typescript
isEnabled: () => enabledRef.current && useSegmentationStore.getState().phase === 'ready',
```

Drop the `onDownloadProgress` option and the `onStatus` store write (`setModelStatus` no longer exists); `onStatus` keeps its two `reportWarning` calls, which are now the only consumer. Add, inside the same mount effect, `void useSegmentationStore.getState().refresh();` so the pack's phase is known at startup without the Settings panel ever being opened.

- [ ] **Step 5: Run, typecheck and commit**

```bash
npx vitest run src/lib/segmentation src/components/MainPanel
git add src/lib/segmentation src/components/MainPanel/useSegmentationRuntime.ts
git commit -m "feat(segmentation): the runtime loads, it never downloads"
```

---

## Task 4: A client decides once per session

**Files:**
- Modify: `src/services/clients/LocalInferenceClient.ts`
- Modify: `src/services/clients/LocalNativeClient.ts`
- Test: `src/services/clients/LocalInferenceClient.test.ts`, `src/services/clients/LocalNativeClient.test.ts`

**Interfaces:**
- Consumes: `SegmentationRuntime.enabled` (unchanged shape).
- Produces: no new exports. Both clients gain a private per-session boolean.

**Why:** `LocalInferenceClient` decides `punctuationEndpoint` once, at ASR init — the worker splits sentences itself when the stage will not. `ensureStream()` re-reads `segmentation.enabled` per utterance. Before A1 the toggle could not move during a session, so the two agreed. Now the pack can become ready mid-session, which would flip `ensureStream()` on while the worker is still splitting: both layers would seal. One read, at connect, keeps the invariant "exactly one of the two seals".

- [ ] **Step 1: Write the failing tests**

In both client test files:

```typescript
it('ignores a runtime that becomes enabled mid-session', async () => {
  const runtime = { enabled: false, punctuate: vi.fn() };
  await client.connect(config);
  runtime.enabled = true;                       // the download finished
  // …feed a long unpunctuated utterance…
  // one item, one translation job: the stage stayed off for this session
});
```

For `LocalInferenceClient`, also assert that `punctuationEndpoint` stayed `true` in that case, from the streaming-ASR init call the test already inspects.

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement**

In each client, add a private field and set it in `connect()` before the ASR is initialised:

```typescript
/** Read once per session: the pack can finish downloading mid-session, and
 *  the two layers that can seal (the ASR worker's own endpoint and this
 *  stage) are chosen from the same answer. */
private segmentationActive = false;
```

`LocalInferenceClient.connect()`: `this.segmentationActive = !isAstMode && this.segmentation?.enabled === true;` — set it before the `init` call that reads `punctuationEndpoint`, and use `punctuationEndpoint: !this.segmentationActive`. `ensureStream()` becomes `if (!this.segmentationActive || !this.segmentation) return null;`.

`LocalNativeClient`: same field, set in `connect()`, used by `ensureStream()`.

Both `disconnect()` paths set it back to `false`.

Update the two long comments that explain the old reasoning (they currently say the section's `disabled={isSessionActive}` is what makes stream reuse safe) to state the new one: the value is read once per session, so nothing can change under an open stream.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/services/clients
git add src/services/clients
git commit -m "feat(segmentation): a session keeps the answer it got at connect"
```

---

## Task 5: The section asks once, then downloads

**Files:**
- Create: `src/components/Settings/sections/SegmentationDownloadModal.tsx`
- Rewrite: `src/components/Settings/sections/SentenceSegmentationSection.tsx`
- Modify: `src/components/Settings/sections/SentenceSegmentationSection.scss`
- Rewrite: `src/components/Settings/sections/SentenceSegmentationSection.test.tsx`
- Create: `src/components/Settings/sections/SegmentationDownloadModal.test.tsx`
- Modify: `src/locales/*/translation.json` (all 30)

**Interfaces:**
- Consumes: `PACK_MODELS`, `PACK_TOTAL_BYTES`, `useSegmentationPhase`, `useSegmentationProgress`, and the store's `refresh` / `download` / `cancel` / `deleteModels` (Task 2); `isLowMemoryDevice` (Task 3); `formatBytes` from `src/lib/local-inference/formatBytes.ts`.
- Produces: `SegmentationDownloadModal`, a `Modal`-based confirmation with `{ isOpen, onConfirm, onClose }`.

- [ ] **Step 1: Write the failing tests**

`SegmentationDownloadModal.test.tsx`: it lists all three model names with their sizes and the total (`402.2 MB`); Cancel calls `onClose` and not `onConfirm`; Download calls `onConfirm`.

`SentenceSegmentationSection.test.tsx`, rewritten around behaviour rather than rows:

```typescript
it('turning the toggle on with no models opens the confirmation and does not enable yet', …);
it('confirming enables the setting and starts the download', …);
it('cancelling the confirmation leaves the setting off', …);
it('turning the toggle on when the models are ready enables it without asking', …);
it('shows progress and a cancel action while downloading', …);
it('cancelling the download turns the setting back off', …);
it('shows the error and a retry action after a failed download', …);
it('offers Download again when the setting is on but the files are missing', …);
it('disables the sentences-per-bubble control until the models are ready', …);
it('offers a delete link, with the size, only when the setting is off and files exist', …);
it('cannot be turned on on a low-memory device, and says why', …);
it('disables the toggle, the download actions and the delete link during a session', …);
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Build the confirmation**

Follow `SonioxCloneConfirmModal.tsx` and `LicenseConsentModal.tsx`: the shared `Modal` primitive, a body, and a Cancel/confirm pair using the same class names as the nearest sibling modal — do not invent a new button pattern. The body is one line of purpose, then one row per model (`name` on the left, `formatBytes(sizeBytes)` on the right), then a total row. Sizes come from `PACK_MODELS`, never from literals.

- [ ] **Step 4: Rewrite the section**

Delete `ModelRow`, the `MODELS` list, the duplicated `deviceMemoryGb`, the language-pair lookup and the two seeding effects. What stays: the heading, the toggle, the Sentences-per-bubble control, and the low-memory box.

```
toggle.onChange:
  if (on)                        → setSentenceSegmentation(false); if (phase === 'downloading') cancel();
  else if (phase === 'ready')    → setSentenceSegmentation(true);
  else                           → open the confirmation
confirmation.onConfirm           → setSentenceSegmentation(true); void download();
```

- `checked` is the setting. `disabled` is `isSessionActive || (lowMemory && !sentenceSegmentation)` — a low-memory device cannot turn it on, but a user who had it on can still turn it off.
- One status line under the toggle, only while the setting is on and `phase !== 'ready'`:
  - `downloading`: a progress bar plus `formatBytes(downloadedBytes)` of `formatBytes(PACK_TOTAL_BYTES)`, and a Cancel button;
  - `error`: the message and a Retry button (`void download()`);
  - `missing`: a Download button that opens the same confirmation;
  - `unknown`: nothing.
- Sentences per bubble: `disabled={isSessionActive || !sentenceSegmentation || phase !== 'ready'}`.
- Delete link: shown when the setting is off and `downloadedBytes > 0`; label carries `formatBytes(downloadedBytes)`; calls `deleteModels()`; disabled during a session.
- `useEffect(() => { void refresh(); }, [])` on mount, so opening Settings re-checks the disk after a Clear all elsewhere.

Reuse the existing SCSS blocks where the shape is the same, and match the progress bar to the nearest existing one in Settings (`ModelManagementSection`'s card) rather than a new visual language.

- [ ] **Step 5: Locale keys, all 30 catalogs, in this commit**

Remove: `sentenceSegmentationModelInUse`, `sentenceSegmentationModelLoading`, `sentenceSegmentationModelUnavailable`.

Reword `sentenceSegmentationDesc` — it currently ends "A small model is downloaded only when it is first needed", which A1 makes false. English: "When a transcript arrives without punctuation, add it and start a new bubble every few sentences. Turning this on downloads three small models."

Add (English shown; all 29 other catalogs get real translations in the same commit):

```json
"sentenceSegmentationDownloadTitle": "Download segmentation models",
"sentenceSegmentationDownloadBody": "Sentence segmentation needs three models, one per language group. They download once and stay on this device.",
"sentenceSegmentationDownloadTotal": "Total",
"sentenceSegmentationDownloadConfirm": "Download {{size}}",
"sentenceSegmentationDownloadCancel": "Cancel",
"sentenceSegmentationDownloading": "Downloading {{done}} of {{total}}",
"sentenceSegmentationDownloadFailed": "Download failed: {{error}}",
"sentenceSegmentationDownloadMissing": "The models are not on this device.",
"sentenceSegmentationDownloadAction": "Download",
"sentenceSegmentationRetry": "Retry",
"sentenceSegmentationDeleteModels": "Delete models ({{size}})",
"sentenceSegmentationLowMemoryOn": "This device does not report enough memory to run these models, so this cannot be turned on."
```

Keep `sentenceSegmentationLowMemory` if the box still renders it; drop whichever of the two is unused rather than leaving a dead key. Every `{{placeholder}}` must survive translation verbatim.

- [ ] **Step 6: Run and commit**

```bash
npx vitest run src/components/Settings src/locales
npx tsc --noEmit 2>&1 | grep -c "error TS"
git add src/components/Settings src/locales
git commit -m "feat(segmentation): ask once, then download all three models"
```

---

## Task 6: The models leave the Storage page

**Files:**
- Modify: `src/components/Settings/engine/StoragePage.tsx`
- Test: `src/components/Settings/engine/StoragePage.test.tsx`

**Interfaces:**
- Consumes: `useSegmentationStore.refresh` (Task 2), `getManifestEntry` (already imported there).
- Produces: nothing.

**Why:** the spec has always said punctuation models are filtered out of `StoragePage`; the code never did it, so they show up as nameless rows a user can delete behind the feature's back. With A1 the section's own delete link is the one place to remove them.

- [ ] **Step 1: Write the failing tests**

```typescript
it('does not list punctuation models among the downloaded rows', … );
it('re-checks the segmentation pack after Clear all', … );
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement**

In the WASM branch of the rows builder (`StoragePage.tsx:151`), drop entries whose manifest `type === 'punctuation'`. In `doClearAll`, after `deleteAllModels()`, `await useSegmentationStore.getState().refresh()` — the clear wipes the whole IndexedDB, punctuation included, and the section must not keep claiming the models are ready.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/components/Settings/engine
git add src/components/Settings/engine
git commit -m "fix(segmentation): keep punctuation models off the storage page"
```

---

## Task 7: Look at it, then write it down

**Files:**
- Create: `docs/superpowers/notes/2026-09-20-sentence-segmentation-slice-3b-carry-forward.md`

- [ ] **Step 1: Run everything**

```bash
npx vitest run --exclude ".superpowers/**"
npx tsc --noEmit 2>&1 | grep -c "error TS"    # 319
```

- [ ] **Step 2: Render the section and look at it**

Per `sokuji-ui-decisions-by-rendering`: build and drive it with headless chromium over CDP, and capture the five states — off with no files, the confirmation, downloading, failed, ready — plus one narrow locale (de or ru) to check the status line does not wrap badly. Fix what looks wrong before writing the note.

- [ ] **Step 3: Write the carry-forward note**

What it must record: the states as rendered, anything the review deferred, and the two things this slice deliberately does not solve — the IndexedDB storage total on `StoragePage` still counts the punctuation bytes it no longer lists, and an interrupted download does not resume by itself on the next launch (the user presses Download, which resumes from the stored files).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/notes/2026-09-20-sentence-segmentation-slice-3b-carry-forward.md
git commit -m "docs(segmentation): record the slice 3b carry-forward"
```

---

## Done when

- The feature is off in a fresh profile, and turning it on shows the three models and 402.2 MB before anything is fetched.
- Nothing downloads a punctuation model except that confirmed action.
- With the setting on and the models not all present, a session behaves exactly as it does on `main`: no sealing, no model calls.
- A download that finishes during a session does not change that session.
- Cancelling, retrying and deleting all work from the section, on any provider.
- `npx vitest run --exclude ".superpowers/**"` is green and `npx tsc --noEmit` stays at 319 errors.
