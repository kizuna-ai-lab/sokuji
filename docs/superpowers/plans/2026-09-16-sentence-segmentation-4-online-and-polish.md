# Sentence Segmentation — Slice 4: Online Providers, Diagnostics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the feature: display segmentation for the timer/regex online providers, punctuation fill-in for the server-definite ones, diagnostics, analytics, and the real-environment validation that decides whether the thresholds hold.

**Architecture:** For timer/regex providers the stage only changes *display*: two streams per client (source and translation), a seal closes the current conversation item at the cut and opens the next. Server-definite providers get no stream at all — when a segment becomes definite and is long and unpunctuated, one `punctuate` call replaces its text and the boundary is untouched.

**Tech Stack:** TypeScript, React, PostHog, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-sentence-segmentation-design.md`, sections "Timer/regex online providers", "Server-definite providers", "Settings UI", "Diagnostics and analytics", "Testing", plus **Amendment A1**.

**Depends on:** slices 1, 2, 3 and 3b (all landed; branch `worktree-research-asr-punctuation`, PR #553).

**Revised 2026-09-20** after a drift audit against the current tree. Every line number below was re-checked then; `OpenAILiveClient.ts` is 1257 lines and `MainPanel.tsx` 4752.

---

## Global Constraints

- **English only** in code, comments and commits; real translations in all 30 locale catalogs.
- **Clients never call `report.ts` and never `console.*`.** No new `CLIENT_DIAGNOSTICS` codes: a runtime that cannot help returns `null` and the client proceeds as today.
- **No transcript text** in any diagnostic or analytics payload. The new per-leg counters carry counts only.
- **Boundaries of server-definite providers never change**, and their segments are never split — the spec's D6.
- **Audio delivery and the timeline handoff are unchanged.**
- **Typecheck baseline is 319 errors** (`npx tsc --noEmit`); the bar is zero new ones.
- **Run the suite as** `npx vitest run --exclude ".superpowers/**"`, or scoped to a path. An unfiltered run picks up reviewer scratch copies under `.superpowers/`. Four unhandled rejections in `settingsStore.nativeGate.test.ts` are pre-existing.
- **Never push, never open or edit a PR.** The controller commits per task.

## Two rulings this slice runs on

**R1 — with the stage active, the N-sentence seal replaces the per-sentence cut.** `OpenAILiveClient` already ends an item at *every* sentence end it sees (`lastSentenceEnd`, `:739`), which is N = 1 by another name; leaving that in place would make the setting inert for the one provider the feature was designed on. So, **for a session whose stage is active**: the stream's seal decides where an item ends, and the per-delta `lastSentenceEnd` split is skipped. Everything else stays exactly as it is — the pause rule, the soft cap's `lastClauseEnd`, the hard caps, the silence timers, `turnComplete`. With the stage off, not one line of today's behaviour changes. This resolves the spec's "every existing cut rule stays" (D5) against its own "it seals a bubble every N sentences" (Summary, D3); the Summary wins, because a setting that cannot change anything is not a setting.

**R2 — one frozen answer per session, as in slice 3b.** `runtime.enabled` is now "toggle on AND all three models on disk AND memory guard passes" and it flips **both ways** while a session is open. Slice 3b lost a whole session's transcripts to two reads taken at two moments. Every client this slice touches therefore builds ONE frozen view at connect and hands that to every stream:

```ts
const runtime = this.segmentation;
this.sessionSegmentation = runtime?.enabled === true
  ? { enabled: true, punctuate: (lang, text, opts) => runtime.punctuate(lang, text, opts) }
  : null;
