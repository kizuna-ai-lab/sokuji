# Client contract — Stage 1e-2: LocalInference on the spine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LocalInference — local ASR, translation and TTS in web workers — as the first real provider on the new contract: its definition (settings, languages, a pair- and leg-aware readiness check, `build` / `describe` / `admit`, its settings and model-management components) and its adapter over today's engines, run live in the development preview.

**Architecture:** A provider directory `src/providers/localInference/`: `settings.ts` (`S`), `check.ts`, `config.ts` (`C`, `build`, `describe`, `admit`, the local prompt), `engines.ts` (a factory over today's `AsrEngine` / `StreamingAsrEngine` / `TranslationEngine` / `TtsEngine`, injectable for tests), `adapter.ts` (the session: segments, the serial job queue, turns), `speech.ts` (TTS per sentence with exact ranges, resampled to 24 kHz), `provider.ts` (the definition), `LocalInferenceSettings.tsx` / `LocalInferenceEngine.tsx`. Three small additions to the shared layers first: the runner hands its punctuator to the adapter (`StartRequest.punctuate`); `SharedSettings` says which direction is the participant's and how the display segments; an adapter can fail its start with a localizable code. The engines and workers under `src/lib/local-inference/` do not change, with one exception ruled below.

**Tech Stack:** TypeScript (strict), React 18, zustand, Web Workers (onnxruntime-web / transformers.js / sherpa-onnx wasm), i18next, Vitest + @testing-library/react, Vite, headless Chromium over the DevTools protocol.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — "The provider definition", "Readiness is one check", "Session lifecycle" (build, admit, the participant leg, D17, D20, D22), "The contract" (what every adapter must obey), "Turns" (D14: local engines — `endTurn` flushes with the tail the engine needs), "Notices reach the user localized", "Migration" (LocalInference keeps the translation-job cut). The roadmap's "Decided for 1e" (jiangzhuo: `check` sees the pair — and, since plan 1e-1, the legs) and "Scheduled by plan 1e-1" → 1e-2 items bind this plan. Two research notes shaped it: the pipeline today and its mapping (`1e2-pipeline.md`) and the definition (`1e2-definition.md`), both summarized in the rulings below.

## Global Constraints

- Today's app path does not change: `src/services/**` (incl. `LocalInferenceClient.ts` and its descriptor), `src/components/MainPanel/**`, `src/components/Settings/ProviderSpecificSettings.tsx`, `src/components/Settings/SimpleSettings.tsx`, `electron/**`, `extension/**` are read only; LocalInference keeps working there exactly as today until plan 1e-3. Components you reuse from `src/components/Settings/**` may gain optional props; their existing callers keep working unchanged.
- The engines and workers under `src/lib/local-inference/` do not change, except the one engine change ruling 6 allows.
- `src/providers/**` imports no store but its own: `modelStore` (LocalInference's), `turnModeStore` (the global turn mode, which its settings component may write) — never `settingsStore`, `providerStore`, `audioStore`. `src/lib/**` never imports React.
- New locale keys only in Task 1 — added to all 30 locales, translated (`locales.consistency.test.ts`); reuse a locale's existing translation where the same sentence already exists (named in Task 1).
- Record a caught failure with `reportError` / `reportWarning`, never `console.error` / `console.warn`; inside the adapter, failures are `degraded` / `failed` events and `frame`s, never `report()` (spec: "Inside an `IClient` session, clients never call `report()`").
- Every adapter obeys the contract's rules (`src/lib/contract/adapter.ts` and `conformance.ts`): 24 kHz mono Int16 in and out; UTF-16 ranges; refs never reused; typed text answered by a source segment with exactly the typed text; nothing after `failed` / `closed` or after `stop()`; `stop()` ends the pipeline before its first `await`; frame payloads carry no audio, no credential, no string of 2048 characters or more.
- Gates for every task: `npx vitest run src` shows 0 failed (4 unhandled rejections from `settingsStore.nativeGate.test.ts` are the baseline), and this typecheck gate prints exactly the same **11 lines** it prints at this plan's start (the shell's `grep` is a ugrep wrapper that mis-parses this regex — use `command grep` exactly as written):

  ```
  npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts)|lib/modern-audio/BaseAudioRecorder|providers|components/(providers|Conversation|Subtitle|MainPanel/ExportButton|dev/(SpinePreview|SessionControls|OverlayPreview))|stores/(providerStore|turnModeStore|routingStore)|utils/(environment|conversationExport)|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
  ```

  The 11 lines: App.tsx TS6133 'React'; SubtitleApp.handleStart.test.tsx TS6133 'provider'; 6× SubtitleBar.test.tsx TS2322 'SessionControl'; analytics.ts TS6133; environment.ts TS2717; environment.ts TS2339. Do not fix them; do not add to them. (`src/providers` is inside the gate: every new file there must typecheck clean.)
- Commits: conventional, English; every message ends with the implementing model's `Co-Authored-By` line and `Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28`. In this worktree the shell refuses compound git commands: run `git add` and `git commit -q -F - <<'EOF' … EOF` as separate calls. Never push.

## Rulings this plan makes

1. **The translation-job cut splits in two plans.** Today's three shapes: `off` (one job per ASR final, raw text), `fill-in` (one job per final, the text punctuated first, 1 s budget), `stream` (a job every N sentences inside an utterance, ~250 lines of seal-cursor logic). This plan builds the first two — one job per ASR final, punctuated when the display is set to sentences and a punctuator is supplied, exactly today's rule — and **plan 1e-2b** builds the stream shape before plan 1e-3 switches the app over, so no user sees the gap. Until then a sentences size of 1–5 behaves as Auto (punctuated, one job per final). The display cut is L2's already.
2. **The runner hands its punctuator to the adapter** (`StartRequest.punctuate`, the runner's `deps.punctuate`): the job text is the pipeline's decision (D7), the punctuation model is shared. Absent (the preview today), the job text stays raw.
3. **`SharedSettings` gains `reversed(direction)`** (this is the participant's direction: the pair's reverse) and **`segmentation`** (`{ mode, sentencesPerRow }`): LocalInference's own prompt fields choose the participant prompt by it, and the job text follows the display mode as today. `build` computes LocalInference's instructions from its own `S` (`useTemplateMode`, `systemPrompt`, `participantSystemPrompt`, `buildDefaultLocalPrompt`) and never calls `shared.instructions()` — the two prompt mechanisms stay distinct, as today's `hasTemplateMode: false` keeps them.
4. **A start can fail with a code of its own**: `AdapterStartError { code, params }` in the contract; the runner's `start_failed` path uses the code when the failure carries one. LocalInference uses it for the GPU running out of memory (`gpu_out_of_memory`, worded as today's `errors.gpuOutOfMemory`).
5. **Behaviour kept from today, stated:**
   - Readiness gates exactly today's `ensureSelectionReady`, now from `ctx.pair` and `ctx.legs` and without writing to any settings: the mandatory leg's ASR and translation (participant-only: the participant's; otherwise the speaker's); TTS never; a participant leg alongside the speaker's never. `check` does not prune stale selections (today's write-during-check): `build` resolves around them as `resolve` already does.
   - A participant leg with no translation model runs transcription-only, as today, with a `translation_unavailable` notice (a new `degraded` code) instead of today's warning; with no ASR model its `build` refuses (`no_asr`).
   - The memory budget becomes `admit`, summing exactly the configs built (TTS only where a leg speaks), refusing with `memory_exceeded`; unlike today it also applies to a speaker-only run, since the same budget is exceeded either way.
   - Serial jobs: a job translates and speaks before the next job translates (today's queue).
   - `endTurn` feeds seven 100 ms frames of silence (2 400 samples each at 24 kHz) and flushes; **`cancelTurn` does the same** — no worker can discard a VAD segment or acknowledge a flush, and today every release flushes (`response: 'always'`); a blip below the VAD's minimum speech is dropped by the VAD itself. `beginTurn` does nothing.
   - Typed text is answered with exactly the typed string (today trims it); in an AST or transcription-only session it is answered by a source segment only, and the session emits `translation_unavailable` once.
6. **Aborting a load**: on the start's signal the adapter disposes every engine and rejects at once, and disposes any engine whose `init()` resolves afterwards. The one engine change this plan allows closes the window before a worker exists: each engine's `init()` checks a `disposed` flag after each of its awaits and throws before `new WorkerSession(…)` once disposed — a flag and a check per await, no other change.
7. **Errors**: a worker that dies (`onerror`), a lost GPU device, or a translation worker's fatal error (`TranslationEngine.onError`, never set today — the queue wedges) is `failed`; one utterance that failed to transcribe is `degraded('transcription_failed')` and one job that failed to translate `degraded('translation_failed')` (Bing's error tags humanized as today), and the queue moves on. TTS init or one sentence failing stays `tts_degraded`; a supertonic voice missing stays `voice_fallback`.
8. **Speech**: one `audio` event per sentence with its exact UTF-16 range (`indexOf` on the displayed translation, from where the last sentence ended; no range when it misses). Edge TTS's chunks for one sentence are gathered into that one clip (karaoke sweeps a clip linearly; a range per chunk would re-sweep the sentence). The translation segment closes **after its last audio**, so L1's punctuation fill-in re-anchors every range it holds. Resampling to 24 kHz keeps today's linear interpolation (its aliasing is a roadmap item, not this plan's).
9. **Settings UI**: LocalInference's `Settings` holds its own controls — TTS speed, the translation prompt, the VAD knobs (hidden for streaming ASR models, as today) — reusing `LocalSettingsControls.tsx`; the turn-mode control is not a provider setting any more (the global turn mode; plan 1e-3 places it). Its `Engine` is today's model management — `EngineSurface` over a settings-driven engine adapter, `ModelManagementSection` and `StoragePage` — which gain optional `settings` / `update` props (their existing callers keep reading the old store); `ProviderPanel` renders a provider's `Engine` below its `Settings`.
10. **Registration**: LocalInference joins the registry's released providers, first in UI order. The preview keeps the fake unless it is asked for another provider (`&provider=localInference`), so every existing probe runs as before.

