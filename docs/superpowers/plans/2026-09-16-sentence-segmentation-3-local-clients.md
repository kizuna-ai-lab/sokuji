# Sentence Segmentation — Slice 3: Local Inference and Local Native — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the stage into the two local clients, which carry ~70% of production minutes. A long utterance seals every N sentences, each sealed chunk becomes its own bubble **and** its own translation job, so the translation starts appearing long before the VAD ends the utterance.

**Architecture:** One `SentenceStream` per utterance, source side only. Its `onPending` drives the in-progress bubble; its `onSeal` completes a bubble and enqueues a job on the queue each client already has — `ttsQueue` → `processQueue` → `processPipelineJob` in Local Inference, the `this.queue` promise chain in Local Native. Neither client constructs a runtime: it arrives through `ClientOptions`, and a client that gets none behaves exactly as it does today.

**Tech Stack:** TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-sentence-segmentation-design.md`, sections "Local Inference", "Local Native", "Injection".

**Depends on:** slices 1 and 2.

**Typecheck:** the repo's baseline is **not clean** — `npx tsc --noEmit` reports **319 errors across 80 files** (measured at `7112796a`; `grep -c "error TS"` → 319, and the same lines through `cut -d'(' -f1 | sort -u | wc -l` → 80). All pre-existing. Never ask anyone to "confirm tsc is clean"; the bar is **zero contribution**: run it and confirm its output names none of the files your task created or modified.

**Run `tsc` on its own, never chained after the tests with `&&`.** It exits non-zero at the baseline, so a chained command reports failure regardless of the test result. Tests: `npm run test -- <path>`.

*(An earlier draft of this plan said "154 files". The error count was right; the file count was not, and it had been copied forward unchecked since slice 1.)*

---

## Global Constraints

- **English only** in code, comments and commits.
- **Clients never call `report.ts` and never `console.*`.** A failure that leaves the session running goes to `handlers.onDiagnostic` with a code from `CLIENT_DIAGNOSTICS`; one that breaks the session goes to `handlers.onError`. **This slice adds neither** — a runtime that cannot help returns `null` and the client proceeds exactly as today, which is the spec's "No new `CLIENT_DIAGNOSTICS` codes".
- **Nothing gets worse.** With no runtime, a disabled runtime, or N = 5 on a short utterance, every existing test must pass unchanged.
- **Unchanged by this slice:** AST mode (`translationModelId === asrModelId`), the Voxtral worker's own punctuation endpoint, the VAD 20 s cap, TTS chunking via `splitSentences`, and the VAD marks Local Native sends the sidecar.
- **N is read once per stream**, at construction, so changing the setting never cuts an open bubble.

---

## File Structure

| Path | Change |
|---|---|
| `src/services/providers/ProviderDescriptor.ts` | modify — `ClientOptions` gains `segmentation?: SegmentationRuntime` |
| `src/components/MainPanel/clientOptions.ts` | **new** — pure builder, because MainPanel has no React harness |
| `src/components/MainPanel/clientOptions.test.ts` | **new** |
| `src/components/MainPanel/MainPanel.tsx:893` | modify — build options through the helper |
| `src/services/clients/LocalInferenceClient.ts` | modify — one stream per utterance |
| `src/services/clients/LocalInferenceClient.test.ts` | modify — seal-to-job cases |
| `src/services/clients/LocalNativeClient.ts` | modify — same shape |
| `src/services/clients/LocalNativeClient.test.ts` | modify — seal-to-job cases |

---

## Task 1: Inject the runtime through `ClientOptions`

The injection point is a single object literal at `MainPanel.tsx:893`. Putting `segmentation` **inside** `createAIClient` rather than passing it per leg matters: the WebRTC→WebSocket fallback at `MainPanel.tsx:2323` calls `createAIClient(false)` with no `legOptions` at all, and a field added at the leg call sites would silently vanish on that path.

**Files:**
- Modify: `src/services/providers/ProviderDescriptor.ts`
- Create: `src/components/MainPanel/clientOptions.ts`, `src/components/MainPanel/clientOptions.test.ts`
- Modify: `src/components/MainPanel/MainPanel.tsx`

**Interfaces:**
- Consumes: `SegmentationRuntime`.
- Produces: `ClientOptions.segmentation`, `ClientOptions.sentencesPerChunk`, and `buildClientOptions(input): ClientOptions`.

- [ ] **Step 1: Write the failing test** at `src/components/MainPanel/clientOptions.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { buildClientOptions } from './clientOptions';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';

