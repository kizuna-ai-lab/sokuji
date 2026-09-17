# Sentence segmentation — slice 3 carry-forward

**Status: FINAL.** The whole-branch review has run and returned **ready to
integrate** — no Critical, no Important, three Minors. Its findings are in the
last section, "Final review outcome".

Tasks 1–3 are complete and reviewed. **Task 4 is a live manual check that no
agent can run**, and it is the only step that demonstrates what the slice exists
for: that the translation starts appearing before the speaker stops.

Slice 3 wires the segmentation stage into the two **local** clients, which carry
roughly 70% of production minutes. Branch
`worktree-sentence-segmentation-3-local-clients`, base `7112796a` (slice 2's
head), head `0527f4c6` — **13 commits, 11 files, +1,819 / −35**. Ten of those
files are the engineering; the eleventh is the plan document, corrected during
execution.

**Slice 3 is the first slice that actually segments anything.** Slices 1 and 2
built the runtime, the settings and the UI, but no client had a runtime.

---

## The fact slice 4 most needs

**A descriptor's `createClient` receives `ClientOptions` and most of them throw
it away.** Task 1 threaded the runtime from `MainPanel` all the way to
`descriptor.createClient(...)`, and for both local providers it landed in a black
hole: `createClient(_creds, _options)` returning `new SomeClient()` with no
arguments. The feature compiled, tested green, and did nothing in production.
Nothing in Task 1's scope could have caught it; an implementer found it while
doing Task 2.

**Slice 4 owns the online providers, so this is its work.** As of `0527f4c6`,
still discarding their options:

`KizunaAIVolcengineAST2`, `KizunaAIOpenAITranslate`, `Soniox`, `OpenAILive`,
`ZoomAI`, `Gemini`, `PalabraAI`, `VolcengineAST2`, `VolcengineST`

Already consuming `options` for their own reasons (so wiring is additive):
`OpenAICompatible`, `KizunaAISoniox`, `OpenAITranslate`, `OpenAI`.

Fixed by this slice: `LocalInference`, `LocalNative`.

The check is one command:

```
grep -n "createClient(" src/services/providers/*.ts
```

An underscore on `_options` means the injection stops there. **"The runtime
reaches every client" is true of the plumbing and false of the wiring until each
provider opts in.**

---

## API surface

```ts
// src/services/providers/ProviderDescriptor.ts
ClientOptions.segmentation?: SegmentationRuntime | null
ClientOptions.sentencesPerChunk?: number

// src/components/MainPanel/clientOptions.ts
buildClientOptions(input): ClientOptions   // pure; spreads ...legOptions LAST
```

`buildClientOptions` exists as a pure function because this repo has **no React
rendering harness for MainPanel** — the same constraint that produced
`sessionModelTelemetry.ts`. It is the only way the shipped decision is the tested
one. `segmentation` is set inside it rather than at the leg call sites, because
the WebRTC→WebSocket fallback calls `createAIClient(false)` with no leg options
at all and a field added at those sites vanishes there silently.

**The nullable is deliberate.** Slice 2's `useSegmentationRuntime()` returns
`SegmentationRuntime | null` so it survives React StrictMode's dev remount. Do
not narrow it or coerce with `?? undefined`; clients take it as
`options.segmentation ?? null`.

---

## The five rules both clients implement — and why each exists

The plan's literal snippets were wrong in three ways and the fixes cost five
rounds between the two clients. Anything wiring a *new* client to the stage needs
all five.

1. **`ensureStream()` must test `runtime.enabled`, not merely that a runtime
   exists.** `active()` requires both (`SentenceStream.ts:135-137`). Without it a
   disabled runtime shows partials but never seals, and since the new result path
   returns early whenever a stream exists, the legacy body never completes the
   bubble either — **zero items, zero jobs, the whole utterance gone.**
2. **The result handler must call `ensureStream()`, not read the bare `stream`
   field.** Otherwise a final arriving with no preceding partials — every offline
   ASR model — is never segmented.
