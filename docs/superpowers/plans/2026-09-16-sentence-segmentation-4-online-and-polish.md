# Sentence Segmentation — Slice 4: Online Providers, Notice, Diagnostics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the feature: display segmentation for the timer/regex online providers, punctuation fill-in for the server-definite ones, the one-time download notice, diagnostics, analytics, and the real-environment validation that decides whether the thresholds hold.

**Architecture:** For timer/regex providers the stage only changes *display*: two streams per client (source and translation), a seal closes the current conversation item at the cut and opens the next. Every existing cut rule stays; the only change to them is that a hard span cap now prefers a confirmed boundary. Server-definite providers get no stream at all — when a segment becomes definite and is long and unpunctuated, one `punctuate` call replaces its text and the boundary is untouched.

**Tech Stack:** TypeScript, React, PostHog, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-sentence-segmentation-design.md`, sections "Timer/regex online providers", "Server-definite providers", "Settings UI" (notice), "Diagnostics and analytics", "Testing".

**Depends on:** slices 1–3.

**Typecheck:** `npx tsc --noEmit`. Tests: `npm run test -- <path>`.

---

## Global Constraints

- **English only** in code, comments and commits; real translations in all 30 locale catalogs.
- **Clients never call `report.ts` and never `console.*`.** No new `CLIENT_DIAGNOSTICS` codes: a runtime that cannot help returns `null` and the client proceeds as today.
- **No transcript text** in any diagnostic or analytics payload. The new per-leg counters carry counts only.
- **Boundaries of server-definite providers never change**, and their segments are never split — the spec's D6.
- **Every existing cut rule stays.** GPT-Live's pause rule, soft caps, silence timers and `turnComplete` are additive-only.
- **Audio delivery and the timeline handoff are unchanged.**

---

## File Structure

| Path | Change |
|---|---|
| `src/services/clients/OpenAILiveClient.ts` | modify — two streams; hard caps prefer a confirmed boundary |
| `src/services/clients/OpenAILiveClient.test.ts` | modify — new cases; the 26 existing ones stay green |
| `src/services/clients/OpenAITranslateGAClient.ts` | modify — two streams |
| `src/services/clients/OpenAITranslateWebRTCClient.ts` | modify — two streams |
| `src/services/clients/GeminiClient.ts` | modify — two streams |
| `src/services/clients/punctuateDefinite.ts` | **new** — the shared fill-in helper |
| `src/services/clients/punctuateDefinite.test.ts` | **new** |
| `src/services/clients/SonioxClient.ts`, `VolcengineAST2Client.ts`, `VolcengineSTClient.ts`, `PalabraAIClient.ts`, `OpenAIGAClient.ts`, `OpenAIClient.ts`, `ZoomAIClient.ts` | modify — one call each |
| `src/components/SegmentationNotice/SegmentationNotice.tsx` | **new** |
| `src/components/MainPanel/MainPanel.tsx` | modify — render the notice; two analytics edits |
| `src/components/MainPanel/segmentationTelemetry.ts` | **new** — pure, because MainPanel has no harness |
| `src/lib/analytics.ts` | modify — two events, four properties |
| `docs/ANALYTICS_EVENTS.md` | modify |
| `src/locales/*/translation.json` | modify — notice strings, 30 catalogs |

---

## Task 1: GPT-Live — the reference timer/regex integration

`OpenAILiveClient` is the one that already splits inside a delta, so it is where the pattern is established; the other three copy it.

**Files:**
- Modify: `src/services/clients/OpenAILiveClient.ts`
- Modify: `src/services/clients/OpenAILiveClient.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// New describe in OpenAILiveClient.test.ts. The existing 26 tests in
// describe('OpenAILiveClient source segmentation') (line 501) and
// describe('OpenAILiveClient sentence segmentation') (line 602) must all
// still pass untouched — they run with no runtime injected.
//
// describe('OpenAILiveClient with the segmentation stage')
//  1. 'an unpunctuated source item seals every N sentences mid-delta' — feed
//     input_transcript deltas with no marks; a fake runtime returns a
//     punctuated result; assert the item closes at the seal and the
//     remainder opens the next item.
//  2. 'the sealed item shows the inserted punctuation, the pending one does
//     not'.
//  3. 'the hard span cap cuts at a confirmed boundary when one precedes it' —
//     drive span past USER_SPAN_CAP_MS with a confirmed boundary earlier in
//     the text; assert the cut lands on the boundary, not at the delta end.
//  4. 'with no boundary the hard cap behaves exactly as today'.
//  5. 'the translation side seals independently of the source side'.
//  6. 'a silence timer closing an item calls end() on that item's stream'.
//  7. 'turn/pause rules still close items when the stage is disabled'.
//  8. 'audio hand-off is unchanged by a seal' — the pendingAudioItems
//     ordering assertions from line 707 still hold.
```

- [ ] **Step 2: Run to verify the new ones fail and the old ones pass**

Run: `npm run test -- src/services/clients/OpenAILiveClient.test.ts`

- [ ] **Step 3: Hold two streams**

Fields next to the segmentation state at lines 216–227:

```typescript
  private segmentation: SegmentationRuntime | null = null;
  private sentencesPerChunk = 3;
  /** One stream per side. The source stream counts the speaker's transcript,
   *  the translation stream counts the model's output; they seal independently
   *  because the two sides have their own items and their own caps. */
  private userStream: SentenceStream | null = null;
  private assistantStream: SentenceStream | null = null;
