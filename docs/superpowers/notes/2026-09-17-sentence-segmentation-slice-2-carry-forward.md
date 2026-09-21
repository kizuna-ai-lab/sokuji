# Sentence segmentation — slice 2 carry-forward

**Status: FINAL.** Every gate is closed. The whole-branch review returned
**Needs fixes** — two Important, nothing Critical — both were fixed, and the
scoped re-review of those fixes returned **Approved**. See the last section for
the outcome and the two Minors it left open.

The two Important findings were:

1. the hook handed back a permanently disposed runtime under StrictMode (see the
   runtime-owner section below — this is why the return type is nullable);
2. the model rows read on-disk facts from a volatile store nothing seeded, so a
   downloaded model showed "Download" after a restart.

One correction to the review itself, recorded because it affects how its report
reads: it judged finding 2 to leave the user *stranded*, with no way to delete a
240 MB model but "Clear all". That is wrong. `StoragePage.tsx:151-153` builds its
downloaded-model list from `Object.entries(currentStatuses)` filtered only on
`status === 'downloaded'`, with no type filter, so a downloaded punctuation model
does appear there with a working delete. The reviewer had read the punctuation
filter at `StoragePage.tsx:304`, which governs the **import dropdown** only, and
generalised it to the page. The defect was real — wrong status, needless
re-download — but recoverable.