```

Precedent to copy verbatim: `LocalInferenceClient.ts:381-385` (field `:119`, cleared `:520`) and `LocalNativeClient.ts:181-185` (field `:96`, cleared `:944`).

## How a client receives the runtime

`ClientOptions.segmentation` and `ClientOptions.sentencesPerChunk` are already set for **every** client by `buildClientOptions` (`src/components/MainPanel/clientOptions.ts:17-30`). What is missing is the last hop: each descriptor's `createClient` ignores its `options` argument, and none of the eleven online clients takes them. One convention for all of them, matching `LocalInferenceClient.ts:217-219`:

```ts
// client
constructor(apiKey: string, options: { segmentation?: SegmentationRuntime | null; sentencesPerChunk?: number } = {}) {
  this.segmentation = options.segmentation ?? null;
  this.sentencesPerChunk = options.sentencesPerChunk ?? 3;
}
// descriptor — the parameter loses its underscore
createClient(creds: Credentials & { ok: true }, options: ClientOptions): IClient {
  return new XClient(creds.primary, { segmentation: options.segmentation, sentencesPerChunk: options.sentencesPerChunk });
}
```

Each task does this hop for the clients it touches; no task leaves a client holding a runtime it does not use.

---

## File Structure

| Path | Change |
|---|---|
| `src/services/clients/OpenAILiveClient.ts` (+ test) | modify — two streams, R1, R2, hard caps prefer a boundary |
| `src/services/clients/OpenAITranslateGAClient.ts`, `OpenAITranslateWebRTCClient.ts`, `GeminiClient.ts` (+ tests) | modify — two streams each |
| `src/services/clients/punctuateDefinite.ts` (+ test) | **new** — the shared fill-in helper |
| `SonioxClient.ts`, `VolcengineAST2Client.ts`, `VolcengineSTClient.ts`, `PalabraAIClient.ts`, `OpenAIGAClient.ts`, `OpenAIClient.ts`, `ZoomAIClient.ts` (+ one test) | modify — one call each |
| The matching `src/services/providers/*ProviderConfig.ts` | modify — pass `options` through |
| `src/components/MainPanel/segmentationTelemetry.ts` (+ test) | **new** — pure, because MainPanel has no harness |
| `src/components/MainPanel/MainPanel.tsx` | modify — two analytics edits |
| `src/components/Settings/sections/SentenceSegmentationSection.tsx` | modify — emit the download event |
| `src/lib/analytics.ts`, `docs/ANALYTICS_EVENTS.md` | modify |

---

## Task 1: GPT-Live — the reference timer/regex integration

`OpenAILiveClient` is the one that already splits inside a delta, so it is where the pattern is established; the other three copy it.

**Files:**
- Modify: `src/services/clients/OpenAILiveClient.ts`, `src/services/providers/OpenAILiveProviderConfig.ts`
- Test: `src/services/clients/OpenAILiveClient.test.ts`

**Interfaces:**
- Consumes: `SentenceStream` (`update`, `end`, `dispose`, `setLanguage`, `confirmedBoundary`), `ClientOptions.segmentation` / `.sentencesPerChunk`.
- Produces: the shape Tasks 2 and 3 copy — the constructor convention above, `sessionSegmentation`, per-side streams, and the two cut helpers.

- [ ] **Step 1: Write the failing tests**

New `describe('OpenAILiveClient with the segmentation stage')`. The existing 26 (`:501`, 11 tests; `:602`, 15 tests) run with no runtime injected and must stay green untouched.

1. an unpunctuated source item seals every N sentences mid-delta;
2. the sealed item shows the inserted punctuation, the pending one does not;
3. with the stage active, a delta carrying one sentence end does **not** close the item (R1) — and with N = 1 it does;
4. the hard span cap cuts at a confirmed boundary when one precedes it;
5. with no boundary the hard cap behaves exactly as today;
6. the translation side seals independently of the source side;
7. a silence timer closing an item calls `end()` on that item's stream, and the tail becomes that item's last text;
8. turn/pause rules still close items when the stage is disabled;
9. audio hand-off is unchanged by a seal — the assertions at `:707` and `:734` still hold;
10. R2: a runtime that becomes enabled *after* connect changes nothing for that session, and one that becomes disabled does not strand an item.

- [ ] **Step 2: Run to verify the new ones fail and the old 26 pass**

`npx vitest run src/services/clients/OpenAILiveClient.test.ts`

- [ ] **Step 3: Take the runtime, and freeze it**

Descriptor: `OpenAILiveProviderConfig.ts:59` passes `options` through, per the convention above. Client: constructor `:181`; fields beside the per-side item state at `:153-179`:

```ts
  private segmentation: SegmentationRuntime | null = null;
  private sentencesPerChunk = 3;
  /** R2: the session's answer, frozen at connect. See LocalInferenceClient:119. */
  private sessionSegmentation: SegmentationRuntime | null = null;
  /** One stream per side: the speaker's transcript and the model's output seal
   *  independently, because each has its own items and its own caps. */
  private userStream: SentenceStream | null = null;
  private assistantStream: SentenceStream | null = null;
  /** The raw text each stream still holds, mirrored from its onPending so the
   *  next delta can be handed the whole unsealed tail. */
  private userPending = '';
  private assistantPending = '';