```

- [ ] **Step 4: Feed the source side**

In `case 'session.input_transcript.delta'` (775–813), after the existing `appendUserText` calls have updated the item, hand the item's whole accumulated transcript to the stream:

```typescript
        if (this.userStream) this.userStream.update(this.userTranscript());
```

and on a seal, close the item at the cut and open the next with the remainder — the same two operations `split > 0` already performs at lines 800–804, so route the seal through one helper both paths call.

- [ ] **Step 5: Make the hard caps prefer a confirmed boundary**

Today, line 807:

```typescript
            if (span !== null && span >= USER_SPAN_CAP_MS) this.completeUserItem();
```

This is the line that cut `…往往只能稍微延缓恶化很` | `难真正救回…` mid-word. Change it to ask for a confirmed boundary first, and only cut blind when there is none:

```typescript
            if (span !== null && span >= USER_SPAN_CAP_MS) {
              // The cap still fires at the same moment; it just lands better.
              // A confirmed boundary earlier in the item beats the arbitrary
              // point the cap would otherwise choose, which is what put a cut
              // inside a word in the PR #552 recording.
              const at = this.userStream?.confirmedBoundary() ?? -1;
              if (at > 0) this.splitUserItemAt(at);
              else this.completeUserItem();
            }
```

`confirmedBoundary()` is a new `SentenceStream` method returning the latest counted sentence end, or −1. Add it in this step, with its own test in `SentenceStream.test.ts`, and keep it side-effect free.

- [ ] **Step 6: Mirror on the translation side**

The assistant branch (815–840) is structurally identical: `ASSISTANT_SOFT_CAP_MS` → `lastClauseEnd`, `ASSISTANT_SPAN_CAP_MS` → `closeAssistantText`. Apply the same two changes, feeding `this.assistantTranscript()` to `assistantStream`.

- [ ] **Step 7: Call `end()` wherever an item closes**

Every existing rule that closes an item must end that item's stream, or the next utterance inherits a stale tail: `completeUserItem` (1083), `closeAssistantText` (1104), the silence timers (967, and the assistant twin), `pauseEndsUserItem`'s caller (790), `handleUnexpectedEnd` (677–678) and teardown (1244–1245). Put the `end()` call inside `completeUserItem` and `closeAssistantText` so every caller is covered by construction.

- [ ] **Step 8: Run the tests and the typecheck, then commit**

Run: `npm run test -- src/services/clients/OpenAILiveClient.test.ts && npx tsc --noEmit`

```bash
git add src/services/clients/OpenAILiveClient.ts src/services/clients/OpenAILiveClient.test.ts
git commit -m "feat(segmentation): segment GPT-Live display and land hard caps on boundaries"
```

---

## Task 2: The other three timer/regex providers

**Files:** `OpenAITranslateGAClient.ts`, `OpenAITranslateWebRTCClient.ts`, `GeminiClient.ts` and their tests.

These three have silence timers but **no sentence/clause helpers of their own** — `OpenAITranslateGAClient` has dual timers at `SILENCE_TIMEOUT_MS = 1000`, `OpenAITranslateWebRTCClient` a single 1.5 s timer, `GeminiClient` finalizes on `turnComplete` (and its header comment at lines 71–80 records that Live Translate sessions never send one, which is exactly the gap the stage closes for it).

- [ ] **Step 1: For each client, write the failing tests**

Four cases each: an unpunctuated long item seals every N; the sealed item carries punctuation; the existing timer/turn rule still closes items; with no runtime every existing test passes unchanged.

- [ ] **Step 2: Implement**

Copy Task 1's shape: two streams, `update` on each accumulated item text, `end()` from wherever an item closes today. None of the three has a span cap, so there is no boundary-preference change to make.

- [ ] **Step 3: Run each suite and the typecheck, then commit**

```bash
git add src/services/clients/OpenAITranslateGAClient.ts src/services/clients/OpenAITranslateWebRTCClient.ts src/services/clients/GeminiClient.ts src/services/clients/*.test.ts
git commit -m "feat(segmentation): segment display for the remaining timer-driven providers"
```

---

## Task 3: Server-definite providers — punctuation only

No stream, no split. Seven clients, one call each.

**Files:**
- Create: `src/services/clients/punctuateDefinite.ts`, `punctuateDefinite.test.ts`
- Modify: `SonioxClient.ts`, `VolcengineAST2Client.ts`, `VolcengineSTClient.ts`, `PalabraAIClient.ts`, `OpenAIGAClient.ts`, `OpenAIClient.ts`, `ZoomAIClient.ts`

- [ ] **Step 1: Write the failing test for the helper**

```typescript
import { describe, it, expect } from 'vitest';
import { punctuateDefinite } from './punctuateDefinite';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';

const never: SegmentationRuntime = { enabled: true, async punctuate() { return null; } };

describe('punctuateDefinite', () => {
  it('returns the text unchanged when there is no runtime', async () => {
    expect(await punctuateDefinite(null, 'zh', 'a'.repeat(200))).toBe('a'.repeat(200));
  });
  it('returns it unchanged when the segment already has a terminal', async () => {
    const text = '这是一段很长很长的中文'.repeat(10) + '。';
    let called = false;
    const rt: SegmentationRuntime = { enabled: true, async punctuate() { called = true; return null; } };
    expect(await punctuateDefinite(rt, 'zh', text)).toBe(text);
    expect(called).toBe(false);
  });
  it('returns it unchanged when it is too short to hold a sentence', async () => {
    let called = false;
    const rt: SegmentationRuntime = { enabled: true, async punctuate() { called = true; return null; } };
    expect(await punctuateDefinite(rt, 'zh', '太短')).toBe('太短');
    expect(called).toBe(false);
  });
  it('returns it unchanged when the model declines', async () => {
    const text = 'a'.repeat(200);
    expect(await punctuateDefinite(never, 'en', text)).toBe(text);
  });
  it('replaces the text when the model answers', async () => {
    const raw = 'hello there how are you today i am fine thank you very much indeed my friend';
    const rt: SegmentationRuntime = {
      enabled: true,
      async punctuate() {
        return { text: 'Hello there. How are you today? I am fine, thank you very much indeed my friend.', sentenceEnds: [], breakpoints: [], model: 'edge-punct-en' };
      },
    };
    expect(await punctuateDefinite(rt, 'en', raw)).toContain('Hello there.');
  });
  it('rejects an answer whose skeleton differs', async () => {
    const raw = 'a'.repeat(200);
    const rt: SegmentationRuntime = {
      enabled: true,
      async punctuate() { return { text: 'something else entirely.', sentenceEnds: [], breakpoints: [], model: 'edge-punct-en' }; },
    };
    expect(await punctuateDefinite(rt, 'en', raw)).toBe(raw);
  });
});
```

- [ ] **Step 2: Implement the helper**

```typescript
import { sentenceEnds, skeleton } from '../../lib/segmentation/sentenceEnd';
import { gateChars } from '../../lib/segmentation/SentenceStream';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';

/**
 * Fill in missing punctuation on a segment the server already decided.
 *
 * Boundaries are the server's and are never touched: these providers split on
 * their own signal (Soniox's <end>, Volcengine's Definite, Palabra's
 * validated_transcription, a server turn, one Zoom REST utterance), and a
 * client-side split would fight it. The only change is the text.
 *
 * Returns the input unchanged on every failure path, so a caller can assign
 * the result unconditionally.
 */