3. **`update()` takes the text since the last seal, not the cumulative
   hypothesis.** Both sources send cumulative partials: the sherpa worker posts
   its whole hypothesis, and the sidecar appends to `_pending` and posts the
   buffer (`asr_engine.py:454-455`), resetting only at a cut.
4. **Advance the cursor by RAW CONSUMED, never by the sealed text's length.** On
   the model path the sealed text carries punctuation the raw input did not, so
   `sealedChars += chunk.text.length` over-advances by one character per inserted
   mark and **silently deletes user speech**. Derive it inside `onPending`:
   `sealedCharsBase + lastPassedToStream.length - remainder.length`. This is
   correct even when one `update()` seals repeatedly, because `pending` is always
   a raw suffix of the string passed to that `update()` — so the recompute is
   absolute, not incremental.
5. **Guard the short or rewritten final, comparing TRIMMED forms.** When the
   slice would be empty, a final that is a truncation of the same utterance must
   close the open bubble **without** a second job and leave the cursor alone;
   only genuine divergence resets. The trim matters because partials are
   accumulated untrimmed while finals are trimmed — voxtral and cohere overwrite
   with `batch_decode(...).trim()`, and the sidecar's `_result_event` applies
   `.strip()`. A raw `startsWith` reads a truncation as divergence and produces a
   **duplicate bubble and a duplicate spoken translation**.

Rules 4 and 5 have regression tests in both clients
(`LocalInferenceClient.test.ts:318`, `:379`, `:425`, `:467`, and the ports in
`LocalNativeClient.test.ts`). **Do not delete them as redundant.** Rule 4's test
is the only case in either file whose `punctuate` returns non-null; every other
case stubs it to `null`, which removes the sole path where sealed length and raw
consumption differ — that stub is why the bug survived three fix rounds.

---

## Where the two clients deliberately differ

- **Job queues.** Local Inference pushes onto an array (`ttsQueue` →
  `processQueue`); Local Native chains a promise tail (`this.queue.then(...)`).
- **ASR timing.** Local Native threads `asrTiming` through `runJob`, captured
  synchronously in `sealUserChunk`, because the job runs *after* `onAsrResult`
  clears `pendingAsrTiming`. Reading it lazily inside the continuation finds
  `undefined`. Local Inference reads the field at push time.
- **The redundant `text.length > 0` guard.** Kept in both, on purpose. Local
  Native's is dead code — `onAsrPartial` already returns on falsy text
  (`:572-573`) — but Local Inference's `handlePartialAsrResult` has **no**
  internal guard (`:748-749`) and voxtral can post an empty first partial, so its
  copy is live. Removing both changes Local Inference's behaviour; removing one
  breaks the symmetry. **Leave them.**
- **AST mode.** Local Inference has it and must never create a stream in it.
  Local Native has no AST mode at all — no `astMode`, no granite path — so it has
  no equivalent case. Final counts: **13 new cases in Local Inference, 12 in
  Local Native** (54 pre-existing there, 66 total), the difference being exactly
  that missing AST case.

---

## Carried forward

**To Task 4 (live check, a human must run it):** three risks were routed there
rather than chased statically, and the handover written for it explains each —
a possible duplicate bubble if a model normalises the *interior* of retained text
(the trim guard covers only length and edge whitespace); the unverified
inference that a sidecar "cut" is what produces the client's `onAsrResult`; and
a chunk that begins **mid-word**, because the truncation guard fires only when
the slice is empty, so a re-decode that rewords the utterance while ending up
*longer* than the cursor skips it entirely and the byte offset no longer means
anything. All three share a shape: reachable only with real models on real
audio, and invisible to any unit test.

**To slice 4:** the descriptor wiring above; `onLoaded` still unwired on
`PunctuationRuntimeOptions`, feeding slice 4's analytics; and the one-time
download notice via `sentenceSegmentationNoticeShown`.

**Still parked:** `lastRawPartialText` is now cleared at all four teardown sites
in both clients, but its per-utterance reset inside the result handlers is
separate — the two lifecycles are worth keeping in mind together.

---

## Standing facts

