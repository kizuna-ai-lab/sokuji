# Client contract — Stage 1e-3b-2: Settings, and the switch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Settings side of the new session — the provider area in pieces over `providerStore`, LocalInference's chips and memory estimate in its own component, its model management knowing the legs, the global turn mode with the Output toggles, the participant-speech switch — prove it in the preview, then **switch the app in one commit**: MainPanel, the Electron takeover and Settings onto the app session, every writer of the session's stored settings onto `providerStore`, the page's wiring owned by one component, the source-reading tests replaced. The old clients, descriptors and settings slices stay compiled but unreachable; their deletion is plan 1e-3c, after plan 1e-4 (the extension). The plan ends with the acceptance on Electron.

**After this plan the branch offers LocalInference only** (and the fake in development builds) until Stage 2 restores each provider (1e-3 ruling 1, spec D11/D12). A user whose stored provider is another one runs LocalInference, and their stored choice stays untouched for Stage 2 (1e-3 ruling 2). No build from the branch ships before Stage 2's Soniox step.

**The extension between this plan and 1e-4** (1e-3 ruling 14). The side panel runs the same app, so it switches too: its MainPanel runs the app session — conversation, typed text, replay, export and auto-save work in the side panel, and the translated speech goes to the meeting tab through the new playback's virtual microphone (tabs, 100 ms messages), unverified in a real Meet tab. The meeting page's subtitle overlay still reads the old `sessionStore`, which nothing writes now: it shows its idle "Session ended" screen, and the side panel's subtitle button opens it only while a run is live. No extension build leaves the machine until 1e-4 lands (it publishes the wire from the side panel and renders `SubtitleView` in the overlay), and 1e-4 lands before 1e-3c.

**Architecture:** `ProviderPanel` splits into pieces under `src/components/providers/` — `useSelectedProvider`, `ProviderPicker` (select, credentials and readiness, the provider's engine summary), `ProviderLanguages` (the pair, with today's sentence labels and mirror line), `ProviderOwnSettings`, `ProviderEngine` — and stays their composition for the preview. The provider definition gains an `EngineSummary` slot and `Engine` gains the legs and a slot to open; LocalInference fills both. `src/components/Settings/ProviderArea.tsx` composes the blocks both Settings layouts show (`SessionSettingsGeneral`, `SessionSettingsProvider`, `SessionEnginePage`); `SpeechSection` holds the global turn mode, and `OutputToggles` the headless Output block beside it (Text only, Keep audio for replay); `ParticipantSpeechSwitch` the participant-TTS opt-in, off while Other's source captures the whole system on Electron. The preview renders them at `&settings=simple|advanced`. The switch (Task 5) moves plan 1e-3b-1's `SessionPanel` over `MainPanel.tsx`, mounts `SubtitleTakeover` in `MainLayout` and `AppSessionRoot` in `Home`, rewires `SimpleSettings` / `AdvancedSettings` onto the blocks and the run's phase, cuts `SettingsInitializer` down to what the new session needs, removes the settings store's revalidation, and binds the SetupWizard's one write to `providerStore`. Task 6 moves the remaining readers of the old session state onto the new one.

**Tech Stack:** TypeScript (strict), React 18, zustand, i18next, Vitest + @testing-library/react, Vite, headless Chromium over the DevTools protocol, Electron.

**Spec:** `docs/superpowers/specs/2026-09-22-client-contract-design.md` — "Settings belong to the provider (D18)" (Simple mode and the `Engine` slot), "Credentials are not settings", "Readiness is one check", "Segmentation is one fact", "Persisted settings that move", "State", "What may change during a run", "Stopping, and closing the window", "Migration". The roadmap's 1e-3 items and the sixteen **1e-3 rulings** (`1e3-decisions.md`, cited as *1e-3 ruling N*) bind this plan, as do plan 1e-3b-1's rulings (`2026-09-25-client-contract-stage1e3b-the-switch-1.md`, cited as *1e-3b-1 ruling N*) and interfaces. Research notes: `1e3-shell.md` §2 (what the UI around the panel reads and writes, the provider/language/turn-mode/voice table, the dual-writer problem), `1e3-items.md` §4 (stored settings), `1e3-deletion.md` (context). This plan's own rulings are cited as *ruling N*.

## Global Constraints