## File structure

| File | Task | Responsibility |
|---|---|---|
| `src/lib/contract/adapter.ts`, `src/lib/provider/types.ts`, `src/lib/session/shared.ts`, `run.ts`, `runner.ts`, `appShape.ts` | 1 | `StartRequest.punctuate`, `AdapterStartError`, `SharedSettings.reversed` / `.segmentation` |
| `src/lib/diagnostics/clientDiagnostics.ts`, `src/lib/view/noticeText.ts`, `src/locales/*/translation.json` | 1 | the new codes and their words |
| `src/lib/conversation/Conversation.ts`, `src/lib/contract/conformance.ts` | 2 | plan 1a's conformance items |
| `src/providers/localInference/settings.ts`, `check.ts` | 3 | `S`, languages, readiness |
| `src/providers/localInference/config.ts` | 4 | `C`, `build`, `describe`, `admit`, the local prompt |
| `src/lib/local-inference/engine/*.ts` (the `disposed` check only), `src/providers/localInference/engines.ts`, `adapter.ts` | 5 | the session: engines, loading, segments, jobs, errors, stop |
| `src/providers/localInference/speech.ts` | 6 | TTS per sentence, ranges, 24 kHz |
| `src/providers/localInference/adapter.ts` | 7 | turns, typed text, punctuated jobs |
| `src/providers/localInference/provider.ts`, `LocalInferenceSettings.tsx`, `LocalInferenceEngine.tsx`, `src/providers/registry.ts`, `src/components/providers/ProviderPanel.tsx`, the reused settings components | 8 | the definition, its components, registration |
| `src/components/dev/SpinePreview.tsx`, `scripts/dev/spine-local-probe.mjs` | 9 | LocalInference live in the preview, checked headlessly |

---

### Task 1: The shared layers' three additions, and the new words

**Files:**
- Modify: `src/lib/contract/adapter.ts`, `src/lib/provider/types.ts` (`SharedSettings`), `src/lib/session/shared.ts`, `src/lib/session/appShape.ts`, `src/lib/session/run.ts`, `src/lib/session/runner.ts`, `src/lib/diagnostics/clientDiagnostics.ts`, `src/lib/view/noticeText.ts`, the 30 `src/locales/<code>/translation.json`
- Test: `src/lib/session/shared.test.ts`, `src/lib/session/runner.test.ts`, `src/lib/view/noticeText.test.ts`

**Interfaces:**
- Produces:
  - `StartRequest.punctuate?: Punctuator` (the type from `src/lib/conversation/fillIn.ts`: `(lang, text) => Promise<string | null>`).
  - `export class AdapterStartError extends Error { constructor(message: string, readonly code: string, readonly params?: Record<string, string | number>) }` in `adapter.ts`.
  - `SharedSettings.reversed(direction): boolean` and `SharedSettings.segmentation: { mode: 'off' | 'pause' | 'sentences'; sentencesPerRow: number }`.
  - `CLIENT_DIAGNOSTICS` rows `transcription_failed`, `translation_failed`, `translation_unavailable` (all `warning`).
  - `NOTICE_WORDS` entries `no_asr`, `memory_exceeded`, `gpu_out_of_memory`, `transcription_failed`, `translation_failed`, `translation_unavailable`, with `notices.*` in every locale.

- [ ] **Step 1: Write the failing tests**

