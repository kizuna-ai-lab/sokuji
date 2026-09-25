# Client contract — Stage 1e-3a: the composition root

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One app module that composes the new session layer the way the app will run it — one runner, its conversation view, karaoke and subtitle session, the app's punctuator with today's diagnostics, the app's capture, the ports that log, count, report and save, and the page's wiring — proven in the development preview, while the running app does not change. Plan 1e-3b switches MainPanel, the Electron takeover and Settings onto this root; 1e-4 the extension; 1e-3c deletes the old path.

**Architecture:** A new directory `src/app/`. `session.ts` is the root: `createAppSession(options)` builds everything lazily behind one object, `getAppSession()` holds the page's one, `configureAppSession()` lets the preview swap in its fake source before it is built. `useAppSession.ts` is its React side (`useRunState`, `useRunPhase`, `useAppSessionBridges`). Four small modules feed it: `punctuation.ts` (today's `useSegmentationRuntime` outside React, plus a `(language, text)` memo), `telemetry.ts` (frames into the Logs panel, one run's segmentation tallies, the start/end properties the app keeps), `readiness.ts` (a local provider checks itself), `busy.ts` (Electron's busy flag). `loadStores.ts` loads what a run reads; `Home.tsx` calls it — the only line the running app gains. Around the root, the shared layers learn what it needs: readiness and source failures carry a notice code, four new notices have words, the subtitle session knows a missing microphone, `readRouting` knows push-to-translate, and the stored settings get their mapping as pure functions (applied by 1e-3b). The preview drops its module-level runner and becomes the root's first user, so the existing headless probes prove the composition.

**Tech Stack:** TypeScript (strict), React 18, zustand, i18next, Vitest + @testing-library/react, Vite, headless Chromium over the DevTools protocol.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — "Capture belongs to the runner", "Stopping, and closing the window", "State", "What may change during a run", "Sources, in full", "Notices reach the user localized", "Analytics", "Persisted settings that move", "Migration". The roadmap's 1e-3 items (`docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md`: "Scheduled by plan 1e-1 / 1e-2 / 1e-2b", "Decided for 1e") and the sixteen **1e-3 rulings** (2026-09-25; copied into this plan's workspace as `1e3-decisions.md`, cited below as *1e-3 ruling N*) bind this plan. The research notes it rests on — the app shell mapped (`1e3-shell.md`: §0 the missing root, §1 MainPanel by responsibility, §3's "1e-3a" bullet), every roadmap item for 1e-3 with the stored-settings mapping (`1e3-items.md` §4), and the deletion blast radius (`1e3-deletion.md`, context only) — are in the same workspace. This plan's own rulings are cited as *ruling N*.

## Global Constraints

- **The running app does not change.** MainPanel and the old session path stay exactly as they are. Read only: `src/components/MainPanel/**`, `src/components/MainLayout/**`, `src/components/Settings/**`, `src/components/SettingsInitializer/**`, `src/components/SetupWizard/**`, `src/components/TitleBar/**`, `src/components/Subtitle/SubtitleApp.tsx`, `SubtitleIdle.tsx`, `subtitleIdleState.ts`, `src/contexts/**`, `src/services/**`, `src/stores/{settingsStore,sessionStore,audioStore,modelStore,logStore,playbackStore,segmentationStore}.ts`, `src/lib/modern-audio/**`, `src/utils/audioUtils.ts`, `electron/**`, `extension/**`. `src/routes/Home.tsx` gains exactly one call, `loadSessionStores()` (Task 8), which only reads.
- **Nothing in the running app builds the root.** `getAppSession()`, `AppSession.audio()` and `AppSession.attach()` are called by the preview (Task 9) and by tests only; the root builds nothing at import and never initializes a second audio stack or a second punctuation runtime beside MainPanel's.
- `src/lib/**` never imports React or anything under `src/app/**`. `src/providers/**` imports no store but `modelStore` and `turnModeStore`. Under `src/app/`, only `useAppSession.ts` imports React or `src/lib/analytics.ts` as a value (its module body mounts a React root, which breaks any test that loads it — type imports are fine).
- New locale keys only in Task 2: four `notices.*` entries in all 30 locales, each a copy of a sentence the same locale already has (named there). Insert lines; never re-serialize a file.
- Record a caught failure with `reportError` / `reportWarning`, never `console.error` / `console.warn`; `src/app/` joins the console ledger's zero rule in Task 4. `console.info` stays for facts that are not failures (today's segmentation load line).
- Gates for every task: `npx vitest run src` shows 0 failed (4 unhandled rejections from `settingsStore.nativeGate.test.ts` are the baseline), and this typecheck gate prints exactly the same **11 lines** it prints at this plan's start (the shell's `grep` is a ugrep wrapper that mis-parses this regex — use `command grep` exactly as written). **The regex adds `app/` to the one in plan 1e-2b** (`src/app/` is new in this plan and must typecheck clean); the 11 lines are unchanged — checked against this plan's start commit:

  ```
  npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts)|lib/modern-audio/BaseAudioRecorder|providers|components/(providers|Conversation|Subtitle|MainPanel/ExportButton|dev/(SpinePreview|SessionControls|OverlayPreview))|stores/(providerStore|turnModeStore|routingStore)|utils/(environment|conversationExport)|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
  ```

  The 11 lines: App.tsx TS6133 'React'; SubtitleApp.handleStart.test.tsx TS6133 'provider'; 6× SubtitleBar.test.tsx TS2322 'SessionControl'; analytics.ts TS6133; environment.ts TS2717; environment.ts TS2339. Do not fix them; do not add to them. (`src/routes/Home.tsx` is outside the gate; its own pre-existing TS6133 stays.)
- Never start a dev server and never run a probe: after each task's commit the controller runs the headless probes the task names against a fresh vite (`SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort`).
- Commits: conventional, English; every message ends with the implementing model's `Co-Authored-By` line and `Claude-Session: https://claude.ai/code/session_01FbeFQk7tVuf6umXVwEeX28`. In this worktree the shell refuses compound git commands: run `git add` and `git commit -q -F - <<'EOF' … EOF` as separate calls. Never push.

## Rulings this plan makes

1. **The root lives in a new `src/app/`.** It composes `src/lib`, the stores, the providers and three React-only sources (sign-in, analytics, toasts), and it must be reachable without a React tree (plan 1e-3b's Electron close handshake, `settingsStore.enterSubtitleMode`, `UserProfileContext`). `src/lib/**` may not import React; a component directory would force the React tree. So: a plain module (`session.ts`) plus a hooks file (`useAppSession.ts`), in a directory beside `src/routes` and `src/layouts`. The gate's regex gains `app/`.
2. **Built on first use, one per page.** `getAppSession()` builds on its first call; the playback and capture load on the first `audio()` or the first leg a run opens (a leg always waits for them, so a run never goes live with nowhere to play). `configureAppSession(options)` sets the preview's stand-ins before that; once the session exists a later call changes nothing (a hot reload re-runs the preview's module).
3. **Two stand-ins, both the preview's.** `capture(app)` — the legs' capture given the app's own (the fake source, or the app's wrapped to count what it delivers) — and `refuse()` (`&refuse=1`). Plus `microphoneRequired()` (ruling 7) and `observeFrames` (the preview's page-lifetime seal line, which plan 1e-2b's fix wave made explicit). Everything else is the app's.
4. **Readiness says why by a code** (roadmap 1e-2 → 1e-3, *1e-3 ruling 16*). `CheckResult`'s refusal and `Readiness`'s `not-ready` gain `code?` / `params?`, as `ProviderRefusal` has; `reason` stays diagnostic English. The store copies them; missing credentials read `credentials_missing`; a refused start carries the readiness code (not `not_ready`) with its params. LocalInference: `local_models_missing` for the mandatory direction, `no_asr` with `{ source }` for the reverse direction's ASR — the code its `build` already uses for the same gap.
5. **Words only from sentences each locale already has.** The four new notices copy an existing key of the same locale word for word: `local_models_missing` ← `mainPanel.localModelsRequired`, `no_microphone` ← `modePicker.missingDevice`, `silent_no_permission` ← `audioPanel.participantNoAudioYet`, `loopback_denied` ← `audioPanel.screenRecordingDeniedText1`. No new translation, no spot-check owed.
6. **A local provider checks itself** (*1e-3 ruling 16*). A driver re-checks the selected provider when it is `kind: 'local'`, loaded, and its readiness is unknown (load, every edit, pair or legs change reset it), and when the provider's own inputs change (`Provider.watchReadiness` — LocalInference's model downloads); debounced 150 ms; only while the runner is idle (a change seen during a run is checked once idle again). No Validate button for a local provider; a networked provider keeps its explicit check (Stage 2).
7. **No microphone, no Start** (*1e-3 ruling 5*). One predicate, `microphoneMissing(legs, deviceId)` in `src/lib/session/shape.ts`: the speaker's leg with no chosen device. It gates the app's surfaces — the subtitle session's `canStart` and its idle line (`no_microphone`, before a provider's own blocker, today's precedence), and MainPanel's mode picker in 1e-3b — as today, where the button is the gate; the runner itself does not refuse. The root asks for a microphone unless told otherwise; the preview's fake source does not need one.
8. **A source may fail its open in words** (*1e-3 ruling 6*). `SourceOpenError` extends `AdapterStartError`, so the runner's failed start carries its code unchanged. The system-audio source ports today's `requestLoopbackAudioStream` denial check (`check-screen-recording-permission` answering `denied`) before a whole-system loopback recorder begins, and fails with `loopback_denied`. Only the code and its words here; the modal with its System Settings deep link is 1e-3b's.
9. **Push-to-translate passthrough keeps today's rule** (*1e-3 ruling 4*). `readRouting` takes the turn mode: under push-to-translate the original voice is on at ratio 1 whatever the toggle says; the route still closes while the key is held (`Playback.held`), and a muted microphone still sends nothing (its source delivers nothing). Other modes follow the toggle and its ratio, as now.
10. **The punctuator.** One `PunctuationRuntime` with today's enabled rule and diagnostics (`useSegmentationRuntime.ts`, word for word); `punctuationReady` is its `enabled`, read once per run by the runner and remembered for `sentence_segmentation_active`. It still reads true for a model the runtime disabled mid-session — today's gap too (roadmap 1e-2b → 1e-3). A memo answers one `(base language, text)` question with one model call among the last 32 asked — L1's display fill-in and LocalInference's job fill-in ask the same one; an answer in flight or non-null is kept, a null (no model yet) or a failure is not, so a later ask tries again.
11. **The tallies live in the app's frame port**, not L1 (spec: "Analytics" wants them in L1; nothing keeps them there yet). Per run — reset at its `translation_session_start`, read at its `translation_session_end`: seals from `local.segmentation.seal` (a letterless seal is not counted: it queues nothing and repeats with every later partial — plan 1e-2b ruling 9 as amended), ASR sentence ends per 100 raw characters from `local.asr.end`, model calls from the punctuator memo's misses. **Stated departure:** `segmentation_model_calls` is keyed by the leg for a one-leg run (today's key) and `both` for a two-leg run — one punctuator serves both legs and L1 fills the translation side too, so a call cannot name its leg. Frames are LocalInference's names; a Stage 2 provider that seals emits the same type or moves the tally into L1.
12. **The analytics the app adds** (*1e-3 ruling 13*). A decorator over the bridge's `track` adds to `translation_session_start` the eight kept properties — `noise_suppression_enabled` / `_mode`, `real_voice_passthrough_enabled` (the toggle as stored, as today), `input_device_on`, `monitor_device_on`, `sentence_segmentation_enabled` / `_active` / `_chunk_sentences` (the mode and size resolved against the selected provider's boundaries, as `appViewSettings` does) — and to `translation_session_end` the three segmentation records. `translation_count`, `model` and `latency_measurement` are not sent (D9). The runner's port still redacts every value after the decorator.
13. **The end of a run.** `onRunEnded` auto-saves exactly once (roadmap 1d-3) and then refetches the balance, not awaited — the ending is bounded, a network call is not. Electron's busy flag follows the phase rather than `onRunEnded`: busy when a start leaves idle; not busy once the runner is idle and `settled()` — after the save, after an ending that outlived its bound, and after a refused start, which never reaches `onRunEnded`. The renderer's answer to `app:close-requested` and the main process's 5 s bound (*1e-3 ruling 12*) stay with 1e-3b, which removes MainPanel's own handler in the same change.
14. **`pagehide` abandons every time**, a page frozen into the back/forward cache included (spec; plan 1e-1 made `abandon()` finalize the segments for a restored page). Today's MainPanel skips a persisted `pagehide`; its handler stays until 1e-3b.
15. **Stored settings, pure** (*1e-3 rulings 2 and 3*, `1e3-items.md` §4). The provider id map works both ways: a stored `local_inference` reads as `localInference`, and an explicit pick writes the old enum's spelling — every install already holds it, and the old settings store, still loaded until 1e-3c, reads it as the provider it is instead of falling back to OpenAI (`settingsStore.ts:1318`). A load never writes, a fallback included, so Stage 2 finds a removed provider's value intact. The turn mode migrates once, when `settings.common.turnMode` was never written, from the stored provider's slice; `Push-to-Talk` / `Push-to-Translate` map to themselves, everything else to auto. Nothing applies these in this plan.