- **The dual-writer constraint holds at every commit.** Tasks 1–4 mount no new writer in the running app: their pieces go to the preview, and Task 4 changes only the old path's own writes (the wizard offers its offline path, its write goes through one reshaped dependency still bound to the old stores, the sign-in auto-switch is gone). **Task 5 flips every writer of the session's stored settings at once** — the panel, the takeover, Settings, `SettingsInitializer`, the settings store's revalidation, the SetupWizard's write. Tasks 6–7 change readers and verify.
- Until Task 5, read only: `src/components/MainPanel/MainPanel.tsx`, `src/components/MainLayout/**` (except Task 4's auto-switch), `src/components/Settings/{Settings.tsx,SimpleSettings/**,AdvancedSettings/**}`, `src/components/SettingsInitializer/**`, `src/routes/Home.tsx`, `src/stores/{settingsStore,sessionStore,modelStore}.ts`. Throughout: `src/services/**`, the old Settings sections (`LanguageSection`, `ProviderSection`, `ProviderSpecificSettings`, `EngineSection`, `NativeModelManagementSection`), `SubtitleApp.tsx`, `sessionPortMirror.ts`, `extension/**` — compiled, unmounted after Task 5, deleted by 1e-3c.
- `src/lib/**` never imports React or `src/app/**`. `src/providers/**` imports no store but `modelStore` and `turnModeStore`. Under `src/app/`, React only in `useAppSession.ts`, `useRun.ts`, `AppSessionRoot.tsx`. Components that read the run phase import `src/app/useRun.ts`; their tests mock it (`vi.mock('…/app/useRun', () => ({ useSessionLocked: () => locked, useRunPhase: () => phase }))`), since it loads the root's module graph.
- No new locale keys (plan 1e-3b-1 Task 4 added the four this plan's words need, `audioPanel.participantSpeechBlockedWholeSystem` among them).
- Record a caught failure with `reportError` / `reportWarning`. The console ledger's rows for `MainPanel.tsx` (43), `SettingsInitializer.tsx` (3), `AdvancedSettings.tsx` (1) and `applySetup.ts` (1) go as their calls go (Tasks 4, 5), "gone, not lowered to 0" — an unlisted file is held at 0.
- Gates for every task: `npx vitest run src` shows 0 failed. The 4 unhandled rejections from `settingsStore.nativeGate.test.ts` are the baseline until Task 5, which removes the settings store's mode subscription that raised them; from Task 5 on there are none (never more than 4). And this typecheck gate — **widened from plan 1e-3b-1's** by the files this plan rewrites (`MainPanel/MainPanel.tsx`, `MainLayout/MainLayout.tsx`, `Settings/{Settings.tsx,ProviderArea,SimpleSettings/SimpleSettings.tsx,AdvancedSettings/AdvancedSettings.tsx}`, the sections `SpeechSection`, `ParticipantSpeechSwitch`, `SentenceSegmentationSection`, `SystemAudioSection`, `SettingsInitializer/SettingsInitializer.tsx`, `SetupWizard/{SetupWizard.tsx,applySetup.ts,useApplySetup.ts,providerPaths.ts}`, `SetupWizard/steps/StepLanguagePair.tsx`, `TitleBar/AccountButton.tsx`, `Tour/useStartBasicsTour.ts`, `contexts/UserProfileContext.tsx`, `routes/Home.tsx`, `stores/settingsStore.ts`) — prints exactly **28 lines** from this plan's start through Task 4, **18** from Task 5 (the old `MainPanel.tsx`'s 10 go with it) and **17** from Task 6 (`SystemAudioSection`'s unused `isSessionActive` is read by the participant-speech switch's lock). Checked against this plan's start commit; use `command grep` exactly as written:

  ```
  npx tsc --noEmit -p tsconfig.json 2>&1 | command grep 'error TS' | command grep -E '^(src/(app/|lib/(session|audio|provider|conversation|projection|export|contract|view|subtitle|transcript|analytics\.ts)|lib/modern-audio/BaseAudioRecorder|providers|components/(providers|Conversation|Subtitle|EchoNotice/useEchoNotice\.ts|MainPanel/(ExportButton|MainPanel\.tsx|SessionPanel|panel/)|MainLayout/MainLayout\.tsx|Settings/(Settings\.tsx|ProviderArea|SimpleSettings/SimpleSettings\.tsx|AdvancedSettings/AdvancedSettings\.tsx|sections/(SpeechSection|ParticipantSpeechSwitch|SentenceSegmentationSection|SystemAudioSection)\.tsx)|SettingsInitializer/SettingsInitializer\.tsx|SetupWizard/(SetupWizard\.tsx|applySetup\.ts|useApplySetup\.ts|providerPaths\.ts|steps/StepLanguagePair\.tsx)|TitleBar/AccountButton\.tsx|Tour/useStartBasicsTour\.ts|dev/(SpinePreview|SessionControls|OverlayPreview))|contexts/UserProfileContext\.tsx|routes/Home\.tsx|stores/(providerStore|turnModeStore|routingStore|settingsStore\.ts)|utils/(environment|conversationExport)|App\.tsx))' | sed -E 's/\([0-9]+,[0-9]+\)//' | cut -c1-90
  ```

  The 28 lines: plan 1e-3b-1's 11 (App.tsx TS6133 'React'; SubtitleApp.handleStart.test.tsx TS6133 'provider'; 6× SubtitleBar.test.tsx TS2322 'SessionControl'; analytics.ts TS6133; environment.ts TS2717; environment.ts TS2339), plus MainLayout.tsx TS6133 'useTranslation'; 10× MainPanel.tsx (TS6133 'ResponseConfig', TS6133 'isLoopbackPlatform', 3× TS2322, TS2554, TS7006, TS2345, 2× TS2353); Settings.tsx TS2345 '"settings_mode_switched"'; SystemAudioSection.tsx TS6133 'isSessionActive' and TS2345 '"participant_source_selected"'; Home.tsx TS6133 'React'; 2× settingsStore.ts TS2353 'cacheTimestamp'. Do not fix them; do not add to them.
- Never start a dev server, never run a probe, never launch Electron: the controller runs the checks each task names (the preview's and the app's against `SOKUJI_DEV_NO_ELECTRON=1 npx vite --port 5199 --strictPort`; Electron in Task 7). Two task groups end with a check the controller must pass before the next starts: after Task 3 and after Task 6.
- Commits: conventional, English; every message ends with the implementing model's `Co-Authored-By` line only. Run `git add` and `git commit -q -F - <<'EOF' … EOF` as separate calls. Never push.

## Rulings this plan makes

1. **One switch commit** (the dual-writer constraint, `1e3-shell.md` §2). Everything that writes the session's stored settings, and the two surfaces that run the session, flip in Task 5. Readers that are not writers — the subtitle button's gate, the quota poll, the account button's managed floor, the tour's context, the segmentation offer — move in Task 6, so the switch stays reviewable; between the two commits they read stale state, and nothing writes through them.
2. **The provider area in pieces.** `ProviderPanel` becomes `ProviderPicker` + `ProviderLanguages` + `ProviderOwnSettings` + `ProviderEngine` over `useSelectedProvider`, and stays their composition for the preview. A provider's name is looked up by the old enum's spelling (`providers.${storedProviderValue(p.id)}.name` — the key every locale has, `providers.local_inference.name`), since the registry's id differs. **Stated departure:** the picker is a plain `<select>`; today's option markup with icons, "powered by" and descriptions (`ProviderSection.tsx:560-586`) is not ported. Release builds offer one provider until Stage 2; the rich options return with the choice. Cost if wrong: port `ProviderSection`'s `renderProviderOption` into the picker over the definition's `icon` / `vendor`.
3. **The `Engine` slot learns the legs, and a summary slot joins it** (roadmap 1e-2 → 1e-3; *1e-3 ruling 10*). `Engine?: ComponentType<EngineProps<S>>` receives `legs` (the audio mode's, `providerStore.legs`) and a slot to open first; `EngineSummary?: ComponentType<EngineSummaryProps<S>>` is the chips and memory estimate the picker shows, with `openSlot`. Simple mode keeps today's chips-then-pushed-page (the chip opens the `Engine` in place of the section list); Advanced shows the chips on the General and Provider tabs and the `Engine` inline on the Provider tab. The deep link rides today's one-shot `settingsStore.engineSlotTarget` — a UI signal, not a provider slice.
4. **The language pair keeps today's sentence.** `LanguagePairSection` takes an optional `sentence: { mode, textOnly }` and then labels its two selects with `pairSentence`'s "I speak / they hear" and draws the mirror line for Both (`LanguageSection.tsx:421-469, 624-631`); the app passes it, the preview's `ProviderPanel` does not.
5. **What `LanguageSection` said about LocalInference's models moves to LocalInference.** Its resolution-notes line ("X unavailable — automatic fallbacks are in use · Review · Switch to Auto", `LanguageSection.tsx:486-547, 583-621`) goes under the chips, computed from the two directions' `resolve()` notes (modelStore's `lastResolutionNotes` is written only by the old gate, unreachable after the switch). **Stated departure:** the "Missing ASR / Translation model(s) — Download …" warning with a link per stage (`LanguageSection.tsx:393-430, 735-758`) is not ported: the same gap is readiness's `local_models_missing` / `no_asr`, shown in words under the picker (plan 1e-3a Task 7) and as the amber "None" chips, each a link to its slot. Cost if wrong: one sentence under the chips over the same resolves.
6. **The speech section, and the Output block beside it** (*1e-3 rulings 7, 8*). The global turn mode is one `config-section`, `id="turn-detection-section"`, headed `settings.speechMode`, placed under the language pair in both layouts. Its tooltip is today's local-VAD one (`LocalSettingsControls.tsx:75`), accurate while LocalInference is the only provider; the spec's provider-neutral sentence ("the provider's automatic detection") needs new words and lands with Stage 2's second provider. The Output toggles (Text only, Keep audio for replay) are 1e-3 ruling 8's "one shared block beside the turn mode": a `config-section` of their own, `id="output-section"`, directly under the speech section and **without a heading** — as today, where the two switches sat headless at the end of the language section (`LanguageSection.tsx:694-733`); "Keep audio for replay" is not a speech mode, so it does not go under that heading. The turn mode is locked while not idle (roadmap 1d-2 → 1e); Text only too; Keep audio for replay stays editable (spec: "takes effect immediately"). Settle by rendering (Task 3's check). Cost if wrong: a heading for the block needs new words in 30 locales (a later plan's), or the two switches move back to the end of the language section.
7. **Participant speech** (*1e-3 ruling 8*): a switch in the participant audio section, locked while a run is on (roadmap 1d-1 → 1e: the route follows it live but the run's shape froze it). `meeting` stays hidden, on. **It follows the replay gate's rule** (the review of 2026-09-25): Other's translation plays on the real device (`routes.ts:42`), and on Electron a participant source that is not one application (`app:…`) captures the whole system — Sokuji's own output included — so it would be captured and translated again as Other, the loop the decided replay gate exists to prevent (and the reason the monitor is heard only in speaker mode, `appAudio.ts:39-41`). So on Electron, while the chosen participant source is not an application, the switch shows off and disabled with `audioPanel.participantSpeechBlockedWholeSystem` as its tooltip (the stored choice is kept, as Text only's forced display keeps it), and `readRouting` opens the participant route only then too — what the switch shows is what plays. The extension (tab capture never hears the side panel) and the web are unaffected. **Stated gap:** an application capture that falls back to the whole system mid-run (`app_capture_lost_using_system_audio`, `app_capture_monitor_missing`) is a run notice the routing cannot see, so the route stays open for that run; the echo notice (1e-3b-1 Task 9) is the only signal. Closing the route on those notices is recorded as a follow-up owed before the first release (Task 7's roadmap entry). Cost if wrong: an owner who wants the switch live under whole-system capture (headphones, no loop) drops the Electron clause in two places — the switch and `readRouting` — and keeps the gap's follow-up.
8. **Locks from the phase** (*1e-3 ruling 9*). The Settings hosts read `useSessionLocked()` (plan 1e-3b-1) and pass it where `isSessionActive` went; `lockedMode` is gone — the mode picker is locked while the phase is not idle, so the audio mode *is* the run's. Segmentation's mode, size and pauses stay editable mid-run (spec: display settings); its 402 MB download and delete stay locked while not idle (a model load competing with a live session is not a display setting).
9. **The SetupWizard** (*1e-3 ruling 15*) shows its offline path only. **A Help re-run pre-fills only what it still offers:** today it seeds the draft from the setup record whenever the old factory supports the record's provider (`SetupWizard.tsx:49-52`), so a managed or own-key user's re-run would start on a path whose card is gone, advance past it on the seeded provider (`canAdvance`, `setupDraft.ts:86`) and Finish into a provider the branch lacks — a write through the old path at Task 4, a thrown "This build does not offer" at Task 5. `offersRecord(record)` (`providerPaths.ts`) answers whether the record's path is among `availablePaths()` and its provider among that path's options; otherwise the re-run starts blank. Its one write becomes `applyProvider(provider, pair, credentials)` — Task 4 binds it to the old stores (today's slice write and `setProvider`; the re-validation for an unchanged provider moves in from `applySetup.ts`, fired and not awaited: today it ran, awaited, after the record was written; running before the record now, awaited it would hold the record behind an IndexedDB scan, and a failed check still must not cost the record), Task 5 to `providerStore` (load, credentials, pair, `select(…, 'pick')` — a wizard choice is a person's).
10. **`SettingsInitializer` after the switch** keeps two jobs: the model store's first scan when LocalInference is selected, and an Edge TTS voice that matches the target language — written through `providerStore.updateSettings`. The Kizuna key fetch, the API validation queue and the LocalNative warm-up serve providers the branch no longer offers; readiness is the root's (`attach()`'s driver).
11. **The single-writer cut, stated.** From Task 5 the writers of `settings.localInference.*` and `settings.common.provider` are `providerStore` and the components it hands `update` to. `modelStore.applyPrunes` / `ensureSelectionReady` and the engine components' legacy fallbacks (`useWasmEngineAdapter`, `ModelManagementSection`, `StoragePage` without an override) become unreachable — every mount passes LocalInference's `settings` / `update` — and are **not** redirected: the new `check` does not prune (`check.ts:12-16`), and redirecting a path nothing calls would keep dead code under test. A behavioural test pins it: the app's startup wiring plus a mode change never reach `ensureSelectionReady` or the old slice's writer. The settings store's module-level mode subscription (`settingsStore.ts:1670-1686`), which re-ran the old gate and so its prune, is removed.
12. **The Kizuna sign-in auto-switch is removed**, not made a no-op: no managed provider exists in the registry, and Stage 2's managed step decides what, if anything, replaces it (`MainLayout.tsx:160-203`).
13. **Readers of the old provider that stay mounted read the new selection** (Task 6): the account button's low-balance dot is scoped to a managed provider by `storedProviderValue(selected)` (never managed on the branch), the tour's context names the selected provider, and the participant section's Gemini token warning goes (Gemini returns with its own settings in Stage 2).
14. **Analytics continuity.** The picker's pick sends today's `provider_switched` `{ from_provider, to_provider, during_session }` (`ProviderSection.tsx:512-520`, typed at `analytics.ts:122-126`) in the old enum spelling, `during_session: false` — the picker is disabled and the store refuses a pick while a run is on (1e-3b-1 ruling 7), so the series keeps its meaning; `settings_modified` with `setting_name: 'provider'` came only from the sign-in auto-switch, which goes (ruling 12), and is not sent; the pair sends `language_changed` per side that changed; the turn mode sends `speech_mode_changed` with today's mode spellings (`'Auto'`, `'Push-to-Talk'`, `'Push-to-Translate'`) and the provider's old spelling.
15. **The Advanced Provider tab's order is today's:** the picker with its chips, then the engine, then the provider's own settings (`ProviderSpecificSettings.tsx:2099-2167` drew the `EngineSurface` first).

## File Structure

| File | Change |
|---|---|
| `src/lib/provider/types.ts` | `EngineSlot`, `EngineProps`, `EngineSummaryProps`; `Provider.Engine` / `EngineSummary` (Task 1) |
| `src/components/providers/{useSelectedProvider,useAuthContext}.ts`, `{ProviderPicker,ProviderLanguages,ProviderOwnSettings}.tsx`, `ProviderPanel.tsx`, `LanguagePairSection.tsx` (+ tests) | the provider area in pieces (Task 1) |
| `src/providers/localInference/{LocalInferenceEngineSummary,LocalInferenceEngine}.tsx`, `provider.ts` (+ tests), `src/components/Tour/anchors.test.ts` | chips, estimate, notes; the engine's legs and slot (Task 2) |
| `src/components/Settings/sections/{SpeechSection,ParticipantSpeechSwitch}.tsx`, `src/components/Settings/ProviderArea.tsx` (+ tests), `src/lib/audio/appAudio.ts` (+ test), `src/components/dev/SpinePreview.tsx` (+ test), `scripts/dev/app-panel-probe.mjs` | the speech section, the Output block, the participant switch and its whole-system rule, the blocks; `&settings=`; `--settings` (Task 3) |
| `src/components/SetupWizard/{providerPaths,applySetup,useApplySetup}.ts`, `SetupWizard.tsx` (+ tests), `src/components/MainLayout/MainLayout.tsx` (+ tests), `src/lib/diagnostics/consoleLedger.consistency.test.ts` | offline only, a re-run seeded only from what is offered, one provider write, the auto-switch gone (Task 4) |
| `src/components/MainPanel/MainPanel.tsx` (← `SessionPanel.tsx`), `src/components/Settings/{Settings.tsx,SimpleSettings/SimpleSettings.tsx,AdvancedSettings/AdvancedSettings.tsx}`, `src/components/SettingsInitializer/SettingsInitializer.tsx`, `src/stores/settingsStore.ts`, `src/components/SetupWizard/{useApplySetup.ts,steps/StepLanguagePair.tsx}`, `src/components/MainLayout/MainLayout.tsx`, `src/routes/Home.tsx`, their tests, the ledger, the anchors test, two deleted source tests | the switch (Task 5) |
| `src/components/Subtitle/SubtitleEnterButton.tsx`, `src/stores/settingsStore.ts`, `src/contexts/UserProfileContext.tsx`, `src/components/TitleBar/AccountButton.tsx`, `src/components/Tour/useStartBasicsTour.ts`, `src/components/Settings/sections/{SentenceSegmentationSection,SystemAudioSection}.tsx` (+ tests) | the readers on the new session (Task 6) |
| `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` | the controller's record of the acceptance (Task 7) |

---

### Task 1: The provider area in pieces

**Files:** Modify `src/lib/provider/types.ts`, `src/components/providers/ProviderPanel.tsx` (+ test), `src/components/providers/LanguagePairSection.tsx` (+ test); Create `src/components/providers/useSelectedProvider.ts`, `src/components/providers/useAuthContext.ts`, `src/components/providers/ProviderPicker.tsx`, `src/components/providers/ProviderLanguages.tsx`, `src/components/providers/ProviderOwnSettings.tsx`, `src/components/providers/ProviderPicker.test.tsx`, `src/components/providers/ProviderLanguages.test.tsx`, `src/components/providers/ProviderOwnSettings.test.tsx`.

**Interfaces:**
- Produces (`types.ts`):

  ```ts
  /** One slot of a local engine's model management: a stage of one direction (`src→tgt`). */
  export interface EngineSlot { dir: string; stage: 'asr' | 'translation' | 'tts' }

  /** What an `Engine` is handed besides its settings. */
  export interface EngineProps<S> extends SettingsProps<S> {
    /** The legs a start would open (the audio mode's): the directions it shows. */
    legs: readonly LegName[];
    /** Open this slot on mount — a chip's deep link; `onInitialSlotConsumed` says it was. */
    initialSlot?: EngineSlot | null;
    onInitialSlotConsumed?(): void;
  }

  /** A local engine's summary under the picker: its slot chips and memory estimate (Simple mode's way into the `Engine`). */
  export interface EngineSummaryProps<S> extends SettingsProps<S> {
    legs: readonly LegName[];
    openSlot(slot: EngineSlot): void;
  }
  ```

  and `Provider`'s `Engine?: ComponentType<EngineProps<S>>` ("Model management, the local engines only: pushed from the summary in Simple mode, inline on Advanced's Provider tab"), `EngineSummary?: ComponentType<EngineSummaryProps<S>>`. (A component typed on `SettingsProps<S>` still fits `Engine`, so LocalInference's compiles until Task 2.)
- Produces (components): `useSelectedProvider(providers: readonly AnyProvider[]): SelectedProvider | null` with `interface SelectedProvider { provider: AnyProvider; entry: ProviderEntry | undefined; readiness: Readiness; update(patch: Readonly<Record<string, unknown>>): void }`; `useAuthContext(): AuthContext`; `ProviderPicker(props: { providers; auth; disabled?; openSlot?(slot: EngineSlot): void })`; `ProviderLanguages(props: { providers; disabled?; sentence?: { mode: AudioMode; textOnly: boolean } })`; `ProviderOwnSettings(props: { providers; disabled? })`; `ProviderEngine(props: { providers; disabled?; initialSlot?: EngineSlot | null; onInitialSlotConsumed?(): void })` (in `ProviderOwnSettings.tsx`); `LanguagePairSectionProps.sentence?`.
- Consumed by: Tasks 2, 3, 5.

- [ ] **Step 1: Write the failing tests** (the `ServiceFactory` mock over a `stored` map and `setSetting` spy of `ProviderPanel.test.tsx`; `react-i18next` returning the key; `../../lib/analytics` mocked with a `trackEvent` spy):
  - `ProviderPicker.test.tsx`:
    1. **Switching providers** (roadmap 1b → 1e): providers `[fakeProvider, second]` with `second = { ...fakeProvider, id: 'second', settings: { ...fakeProvider.settings, key: 'second' } }`; pick `second` → `selected === 'second'`, `entries.second` loaded (a stored `settings.second.script = 'long'` is read), `setSetting('settings.common.provider', 'second')`, and `trackEvent('provider_switched', { from_provider: 'fake', to_provider: 'second', during_session: false })` (today's event, ruling 14) — and no `settings_modified` call.
    2. With nothing selected it selects the first offered without writing (a load).
    3. The option for LocalInference reads `providers.local_inference.name` (render with `[localInferenceProvider]`, `modelStore` mocked as `LocalInferenceSettings.test.tsx` does).
    4. `disabled` disables the select and the credential inputs.
    5. With `openSlot` and a provider whose `EngineSummary` is a stub recording its props, the stub renders with `legs` equal to `useProviderStore.getState().legs` and `openSlot` passed through; without `openSlot`, or for a provider without a summary, nothing renders.
    6. The readiness reason shows in words (`notices.local_models_missing`) for a local provider, with no Validate button (plan 1e-3a behaviour, kept).
  - `ProviderLanguages.test.tsx`: a pair change calls `setPair` and sends `language_changed` `{ to_language, language_type: 'source' | 'target' }` once per side that changed (a swap sends both); `disabled` disables both selects and the swap.
  - `LanguagePairSection.test.tsx`: with `sentence={{ mode: 'both', textOnly: false }}` and pair `ja → en` → the labels read `settings.langSentence.iSpeak` / `settings.langSentence.theyHear` and a `.language-mirror-line` shows; `mode: 'participant'` → `settings.langSentence.iRead` / `settings.langSentence.theySpeak`, no mirror; `textOnly: true` on a provider with `speech: 'optional'` → `settings.langSentence.theyRead`; without `sentence`, today's `settings.sourceLanguage` / `settings.targetLanguage` labels (the existing cases).
  - `ProviderOwnSettings.test.tsx`: `ProviderOwnSettings` mounts the selected provider's `Settings` with `settings`, `update`, `disabled`, `pair`; `ProviderEngine` mounts its `Engine` stub with `legs` from the store, `initialSlot` and `onInitialSlotConsumed`; neither renders before the entry loads.
  - `ProviderPanel.test.tsx`: every existing case passes unchanged.
- [ ] **Step 2: Run** `npx vitest run src/components/providers` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `useSelectedProvider.ts`: `ProviderPanel`'s selection logic moved out — the provider is `providers.find((p) => p.id === selected) ?? providers[0]`; an effect loads its entry when missing; another selects it (a load, never a write) when `selected` differs; `update` is one `useCallback` per provider (today's `ProviderPanel.tsx:38-42` comment). Returns null when `providers` is empty.
  - `useAuthContext.ts`: `const { isSignedIn, getToken } = useAuth(); return useMemo(() => ({ signedIn: isSignedIn, getToken }), [isSignedIn, getToken]);` — the same object `useAppSessionBridges` builds, for the picker's own-key check.
  - `ProviderPicker.tsx`: `ProviderPanel.tsx:50-76` (the `provider-section` div with `id="provider-section"` **and `data-tour="provider-section"`** — today's anchor, `ProviderSection.tsx:589`), the select's `onChange`:

    ```tsx
    onChange={(e) => {
      const next = e.target.value;
      // Today's series (ProviderSection.tsx:512-520). A pick is refused during a run (1e-3b-1 ruling 7), so never during one.
      trackEvent('provider_switched', { from_provider: storedProviderValue(provider.id), to_provider: storedProviderValue(next), during_session: false });
      // A person's pick: it persists, in the old enum's spelling (1e-3b-1 ruling 8).
      select(next, 'pick');
    }}
    ```

    options `t(\`providers.${storedProviderValue(p.id)}.name\`, p.id)`, then `CredentialForm` as today, then

    ```tsx
    {openSlot && provider.EngineSummary && entry && (
      <provider.EngineSummary settings={entry.settings} update={update} disabled={disabled} pair={entry.pair} legs={legs} openSlot={openSlot} />
    )}
    ```

    with `legs = useProviderStore((s) => s.legs)`.
  - `ProviderLanguages.tsx`: `LanguagePairSection` for the selected provider's entry; its `onChange(pair)` sends `language_changed` for each side that differs from the entry's pair, then `setPair`.
  - `ProviderOwnSettings.tsx`: `ProviderOwnSettings` renders `provider.Settings` over the entry; `ProviderEngine` renders `provider.Engine` with `legs` from the store and the slot props.
  - `ProviderPanel.tsx`: `ProviderPicker` + `ProviderLanguages` + `ProviderOwnSettings` + `ProviderEngine` (its doc: "the pieces composed for the development preview; the app's Settings compose them per layout, `ProviderArea.tsx`").
  - `LanguagePairSection.tsx`: with `sentence`, the labels come from `pairSentence({ mode, textOnly: effectiveTextOnly({ speakerLegRuns: mode !== 'participant', textOnly }), capability: provider.speech === 'always' ? 'never' : provider.speech === 'never' ? 'always' : 'optional', source: pair.source, target: pair.target })` (the capability maps the definition's `speech` onto the sentence's text-only capability), and the mirror line is `LanguageSection.tsx:624-631`'s markup with the names from `sources` / `targets`.
- [ ] **Step 4: Run** `npx vitest run src/components/providers src/components/dev`, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/provider/types.ts src/components/providers
  git commit -m "feat(providers): the provider area in pieces — picker, languages, own settings, engine"
  ```

**Probes:** `spine-local-probe.mjs` (default) — the preview's `ProviderPanel` is now the pieces, and LocalInference still loads, checks and runs.

---

### Task 2: LocalInference's engine summary, and its engine learns the legs

**Files:** Create `src/providers/localInference/LocalInferenceEngineSummary.tsx`, `src/providers/localInference/LocalInferenceEngineSummary.test.tsx`; Modify `src/providers/localInference/LocalInferenceEngine.tsx` (+ test), `src/providers/localInference/provider.ts` (+ test), `src/components/Tour/anchors.test.ts`.

**Interfaces:**
- Produces: `LocalInferenceEngineSummary(props: EngineSummaryProps<LocalInferenceSettings>)`; `localInferenceProvider.EngineSummary`; `LocalInferenceEngine(props: EngineProps<LocalInferenceSettings>)`; `modeOfLegs(legs: readonly LegName[]): AudioMode` (exported from `LocalInferenceEngine.tsx`).
- Consumed by: `ProviderPicker` (Task 1), `ProviderEngine`.

- [ ] **Step 1: Write the failing tests.**
  - `LocalInferenceEngineSummary.test.tsx` — `react-i18next` returning the default value; `../../stores/modelStore` mocked as `LocalInferenceSettings.test.tsx` does, extended so `useModelStore` is also a selector hook: `Object.assign((select) => select({ deviceFeatures: [], modelStatuses: {} }), { getState: () => ({ resolve: mockResolve }) })`; `../../lib/local-inference/modelManifest` mocked (`getManifestEntry` naming three entries, `estimateModelMemoryByDevice` a spy answering `{ vramMb: 1536, ramMb: 300 }`). Cases:
    1. **The tour's anchor** (replaces `Tour/anchors.test.ts:34-37`'s source count): one `[data-tour="engine-chips"]`, on the `local-inference-info` wrapper.
    2. `legs={['speaker']}` → three chips (ASR, MT, TTS) for `ja→en`; `['participant']` → two chips for `en→ja`; both legs → two groups labelled `modePicker.modeYou` / `modePicker.modeParticipants` (today's `renderChipGroups`, `ProviderSection.tsx:320-338`).
    3. A resolved stage shows its short name with `model-ok`; a missing one `common.none` with `model-warn`.
    4. Clicking a chip calls `openSlot({ dir: 'ja→en', stage: 'asr' })`; a participant chip `openSlot({ dir: 'en→ja', … })`.
    5. The memory estimate: `VRAM ~1.5 GB` and `RAM ~300 MB`; the estimate counts the participant direction only when the participant leg is in `legs` (the spy's argument), and skips a cloud TTS model.
    6. The resolution notes: `resolve` answering `notes: [{ direction: 'ja→en', stage: 'asr', from: 'old-asr', to: 'asr-model', reason: 'not-downloaded' }]` → the line names `old-asr`'s short name; Review calls `openSlot({ dir: 'ja→en', stage: 'asr' })`; Switch to Auto calls `update({ selections: { 'ja→en': { asr: { modelId: '' }, translation: { modelId: '' }, tts: { modelId: '' } } } })` merged into the existing selections as `LanguageSection.tsx:534-547` does; a `no-candidate` note is not listed; a note for the reverse direction shows only with the participant leg.
    7. `disabled` leaves the chips clickable (they navigate, they do not edit) and disables Switch to Auto.
  - `LocalInferenceEngine.test.tsx` (its existing mocks; `EngineSurface` mocked to record props): `legs={['speaker', 'participant']}` → `effectiveMode: 'both'`; `['participant']` → `'participant'`; `['speaker']` → `'speaker'`; `initialSlot` and `onInitialSlotConsumed` reach `EngineSurface`. The existing case passes `legs`.
  - `provider.test.ts`: `localInferenceProvider.EngineSummary` is `LocalInferenceEngineSummary`.
  - `anchors.test.ts`: the file scan walks `src/components` **and `src/providers`** (the summary's anchor lives there); the two count assertions stay until the switch (Task 5), which retires the files they read.
- [ ] **Step 2: Run** `npx vitest run src/providers/localInference src/components/Tour` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `LocalInferenceEngineSummary.tsx` (doc: "LocalInference's summary under the provider picker (1e-3 ruling 10): a chip per stage of each direction the legs run, the memory the resolved models take, and the fallbacks in use — today's `ProviderSection` chips and `LanguageSection` notes, read from `settings` and the pair instead of the old slice"). Its body copies, with these substitutions: `renderChipGroups` and `renderInferenceChips` (`ProviderSection.tsx:320-338, 382-420`; `audioMode` → `modeOfLegs(legs)`, `openSlot(dir, stage)` → `openSlot({ dir, stage })`), the `memoryEstimate` memo (`ProviderSection.tsx:251-265`; `isParticipantChannelInScope` → `legs.includes('participant')`; `localInferenceSettings.*Language` → `pair`), the LOCAL_INFERENCE branch's markup (`ProviderSection.tsx:689-708`), and the notes line (`LanguageSection.tsx:583-621`) with `fallbackNotes` computed from `[...speaker.notes, ...(legs.includes('participant') ? participant.notes : [])].filter((n) => n.reason !== 'no-candidate')`, `staleNames` via `getManifestEntry`, and `switchNotesToAuto` as `update({ selections: next })` (no revalidation call: readiness resets on the settings write and the root re-checks). Resolves are memoized on the pair, `settings.selections` and `modelStatuses` (`useModelStore((s) => s.modelStatuses)`), as today.
  - `LocalInferenceEngine.tsx`: takes `EngineProps<LocalInferenceSettings>`; `effectiveMode={modeOfLegs(legs)}`, `initialSlot={initialSlot ?? null}`, `onInitialSlotConsumed={onInitialSlotConsumed}`; the doc's paragraph about `'both'` being fixed is replaced by "The legs are the audio mode's (`providerStore.legs`), so the page shows the directions a start would run (roadmap 1e-2 → 1e-3)." `export function modeOfLegs(legs) { return legs.length > 1 ? 'both' : legs[0] ?? 'speaker'; }`.
  - `provider.ts`: `EngineSummary: LocalInferenceEngineSummary`.
- [ ] **Step 4: Run** `npx vitest run src/providers src/components/Tour src/components/providers`, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/providers/localInference src/components/Tour/anchors.test.ts
  git commit -m "feat(local): LocalInference's chips, memory estimate and fallbacks under the picker; its engine follows the legs"
  ```

**Probes:** `spine-local-probe.mjs` (default and `--sentences`) still passes — the preview's `ProviderPanel` shows the `Engine` with the legs.

---

### Task 3: The speech section, the Output block, the participant switch, and the blocks both layouts show

**Files:** Create `src/components/Settings/sections/SpeechSection.tsx` (+ test), `src/components/Settings/sections/ParticipantSpeechSwitch.tsx` (+ test), `src/components/Settings/ProviderArea.tsx` (+ `ProviderArea.test.tsx`); Modify `src/lib/audio/appAudio.ts` (+ `appAudio.test.ts`), `src/components/dev/SpinePreview.tsx`, `src/components/dev/SpinePreview.test.tsx`, `scripts/dev/app-panel-probe.mjs`.

**Interfaces:**
- Produces: `TurnModeControl({ locked })`, `SpeechSection({ locked })`, `OutputToggles({ locked })` (`SpeechSection.tsx`; the last is the headless Output block, ruling 6); `ParticipantSpeechSwitch({ locked })`; `readRouting`'s `audio` pick gains `'selectedParticipantSource'`; `SessionSettingsGeneral({ locked, onOpenSlot }: { locked: boolean; onOpenSlot(slot: EngineSlot): void })`, `SessionSettingsProvider({ locked })`, `SessionEnginePage({ locked, slot }: { locked: boolean; slot: EngineSlot })` (`ProviderArea.tsx`); the preview's `&settings=simple|advanced`; the probe's `--settings`.
- Consumed by: Task 5 (the hosts), Task 6 (`ParticipantSpeechSwitch` in `SystemAudioSection`); `readRouting` by the app session's playback (`createAppRouting`).

- [ ] **Step 1: Write the failing tests** (`react-i18next` returning the default value else the key; `../../../lib/analytics` mocked; stores real, reset in `afterEach`):
  - `SpeechSection.test.tsx`:
    1. `SpeechSection`: one `config-section` with `id="turn-detection-section"` and the heading `Speech Mode`; three `.option-button`s (`settings.auto`, `settings.pushToTalk`, `settings.pushToTranslate`), the one for `useTurnModeStore`'s mode `.active`; no switch inside it.
    2. Clicking Push-to-Talk calls `setTurnMode('push-to-talk')` (it persists `settings.common.turnMode`) and sends `speech_mode_changed` `{ provider: 'local_inference', from_mode: 'Auto', to_mode: 'Push-to-Talk' }` with LocalInference selected; clicking the active one does nothing.
    3. `locked` disables all three turn-mode buttons, and `OutputToggles`' Text only; its Keep audio for replay stays enabled (spec: live).
    4. `OutputToggles`: one `config-section` with `id="output-section"` and no heading (`h3` absent), holding the two switches. Text only: with LocalInference selected (`speech: 'optional'`) the switch toggles `useSettingsStore`'s `textOnly`; audio mode `'participant'` shows it on and disabled with `simpleConfig.textOnlyForcedByMode`'s tooltip; a provider with `speech: 'always'` hides it; `speech: 'never'` shows it on and disabled (today's `LanguageSection.tsx:694-722`, over the definition's `speech`).
    5. Keep audio for replay toggles `keepReplayAudio`.
  - `ParticipantSpeechSwitch.test.tsx` (`../../../utils/environment` mocked with an `isElectron` flag): reads and writes `useRoutingStore`'s `participantSpeech`, labelled `audioPanel.participantSpeech` with `audioPanel.participantSpeechDesc` as its tooltip; `locked` disables it. **The whole-system rule** (ruling 7): on Electron with `useAudioStore`'s `selectedParticipantSource` `{ deviceId: 'desktop-audio-loopback', … }` and `participantSpeech: true` stored → the switch is unchecked and disabled with `audioPanel.participantSpeechBlockedWholeSystem` as its tooltip, and the stored value stays true; with `{ deviceId: 'app:42', … }` → checked and enabled; not on Electron → the whole-system source changes nothing.
  - `appAudio.test.ts` (`readRouting`): `participantSpeech: true` on `'electron'` with a selected participant source `'desktop-audio-loopback'` (or none) → `participantSpeech: false`; with `'app:42'` → true; on `'extension'` and `'web'` → true whatever the source.
  - `ProviderArea.test.tsx` (`ServiceFactory` mocked as `ProviderPicker.test.tsx`; `modelStore` real; LocalInference loaded and selected):
    1. `SessionSettingsGeneral` renders, in order, `languages-section`, `turn-detection-section`, `output-section`, `sentence-segmentation-section`, `provider-section`, with `[data-tour="engine-chips"]` inside the last; the pair's labels are the sentence's.
    2. A chip calls `onOpenSlot` with its slot.
    3. `SessionSettingsProvider` renders the picker, then `.engine-surface`, then `LocalInferenceSettingsView` (its `Speech Speed` control) — today's order (ruling 15); a set `engineSlotTarget` reaches the engine's `initialSlot` and is cleared once consumed.
    4. `SessionEnginePage` renders the engine with `initialSlot` equal to its `slot`.
    5. `locked` disables the picker, the pair and the turn mode.
  - `SpinePreview.test.tsx`: with `?preview=spine&settings=simple`, `#turn-detection-section` renders and `ProviderPanel`'s fake `Script` select does not (the blocks replace it); with `&settings=advanced&provider=localInference`, `.engine-surface` renders and there is exactly one `#provider-section` (the preview draws Advanced's Provider tab only; the General tab's blocks are `&settings=simple`'s).
- [ ] **Step 2: Run** `npx vitest run src/components/Settings/sections/SpeechSection.test.tsx src/components/Settings/sections/ParticipantSpeechSwitch.test.tsx src/components/Settings/ProviderArea.test.tsx src/components/dev` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `SpeechSection.tsx`:

    ```tsx
    const MODES: ReadonlyArray<[TurnMode, string, string]> = [
      ['auto', 'settings.auto', 'Auto'],
      ['push-to-talk', 'settings.pushToTalk', 'Push-to-Talk'],
      ['push-to-translate', 'settings.pushToTranslate', 'Push-to-Translate'],
    ];
    /** Today's spellings, for `speech_mode_changed` (ruling 14). */
    const LEGACY_NAME: Readonly<Record<TurnMode, string>> = { auto: 'Auto', 'push-to-talk': 'Push-to-Talk', 'push-to-translate': 'Push-to-Translate' };

    /** The global turn mode (D15, 1e-3 ruling 7): locked while a run is not idle — the run's subtitle session reads it live (roadmap 1d-2 → 1e). */
    export function TurnModeControl({ locked }: { locked: boolean }) {
      const { t } = useTranslation();
      const { trackEvent } = useAnalytics();
      const turnMode = useTurnModeStore((s) => s.turnMode);
      const selected = useProviderStore((s) => s.selected);
      return (
        <div className="setting-item">
          <div className="turn-detection-options">
            {MODES.map(([mode, key, fallback]) => (
              <button
                key={mode}
                type="button"
                className={`option-button ${turnMode === mode ? 'active' : ''}`}
                disabled={locked}
                onClick={() => {
                  if (mode === turnMode) return;
                  trackEvent('speech_mode_changed', { provider: storedProviderValue(selected ?? ''), from_mode: LEGACY_NAME[turnMode], to_mode: LEGACY_NAME[mode] });
                  useTurnModeStore.getState().setTurnMode(mode);
                }}
              >
                {t(key, fallback)}
              </button>
            ))}
          </div>
        </div>
      );
    }
    ```

    `OutputToggles({ locked })`: the two `ToggleSwitch`es of `LanguageSection.tsx:694-733` — Text only per the test's rules (the selected provider's `speech` from the registry; `speakerLegRuns = mode !== 'participant'`), Keep audio for replay never locked. `SpeechSection({ locked })`: `<div className="config-section turn-detection-section" id="turn-detection-section">`, an `<h3>` with a `Mic` icon (size 18), `t('settings.speechMode')` and a help `Tooltip` whose content is `SpeechModeControl`'s default (`LocalSettingsControls.tsx:75`, both keys), then `TurnModeControl`. `OutputToggles({ locked })` is the Output block, rendered by the hosts right after `SpeechSection`: `<div className="config-section output-section" id="output-section">` holding the two switches, no heading (ruling 6). The `.turn-detection-options` styles already apply inside a `.config-section .setting-item` (`Settings.scss:22-23, 277, 489`).
  - `appAudio.ts` `readRouting`: the `audio` pick gains `'selectedParticipantSource'`, and `participantSpeech: switches.participantSpeech && (platform !== 'electron' || !!audio.selectedParticipantSource?.deviceId.startsWith('app:'))`, with a comment: "Other's translation on the real device is recaptured by a whole-system participant capture and translated again as Other — the replay gate's reason (plan 1e-3b-2 ruling 7). An application capture that falls back to the whole system mid-run is not seen here: a follow-up."
  - `ParticipantSpeechSwitch.tsx`: one `ToggleSwitch` (the participant section's control). `const wholeSystem = isElectron() && !useAudioStore((s) => s.selectedParticipantSource)?.deviceId.startsWith('app:');` then `checked={participantSpeech && !wholeSystem}`, `onChange={() => useRoutingStore.getState().setParticipantSpeech(!participantSpeech)}`, `disabled={locked || wholeSystem}`, label `audioPanel.participantSpeech`, tooltip `wholeSystem ? t('audioPanel.participantSpeechBlockedWholeSystem') : t('audioPanel.participantSpeechDesc')` (plan 1e-3b-1's keys; ruling 7 — the same rule as `readRouting`, so the switch shows what plays); its doc: "The participant-TTS opt-in approved 2026-09-06 (1e-3 ruling 8): Other's translation read aloud on the real device. Locked during a run: the run's shape froze it (roadmap 1d-1 → 1e)."
  - `ProviderArea.tsx`:

    ```tsx
    /**
     * The provider-related blocks the two Settings layouts show (plan 1e-3b-2):
     * the General tab and Simple mode's list share `SessionSettingsGeneral`;
     * Advanced's Provider tab is `SessionSettingsProvider`; Simple mode pushes
     * `SessionEnginePage` in place of its list when a chip is clicked (1e-3
     * ruling 10). Every block reads `providerStore` and the run's lock.
     */
    export function SessionSettingsGeneral({ locked, onOpenSlot }: { locked: boolean; onOpenSlot(slot: EngineSlot): void }) {
      const providers = useMemo(() => presentProviders(), []);
      const auth = useAuthContext();
      const mode = useMode();
      const textOnly = useTextOnly();
      return (
        <>
          <ProviderLanguages providers={providers} disabled={locked} sentence={{ mode, textOnly }} />
          <SpeechSection locked={locked} />
          <OutputToggles locked={locked} />
          <SentenceSegmentationSection isSessionActive={locked} />
          <ProviderPicker providers={providers} auth={auth} disabled={locked} openSlot={onOpenSlot} />
        </>
      );
    }

    export function SessionSettingsProvider({ locked }: { locked: boolean }) {
      const providers = useMemo(() => presentProviders(), []);
      const auth = useAuthContext();
      const engineSlotTarget = useEngineSlotTarget();
      const setEngineSlotTarget = useSetEngineSlotTarget();
      return (
        <>
          <ProviderPicker providers={providers} auth={auth} disabled={locked} openSlot={setEngineSlotTarget} />
          <ProviderEngine providers={providers} disabled={locked} initialSlot={engineSlotTarget} onInitialSlotConsumed={() => setEngineSlotTarget(null)} />
          <ProviderOwnSettings providers={providers} disabled={locked} />
        </>
      );
    }

    export function SessionEnginePage({ locked, slot }: { locked: boolean; slot: EngineSlot }) {
      const providers = useMemo(() => presentProviders(), []);
      return <ProviderEngine providers={providers} disabled={locked} initialSlot={slot} />;
    }
    ```
  - `SpinePreview.tsx`: `&settings=simple` renders, in place of `ProviderPanel`, `SessionSettingsGeneral` with `onOpenSlot` setting a local slot, and while a slot is set a back button over `SessionEnginePage` — `<button type="button" className="engine-back-row">`, the app's own back row (`SimpleSettings.tsx:168`); `&settings=advanced` renders `SessionSettingsProvider` alone (Advanced's Provider tab — with the General blocks too the page would hold two pickers, two `#provider-section`s); `locked={phase !== 'idle'}`. The page's doc names the parameter.
  - `app-panel-probe.mjs` gains `--settings`: in `--preview` it opens `/?preview=spine&settings=simple&provider=localInference` and then `/?preview=spine&settings=advanced&provider=localInference`; in `--app` it seeds `settings.common.provider` = `local_inference` (not `fake`: the chips are LocalInference's) and opens Settings through `[data-tour="settings-button"]`, in Simple mode, then the Advanced mode button (the second `.mode-toggle .mode-button`) and its Provider tab (`#tab-provider`). Checks on the Simple page (and Advanced's General tab in `--app`): `#languages-section` has two selects and the sentence labels `I speak` / `they hear`; `#turn-detection-section` has three `.option-button`s, one `.active`; `#output-section` has two switches and no heading; `#sentence-segmentation-section`; `#provider-section select.provider-select` reads LocalInference's name; `[data-tour="engine-chips"] .model-chip` count ≥ 3; a chip click shows `.engine-surface` and `.engine-back-row` returns to the list; **one writer:** choosing another source language in `#languages-section`'s first select changes `localStorage['settings.localInference.sourceLanguage']` to that value within 2 s, and `localStorage['settings.common.provider']` is what it was before. On Advanced's Provider tab (the preview's `&settings=advanced`): exactly one `#provider-section`, `.engine-surface`, and the `Speech Speed` control.
- [ ] **Step 4: Run** the same set, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/components/Settings/sections/SpeechSection.tsx src/components/Settings/sections/SpeechSection.test.tsx src/components/Settings/sections/ParticipantSpeechSwitch.tsx src/components/Settings/sections/ParticipantSpeechSwitch.test.tsx src/components/Settings/ProviderArea.tsx src/components/Settings/ProviderArea.test.tsx src/lib/audio/appAudio.ts src/lib/audio/appAudio.test.ts src/components/dev scripts/dev/app-panel-probe.mjs
  git commit -m "feat(settings): the global turn mode with the output toggles, the participant-speech switch, and the provider blocks"
  ```

**Group check (controller, after this commit — the first of two):** against a fresh vite:
- `node scripts/dev/app-panel-probe.mjs --settings --shot /tmp/settings-simple.png` passes; look at the screenshot beside today's Settings (`http://localhost:5199/` in another tab, Settings open): the speech section (heading and three buttons) sits under the language pair with the headless Output block (two switches) right after it, reading as its own block (ruling 6 — if it reads as part of the wrong section, move the two switches back to the end of the language section before Task 5), and the chips and the memory estimate sit where `ProviderSection` drew them.
- `spine-local-probe.mjs` (default and `--sentences`) and `node scripts/dev/app-panel-probe.mjs` (the panel, preview) pass.

---

### Task 4: The wizard offers its offline path, writes once, and sign-in switches nothing

**Files:** Modify `src/components/SetupWizard/providerPaths.ts` (+ `providerPaths.test.ts`, `providerPaths.managedFit.test.ts`), `src/components/SetupWizard/SetupWizard.tsx` (+ `SetupWizard.test.tsx`), `src/components/SetupWizard/applySetup.ts` (+ `applySetup.test.ts`), `src/components/SetupWizard/useApplySetup.ts`, `src/components/MainLayout/MainLayout.tsx`, `src/components/MainLayout/MainLayout.setup.test.tsx`, `src/lib/diagnostics/consoleLedger.consistency.test.ts`.

**Interfaces:**
- Produces: `ApplySetupDeps` without `currentProvider`, `sliceKeyFor`, `updateProviderSlice`, `setProvider`, `validateApiKey`, and with `applyProvider(provider: ProviderType, pair: { source: string; target: string }, credentials: Record<string, string>): Promise<void>`; `availablePaths(): ProviderPath[]` answering `['offline']`; `offlineOptions()` answering `[Provider.LOCAL_INFERENCE]`; `offersRecord(record: { scenario: ScenarioId | null; providerPath: ProviderPath | null; provider: string }): boolean` (`providerPaths.ts`).
- Consumed by: Task 5 (rebinds `applyProvider`); `SetupWizard.tsx`'s re-run seed (`offersRecord`).

- [ ] **Step 1: Write the failing tests.**
  - `providerPaths.test.ts`: "offers all three paths when a managed provider is registered" (`:19-21`) becomes "offers the offline path only, whatever is registered" — `availablePaths()` is `['offline']` (1e-3 ruling 15); "offline offers WASM and, on Electron, Native" (`:42-44`) becomes `offlineOptions()` is `[Provider.LOCAL_INFERENCE]` on Electron too (LocalNative is not on the branch). `offersRecord`: an offline record for `local_inference` with a scenario → true; offline for `local_native` → false; a `managed` record (`kizunaai_soniox`) → false and an `own-key` record (`openai`) → false (their paths are not offered); a null `providerPath` or `scenario` → false. `managedOption` / `ownKeyOptions` / `providerFits` keep their tests (the functions stay for Stage 2).
  - `providerPaths.managedFit.test.ts`: "still offers the path — the card is the only way to reach the managed provider" (`:34-37`) becomes "offers no managed card until Stage 2, though a managed provider is registered": `managedProvider()` is still `Provider.KIZUNA_AI_OPENAI_TRANSLATE` and `availablePaths()` does not contain `'managed'`. Its fit cases stay (`managedOption` stays).
  - `applySetup.test.ts`: the deps fixture replaces its five old members with `applyProvider: vi.fn(async () => {})`; Finish calls `setMode`, `setTextOnly`, the display modes, then `applyProvider(provider, { source, target }, credentials)` (own-key with credentials; `{}` when pending or off the own-key path), then `completeSetup` — in that order; a rejecting `applyProvider` rejects `applySetupDraft` and skips `completeSetup`; the "re-validates an unchanged provider" cases move to the binder and are deleted here.
  - `SetupWizard.test.tsx` (its `useApplySetup` is mocked; `applied` records the drafts Finish hands it). Every flow through a removed card, and what it becomes:
    - "greys out a provider that cannot serve the scenario and says why" (`:127-139`, the own-key card's PalabraAI) — **deleted**: no own-key card; the fit rule stays pinned by `providerPaths.test.ts`' `ownKeyOptions` / `providerFits` cases.
    - "keeps showing a saved key after Skip and Back, and does not call it missing" (`:141-158`, an own-key re-run) — **deleted**: the credentials step for a key is unreachable; `StepCredentials.test.tsx` keeps the step's own rules for Stage 2.
    - "lets an own-key user skip the credentials for now and finish" (`:160-184`) — **rewritten onto the offline card**: "finishes the offline path with nothing to enter": Subtitle my own speech → `Free, offline` → Next (the hardware notice, Next enabled) → the pair → Finish → `applied[0]` matches `{ scenario: 'subtitle-myself', providerPath: 'offline', provider: 'local_inference', credentialsPending: false }` and the tour starts with `{ providerPath: 'offline', apiKeyValid: null, mode: 'speaker', textOnly: true }`.
    - "opens the sign-in overlay from the managed path and passes once signed in" (`:186-199`) and "stops calling a managed user pending once they have signed in" (`:201-222`) — **deleted**: no managed card (Stage 2's managed step brings them back with the path).
    - "pre-fills a re-run from the stored record" (`:353-365`, an own-key record) — **rewritten onto an offline record**: `{ scenario: 'be-heard', providerPath: 'offline', provider: 'local_inference' }` → the scenario is checked, `Free, offline` is checked, and Next is enabled on the credentials step.
    - "starts blank when the stored record names a provider this build does not have" (`:367-373`) — kept as is; add beside it **"starts blank from a managed record"** (`{ providerPath: 'managed', provider: 'kizunaai_soniox', scenario: 'be-heard' }`) and **"starts blank from an own-key record"** (`{ providerPath: 'own-key', provider: 'openai', scenario: 'be-heard' }`): after one `next()` no radio is checked, and walking the offline card through Finish hands `applied[0]` `provider: 'local_inference'` — never the record's.
    - Every other case already takes `Free, offline` or never reaches the path step, and passes unchanged.
  - `MainLayout.setup.test.tsx`: the `describe('sign-in auto-switch vs the setup wizard')` block goes; in its place "signing in switches no provider": flip `signedIn` false → true with the wizard closed and Basic mode → the `setProvider` mock is never called. The rest of the file passes unchanged.
- [ ] **Step 2: Run** `npx vitest run src/components/SetupWizard src/components/MainLayout` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `providerPaths.ts`:

    ```ts
    /** The paths the wizard offers. The branch runs LocalInference only until
     *  Stage 2 restores the managed and own-key providers (1e-3 rulings 1, 15),
     *  so the offline path is the one card. */
    export function availablePaths(): ProviderPath[] {
      return ['offline'];
    }

    /** The in-app engine; LocalNative returns with Stage 2. */
    export function offlineOptions(): ProviderType[] {
      return [Provider.LOCAL_INFERENCE];
    }

    /** Whether a stored setup's path and provider are still on offer, so a Help
     *  re-run may pre-fill them (1e-3 ruling 15). A record whose card is gone —
     *  managed or own-key until Stage 2 — starts the re-run blank: seeded, the
     *  wizard would advance on the old provider and Finish into one this build
     *  lacks. */
    export function offersRecord(record: { scenario: ScenarioId | null; providerPath: ProviderPath | null; provider: string }): boolean {
      const { scenario, providerPath, provider } = record;
      if (!scenario || !providerPath || !availablePaths().includes(providerPath)) return false;
      switch (providerPath) {
        case 'offline': return offlineOptions().includes(provider as ProviderType);
        case 'managed': return managedProvider() === provider;
        case 'own-key': return ownKeyOptions(scenario).some((option) => option.id === provider);
      }
    }
    ```
  - `SetupWizard.tsx`: the re-run seed's condition `record && record.provider && ProviderConfigFactory.isProviderSupported(record.provider as ProviderType)` becomes `record && offersRecord(record)` (the `ProviderConfigFactory` import goes if nothing else uses it).
  - `applySetup.ts`: `ApplySetupDeps` as in Interfaces (the doc of `applyProvider`: "The provider, its pair and — on the own-key path — its credentials, written where the session reads them; the one write the wizard makes besides the presets and the record"); `applySetupDraft` computes `credentials` as today, awaits `deps.applyProvider(provider, { source: sourceLanguage, target: targetLanguage }, credentials)`, then `completeSetup`. The post-Finish re-validation and its `console.warn` leave this file; the file header's "slice before provider" sentence becomes "the provider's write before the record".
  - `useApplySetup.ts`, bound to the **old** stores until the switch:

    ```ts
    applyProvider: async (provider, pair, credentials) => {
      const s = useSettingsStore.getState();
      const unchanged = provider === s.provider;
      await s.updateProviderSlice(ProviderConfigFactory.getDescriptor(provider).settingsSliceKey, { sourceLanguage: pair.source, targetLanguage: pair.target, ...credentials });
      await s.setProvider(provider);
      // setProvider clears the validation cache even for the provider already
      // selected, and SettingsInitializer re-validates only on a change (moved
      // here from applySetup.ts). Fired, not awaited: today it ran after the
      // record was written; here it runs before, and awaiting it would hold the
      // record behind a check that scans IndexedDB first on the offline path —
      // and a failed check must never cost the record.
      if (unchanged) {
        void useSettingsStore.getState().validateApiKey(getToken, isSignedIn).catch((error: unknown) =>
          reportWarning('SetupWizard', `Checking the provider after setup failed: ${describeCause(error)}`, { cause: error }));
      }
    },
    ```
  - `MainLayout.tsx`: delete the auto-switch effect (`MainLayout.tsx:160-203`) and what only it used — `prevIsSignedInRef`, `useSetProvider` / `setProvider`, `provider`, `useAuth` / `isSignedIn`, `isKizunaManagedProvider`, `ProviderConfigFactory`; leave `useTranslation`'s unused import alone (a gate line).
  - `consoleLedger.consistency.test.ts`: the `'src/components/SetupWizard/applySetup.ts': 1` row goes (its one call left with the re-validation), with a one-line comment in the house style ("gone, not lowered to 0").
- [ ] **Step 4: Run** `npx vitest run src/components/SetupWizard src/components/MainLayout src/lib/diagnostics`, then the gates.
- [ ] **Step 5: Commit**

  ```bash
  git add src/components/SetupWizard src/components/MainLayout/MainLayout.tsx src/components/MainLayout/MainLayout.setup.test.tsx src/lib/diagnostics/consoleLedger.consistency.test.ts
  git commit -m "refactor(setup): the offline path only, one provider write, and no provider switch on sign-in"
  ```

**Probes:** `http://localhost:5199/` loads the running app as before; a fresh profile's wizard offers the one offline card and finishes onto LocalInference (the old path).

---

### Task 5: The switch

**One commit.** Every writer of the session's stored settings and both surfaces that run the session move onto the app session together (ruling 1).

**Files:**
- `src/components/MainPanel/MainPanel.tsx` ← the contents of `SessionPanel.tsx` (the function renamed `MainPanel`, still the default export); delete `SessionPanel.tsx`; rename `SessionPanel.test.tsx` → `MainPanel.test.tsx` and `SessionPanel.microphone.test.tsx` → `MainPanel.microphone.test.tsx` (imports updated); `src/components/dev/SpinePreview.tsx` imports `MainPanel` for `&panel=1`.
- Delete `src/components/MainPanel/sessionIdLifecycle.consistency.test.ts` and `sessionEndAutoSave.wiring.test.ts` (replaced by plan 1e-3b-1 Task 5's behavioural tests).
- `src/lib/diagnostics/consoleLedger.consistency.test.ts`: the `MainPanel.tsx: 43`, `SettingsInitializer.tsx: 3` and `AdvancedSettings/AdvancedSettings.tsx: 1` rows go ("gone, not lowered to 0"), and `MainPanel\.tsx` leaves the `addLog` writers' `ALLOWED` list (its comment named this migration).
- `src/components/Tour/anchors.test.ts`: the two count assertions go (replaced by plan 1e-3b-1 Task 11 case 1 and Task 2 case 1 here).
- `src/components/Settings/Settings.tsx`, `SimpleSettings/SimpleSettings.tsx`, `AdvancedSettings/AdvancedSettings.tsx` and their tests.
- `src/components/SettingsInitializer/SettingsInitializer.tsx`; delete `SettingsInitializer.validationQueue.test.tsx`; create `SettingsInitializer.test.tsx`.
- `src/stores/settingsStore.ts` (the mode subscription).
- `src/components/SetupWizard/useApplySetup.ts`, `src/components/SetupWizard/steps/StepLanguagePair.tsx`.
- `src/components/MainLayout/MainLayout.tsx` and its two tests that mock `SubtitleApp`.
- `src/routes/Home.tsx`.

**Interfaces:** none new. `MainPanel` is plan 1e-3b-1's panel; `SubtitleTakeover` and `AppSessionRoot` are mounted; the Settings hosts compose Task 3's blocks.

- [ ] **Step 1: The tests that describe the switched app** (write or change them first; they fail against today's hosts):
  - `SimpleSettings.order.test.tsx` keeps the **real** blocks (it is the one test of the list's order): mock `../../../app/useRun` (`useSessionLocked: () => false`), keep its `ServiceFactory`, `analytics`, `HelpSection` and model-management mocks, add `../../../lib/local-inference/modelManifest` partially mocked (`vi.mock(path, async (orig) => ({ ...(await orig()), estimateModelMemoryByDevice: () => ({ vramMb: 0, ramMb: 0 }) }))` — the summary's estimate, irrelevant to order), and before render load and select LocalInference in the provider store (`await useProviderStore.getState().load(localInferenceProvider); useProviderStore.getState().select('localInference');`) instead of setting `settingsStore.provider`. The order is `languages-section`, `turn-detection-section`, `output-section`, `sentence-segmentation-section`, `provider-section`, `microphone-section`, `speaker-section`, `participant-section`, then help last. The "no interface-language section" case stays.
  - `SimpleSettings.engine.test.tsx`: mock `../ProviderArea` with markers recording props. (1) A selected provider with an `Engine` and a set `engineSlotTarget` renders `SessionEnginePage` with that `slot` and clears the signal; (2) with `useSessionLocked` true the session banner renders above it; (3) the back row returns to the list (`SessionSettingsGeneral` marker); (4) a provider without an `Engine` (the fake) ignores the signal — the list renders and the signal is cleared.
  - `SimpleSettings.test.tsx` (the highlight effect's seven cases): its total `settingsStore` factory mock does not provide what the new blocks' module graph reads (`useTextOnly`, the provider registry's stores), so the blocks are mocked, not loaded: `vi.mock('../ProviderArea', () => ({ SessionSettingsGeneral: () => <div id="languages-section" />, SessionEnginePage: () => null }))`, `vi.mock('../../../stores/providerStore', () => ({ useProviderStore: (select: (s: { selected: null }) => unknown) => select({ selected: null }) }))`, `vi.mock('../../../providers/registry', () => ({ getProvider: () => undefined }))`; the `sessionStore` mock becomes `vi.mock('../../../app/useRun', () => ({ useSessionLocked: () => false }))`; its `../sections` mock keeps `AudioDeviceSection`, `SystemAudioSection` and `HelpSection` (the others may stay; nothing imports them); the four engine-module mocks may go. Every case passes as before.
  - `SimpleSettings.account.test.tsx`: mock `../ProviderArea` the same way (with a `className="config-section"` on the marker, so the case's "rendered sections" guard still has something to count) and `../../../app/useRun`; drop `useSessionStore.setState` from its `beforeEach`. The provider no longer shapes the list, so the `it.each` over two providers becomes one case, "renders no account section".
  - `Settings.test.tsx`, `Settings.highlight.test.tsx`: they mock both hosts already; replace their `sessionStore` mock with the `useRun` mock (`useSessionLocked: () => false`). Every case passes as before.
  - `Settings.highlight.test.tsx`: add "target `'turn-detection'` switches to the General tab" (the section moved there).
  - `SettingsInitializer.test.tsx` (the `ServiceFactory` mock; `../../lib/edge-tts/voiceList` mocked: `getEdgeTtsVoices` answering two Japanese voices, `filterVoicesByLanguage` real or a stub keeping `ja-*`):
    1. **The single-writer cut** (ruling 11): `useSettingsStore.setState({ provider: 'local_inference', settingsLoaded: true, updateLocalInference: writeSpy })` (as the old loader leaves it for a LocalInference user) and `useModelStore.setState({ ensureSelectionReady: readySpy })` — spies set through `setState`, since a `vi.spyOn` on one state object is lost at the next `set`; LocalInference loaded and selected in the provider store; render, then `useAudioStore.getState().setMode('both')`, flush → neither spy was called. (Before this commit the settings store's mode subscription made this fail: it re-ran `validateApiKey`, whose LocalInference arm calls `ensureSelectionReady`.)
    2. The model store's first scan runs once when LocalInference is selected and not yet initialized (`initialize` spy), and not for the fake.
    3. The voice: `resolve` answering `tts: { modelId: 'edge-tts' }`, pair `en → ja`, `edgeTtsVoice: ''` → `useProviderStore.getState().updateSettings` is called with `(localInferenceProvider, { edgeTtsVoice: 'ja-JP-NanamiNeural' })` (the first candidate); a voice already matching → no write; a non-Edge TTS → no write.
  - `SessionPanel.test.tsx` (renamed to `MainPanel.test.tsx` in Step 3, with the case) gains: rendering the panel constructs no punctuation runtime of its own — the mocked `PunctuationRuntime` constructor was called exactly once, by the root (the old panel's `useSegmentationRuntime` is gone with it; roadmap 1e-3a: "or the page runs two punctuation runtimes").
  - `MainLayout.setup.test.tsx` / `MainLayout.keepAlive.test.tsx`: `vi.mock('../Subtitle/SubtitleApp', …)` becomes `vi.mock('../Subtitle/SubtitleTakeover', () => ({ SubtitleTakeover: () => <div data-testid="subtitle-takeover" /> }))`; the "drops the tour overlay during an Electron subtitle takeover" case also asserts the takeover marker renders.
- [ ] **Step 2: Run** `npx vitest run src/components/Settings src/components/SettingsInitializer src/components/MainLayout src/components/MainPanel/SessionPanel.test.tsx` — the changed tests fail.
- [ ] **Step 3: The panel.** `git mv -f src/components/MainPanel/SessionPanel.tsx src/components/MainPanel/MainPanel.tsx` (the old 4 940 lines are replaced), then rename the function `MainPanel` and update its doc ("MainPanel on the app session, since plan 1e-3b-2's switch"); `git mv` the two test files to `MainPanel.test.tsx` / `MainPanel.microphone.test.tsx` and fix their import. The old panel's helpers (`useSubtitleSessionBridge`, `useSegmentationRuntime`, `sessionStartGate`, `clientOptions`, … — `1e3-shell.md` §3's list) stay, unused, for plan 1e-3c.
- [ ] **Step 4: Settings.**
  - `Settings.tsx`: `const locked = useSessionLocked();` in place of `useIsSessionActive()` (its one use, `during_session`); `NAVIGATION_TAB_MAP['turn-detection'] = 'general'` with a comment "the global turn mode lives on the General tab (plan 1e-3b-2)".
  - `SimpleSettings.tsx`:

    ```tsx
    const SimpleSettings: React.FC<SimpleSettingsProps> = ({ highlightSection }) => {
      const { t } = useTranslation();
      const locked = useSessionLocked();
      const mode = useMode();
      const settingsNavigationTarget = useSettingsNavigationTarget();
      const navigateToSettings = useNavigateToSettings();
      // Model management is the one provider-specific thing Simple mode shows (spec, D18): a provider with an `Engine`.
      const hasEngine = useProviderStore((s) => !!(s.selected && getProvider(s.selected)?.Engine));
      const engineSlotTarget = useEngineSlotTarget();
      const setEngineSlotTarget = useSetEngineSlotTarget();
      const [engineOpen, setEngineOpen] = useState<EngineSlot | null>(null);
      useEffect(() => {
        if (!engineSlotTarget) return;
        if (hasEngine) setEngineOpen(engineSlotTarget);
        setEngineSlotTarget(null);
      }, [engineSlotTarget, hasEngine, setEngineSlotTarget]);

      // The mode picker is locked while a run is not idle, so the audio mode is the run's (spec: "State").
      const lockMic = locked && mode === 'participant';
      const lockMonitor = mode !== 'speaker';
      const lockParticipant = mode === 'speaker';
      const monitorLockedReason = t('audioPanel.monitorLockedByMode', { mode: t('modePicker.modeYou') });
      // … the highlight effect, unchanged (SimpleSettings.tsx:101-148) …

      const banner = locked && (
        <div className="session-warning"><AlertCircle size={16} /><span>{t('settings.sessionActiveNotice')}</span></div>
      );
      if (hasEngine && engineOpen) {
        return (
          <div className="simple-settings">
            <div className="settings-content">
              {banner}
              <button type="button" className="engine-back-row" aria-label={t('engineUi.back', 'Back')} onClick={() => setEngineOpen(null)}>
                <ArrowLeft size={14} />
                {t('settings.title', 'Settings')}
              </button>
              <SessionEnginePage locked={locked} slot={engineOpen} />
            </div>
          </div>
        );
      }
      return (
        <div className="simple-settings">
          <div className="settings-content">
            {banner}
            <SessionSettingsGeneral locked={locked} onOpenSlot={setEngineSlotTarget} />
            <AudioDeviceSection isSessionActive={locked} isLocked={lockMic} showMicrophone showSpeaker={false} />
            <AudioDeviceSection isSessionActive={locked} isLocked={lockMonitor} lockedReason={lockMonitor ? monitorLockedReason : undefined} showMicrophone={false} showSpeaker />
            <SystemAudioSection isSessionActive={locked} isLocked={lockParticipant} />
            <HelpSection isSessionActive={locked} />
          </div>
        </div>
      );
    };
    ```

    The imports of `sessionStore`, `Provider`, the old sections, `EngineSurface`, the two engine adapters, `StoragePage`, `ModelManagementSection` and `NativeModelManagementSection` go.
  - `AdvancedSettings.tsx`: `locked = useSessionLocked()`, `mode = useMode()`, `turnMode = useTurnModeStore((s) => s.turnMode)`, the same three locks as Simple, and

    ```tsx
    // A chip on the General tab opens its slot on the Provider tab (today's `openSlot`, ProviderSection.tsx:298-301).
    const openSlot = useCallback((slot: EngineSlot) => {
      setEngineSlotTarget(slot);
      navigateToSettings('provider');
    }, [setEngineSlotTarget, navigateToSettings]);
    ```

    General: `<SessionSettingsGeneral locked={locked} onOpenSlot={openSlot} />` then `HelpSection`; Audio: today's block with `locked` for `isSessionActive` and `VoicePassthroughSection disabled={turnMode === 'push-to-translate'}` (1e-3 ruling 4); Provider: `<SessionSettingsProvider locked={locked} />`. The old provider config memo and its `console.warn`, `useProvider`, `useAvailableModels` and friends, `ProviderSpecificSettings`, `useIsSessionActive`, `useLockedMode` and `useCurrentTurnDetectionMode` go.
- [ ] **Step 5: The writers.**
  - `SettingsInitializer.tsx`:

    ```tsx
    /**
     * What the app keeps true about the selected provider's settings (plan
     * 1e-3b-2 ruling 10): LocalInference's downloaded models scanned once, and
     * an Edge TTS voice that matches the target language. Readiness is the
     * app session's (`attach()` checks a local provider itself); this writes
     * only through the provider store, the one writer of the provider's stored
     * settings (ruling 11).
     */
    export function SettingsInitializer() {
      const selected = useProviderStore((s) => s.selected);
      const entry = useProviderStore((s) => s.entries[localInferenceProvider.id]);
      const modelStatuses = useModelStatuses();
      const isLocal = selected === localInferenceProvider.id;
      const settings = entry?.settings as LocalInferenceSettings | undefined;
      const source = entry?.pair.source;
      const target = entry?.pair.target;

      useEffect(() => {
        if (!isLocal || useModelStore.getState().initialized) return;
        useModelStore.getState().initialize().catch((error: unknown) =>
          reportWarning('SettingsInitializer', `Scanning the downloaded models failed: ${describeCause(error)}`, { cause: error }));
      }, [isLocal]);

      // Today's rule (SettingsInitializer.tsx:165-199): the picker's own effect runs only while Settings is open.
      useEffect(() => {
        if (!isLocal || !settings || !source || !target) return;
        if (useModelStore.getState().resolve(source, target, settings.selections).tts?.modelId !== 'edge-tts') return;
        let cancelled = false;
        getEdgeTtsVoices()
          .then((voices) => {
            if (cancelled) return;
            const candidates = filterVoicesByLanguage(voices, target);
            if (candidates.length === 0 || candidates.some((v) => v.ShortName === settings.edgeTtsVoice)) return;
            useProviderStore.getState().updateSettings(localInferenceProvider, { edgeTtsVoice: candidates[0].ShortName });
          })
          .catch((error: unknown) =>
            reportWarning('SettingsInitializer', `Choosing an Edge TTS voice failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'edge-voice' }));
        return () => { cancelled = true; };
      }, [isLocal, settings?.selections, settings?.edgeTtsVoice, source, target, modelStatuses]);

      return null;
    }
    ```
  - `settingsStore.ts`: delete the module-level `useAudioStore.subscribe(…)` and its comment (`settingsStore.ts:1670-1686`); a one-line comment in its place: "The old path's mode-aware revalidation lived here; readiness is the app session's since plan 1e-3b-2 (it re-ran the old gate, whose prune wrote the old slice)."
  - `useApplySetup.ts`, bound to the provider store:

    ```ts
    applyProvider: async (provider, pair, credentials) => {
      const id = providerIdFromStored(provider);
      const p = presentProviders().find((candidate) => candidate.id === id);
      if (!p) throw new Error(`This build does not offer "${provider}".`);
      const store = useProviderStore.getState();
      await store.load(p);
      for (const [key, value] of Object.entries(credentials)) {
        if (p.credentials.keys.includes(key)) store.setCredential(p, key, value);
      }
      store.setPair(p, pair);
      // A wizard choice is a person's: it persists (1e-3b-1 ruling 8).
      store.select(p.id, 'pick');
    },
    ```

    (`getToken` / `isSignedIn` and the old stores' imports go; readiness re-checks on the provider store's reset.)
  - `StepLanguagePair.tsx`: the seed's `providerDefault` reads the provider store's entry for `providerIdFromStored(draft.provider)` (`entry?.pair.source ?? sources[0]?.value ?? 'en'`, `entry?.pair.target ?? 'en'`) instead of the old slice; the old slice is loaded once at startup and no longer follows edits.
- [ ] **Step 6: The page.**
  - `MainLayout.tsx`: `import { SubtitleTakeover } from '../Subtitle/SubtitleTakeover';` and `{electronSubtitleTakeover && <SubtitleTakeover />}` in place of `SubtitleApp` (its import goes); the takeover comment names the app session.
  - `Home.tsx`: `<AppSessionRoot />` first inside `TourProvider` (inside `UserProfileProvider`, which it reads), before `<SettingsInitializer />`; the comment above `loadSessionStores()` becomes "The app session's stores: the stored provider selected and loaded, the turn mode migrated, the routing switches, the punctuation pack — read by the session from the first Start."
- [ ] **Step 7: Run** `npx vitest run src`, then the gates — the typecheck gate now prints **18** lines (the old `MainPanel.tsx`'s 10 are gone), and there are no unhandled rejections.
- [ ] **Step 8: Commit**

  ```bash
  git add -A src/components/MainPanel src/components/Settings src/components/SettingsInitializer src/components/SetupWizard src/components/MainLayout src/components/Tour/anchors.test.ts src/components/dev/SpinePreview.tsx src/routes/Home.tsx src/stores/settingsStore.ts src/lib/diagnostics/consoleLedger.consistency.test.ts
  git commit -m "feat(app): the switch — MainPanel, the subtitle takeover and Settings on the app session, one writer of its settings"
  ```

**Probes:** the group check after Task 6 covers this commit; the controller may run `node scripts/dev/app-panel-probe.mjs --app` now to fail early.

---

### Task 6: The readers on the new session

**Files:** Modify `src/components/Subtitle/SubtitleEnterButton.tsx` (+ `SubtitleEnterButton.test.tsx`, `SubtitleEnterButton.integration.test.tsx`), `src/stores/settingsStore.ts`, `src/contexts/UserProfileContext.tsx` (+ its two tests), `src/components/TitleBar/AccountButton.tsx` (+ test), `src/components/Tour/useStartBasicsTour.ts` (+ test), `src/components/Settings/sections/SentenceSegmentationSection.tsx` (+ test), `src/components/Settings/sections/SystemAudioSection.tsx` (+ test).

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests.**
  - `SubtitleEnterButton.test.tsx`: mock `../../app/useRun` (`useRunPhase: () => phase`); on the extension the button is enabled only while `phase === 'running'` (`'starting'`, `'stopping'`, `'idle'` disable it); on Electron it is always enabled. `SubtitleEnterButton.integration.test.tsx` (real `settingsStore`): replace `useSessionStore.setState({ isSessionActive })` with `registerRunPhase(() => phase)` from `src/app/runPhase.ts` and the same `useRun` mock; its cases keep their meaning.
  - `UserProfileContext.signOut.test.tsx`, `.staleResponse.test.tsx`: add `vi.mock('../app/useRun', () => ({ useRunPhase: () => 'idle' }))` (their `utils/environment` mock is total, and the root's graph reads it); add to one of them: with the phase `'running'` the quota poll's interval is 60 s, idle 300 s (fake timers, count `fetch` calls).
  - `AccountButton.test.tsx`: `providerId` feeds `useProviderStore.setState({ selected: providerId })` instead of the mocked `useProvider`. The managed-floor cases keep `'kizunaai_soniox'` — not a registry id, but `storedProviderValue` passes an id it does not map through unchanged, so the floor logic is exercised as before; add: no low-balance dot with `'localInference'` selected and a balance under the managed floor.
  - `useStartBasicsTour.test.tsx`: the context's `provider` is `'local_inference'` and `providerPath` `'offline'` with LocalInference selected, whatever `settingsStore.provider` holds.
  - `SentenceSegmentationSection.test.tsx`: replace the mocked `useProvider` / `useOpenAITranslateSettings` with a mocked `../../../lib/view/appViewSettings` (`selectedBoundaries: () => mockBoundaries`, `offerFor: () => mockOffer`), and set `mockOffer` to the shape each provider case used to produce (Gemini `{ pause: true, auto: false, sizes: true }`, Local Inference `{ pause: false, auto: true, sizes: true }`, OpenAI `{ pause: false, auto: true, sizes: false }`); delete the three OpenAI-Translate-over-WebRTC source-pause cases (`:519-548`, a provider the branch lacks). **The lock rule** (ruling 8): "disables every mode during a session" (`:260`) becomes "keeps the modes editable during a session", and "are frozen during a session" (`:550`) becomes "keep the pauses editable during a session"; "disables the download actions and the delete link during a session" (`:845`) already pins the other half and stays, its session flag now the `isSessionActive` prop the host passes from `useSessionLocked()` (unchanged in form).
  - `SystemAudioSection.test.tsx`: the section renders `ParticipantSpeechSwitch` (mock it as a marker recording `locked`) with `locked` equal to `isSessionActive`; no Gemini warning whatever `settingsStore.provider` holds (drop the `useProvider` mock).
- [ ] **Step 2: Run** `npx vitest run src/components/Subtitle src/contexts src/components/TitleBar src/components/Tour src/components/Settings/sections` — the new tests fail.
- [ ] **Step 3: Implement.**
  - `SubtitleEnterButton.tsx`: `const running = useRunPhase() === 'running';` and `canEnterSubtitleMode(running)` in place of the session store's flag (the gate's parameter keeps its meaning: "a run is live").
  - `settingsStore.ts` `enterSubtitleMode`: `if (!canEnterSubtitleMode(currentRunPhase() === 'running'))`, with `import { currentRunPhase } from '../app/runPhase';` (the leaf, 1e-3b-1 ruling 5); the `sessionStore` import goes — `enterSubtitleMode` was its only use (`settingsStore.ts:24, 905`).
  - `UserProfileContext.tsx`: `const isSessionActive = useRunPhase() !== 'idle';` — a start or a stop in flight polls every minute too.
  - `AccountButton.tsx`: `const provider = storedProviderValue(useProviderStore((s) => s.selected) ?? '');` in place of `useProvider()` — the managed floor follows the provider the session runs (ruling 13).
  - `useStartBasicsTour.ts`: `provider: storedProviderValue(useProviderStore.getState().selected ?? '') as ProviderType`.
  - `SentenceSegmentationSection.tsx`: the offer is `offerFor(selectedBoundaries())`, recomputed when the selected provider or its entry changes (`useProviderStore((s) => (s.selected ? s.entries[s.selected] : undefined))` read for the re-render); `hasSourcePause` is always true (the OpenAI Translate special case goes with the provider); the mode buttons, the size row and the pause sliders drop their `isSessionActive` disable; the download, retry and delete keep it (ruling 8). Its imports of `useProvider`, `useOpenAITranslateSettings`, `ProviderConfigFactory`, `resolveSegmentationOffer` and `Provider` go.
  - `SystemAudioSection.tsx`: the Gemini tooltip and `useProvider` / `Provider` go; `<ParticipantSpeechSwitch locked={isSessionActive} />` renders after the source list or toggle, inside the section (its `isSessionActive` prop, unused until now, is the lock).
- [ ] **Step 4: Run** the same set, then `npx vitest run src`, then the gates — **17** lines now.
- [ ] **Step 5: Commit**

  ```bash
  git add src/components/Subtitle/SubtitleEnterButton.tsx src/components/Subtitle/SubtitleEnterButton.test.tsx src/components/Subtitle/SubtitleEnterButton.integration.test.tsx src/stores/settingsStore.ts src/contexts src/components/TitleBar/AccountButton.tsx src/components/TitleBar/AccountButton.test.tsx src/components/Tour/useStartBasicsTour.ts src/components/Tour/useStartBasicsTour.test.tsx src/components/Settings/sections/SentenceSegmentationSection.tsx src/components/Settings/sections/SentenceSegmentationSection.test.tsx src/components/Settings/sections/SystemAudioSection.tsx src/components/Settings/sections/SystemAudioSection.test.tsx
  git commit -m "feat(app): the subtitle button, the quota poll, the account, the tour and segmentation read the new session"
  ```

**Group check (controller, after this commit — the second of two):** against a fresh vite:
- `node scripts/dev/app-panel-probe.mjs --app` (basic), `--app --advanced --shot /tmp/app-advanced.png`, `--app --ptt`, `--app --settings`, and `--app --long` (record the long-task totals): every step passes.
- In a headless page of `http://localhost:5199/` with a profile holding `settings.common.provider = 'openai'` (seed it as the probe seeds `localStorage`), LocalInference is selected after load and `localStorage['settings.common.provider']` is still `openai` (1e-3 ruling 2); with `settings.openai.turnDetectionMode = 'Push-to-Talk'` and no `settings.common.turnMode`, the turn mode reads Push-to-Talk and `settings.common.turnMode` is now written (1e-3 ruling 3).
- Every `spine-*` probe passes (the preview is its own page).

---

### Task 7 (controller): The acceptance on Electron

**Files:** `docs/superpowers/plans/2026-09-23-client-contract-stage1-roadmap.md` (a "Scheduled by plan 1e-3b" section, written by the controller after the checks, as after plan 1e-3a). Besides the measurements it records one follow-up owed before the first release: close the participant-speech route when an application capture falls back to the whole system mid-run (ruling 7's stated gap).

No code. On the owner's machine (GB10, Linux, Vulkan; `npm run electron:dev`), with LocalInference's models for a pair downloaded, and — where noted — on the Mac mini M4 over SSH (memory: test fleet). Each line is checked and recorded:

- [ ] **A live session** (the roadmap's 1e-3 acceptance, "a live local session on Electron"): Start → the start label ("Loading (n/m)…" while models load), running with the duration ticking; rows with karaoke; TTS heard on the monitor (monitor on); the virtual speaker receives the translation (Linux: `pactl list short sinks` / a meeting app's microphone input shows it) and the advanced footer's output strip moves; Stop → idle, the conversation stays, and with auto-save on exactly one file is written.
- [ ] **Turns:** push-to-talk with Space and with the footer button (Release while held); push-to-translate with the passthrough toggle off — the original voice reaches the virtual speaker at full level while idle and stops while held (1e-3 ruling 4); the turn mode is locked in Settings during the run.
- [ ] **Typed text** in a run, the row arriving on the speaker's side.
- [ ] **Both mode** with an application as the participant source: replay works; switch to whole-system capture (or let the application quit): every replay button is disabled with the new tooltip (the decided gate).
- [ ] **The takeover:** enter subtitle mode during a run; bands and karaoke; Space works in the takeover; the bar's export saves a file; Stop and Start from the takeover; exit. With no microphone selected (Speaker mode), the takeover's idle fix button opens Settings at the microphone section after leaving subtitle mode.
- [ ] **Closing mid-run** with auto-save on: the window closes within 16 s and the file is saved; `app:session-busy` is false again after an ordinary Stop (a later close is immediate).
- [ ] **Settings:** Simple — the chips, the memory estimate, a chip opens the engine page, back returns; Advanced — the three tabs, the engine inline on Provider; the pair, provider and turn mode are locked during a run while segmentation and Keep audio for replay are not; the participant-speech switch plays Other's translation on the monitor when on (a run started after turning it on, an application as Other's source); with whole-system capture chosen the switch shows off and disabled with its tooltip, and a run plays nothing of Other's on the monitor (ruling 7).
- [ ] **Stored settings survive a restart:** the pair, the provider (`local_inference` stored), the turn mode.
- [ ] **The Logs panel** (diagnostic logs on) shows the run's frames under Speaker / Participant.
- [ ] **Measurements** (roadmap 1e-1 → 1e-3): the recorder's warm-up — the time from Start to running over three starts on a packaged build (`npm run package`, then launch the packaged app), microphone only; the `--long` probe's long-task totals from Task 6's check.
- [ ] **1e-2b's live check:** LocalInference with the display by sentences and a size of 1: one long utterance whose `end` tail punctuates into several sentences shows several source rows over one translation row.
- [ ] **Optional, when the hardware is at hand:** a Bluetooth headset as the monitor, switched off mid-run — the Logs panel shows "The audio output stopped responding and was rebuilt" and playback resumes on the next clip (#246); on the M4, Other's audio over whole-system capture with Screen Recording denied — the start fails with the Screen Recording modal and its deep link (1e-3 ruling 6).

---

## Self-review

- **Scope (the roadmap's 1e-3b items, `1e3-shell.md` §3 "1e-3b", the 1e-3 rulings), for this half.**
  - Settings: `ProviderPanel`'s pieces in place of `ProviderSection` + `LanguageSection`'s pair + `ProviderSpecificSettings`, in Simple and Advanced (Tasks 1, 3, 5); the global turn-mode control (*1e-3 ruling 7*, Task 3); the Output block (*1e-3 ruling 8*, Task 3; participant speech Tasks 3, 6; `meeting` hidden); the segmentation offer from the new registry (Task 6) and its lock rule (*1e-3 ruling 9*, Task 6); locks from the phase (Task 5); the tour anchors kept — `provider-section` on the picker (Task 1), `engine-chips` on LocalInference's summary (Task 2), `main-action` on both footers (plan 1e-3b-1 Task 11); LocalInference's chips and memory estimate in its own component (*1e-3 ruling 10*, Task 2); `LocalInferenceEngine` learning the legs (roadmap 1e-2 → 1e-3, Task 2); `onFix` deep links off readiness codes and `no_asr`'s language name (plan 1e-3b-1 Tasks 4, 7, reaching Settings' sections here).
  - The single-writer cut: `modelStore.applyPrunes` / `ensureSelectionReady` (unreachable, pinned by Task 5's test, ruling 11), `SettingsInitializer`'s local branch (Task 5), `useWasmEngineAdapter`'s legacy path (every mount passes the override, Tasks 2, 5), the SetupWizard's offline path (*1e-3 ruling 15*, Tasks 4, 5); the stored mappings applied (plan 1e-3b-1 Task 6) and the selection persisted on a pick (plan 1e-3b-1 Task 6, Tasks 1, 5 here).
  - The switch: MainPanel on the root (plan 1e-3b-1's panel, Task 5), `useSegmentationRuntime` uncalled from the same commit (Task 5's test), `MainLayout`'s takeover → `SubtitleTakeover` (Task 5), `SubtitleEnterButton` / `enterSubtitleMode` through the leaf accessor / `UserProfileContext` on the phase (Task 6), the Kizuna auto-switch removed (ruling 12, Task 4), one owner each for `attach()` and the bridges (`AppSessionRoot` in `Home`, Task 5), `app:session-busy` and the close/update handshake live with the old handler gone in the same commit (Task 5), the four source-reading tests replaced (plan 1e-3b-1 Tasks 5, 11 and Task 2 here; deleted in Task 5), the ledger rows (Tasks 4, 5), the session analytics per *1e-3 ruling 13* (plan 1e-3a's decorator, live from Task 5).
  - Stated in the header: LocalInference only (*1e-3 ruling 1*) and the extension between this plan and 1e-4 (*1e-3 ruling 14*).
  - **Moved out** (plan 1e-3b-1's self-review has the list and the reasons); nothing further is moved out here.
- **Placeholders:** the markup copies of Task 2 (named by `ProviderSection.tsx` / `LanguageSection.tsx` line ranges with their substitutions) and Task 3's `OutputToggles` (`LanguageSection.tsx:694-733`), and the test files whose cases change meaning but not form (Task 5 Step 1, Task 6 Step 1) — each named with what it now asserts. Everything decided is written out.
- **Types across tasks:** `EngineSlot` / `EngineProps` / `EngineSummaryProps` (Task 1) are what `LocalInferenceEngine` and `LocalInferenceEngineSummary` take (Task 2), what `ProviderPicker` / `ProviderEngine` hand them (Task 1), what `ProviderArea`'s blocks pass (Task 3) and what `SimpleSettings` / `AdvancedSettings` hold (Task 5); `settingsStore.engineSlotTarget`'s `{ dir; stage: Stage }` is assignable both ways with `EngineSlot` (the same three stages). `ApplySetupDeps.applyProvider` (Task 4) is bound twice (Tasks 4, 5); `offersRecord` (Task 4) takes the setup record's own shape (`scenario`, `providerPath`, `provider`), the shape `draftFromRecord` reads. `readRouting`'s wider `audio` pick (Task 3) is satisfied by `createAppRouting`'s whole audio state; `ParticipantSpeechSwitch` and `readRouting` apply the same whole-system rule to the same store field. `useSessionLocked` / `useRunPhase` / `currentRunPhase` / `select(id, 'pick')` / `storedProviderValue` / `providerIdFromStored` and the four locale keys come from plan 1e-3b-1 and plan 1e-3a.
- **Stated departures from today:** the plain provider select (ruling 2); the missing-models warning folded into readiness and the chips (ruling 5); the turn mode in a "Speech Mode" section under the pair, with the local-VAD tooltip, and the Output toggles in a headless block right after it (ruling 6); Keep audio for replay editable mid-run (spec); segmentation editable mid-run, its download not (ruling 8); the wizard's single offline card (*1e-3 ruling 15*); no provider switch on sign-in (ruling 12); the account's low-balance dot and the participant section's Gemini warning follow the provider the session runs (ruling 13); a Help re-run from a managed or own-key setup starts blank on the offline card (ruling 9); the participant-speech switch is off and disabled on Electron while Other's source captures the whole system, and its route closed with it (ruling 7; the mid-run fallback is a stated gap and a recorded follow-up); the picker keeps today's `provider_switched` series (ruling 14).
- **Checked again after the independent review (2026-09-25):** the picker's event is today's `provider_switched`, not a `settings_modified` series that only the removed auto-switch sent (ruling 14, Task 1); the wizard cannot Finish into a path the build lacks — a re-run seeds only what `offersRecord` accepts, and every `SetupWizard.test.tsx` flow through a removed card is named with what it becomes, with `providerPaths.test.ts` and `providerPaths.managedFit.test.ts` (Task 4); the unchanged-provider re-check is fired, not awaited, so Finish is no slower than today (Task 4); `SimpleSettings.test.tsx` and `.account.test.tsx` mock the blocks, `.order.test.tsx` loads them with the mocks it needs (Task 5); the no-second-punctuator case is written into `SessionPanel.test.tsx` before the rename (Task 5); the Output toggles are a headless block beside the turn mode, per 1e-3 ruling 8 (ruling 6); participant speech follows the replay gate's rule (ruling 7); the segmentation download lock keeps its existing case (Task 6); the `--settings` probe names its selectors, draws one `#provider-section` per page, seeds LocalInference in `--app`, and checks that a pair edit writes LocalInference's keys and never the provider (Task 3). Declined: moving the Settings hosts' new bodies into Task 3 as unmounted components — the switch's size is the one-commit constraint itself (ruling 1), the host bodies are written out in full in Task 5, and two copies of each host across three commits would be more to review, not less.