export async function punctuateDefinite(
  runtime: SegmentationRuntime | null,
  lang: string,
  text: string,
  sentencesPerChunk = 3,
): Promise<string> {
  if (!runtime || !runtime.enabled) return text;
  if (text.length < gateChars(lang, sentencesPerChunk)) return text;
  if (sentenceEnds(text).length > 0) return text;
  const result = await runtime.punctuate(lang, text);
  if (!result) return text;
  if (skeleton(result.text) !== skeleton(text)) return text;
  return result.text;
}
```

- [ ] **Step 3: Call it from each of the seven clients**

One call each, at the point the segment becomes definite:
- `SonioxClient.ts` — `finishUtterance`, after `<end>`;
- `VolcengineAST2Client.ts:717,763` and `VolcengineSTClient.ts:754` — where `definite` is true;
- `PalabraAIClient.ts:593-596` — `validated_transcription` and the translated twin;
- `OpenAIGAClient.ts:215,286` and `OpenAIClient.ts:299,381` — the completed-transcription and `response.done` paths;
- `ZoomAIClient.ts:54` — each `'utterance'` message.

Non-final tokens are shown as they are, so only the final assignment changes.

- [ ] **Step 4: Let a detected language override the configured one**

`ConversationItem.detectedLanguage` exists because some providers report the language per item — Soniox gives a `language` per token — and the badge already prefers it over the configured pair, which is what makes two-way translation and auto-detect read correctly. Routing must follow the same rule, or a Japanese sentence in an `auto` session goes to the Chinese model.

Two places:
- `punctuateDefinite` takes the item's `detectedLanguage` when the client has one, falling back to the configured language. Add a test case for it.
- For the streaming clients of Tasks 1 and 2, call `stream.setLanguage(detected)` when an item reports one. `SentenceStream.setLanguage` already exists for exactly this.

A stream's language may therefore change mid-utterance; that is fine, because the language is read per evaluation and not frozen like N.

- [ ] **Step 5: Test one client end to end**

Add to `SonioxClient.test.ts`: a long unpunctuated definite segment gets punctuation, and the item boundary is identical with and without the runtime.

- [ ] **Step 6: Run the suites and the typecheck, then commit**

```bash
git add src/services/clients/punctuateDefinite.ts src/services/clients/punctuateDefinite.test.ts src/services/clients/*.ts src/services/clients/*.test.ts
git commit -m "feat(segmentation): fill in punctuation on server-definite segments"
```

---

## Task 4: The one-time download notice

**Files:**
- Create: `src/components/SegmentationNotice/SegmentationNotice.tsx` (+ `.scss`, `.test.tsx`)
- Modify: `src/components/MainPanel/MainPanel.tsx`
- Modify: `src/locales/*/translation.json`

- [ ] **Step 1: Write the failing test**

Cases: renders nothing when `sentenceSegmentationNoticeShown` is true; renders on the first `downloading` status; names the model and its size; dismiss calls `markSentenceSegmentationNoticeShown`; the link navigates to `sentence-segmentation`; it never appears twice in one session.

- [ ] **Step 2: Implement**

Copy `EchoNotice`'s shape (`src/components/EchoNotice/EchoNotice.tsx`): a props-driven component (`{ state, onDismiss }`), `role="alert"`, an icon, two lines of text and an `X` dismiss button. Render it in MainPanel as the last child inside `<div className="main-panel">`, next to `<EchoNotice …>` at line 4707 — not at the top level with `AudioSystemBanner`, which is for app-wide states.

The "show once ever" flag is the settings field from slice 2, written through `markSentenceSegmentationNoticeShown` — a fire-and-forget marker with no rollback, the same shape as `audioStore`'s `markParticipantTapAudioSeen`.

- [ ] **Step 3: Add the locale keys to all 30 catalogs**

```json
"segmentationNoticeTitle": "Downloading a segmentation model",
"segmentationNoticeBody": "Sokuji is fetching {{model}} ({{size}} MB) so it can punctuate transcripts that arrive without it. This happens once.",
"segmentationNoticeLink": "Manage in settings",
"segmentationNoticeDismiss": "Dismiss"
```

Both `{{model}}` and `{{size}}` must appear verbatim in every translation.

- [ ] **Step 4: Settle the visuals by rendering**, then run the tests and commit

```bash
git add src/components/SegmentationNotice src/components/MainPanel/MainPanel.tsx src/locales
git commit -m "feat(segmentation): announce the first background model download once"
```

---

## Task 5: Diagnostics and analytics

**Files:**
- Create: `src/components/MainPanel/segmentationTelemetry.ts` (+ test)
- Modify: `src/lib/analytics.ts`, `src/components/MainPanel/MainPanel.tsx`, `docs/ANALYTICS_EVENTS.md`

- [ ] **Step 1: Write the failing test for the pure telemetry function**

MainPanel has no React harness — the same constraint that produced `sessionModelTelemetry.ts` — so the per-leg counters are computed by a pure function and tested there.

```typescript
// segmentationTelemetry.test.ts
//  - counts seals by reason per leg;
//  - counts model calls per leg;
//  - computes sentence terminals per 100 characters per leg, ASR model and
//    language;
//  - carries no text: assert every value is a number or a short enum string,
//    and that no property value contains a space (a crude but effective
//    guard against a transcript leaking in).
```

- [ ] **Step 2: Extend the event types**

`src/lib/analytics.ts`, in `'translation_session_start'` (line 27):

```typescript
    sentence_segmentation_enabled?: boolean;
    sentence_segmentation_chunk_sentences?: number;