## File Structure

| File | Change |
|---|---|
| `src/lib/session/storedSettings.ts` (+ test) | new: the stored-settings mapping, pure (Task 1) |
| `src/lib/provider/types.ts` | `CheckResult` / `Readiness` codes (Task 2); `Provider.watchReadiness` (Task 7) |
| `src/stores/providerStore.ts` (+ `providerStore.readiness.test.ts`) | readiness carries the code (Task 2) |
| `src/lib/session/run.ts`, `runner.test.ts` | a refused start carries the readiness code (Task 2); a source's code (test only, Task 3) |
| `src/providers/localInference/check.ts` (+ test), `provider.ts` (+ test) | readiness codes (Task 2); the model-store watch (Task 7) |
| `src/lib/view/noticeText.ts` (+ test), `src/locales/*/translation.json` | four notices and their words (Task 2) |
| `src/lib/subtitle/session.ts` (+ test), `src/components/Subtitle/SubtitleView.tsx` (+ test) | the idle line in words by code (Task 2); a missing microphone (Task 3) |
| `src/lib/session/source.ts`, `src/lib/audio/capture/systemAudio.ts` (+ test) | `SourceOpenError`, `loopback_denied` (Task 3) |
| `src/lib/session/shape.ts` (+ test), `src/lib/subtitle/appSession.ts` (+ test) | `microphoneMissing`, the subtitle session's gate (Task 3) |
| `src/lib/audio/appAudio.ts` (+ test) | push-to-translate passthrough (Task 3) |
| `src/app/punctuation.ts` (+ test), `src/lib/diagnostics/consoleLedger.consistency.test.ts` | new: the app's punctuator; `src/app` in the ledger (Task 4) |
| `src/app/telemetry.ts` (+ test), `src/lib/view/appViewSettings.ts` (+ test) | new: frames, tallies, the analytics decorator; the offer helpers exported (Task 5) |
| `src/app/session.ts` (+ test), `src/app/useAppSession.ts` (+ test) | new: the root and its hooks (Task 6); `attach()` (Task 8) |
| `src/app/readiness.ts` (+ test), `src/components/providers/CredentialForm.tsx`, `ProviderPanel.tsx` (+ tests) | new: the local readiness driver; no Validate for a local provider, reasons in words (Task 7) |
| `src/app/busy.ts` (+ test), `src/app/loadStores.ts` (+ test), `src/routes/Home.tsx` | new: Electron's busy flag, the store loading; Home's one call (Task 8) |
| `src/components/dev/SpinePreview.tsx` (+ test) | the preview on the root (Task 9) |

---

### Task 1: The stored settings, mapped (pure; plan 1e-3b applies them)

**Files:** Create `src/lib/session/storedSettings.ts`, `src/lib/session/storedSettings.test.ts`.

**Interfaces:**
- Produces: `LEGACY_PROVIDER_IDS`, `providerIdFromStored(stored: unknown): string | null`, `storedProviderValue(id: string): string`, `interface StoredSelection { id: string; fromStorage: boolean }`, `selectionFromStored(stored: unknown, offered: readonly string[]): StoredSelection | null`, `selectionToPersist(id: string, how: 'load' | 'pick'): string | null`, `LEGACY_SLICE_KEYS`, `legacyTurnModeKey(storedProvider: unknown): string | null`, `turnModeFromLegacy(mode: unknown): TurnMode`, `migrateTurnMode(common: unknown, legacy: unknown): { turnMode: TurnMode; write: boolean }`.
- Consumed by: nothing in this plan — plan 1e-3b's loader and `providerStore.select`.

- [ ] **Step 1: Write the failing tests** in `storedSettings.test.ts` (import `Provider` from `../../types/Provider` — a plain enum file):
  - `providerIdFromStored`: `'local_inference'` → `'localInference'`; `'localInference'` → `'localInference'`; `'soniox'` → `'soniox'`; `''`, `'  '`, `undefined`, `42` → `null`.
  - `storedProviderValue`: `'localInference'` → `'local_inference'`; `'fake'` → `'fake'`; every `LEGACY_PROVIDER_IDS` entry round-trips (`storedProviderValue(providerIdFromStored(legacy)!) === legacy`).
  - `selectionFromStored` with `offered = ['localInference', 'fake']`: `'local_inference'` → `{ id: 'localInference', fromStorage: true }`; `'fake'` → `{ id: 'fake', fromStorage: true }`; `'soniox'` (not offered) → `{ id: 'localInference', fromStorage: false }`; `undefined` → `{ id: 'localInference', fromStorage: false }`; `offered = []` → `null`.
  - `selectionToPersist`: `('localInference', 'load')` → `null`; `('fake', 'load')` → `null`; `('localInference', 'pick')` → `'local_inference'`; `('fake', 'pick')` → `'fake'`.
  - `LEGACY_SLICE_KEYS` has a key for every value of the `Provider` enum.
  - `legacyTurnModeKey`: `'openai'` → `'settings.openai.turnDetectionMode'`; `'volcengine_ast2'` → `'settings.volcengineAST2.turnDetectionMode'`; `'local_inference'` and `'localInference'` → `'settings.localInference.turnDetectionMode'`; `'kizunaai'`, `undefined` → `null`.
  - `turnModeFromLegacy`: `'Push-to-Talk'` → `'push-to-talk'`; `'Push-to-Translate'` → `'push-to-translate'`; `'Normal'`, `'Semantic'`, `'Disabled'`, `'Auto'`, `undefined`, `'push-to-talk'` → `'auto'`.
  - `migrateTurnMode`: `('', 'Push-to-Talk')` → `{ turnMode: 'push-to-talk', write: true }`; `(undefined, undefined)` → `{ turnMode: 'auto', write: true }`; `('push-to-translate', 'Push-to-Talk')` → `{ turnMode: 'push-to-translate', write: false }`; `('bogus', 'Push-to-Talk')` → `{ turnMode: 'auto', write: false }`.
- [ ] **Step 2: Run** `npx vitest run src/lib/session/storedSettings.test.ts` — fails (no module).
- [ ] **Step 3: Implement** `storedSettings.ts`:

  ```ts
  /**
   * How the values an install already stored map onto the new session's stores
   * (1e-3 rulings 2 and 3; spec: "Persisted settings that move"). Pure: nothing
   * here reads or writes storage — plan 1e-3b applies it.
   */
  import type { TurnMode } from './types';

  /** The old `Provider` enum's spelling (`src/types/Provider.ts`) of every registered provider id that differs from it. */
  export const LEGACY_PROVIDER_IDS: Readonly<Record<string, string>> = {
    local_inference: 'localInference',
  };

  /** A stored `settings.common.provider` value in the registry's spelling; null when nothing usable is stored. */
  export function providerIdFromStored(stored: unknown): string | null {
    if (typeof stored !== 'string' || stored.trim() === '') return null;
    return LEGACY_PROVIDER_IDS[stored] ?? stored;
  }

  /**
   * What `settings.common.provider` holds for a provider: the old enum's
   * spelling where one exists — the value every install already has, and the
   * one the old settings store (still loaded until plan 1e-3c) reads as the
   * provider it is instead of falling back to OpenAI.
   */
  export function storedProviderValue(id: string): string {
    for (const [legacy, current] of Object.entries(LEGACY_PROVIDER_IDS)) if (current === id) return legacy;
    return id;
  }

  export interface StoredSelection {
    /** The provider to select, in memory. */
    id: string;
    /** False: nothing usable was stored, or it names a provider this build does not offer — this is the fallback, and it is never written back (ruling 2). */
    fromStorage: boolean;
  }

  /** The provider a load selects: the stored one when this build offers it, else the first offered (LocalInference: the registry puts it first). */
  export function selectionFromStored(stored: unknown, offered: readonly string[]): StoredSelection | null {
    const id = providerIdFromStored(stored);
    if (id !== null && offered.includes(id)) return { id, fromStorage: true };
    return offered.length > 0 ? { id: offered[0], fromStorage: false } : null;
  }

  /**
   * What a selection writes under `settings.common.provider`: an explicit pick
   * writes its stored spelling; a load writes nothing — the stored value, even
   * one naming a provider this build lacks, stays for Stage 2 to find (ruling 2).
   */
  export function selectionToPersist(id: string, how: 'load' | 'pick'): string | null {
    return how === 'pick' ? storedProviderValue(id) : null;
  }

  /** The slice each old `Provider` value kept its settings under (its descriptor's `settingsSliceKey`). */
  export const LEGACY_SLICE_KEYS: Readonly<Record<string, string>> = {
    openai: 'openai',
    gemini: 'gemini',
    palabraai: 'palabraai',
    kizunaai_openai_translate: 'kizunaOpenaiTranslate',
    kizunaai_volcengine_ast2: 'kizunaVolcengineAst2',
    kizunaai_soniox: 'kizunaSoniox',
    openai_compatible: 'openaiCompatible',
    openai_translate: 'openaiTranslate',
    openai_live: 'openaiLive',
    volcengine_ast2: 'volcengineAST2',
    local_inference: 'localInference',
    local_native: 'localNative',
    soniox: 'soniox',
  };

  /** Where the stored provider kept its turn mode; null when the value names no old provider. */
  export function legacyTurnModeKey(storedProvider: unknown): string | null {
    if (typeof storedProvider !== 'string') return null;
    const slice = LEGACY_SLICE_KEYS[storedProvider] ?? LEGACY_SLICE_KEYS[storedProviderValue(storedProvider)];
    return slice ? `settings.${slice}.turnDetectionMode` : null;
  }

  /** An old `turnDetectionMode` as the global mode: the two push modes map to themselves, everything else — `Normal`, `Semantic`, `Disabled`, `Auto`, nothing stored — to automatic. */
  export function turnModeFromLegacy(mode: unknown): TurnMode {
    if (mode === 'Push-to-Talk') return 'push-to-talk';
    if (mode === 'Push-to-Translate') return 'push-to-translate';
    return 'auto';
  }

  const MODES: readonly TurnMode[] = ['auto', 'push-to-talk', 'push-to-translate'];

  /**
   * The one-time migration (ruling 3). `common` is `settings.common.turnMode`
   * read with `''` as its default, so `''` (or nothing) means never written;
   * `legacy` is the value at `legacyTurnModeKey(storedProvider)`. Once the
   * global mode exists it wins as `turnModeStore.load` reads it, and nothing is
   * written.
   */
  export function migrateTurnMode(common: unknown, legacy: unknown): { turnMode: TurnMode; write: boolean } {
    if (common !== undefined && common !== null && common !== '') {
      return { turnMode: MODES.find((m) => m === common) ?? 'auto', write: false };
    }
    return { turnMode: turnModeFromLegacy(legacy), write: true };
  }
  ```