- **Suite: 4,486 passed / 3 failed / 2 skipped (4,491).** The three are
  `modelManifest.punctuation.test.ts` asserting
  `hfRevision: 'TODO-COMMIT-SHA'`, **failing by design** until three Hugging Face
  repositories are published — an outward action needing jiangzhuo's explicit
  per-repository confirmation. Do not invent a SHA.
- **Typecheck: 319 errors across 80 files.** Measured, not inherited
  (`grep -c "error TS"` → 319; the same lines through
  `cut -d'(' -f1 | sort -u | wc -l` → 80). The bar is zero contribution. **Never
  chain `tsc` after tests with `&&`** — it exits non-zero at baseline and reports
  failure regardless of the tests.
- `settingsStore.nativeGate.test.ts` emits unhandled rejections while passing
  16/16. Pre-existing.
- **`LocalInferenceClient` had no test file at all** before this slice. Its
  no-runtime and disabled-runtime cases are the entire regression net for that
  client. `LocalNativeClient` had 54 cases already.

---

## Process lessons

**Sixteen defects, fifteen of them in the plan rather than the code.** That ratio
is the headline. The code was rarely wrong; the instructions were.

**Three of the best catches came from implementers refusing an instruction.**
Task 2 found the dead descriptor injection that no test could have caught, and
disproved three snippets it had been told to copy. The cleanup batch refused to
delete a guard I had called redundant, because it was live in one client and dead
in the other. Every one of those dispatches carried an explicit invitation to
push back; without it the likely outcome was silent compliance producing a worse
artifact.

**My own three defects were one mistake repeated.** "All eight of Task 2's cases
apply here" — one did not. "Eight is still the right count" — it had stopped
being right three fix rounds earlier. "The guards are mirrored between the two
clients" — they are not. Each time the grep was accurate and the sentence built
on it was false. **Verifying what a name refers to is not verifying what a
sentence asserts about it.**

**An extracted artifact is not the section it came from.** Reading the generated
Task 3 brief — not the plan section it was extracted from — caught three defects,
including a `git add` that omitted the one file without which the whole task was
inert. Everything was technically present in the plan; the brief still failed to
instruct correctly, because instructions are read in order and these contradicted
each other hundreds of lines apart.

**A test that stubs the hard path cannot see bugs on it.** Eight cases stubbing
`punctuate` to `null` hid a defect that deletes user speech, through three fix
rounds and two reviews. The stub was the obvious way to make the tests
deterministic, and it removed the only path where the arithmetic could be wrong.

---

## Final review outcome

**Ready to integrate** — no Critical, no Important, three Minors.

The review's central question was one no per-task gate could ask: Tasks 2 and 3
implemented the same five rules **independently**, in clients with different
queue mechanics. It compared seven surfaces function by function and found
**five divergences, every one deliberate**.

`feedStream` and the `onPending` cursor recompute are identical character for
character. `isTruncationOfSameUtterance` is identical in implementation, its doc
comments citing different sources because the same asymmetry arises for different
reasons on each side. `ensureStream` differs only by Local Inference's `astMode`
guard. The seal handler differs because Local Native must capture
`pendingAsrTiming` synchronously before chaining — the divergence most likely to
have been a bug, confirmed correct. The final handler differs in where each emits
`asr.end` and whether its legacy path carries timing, each preserving **its own**
pre-slice behaviour.

The cursor arithmetic was verified on every constructible path: the rule path,
the model path with `dropped > 0`, several seals inside one `update()`, and an
async model result landing after a later `update()`. It cannot go negative or
exceed the passed length.

**Two Minors are hardening against currently unreachable states** — the mid-word
slice described under "Carried forward" above, and `ensureStream` reusing a
stream before re-checking `enabled`
(latent only because the settings toggle carries `disabled={isSessionActive}`;
its comment argued the opposite of the truth and has been corrected in both
clients). **The third was this note itself**, which had gone stale on the case
counts before it was ever committed.

Final numbers: **4,486 passed / 3 failed / 2 skipped**; `tsc` **319 errors across
80 files**, identical to baseline, with every error in a touched file sitting in
code this slice did not author. 85 tests across the three touched files.