```

in `'translation_session_end'` (line 53):

```typescript
    /** Seals by reason, per leg, e.g. { speaker_sentences: 12, speaker_length: 3 }. */
    segmentation_seals?: Record<string, number>;
    segmentation_model_calls?: Record<string, number>;
    /** Sentence terminals per 100 characters, per leg / ASR model / language.
     *  The measure of where punctuation is actually absent. Counts only. */
    segmentation_terminals_per_100?: Record<string, number>;
```

and two new events:

```typescript
  'segmentation_model_download': { model: string; size_mb: number; result: 'ok' | 'error'; duration_ms: number };
  'segmentation_model_load': { model: string; backend: 'webgpu' | 'wasm'; load_ms: number; result: 'ok' | 'error' };
```

- [ ] **Step 3: Emit them**

At `MainPanel.tsx:4003`, add the two start properties. At `:4024`, spread `segmentationTelemetry(...)` into the end event. The two model events fire from `useSegmentationRuntime`'s `onStatus` / `onLoaded` callbacks (slice 2), which is already the place that knows about downloads and loads.

- [ ] **Step 4: LogsPanel lines**

With diagnostic logs on only: download and load durations, and one line per seal with its reason. No transcript text.

- [ ] **Step 5: Update the documentation**

`docs/ANALYTICS_EVENTS.md`: extend the two entries under "Translation Session Events" (lines 55 and 65) and add the two new events under "Feature Adoption Events" (line 293), matching the file's `**Description**` / `**Properties**` bullet style.

- [ ] **Step 6: Run the tests and the typecheck, then commit**

```bash
git add src/lib/analytics.ts src/components/MainPanel docs/ANALYTICS_EVENTS.md
git commit -m "feat(segmentation): report segmentation health and where punctuation is missing"
```

---

## Task 6: Tune the thresholds on recorded deltas, before release

The corpus already holds what is needed: `benchmark/punctuation-restoration/corpus/gpt-live-log-extract.json` has **140 items with real `deltas`, `delta_timeline_ms` and `delta_arrival_ms`** (zh 57, en 57, ja 26). Replaying those through `SentenceStream` measures seal counts, commit lag and false cuts without waiting for production data.

- [ ] **Step 1: Build the replay**

A script under `benchmark/punctuation-restoration/tools/` that drives `SentenceStream` with the recorded delta sequence and timings, for a grid of threshold sets.

- [ ] **Step 2: Sweep the thresholds the spec flags as underived**

Right context R ∈ {4, 8, 16}; the gate's per-sentence constants ∈ {15, 20, 25} CJK and {40, 50, 60} other; the Chinese fallback ∈ {28, 33, 40}. Report, per set: seals per minute, mean commit lag, and cuts landing mid-word.

- [ ] **Step 3: Answer the Korean question**

Korean averages 16 characters per sentence, so N = 3 is ~48 — below the 60-character gate, and Korean therefore seals later than every other language. The corpus has 20 Korean passages. Measure whether 50 per sentence fits better, and either change the constant with the measurement behind it or record why it stays at 20.

- [ ] **Step 4: Record and apply**

Write the table into `docs/superpowers/notes/2026-09-14-asr-punctuation-benchmark.md` and change only the constants the measurement actually moves.

---

## Task 7: Real-environment validation

- [ ] **Step 1: Platforms**

Packaged Electron on both backends — and settle the open question of whether multi-threaded WASM works under `file://`. The extension side panel: whether WebGPU is available there at all, and what single-threaded latency is.