- [ ] **Step 4: Run** the file — pass; then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/session/storedSettings.ts src/lib/session/storedSettings.test.ts
  git commit -m "feat(session): the stored provider and turn mode, mapped for the switch"
  ```

**Probes:** none — nothing the preview runs changes.

---

### Task 2: Readiness says why by a code, and four notices have words

**Files:** Modify `src/lib/provider/types.ts`, `src/stores/providerStore.ts` (+ `providerStore.readiness.test.ts`), `src/lib/session/run.ts` (+ `runner.test.ts`), `src/providers/localInference/check.ts` (+ `check.test.ts`), `src/lib/view/noticeText.ts` (+ test), the 30 `src/locales/<code>/translation.json`, `src/lib/subtitle/session.ts` (+ test), `src/components/Subtitle/SubtitleView.tsx` (+ test).

**Interfaces:**
- Produces: `CheckResult`'s refusal and `Readiness`'s `not-ready` gain `code?: string; params?: Record<string, string | number>`; `SubtitleIdleModel`'s `unready` gains the same two; `LOCAL_MODELS_MISSING = 'local_models_missing'` (`check.ts`); `NOTICE_WORDS` entries `local_models_missing`, `no_microphone`, `silent_no_permission`, `loopback_denied`.
- Consumed by: Task 3 (the `no_microphone` / `loopback_denied` emitters), Task 7 (`CredentialForm`'s words).

- [ ] **Step 1: Write the failing tests.**
  - `providerStore.readiness.test.ts`: the first test ("reports missing credentials…") now expects `{ state: 'not-ready', reason: 'no key', code: 'credentials_missing' }`. Add: a check answering `{ ok: false, reason: 'r', code: 'c', params: { n: 1 } }` → `refreshReadiness` resolves to (and the store holds) `{ state: 'not-ready', reason: 'r', code: 'c', params: { n: 1 } }`; a refusal without a code has no `code` key (`toEqual({ state: 'not-ready', reason: 'bad key' })` — the existing test stays).
  - `runner.test.ts`, beside "refuses a provider that is not ready, with its reason": `ready: { state: 'not-ready', reason: 'Required models…', code: 'no_asr', params: { source: 'ja' } }` → `lastEnd` `{ reason: 'refused', notice: { code: 'no_asr', message: 'Required models…', params: { source: 'ja' } } }`. The existing not-ready tests (no code → `not_ready`) stay.
  - `check.test.ts`: the three reason expectations gain `code: 'local_models_missing'` (the two "selected language pair" cases) and `code: 'no_asr', params: { source: 'en' }` (the reverse case, pair `ja → en`).
  - `noticeText.test.ts`: the "every code the runner, the capture and the adapters record" list gains `SILENT_NO_PERMISSION` (import it from `../audio/capture/systemAudio`, beside the two already imported). Add "words the four new codes with a sentence every locale already has":

    ```ts
    const COPIES = {
      local_models_missing: 'mainPanel.localModelsRequired',
      no_microphone: 'modePicker.missingDevice',
      silent_no_permission: 'audioPanel.participantNoAudioYet',
      loopback_denied: 'audioPanel.screenRecordingDeniedText1',
    } as const;
    const at = (tree: unknown, path: string) => path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], tree);
    const catalogs = import.meta.glob('../../locales/*/translation.json', { eager: true, import: 'default' });
    it('words the four new codes with a sentence every locale already has', () => {
      expect(Object.keys(catalogs)).toHaveLength(30);
      for (const [path, catalog] of Object.entries(catalogs)) {
        for (const [code, key] of Object.entries(COPIES)) {
          expect(at(catalog, `notices.${code}`), `${path}: ${code}`).toBe(at(catalog, key));
        }
      }
    });
    ```

    (The existing "matches the English locale word for word" test then pins `NOTICE_WORDS` to en.)
  - `session.test.ts` (subtitle): `idleOf({ phase: 'idle' }, { state: 'not-ready', reason: 'r', code: 'no_asr', params: { source: 'en' } })` → `{ kind: 'unready', message: 'r', code: 'no_asr', params: { source: 'en' } }`; without a code the existing expectation (`{ kind: 'unready', message: … }`, no extra keys) holds. `sameSession`: two sessions whose unready idle has the same message but a different `code` → false; same message and code, different `params` → false.
  - `SubtitleView.test.tsx`, beside the unready case: `idle: { kind: 'unready', message: 'Required models are not available…', code: 'local_models_missing' }` → `.subtitle-idle__action--fix` reads `Please download the required models in Settings to start` (the view's i18n mock returns the default value).
- [ ] **Step 2: Run** `npx vitest run src/stores/providerStore.readiness.test.ts src/lib/session/runner.test.ts src/providers/localInference/check.test.ts src/lib/view/noticeText.test.ts src/lib/subtitle/session.test.ts src/components/Subtitle/SubtitleView.test.tsx` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `types.ts`:

    ```ts
    /** `models`, when present, is newest first. A refusal's `code` (and `params`) put it into the user's words (`notices.<code>`); `reason` stays diagnostic English. */
    export type CheckResult =
      | { ok: true; models?: readonly ModelOption[] }
      | { ok: false; reason: string; code?: string; params?: Record<string, string | number> };
    ```

    and `Readiness`'s member becomes `{ state: 'not-ready'; reason: string; code?: string; params?: Record<string, string | number> }` (doc: "`code` / `params` as a refusal's").
  - `providerStore.ts` `refreshReadiness`: missing credentials → `{ state: 'not-ready', reason: credentials.missing, code: 'credentials_missing' }` (a comment: "the runner's own code for the same gap, `RunNoticeCode`"); a refusal → `{ state: 'not-ready', reason: result.reason, ...(result.code ? { code: result.code } : {}), ...(result.params ? { params: result.params } : {}) }` (spread, so an uncoded answer keeps today's shape).
  - `run.ts`, the readiness refusal:

    ```ts
    if (readiness.state !== 'ready') {
      throw new RefusedError(readiness.state === 'not-ready'
        // The provider's own code puts its reason into words; `not_ready` wraps an uncoded one.
        ? { code: readiness.code ?? ('not_ready' satisfies RunNoticeCode), message: readiness.reason, ...(readiness.params ? { params: readiness.params } : {}) }
        : { code: 'not_ready' satisfies RunNoticeCode, message: `readiness is ${readiness.state}` });
    }
    ```
  - `check.ts`: export `LOCAL_MODELS_MISSING`; the mandatory-direction refusal adds `code: LOCAL_MODELS_MISSING`; the reverse-direction refusal adds `code: 'no_asr', params: { source: ctx.pair.target }` (the code `build` uses for the same gap, `config.ts`). Replace the comment block above them ("Plain English, not i18n … is plan 1e-3's") with one line: "`reason` is diagnostic English; `code` is what a surface words (plan 1e-3a ruling 4)."
  - `noticeText.ts`, after the capture's two entries:

    ```ts
      silent_no_permission: 'No audio has come through from the selected source yet. If it is playing and nothing is translated, allow Sokuji under System Settings > Privacy & Security > System Audio Recording Only (macOS), then start the session again.',
      loopback_denied: "Other's audio requires Screen Recording permission to capture system audio.",
      no_microphone: 'Configure devices for this mode to start.',
      // Readiness (a provider's check).
      local_models_missing: 'Please download the required models in Settings to start.',
    ```
  - The locales: run once from the worktree root (not committed):

    ```bash
    node --input-type=module -e '
    import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
    const COPIES = { local_models_missing: "mainPanel.localModelsRequired", no_microphone: "modePicker.missingDevice", silent_no_permission: "audioPanel.participantNoAudioYet", loopback_denied: "audioPanel.screenRecordingDeniedText1" };
    const at = (tree, path) => path.split(".").reduce((node, key) => node?.[key], tree);
    const ANCHOR = "    \"translation_unavailable\": ";
    for (const code of readdirSync("src/locales")) {
      const file = `src/locales/${code}/translation.json`;
      if (!existsSync(file)) continue;
      const text = readFileSync(file, "utf8");
      const catalog = JSON.parse(text);
      const lines = text.split("\n");
      const hits = lines.flatMap((line, i) => (line.startsWith(ANCHOR) ? [i] : []));
      if (hits.length !== 1 || lines[hits[0] + 1] !== "  }") throw new Error(`${file}: the notices anchor moved`);
      const added = Object.entries(COPIES).map(([key, from]) => {
        const value = at(catalog, from);
        if (typeof value !== "string") throw new Error(`${file}: no ${from}`);
        return `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
      });
      lines[hits[0]] += ",";
      lines.splice(hits[0] + 1, 0, added.join(",\n"));
      writeFileSync(file, lines.join("\n"));
    }'
    ```

    Then `git diff --stat src/locales` shows 30 files, each +5 −1.
  - `subtitle/session.ts`: the `unready` member becomes `{ kind: 'unready'; message: string; code?: string; params?: Record<string, string | number> }` (doc: "`message` is diagnostic English; `code`, when present, is what the surface words"); `idleOf` returns `{ kind: 'unready', message: readiness.reason, ...(readiness.code ? { code: readiness.code } : {}), ...(readiness.params ? { params: readiness.params } : {}) }`; `sameIdle` compares `message`, `code` and the params shallowly for `unready`.
  - `SubtitleView.tsx` `idleState`: `if (idle.kind === 'unready') return { kind: 'unready', message: noticeText(t, idle) };` (an uncoded reason stays as it is — `noticeText` returns the message).
- [ ] **Step 4: Run** the six files, then `npx vitest run src/locales`, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/provider/types.ts src/stores/providerStore.ts src/stores/providerStore.readiness.test.ts src/lib/session/run.ts src/lib/session/runner.test.ts src/providers/localInference/check.ts src/providers/localInference/check.test.ts src/lib/view/noticeText.ts src/lib/view/noticeText.test.ts src/locales src/lib/subtitle/session.ts src/lib/subtitle/session.test.ts src/components/Subtitle/SubtitleView.tsx src/components/Subtitle/SubtitleView.test.tsx
  git commit -m "feat(provider): readiness says why by a code, and four notices have words"
  ```

**Probes:** `spine-export-probe.mjs` still ends with the refused start's idle line `Choose a provider in Settings before starting.` (`no_provider` is untouched); `spine-subtitle-probe.mjs` (default URL) still passes — the fake's reasons carry no code, so every idle line reads as before.

---

### Task 3: The capture's three rules — a denied loopback in words, no microphone no Start, push-to-translate passthrough

**Files:** Modify `src/lib/session/source.ts`, `src/lib/session/runner.test.ts`, `src/lib/audio/capture/systemAudio.ts` (+ test), `src/lib/session/shape.ts` (+ test), `src/lib/subtitle/session.ts` (+ test), `src/lib/subtitle/appSession.ts` (+ test), `src/lib/audio/appAudio.ts` (+ test), `src/lib/view/noticeText.test.ts`.

**Interfaces:**
- Produces: `class SourceOpenError extends AdapterStartError` (`source.ts`); `LOOPBACK_DENIED = 'loopback_denied'`, `SystemAudioDeps.screenRecording(): Promise<string>` (`systemAudio.ts`); `NO_MICROPHONE = 'no_microphone'`, `microphoneMissing(legs: readonly LegName[], deviceId: string | undefined): boolean` (`shape.ts`); `SubtitleSessionInput.microphoneMissing?: boolean`, `idleOf(run, readiness, microphoneMissing = false)`; `appSubtitleSession(runner, view, options?: { microphoneRequired?(): boolean })` (default: never required); `readRouting(audio, switches, platform, turnMode: TurnMode)`.
- Consumed by: Task 6 (the root passes `microphoneRequired`), plan 1e-3b (MainPanel's mode picker reads `microphoneMissing`; its modal reads `loopback_denied`).

- [ ] **Step 1: Write the failing tests.**
  - `runner.test.ts`, beside "fails a start with the adapter's own code when it gives one": legs `['speaker', 'participant']`, `openSource` rejecting the participant with `new SourceOpenError('Screen Recording permission is denied.', 'loopback_denied')` → `lastEnd` `{ reason: 'start-failed', notice: { code: 'loopback_denied', message: 'Screen Recording permission is denied.', leg: 'participant' } }`.
  - `systemAudio.test.ts`: `setup` takes `screenRecording?: string` and its deps answer `screenRecording: vi.fn(async () => o.screenRecording ?? 'granted')` (returned from `setup` for assertions); the file's second `SystemAudioDeps` literal (~line 222) gains `screenRecording: async () => 'granted'` so it still typechecks. Cases:
    1. Whole-system capture with `screenRecording: 'denied'` rejects with a `SourceOpenError` whose `code` is `LOOPBACK_DENIED`; the loopback recorder never began (`s.loopback.begun` is `[]`); the invoked channels are `['connect-system-audio-source', 'disconnect-system-audio-source']`.
    2. One application (`sourceId: 'app:42'`, answer `{ success: true, capture: 'app' }`) with `screenRecording: 'denied'` opens, and `screenRecording` was never asked.
    3. `screenRecording: 'not-determined'` → the loopback recorder begins (the OS asks at `getDisplayMedia`, as today).
    Every existing case keeps passing on the default `'granted'`.
  - `shape.test.ts`: `microphoneMissing(['speaker'], undefined)` → true; `(['speaker'], '')` → true; `(['speaker'], 'mic-1')` → false; `(['participant'], undefined)` → false; `(['speaker', 'participant'], undefined)` → true.
  - `session.test.ts` (subtitle): with `microphoneMissing: true` and an idle run, `canStart` is false and `idle` is `{ kind: 'unready', message: expect.any(String), code: 'no_microphone' }` — also when readiness is `not-ready` (the device comes first, today's precedence); a `starting` run still shows `{ kind: 'starting' }`; absent or false changes nothing (the existing cases).
  - `appSession.test.ts`: add the `ServiceFactory` mock `appShape.test.ts` uses (the module now reads `audioStore`), and reset `useAudioStore` in `afterEach` as the file resets the other two. Cases: with `{ microphoneRequired: () => true }`, `useAudioStore` at `{ mode: 'speaker', selectedInputDevice: null }` → `canStart` false, `idle.code` `'no_microphone'`; `useAudioStore.setState({ selectedInputDevice: { deviceId: 'mic-1', label: 'Mic' } })` → the listener is called and `canStart` is true. With no options, or `mode: 'participant'` and `microphoneRequired: () => true` → `canStart` true.
  - `appAudio.test.ts`: every `readRouting(…)` call gains `'auto'`. Add: `readRouting({ ...AUDIO, isRealVoicePassthroughEnabled: false, realVoicePassthroughVolume: 0.2 }, SWITCHES, 'electron', 'push-to-translate').passthrough` → `{ on: true, ratio: 1 }`; the same with `'auto'` and `'push-to-talk'` → `{ on: false, ratio: 0.2 }`. `createAppRouting`: `beforeEach` also sets `useTurnModeStore.setState({ turnMode: 'auto' })`; `useTurnModeStore.getState().setTurnMode('push-to-translate')` calls the listener and `routing.get().passthrough` is `{ on: true, ratio: 1 }`.
  - `noticeText.test.ts`: the "every code … record" list gains `LOOPBACK_DENIED` and `NO_MICROPHONE`.
- [ ] **Step 2: Run** `npx vitest run src/lib/session src/lib/audio src/lib/subtitle src/lib/view/noticeText.test.ts` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `source.ts`:

    ```ts
    import { AdapterStartError } from '../contract/adapter';

    /**
     * A source that could not open, for a reason the user can be told in words:
     * `code` is a notice code (`notices.<code>`). An `AdapterStartError`, so a
     * failed start carries its code exactly as it carries an adapter's.
     */
    export class SourceOpenError extends AdapterStartError {}
    ```
  - `systemAudio.ts`: `export const LOOPBACK_DENIED = 'loopback_denied';`; `SystemAudioDeps` gains

    ```ts
    /** The OS's Screen Recording permission as the main process reports it (`granted`, `denied`, `not-determined`, `unknown`); outside macOS always `granted`. */
    screenRecording(): Promise<string>;
    ```

    and `electronSystemAudio()` answers it from `invoke('check-screen-recording-permission')`'s `status` (a string, else `'unknown'`; a rejected invoke → `'unknown'`, as today's check treats an error as "not denied here"). In `record()`, first thing:

    ```ts
    // Today's `requestLoopbackAudioStream` denial (MainPanel's Screen Recording modal):
    // the start fails (D22) with a code the idle surface puts into words and plan
    // 1e-3b's modal deep-links from. Asked only before a whole-system loopback.
    if (connection.mode === 'loopback' && (await deps.screenRecording()) === 'denied') {
      throw new SourceOpenError('Screen Recording permission is denied, so the whole system cannot be captured.', LOOPBACK_DENIED);
    }
    ```

    (A fall-back to loopback mid-run that meets a denial ends the source through the existing chain's `core.end`.)
  - `shape.ts`:

    ```ts
    /** Why the app's surfaces keep Start off while no microphone is chosen. */
    export const NO_MICROPHONE = 'no_microphone';

    /**
     * A start would open the speaker's leg with no microphone chosen (1e-3
     * ruling 5): the surfaces keep Start off, as today — the microphone source
     * would open the system default, which may be a loopback input. Muting never
     * blocks a start. The subtitle session's gate reads it now, MainPanel's mode
     * picker in plan 1e-3b.
     */
    export function microphoneMissing(legs: readonly LegName[], deviceId: string | undefined): boolean {
      return legs.includes('speaker') && !deviceId;
    }
    ```
  - `subtitle/session.ts`: `SubtitleSessionInput` gains `/** The app's capture needs a microphone and none is chosen (1e-3 ruling 5). */ microphoneMissing?: boolean`; `canStart` adds `&& !microphoneMissing`; `idleOf(run, readiness, microphoneMissing = false)` returns, after the `starting` and not-idle checks and before the readiness check, `{ kind: 'unready', message: 'No microphone is chosen for the speaker leg.', code: NO_MICROPHONE }` (comment: "today's precedence, `computeStartGate`: a missing device before the provider's own blocker").
  - `appSession.ts`: a third parameter `options: { /** Whether a start needs a chosen microphone: the app's capture does; a fake source does not. Default: never. */ microphoneRequired?(): boolean } = {}`; `read()` passes `microphoneMissing: (options.microphoneRequired?.() ?? false) && microphoneMissing(legsFor(audio.mode), audio.selectedInputDevice?.deviceId)` with `const audio = useAudioStore.getState()`; subscribe `useAudioStore` too. The file's doc names the store it now reads.
  - `appAudio.ts`: `readRouting` takes `turnMode: TurnMode` last, and

    ```ts
    // 1e-3 ruling 4, today's rule (`isPassthroughActive`): under push-to-translate
    // the original voice is on at full level whenever the key is not held (the
    // route closes while held), whatever the passthrough toggle says.
    passthrough: turnMode === 'push-to-translate'
      ? { on: true, ratio: 1 }
      : { on: audio.isRealVoicePassthroughEnabled, ratio: audio.realVoicePassthroughVolume },
    ```

    `createAppRouting` reads `useTurnModeStore.getState().turnMode` and subscribes to `useTurnModeStore` as well. The file's doc names the three stores.
- [ ] **Step 4: Run** the same set, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/session src/lib/audio/capture/systemAudio.ts src/lib/audio/capture/systemAudio.test.ts src/lib/audio/appAudio.ts src/lib/audio/appAudio.test.ts src/lib/subtitle src/lib/view/noticeText.test.ts
  git commit -m "feat(audio): a denied loopback in words, no microphone no Start, push-to-translate's passthrough"
  ```

**Probes:** `spine-audio-probe.mjs` (default, and `'http://localhost:5199/?preview=spine&autostart=1&capture=device'`) still hears clips and a tap peak, and with `capture=device` the fake microphone delivers; `spine-subtitle-probe.mjs` with `…&turn=push-to-talk` and with `…&turn=push-to-translate` still passes (both surfaces draw bands after the hold). The preview's subtitle session asks for no microphone yet (Task 9 sets that).

---

### Task 4: The app's punctuator — today's runtime and diagnostics, and a `(language, text)` memo

**Files:** Create `src/app/punctuation.ts`, `src/app/punctuation.test.ts`; Modify `src/lib/diagnostics/consoleLedger.consistency.test.ts`.

**Interfaces:**
- Consumes: `PunctuationRuntime` (`src/lib/segmentation/PunctuationRuntime`), `Punctuator` (`src/lib/contract/adapter`), `baseLang` (`src/lib/segmentation/sentenceEnd`).
- Produces: `PUNCTUATION_MEMO_SIZE = 32`; `type TrackModelLoad = (event: 'segmentation_model_load', properties: AnalyticsEvents['segmentation_model_load']) => void`; `punctuationDiagnostics(track: () => TrackModelLoad | undefined)` → the runtime's `onLoaded` / `onInference` / `onStatus`; `memoizePunctuator(ask: Punctuator, onMiss?: () => void, size?: number): Punctuator`; `interface AppPunctuation { runtime: PunctuationRuntime; punctuate: Punctuator; ready(): boolean; readonly lastReady: boolean }`; `createAppPunctuation(deps: { track: () => TrackModelLoad | undefined; onModelCall?(): void }): AppPunctuation`.

- [ ] **Step 1: Write the failing tests** in `punctuation.test.ts`. Mock `../services/ServiceFactory` (as `appShape.test.ts`) and `../lib/segmentation/PunctuationRuntime` exactly as `src/components/MainPanel/useSegmentationRuntime.test.ts` does (its `FakePunctuationRuntime` capturing `opts`, its `MODEL_IDS`), adding `punctuate = vi.fn(async () => null)` to the fake. Cases:
  1. `memoizePunctuator`: two asks of `('en', 'hello there')` → `ask` called once, both get the same answer, `onMiss` called once; `('en-US', 'hello there')` after `('en', …)` → no second call; a different text → a second call.
  2. An answer of null is not kept: ask, await it (null), ask again → two calls. A rejected ask answers null and is not kept either.
  3. Bounded: `size` 2; ask a, b, c (all resolving to text) → asking a again calls `ask`, asking c again does not.
  4. `createAppPunctuation`: the fake's captured `isEnabled()` is true only when `useSettingsStore`'s `segmentationMode` is `'sentences'` and `useSegmentationStore`'s `phase` is `'ready'` (set each store, check all four combinations).
  5. `ready()` answers the runtime's `enabled`, and `lastReady` remembers the last answer (false before any call).
  6. `punctuate('en', 'a b')` maps the runtime's `{ text: 'A b.' }` to `'A b.'`, and its null to null.
  7. Diagnostics, asserted the way `useSegmentationRuntime.test.ts` does (`settleReports()`, then the log store, with diagnostic logs on): `onLoaded('fireredpunc', 'wasm', 1234.6)` adds a realtime entry `segmentation.model.loaded` with `{ model: 'fireredpunc', backend: 'wasm', load_ms: 1235 }` and calls `track` with `('segmentation_model_load', { model: 'fireredpunc', backend: 'wasm', load_ms: 1235, result: 'ok' })`; `onInference(…, { skeletonOk: false, … })` reports one warning; `onStatus('sat-3l-sm', 'disabled', 'slow')` and `onStatus('sat-3l-sm', 'error', 'gone')` report one warning each; a second identical error reports nothing more (the dedupe key).
- [ ] **Step 2: Run** `npx vitest run src/app/punctuation.test.ts` — fails (no module).
- [ ] **Step 3: Implement** `punctuation.ts`:

  ```ts
  /**
   * The app's one punctuation runtime (plan 1e-3a): today's
   * `useSegmentationRuntime` — its enabled rule and its diagnostics, word for
   * word — outside React, handed to the runner as `punctuate` /
   * `punctuationReady`. The memo answers one question once: L1's display
   * fill-in and LocalInference's job fill-in ask the same one per utterance.
   */
  import type { AnalyticsEvents } from '../lib/analytics';
  import type { Punctuator } from '../lib/contract/adapter';
  import { reportWarning } from '../lib/diagnostics/report';
  import { PunctuationRuntime, type PunctuationRuntimeOptions } from '../lib/segmentation/PunctuationRuntime';
  import type { PunctuationModelId } from '../lib/segmentation/SegmentationRuntime';
  import { baseLang } from '../lib/segmentation/sentenceEnd';
  import useLogStore from '../stores/logStore';
  import { useSegmentationStore } from '../stores/segmentationStore';
  import { useSettingsStore } from '../stores/settingsStore';

  export type TrackModelLoad = (event: 'segmentation_model_load', properties: AnalyticsEvents['segmentation_model_load']) => void;

  export const PUNCTUATION_MEMO_SIZE = 32;

  /** The runtime's three callbacks as `useSegmentationRuntime` wires them today. */
  export function punctuationDiagnostics(
    track: () => TrackModelLoad | undefined,
  ): Required<Pick<PunctuationRuntimeOptions, 'onLoaded' | 'onInference' | 'onStatus'>> {
    // Copy the three bodies from `useSegmentationRuntime.ts` (its `seen` set,
    // console lines, `addRealtimeEvent`, `reportWarning` calls and dedupe keys),
    // calling `track()?.(…)` where the hook calls `trackEventRef.current?.(…)`.
  }

  /**
   * One model call per `(base language, text)` among the last `size` asked. An
   * answer in flight or with text is kept; null (no model yet) or a failure is
   * not, so a later ask tries again. `onMiss` counts the model calls.
   */
  export function memoizePunctuator(ask: Punctuator, onMiss: () => void = () => {}, size = PUNCTUATION_MEMO_SIZE): Punctuator {
    const kept = new Map<string, Promise<string | null>>();
    return (lang, text) => {
      const key = `${baseLang(lang)}\u0000${text}`;
      const hit = kept.get(key);
      if (hit) return hit;
      onMiss();
      const forget = () => { if (kept.get(key) === answer) kept.delete(key); };
      const answer: Promise<string | null> = ask(lang, text).then(
        (out) => { if (out === null) forget(); return out; },
        () => { forget(); return null; },
      );
      kept.set(key, answer);
      if (kept.size > size) kept.delete(kept.keys().next().value as string);
      return answer;
    };
  }

  export interface AppPunctuation {
    readonly runtime: PunctuationRuntime;
    /** The runner's `punctuate`. */
    punctuate: Punctuator;
    /** The runner's `punctuationReady`: the display is by sentences and the pack is on disk (and the device can hold it). */
    ready(): boolean;
    /** What `ready()` last answered — the runner reads it once per run, when the run opens, so this is the run's (`sentence_segmentation_active`). */
    readonly lastReady: boolean;
  }

  export function createAppPunctuation(deps: { track: () => TrackModelLoad | undefined; onModelCall?(): void }): AppPunctuation {
    const runtime = new PunctuationRuntime({
      // Today's rule: the stored display mode is by sentences AND the pack is
      // on disk. Sentences survive every provider's offer
      // (`resolveSegmentationMode`), so no provider is consulted.
      isEnabled: () => useSettingsStore.getState().segmentationMode === 'sentences' && useSegmentationStore.getState().phase === 'ready',
      ...punctuationDiagnostics(deps.track),
    });
    let lastReady = false;
    return {
      runtime,
      punctuate: memoizePunctuator((lang, text) => runtime.punctuate(lang, text).then((r) => r?.text ?? null), deps.onModelCall),
      ready: () => (lastReady = runtime.enabled),
      get lastReady() { return lastReady; },
    };
  }
  ```

  (Fill `punctuationDiagnostics` by copying the hook's bodies — not a paraphrase: the console and panel lines are what people grep for.) In `consoleLedger.consistency.test.ts`: add `'src/app'` to `ROOTS` and `'src/app/'` to the zero rule's `CLEARED` list (its message stays).
- [ ] **Step 4: Run** the file and `npx vitest run src/lib/diagnostics`, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/app/punctuation.ts src/app/punctuation.test.ts src/lib/diagnostics/consoleLedger.consistency.test.ts
  git commit -m "feat(app): the app's punctuator, today's diagnostics and one model call per question"
  ```

**Probes:** none — nothing the preview runs imports `src/app/` until Task 9.

---

### Task 5: Frames into the Logs panel, one run's tallies, and the analytics the app adds

**Files:** Create `src/app/telemetry.ts`, `src/app/telemetry.test.ts`; Modify `src/lib/view/appViewSettings.ts` (+ test).

**Interfaces:**
- Consumes: `FramePort`, `AnalyticsPort` (`src/lib/session/ports`); `sentenceEnds`, `skeleton` (`sentenceEnd.ts`); `resolveSegmentationMode`, `resolveSegmentationSize` (`segmentationMode.ts`).
- Produces (`appViewSettings.ts`): `offerFor(boundaries: 'provider' | 'silence'): SegmentationOffer`, `selectedBoundaries()` (exported; `projectionFrom` uses `offerFor`).
- Produces (`telemetry.ts`): `interface SessionTally { seals: Record<string, number>; modelCalls: number; text: Record<string, { leg: LegName; model: string; chars: number; terminals: number }> }`; `interface FrameLog { readonly port: FramePort; countModelCall(): void; snapshot(): SessionTally; reset(): void }`; `createFrameLog()`; `teeFrames(first: FramePort, second?: FramePort): FramePort`; `interface StartInputs`; `sessionStartProperties(i: StartInputs)`; `appStartInputs(punctuationActive: boolean): StartInputs`; `interface RunFacts { pair: { source: string; target: string }; legs: readonly string[] }`; `sessionEndProperties(tally: SessionTally, run: RunFacts)`; `decorateSessionAnalytics(track: () => AnalyticsPort['track'], deps: { frames: FrameLog; startInputs(): StartInputs }): AnalyticsPort`.

- [ ] **Step 1: Write the failing tests.**
  - `appViewSettings.test.ts`: `offerFor('silence')` → `{ pause: true, auto: false, sizes: true }`; `offerFor('provider')` → `{ pause: false, auto: true, sizes: true }`. The existing `projectionFrom` cases keep passing.
  - `telemetry.test.ts` (mock `../services/ServiceFactory` as `appShape.test.ts`; diagnostic logs on, `clearLogs()` in `beforeEach`):
    1. A frame reaches the Logs panel under its leg: `port.frame('participant', { direction: 'in', type: 'local.asr.end', payload: { text: 'Hi.', modelId: 'm' } })` → the last entry has `clientId: 'participant'`, `eventType: 'local.asr.end'`, `source: 'server'`; `direction: 'out'` → `source: 'client'`. With logs off, nothing is recorded — and the tally still counts.
    2. Seals: two `local.segmentation.seal` frames on the speaker with reason `sentences` and one on the participant with reason `length` → `snapshot().seals` is `{ speaker_sentences: 2, participant_length: 1 }`; a seal whose text is `'('` is not counted; a seal without a string reason is not counted.
    3. ASR text: `local.asr.end` on the speaker with `{ text: 'Hello there. How are you?', modelId: 'moonshine tiny' }` → `snapshot().text['speaker|moonshine tiny']` is `{ leg: 'speaker', model: 'moonshine tiny', chars: 25, terminals: sentenceEnds('Hello there. How are you?').length }`; a second final adds to it; no `modelId` → model `'unknown'`.
    4. `countModelCall()` twice → `modelCalls` 2; `snapshot()` is a copy (mutating it changes nothing); `reset()` empties all three; frames of other types, or with no payload, count nothing and throw nothing.
    5. `teeFrames(a, b)` hands every frame to both, `a` first; without `b` it is `a`'s behaviour.
    6. `sessionStartProperties({ audio: { noiseSuppressionMode: 'standard', isRealVoicePassthroughEnabled: true, isMicMuted: false, isMonitorMuted: true }, segmentation: { mode: 'sentences', size: 2 }, punctuationActive: true })` → `{ noise_suppression_enabled: true, noise_suppression_mode: 'standard', real_voice_passthrough_enabled: true, input_device_on: true, monitor_device_on: false, sentence_segmentation_enabled: true, sentence_segmentation_active: true, sentence_segmentation_chunk_sentences: 2 }`; `noiseSuppressionMode: 'off'` → `noise_suppression_enabled: false`.
    7. `sessionEndProperties`: an empty tally → `{}`; `modelCalls: 3` with `legs: ['speaker']` → `segmentation_model_calls: { speaker: 3 }`, with both legs → `{ both: 3 }`; buckets `speaker|moonshine tiny` (200 chars, 3 ends) and `participant|m` (100 chars, 1 end) with pair `en → ja` → `segmentation_terminals_per_100: { speaker_moonshine_tiny_en: 1.5, participant_m_ja: 1 }`; a 0-char bucket is left out.
    8. `decorateSessionAnalytics`: `translation_session_start` resets the frame log, is sent once with the runner's properties plus `sessionStartProperties(startInputs())`; a later `translation_session_end` is sent with `sessionEndProperties(snapshot, { pair from the start event, legs from its channels })`; any other event passes through unchanged; `track()` is read at each call (swapping the bridge between two events reaches the new one).
    9. `appStartInputs(true)` reads the stores: `useAudioStore` `{ noiseSuppressionMode: 'off', isMicMuted: true, … }`, `useSettingsStore` `{ segmentationMode: 'sentences', sentenceSegmentationChunkSentences: 3 }`, nothing selected in `useProviderStore` → `segmentation: { mode: 'sentences', size: 3 }`, `punctuationActive: true`.
- [ ] **Step 2: Run** `npx vitest run src/app/telemetry.test.ts src/lib/view/appViewSettings.test.ts` — fails.
- [ ] **Step 3: Implement.**
  - `appViewSettings.ts`: export `selectedBoundaries` as it is, and

    ```ts
    /** What a provider whose boundaries are `boundaries` offers the stored cut: pause only where the boundaries are ours to time, Auto only where they are not. */
    export function offerFor(boundaries: 'provider' | 'silence'): SegmentationOffer {
      return { pause: boundaries === 'silence', auto: boundaries === 'provider', sizes: true };
    }
    ```

    with `projectionFrom` calling it in place of its inline object.
  - `telemetry.ts` — the doc names what it is: "What the app records about a run beyond what the runner sends (plan 1e-3a rulings 11, 12): every frame into the Logs panel, one run's segmentation tallies taken from the frames, and the start/end properties the app keeps." The pieces:

    ```ts
    export function createFrameLog(): FrameLog {
      let tally = emptyTally();
      return {
        port: {
          frame(leg, frame) {
            // The Logs panel's feed, under the leg's tab, as MainPanel's
            // `addRealtimeEvent(…, leg)` is today; it records nothing while
            // diagnostic logs are off. A frame's type is an open string — the
            // union names the old clients' events.
            useLogStore.getState().addRealtimeEvent(
              { type: frame.type as EventData['type'], data: frame.payload ?? {} },
              frame.direction === 'out' ? 'client' : 'server',
              frame.type,
              leg,
            );
            count(tally, leg, frame);
          },
        },
        countModelCall: () => { tally.modelCalls += 1; },
        snapshot: () => copyTally(tally),
        reset: () => { tally = emptyTally(); },
      };
    }
    ```

    `count` reads the payload as `Record<string, unknown>`: a `local.segmentation.seal` with a string `reason` and a `text` whose `skeleton()` is not empty adds 1 to `seals[\`${leg}_${reason}\`]`; a `local.asr.end` with a string `text` adds `text.length` and `sentenceEnds(text).length` to `text[\`${leg}|${model}\`]` (model: the string `modelId`, else `'unknown'`). `teeFrames(first, second)` returns `second ? { frame: (leg, f) => { first.frame(leg, f); second.frame(leg, f); } } : first`. `sessionStartProperties` / `sessionEndProperties` as the tests state (the key slug is today's: trimmed, whitespace runs → `_`, `'unknown'` when empty; per-100 rounded to one decimal, `Math.round(terminals / chars * 1000) / 10`). `appStartInputs`:

    ```ts
    /** The stores now — the run's shape froze the same values a moment ago. */
    export function appStartInputs(punctuationActive: boolean): StartInputs {
      const audio = useAudioStore.getState();
      const s = useSettingsStore.getState();
      const offer = offerFor(selectedBoundaries());
      return {
        audio,
        segmentation: {
          mode: resolveSegmentationMode(s.segmentationMode, offer),
          size: resolveSegmentationSize(s.sentenceSegmentationChunkSentences, offer),
        },
        punctuationActive,
      };
    }
    ```

    and the decorator:

    ```ts
    export function decorateSessionAnalytics(
      track: () => AnalyticsPort['track'],
      deps: { frames: FrameLog; startInputs(): StartInputs },
    ): AnalyticsPort {
      let run: RunFacts = { pair: { source: '', target: '' }, legs: [] };
      const send = <E extends keyof AnalyticsEvents>(event: E, properties: AnalyticsEvents[E]) => track()(event, properties);
      return {
        track(event, properties) {
          if (event === 'translation_session_start') {
            const start = properties as AnalyticsEvents['translation_session_start'];
            // A run's tallies start with it; the runner sends this the moment the run goes live.
            deps.frames.reset();
            run = { pair: { source: start.source_language, target: start.target_language }, legs: start.channels ?? [] };
            send('translation_session_start', { ...start, ...sessionStartProperties(deps.startInputs()) });
            return;
          }
          if (event === 'translation_session_end') {
            send('translation_session_end', { ...(properties as AnalyticsEvents['translation_session_end']), ...sessionEndProperties(deps.frames.snapshot(), run) });
            return;
          }
          send(event, properties);
        },
      };
    }
    ```
- [ ] **Step 4: Run** the two files and `npx vitest run src/lib/view`, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/app/telemetry.ts src/app/telemetry.test.ts src/lib/view/appViewSettings.ts src/lib/view/appViewSettings.test.ts
  git commit -m "feat(app): frames into the Logs panel, a run's segmentation tallies, and the analytics the app keeps"
  ```

**Probes:** `spine-surface-probe.mjs 'http://localhost:5199/?preview=spine&autostart=1&script=cjk&cut=sentences:1'` still passes (the projection's offer is now `offerFor`; nothing else the preview runs changed).

---

### Task 6: The root

**Files:** Create `src/app/session.ts`, `src/app/session.test.ts`, `src/app/useAppSession.ts`, `src/app/useAppSession.test.tsx`.

**Interfaces:**
- Consumes: `createRunner`; `readShapeFromStores`, `ensureReadyFromStores`, `persistIfUnchanged`, `appReplayAudio` (`appShape.ts`); `getAppAudio`, `AppAudio`; `createAppCapture`, `AppCapture`; `createConversationView`; `appProjectionSettings`; `createKaraoke`; `appSubtitleSession` (Task 3's options); `autoSaveConversation`; `createAppPunctuation` (Task 4); `createFrameLog`, `teeFrames`, `decorateSessionAnalytics`, `appStartInputs` (Task 5).
- Produces (`session.ts`):
  - `interface AppBridges { auth: AuthContext; track: AnalyticsPort['track']; notify: AutoSaveNotifier; /** The account's balance, refetched after a run; absent where there is none (the preview). */ refetchQuota?(): Promise<void> }`
  - `interface AppSessionOptions { capture?(app: OpenSource): OpenSource; microphoneRequired?(): boolean; refuse?(): boolean; observeFrames?: FramePort; clock?: Clock; newSessionId?(): string }` (the last two for tests)
  - `interface LoadedAudio extends AppAudio { capture: AppCapture }`
  - `interface AppSession { readonly runner: Runner; readonly view: Readable<ConversationViewState>; readonly karaoke: Readable<KaraokeState>; readonly subtitle: Readable<SubtitleSession>; readonly punctuation: AppPunctuation; readonly frames: FrameLog; audio(): Promise<LoadedAudio>; setBridges(next: Partial<AppBridges>): void }`
  - `createAppSession(options?: AppSessionOptions): AppSession`, `configureAppSession(options: AppSessionOptions): void`, `getAppSession(): AppSession`.
- Produces (`useAppSession.ts`): `useRunState(): RunState`, `useRunPhase(): RunState['phase']`, `useAppSessionBridges(refetchQuota?: () => Promise<void>): AuthContext`.

- [ ] **Step 1: Write the failing tests.**
  - `session.test.ts`. Mocks: `../services/ServiceFactory` (as `appShape.test.ts`); `../lib/audio/appAudio` (`getAppAudio: vi.fn(async () => ({ playback, testTone: async () => {} }))`, with a module-level `playback` whose `audio`, `held`, `clear`, `live`, `passthrough` are `vi.fn()`, whose `queues` are three `{ position: () => null, pending: 0, subscribe: () => () => {} }`, and whose `ttsTap` is `{ read: () => new Float32Array(0) }` — the shape `SpinePreview.test.tsx` mocks); `../lib/audio/appCapture` (as `SpinePreview.test.tsx` mocks it: an `openSource` that throws, an inert `echo`); `../lib/segmentation/PunctuationRuntime` (as in Task 4); `../lib/export/appAutoSave` (`autoSaveConversation: vi.fn(async () => 'saved')`). Keep each store's state from before the file (`const before = useXStore.getState()`) and put it back in `afterEach` with `setState(before, true)`, as `appSession.test.ts` does — later tasks stub store methods. A helper:

    ```ts
    async function setup(options: AppSessionOptions = {}) {
      const clock = createVirtualClock(0);
      await useProviderStore.getState().load(fakeProvider);
      useProviderStore.getState().select('fake');
      const session = createAppSession({
        clock,
        newSessionId: () => 'run1',
        capture: () => async () => createFakeSource(clock),
        microphoneRequired: () => false,
        ...options,
      });
      const track = vi.fn();
      session.setBridges({ track });
      return { clock, session, track };
    }
    ```

    `beforeEach` resets `useProviderStore` (`{ entries: {}, readiness: {}, selected: null, legs: ['speaker'] }`), `useAudioStore` (`{ mode: 'speaker', selectedInputDevice: null }`), and the mocks. Cases:
    1. **Builds no playback until asked.** After `setup()`, `getAppAudio` was not called; `session.audio()` twice → one call, the same promise, resolving to an object with `playback` and a `capture` with `openSource` and `echo`.
    2. **A leg waits for the playback, and the run plays through it.** `await session.runner.start()` → phase `running`, `getAppAudio` called once, `playback.live` called with `true`.
    3. **One karaoke.** Before the playback loads, `session.karaoke.get()` has an empty `lit` and `replaying: null`, and is the same object on every call; a subscribed listener is called once `await session.audio()` has resolved; `session.karaoke` is the same object before and after.
    4. **A run's end auto-saves once, then refetches the balance.** `setBridges({ refetchQuota })` with a spy; start, `await session.runner.stop()` → `autoSaveConversation` called once with `(legs, session.runner.conversation.info, notify)` where `legs` is the run's one speaker leg and `notify` has a `showToast`; `refetchQuota` called once, after it (record the order).
    5. **A refused start saves nothing and loads nothing.** `setup({ refuse: () => true })` → start → `lastEnd` `{ reason: 'refused', notice: { code: 'no_provider' } }`; `autoSaveConversation` and `getAppAudio` not called.
    6. **The session events carry what the app keeps.** `useAudioStore.setState({ noiseSuppressionMode: 'standard', isMicMuted: false, isMonitorMuted: true, isRealVoicePassthroughEnabled: true })`, `useSettingsStore.setState({ segmentationMode: 'sentences', sentenceSegmentationChunkSentences: 2 })`, `useSegmentationStore.setState({ phase: 'ready' })`; start → `track` got `translation_session_start` with `objectContaining({ session_id: 'run1', noise_suppression_enabled: true, noise_suppression_mode: 'standard', real_voice_passthrough_enabled: true, input_device_on: true, monitor_device_on: false, sentence_segmentation_enabled: true, sentence_segmentation_active: true, sentence_segmentation_chunk_sentences: 2 })` and no `model` key; then `session.frames.port.frame('speaker', { direction: 'out', type: 'local.segmentation.seal', payload: { reason: 'sentences', text: 'One.' } })`, stop → `translation_session_end` has `segmentation_seals: { speaker_sentences: 1 }` and no `translation_count` key.
    7. **Asks for a microphone unless told otherwise.** `setup({ microphoneRequired: undefined })` with no input device → `session.subtitle.get()` has `canStart: false` and `idle.code` `'no_microphone'`; the default `setup()` → `canStart: true`.
    8. **One per page.** `vi.resetModules()`, then `const m = await import('./session')`: `m.configureAppSession({ refuse: () => true, clock: createVirtualClock(0) })`, `m.getAppSession() === m.getAppSession()`; a later `m.configureAppSession({})` changes nothing (a start is still refused with `no_provider`).
  - `useAppSession.test.tsx`: the same five mocks, plus `../lib/analytics` (`useAnalytics: () => ({ trackEvent })`, a hoisted spy) and `../lib/auth/hooks` (`useAuth: () => ({ isSignedIn: true, getToken: async () => 't' })`). At module level, before any render: `configureAppSession({ clock: createVirtualClock(0), newSessionId: () => 'r1', capture: () => async () => createFakeSource(createVirtualClock(0)), microphoneRequired: () => false })`; `beforeAll` loads and selects the fake. Cases (in order; each stops its run):
    1. `renderHook(() => useRunPhase())` → `'idle'`; `await act(() => getAppSession().runner.start())` → `'running'`; after `stop()` → `'idle'`.
    2. `useRunState()` while running has `phase: 'running'` and a numeric `since`.
    3. `renderHook(() => useAppSessionBridges(refetch))` → `result.current.signedIn` is true; a run's start sends `translation_session_start` (`objectContaining({ session_id: 'r1' })`) through `trackEvent`; its stop calls `refetch` once.
- [ ] **Step 2: Run** `npx vitest run src/app` — the new files fail.
- [ ] **Step 3: Implement** `session.ts` (doc: "The app's session (plan 1e-3a): the one composition root every surface reaches — MainPanel, the Electron takeover, the settings lock, the close handshake — without a React tree. Nothing is built at import; `getAppSession()` builds on its first call, and the playback loads on the first `audio()` or leg."):

  ```ts
  const IDLE: KaraokeState = { lit: new Map(), replaying: null };

  export function createAppSession(options: AppSessionOptions = {}): AppSession {
    const clock = options.clock ?? realClock;
    const bridges: AppBridges = {
      auth: { signedIn: false, getToken: async () => null },
      track: () => {},
      notify: { showToast: () => {} },
    };
    const frames = createFrameLog();
    const punctuation = createAppPunctuation({ track: () => bridges.track, onModelCall: () => frames.countModelCall() });

    // Until the playback loads, a clip has nowhere to go; a leg never opens before it.
    let playback: Playback | null = null;
    let openLeg: OpenSource | null = null;
    let loading: Promise<LoadedAudio> | null = null;

    const refetchQuota = () => {
      const refetch = bridges.refetchQuota;
      if (!refetch) return;
      // Not awaited: the ending is bounded, a network call is not.
      void refetch().catch((error: unknown) => reportWarning('AppSession', `Refreshing the account after the session failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'session:refetch' }));
    };

    const runner: Runner = createRunner({
      clock,
      platform: getEnvironment(),
      readShape: () => (options.refuse?.() ? null : readShapeFromStores(bridges.auth)),
      ensureReady: ensureReadyFromStores,
      persistIfUnchanged,
      replayAudio: appReplayAudio,
      openSource: async (leg, signal) => {
        await audio();
        return openLeg!(leg, signal);
      },
      playback: {
        audio: (leg, ref, pcm) => playback?.audio(leg, ref, pcm),
        held: (held) => playback?.held(held),
        clear: () => playback?.clear(),
        live: (on) => playback?.live(on),
      },
      analytics: decorateSessionAnalytics(() => bridges.track, { frames, startInputs: () => appStartInputs(punctuation.lastReady) }),
      frames: teeFrames(frames.port, options.observeFrames),
      punctuate: punctuation.punctuate,
      punctuationReady: () => punctuation.ready(),
      newSessionId: options.newSessionId ?? (() => crypto.randomUUID()),
      onRunEnded: async (legs) => {
        try {
          // The one auto-save per run (roadmap, plan 1d-3).
          await autoSaveConversation(legs, runner.conversation.info, bridges.notify);
        } finally {
          refetchQuota();
        }
      },
    });

    const view = createConversationView(runner.conversation, appProjectionSettings(), clock);
    const subtitle = appSubtitleSession(runner, view, { microphoneRequired: options.microphoneRequired ?? (() => true) });

    // Karaoke over the playback's queues, behind one identity: nothing lit until the playback loads.
    let karaokeReal: Readable<KaraokeState> | null = null;
    const karaokeListeners = new Set<() => void>();
    const notifyKaraoke = () => { for (const listener of [...karaokeListeners]) listener(); };
    const karaoke: Readable<KaraokeState> = {
      get: () => karaokeReal?.get() ?? IDLE,
      subscribe(listener) {
        karaokeListeners.add(listener);
        return () => { karaokeListeners.delete(listener); };
      },
    };

    function audio(): Promise<LoadedAudio> {
      loading ??= getAppAudio().then(
        (app) => {
          const capture = createAppCapture(app.playback);
          playback = app.playback;
          openLeg = options.capture ? options.capture(capture.openSource) : capture.openSource;
          if (!karaokeReal) {
            const real = createKaraoke(app.playback.queues, view, clock);
            karaokeReal = real;
            real.subscribe(notifyKaraoke);
            notifyKaraoke();
          }
          return { ...app, capture };
        },
        (error: unknown) => {
          loading = null;
          throw error;
        },
      );
      return loading;
    }

    return {
      runner, view, karaoke, subtitle, punctuation, frames,
      audio,
      setBridges(next) { Object.assign(bridges, next); },
    };
  }

  let configured: AppSessionOptions = {};
  let session: AppSession | null = null;

  /** The preview's stand-ins, before the page's session is built. Once built, a later call changes nothing — a hot reload re-runs the preview's module. */
  export function configureAppSession(options: AppSessionOptions): void {
    if (session) return;
    configured = options;
  }

  /** The page's one session, built on the first call. */
  export function getAppSession(): AppSession {
    session ??= createAppSession(configured);
    return session;
  }
  ```

  Doc every `AppSessionOptions` member (ruling 3's wording). `useAppSession.ts` (doc: "The app session's React side: the run's state, and the bridges the runner reads — sign-in, analytics, toasts, the balance refetch — which only React can reach. The only file under `src/app` that imports React or `src/lib/analytics.ts`."):

  ```ts
  export function useRunState(): RunState {
    return useStore(getAppSession().runner.state);
  }

  export function useRunPhase(): RunState['phase'] {
    return useStore(getAppSession().runner.state, (s) => s.phase);
  }

  /** Hands the session the page's sign-in, analytics, toasts and balance refetch; returns the sign-in for the settings panel. */
  export function useAppSessionBridges(refetchQuota?: () => Promise<void>): AuthContext {
    const { isSignedIn, getToken } = useAuth();
    const { trackEvent } = useAnalytics();
    const { showToast } = useToast();
    const auth = useMemo(() => ({ signedIn: isSignedIn, getToken }), [isSignedIn, getToken]);
    // Every render, as the preview's bridge did: the runner reads them when it needs them, never a stale closure.
    getAppSession().setBridges({ auth, track: trackEvent as AnalyticsPort['track'], notify: { showToast }, refetchQuota });
    return auth;
  }
  ```

  (`useToast` from `../components/Toast`; `useAuth` from `../lib/auth/hooks`.)
- [ ] **Step 4: Run** `npx vitest run src/app`, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/app/session.ts src/app/session.test.ts src/app/useAppSession.ts src/app/useAppSession.test.tsx
  git commit -m "feat(app): the composition root — one runner, its view, karaoke, subtitle session, capture and ports"
  ```

**Probes:** none — the preview still runs its own lazies until Task 9.

---

### Task 7: A local provider checks itself, and says why in words

**Files:** Create `src/app/readiness.ts`, `src/app/readiness.test.ts`; Modify `src/lib/provider/types.ts`, `src/providers/localInference/check.ts` (+ `check.test.ts`), `src/providers/localInference/provider.ts` (+ `provider.test.ts`), `src/components/providers/CredentialForm.tsx` (+ test), `src/components/providers/ProviderPanel.tsx` (+ test).

**Interfaces:**
- Produces: `Provider.watchReadiness?(onChange: () => void): () => void`; `watchLocalInferenceReadiness(onChange)` (`check.ts`); `READINESS_DELAY_MS = 150`, `interface ReadinessDriverDeps { runner: Pick<Runner, 'state'>; providers(): readonly AnyProvider[]; auth(): AuthContext; clock: Pick<Clock, 'setTimeout'>; delayMs?: number }`, `driveLocalReadiness(deps): () => void` (`readiness.ts`); `CredentialForm`'s `onCheck` becomes optional.
- Consumed by: Task 8 (`attach()` runs the driver).

- [ ] **Step 1: Write the failing tests.**
  - `readiness.test.ts` (mock `../services/ServiceFactory` as `appShape.test.ts`). A local probe provider: `{ ...fakeProvider, id: 'probe', kind: 'local', credentials: { keys: [], fields: () => [], read: () => ({}) }, check: vi.fn(async () => ({ ok: true })), watchReadiness: (fn) => { changed = fn; return off; } }` (`off` a spy); the store at `{ entries: { probe: { settings: {}, credentials: {}, pair: { source: 'en', target: 'ja' } } }, readiness: {}, selected: 'probe', legs: ['speaker'] }`; `runner = { state: createStore<RunState>(() => ({ phase: 'idle' })) }`; `clock = createVirtualClock(0)`; `flush = () => new Promise((r) => setTimeout(r, 0))`. Cases:
    1. Checks a loaded local provider whose readiness is unknown, once, `READINESS_DELAY_MS` after it starts — not before (`advance(149)` → no call; `advance(1)` + flush → one call; the store's readiness is `ready`).
    2. A burst is one check: after the first check, three `setState({ readiness: { probe: { state: 'unknown' } } })` within 100 ms → one more check after the delay.
    3. Leaves a networked provider alone: the same probe with `kind: 'own-key'` → no check, no watch.
    4. Waits for idle: runner `starting`, readiness reset → `advance(1000)` → no check; runner back to `idle` → one check after the delay.
    5. Re-checks when the provider's own inputs change, even when ready: after the first check, `changed()` → one more check after the delay. Inputs changing during a run (`starting`) → no check then, one check once idle again.
    6. Follows the selection and stops on detach: selecting a second local provider calls the first's `off` and watches the second; after `detach()`, a reset triggers no check and the watch's `off` was called.
  - `check.test.ts`: the `useModelStore` mock gains `subscribe: mockSubscribe` (records `(selector, listener)`, returns an off spy). `watchLocalInferenceReadiness(onChange)` subscribes with a selector that returns `modelStatuses` from `{ modelStatuses: { a: 'downloaded' } }`; calling the recorded listener calls `onChange`; its return is the off spy.
  - `provider.test.ts`: `localInferenceProvider.watchReadiness` is `watchLocalInferenceReadiness`.
  - `CredentialForm.test.tsx`: without `onCheck` and without fields → no button at all; a not-ready readiness with `code: 'local_models_missing'` shows `notices.local_models_missing` (the file's `t` mock returns the key) in `.validation-message.error`; an uncoded reason still shows as it is (the existing case).
  - `ProviderPanel.test.tsx`: `providers={[{ ...fakeProvider, kind: 'local' }]}` → `screen.queryByTitle('simpleSettings.validate')` is null; the fake itself (`own-key`) still offers the check (the existing cases).
- [ ] **Step 2: Run** `npx vitest run src/app/readiness.test.ts src/providers/localInference src/components/providers` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `types.ts`, beside `check`:

    ```ts
    /**
     * Calls back when something `check` reads besides the settings,
     * credentials, pair and legs has changed — a local engine's models
     * downloading. The app re-checks a local provider then (plan 1e-3a
     * ruling 6). Returns the unsubscribe.
     */
    watchReadiness?(onChange: () => void): () => void;
    ```
  - `check.ts`:

    ```ts
    /** `check` reads the model store: a download, a delete or the store's first load can change its answer. */
    export function watchLocalInferenceReadiness(onChange: () => void): () => void {
      return useModelStore.subscribe((s) => s.modelStatuses, () => onChange());
    }
    ```

    and `provider.ts` sets `watchReadiness: watchLocalInferenceReadiness`.
  - `readiness.ts` (doc: "1e-3 ruling 16: a local provider's readiness is checked automatically — no Validate button — and worded by its code. …"):

    ```ts
    export const READINESS_DELAY_MS = 150;

    export function driveLocalReadiness({ runner, providers, auth, clock, delayMs = READINESS_DELAY_MS }: ReadinessDriverDeps): () => void {
      let cancel: (() => void) | null = null;
      let watched: { id: string; off: () => void } | null = null;
      /** Its inputs changed while a run was on: check once the runner is idle again. */
      let stale = false;
      const idle = () => runner.state.getState().phase === 'idle';
      const current = (): AnyProvider | undefined => {
        const { selected, entries } = useProviderStore.getState();
        const p = providers().find((candidate) => candidate.id === selected);
        return p && p.kind === 'local' && entries[p.id] ? p : undefined;
      };
      const check = () => {
        cancel = null;
        const p = current();
        if (p && idle()) void useProviderStore.getState().refreshReadiness(p, auth());
      };
      const schedule = () => {
        cancel?.();
        cancel = clock.setTimeout(check, delayMs);
      };
      const inputsChanged = () => {
        if (idle()) schedule();
        else stale = true;
      };
      const evaluate = () => {
        const p = current();
        if (watched?.id !== p?.id) {
          watched?.off();
          watched = p ? { id: p.id, off: p.watchReadiness?.(inputsChanged) ?? (() => {}) } : null;
        }
        if (!p || !idle()) return;
        const readiness = useProviderStore.getState().readiness[p.id];
        if (stale || !readiness || readiness.state === 'unknown') {
          stale = false;
          schedule();
        }
      };
      const offStore = useProviderStore.subscribe(evaluate);
      const offRun = runner.state.subscribe(evaluate);
      evaluate();
      return () => {
        offStore();
        offRun();
        watched?.off();
        watched = null;
        cancel?.();
        cancel = null;
      };
    }
    ```
  - `CredentialForm.tsx`: `onCheck?(): void` (doc: "Absent: no check button — a local provider checks itself"); the button exists only with `onCheck`; with no fields and no `onCheck` nothing but the reason renders; the reason renders `noticeText(t, { code: readiness.code, params: readiness.params, message: readiness.reason })`.
  - `ProviderPanel.tsx`: `onCheck={provider.kind === 'local' ? undefined : () => void refreshReadiness(provider, auth)}`.
- [ ] **Step 4: Run** the same set, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/app/readiness.ts src/app/readiness.test.ts src/lib/provider/types.ts src/providers/localInference/check.ts src/providers/localInference/check.test.ts src/providers/localInference/provider.ts src/providers/localInference/provider.test.ts src/components/providers
  git commit -m "feat(app): a local provider checks itself and says why in words"
  ```

**Probes:** `spine-local-probe.mjs` (default) still passes — the panel shows no Validate button for LocalInference, and the run checks readiness at its start as before (the driver is attached in Task 9).

---

### Task 8: The page's wiring, and the stores the app loads

**Files:** Create `src/app/busy.ts`, `src/app/busy.test.ts`, `src/app/loadStores.ts`, `src/app/loadStores.test.ts`; Modify `src/app/session.ts`, `src/app/session.test.ts`, `src/routes/Home.tsx`.

**Interfaces:**
- Consumes: `watchLegsFromStores` (`appShape.ts`), `driveLocalReadiness` (Task 7), `presentProviders`, `isElectron`.
- Produces: `trackBusy(runner: Pick<Runner, 'state' | 'settled'>, send: (busy: boolean) => void): () => void`; `loadSessionStores(): Promise<void>`; `AppSessionOptions.ipc?: { invoke(channel: string, data?: unknown): Promise<unknown> } | null` (default: `window.electron` in Electron, else none); `AppSession.attach(): () => void`.

- [ ] **Step 1: Write the failing tests.**
  - `busy.test.ts`, over `state = createStore<RunState>(() => ({ phase: 'idle' }))` and a `settled()` whose promise the test resolves by hand (a new one per call, kept in an array):
    1. Says busy once when a start leaves idle, and nothing more while it runs (`starting`, `running` → `[true]`).
    2. Says not busy only once the ending has settled: `stopping`, `idle` → still `[true]`; resolve the settle, flush → `[true, false]`.
    3. A start before the last ending settled stays busy: `idle` (settle pending), `starting`, resolve that first settle → `[true]`; later `idle`, resolve its settle → `[true, false]`.
    4. A refused start: `starting`, `idle`, settle → `[true, false]`.
    5. After unsubscribing, nothing is sent.
  - `loadStores.test.ts` (a `ServiceFactory` mock over a `stored` map and a `setSetting` spy, as `ProviderPanel.test.tsx` has): stored `settings.common.turnMode = 'push-to-talk'`, `settings.routing.meeting = false`; `useSegmentationStore.setState({ refresh: vi.fn(async () => {}) })`; the provider store empty with nothing selected → `await loadSessionStores()` → turn mode `push-to-talk`, `meeting` false, `refresh` called once, `entries.localInference` loaded (the first provider offered), `selected` still null, `setSetting` never called. A selected `fake` loads the fake's entry instead. A turn-mode load that rejects (`useTurnModeStore.setState({ load: vi.fn(async () => { throw new Error('disk') }) })`) is reported once as a warning (logs on, `settleReports()`), and the routing, pack and provider still load. Every stubbed store is put back in `afterEach` (`setState(before, true)`).
  - `session.test.ts`, a new `describe('attach')`:
    1. `pagehide` abandons the run once attached: start, `detach = session.attach()`, `window.dispatchEvent(new Event('pagehide'))` → phase `idle`, `lastEnd` `{ reason: 'user' }`, `autoSaveConversation` not called. After `detach()`, a new run survives a `pagehide`.
    2. Keeps the provider store's legs on the audio mode: attached, `useAudioStore.setState({ mode: 'both' })` → `useProviderStore.getState().legs` is `['speaker', 'participant']`.
    3. Checks a local provider by itself: `useProviderStore.setState({ selected: 'localInference', entries: { localInference: { settings: {}, credentials: {}, pair: { source: 'ja', target: 'en' } } }, readiness: {}, refreshReadiness: spy })`, attach, `clock.advance(READINESS_DELAY_MS)` → `spy` called with `localInferenceProvider` and the bridges' `auth` (the `afterEach` from Task 6 puts the real `refreshReadiness` back).
    4. Tells Electron it is busy through a run: `setup({ ipc: { invoke } })`, attach, start → `invoke('app:session-busy', true)`; stop, `await session.runner.settled()`, flush → `invoke('app:session-busy', false)`. With `ipc: null` nothing is invoked.
- [ ] **Step 2: Run** `npx vitest run src/app` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `busy.ts` (doc: plan 1e-3a ruling 13 — busy from a start leaving idle until idle and `settled()`):

    ```ts
    export function trackBusy(runner: Pick<Runner, 'state' | 'settled'>, send: (busy: boolean) => void): () => void {
      let busy = false;
      /** Bumped on every change: a settle that resolves after a newer change says nothing. */
      let generation = 0;
      return runner.state.subscribe((state) => {
        generation += 1;
        if (state.phase !== 'idle') {
          if (!busy) {
            busy = true;
            send(true);
          }
          return;
        }
        if (!busy) return;
        const mine = generation;
        void runner.settled().then(() => {
          if (mine !== generation || !busy) return;
          busy = false;
          send(false);
        });
      });
    }
    ```
  - `loadStores.ts` (doc: "What a run reads, loaded before the first start (roadmap 1e-1): the turn mode, the routing switches, the punctuation pack's phase, and the selected provider's entry — or the first offered, which a run would start. Reads only: nothing is written and nothing is selected; the stored selection and the turn-mode migration are plan 1e-3b's."):

    ```ts
    export async function loadSessionStores(): Promise<void> {
      const { selected } = useProviderStore.getState();
      const offered = presentProviders();
      const provider = offered.find((p) => p.id === selected) ?? offered[0];
      const loads: Array<[string, () => Promise<void>]> = [
        ['turn mode', () => useTurnModeStore.getState().load()],
        ['routing switches', () => useRoutingStore.getState().load()],
        ['punctuation pack', () => useSegmentationStore.getState().refresh()],
      ];
      if (provider) loads.push([`${provider.id} settings`, () => useProviderStore.getState().load(provider)]);
      await Promise.all(loads.map(async ([what, load]) => {
        try {
          await load();
        } catch (error) {
          reportWarning('AppSession', `Loading the ${what} failed: ${describeCause(error)}`, { cause: error, dedupeKey: `load:${what}` });
        }
      }));
    }
    ```
  - `session.ts`: `AppSessionOptions` gains `ipc` (doc: "Electron's IPC, for the busy flag; default `window.electron` in Electron, none elsewhere; `null` for none"); `AppSession` gains `attach(): () => void`:

    ```ts
    attach() {
      const offs: Array<() => void> = [
        // The panel's readiness is about the legs a start would open: the audio mode's.
        watchLegsFromStores(),
        driveLocalReadiness({ runner, providers: () => presentProviders(), auth: () => bridges.auth, clock }),
      ];
      // A reload, the window or side panel closing, a page frozen into the
      // back/forward cache: close every leg and capture now; nothing is saved
      // (spec: "Stopping, and closing the window"; ruling 14).
      const onPageHide = () => runner.abandon();
      window.addEventListener('pagehide', onPageHide);
      offs.push(() => window.removeEventListener('pagehide', onPageHide));
      const ipc = options.ipc === undefined ? (isElectron() ? window.electron : null) : options.ipc;
      if (ipc) {
        offs.push(trackBusy(runner, (busy) => {
          void ipc.invoke('app:session-busy', busy).catch((error: unknown) =>
            reportWarning('AppSession', `Telling the app the session is ${busy ? 'busy' : 'idle'} failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'session:busy' }));
        }));
      }
      let detached = false;
      return () => {
        if (detached) return;
        detached = true;
        for (const off of offs.reverse()) off();
      };
    },
    ```
  - `Home.tsx`: inside the existing mount effect, after the hydration `Promise.all`:

    ```tsx
    // The new session's stores (plan 1e-3a): loaded now, read by nothing here
    // until plan 1e-3b switches MainPanel over. Reads only.
    void loadSessionStores();
    ```

    with `import { loadSessionStores } from '../app/loadStores';`. Nothing else in the file changes.
- [ ] **Step 4: Run** `npx vitest run src/app`, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/app/busy.ts src/app/busy.test.ts src/app/loadStores.ts src/app/loadStores.test.ts src/app/session.ts src/app/session.test.ts src/routes/Home.tsx
  git commit -m "feat(app): the page's wiring — pagehide, legs, readiness, busy — and the stores the app loads"
  ```

**Probes:** none of the `spine-*` probes change (the preview attaches in Task 9). Besides them, the controller opens `http://localhost:5199/` once and confirms the running app loads as before, with no `AppSession` warning in the console.

---

### Task 9: The preview on the root

**Files:** Modify `src/components/dev/SpinePreview.tsx`, `src/components/dev/SpinePreview.test.tsx`.

**Interfaces:**
- Consumes: `configureAppSession`, `getAppSession`, `LoadedAudio` (Task 6); `useAppSessionBridges`, `useRunPhase`, `useRunState` (Task 6); `loadSessionStores`, `AppSession.attach` (Task 8).
- Produces: nothing new; every URL parameter keeps its meaning (`autostart`, `script`, `cut`, `turn`, `compact`, `autosave`, `models`, `pair`, `punctuation`, `provider`, `refuse`, `capture=device`, `subtitle`, `overlay`).

- [ ] **Step 1: The preview.** Delete the page's own composition: `bridge`, `playbackBridge`, `previewRunner` / `getPreviewRunner`, `previewPunctuation` / `getPreviewPunctuation`, `previewView` / `getPreviewView`, `previewSession` / `getPreviewSession`, `IDLE`, `NO_KARAOKE`, the `karaoke` state and the store loads in the mount effects. Keep `captured`, `counting`, `sealCounts`, `framesBridge` and `useSealProbe` as they are (the seal line counts for the page's lifetime). At module level, after them:

  ```tsx
  /** A URL parameter of this page, read when asked — the tests change the URL between renders. */
  const param = (name: string) => new URLSearchParams(window.location.search).get(name);

  /** `&capture=device`: the session runs on the app's own capture (the microphone for the speaker leg) instead of the fake source. */
  const deviceCapture = () => param('capture') === 'device';

  // The page's session is the app's (plan 1e-3a): the same runner, view,
  // karaoke, subtitle session, punctuator, frames, analytics and auto-save the
  // app runs, with this page's stand-ins, each read per call as before.
  configureAppSession({
    capture: (app) => (leg, signal) => (deviceCapture()
      ? counting(app)(leg, signal)
      // Under a manual turn, a held press needs voice to end (not cancel) the
      // turn (`MIN_VOICED_MS`) — the fake source stays voiced throughout.
      : Promise.resolve(createFakeSource(realClock, { voiced: manualTurnFromUrl() }))),
    // The fake source needs no microphone; the app's capture does (1e-3 ruling 5).
    microphoneRequired: deviceCapture,
    // `&refuse=1`: no shape, so every start is refused — the idle line's check.
    refuse: () => param('refuse') === '1',
    observeFrames: framesBridge,
  });
  ```

  `PreviewConversation` drops its `runner` prop and reads `useRunState()`. `PreviewOverlayFrame`'s doc loses the paragraph about karaoke starting as a placeholder (the session's karaoke keeps one identity, so the publisher starts once per port). `SpinePreview()`:
  - `const auth = useAppSessionBridges();`, `const session = getAppSession();`, `const { runner } = session;`, `const phase = useRunPhase();` — in place of `useAuth` / `useAnalytics` / `useToast`, the bridge writes, `getPreviewRunner()` and `useStore(runner.state, …)`.
  - `const [audio, setAudio] = useState<LoadedAudio | null>(null);` and, in place of the two mount effects and the `watchLegsFromStores` / `pagehide` effects:

    ```tsx
    // What a run reads, loaded the way the app loads it (Home.tsx): the turn
    // mode, the routing switches, the punctuation pack's phase — without which
    // the punctuator would see `unknown`, never `ready` — and the provider.
    useEffect(() => { void loadSessionStores(); }, []);
    // The page's wiring, as the app's will be (plan 1e-3b): pagehide → abandon,
    // the provider store's legs, a local provider checking itself.
    useEffect(() => session.attach(), [session]);
    useEffect(() => {
      let live = true;
      session.audio().then(
        (loaded) => { if (live) setAudio(loaded); },
        (error: unknown) => reportError('SpinePreview', `The playback did not load: ${describeCause(error)}`, { cause: error }),
      );
      return () => { live = false; };
    }, [session]);
    ```
  - The fake-selection effect, `previewParams`, `subtitleControls` and the autostart effect stay as they are (the `&punctuation=1` comment names "the session's punctuator" instead of `getPreviewPunctuation`).
  - The render passes `session.view`, `session.karaoke`, `session.subtitle` where it passed `getPreviewView(runner)`, `karaoke ?? NO_KARAOKE` and `session`; `SessionControls` gets `capture={deviceCapture() ? () => ({ ...captured }) : undefined}`.
  - The component's doc says the page runs the app's session (`src/app/session.ts`) with its two stand-ins.
  - Remove the imports this leaves unused.
- [ ] **Step 2: The test.** `SpinePreview.test.tsx` keeps every case and its mocks (the root imports the same `runner`, `appAudio` and `appCapture` modules the file mocks). Add, before the `&punctuation=1` case:
  - "runs the fake source without asking for a microphone": `render(<SpinePreview />)`; wait for `Script`; `getAppSession().subtitle.get()` has `canStart: true` and its idle has no `no_microphone` code (import `getAppSession` from `../../app/session`).
  - "is the app's session: the page's Start drives the root's runner": after the render, `getAppSession().runner.state.getState()` is `{ phase: 'idle' }`; clicking the dev `Start` button (`screen.getByRole('button', { name: 'Start' })`) changes it — a run started, or a refusal recorded its `lastEnd` (`await waitFor(() => expect(getAppSession().runner.state.getState()).not.toEqual({ phase: 'idle' }))`). Then `await act(() => getAppSession().runner.stop())` and `await getAppSession().runner.settled()`, so the last case still finds the runner idle and starts it exactly once (its `runnerStart.mockReset()` stays).
- [ ] **Step 3: Run** `npx vitest run src/components/dev src/app`, then the full suite and the gates. Do not start a dev server or run the probes.
- [ ] **Step 4: Commit**

  ```bash
  git add src/components/dev/SpinePreview.tsx src/components/dev/SpinePreview.test.tsx
  git commit -m "refactor(dev): the preview runs the app's session"
  ```

**Probes:** the controller runs every probe against a fresh vite, each to its own header's pass criteria:
- `spine-surface-probe.mjs` (default; `'http://localhost:5199/?preview=spine&autostart=1&script=cjk&cut=sentences:1'`; `'…&script=notices'`): four rows and one header, karaoke lit and at least once mid-row, the notice in its words.
- `spine-audio-probe.mjs` (default; `'http://localhost:5199/?preview=spine&autostart=1&capture=device'`): clips heard, a tap peak, and the fake microphone captured.
- `spine-subtitle-probe.mjs` (default; `…&script=cjk&cut=sentences:1`; `…&turn=push-to-talk`; `…&turn=push-to-translate`): both surfaces agree, karaoke lit on both, the hold reaches both.
- `spine-export-probe.mjs`: the menu's .txt and the Stop's auto-save both carry the header, `Provider: fake`, the models and the block — exactly one auto-saved file — and `&refuse=1` leaves `Choose a provider in Settings before starting.`
- `spine-local-probe.mjs` (default) and `spine-local-probe.mjs --sentences`: a source and a translation row; with `--sentences`, two of each and at least one `sentences` seal on the page's seal line.

---

## Self-review

- **Scope (`1e3-shell.md` §3 "1e-3a", adjusted by the 1e-3 rulings).** The root with runner, view, karaoke, subtitle session (Task 6); the `PunctuationRuntime` with today's telemetry and the `(lang, text)` memo (Task 4; roadmap 1e-2 → 1e-3, and 1e-2b's "wire `punctuationReady` from `enabled`"); `AppCapture` and the auth / analytics / toast bridges (Task 6); the `FramePort` → `logStore` adapter with per-leg seal tallies and the analytics decorator for ruling 13's properties (Task 5; 1e-2b's "seal-count analytics"); `onRunEnded` with auto-save and the quota refetch (Task 6) and `app:session-busy` (Task 8, ruling 13); `pagehide → abandon` and `watchLegsFromStores` (Task 8; roadmap 1e-1 → 1e-3); `useRunState` / `useRunPhase` (Task 6); the store loading, in `Home.tsx` (Task 8; roadmap "stores loaded before the first start", `routingStore` included); the stored-settings mapping as pure functions — provider id map, turn-mode migration, never-overwrite (Task 1; 1e-3 rulings 2, 3); the local readiness driver and readiness codes (Tasks 7, 2; 1e-3 ruling 16, roadmap "readiness reasons in words by code"); words for `silent_no_permission` (Task 2); the loopback-denied code (Task 3; 1e-3 ruling 6); push-to-translate passthrough (Task 3; 1e-3 ruling 4); the missing-microphone predicate (Task 3; 1e-3 ruling 5); the preview on the root (Task 9). Nothing user-visible: the running app gains one read-only call.
- **Left for 1e-3b, as its rulings place them:** the loopback modal and `onFix` deep links off the new codes, the `app:close-requested` answer and the main process's bound (1e-3 ruling 12), applying Task 1's mapping and persisting the selection, the turn-mode control, and `no_asr`'s `{{source}}` as a language name (the params carry the code; naming it is the surface's).
- **Placeholders:** one deliberate instruction instead of code — Task 4's `punctuationDiagnostics` body is copied verbatim from `useSegmentationRuntime.ts` (named file, named callbacks); everything else that is decided is written out.
- **Types across tasks:** `CheckResult` / `Readiness` codes (Task 2) are read by `run.ts` (Task 2), the subtitle idle (Tasks 2, 3) and `CredentialForm` (Task 7); `microphoneMissing` / `NO_MICROPHONE` (Task 3) are used by `subtitleSession` and `appSubtitleSession` (Task 3) and the root's default (Task 6); `SourceOpenError` / `LOOPBACK_DENIED` (Task 3) reach the runner as an `AdapterStartError`; `AppPunctuation.lastReady` (Task 4) feeds `appStartInputs` (Task 5) in the root (Task 6); `FrameLog.countModelCall` (Task 5) is the memo's `onMiss` (Tasks 4, 6); `teeFrames` (Task 5) carries `observeFrames` (Task 6) for the preview (Task 9); `driveLocalReadiness` and `Provider.watchReadiness` (Task 7) run in `attach()` (Task 8); `trackBusy` and `loadSessionStores` (Task 8) are what the preview (Task 9) and 1e-3b use.
- **Stated departures from today:** `segmentation_model_calls` is keyed `both` for a two-leg run (ruling 11); the tallies come from frames, not L1 (ruling 11); `pagehide` abandons a page going into the back/forward cache too (ruling 14); a local provider shows no Validate button (1e-3 ruling 16). All four reach only the preview in this plan.