`src/lib/session/shared.test.ts` (with the file's existing fixture provider and instruction settings):

```ts
  it('says which direction is the participant's, and carries the display segmentation', () => {
    const shared = buildSharedSettings(fixture, settings, { source: 'en', target: 'ja' }, instructions, pauses, { mode: 'sentences', sentencesPerRow: 0 });
    expect(shared.reversed({ source: 'en', target: 'ja' })).toBe(false);
    expect(shared.reversed({ source: 'ja', target: 'en' })).toBe(true);
    expect(shared.segmentation).toEqual({ mode: 'sentences', sentencesPerRow: 0 });
  });
```

`src/lib/session/runner.test.ts`:

```ts
  it("hands the adapter the runner's punctuator", async () => {
    const punctuate = vi.fn(async () => null);
    let seen: unknown;
    const provider = { ...fakeProvider, start: async (request: { punctuate?: unknown }, events: unknown) => { seen = request.punctuate; return fakeProvider.start(request as never, events as never); } } as unknown as AnyProvider;
    const { runner } = setup({ punctuate, shape: { provider } });
    await runner.start();
    expect(seen).toBe(punctuate);
  });

  it("fails a start with the adapter's own code when it gives one", async () => {
    const provider = { ...fakeProvider, start: async () => { throw new AdapterStartError('out of GPU memory', 'gpu_out_of_memory'); } } as unknown as AnyProvider;
    const { runner } = setup({ shape: { provider } });
    await runner.start();
    expect(runner.state.getState()).toMatchObject({ phase: 'idle', lastEnd: { reason: 'start-failed', notice: { code: 'gpu_out_of_memory', message: 'out of GPU memory', leg: 'speaker' } } });
  });
```

`src/lib/view/noticeText.test.ts`:

```ts
  it('puts the local engines' notices into words', () => {
    for (const code of ['no_asr', 'memory_exceeded', 'gpu_out_of_memory', 'transcription_failed', 'translation_failed', 'translation_unavailable']) {
      expect(NOTICE_WORDS[code]).toBeDefined();
    }
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/session src/lib/view/noticeText.test.ts -t "participant's|punctuator|own code|local engines"`
Expected: FAIL.

- [ ] **Step 3: The additions**

`src/lib/contract/adapter.ts`: on `StartRequest`, `/** The runner's punctuation model, for an adapter that cuts its own translation jobs (LocalInference). Absent: none is installed. */ punctuate?: Punctuator;` (type import from `../conversation/fillIn`); and

```ts
/** A start that failed for a reason the user can be told in words: `code` is a notice code. */
export class AdapterStartError extends Error {
  constructor(message: string, readonly code: string, readonly params?: Record<string, string | number>) {
    super(message);
  }
}
```

`src/lib/provider/types.ts`, `SharedSettings`:

```ts
  /** This is the participant's direction: the pair's reverse. */
  reversed(direction: SessionContext['direction']): boolean;
  /** The display segmentation as stored: a provider that cuts its own jobs follows it (LocalInference). */
  segmentation: { mode: 'off' | 'pause' | 'sentences'; sentencesPerRow: number };
```

`src/lib/session/shared.ts`: `buildSharedSettings(p, s, pair, instructions, pauses, segmentation)` returns `reversed: (d) => d.source === pair.target && d.target === pair.source` and `segmentation`; `appShape.ts` passes `{ mode: st.segmentationMode, sentencesPerRow: st.sentenceSegmentationChunkSentences }` (check the settings store's field names). Every other caller of `buildSharedSettings` (tests, the fake's) gains the argument.

`src/lib/session/run.ts`: each leg's `StartRequest` carries `punctuate: deps.punctuate`. `src/lib/session/runner.ts`, `start()`'s catch: the notice's code is `failure.code` (and its `params`) when the error — or a `LegOpenError`'s `failure` — is an `AdapterStartError`, else `start_failed` as today.

`src/lib/diagnostics/clientDiagnostics.ts`: three rows, each with its doc comment — `transcription_failed` ("One utterance could not be transcribed; the session continues."), `translation_failed` ("One translation failed; the session continues."), `translation_unavailable` ("This direction has no translation model: its speech is transcribed only.").

`src/lib/view/noticeText.ts`, `NOTICE_WORDS`, under `// Local engines (LocalInference).`:

```ts
  no_asr: 'No speech recognition model is installed for {{source}}.',
  memory_exceeded: "These models together need more memory than this device has.",
  gpu_out_of_memory: '<the English of errors.gpuOutOfMemory in src/locales/en/translation.json, word for word>',
  transcription_failed: 'Some speech could not be transcribed: {{detail}}',
  translation_failed: 'A translation failed: {{detail}}',
  translation_unavailable: 'No translation model for this direction: its speech is transcribed only.',
```

Add the six under `notices` in all 30 locales: `gpu_out_of_memory` copies each locale's own `errors.gpuOutOfMemory` value; the other five are translated, keeping `{{source}}` / `{{detail}}`, following each locale's existing `notices.*` style. Insert lines; never re-serialize a file.

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/lib src/locales src/providers` — PASS. Then the full suite and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/lib src/locales src/providers
git commit -m "feat(session): a punctuator for the adapter, the participant's direction, start codes; local engines' words"
```

---

### Task 2: Conformance on a real adapter (plan 1a's items)

**Files:**
- Modify: `src/lib/conversation/Conversation.ts`, `src/lib/contract/conformance.ts`
- Test: `src/lib/conversation/Conversation.test.ts`, `src/lib/contract/conformance.test.ts`

**Interfaces:**
- Produces: no new names. L1 keeps an audio range that lies beyond the segment's text at arrival and checks it against the text when the segment closes (and on later revisions); the checker flags a close for a never-opened ref, audio on a source-side ref, a frame `type` not shaped `domain.event`, and a string credential value `redact()` would change; L1's pcm trim no longer rescans from segment 0.

Why now: LocalInference's audio can arrive while its text is still a snapshot (Edge TTS, rulings 8), and its re-decodes rewrite text often — these are the "1e — LocalInference (conformance on a real adapter)" items of the roadmap's "Carried out of plan 1a".

- [ ] **Step 1: Write the failing tests**

`src/lib/conversation/Conversation.test.ts` (with the file's own helpers):

```ts
  it('keeps a range that overtakes its text, and checks it when the segment closes', () => {
    const c = conversation();
    c.apply(opened(1, 'translation'));
    c.apply(text(1, 'Hello'));
    c.apply(audio(1, [0, 12], pcmOf(2400)));        // "Hello there." has not arrived yet
    c.apply(text(1, 'Hello there.'));
    c.apply(closed(1));
    expect(c.snapshot().segments[0].speech[0].range).toEqual([0, 12]);
  });

  it('drops a range still outside the text once the segment closes', () => {
    const c = conversation();
    c.apply(opened(1, 'translation'));
    c.apply(text(1, 'Hi.'));
    c.apply(audio(1, [0, 40], pcmOf(2400)));
    c.apply(closed(1));
    expect(c.snapshot().segments[0].speech[0].range).toBeUndefined();
  });

  it('trims retained pcm from where it last stopped, not from the first segment', () => {
    // A conversation over its pcm ceiling: many segments, each chunk trims the oldest pcm once.
    const c = conversation({ retention: { keepPcm: true, maxPcmBytes: 4_800 * 2 } });
    for (let i = 1; i <= 50; i++) {
      c.apply(opened(i, 'translation'));
      c.apply(text(i, 'x'));
      c.apply(audio(i, undefined, pcmOf(2_400)));
    }
    const kept = c.snapshot().segments.flatMap((s) => s.speech).filter((s) => s.pcm.length > 0);
    expect(kept).toHaveLength(2);
  });
```

(The third test pins behaviour that already holds; the change it guards is internal — a trim cursor reset by `clear()`. Keep it passing, and add a cursor.)

`src/lib/contract/conformance.test.ts` (with the file's own event helpers):

```ts
  it('flags a close for a ref that never opened, audio on a source segment, a frame type not shaped domain.event, and a credential value in a frame', () => {
    expect(violations([closed(9)])).toContain('close-unopened');
    expect(violations([opened(1, 'source'), audio(1, undefined, pcm())])).toContain('audio-on-source');
    expect(violations([frame('in', 'message')])).toContain('frame-type');
    expect(violations([frame('out', 'local.init', { url: 'https://x/?key=AIzaSyA-FAKE-KEY-0123456789abcdefghij' })])).toContain('frame-secret');
  });
```

(Use the rule names the checker already uses where one exists; add these four as new rule names, and update the test's names if the file's convention differs.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/conversation src/lib/contract`
Expected: the first, second and fourth tests FAIL.

- [ ] **Step 3: The changes**

`Conversation.ts`: an `audio` whose range lies beyond the text at arrival keeps the range as given (still dropped when it is not a valid `[start, end]` with `start <= end`); when the segment closes — and on each later `segmentText` revision — every kept range is checked against the current text and dropped (range only; the pcm stays) when it lies outside. The fill-in re-anchoring of ranges (`Conversation.ts` around `:249-252`) runs over the same kept ranges. `afterAudio`'s trim keeps a cursor (the index of the oldest segment that may still hold pcm), advanced as it empties segments, reset in `clear()`.

`conformance.ts`: the same close-time range check (replacing the arrival check); rules `close-unopened`, `audio-on-source`, `frame-type` (`/^[a-z0-9_]+(\.[a-z0-9_]+)+$/`), and `frame-secret` — any string value anywhere in a frame payload for which `redact(value) !== value` (import `redact` from `../diagnostics/redact`, the one leaf module the checker adds).

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/lib/conversation src/lib/contract src/providers/fake` — PASS (the fake's conformance suite included: its frames are `fake.*`). Then the full suite and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/lib/conversation src/lib/contract
git commit -m "feat(contract): ranges checked at close; four more conformance rules; a pcm trim cursor"
```

---

### Task 3: LocalInference's settings, languages and readiness

**Files:**
- Create: `src/providers/localInference/settings.ts`, `src/providers/localInference/check.ts`, `src/providers/localInference/check.test.ts`

**Interfaces:**
- Consumes: `useModelStore` (`src/stores/modelStore.ts`: `initialize()`, `resolve(source, target, selections)`), `guardAstCrossStage` (`src/services/providers/astGuard.ts` — read-only import of a pure function; if it imports anything from `src/services` beyond pure helpers, copy the function into `src/providers/localInference/astGuard.ts` instead and say so), `getTranslationSourceLanguages` / `getTranslationTargetLanguages` (`src/lib/local-inference/modelManifest.ts`).
- Produces:

```ts
export interface LocalInferenceSettings {
  selections: Selections;          // the model-store type, per direction and stage
  ttsSpeakerId: number;
  ttsSpeed: number;
  edgeTtsVoice: string;
  vadThreshold: number;
  vadNegativeThreshold: number;
  vadMinSilenceDuration: number;
  vadMinSpeechDuration: number;
  vadMaxSpeechDuration: number;
  useTemplateMode: boolean;
  systemPrompt: string;
  participantSystemPrompt: string;
}
export const LOCAL_INFERENCE_DEFAULTS: LocalInferenceSettings;   // today's defaults, minus the pair and the turn mode
export const localInferenceLanguages: Provider['languages'];     // sources, targets, initial ja → en; never AUTO
export function checkLocalInference(s: LocalInferenceSettings, ctx: CheckContext): Promise<CheckResult>;
```

`S` persists at `settings.localInference.<field>` — today's keys, so a user's choices carry over with no `migrate`; the pair was already stored at `settings.localInference.sourceLanguage` / `.targetLanguage`, the keys the provider store reads for it. `turnDetectionMode` leaves `S` (the global turn mode; its one-time migration is plan 1e-3's).

- [ ] **Step 1: Write the failing tests**

`src/providers/localInference/check.test.ts` — mock `../../stores/modelStore` so `resolve(source, target, selections)` answers from a table, and `initialize()` resolves:

```ts
  it('is ready when the speaker direction has ASR and translation, whatever TTS', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't', tts: null } });
    expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] })).toEqual({ ok: true });
  });

  it('names what the speaker direction lacks', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: null } });
    expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] })).toMatchObject({ ok: false });
  });

  it('asks the participant direction only when the participant leg runs alone', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' }, 'en>ja': { asr: null, translation: null } });
    expect((await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'] })).ok).toBe(true);
    expect((await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['participant'] })).ok).toBe(false);
  });

  it('writes nothing', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' } });
    await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] });
    expect(modelStoreWrites()).toEqual([]);
  });