```

Freeze in `connect()` (`:1133`), clear in `disconnect()` (`:1161`) beside the existing per-session resets.

- [ ] **Step 4: Build a stream per side, and feed it**

`ensureUserStream()` mirrors `ensureUserItem()`: returns null when `sessionSegmentation` is null, else builds a `SentenceStream` with `lang: <the session's source language>`, `runtime: this.sessionSegmentation`, `sentencesPerChunk: this.sentencesPerChunk`, and:

- `onPending: (text) => { this.userPending = text; }`
- `onSeal: (chunk) => this.sealUserItem(chunk.text)`

In `case 'session.input_transcript.delta'` (`:715-751`), inside `if (text.length > 0)`:

- when a stream exists (R1): skip the `lastSentenceEnd` split entirely — `this.appendUserText(text, startMs)` then `stream.update(this.userPending + text)`. The soft cap's `lastClauseEnd` and the hard cap stay, as below;
- when it does not: the block is byte-for-byte what it is today.

`sealUserItem(sealed)` replaces the open item's transcript with the sealed text and completes it; the `onPending` that `SentenceStream.seal()` fires immediately after (`SentenceStream.ts:342-347`) carries the remainder, which the next `appendUserText` opens the next item with. Write it beside `completeUserItem` (`:1023`):

```ts
  /** The stage decided this item ends here. The sealed text carries the marks
   *  the model inserted, so the item is rewritten rather than merely closed. */
  private sealUserItem(sealed: string): void {
    const id = this.currentUserItemId;
    if (!id) return;
    const item = this.itemLookup.get(id);
    if (item?.formatted) {
      item.formatted.transcript = sealed;
      this.eventHandlers.onConversationUpdated?.({ item });
    }
    this.completeUserItem();
  }
```

- [ ] **Step 5: Make the hard caps land on a boundary**

`:747` today:

```ts
            if (span !== null && span >= USER_SPAN_CAP_MS) this.completeUserItem();
```

The cap must still fire at the same moment; it just lands better. `confirmedBoundary()` already exists (`SentenceStream.ts:144-149`, tested at `SentenceStream.test.ts:412-427`) and returns an offset into the stream's pending text, or −1:

```ts
            if (span !== null && span >= USER_SPAN_CAP_MS) {
              const at = this.userStream?.confirmedBoundary() ?? -1;
              if (at > 0) this.cutUserItemAt(at);
              else this.completeUserItem();
            }
```

`cutUserItemAt` is new — the plan's earlier `splitUserItemAt` never existed. It cuts the open item's *accumulated* transcript, because the boundary may sit before the end of the delta just appended:

```ts
  /** Cut the open user item at `offset` in its accumulated transcript: the
   *  prefix completes as its own item, the remainder opens the next. The hard
   *  cap uses it to land on a boundary the stage confirmed instead of at
   *  wherever the delta happened to end — the cut that landed inside a word in
   *  the PR #552 recording. */
  private cutUserItemAt(offset: number): void {
    const id = this.currentUserItemId;
    const whole = id ? this.itemLookup.get(id)?.formatted?.transcript ?? '' : '';
    if (!id || offset <= 0 || offset >= whole.length) { this.completeUserItem(); return; }
    const item = this.itemLookup.get(id);
    if (item?.formatted) {
      item.formatted.transcript = whole.slice(0, offset);
      this.eventHandlers.onConversationUpdated?.({ item });
    }
    this.completeUserItem();
    this.appendUserText(whole.slice(offset), null);
  }
```

The stream keeps its own pending across this: the cut is a display decision, and the stream seals on its own schedule.

- [ ] **Step 6: Mirror on the translation side**

The assistant branch is `:754-781`, structurally identical: `ASSISTANT_SOFT_CAP_MS` (`:70`, used `:768`), `ASSISTANT_SPAN_CAP_MS` (`:71`, used `:775`), `closeAssistantText(itemId)` (`:1044`). The assistant twin of `sealUserItem` rewrites the item's transcript and then calls `closeAssistantText(id)` — **not** `completeUserItem`'s equivalent — because the audio hand-off depends on it (`pendingAudioItems`, `:172`).

- [ ] **Step 7: End a stream wherever its item closes**

Put the `end()` + `dispose()` inside `completeUserItem` (`:1023`) and `closeAssistantText` (`:1044`) so every caller is covered by construction. Callers today: `completeUserItem` from `:617` (handleUnexpectedEnd), `:730` (pause), `:742` (split), `:747` (cap), `:917` (silence timer), `:1184` (disconnect); `closeAssistantText` from `:770`, `:775`; `completeAssistantItem` (`:1086`) from `:618`, `:944`, `:1185`.