Slice 2 is settings, state and UI. Branch
`worktree-sentence-segmentation-2-settings`, base `d86f598b` (slice 1's head),
head `d7226b94` — **19 commits, 47 files, +2,083 / −19**. Thirty of those files
are locale catalogs; the engineering is in seventeen.

**Nothing is segmented yet.** No client has a runtime. That is by design and is
the plan's own last acceptance criterion; slice 3 wires the local clients.

---

## API surface slice 3 consumes

**Settings** (`src/stores/settingsStore.ts`), three fields on `CommonSettings`
following the `keepReplayAudio` shape:

- `useSentenceSegmentation()` / `useSetSentenceSegmentation()` — boolean
- `useSentenceSegmentationChunkSentences()` / `useSetSentenceSegmentationChunkSentences()` — 1–5
- `sentenceSegmentationNoticeShown` / `markSentenceSegmentationNoticeShown` — **unused until slice 4's one-time download notice.** Not a settings-page control; it belongs in MainPanel's in-session notice family beside `EchoNotice`.

```ts
clampChunkSentences(value: unknown): number   // 1–5; null AND undefined → 3
```

The `null` case is load-bearing and was a real plan defect: without it, a stored
value that went missing falls to `Number(null) === 0` and clamps *up* to 1,
silently halving the smallest bubble for that user.

**Status store** (`src/stores/segmentationStore.ts`) — volatile, per-model:

```ts
useSegmentationStore            // { models: Record<PunctuationModelId, {status, percent, error}> }
useSegmentationModelState(model)
setModelStatus(model, status, error?)
setModelProgress(model, percent)
resetSession()                  // ready|loading|downloaded|disabled → 'downloaded'; everything else → 'not-downloaded'
seedFromModelStatuses(statuses) // on-disk truth → initial rows only; never overwrites a session fact
```

The runtime owns the truth and pushes into this store; **nothing reads back out
of the store into the runtime.** That is what keeps `PunctuationRuntime` free of
a store import and unit-testable with a fake worker. Preserve it.

**This store is volatile and starts empty every launch, so something has to tell
it what is already on disk. Two mechanisms do, and both earn their place — read
this before you "simplify" either away:**

1. `seedFromModelStatuses(useModelStatuses())`, in an effect keyed on
   `[modelStatuses]`. Cheap, and because it is keyed it **self-heals**: if
   `modelStore` initialises later in the session, the rows correct themselves.
2. A mount-time probe calling `ModelManager.getInstance().isModelReady(id)`
   directly. This exists because mechanism 1 does nothing for most users — see
   the `modelStore` gate under Standing facts. Without it, the ordinary path
   (download a model, restart on the default provider, open Settings) still
   showed "Download" for a model already on disk.

Both write into the same slot, gated on the status still being the initial
`'not-downloaded'`; **neither may overwrite a session fact** (`ready`, `loading`,
`downloading`, `error`, `disabled`).

The rejected alternative, and why: having the section call
`useModelStore.getState().initialize()` on mount would let mechanism 1 do all
the work and remove mechanism 2 — but `initialize()` walks the **entire**
`MODEL_MANIFEST`, every ASR, translation and TTS model, to answer a question
about three, and it would make a settings section responsible for an app-wide
side effect. Consolidating the two paths is a legitimate future cleanup; doing
it *that* way is not.

**A trap if you touch this:** the two stores speak different status
vocabularies. `modelStore` uses `'not_downloaded'` with an **underscore**;
`PunctuationStatus` uses `'not-downloaded'` with a **hyphen**. A direct
assignment compiles and yields a status string nothing matches.

**Runtime owner** (`src/components/MainPanel/useSegmentationRuntime.ts`):

```ts
useSegmentationRuntime(): SegmentationRuntime | null
```

**The return is nullable, and slice 3 must handle the null.** It is null for the
render before the mount effect runs. This deviates from the plan's stated
`Produces: useSegmentationRuntime(): SegmentationRuntime`, and the deviation was
deliberate.

The reason is worth knowing before you touch this hook. It originally built the
runtime in the render body behind a ref guard and disposed it in an empty-deps
effect cleanup. Under `React.StrictMode` — which this app uses
(`AppProviders.tsx:14`) — React 19's dev remount runs setup → cleanup → setup
while **preserving refs**, so the cleanup disposed the runtime and the render
body could never rebuild it, because the ref was still non-null. The hook then
returned a disposed instance forever, and `punctuate()` returns `null` once
disposed, which is indistinguishable from "no model available". Every dev run
would have had a silently dead segmentation stage.

It now constructs inside the effect, holds the instance in `useState`, and
disposes **and clears** on cleanup so the second setup rebuilds and the new
instance is republished. Nullability is the honest cost of that. Do not
"simplify" it back into the render body.

Builds the runtime once, forwards its events into the store and into
`reportWarning`. **Nothing calls it today** — `MainPanel.tsx` is untouched by
this slice. Slice 3 mounts it. The plan's architecture sentence says the hook
"hands the runtime to MainPanel"; that half is slice 3's, not a missing
implementation.

**UI**: `SentenceSegmentationSection`, exported from
`src/components/Settings/sections/index.ts`, mounted after `LanguageSection` in
both Simple and Advanced (General tab), deep link key `'sentence-segmentation'`
in `Settings.tsx`'s `NAVIGATION_TAB_MAP`. Correctly **absent** from
`SimpleSettings.tsx`'s earlier `EngineSurface` return branch.

**Locales**: exactly **11** keys under `settings.sentenceSegmentation*`, in all
30 catalogs.

---

## Rulings slice 3 must respect

1. **The hook is the only place a runtime is built.** Do not construct a second
   one in a client.
2. **Row actions reuse the pre-existing `models.*` namespace** — `download`,
   `downloaded`, `active`, `delete`, `error`, `retry` — already translated in all
   30 catalogs. Do not duplicate them into `sentenceSegmentation*` keys.
3. **Locale keys must match the component's callers exactly.** See S2-12 below.
   `grep -rn "settings\.sentenceSegmentation" src --include='*.ts' --include='*.tsx'`
   is the check; it should agree with the catalogs key-for-key.
4. Storage keys are `settings.common.<fieldName>`. `persistSetting` returns a
   boolean and the rollback is written inline in the action.
5. Stores and components add no `console.error` / `console.warn` —
   `consoleLedger.consistency.test.ts` enforces it.
6. The section's low-memory gate **mirrors** `PunctuationRuntime`'s own
   (`debug:device-memory` override, `?? 4` fallback, `<= 4` threshold), by
   deliberate duplication, because the runtime's `deviceMemoryGb()` is private.
   If either changes, change both.

---

## Carried to slice 3

- **Manual Download/Delete bypass `PunctuationRuntime`'s private state machine.**
  A live session's automatic download can race a manual click into a duplicate.
  Real but narrow. Deferred through slice 2 because fixing it means designing a
  shared surface the brief never specified — **and slice 3, which wires clients
  to that runtime, is exactly when that surface stops being hypothetical.** This
  is routed here rather than to slice 2's final review on purpose.

  **The sharper consequence, found by the final review:** a manual Delete while
  the runtime holds that model `'ready'` leaves the runtime serving from its
  loaded session. Then the 2-minute idle unload fires, `prepareModel` re-checks
  `isModelReady`, finds it false — and **silently re-downloads the model the user
  just deleted** (`PunctuationRuntime.ts:217-251`). Deleting 240 MB and having it
  quietly come back is a worse failure than the duplicate download this item was
  originally filed for. Design the shared surface with this case in mind.
- **Shared `dedupeKey` across two failure paths.** The manual download's
  `.catch()` and the runtime-driven `onStatus('error')` both use
  `segmentation:${model}` under scope `Segmentation`, so `passesThrottle`
  collides them: two real failures within 5s, one reaches LogsPanel. A secondary
  symptom of the race above; fix them together.
- **Segmented controls expose their selection by CSS class alone — repo-wide.**
  The five chunk buttons carry no `aria-pressed` and no `role="radiogroup"`, so a
  screen-reader user hears five unlabelled digits with no indication which is
  active. Deliberately **not** fixed here: the sibling this was copied from
  (`AudioDeviceSection.tsx:221-237`) has the identical gap, and per the repo's own
  match-the-nearest-sibling rule, fixing one instance and leaving the other is
  worse than leaving both. This wants one pass across every segmented control,
  not a patch here.
- **`tr` `ChunkTooltip` reads `konuşma` three times in one sentence.** A
  consequence of my ruling to qualify `konuşma balonu` at every mention rather
  than only the first. Grammatical, clumsy. Native-speaker polish.

**Not carried, despite an earlier draft of this note saying so: the low-memory
string is FIXED.** `settings.sentenceSegmentationLowMemory` now carries the
component's wording in all 30 catalogs ("does not **report** enough memory … so
they are disabled here"), which is the honest verb, since an absent
`navigator.deviceMemory` reads as exactly the 4 GB threshold. The tests had been
asserting the component default — a string no user ever saw, because the catalog
wins at runtime.

## Carried to slice 4

- **`onLoaded` is deliberately unwired** on `PunctuationRuntimeOptions`. It feeds
  slice 4's analytics.
- The one-time download notice, via `sentenceSegmentationNoticeShown`.

## Still parked, with reasons

`getModelSizeMb(entry)` omits `deviceFeatures` (correct today — all three entries
are single-variant — fragile if a GPU-conditional variant appears); the
low-memory box duplicates the `status-box` mixin; `AdvancedSettings/` has **no
test file at all**, so the Advanced-mode insertion is guarded by nothing but
review; and the new `.sentence-segmentation__model-error` line never got the
cross-locale render check the rest of the section had.

---

## Standing facts

- **Typecheck baseline: 319 errors across 80 files.** Measured, not inherited:
  `npx tsc --noEmit | grep -c "error TS"` → 319, and piping the same lines
  through `cut -d'(' -f1 | sort -u | wc -l` → 80. The bar is zero contribution,
  never a clean run. Never chain `tsc` after tests with `&&` — it exits non-zero
  at baseline and masks the test result.

  **The figure "319 errors across 154 files" that circulated through this whole
  slice is wrong in its second half.** It was carried into every task dispatch
  and into an earlier draft of this note. The error count was always right; the
  file count was not, and nobody checked it because the number it sat next to
  kept matching. The scoped re-reviewer questioned it and was correct. If you
  inherit a paired figure, re-derive both halves — one half verifying is not
  evidence for the other.
- **Suite: 4,455 passed / 3 failed / 2 skipped (4,460).** The three failures are
  the `hfRevision: 'TODO-COMMIT-SHA'` assertions in
  `modelManifest.punctuation.test.ts`, **failing by design** until three Hugging
  Face repositories are published — an outward action needing jiangzhuo's
  explicit per-repository confirmation. Do not invent a SHA.
- **`locales.consistency.test.ts` reaches further than it looks.** It flattens
  catalogs to dotted paths, so misnesting under the wrong parent fails parity in
  all 29. Its placeholder regex matches single-brace `{x}` as well as `{{x}}`.
  Its suites are `it.each(locales)` — **29 cases regardless of key count**, so
  adding keys never changes the suite total. What it cannot catch is whether a
  string is in the right language.
- The repo is inconsistent about curried `create<T>()(...)` vs uncurried; both
  are live.
- **`modelStore` is NOT initialised on every launch — it is gated to one
  provider.** `SettingsInitializer.tsx:77-82` returns early unless
  `provider === Provider.LOCAL_INFERENCE`, and the only other
  `await get().initialize()` (`modelStore.ts:436-439`) sits inside
  `ensureSelectionReady`, itself a local-inference path. The app defaults to
  `Provider.OPENAI`. **So `useModelStatuses()` is empty for most users most of
  the time**, and any code that reads on-disk model truth from it will silently
  do nothing. Both the final review and I assumed initialize "runs at startup";
  the implementer disproved it. If you need on-disk truth independent of
  provider, call `ModelManager.getInstance().isModelReady(id)`
  (`ModelManager.ts:453`) directly — that is what this section ended up doing.

---

## Process lessons

**S2-12 is the one worth internalising.** The plan specified locale keys in Task
6 and component markup in Task 4, written independently, and nothing reconciled
them. Only 6 of 18 keys were called; 5 keys the component *did* call were never
added, so five strings rendered English in all 29 non-English locales. Five
review seats passed it, because each reviewed one diff and the seam lives
between two. **The pre-flight scan is the gate that exists for this** — its rule
is a row for every pair of tasks that share a file *or an interface*, and a key
name is an interface. I wrote rows for shared files and not for shared names.

**A finding's recorded description decays faster than the code.** Two notes I
wrote myself were wrong when I came back to act on them: a line pointer into a
75-line file that said `117-121`, and a fix I had proposed one turn earlier that
would have turned a test into `set X, expect X`. Both were caught only by opening
the file. Read the site before acting on the index — including your own.

**Ask what renders X, not what mentions X.** Grepping for files mentioning
`config-section` instead of asking what renders `SimpleSettings` cost eleven
broken tests; the cause was the sections barrel mock, not the store mock I had
hypothesised.

**When a correction moves a file, re-read its imports, not just its location.**

**A stated expectation is a hypothesis, not an instruction.** The last
implementer reported `4,448` against my stated `(4,447)` and flagged the
mismatch — my arithmetic was wrong. A verification bar that gets quietly matched
instead of tested is worth nothing.

**A reviewer's confident claim is evidence, not a finding.** Two of the three
most consequential assertions made about this slice were wrong, and both came
from careful reviews rather than careless ones:

- The final review said the unseeded store left a user unable to delete a 240 MB
  model, with "Clear all" the only escape. It had read the punctuation filter at
  `StoragePage.tsx:304` — which governs the **import dropdown** — and generalised
  it to the whole page. `rows` is built with no type filter, so the delete works.
  The defect was real; the severity was not. **Check the scope of a claim, not
  just whether the line it cites exists.**
- The review and I both asserted that `modelStore.initialize()` "runs at
  startup". It is gated to one provider, and the app defaults to another. Nobody
  reviewing caught it; the implementer doing the work did, and said so instead of
  shipping a fix that mostly would not fire.

The pattern in both: the verification cost was one `grep` or one `sed -n`, and
in both cases the claim was believed because it was specific and came from
someone who had clearly looked. **Specificity is not verification.** Every
finding acted on in this slice was checked against the file first, and that is
why the two wrong ones cost nothing.

---

## Review outcome, and two more things slice 3 inherits

The scoped re-review of the four fix commits returned **Approved** — all six
findings closed, no new Critical or Important. It verified at the mechanism
level rather than the test level: it traced setup → cleanup → setup through the
hook itself and confirmed the returned value can only ever be `null` or the live
instance, and it checked that the StrictMode test is discriminating rather than
decorative (`toHaveBeenCalledTimes(2)` fails on its first assertion against the
old code, because the ref guard permitted exactly one construction).

Final numbers, all re-measured rather than quoted: **4,455 passed / 3 failed /
2 skipped (4,460)**, the three being the by-design `hfRevision` assertions;
**319 typecheck errors across 80 files**, zero in any file this slice touched.

Two Minors were left open deliberately. Both are small, neither has runtime
impact, and both sit in files slice 3 will be editing anyway.

**1. `segmentationStore` now has a *value* import of `PunctuationRuntime`
(`segmentationStore.ts:5`) where it used to be type-only and erased.** Deriving
the model roster from `MODEL_IDS` caused it. The consequence is that the store
transitively pulls in `WorkerSession`, `RequestRegistry`, `ModelManager`,
`checkWebGPU` and two `new URL(…, import.meta.url)` worker references. Nothing
breaks today — both non-test consumers already import that module and
`createPunctuationWorker` has no module-level side effect — but it has already
cost one test-mock change (`useSegmentationRuntime.test.ts` had to add
`MODEL_IDS` to its module mock or `Object.keys(undefined)` throws).

**The clean fix, if you are in these files:** move `MODEL_IDS` down to
`SegmentationRuntime.ts`, the leaf module that already owns
`PunctuationModelId`, and import it from there in both the store and the
section. That restores the store to a type-only dependency.

Worth being precise about why this matters, because the invariant above is
narrow: this note states that the runtime is kept free of a *store* import so it
stays unit-testable with a fake worker. That invariant still holds — the new
coupling runs the other way. But the reason behind it was to keep these two
modules independently testable, and half of that is now gone.

**2. Two test files still hand-keep the three-model roster** —
`useSegmentationRuntime.test.ts` (its mock of `MODEL_IDS`) and
`SentenceSegmentationSection.test.tsx` (`blankModelStates()`) — duplicating the
list that was just removed from production code. A fourth model id leaves them
stale. This fails loudly rather than shipping something wrong, which is why it
is Minor. `vi.importActual` for the first and deriving the second from
`MODEL_IDS` would close it.