```

Plus, in `settings.test.ts` beside it: the languages never offer AUTO as a source, every source has a target, and `initial` is `{ source: 'ja', target: 'en' }`. (`resolved`, `defaults`, `modelStoreWrites` are this file's helpers over the mock; match `resolve`'s real return shape, which you read first.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/providers/localInference`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Settings, languages, check**

`settings.ts`: the interface and `LOCAL_INFERENCE_DEFAULTS` from today's `defaultLocalInferenceSettings` (`src/services/providers/LocalInferenceProviderConfig.ts`) without `sourceLanguage`, `targetLanguage`, `turnDetectionMode`; `localInferenceLanguages = { sources: () => getTranslationSourceLanguages(), targets: (source) => getTranslationTargetLanguages(source), initial: () => ({ source: 'ja', target: 'en' }) }` — mapped to the provider layer's `LanguageOption` shape if those functions return another.

`check.ts`: today's `ensureSelectionReady` (`src/stores/modelStore.ts`, ~`436-526`), without its store reads and writes — `await useModelStore.getState().initialize()` if not yet (racing `ctx.signal`: reject with the abort reason when it fires); resolve the speaker direction `(pair.source, pair.target, s.selections)` and, if `legs` includes the participant, the reverse; apply the AST guard to each; the mandatory direction is the participant's when `legs` is exactly `['participant']`, else the speaker's; `ok` when that direction has ASR and translation (an AST model counts for both, as today). Not ready: `{ ok: false, reason }` with today's sentence (`settings.localInferenceModelsRequired`'s English: "Required models not available for selected language pair."). Never call `applyPrunes` or any setter.

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/providers/localInference src/stores/modelStore` — PASS. Then the full suite and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/providers/localInference
git commit -m "feat(local): LocalInference's settings, languages and a pair- and leg-aware readiness check"
```

---

### Task 4: `build`, `describe`, `admit`, and the local prompt

**Files:**
- Create: `src/providers/localInference/config.ts`, `src/providers/localInference/config.test.ts`

**Interfaces:**
- Consumes: Task 1's `SharedSettings.reversed` / `.segmentation`; Task 3's `LocalInferenceSettings`; `useModelStore.getState().resolve`, the AST guard, `buildDefaultLocalPrompt` (`src/lib/local-inference/prompts.ts`), `getManifestEntry` / `estimateModelMemoryByDevice` (`modelManifest.ts`).
- Produces:

```ts
export interface LocalInferenceConfig {
  asr: { modelId: string; streaming: boolean };
  vad: { threshold: number; negativeThreshold?: number; minSilenceDuration: number; minSpeechDuration: number; maxSpeechDuration: number };
  translation:
    | { kind: 'engine'; modelId: string; instructions: string; wrapTranscript: boolean }
    | { kind: 'ast' }
    | { kind: 'none' };
  tts?: { modelId: string; speakerId: number; speed: number; edgeVoice?: string };
  /** Punctuate the job text before translating (today's Auto shape); the stream shape is plan 1e-2b's. */
  punctuateJobs: boolean;
}
export function buildLocalInference(context: SessionContext, s: LocalInferenceSettings, shared: SharedSettings): LocalInferenceConfig | ProviderRefusal;
export function describeLocalInference(c: LocalInferenceConfig): { asrModel?: string; translationModel?: string; ttsModel?: string };
export function admitLocalInference(configs: Partial<Record<LegName, LocalInferenceConfig>>): true | ProviderRefusal;
```

- [ ] **Step 1: Write the failing tests**

`src/providers/localInference/config.test.ts` (mock the model store's `resolve` as in Task 3; a `shared` stand-in with `reversed` and `segmentation`):

```ts
  it("builds the speaker's direction with its own prompt, TTS when speaking, and punctuated jobs under Auto sentences", () => {
    resolved({ 'ja>en': { asr: 'sherpa-ja', translation: 'opus-ja-en', tts: 'piper-en' } });
    const c = buildLocalInference(ctx({ source: 'ja', target: 'en' }, { speech: true }), settings({ useTemplateMode: true }), shared({ segmentation: { mode: 'sentences', sentencesPerRow: 0 } }));
    expect(c).toMatchObject({
      asr: { modelId: 'sherpa-ja' },
      translation: { kind: 'engine', modelId: 'opus-ja-en', wrapTranscript: true },
      tts: { modelId: 'piper-en' },
      punctuateJobs: true,
    });
    expect((c as LocalInferenceConfig).translation).toMatchObject({ instructions: buildDefaultLocalPrompt('ja', 'en') });
  });

  it('uses the participant prompt for the reversed direction, and no TTS when not speaking', () => {
    resolved({ 'en>ja': { asr: 'a', translation: 't', tts: 'x' } });
    const c = buildLocalInference(ctx({ source: 'en', target: 'ja' }, { speech: false }), settings({ useTemplateMode: false, systemPrompt: 'MINE', participantSystemPrompt: 'THEIRS' }), shared({ reversed: true }));
    expect(c).toMatchObject({ translation: { instructions: 'THEIRS', wrapTranscript: false } });
    expect(c).not.toHaveProperty('tts');
  });

  it('refuses a direction without ASR, and runs one without translation transcription-only', () => {
    resolved({ 'ja>en': { asr: null, translation: 't' }, 'en>ja': { asr: 'a', translation: null } });
    expect(buildLocalInference(ctx({ source: 'ja', target: 'en' }), settings(), shared())).toMatchObject({ code: 'no_asr', params: { source: 'ja' } });
    expect(buildLocalInference(ctx({ source: 'en', target: 'ja' }), settings(), shared({ reversed: true }))).toMatchObject({ translation: { kind: 'none' } });
  });

  it('describes the models a run used, and admits only what fits the memory budget', () => {
    const c = cfg({ asr: 'a', translation: 't', tts: 'x' });
    expect(describeLocalInference(c)).toEqual({ asrModel: 'a', translationModel: 't', ttsModel: 'x' });
    budget(1_000);
    sizes({ a: 400, t: 300, x: 200 });
    expect(admitLocalInference({ speaker: c })).toBe(true);
    expect(admitLocalInference({ speaker: c, participant: c })).toMatchObject({ code: 'memory_exceeded' });
  });
```

(`ctx`, `settings`, `shared`, `cfg`, `budget`, `sizes`, `resolved` are this file's helpers over the mocks; `budget` / `sizes` stub the memory estimate the way today's `localParticipantConfig.ts` reads it — `debug:device-memory` / `navigator.deviceMemory` and `estimateModelMemoryByDevice`.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/providers/localInference/config.test.ts`
Expected: FAIL.

- [ ] **Step 3: The builder**

`buildLocalInference`: resolve `(context.direction.source, context.direction.target, s.selections)` and apply the AST guard (today's `buildSessionConfig` / `createParticipantLocalInferenceConfig`); no ASR → `{ refused: 'No speech recognition model for <source>.', code: 'no_asr', params: { source } }`. AST when the resolved ASR is granite and its translation id equals the ASR id (today's inference, `LocalInferenceClient.ts` ~`406-408`) → `{ kind: 'ast' }`; no translation → `{ kind: 'none' }`; else `{ kind: 'engine', modelId, instructions, wrapTranscript }` where `instructions` follows today's `getProcessedLocalPrompt` (`src/stores/settingsStore.ts` ~`1461-1479`) from `s` — template mode: `buildDefaultLocalPrompt(source, target)`; otherwise `shared.reversed(direction) ? (s.participantSystemPrompt.trim() || s.systemPrompt) : s.systemPrompt`, blank falling back to the default — and `wrapTranscript` is whether `instructions` equals either direction's default prompt (today's rule). `asr.streaming` from the manifest (`type === 'asr-stream'`). `tts` only when `context.speech` and a TTS model resolved: `{ modelId, speakerId: s.ttsSpeakerId, speed: s.ttsSpeed, edgeVoice: s.edgeTtsVoice || undefined }`. `vad` from the five fields (`negativeThreshold` omitted when 0). `punctuateJobs = shared.segmentation.mode === 'sentences'` (ruling 1).

`describeLocalInference`: the three ids (AST: `translationModel` is the ASR id).

`admitLocalInference`: today's budget (`localParticipantConfig.ts` ~`96-124`) over exactly the configs given — every leg's ASR, translation engine and TTS, counted per leg; over → `{ refused: 'The models need more memory than this device has.', code: 'memory_exceeded' }`.

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/providers/localInference` — PASS. Then the full suite and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/providers/localInference
git commit -m "feat(local): build, describe and admit for LocalInference, with its own prompt"
```

---
### Task 5: The adapter: engines, loading, segments, the job queue, errors, stop

**Files:**
- Modify: `src/lib/local-inference/engine/AsrEngine.ts`, `StreamingAsrEngine.ts`, `TranslationEngine.ts`, `TtsEngine.ts` (the `disposed` check only — ruling 6)
- Create: `src/providers/localInference/engines.ts`, `src/providers/localInference/adapter.ts`, `src/providers/localInference/adapter.test.ts`, `src/providers/localInference/fakeEngines.ts` (test support)

**Interfaces:**
- Consumes: `LocalInferenceConfig` (Task 4); the engine classes' public API (read each file in full first: `init`, `feedAudio`, `flush`, `translate`, `generate`, `generateStream`, `dispose`, the `on*` callbacks).
- Produces:

```ts
/** What the adapter drives: today's engine classes by default, fakes in tests. */
export interface LocalEngines {
  asr(config: LocalInferenceConfig['asr']): AsrLike;             // AsrEngine or StreamingAsrEngine behind one shape
  translation(): TranslationLike;
  tts(): TtsLike;
}
export const defaultEngines: LocalEngines;
export function createLocalInferenceAdapter(engines?: LocalEngines): Adapter<LocalInferenceConfig, LocalCredentials>;
```

(`AsrLike`, `TranslationLike`, `TtsLike` are the narrow interfaces the adapter uses, each implemented by the real class unchanged — declare them in `engines.ts` from the classes' actual signatures; `LocalCredentials = Record<string, never>`.)

The session's behaviour (rulings 5–7; `1e2-pipeline.md` §2 is the event map):

- **start**: create the engines the config needs (ASR always; translation only for `kind: 'engine'`; TTS only when `config.tts`), `init` them in parallel (ASR with its VAD config, the source language hint and, for AST, `{ task: 'translate', targetLanguage }`; translation `(source, target, modelId)`; TTS `(modelId, speakerId, …)` as today's client does), emitting `loading({ stage: 'asr' | 'translation' | 'tts', done, total })` as each settles (`total` = engines started). ASR or translation init failing rejects the start (dispose everything first): a GPU out-of-memory message (today's detection, `LocalInferenceClient.ts` ~`40-61`) as `AdapterStartError('…', 'gpu_out_of_memory')`, anything else as an ordinary error. TTS init failing is `degraded('tts_degraded')` and the session runs without speech. A supertonic speaker id missing from the model is `voice_fallback` (today's check). Transcription-only (`kind: 'none'`) emits `degraded('translation_unavailable')` once, after the start resolves.
- **the signal**: aborted before or during start → dispose every engine created, reject with the abort reason; any `init()` that resolves later disposes its engine (ruling 6).
- **appendAudio(pcm)**: copy it (`pcm.slice()` — the engines transfer their buffer, and the runner hands the same array to others) and `feedAudio(copy, 24000)`.
- **ASR**: open a source segment on the first non-empty partial (never on `speech_start`), `segmentText` with each changed trimmed partial, and on the final: `segmentText` the final, `segmentClosed`, and queue a job `{ text, origin }` (one fresh `origin` per utterance, stated on the open and close of both of its segments — the fake's convention). An offline engine with no partial opens at the final. An empty final is dropped (and a segment opened for it is closed with its last text). AST: no source segment — the final is the translation (the job's translation segment carries it).
- **the job queue** (serial): translate (`instructions`, `wrapTranscript`) — or take the AST text, or for `kind: 'none'` nothing — then open the translation segment with the job's `origin`, set its text, speak it (Task 6; until then close at once), close it. An empty translation opens nothing. A translation that rejects → `degraded('translation_failed', humanized message)` (today's `humanizeTranslationError`) and the next job.
- **errors**: an ASR engine's error after it was ready → `degraded('transcription_failed')` unless it came from the worker dying (`WorkerSession`'s fatal path — route it separately in `engines.ts`), which is `failed`; `TranslationEngine.onError` (a fatal error without a request id) → `failed`; a lost WebGPU device → `failed`. After `failed` the session emits nothing more.
- **stop()**: set `ended` first, dispose every engine (synchronous — each ends in `worker.terminate()`), drop the queue, return a resolved promise — all before any `await`; emit nothing, ever again (`closed` included).
- **frames**: today's `local.*` events (`emitEvent`) as `frame({ direction, type, payload })`, every string in a payload cut below 2048 characters.
- **info**: `{ transport: 'local' }`.

- [ ] **Step 1: The engines' `disposed` check (ruling 6)**

In each of the four engine classes: a `private disposed = false;` set in `dispose()`, and after every `await` inside `init()` before `new WorkerSession(…)`: `if (this.disposed) throw new Error('disposed');`. Test in each engine's test file (or one new `engineDispose.test.ts`): `dispose()` during an `init()` still awaiting its model files rejects that `init()` and creates no worker.

- [ ] **Step 2: Write the failing adapter tests**

`src/providers/localInference/fakeEngines.ts`: fakes implementing `AsrLike` / `TranslationLike` / `TtsLike`, driven by the test (`asr.partial(text)`, `asr.final(text)`, `asr.fail(message)`, `asr.die()`; `translation.answer(text)` / `.reject(error)`; controllable `init` promises; counters for `dispose`, `feedAudio`, `flush`).

`src/providers/localInference/adapter.test.ts` — at least these, each against the conformance checker too (`src/lib/contract/conformance.ts`, as the fake adapter's tests use it):

1. A streaming utterance: partials → one source segment growing, the final closes it; the job's translation segment opens with the same `origin`, carries the translation, closes; refs distinct.
2. An offline engine (no partials): the source segment opens and closes at the final.
3. Loading: three engines → three `loading` events, `total: 3`, `done` 1..3; no TTS configured → `total: 2`.
4. The signal aborted while `init`s are pending: the start rejects at once, every created engine is disposed, and an `init` resolving afterwards is disposed too.
5. ASR init failing with an out-of-memory message → the start rejects with an `AdapterStartError` whose `code` is `gpu_out_of_memory`.
6. `stop()`: every engine disposed synchronously (before the returned promise is awaited), and a late ASR final or translation answer emits nothing.
7. A translation rejecting → `degraded('translation_failed')`, and the next utterance is still translated.
8. The ASR worker dying → `failed`, then nothing; an ordinary ASR error → `degraded('transcription_failed')` and the session continues.
9. AST: a final becomes a translation segment with no source segment; transcription-only: source segments only, and `translation_unavailable` once.
10. `appendAudio` hands the engine a copy: the array passed in is still readable afterwards.

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/providers/localInference/adapter.test.ts`
Expected: FAIL — the adapter does not exist.

- [ ] **Step 4: The adapter**

Write `engines.ts` (the narrow interfaces and `defaultEngines` over the real classes, choosing `StreamingAsrEngine` when `config.asr.streaming`) and `adapter.ts` per the behaviour above. Keep the adapter a small state machine: `nextRef`, the open source segment of the current utterance, the job queue and a `processing` flag, `ended`. Leave speech (TTS) as a hook the next task fills: `speak(job, translationRef, text): Promise<void>` resolving at once for now.

- [ ] **Step 5: Run the tests, then the gates**

Run: `npx vitest run src/providers/localInference src/lib/local-inference` — PASS. Then the full suite and the typecheck gate.

- [ ] **Step 6: Commit**

```bash
git add src/lib/local-inference/engine src/providers/localInference
git commit -m "feat(local): the LocalInference adapter over today's engines"
```

---

### Task 6: Speech: a clip per sentence, exact ranges, 24 kHz

**Files:**
- Create: `src/providers/localInference/speech.ts`, `src/providers/localInference/speech.test.ts`
- Modify: `src/providers/localInference/adapter.ts` (the `speak` hook), `adapter.test.ts`

**Interfaces:**
- Consumes: `splitSentences` (`src/utils/splitSentences.ts`), `resampleFloat32` / `float32ToInt16` (`src/utils/audio-conversion.ts`), `TtsLike` (Task 5).
- Produces: `speakTranslation(tts, text, lang, config, emit, isEnded): Promise<void>` — for each sentence of `splitSentences(text, lang)`: its range `[pos, pos + sentence.length]` from `text.indexOf(sentence, from)` (no range when it misses), then either `generate` (one clip) or, for Edge TTS (`config.edgeVoice` set and the model an Edge one, as today's client tells them apart), `generateStream` with every chunk gathered into one clip; resample to 24 kHz, Int16, `emit({ pcm, range })`; a sentence that throws → `degraded('tts_degraded')` and the next sentence; stop between sentences once `isEnded()`.

The adapter's `speak` calls it when the session has TTS and `context.speech`, and **closes the translation segment after it resolves** (ruling 8); without TTS it closes at once.

- [ ] **Step 1: Write the failing tests**

`speech.test.ts` (a fake `TtsLike` returning Float32 at 44 100 Hz; a recording `emit`):

```ts
  it('speaks each sentence as one clip with its exact range, resampled to 24 kHz', async () => {
    const clips = await speakAll('Hello there. How are you?', { rate: 44_100, samplesPerSentence: 44_100 });
    expect(clips.map((c) => c.range)).toEqual([[0, 12], [13, 25]]);
    expect(clips[0].pcm).toBeInstanceOf(Int16Array);
    expect(clips[0].pcm.length).toBe(24_000);
  });

  it("gathers an Edge sentence's chunks into one clip", async () => {
    const clips = await speakAll('One. Two.', { edge: true, chunksPerSentence: 3, rate: 24_000, samplesPerChunk: 1_000 });
    expect(clips).toHaveLength(2);
    expect(clips[0].pcm.length).toBe(3_000);
  });

  it('skips a sentence that fails to synthesize, reporting it', async () => {
    const { clips, degraded } = await speakAllWith('One. Two.', { failSentence: 0 });
    expect(clips.map((c) => c.range)).toEqual([[5, 9]]);
    expect(degraded).toEqual(['tts_degraded']);
  });
```

`adapter.test.ts`: with TTS configured and `context.speech` true, the translation segment's `audio` events arrive before its `segmentClosed`, each with its range; with `context.speech` false, no `audio` at all (the conformance rule).

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/providers/localInference -t "sentence|Edge|synthesize|audio"`
Expected: FAIL.

- [ ] **Step 3: Speech**

Write `speech.ts` per the interface; wire it into the adapter's `speak`.

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/providers/localInference` — PASS. Then the full suite and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/providers/localInference
git commit -m "feat(local): LocalInference speaks each sentence as one clip with its range"
```

---

### Task 7: Turns, typed text, punctuated jobs

**Files:**
- Modify: `src/providers/localInference/adapter.ts`, `adapter.test.ts`

**Interfaces:**
- Consumes: `StartRequest.punctuate` (Task 1), `LocalInferenceConfig.punctuateJobs` (Task 4).

- **endTurn / cancelTurn** (ruling 5): feed seven fresh `Int16Array(2400)` silences at 24 kHz, then `flush()`. **beginTurn**: nothing.
- **appendText(text)**: a source segment opened, set to exactly `text`, closed; then a job as for an utterance (`kind: 'engine'`); in an AST or transcription-only session the source segment only, and `translation_unavailable` once per session (shared with Task 5's start notice: never twice).
- **Punctuated jobs**: when `config.punctuateJobs` and `request.punctuate` is present, a job's text is `fillIn(source, text, punctuate)` (`src/lib/conversation/fillIn.ts` — it leaves text that already ends a sentence untouched and discards an answer that alters letters or digits), raced against a 1 s budget on `request.clock` (the raw text on timeout). The source segment's display text is untouched — L1 punctuates it for display.

- [ ] **Step 1: Write the failing tests**

In `adapter.test.ts`:

1. `endTurn()` feeds seven 2 400-sample silences then one flush; `cancelTurn()` the same; `beginTurn()` feeds nothing.
2. `appendText('  hi  ')`: a source segment whose text is exactly `'  hi  '`, then its translation (conformance `text-input-answered` passes).
3. AST session: `appendText` gives a source segment and `translation_unavailable` once, however often it is called.
4. Punctuated jobs: with `punctuateJobs` and a punctuator answering `'hello there.'` for `'hello there'`, the translation engine receives `'hello there.'`; without a punctuator, `'hello there'`; with a punctuator that never answers, the raw text after 1 s of the virtual clock.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/providers/localInference/adapter.test.ts -t "turn|appendText|AST session|punctuat"`
Expected: FAIL.

- [ ] **Step 3: Implement**

As above.

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/providers/localInference` — PASS. Then the full suite and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/providers/localInference
git commit -m "feat(local): LocalInference's turns, typed text and punctuated jobs"
```

---

### Task 8: The definition, its components, and registration

**Files:**
- Create: `src/providers/localInference/provider.ts`, `provider.test.ts`, `LocalInferenceSettings.tsx`, `LocalInferenceEngine.tsx`, `LocalInferenceSettings.test.tsx`
- Modify: `src/providers/registry.ts`, `src/components/providers/ProviderPanel.tsx` (+ its test), and — optional props only — `src/components/Settings/engine/useWasmEngineAdapter.ts`, `src/components/Settings/sections/ModelManagementSection.tsx`, `src/components/Settings/engine/StoragePage.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: `localInferenceProvider: Provider<LocalInferenceSettings, LocalCredentials, LocalInferenceConfig>` with `id: 'localInference'`, `kind: 'local'`, `platforms: ['electron', 'extension', 'web']`, an icon (today's LocalInference icon in the provider picker), `settings: { key: 'localInference', defaults: LOCAL_INFERENCE_DEFAULTS }`, `Settings: LocalInferenceSettings`, `Engine: LocalInferenceEngine`, `credentials: { keys: [], fields: () => [], read: () => ({}) }`, `check: (_k, s, ctx) => checkLocalInference(s, ctx)`, `languages: localInferenceLanguages`, `speech: 'optional'`, `textInput: true`, `boundaries: () => 'provider'`, `turns: () => ['auto', 'manual']`, `build`, `describe`, `start` (the adapter's), `session: { admit: admitLocalInference }`.

- **`LocalInferenceSettings`** (ruling 9): TTS speed (`TtsSpeedControl`), the translation prompt (`TranslationPromptControl` over `useTemplateMode` / `systemPrompt` / `participantSystemPrompt`), the VAD knobs (`VadControl`, hidden when the speaker direction's resolved ASR is a streaming model or has no worker type — today's rule), all from `LocalSettingsControls.tsx`, driven by `settings` / `update` / `disabled`. No turn-mode control.
- **`LocalInferenceEngine`**: today's model management as Simple mode opens it (`SimpleSettings.tsx`'s `EngineSurface` + `useWasmEngineAdapter` + `ModelManagementSection` + `StoragePage`), fed from `settings` / `update` instead of the store. Give `useWasmEngineAdapter`, `ModelManagementSection` and `StoragePage` optional `settings` / `update` props (and whatever else they read from `settingsStore` for LocalInference — the pair: pass it from the provider store's entry via a prop, since `Engine` receives only `SettingsProps`; if the pair is needed, add `pair?` to `SettingsProps` and have `ProviderPanel` pass it), falling back to today's hooks when absent, so every existing caller is unchanged. `StoragePage`'s LocalNative half keeps reading its old store (plan 1e-3 splits it).
- **`ProviderPanel`** renders `p.Engine`, when present, below `p.Settings`, with the same props.
- **Registry**: `RELEASED = [localInferenceProvider]`. The registry's invariant tests must pass (every source has a target; no AUTO; unique keys; credential keys apart from settings fields and the pair).

- [ ] **Step 1: Write the failing tests**

`provider.test.ts`: the definition's capabilities; `build` / `describe` delegate (one case each); `check` answers from `checkLocalInference`; the registry now lists `localInference` first and passes its invariants (run `src/providers/registry.test.ts`).

`LocalInferenceSettings.test.tsx`: renders the speed, prompt and VAD controls; changing the speed calls `update({ ttsSpeed })`; `disabled` disables them; the VAD knobs are hidden for a streaming ASR (mock the model store's `resolve`).

`ProviderPanel.test.tsx`: a provider with an `Engine` renders it below `Settings`, with the same settings.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/providers src/components/providers`
Expected: FAIL.

- [ ] **Step 3: Implement**

As above.

- [ ] **Step 4: Run the tests, then the gates**

Run: `npx vitest run src/providers src/components/providers src/components/Settings` — PASS (every existing Settings test unchanged). Then the full suite and the typecheck gate.

- [ ] **Step 5: Commit**

```bash
git add src/providers src/components/providers src/components/Settings
git commit -m "feat(local): the LocalInference definition, its settings and model management, registered"
```

---

### Task 9: LocalInference live in the preview, checked headlessly

**Files:**
- Modify: `src/components/dev/SpinePreview.tsx`
- Create: `scripts/dev/spine-local-probe.mjs`

**Interfaces:**
- Consumes: the registered provider (Task 8); the preview's `&capture=device` (plan 1c-3).
- Produces: preview parameters `&provider=<id>` (select that provider on load; default: keep the fake selected — ruling 10) and `&models=<id>,<id>…` (download those models through the model store on load, for the probe); the probe.

- [ ] **Step 1: The preview**

In `SpinePreview`: on load, select `&provider=` if given, else the fake (when nothing is selected yet, or when the selection is LocalInference and no `&provider=` asks for it — the existing probes must keep running on the fake). `&models=`: `useModelStore.getState()`'s download call for each id not yet downloaded, awaited before autostart. Everything else unchanged.

- [ ] **Step 2: The probe**

`scripts/dev/spine-local-probe.mjs`, following `spine-audio-probe.mjs`: launch headless Chromium with a persistent profile directory under the job's temp dir (so models download once) and `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>` (the repo's `benchmark/test-speech-silence-speech.wav`; convert or resample it if Chromium needs another format — check the flag's requirements); open `?preview=spine&provider=localInference&capture=device&autostart=1&models=<asr>,<translation>` with the **smallest** CPU-capable (wasm) English ASR and English→Japanese translation models in `modelManifest.ts` (name them in the probe's header and say why), and set the pair to English → Japanese before the start (a `&pair=en:ja` parameter the preview applies through the provider store, if the probe cannot set it otherwise). Wait for the downloads, the start, and speech; pass when the conversation list draws at least one source row with text and at least one translation row with text; print the rows. Exit 1 otherwise, with the preview's last `lastEnd` if the start failed.

- [ ] **Step 3: Run it**

```
SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort    # background; restart it if the page does not show your edits
node scripts/dev/spine-local-probe.mjs
```

If a model download or the WASM runtime cannot work in headless Chromium on this machine for an environmental reason (no network, a missing CPU feature), report it with the exact error rather than weakening the probe; the unit tests stand, and the live check moves to jiangzhuo's hands. Then run the four existing probes (`spine-surface-probe.mjs`, `spine-subtitle-probe.mjs`, `spine-audio-probe.mjs`, `spine-export-probe.mjs http://localhost:5199`) — each must still pass on the fake. Stop the dev server you started (it is your own process).

- [ ] **Step 4: The gates**

`npx vitest run src` (0 failed) and the typecheck gate (11 lines).

- [ ] **Step 5: Commit**

```bash
git add src/components/dev scripts/dev/spine-local-probe.mjs
git commit -m "test(dev): a live LocalInference session in the preview, checked headlessly"
```