A stream's `end()` seals whatever tail remains, which arrives as one last `onSeal` — route it through the same `sealUserItem`, and clear `userPending`.

- [ ] **Step 8: Run and commit**

```bash
npx vitest run src/services/clients/OpenAILiveClient.test.ts
npx tsc --noEmit 2>&1 | grep -c "error TS"   # 319
git add src/services/clients/OpenAILiveClient.ts src/services/clients/OpenAILiveClient.test.ts src/services/providers/OpenAILiveProviderConfig.ts
git commit -m "feat(segmentation): segment GPT-Live display and land hard caps on boundaries"
```

---

## Task 2: The other three timer/regex providers

**Files:** `OpenAITranslateGAClient.ts`, `OpenAITranslateWebRTCClient.ts`, `GeminiClient.ts`, their tests, and `OpenAITranslateProviderConfig.ts` / `GeminiProviderConfig.ts`.

None of the three has a sentence or clause helper of its own, so R1 costs them nothing — they only gain the seal. Their close paths, re-checked:

| | close paths to hook | session begins |
|---|---|---|
| GA | `completeUserItem()` `:263`, `completeAssistantItem()` `:279`; `SILENCE_TIMEOUT_MS = 1000` `:21` | `connect()` `:492` |
| WebRTC | `completeCurrentPair()` `:185` — closes **both** sides at once (`:193`, `:199`); 1.5 s timer `:43`, armed `:140-145` | `connect()` `:394` |
| Gemini | `closeInputSegment()` `:709`, `closeAssistantSegment()` `:727`, `finalizeTurn()` `:746`; two 2 s timers `:111-112` armed `:684-701`; `turnComplete` `:855-862` | `connect()` `:372` |

Gemini has **three** close paths, not one: the plan's older "finalizes on `turnComplete`" missed the two silence timers it grew for Live Translate sessions.

- [ ] **Step 1: For each client, write the failing tests**

Four each: an unpunctuated long item seals every N; the sealed item carries the punctuation; the existing timer/turn rule still closes items; with no runtime every existing test passes unchanged.

- [ ] **Step 2: Implement**

Task 1's shape: the constructor/descriptor hop, R2's freeze at `connect()`, two streams, `update` on each item's accumulated text, `end()` from wherever an item closes. For WebRTC, `completeCurrentPair` ends both streams.

- [ ] **Step 3: Run each suite and the typecheck, then commit**

```bash
git commit -m "feat(segmentation): segment display for the remaining timer-driven providers"
```

---

## Task 3: Server-definite providers — punctuation only

No stream, no split. Seven clients, one call each.

**Files:**
- Create: `src/services/clients/punctuateDefinite.ts`, `punctuateDefinite.test.ts`
- Modify: the seven clients, their descriptors, and `SonioxClient.test.ts`

Everything the helper imports already exists with the assumed signature: `gateChars` (`SentenceStream.ts:45`), `sentenceEnds` (`sentenceEnd.ts:101`), `skeleton` (`sentenceEnd.ts:133`).

- [ ] **Step 1: Write the failing test for the helper**

Cases: no runtime → unchanged; a segment that already has a terminal → unchanged, model never called; too short → unchanged, model never called; the model declines → unchanged; the model answers → replaced; an answer whose skeleton differs → unchanged.

- [ ] **Step 2: Implement the helper**

