# Sentence Segmentation for Transcripts — Design

**Date**: 2026-09-16
**Status**: Approved section by section in brainstorming (2026-09-14 → 2026-09-16); written spec pending review
**Evidence**:
- `docs/superpowers/notes/2026-09-14-asr-punctuation-restoration-survey.md` (primary-source survey)
- `docs/superpowers/notes/2026-09-14-asr-punctuation-benchmark.md` (measured quality, renderer cost, production language mix)
- `benchmark/punctuation-restoration/` (corpus, ported models, parity scripts, results)

## Summary

Streaming ASR from online providers and from local models often arrives without sentence
punctuation, so a long monologue ends up in one ever-growing bubble. The client-side rules that
exist today either never cut it or cut it blindly: GPT-Live's 12 s span cap splits mid-word, and
the local pipeline waits for the VAD. Local translation also waits for the whole utterance.

This design adds a renderer-side **sentence segmentation stage** shared by every provider:
- **Counting.** It counts sentences, from the punctuation that is already there, or from a small
  punctuation model when there is none.
- **Sealing.** It seals a bubble every **N sentences**, where N is a user setting (1–5, default 3).
  Short utterances are untouched.
- **Local translation.** On Local Inference and Local Native, each sealed chunk goes to the
  translator as soon as it seals.
- **Server-definite providers** (Soniox, Volcengine, Palabra, OpenAI Realtime, Zoom) keep their
  boundaries and only get missing punctuation filled in.

The models are FireRedPunc (zh), Edge-Punct-en (en) and SaT `sat-3l-sm` (every other language).
- **Runtime:** one app-wide runtime and one worker.
- **Loading:** a model is downloaded in the background the first time it is needed.
- **Settings:** the feature is on by default and has its own "Sentence segmentation" section,
  visible for every provider.
- **Failures:** any failure falls back to today's behaviour.

## Problem (verified)