- [ ] **Step 2: The recording that motivated the feature**

Run GPT-Live against the L3383 video at the default N = 3 and confirm the 60-second bubble is now three-sentence bubbles with no mid-word cut.

- [ ] **Step 3: Sessions**

Soniox (definite fill-in), a long monologue (translation appears earlier), and one session per provider family to confirm nothing regressed.

- [ ] **Step 4: Resources**

`app.getAppMetrics()` for renderer and GPU-process memory, including the WebGPU question slice 1 measured. GPU contention with local WebGPU ASR and translation running at the same time — Voxtral, Qwen3-ASR and Qwen translation share the one GPU and this is unmeasured.

- [ ] **Step 5: Fleet**

WebGPU on GB10 (linux-arm64), the Windows RTX box and the Mac M4, per the test-fleet map.

- [ ] **Step 6: UI**

Every locale checked for width on the section and the notice.

- [ ] **Step 7: Record the results** in the notes file and commit.

---

## Done when

- Every provider family shows segmented bubbles, and the server-definite ones show punctuated text on unchanged boundaries.
- GPT-Live's hard cap no longer cuts inside a word when a boundary is available.
- The notice appears exactly once, ever.
- The analytics answer "where is punctuation actually missing" without carrying any text.
- Thresholds are either measured or explicitly recorded as unmeasured defaults.
- `npm run test` is green, `npx tsc --noEmit` is clean, and the fleet runs are recorded.