const runtime: SegmentationRuntime = { enabled: true, async punctuate() { return null; } };

describe('buildClientOptions', () => {
  it('carries the segmentation runtime on every path', () => {
    expect(buildClientOptions({ transport: 'websocket', segmentation: runtime }).segmentation).toBe(runtime);
  });

  it('carries it even when there are no leg options — the WebRTC fallback path', () => {
    const opts = buildClientOptions({ transport: 'websocket', segmentation: runtime, legOptions: undefined });
    expect(opts.segmentation).toBe(runtime);
    expect(opts.transport).toBe('websocket');
  });

  it('keeps the managed Soniox bundle that leg options carry', () => {
    const sonioxManaged = { role: 'spk_stt' } as never;
    const opts = buildClientOptions({ transport: 'websocket', segmentation: runtime, legOptions: { sonioxManaged } });
    expect(opts.sonioxManaged).toBe(sonioxManaged);
    expect(opts.segmentation).toBe(runtime);
  });

  it('lets leg options override nothing they do not set', () => {
    const webrtcOptions = { inputDeviceId: 'mic-1' };
    const opts = buildClientOptions({ transport: 'webrtc', webrtcOptions, segmentation: runtime, legOptions: {} });
    expect(opts.webrtcOptions).toBe(webrtcOptions);
    expect(opts.segmentation).toBe(runtime);
  });

  it('carries the sentences-per-bubble setting, including on the fallback path', () => {
    expect(buildClientOptions({ transport: 'websocket', segmentation: runtime, sentencesPerChunk: 5 }).sentencesPerChunk).toBe(5);
    expect(buildClientOptions({ transport: 'websocket', segmentation: runtime, sentencesPerChunk: 1, legOptions: undefined }).sentencesPerChunk).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- src/components/MainPanel/clientOptions.test.ts` → FAIL (module not found).

- [ ] **Step 3: Widen `ClientOptions`**

In `src/services/providers/ProviderDescriptor.ts`, add to the `ClientOptions` type (after `sonioxManaged`, before the closing brace at line 72):

```typescript
  /**
   * The sentence segmentation stage, shared by both legs and every provider.
   *
   * Absent or disabled means today's behaviour exactly: a client that receives
   * no runtime never seals and never calls a model. Clients never construct
   * one — MainPanel owns the single instance (useSegmentationRuntime) so no
   * client has to import a store.
   */
  segmentation?: SegmentationRuntime | null;
  /**
   * How many sentences fill one bubble (1-5, already clamped by the store).
   *
   * It rides here rather than being read from the store by each client for
   * the same reason `segmentation` does: a client that imports a store cannot
   * be unit-tested with a fake, and would also start re-rendering on a
   * setting the running session must not react to.
   */
  sentencesPerChunk?: number;
```

and the type import at the top of the file:

```typescript
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';
```

- [ ] **Step 4: Extract the builder**

Create `src/components/MainPanel/clientOptions.ts`:

```typescript
import type { ClientOptions } from '../../services/providers/ProviderDescriptor';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';

/**
 * Build the options one client is created with.
 *
 * Extracted as a pure function because this repo has no React rendering
 * harness for MainPanel — the same constraint that produced
 * sessionModelTelemetry.ts — so this is the only way the shipped decision is
 * the tested one.
 *
 * `segmentation` is set here rather than by the callers that pass legOptions,
 * because two paths bypass those callers: the WebRTC-to-WebSocket fallback
 * calls createAIClient(false) with nothing, and a participant on a secondary
 * port never reaches createAIClient at all.
 */
export function buildClientOptions(input: {
  transport: ClientOptions['transport'];
  webrtcOptions?: ClientOptions['webrtcOptions'];
  segmentation?: SegmentationRuntime | null;
  sentencesPerChunk?: number;
  legOptions?: Partial<ClientOptions>;
}): ClientOptions {
  return {
    transport: input.transport,
    webrtcOptions: input.webrtcOptions,
    segmentation: input.segmentation,
    sentencesPerChunk: input.sentencesPerChunk,
    ...input.legOptions,
  };
}
```

- [ ] **Step 5: Use it in MainPanel**

At the top of the component, next to the other hooks:

```tsx
  const segmentationRuntime = useSegmentationRuntime();
  const sentencesPerChunk = useSentenceSegmentationChunkSentences();
```

Replace `MainPanel.tsx:893`:

```tsx
    return descriptor.createClient(creds, { transport: effectiveTransportType, webrtcOptions, ...legOptions });
```

with:

```tsx
    return descriptor.createClient(creds, buildClientOptions({
      transport: effectiveTransportType,
      webrtcOptions,
      segmentation: segmentationRuntime,
      sentencesPerChunk,
      legOptions,
    }));
```

and add `segmentationRuntime` and `sentencesPerChunk` to the `useCallback` dependency array at line 894. A client is built once per session, so a mid-session change to the setting reaches only the next session — which is the same guarantee `SentenceStream` gives per stream.

- [ ] **Step 6: Record the one path this does not reach**

Add a comment at the `'secondary-port'` branch (`MainPanel.tsx:2547`), because a reader will otherwise assume every client has a runtime:

```tsx
              // No segmentation runtime here: this participant shares the
              // speaker's transport and never goes through createAIClient.
              // Its bubbles keep today's boundaries, which is the same
              // fallback every provider gets when the stage is unavailable.
              participantClientRef.current = speakerCore!.createSecondaryPort!();
```

- [ ] **Step 7: Run the tests and the typecheck, then commit**

Run: `npm run test -- src/components/MainPanel`, then `npx tsc --noEmit` **on its own** — chaining with `&&` reports failure regardless of the tests, because `tsc` exits non-zero at the 319-error baseline.

```bash
git add src/services/providers/ProviderDescriptor.ts src/components/MainPanel/clientOptions.ts src/components/MainPanel/clientOptions.test.ts src/components/MainPanel/MainPanel.tsx
git commit -m "feat(segmentation): inject the runtime into every client through ClientOptions"
```

---

## Task 2: Local Inference

**Files:**
- Modify: `src/services/clients/LocalInferenceClient.ts`
- Modify: `src/services/clients/LocalInferenceClient.test.ts`

**Interfaces:**
- Consumes: `SentenceStream`, `SegmentationRuntime`, `ClientOptions.segmentation`.
- Produces: no new exports; behaviour changes only.

- [ ] **Step 1: Write the failing tests**

```typescript
// In LocalInferenceClient.test.ts, a new describe:
//
// describe('LocalInferenceClient sentence segmentation')
//
//  1. 'a long streaming utterance seals every N sentences and enqueues jobs
//      in order' — feed partials that grow past three sentences, assert three
//      completed user items in order and three pipeline jobs with matching
//      text, and that job k starts before partial k+1 finishes.
//  2. 'an offline final of six sentences gives two items and two jobs at N=3'
//      — call handleAsrResult once with six sentences; assert 2 user items
//      and 2 jobs, the second carrying the remainder.
//  3. 'a short utterance still gives exactly one item and one job' — the
//      existing behaviour, asserted explicitly.
//  4. 'with no runtime the client behaves exactly as today' — construct with
//      options.segmentation undefined and assert the existing expectations.
//  5. 'with a disabled runtime the client behaves exactly as today'.
//  6. 'AST mode never creates a stream' — translationModelId === asrModelId;
//      assert the fake runtime's punctuate is never called and one item is
//      produced.
//  7. 'the ASR timing rides only the final job' — assert the first job has no
//      asrTiming and the last one does.
//  8. 'a seal completes the in-progress item rather than creating a second
//      in-progress one' — assert no two items are 'in_progress' at once.
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test -- src/services/clients/LocalInferenceClient.test.ts`
Expected: FAIL on the new cases, PASS on every existing one.

- [ ] **Step 3: Hold the runtime and the stream**

Add fields next to `partialUserItem` (line 90):

```typescript
  private segmentation: SegmentationRuntime | null = null;
  private sentencesPerChunk = 3;
  /** One stream per utterance, source side. Null between utterances. */
  private stream: SentenceStream | null = null;
  /** Set by handleAsrResult immediately before it runs the stream to
   *  completion, and read by sealUserChunk when it pushes the job — so the
   *  utterance's ASR timing rides the final chunk only. Undefined at every
   *  other moment, which is what makes the earlier chunks carry none. */
  private pendingAsrTiming: AsrTiming | undefined;
```

In the constructor, read both off the options the descriptor passed. **The client never touches a store** — N rides on `ClientOptions` precisely so it does not have to, and so a running session cannot react to the setting changing:

```typescript
    this.segmentation = options.segmentation ?? null;
    this.sentencesPerChunk = options.sentencesPerChunk ?? 3;
```

Both fields come from `ClientOptions`, which Task 1 already widened; the client reads them and never touches a store.

- [ ] **Step 4: Create and drive the stream**

A small private helper, because three call sites need it:

```typescript
  /** The stream for the utterance in progress, created on first text.
   *  Null in AST mode: there the ASR output is already the translation, and
   *  the user bubble only ever shows a placeholder. */
  private ensureStream(): SentenceStream | null {
    if (this.astMode || !this.segmentation) return null;
    if (this.stream) return this.stream;
    this.stream = new SentenceStream({
      // The leg's own config, not a reversal of the speaker's. The participant
      // direction already resolves target->source into its own
      // sourceLanguage (see localParticipantConfig.ts), so reading
      // config.sourceLanguage here is correct for both legs and there is
      // nothing to flip.
      lang: this.config?.sourceLanguage ?? 'auto',
      runtime: this.segmentation,
      sentencesPerChunk: this.sentencesPerChunk,
      onSeal: (chunk) => this.sealUserChunk(chunk.text),
      onPending: (text) => this.showPartialUserText(text),
    });
    return this.stream;
  }

  /** Finish the in-progress user bubble at the seal and queue its translation. */
  private sealUserChunk(text: string): void {
    if (this.partialUserItem) {
      this.partialUserItem.formatted!.transcript = text;
      this.partialUserItem.status = 'completed';
      this.handlers.onConversationUpdated?.({ item: this.partialUserItem });
      this.partialUserItem = null;
    } else {
      const item: ConversationItem = {
        id: `${this.instanceId}_user_${++this.itemCounter}`,
        role: 'user',
        type: 'message',
        status: 'completed',
        createdAt: Date.now(),
        formatted: { transcript: text },
      };
      this.conversationItems.push(item);
      this.handlers.onConversationUpdated?.({ item });
    }
    // The ASR timing describes the whole utterance, so it rides the final job
    // only — attaching it to each chunk would report one utterance N times.
    // `pendingAsrTiming` is set by handleAsrResult (Step 5) just before it runs
    // the stream to completion, so only the chunk emitted from end() sees it.
    this.ttsQueue.push({ text, ...(this.pendingAsrTiming && { asrTiming: this.pendingAsrTiming }) });
    this.processQueue();
  }
```

Rename the body of today's `handlePartialAsrResult` (469–491) to `showPartialUserText(text)` unchanged, and make `handlePartialAsrResult` route through the stream:

```typescript
  private handlePartialAsrResult(text: string): void {
    this.emitEvent('local.asr.partial', 'server', { text });
    const stream = this.ensureStream();
    if (stream) stream.update(text);
    else this.showPartialUserText(text);
  }
```

- [ ] **Step 5: Close the utterance**

In `handleAsrResult` (493–530), before the existing body, run the stream to completion. The stream's seals already produced the earlier items and jobs; what remains is the tail.

```typescript
  private handleAsrResult(text: string, timing?: AsrTiming): void {
    const stream = this.stream;
    if (stream) {
      // The final text replaces whatever the partials said, then end() emits
      // the remainder as the last chunk — which becomes the last item and the
      // last job, carrying the utterance's timing.
      this.pendingAsrTiming = timing;
      stream.update(text);
      stream.end();
      stream.dispose();
      this.stream = null;
      this.pendingAsrTiming = undefined;
      this.emitEvent('local.asr.end', 'server', {
        text,
        modelId: this.config?.asrModelId,
        ...(timing && { durationMs: timing.durationMs, recognitionTimeMs: timing.recognitionTimeMs }),
      });
      return;
    }
    /* ...today's body unchanged... */
  }
```

`pendingAsrTiming` is a new private field read by `sealUserChunk` when it pushes the job, so only the chunk emitted from `end()` carries it:

```typescript
    this.ttsQueue.push({ text, ...(this.pendingAsrTiming && { asrTiming: this.pendingAsrTiming }) });
```

- [ ] **Step 6: Clean up**

Where `ttsQueue` is cleared (line 365), also dispose the stream:

```typescript
    this.stream?.dispose();
    this.stream = null;
```

- [ ] **Step 7: Run the tests and the typecheck, then commit**

Run: `npm run test -- src/services/clients/LocalInferenceClient.test.ts`, then `npx tsc --noEmit` **on its own** — never chained with `&&`.

```bash
git add src/services/clients/LocalInferenceClient.ts src/services/clients/LocalInferenceClient.test.ts
git commit -m "feat(segmentation): seal and translate Local Inference utterances in chunks"
```

---

## Task 3: Local Native

Structurally identical, with two differences: jobs chain on a promise tail rather than an array queue, and the assistant bubble is created lazily by `onTranslatePartial`.

**Files:**
- Modify: `src/services/clients/LocalNativeClient.ts`
- Modify: `src/services/clients/LocalNativeClient.test.ts` — this file **does** exist (three commits of history, dozens of cases). Every one of them must still pass.
- Modify: `src/services/providers/LocalNativeProviderConfig.ts` — **not in the original file list; see below.**

### What "Mirror Task 2" means now, and where it must NOT be mirrored

Task 2 shipped materially different from this plan's literal code, because the plan's code was wrong in three ways. All three were confirmed against the source by review. **Mirror the shipped shape, not the snippets below.**

**Mirror these — the causes are identical here:**

1. **`ensureStream()` must test `runtime.enabled`, not merely that a runtime exists.** `active()` requires both (`SentenceStream.ts:135-137`), so a stream built on a disabled runtime shows partials but never seals — and because the new `onAsrResult` path returns early whenever a stream exists, the legacy body that completes the bubble never runs either. The literal snippet in Step 2 below produces **zero items and zero jobs for the whole utterance**.
2. **`onAsrResult` must call `ensureStream()`, not read the bare `this.stream` field.** Otherwise any final that arrives without preceding partials is never segmented.
3. **`update()` takes the text since the last seal, not the cumulative hypothesis** — and the same applies here: the sidecar sends cumulative partials (`asr_engine.py:454-455` appends to `_pending` and posts the whole buffer, resetting only at a cut, which is what becomes `onAsrResult`).
4. **Advance the cursor by RAW CONSUMED, never by the sealed text's length.** On the model path the sealed text carries inserted punctuation that the raw input did not, so `sealedChars += chunk.text.length` over-advances by one character per mark and silently deletes speech. Derive it inside `onPending`, which `seal()` always calls immediately after `onSeal` with the remainder: `sealedCharsBase + lastPassedToStream.length - remainder.length`. This is correct even when one `update()` seals several times, because `pending` is always a raw suffix of the string passed to that `update()`.
5. **Guard the short or rewritten final.** When the slice would be empty, a final that is a *truncation of the same utterance* must close the open bubble **without** a second job and leave the cursor alone; only genuine divergence resets and reseals. Compare **trimmed** forms — `previousRaw.trim().startsWith(text.trim())` — because the sidecar's `_result_event` applies `.strip()` (`asr_engine.py:419`) while partials are not stripped, so an untrimmed prefix test reads a truncation as divergence and produces a duplicate bubble and a duplicate spoken translation. Keep the normalisation inside the boolean; every offset stays on the untrimmed text.

6. **Add a `pendingAsrTiming` field — Step 1's case 7 is unsatisfiable without one.** That case requires the ASR timing to ride only the final job, and `sealUserChunk` has no access to the timing otherwise. Declare it alongside the other new fields, set it in `onAsrResult` **after** the stream has been fed and immediately before `stream.end()`, and clear it straight after. It must be `undefined` at every other moment — that, and not a conditional in `sealUserChunk`, is what keeps the timing off the mid-utterance chunks. Nothing async may run between setting it and `end()`; in Task 2 that held because `update()` and its synchronous seals complete before any promise continuation, and the equivalent must be checked here rather than assumed.

**Do NOT mirror this — it is where the two clients differ:**

- **Task 2 added a constructor. Do not add one here.** `LocalNativeClient` already has `constructor(deps: Deps = {})` (`:56`), where `Deps` (`:19`) is four optional fields — `asr`, `translate`, `tts`, `vadWorker` — each with a `??` default. **Extend that interface and that constructor**; do not replace `Deps`, which is the seam the existing tests use to inject fakes. Note `segmentation` and `sentencesPerChunk` are configuration rather than collaborators, so there is no sensible default: absent means absent, the same `?? null` shape Task 2 used.
- **The descriptor discards its options, exactly as Local Inference's did.** `LocalNativeProviderConfig.ts:147` is `createClient(_creds, _options)` returning `new LocalNativeClient()` with no arguments. Until it passes them through, everything else in this task compiles, tests green, and does nothing in production. Task 2's equivalent fix is the model:
  `return new LocalNativeClient({ segmentation: options.segmentation, sentencesPerChunk: options.sentencesPerChunk });`

- [ ] **Step 1: Write the failing tests**

All eight of Task 2's cases, adapted — write eight, not the five summarised below:

1. a long streaming utterance seals every N sentences and chains `runJob` on `this.queue` **in order**;
2. an offline final of six sentences at N = 3 gives two user items and two `runJob` calls, the second carrying the remainder;
3. a short utterance still gives exactly one item and one job;
4. with no runtime (`options.segmentation` undefined) the client behaves exactly as today;
5. with a disabled runtime the client behaves exactly as today;
6. AST mode never creates a stream — assert `punctuate` is never called;
7. the ASR timing rides only the final job;
8. a seal completes the in-progress item rather than creating a second in-progress one.

Plus one case Task 2 has no equivalent of, because Local Native chains on a promise tail rather than an array queue:

9. **`currentTranslateItem` never serves two jobs at once** — assert that the second job's partials never land in the first job's bubble. The field is justified in the source by "one in-flight translate per connection is the job queue's guarantee"; chunking multiplies the jobs but they still serialize through `this.queue`, so the invariant holds. Pin it.

- [ ] **Step 2: Implement**

Mirror Task 2 **as shipped** — see the five corrections above; the snippet in this step predates them and is not sufficient on its own. `onAsrPartial` (380–394) routes through the stream; the seal handler completes the user item and chains a job:

```typescript
  private sealUserChunk(text: string): void {
    let userItem = this.partialUserItem;
    if (userItem) {
      userItem.status = 'completed';
      userItem.formatted!.transcript = text;
      this.partialUserItem = null;
    } else {
      userItem = {
        id: this.nextId('user'), role: 'user', type: 'message', status: 'completed',
        createdAt: Date.now(), formatted: { transcript: text },
      };
      this.items.push(userItem);
    }
    this.emit(userItem);
    // Same chain as onAsrResult: serialized so text and audio stay ordered.
    this.queue = this.queue.then(() => this.runJob(text)).catch((e) => {
      this.emitEvent('local.native.error', 'client', { error: String(e) });
      this.handlers.onError?.(String(e));
    });
  }
```

`onAsrResult` (423–453) runs the stream to completion the same way Task 2's does, keeping its existing `rtf` telemetry and its `emitEvent('local.native.asr.end', …)` exactly as they are. `appendInputText` (line 603) re-enters `onAsrResult`, so it needs no separate *code* — but that re-entry now means **a long typed message is chunked into several bubbles and several jobs**, exactly as it is in Local Inference. Task 2 treated that as a deliberate outcome and recorded it in a comment rather than letting it be an accident. Do the same here: add the comment, or a case, so the behaviour is a choice someone made.

- [ ] **Step 3: Run the tests and the typecheck, then commit**

Run: `npm run test -- src/services/clients/LocalNativeClient.test.ts`, then `npx tsc --noEmit` **on its own** — never chained with `&&`.

```bash
git add src/services/clients/LocalNativeClient.ts src/services/clients/LocalNativeClient.test.ts src/services/providers/LocalNativeProviderConfig.ts
git commit -m "feat(segmentation): seal and translate Local Native utterances in chunks"
```

---

## Task 4: Live check on a real local session

Unit tests cannot show whether the translation actually arrives earlier, which is the point of the slice.

- [ ] **Step 1: Unpunctuated streaming ASR**

Run a Local Inference session with sherpa `stream-zh-2025` (which emits no punctuation) and a long Chinese monologue. Confirm: a new bubble roughly every three sentences, punctuation present in the sealed bubbles, the pending tail raw, and the first translation appearing well before the speaker stops.

- [ ] **Step 2: Already-punctuated ASR**

Repeat with cohere, which punctuates. Confirm the model is never called — watch the LogsPanel with diagnostic logs on — and that bubbles still seal every three sentences from the existing marks.

- [ ] **Step 3: The N extremes**

At N = 1 confirm sentence-by-sentence translation; at N = 5 confirm behaviour close to today's whole-utterance translation. Confirm that changing N mid-session only takes effect on the next utterance.

- [ ] **Step 4: Local Native**

Repeat step 1 against the sidecar and confirm the translation bubble streams per job, not per utterance.

- [ ] **Step 5: Record what you saw**

Append the observations to `docs/superpowers/notes/2026-09-14-asr-punctuation-benchmark.md`, including anything that argues for moving a threshold. Do not move one silently.

---

## Done when

- A long local utterance produces one bubble and one translation job per N sentences, in order.
- A short one produces exactly one of each, as today.
- With the switch off, or with no runtime, every pre-existing test and every observed behaviour is unchanged.
- `npm run test` passes apart from the three `hfRevision: 'TODO-COMMIT-SHA'` assertions in `modelManifest.punctuation.test.ts`, which fail **by design** until three Hugging Face repositories are published — an outward action needing jiangzhuo's explicit per-repository confirmation. Do not invent a SHA.
- `npx tsc --noEmit` adds nothing to the pre-existing baseline of 319 errors across 80 files. The bar is zero contribution, not a clean run.
- The live check above is recorded in the notes.