**Unpunctuated streams exist in production.**
- GPT-Live's Chinese input transcript had **no punctuation** for a fast narrator and **commas only**
  for a slow speaker (PR #552 GUI exports, `benchmark/punctuation-restoration/corpus/gpt-live.gold.json`).
  The fast narrator produced one ~60 s bubble, and the 12 s cap cut it mid-word
  (`…往往只能稍微延缓恶化很` | `难真正救回…`).
- The sherpa streaming families carry ~6% of speaker minutes and ~3% of participant minutes:
  stream-zh-2025, stream-multi-8lang, *-kroko, zipformer-ru/vi, vosk-ru, nemo-ctc-80ms.

**`Intl.Segmenter` cannot supply boundaries** (Node ICU 78.2 and Electron 40.8.5 ICU 77.1,
identical results).
- It finds no boundary at all in unpunctuated ja/zh/en/ko/fr/de/es/pt text: recall 0.
- In punctuated Latin text it splits after any abbreviation that is followed by a capital:
  `Dr.‖ Smith`, `Mr.‖ Brown`, `e.g.‖ Apple`, `U.S.‖ Army`, `J.‖ K.‖ Rowling`, `z.‖ B.`,
  `M.‖ Dupont`, `Sr.‖ García`, `Dra.‖ Silva`, `Wait...‖ What`.
  It gets decimals, versions, URLs, `Nr. 5` and `т. е.` right.

**Production language mix.** PostHog, production, 2026-06-01 → 2026-09-14, minutes per leg.

| Language | Speaker (source) | Participant (target) |
|---|---|---|
| zh | 36.3% | 16.7% |
| en | 20.7% | 45.5% |
| ru | 10.8% | 3.1% |
| es | 7.6% | 5.4% |
| ja | 7.6% | 21.3% |

Combined: en 34.6%, zh 25.3%, ja 15.3%, ru 6.5%, es 6.4%. `local_inference` carries ~70% of
minutes.

## Goals

- No bubble accumulates more than N sentences of speech without being cut, where N is the user's
  setting (1–5, default 3). For Chinese there is also a length fallback, ~100 characters at N = 3.
- Short utterances keep today's bubbles and today's translation unit.
- Long local utterances are translated chunk by chunk as they seal, instead of after the VAD ends
  the utterance.
- The stage serves Local Inference, Local Native, and online providers (display only for the latter).
- Nothing gets worse. Disabled, unavailable, slow or failing, the app behaves exactly as today.

## Non-goals

- Per-sentence bubbles or per-sentence translation.
- Changing the boundaries of server-definite providers, including splitting their long segments.
- Replacing `src/utils/splitSentences.ts` for TTS. It has the same `Dr.` issue, but the only cost
  there is an extra pause.
- Wiring the stage into the future hybrid orchestrator. The API stays reusable; nothing is connected.
- Adding new ASR models or changing any provider's server configuration.

## Decisions

| # | Topic | Decision |
|---|---|---|
| D1 | Scope | Local Inference, Local Native, and online providers' display segmentation |
| D2 | When a model runs | Runtime check only: the model is called only for a long unsealed tail with no sentence-terminal punctuation. No per-model "punctuates" flags. |
| D3 | Granularity | Seal a bubble every N sentences (see D15); shorter utterances are unchanged |
| D4 | Local translation | Each sealed chunk is enqueued for translation immediately, as text with the inserted punctuation; the utterance tail is the last job |
| D5 | Timer/regex online providers | All existing cut rules stay. Added: the N-sentence seal, and the hard span caps prefer a confirmed boundary. The translation side uses the same rules. |
| D6 | Server-definite providers | Boundaries kept, never split; missing punctuation filled in on the definite text |
| D7 | Sentence counting | When the model ran, count from its output. Otherwise use a shared sentence-end rule on existing marks. `Intl.Segmenter` is not used. |
| D8 | Chinese fallback | Tail ≥ N × 33 characters (~100 at N = 3) with < N sentence ends → seal at the latest confirmed breakpoint (sentence end or comma) |
| D9 | Architecture | Shared stage: `SentenceStream` + `PunctuationRuntime` + one worker, injected through `ClientOptions` |
| D10 | UI | Independent "Sentence segmentation" section, visible for every provider |
| D11 | Download | Automatic, in the background, on first need; manual download also offered |
| D12 | Default | On; one-time notice on the first background download |
| D13 | Hosting | Own Hugging Face repos (`jiangzhuo9357`), pinned `hfRevision` |
| D14 | Extension | Enabled as on desktop |
| D15 | Sentences per bubble | A user setting: 1–5, default 3, shown as a segmented control. The model gate and the Chinese fallback scale with it. At 1, local paths translate sentence by sentence. |

## Models

| Model (build) | Routed languages | Files | Backend | License | Measured (benchmark) |
|---|---|---|---|---|---|
| FireRedPunc, 8-bit weight-only (MatMulNBits, fp32 activations) | zh, yue, zh+en | 163 MB | WebGPU, else WASM | Apache-2.0 | zh breakpoint F1 91.5 (GPT-Live raw 90.8); streaming breakpoints 93.0 / 90.2 at R=8; WebGPU zh 480 chars 27 ms; WASM ×4 394 ms |
| Edge-Punct-Casing en, int8 (sherpa-onnx `online-punct-en-2024-08-06`) | en | 7.6 MB | always WASM | Apache-2.0 | breakpoint F1 92.3, casing F1 84.0; en 960 chars 39 ms on WASM ×4 |
| SaT `segment-any-text/sat-3l-sm` (3 layers), 8-bit weight-only + 8-bit `GatherBlockQuantized` embedding | every other language (SaT covers 85) | 251 MB | WebGPU, else WASM | MIT | sentence-end F1 ja 94.1, ko 90.9, ru 96.6 (cased input); WebGPU 11–16 ms at any length |

**Output fidelity.** The q8w builds' WebGPU outputs are identical to WASM on every corpus input
(FireRedPunc 57/57, SaT 101/101). Against fp32:
- FireRedPunc: 100% identical.
- SaT: 96.7% identical; the differing splits are all near the threshold.

**Known model behaviour the design accounts for.**
- **FireRedPunc**
  - Prefers commas: 64 sentence ends against 103 in the reference, but 205 of 225 marks overall.
    → D8.
  - Upstream lowercases English; the port restores the input's casing.
  - Writes `Dr.` after English `dr`. → shared rule.
- **Edge-Punct-en**
  - Never forces a final mark; the utterance end supplies it.
  - Does not write abbreviation dots.
- **SaT**
  - Emits boundaries only, no marks.
  - Relies on capitals in Latin and Cyrillic text: sentence-end F1 44–80 on lowercased input.
- **Shared.** Every model marks the end of a prefix as a sentence end (end-of-input bias).
  → the right-context rule.

**Routing.**
- zh, yue and zh+en go to FireRedPunc; en goes to Edge-Punct-en.
- `auto` with no detected language, and every other language, go to SaT.
- An item's `detectedLanguage` overrides the configured language.

## Architecture

### Components

**`src/lib/segmentation/sentenceEnd.ts`: the shared sentence-end rule**
- Moved from `OpenAILiveClient.ts`: `SENTENCE_TERMINALS`, `SENTENCE_CLOSERS`, `CLAUSE_MARKS`,
  `periodIsNotSentenceEnd`, `lastSentenceEnd`.
- `ABBREVIATIONS` is extended with common de/fr/es/pt/ru/it abbreviations.
- New helpers: `sentenceEnds(text)` and `breakpoints(text)`, returning offsets.
- `OpenAILiveClient` imports the moved code, so its English behaviour is unchanged.

**`src/lib/segmentation/SentenceStream.ts`: pure logic, main thread, one instance per text stream**
```ts
interface SentenceStreamOptions {
  lang: string;
  runtime: SegmentationRuntime | null;      // null or disabled → no sealing at all
  onSeal(chunk: SealedChunk): void;         // text up to the seal, with inserted punctuation
  onPending(text: string): void;            // unsealed tail, raw
}
interface SealedChunk { text: string; reason: 'sentences' | 'length' | 'end'; }
class SentenceStream {
  update(fullText: string): void;           // whole current text since the last seal; ASR may rewrite the tail
  setLanguage(lang: string): void;
  end(): void;                              // utterance or item closed by the client
  dispose(): void;
}
```

**`src/lib/segmentation/SegmentationRuntime.ts`: the interface clients see**
```ts
interface SegmentationRuntime {
  readonly enabled: boolean;
  punctuate(lang: string, text: string, opts?: { signal?: AbortSignal }): Promise<PunctuationResult | null>;
}
interface PunctuationResult {
  text: string;               // input characters with inserted marks (SaT: a terminal at each boundary)
  sentenceEnds: number[];     // offsets into `text`, per the model-specific counting rules
  breakpoints: number[];      // sentence ends plus commas
  model: 'fireredpunc' | 'edge-punct-en' | 'sat-3l-sm';
}
```

**`PunctuationRuntime`: the implementation, one per app**
- Routes each language to a model.
- Downloads models through `ModelManager`.
- Creates the worker lazily.
- Tracks health and unloads idle models.
- Emits status events.
- Imports no store and no `report.ts`. The app layer forwards its events to the store and
  diagnostics.

**Workers**
- Entries: `punctuation-webgpu.worker.ts` and `punctuation-wasm.worker.ts`.
- Both are thin wrappers around a shared core with one adapter per model (`fireredpunc`,
  `edgePunctEn`, `sat`), ported from `benchmark/punctuation-restoration/models/*.mjs`.
- Protocol: `load` / `run` / `unload` / `dispose`, over the existing `WorkerSession` + `RequestRegistry`.

**`segmentationStore` (zustand)**
- Per model: status, download progress and error.
- Status values: `not-downloaded | downloading | downloaded | loading | ready | error | disabled`.
- UI reads only.

**Settings (`CommonSettings`)**
- `sentenceSegmentation: boolean`, default `true`.
- `sentenceSegmentationChunkSentences: number`, default `3`, clamped to 1–5 on read.
- `sentenceSegmentationNoticeShown: boolean`.

**UI**
- `SentenceSegmentationSection.tsx`.
- The first-download notice component.

### Injection

- `ClientOptions` in `src/services/providers/ProviderDescriptor.ts` gains
  `segmentation?: SegmentationRuntime`.
- MainPanel adds it to both legs through the same per-leg channel `createAIClient` already uses for
  `sonioxManaged` (`legOptions`).
- Clients never construct the runtime and never import a store. A client that receives no runtime,
  or a disabled one, behaves exactly as today.
- Tests pass a fake.

## Data flow and rules

### Counting, gating, sealing (`SentenceStream`)

- **Tail only.** Every decision looks at the unsealed tail. At most ~300 characters go into one
  model call.
- **Gate**
  - Tail contains a sentence terminal per `sentenceEnd.ts` → count from the existing marks; no
    model call.
  - Tail has no terminal and is long enough to hold N sentences (≥ N × 20 characters for zh, yue,
    ja and ko; ≥ N × 50 characters for every other language) → `runtime.punctuate`. At the default
    N = 3 that is 60 and 150 characters. The per-sentence constants come from the corpus's average
    sentence lengths (ja 19, zh 22, ko 16, en 40, fr/de/es/pt/ru 36–38 characters) and are starting
    values, tuned after release.
  - Otherwise → wait. Short utterances therefore never trigger a download.
- **Counting from a model result**
  - Edge-Punct-en: its periods.
  - SaT: its boundaries.
  - FireRedPunc: `。！？`, plus `.` only where `periodIsNotSentenceEnd` is false.
- **Right context.** A sentence end counts only once ≥ 8 skeleton characters follow it. A mark at
  the very end of the tail is never trusted.
- **Freeze.** Counted positions are frozen. If the ASR rewrites text before them, the stream
  re-anchors by skeleton and never un-seals.
- **Seal.** At the Nth counted sentence end, seal through it (`reason: 'sentences'`); the
  remainder stays pending. N is read per stream when it is created, so changing the setting applies
  to the next utterance or item, never mid-bubble.
- **Chinese fallback.** For zh and yue only (not ja), if the tail reaches ≥ N × 33 characters
  (rounded to ten: 100 at N = 3) with fewer than N sentence ends, seal at the latest confirmed
  breakpoint that has ≥ 8 characters of right context (`reason: 'length'`). The constant exists
  because FireRedPunc emits only 62% of the reference sentence ends, so N detected sentences are
  roughly 1.6 × N real ones.
- **`end()`**
  - Punctuate the tail if it is long and unpunctuated.
  - Emit the remainder as a final chunk (`reason: 'end'`). The right-context rule does not apply.
- **Scheduling**
  - One in-flight call per stream. Updates arriving meanwhile coalesce, latest wins.
  - A result whose input is no longer a prefix of the current tail is discarded.
- **Output invariant.** The result's letter/digit skeleton must equal the input's; otherwise the
  result is discarded (see Failure handling).
- **Display.** Sealed chunks show the inserted punctuation. The pending tail is shown raw, with no
  flickering provisional marks.

### Local Inference (`src/services/clients/LocalInferenceClient.ts`)

- **One stream per utterance**, source side.
- **Partials.** `handlePartialAsrResult` → `update(text)`; the in-progress user item shows the tail.
- **Seals.** Each seal:
  - completes a user item with `chunk.text`;
  - enqueues a pipeline job with `chunk.text` on the existing queue (`ttsQueue` → `processQueue` →
    `processPipelineJob`).
- **Utterance final.** `handleAsrResult` → `update(final)` then `end()`; the tail becomes the last
  item and job.
- **Offline workers** (whisper, qwen3-asr, granite, sherpa offline) deliver only the final, so they
  go straight to `update` + `end`.
- **Short utterances** give exactly one item and one job, as today.
- **Unchanged:**
  - AST mode (`translationModelId === asrModelId`);
  - the Voxtral worker's own punctuation endpoint;
  - the VAD 20 s cap;
  - TTS via `splitSentences`.

### Local Native (`src/services/clients/LocalNativeClient.ts`)

Same shape as Local Inference:
- `onAsrPartial` → `update`.
- `onAsrResult` → `update` + `end`.
- Each chunk → `runJob` on the existing promise chain.
- `onTranslatePartial` streams the translation bubble per job.
- VAD marks to the sidecar are unchanged.

### Timer/regex online providers (display)

**Clients:** `OpenAILiveClient`, `OpenAITranslateGAClient`, `OpenAITranslateWebRTCClient`,
`GeminiClient` (Live Translate idle timers and `turnComplete`).

**Streams**
- One stream for the source side, one for the translation side.
- Accumulated text of the current item → `update`.
- On a seal, the current item closes at the seal offset and the remainder opens a new item.
  GPT-Live already splits inside a delta.

**Existing rules stay**
- They cover sentence-end cuts, GPT-Live's pause and soft-cap rules, silence timers and
  `turnComplete`.
- Whenever one of them closes an item, it calls `end()` on that item's stream.

**Hard span caps** (GPT-Live `USER_SPAN_CAP_MS` 12 s, `ASSISTANT_SPAN_CAP_MS` 30 s)
- When a confirmed boundary precedes the cap, cut there instead of wherever the cap lands.
- Otherwise the cap behaves as today.

**Audio.** Delivery and the timeline handoff are unchanged.

### Server-definite providers (display, punctuation only)

**Clients**
- `SonioxClient` (`<end>` → `finishUtterance`)
- `VolcengineAST2Client` / `VolcengineSTClient` (`Definite`)
- `PalabraAIClient` (`validated_transcription` / translated)
- `OpenAIGAClient` / `OpenAIClient` (server turns)
- `ZoomAIClient` (one REST transcription per VAD utterance)

**Rule.** No stream and no split. When a segment becomes definite, it is punctuated only if it
meets the gate's length threshold and has no terminal mark: `runtime.punctuate` runs once and the
displayed text is replaced with the result. Non-final tokens are shown as they are.

### Language per stream

- **Speaker leg:** the source stream uses `sourceLanguage`, the translation stream `targetLanguage`.
- **Participant leg:** the reverse.
- **Overrides:** an item's `detectedLanguage` wins over the configured language.
- **`auto`** with no detection goes to SaT.

## Runtime, models and resources

### Worker and backend

**Worker creation.** Created on first need. The entry is chosen at creation:
- `checkWebGPU()` found an adapter → the `onnxruntime-web/webgpu` entry;
- otherwise → the `onnxruntime-web/wasm` entry.

**Backend per model.**
- Edge-Punct-en runs on the WASM EP in either worker. It is dynamic int8, and ORT's WebGPU EP has
  no kernels for those ops.
- FireRedPunc and SaT run on the WebGPU EP in the WebGPU worker, and on WASM otherwise.

**Measured constraint.** The WebGPU bundle's WASM EP lacks `GatherBlockQuantized`, so SaT cannot
fall back inside that bundle. A WebGPU failure therefore recreates the worker with the WASM entry
(see Failure handling).

**Threads.** WASM runs multi-threaded where SharedArrayBuffer is available, which measured 2–3×
faster in Electron. The extension (no COOP/COEP) runs single-threaded.

**Checks and consistency tests.**
- `shaderF16Gate.consistency.test.ts`: the worker binds the checked adapter without requiring
  `shader-f16` (no build needs f16), or carries an exemption the test accepts.
- Vite chunk pinning follows `_shared/onnxruntime-webgpu.ts` / `_shared/onnxruntime-all.ts`.
- Verify during implementation that the WASM entry actually imported registers
  `GatherBlockQuantized`. The benchmark verified `ort.wasm.min.mjs`.

### Manifest and hosting

**Manifest (`src/lib/local-inference/modelManifest.ts`)**
- `ModelType` gains `'punctuation'`.
- Three `MODEL_MANIFEST` entries use `hfModelId` + `hfRevision`.
- One variant each, no `requiredFeatures`.

**Filtered out of** local engine selection (`selection/*`), `ModelManagementSection` and
`StoragePage`. They appear only in the new section.

**Storage.** Download, validation, IndexedDB storage and blob URLs all reuse `ModelManager` /
`modelStorage`.

**Hosting.** Repos under `jiangzhuo9357`, each carrying:
- the upstream license;
- a model card;
- the conversion recipe from the benchmark scripts.

Uploading is an outward action that needs explicit confirmation at the time.

### Lifecycle

- **First need, not yet downloaded:** if the toggle is on, start a background download and return
  `null`. On the first download ever, show the notice.
- **Downloaded but not loaded:** load (0.5–2.4 s) and return `null` meanwhile.
- **Loaded:** models stay while any session is active.
- **After a session ends:** models the current language pair does not need unload after 2 minutes
  idle, and the worker terminates when it holds none.
- **Memory guard:** if `navigator.deviceMemory` ≤ 4, no model loads; the rule alone runs.

### Memory

Measured in the Electron 40 renderer.
- **Shared baseline:** ORT, ~250 MB in one worker.
- **Per model:** Edge-Punct-en ~0.25 GB; FireRedPunc 0.75–1.0 GB; SaT 1.15–1.5 GB.
- **Typical pairs:** zh↔en ≈ 1.1–1.4 GB; zh↔ja on WebGPU up to ≈ 2.5 GB.

**Must be measured before shipping.** WebGPU sessions keep an extra 1.1–1.9 GB of renderer working
set. Candidates to try: releasing the model bytes after session creation, and ORT arena settings.

## Settings UI

**Section:** `SentenceSegmentationSection`.
- **Placement:** Simple mode after `LanguageSection` (`SimpleSettings.tsx`); Advanced mode on the
  General tab after `LanguageSection` (`AdvancedSettings.tsx`).
- **Deep link:** `sentence-segmentation` in `NAVIGATION_TAB_MAP` → `general`.

**Toggle.** Copies the diagnostic-logs switch in `HelpSection.tsx`: markup, and persistence through
`persistSetting` with rollback.

**Description.** One sentence: long unsegmented transcripts get punctuation and a new bubble every
N sentences, and a model is downloaded only when needed.

**Sentences per bubble.** A segmented control with 1–5, default 3, directly under the toggle and
greyed out with it, plus a line naming the effect ("long speech starts a new bubble every 3
sentences"). It is the only tuning knob exposed; the gate and the Chinese fallback follow it. On
Local Inference and Local Native it also sets the translation unit, so 1 means sentence-by-sentence
translation and 5 stays close to today's whole-utterance behaviour.

**Model rows.** One row per model:
- name (Chinese / English / Other languages), size and status;
- actions: download, delete, retry;
- a "used by current languages" mark covering both legs.

During a session, deleting a model in use is disabled (`isSessionActive`). On low-memory devices
the rows are greyed out with the reason.

**One-time notice**
- **Trigger:** the first background download ever.
- **Content:** which model, its size and purpose, and a link to the section.
- **Pattern:** reuses MainPanel's existing in-session notice family (`EchoNotice`,
  `AudioSystemBanner`). No new chip, since chip patterns for device state were rejected before
  (#468).
- **Visual:** settled by rendering candidates during implementation.

**i18n.** Every locale gets real translations, not English placeholders.
`locales.consistency.test.ts` enforces identical keys.

## Diagnostics and analytics

**Diagnostics**
- `PunctuationRuntime` failures (download, load, worker crash) go through
  `reportWarning('Segmentation', …, { dedupeKey })` from the app layer.
- On the hot path only the ok → failing transition is reported.
- No transcript text reaches any diagnostic or analytics payload.
- No new `CLIENT_DIAGNOSTICS` codes: a failing runtime returns `null` and the client proceeds as
  today.
- LogsPanel (diagnostic logs on only): download and load durations, and seal reasons.

**Analytics (PostHog)**
- `translation_session_start` gains `sentence_segmentation_enabled` and
  `sentence_segmentation_chunk_sentences`.
- New events:
  - `segmentation_model_download` `{ model, size_mb, result, duration_ms }`
  - `segmentation_model_load` `{ model, backend: 'webgpu' | 'wasm', load_ms, result }`
- `translation_session_end` gains per-leg counters:
  - seals by reason;
  - model calls;
  - **sentence terminals per 100 characters by leg, ASR model and language**. This is the missing
    measure of where punctuation is actually absent; it carries no text.
- `src/lib/analytics.ts` event types and `docs/ANALYTICS_EVENTS.md` are updated together.

## Failure handling

Principle: every failure falls back to today's behaviour. The section shows the state, and each
failure class is reported once.

| Situation | Handling |
|---|---|
| Toggle off | Disabled runtime: no sealing, no model calls. GPT-Live's moved sentence-end rule still applies as before. |
| Model not downloaded / downloading / loading | `punctuate` → `null`. Punctuated text is still counted and sealed; unpunctuated long text is not sealed and client caps behave as today. |
| Download failure (network, HF unreachable, validation, storage full) | Error + retry in the section. No automatic retry in the same app launch; one automatic retry on need in a later launch; manual retry any time. |
| WebGPU load failure or device lost | WebGPU disabled for this app launch; worker recreated with the WASM entry, models reloaded; one warning |
| Single call error or timeout (3 s) | That call → `null`, treated as no model |
| 3 consecutive failures for a model | Model disabled for the session; rule only; reason shown |
| Worker crash | Restart once; a second crash disables models for the session |
| Too slow | Coalescing and the ~300-character window first; if median latency stays over 500 ms, rule only for the session |
| Output skeleton ≠ input skeleton | Result discarded; one diagnostic |
| ASR rewrites counted text | Re-anchor by skeleton; if alignment fails, restart counting at the current end; never un-seal |
| Unknown or unsupported language | SaT; if SaT is unavailable, rule only |
| `deviceMemory` ≤ 4 GB | No model; rule only |
| Session ends mid-call | Pending calls cancelled, streams disposed; late results cannot touch items (session generation check) |
| Setting persistence fails | Existing rollback pattern |

## Testing

**Unit (vitest, colocated)**
- **`sentenceEnd.ts`:** table-driven, covering every abbreviation case measured above, decimals,
  versions, URLs, ellipsis, CJK terminals and closers. GPT-Live's existing tests move with the code,
  and `OpenAILiveClient.test.ts` stays green.
- **`SentenceStream`:** with a controllable fake runtime, cover:
  - gating (short, long-unpunctuated, punctuated);
  - the N-sentence seal at N = 1, 3 and 5, and the zh fallback at a comma for each N;
  - a setting change applying only to the next stream, never mid-bubble;
  - the right-context rule and distrust of the final mark;
  - freezing and re-anchoring;
  - latest-wins coalescing and `end()` flushing;
  - null-runtime parity with today;
  - discard on a skeleton mismatch.
- **`PunctuationRuntime`:** with a fake worker (the `WorkerSession.test.ts` pattern), cover:
  - lazy creation and single download trigger;
  - failure counting, crash restart and WebGPU → WASM fallback;
  - the 2-minute idle unload (fake timers) and the memory guard.
- **Model adapters:** golden tests on fixed token ids and canned logits, covering tokenization
  mapping and decoding. No ONNX runs in vitest.
- **Settings and store:** the default is on, persistence rolls back, and the notice flag works.

**Client integration**
- **Local Inference and Local Native:**
  - a long streaming utterance seals every N sentences and enqueues jobs in order;
  - an offline final of 6 sentences gives 2 items and 2 jobs;
  - short utterances and the disabled toggle match existing tests.
- **GPT-Live, OpenAI Translate, Gemini:**
  - a seal splits an item mid-delta;
  - a hard cap prefers a confirmed boundary;
  - with the toggle disabled, existing tests are unchanged.
- **Soniox, Volcengine, Palabra:** an unpunctuated long definite segment gets punctuation;
  boundaries are unchanged.
- **MainPanel:** there is no React harness, so test the helper that builds `legOptions` and confirm
  both legs receive the runtime.

**Consistency tests to update**
- `shaderF16Gate.consistency.test.ts`
- `_shared/harness-consolidation.test.ts` (if the worker joins its lists)
- `locales.consistency.test.ts`
- `consoleLedger.consistency.test.ts`
- `modelName.test.ts` (manifest walk)

**Quality regression (local, not CI).** `benchmark/punctuation-restoration` gains an entry that
runs the production adapters on the corpus. They must reproduce the benchmark numbers. The test
skips when the models are not cached locally.

**Real environment**
- **Platforms:**
  - packaged Electron on both backends, checking whether threads work under `file://`;
  - the extension side panel (WebGPU availability, single-thread latency).
- **Sessions:**
  - GPT-Live on the L3383 video at the default N = 3: seals every three sentences, no mid-word cuts;
  - Local Inference with sherpa `stream-zh` (unpunctuated) and cohere (punctuated);
  - Local Native and Soniox;
  - a long monologue, checking that translation now appears earlier.
- **Resources:**
  - renderer and GPU process memory via `app.getAppMetrics()`, including the WebGPU RSS question;
  - WebGPU on the fleet: GB10, Windows RTX, Mac M4.
- **UI:** rendered candidates for the section and the notice; every locale checked for width.

**After release (PostHog).** Watch download success, load failures, seals per session by reason,
and terminals per 100 characters per ASR model. Tune from those numbers: the default N, the gate's
per-sentence constants (20 and 50 characters), the Chinese fallback's 33 characters per sentence,
R = 8, the 3 s timeout and the 500 ms latency budget.

## Suggested phasing for the implementation plan

1. **Foundation**
   - `sentenceEnd.ts` (moved plus extended), with `OpenAILiveClient` switched to import it and no
     behaviour change.
   - `SentenceStream` with a fake runtime.
2. **Runtime and models**
   - Adapters, workers, `PunctuationRuntime`, manifest entries.
   - Hosting preparation: repos drafted locally; upload after confirmation.
   - The renderer memory measurement.
3. **Settings and store:** section, toggle, model rows, store, i18n.
4. **Local Inference and Local Native integration.**
5. **Timer/regex online providers integration.**
6. **Server-definite providers:** punctuation fill-in.
7. **Notice, diagnostics, analytics;** then real-environment validation and fleet runs.

## Risks and open questions

- **WebGPU renderer memory:** WebGPU sessions keep an extra 1.1–1.9 GB of renderer RSS. This may
  force lazy unloading between sessions to be more aggressive than 2 minutes.
- **Platform capabilities:**
  - multi-threaded WASM in packaged Electron (`file://`) is unverified;
  - WebGPU availability in the extension side panel is unverified.
- **GPU contention:** contention with local WebGPU ASR and translation (Voxtral, Qwen3-ASR, Qwen
  translation) on the same GPU is unmeasured.
- **Small tuning corpus.** The corpus is 101 passages (zh 34 / 71 internal boundaries, ja 24 / 42,
  en 23 / 36, ko 20 / 24) plus 10 passages and 14 boundaries for each of fr, de, es, pt and ru.
  Where each threshold comes from:

  | Threshold | Value | Basis |
  |---|---|---|
  | Right context | 8 characters | Measured: precision stops improving past R = 8 (streaming tables at R = 0/4/8/16); commit lag 9–14 characters |
  | Sentences per bubble | 1–5, default 3 | Product choice, now a user setting |
  | Model gate | N × 20 / N × 50 characters | Derived from corpus average sentence lengths; no experiment |
  | Chinese fallback | N × 33 characters | Derived from FireRedPunc's 62% sentence-end rate; not tuned |
  | Model window | ~300 characters | SaT degrades past 510 subwords (511 → 984 ms, 1,020 → 4.5 s); FireRedPunc caps at 512 tokens; Edge at 200 pieces per row |
  | Inference timeout | 3 s | Engineering default |
  | Latency budget | 500 ms median | Reference points measured (WASM ×4 zh 480 chars 394 ms; WebGPU 27 ms); the budget itself is a default |
  | Disable rule | 3 failures / 2 crashes | Engineering default |
  | Idle unload | 2 minutes | Engineering default |
  | Memory guard | `deviceMemory` ≤ 4 GB | Engineering default |

  Model-internal thresholds are left at upstream defaults on purpose (SaT 0.25; Edge and
  FireRedPunc take the argmax), so nothing is fitted to this corpus.

  **Korean is the weakest fit:** its average sentence is 16 characters, so N = 3 is ~48, below the
  60-character gate, and Korean will seal later than the other languages. A 50-character constant
  would fit better but has no measurement behind it.

- **Tune before release with recorded deltas.** The 11 GPT-Live spike sessions in the corpus carry
  real delta sequences and timings. Replaying them through the stage at several threshold sets
  measures seal counts, commit lag and false cuts without waiting for production data.
- **Undercounted Chinese sentences:** FireRedPunc's 62% sentence-end rate is why D8 exists; if bubbles
  still read long, lower the fallback's 33 characters per sentence.
- **ASR rewrites:** how often sherpa partials rewrite text more than 8 characters back is unmeasured;
  re-anchoring covers correctness, not frequency.
- **Hosting is outward:** hosting the converted models is an outward publication and needs explicit
  confirmation at upload time.