```ts
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

Locations re-checked on 2026-09-20 — three of the plan's old ones were wrong:

- `SonioxClient.ts` — `completeItem()` `:651-667`, where `formatted` `:661` and `content` `:662` are assigned; reached from `finishUtterance()` `:707` (calls `:714-715`) and `abandonUtteranceState` (`:1088-1089`).
- `VolcengineAST2Client.ts` — `handleSourceSubtitle()` `:680-723` (text `:704-705`) and `handleTranslationSubtitle()` `:725-769` (push `:753`).
- `VolcengineSTClient.ts` — `handleSubtitle()` `:702-760`, inside `if (subtitle.Definite)` `:740-748`.
- `PalabraAIClient.ts` — **not** `:593-596` (that is a string literal in the session-config payload). The real sites are `handleValidatedTranscription()` `:968-1024` (text `:999-1002`, `:1008-1016`) and `handleTranslatedTranscription()` `:815-855`.
- `OpenAIGAClient.ts` — `handleInputTranscriptionCompleted()` `:577-590` (assign `:586-587`) and `handleResponseDone()` `:593-620` (`:616`).
- `OpenAIClient.ts` — **not** a completed-transcription path; this file has none. The single place item text reaches the UI is `convertToConversationItem()` `:435-464` (status `:445`, transcript `:451`), called from the `'conversation.updated'` listener `:381-398`. Punctuate only when that conversion produces a **completed** item, and never on an in-progress one.
- `ZoomAIClient.ts` — `handleUtterance()` `:78-114`: source assigned `:93-94`, translation `:106-107`.

Each client also takes the runtime through the constructor/descriptor hop. Non-final tokens are shown as they are; only the final assignment changes.

- [ ] **Step 4: Detected language, where there is one**

The older plan said "some providers report the language per item". Exactly one does: `SonioxClient` sets `detectedLanguage` (`:658`, `:663`, `:1074`). `VolcengineSTClient` has `subtitle.Language` on the wire (`:755`) but never puts it on the item. The other five have no per-item language at all.

So: Soniox passes its per-role detected language to `punctuateDefinite`; `VolcengineSTClient` passes `subtitle.Language` when present; everyone else passes the configured language. One test for the Soniox case. For Tasks 1 and 2, call `stream.setLanguage(...)` only where a client actually has a detected language — none of those four do today, so this is a no-op there and must not be invented.

- [ ] **Step 5: Test one client end to end**

`SonioxClient.test.ts`: a long unpunctuated definite segment gets punctuation, and the item boundary is identical with and without the runtime.

- [ ] **Step 6: Run and commit**

```bash
git commit -m "feat(segmentation): fill in punctuation on server-definite segments"
```

---

## Task 4: withdrawn (Amendment A1, 2026-09-20)

The one-time download notice is gone. A1 replaced the background download on first need with one confirmation in the section: the user is asked before anything downloads, so an after-the-fact notice in MainPanel has nothing left to announce. `SegmentationNotice` is never built, and `sentenceSegmentationNoticeShown` is deleted from `CommonSettings`. The work A1 needed was slice 3b, which has landed.

---

## Task 5: Diagnostics and analytics

**Files:**
- Create: `src/components/MainPanel/segmentationTelemetry.ts` (+ test)
- Modify: `src/lib/analytics.ts`, `src/components/MainPanel/MainPanel.tsx`, `src/components/Settings/sections/SentenceSegmentationSection.tsx`, `docs/ANALYTICS_EVENTS.md`

- [ ] **Step 1: Write the failing test for the pure telemetry function**

MainPanel has no React harness — the constraint that produced `sessionModelTelemetry.ts`, which `MainPanel.tsx:4024` already spreads into the start event — so the per-leg counters are computed by a pure function and tested there. Cases: counts seals by reason per leg; counts model calls per leg; computes sentence terminals per 100 characters per leg, ASR model and language; carries no text (assert every value is a number, and that no key or value contains a space).

- [ ] **Step 2: Extend the event types**

`src/lib/analytics.ts`, in `'translation_session_start'` (`:27-50`):

```ts
    sentence_segmentation_enabled?: boolean;
    /** A1: the toggle is on AND all three models are on disk. */
    sentence_segmentation_active?: boolean;
    sentence_segmentation_chunk_sentences?: number;
```

in `'translation_session_end'` (`:53-59`):

```ts
    /** Seals by reason, per leg, e.g. { speaker_sentences: 12, speaker_length: 3 }. */
    segmentation_seals?: Record<string, number>;
    segmentation_model_calls?: Record<string, number>;
    /** Sentence terminals per 100 characters, per leg / ASR model / language.
     *  The measure of where punctuation is actually absent. Counts only. */
    segmentation_terminals_per_100?: Record<string, number>;
```

and two new events:

```ts
  'segmentation_models_download': { size_mb: number; result: 'ok' | 'error' | 'cancelled'; duration_ms: number };
  'segmentation_model_load': { model: string; backend: 'webgpu' | 'wasm'; load_ms: number; result: 'ok' | 'error' };
```

- [ ] **Step 3: Emit them**

- Start properties at `MainPanel.tsx:4018-4033`; end spread at `:4039-4044`.
- `segmentation_model_load` from `useSegmentationRuntime`'s `onLoaded` (`useSegmentationRuntime.ts:64-66`, currently a `console.info`).
- `segmentation_models_download` fires **from `SentenceSegmentationSection`, not from the store.** No store in this repo imports analytics (`grep -rn "trackEvent" src/stores/` is empty) and slice 3b's store deliberately reaches only for diagnostics; the section is a component, which is where every other `trackEvent` call lives. The section already awaits nothing, so wrap its two call sites (confirm and Retry): record `Date.now()` before, `await download()`, then read `useSegmentationStore.getState().phase` — `'ready'` → `ok`, `'error'` → `error`, `'missing'` → `cancelled` — and emit with `size_mb` from `PACK_TOTAL_BYTES`.

- [ ] **Step 4: LogsPanel lines**

With diagnostic logs on only: download and load durations, and one line per seal with its reason. No transcript text.

- [ ] **Step 5: Update the documentation**

`docs/ANALYTICS_EVENTS.md`: extend the two entries under "Translation Session Events" (`:55`, `:65`) and add the two new events under "Feature Adoption Events" (`:293`), in the file's `**Description**` / `**Properties**` bullet style.

- [ ] **Step 6: Run and commit**

```bash
git commit -m "feat(segmentation): report segmentation health and where punctuation is missing"
```

---

## Task 6: Tune the thresholds on recorded deltas, before release

`benchmark/punctuation-restoration/corpus/gpt-live-log-extract.json` holds 140 items, of which **58 carry a real delta sequence** (ja 26, zh 22, en 10) — an earlier draft of this plan said all 140 do, which is wrong. All 58 carry `delta_arrival_ms`; only 35 also carry `delta_timeline_ms`, so a measurement that needs the media timeline runs on those 35 and says so. Replaying them through `SentenceStream` measures seal counts, commit lag and false cuts without waiting for production data.

- [ ] **Step 1: Build the replay** under `benchmark/punctuation-restoration/tools/`, driving `SentenceStream` with the recorded delta sequence and timings for a grid of threshold sets.
- [ ] **Step 2: Sweep** right context R ∈ {4, 8, 16}; the gate's per-sentence constants ∈ {15, 20, 25} CJK and {40, 50, 60} other; the Chinese fallback ∈ {28, 33, 40}. Report per set: seals per minute, mean commit lag, cuts landing mid-word.
- [ ] **Step 3: Answer the Korean question.** Korean averages 16 characters per sentence, so N = 3 is ~48 — below the 60-character gate, and Korean therefore seals later than every other language. There are no Korean deltas: the 20 Korean passages live in `synthetic.gold.json` as whole texts, so this one is measured by feeding each text through `SentenceStream` in one update rather than as a delta stream, and the result is reported with that caveat. Either change the constant with the measurement behind it, or record why it stays.
- [ ] **Step 4: Record and apply.** Write the table into `docs/superpowers/notes/2026-09-14-asr-punctuation-benchmark.md` and change only the constants the measurement moves.

---

## Task 7: Real-environment validation

Steps 2, 3 and 5 need the repository owner or his fleet; the rest can be done here. Report per step rather than holding the slice.

- [ ] **Step 1: Platforms.** Packaged Electron on both backends — including whether multi-threaded WASM works under `file://`. The extension side panel: whether WebGPU is available there at all, and single-threaded latency.
- [ ] **Step 2: The recording that motivated the feature.** GPT-Live against the L3383 video at N = 3: the 60-second bubble becomes three-sentence bubbles with no mid-word cut.
- [ ] **Step 3: Sessions.** Soniox (definite fill-in), a long monologue (translation appears earlier), one session per provider family for regressions.
- [ ] **Step 4: Resources.** `app.getAppMetrics()` for renderer and GPU-process memory. GPU contention when local WebGPU ASR, translation and punctuation run together is unmeasured.
- [ ] **Step 5: Fleet.** WebGPU on GB10, the Windows RTX box and the Mac M4.
- [ ] **Step 6: UI.** Every locale checked for width on the section.
- [ ] **Step 7: Record the results** in the notes file and commit.

---

## Done when

- Every provider family shows segmented bubbles, and the server-definite ones show punctuated text on unchanged boundaries.
- GPT-Live honours N, and its hard cap no longer cuts inside a word when a boundary is available.
- With the stage off, or its models absent, every provider behaves exactly as it does on `main`.
- The analytics answer "where is punctuation actually missing" without carrying any text.
- Thresholds are either measured or explicitly recorded as unmeasured defaults.
- `npx vitest run --exclude ".superpowers/**"` is green, `npx tsc --noEmit` stays at 319, and the fleet runs are recorded.
