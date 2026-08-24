# First-Run Setup Wizard and Tour — Design

**Date**: 2026-08-25
**Status**: Drafted for review by jiangzhuo. Every `file:line` reference verified against
`worktree-first-run-setup-and-tour` at `23209265` (main, with #443 merged).

## Summary

Replace the first-launch "Regular or Experienced user?" screen with a **setup wizard**
that asks what the user wants to do and what they have, then configures the app for it.
Replace the two hard-coded `react-joyride` step catalogues with a **tour** that is one
catalogue of predicate-gated steps, rendered by a small spotlight engine built on
`@floating-ui/react`, that teaches the interface the wizard has already configured.

Two words are used precisely throughout:

| Term | What it is | Writes settings? |
|---|---|---|
| **Setup wizard** | Full-window multi-step form shown once on a fresh install: scenario → provider path → credentials → language pair → finish. | Yes, once, on Finish. |
| **Tour** | Spotlight overlay on the real interface after the wizard: "this is the mode picker, this is Start". | Never. |

Behaviour changes deliberately: the Basic/Advanced choice disappears from first launch
(everyone starts in Basic and can switch in Settings), the wizard can be backed out of at
any step without touching a setting (interface language and sign-in excepted — neither is
a setting the wizard configures), and the tour stops forcing `uiMode` or restarting itself
on a version bump. Existing users are migrated silently and never see the wizard.

## Scope

**In scope**
- The setup wizard, its persistence (`settings.setup`), and its Help-section re-entry
- Scenario presets (mode, text-only, display modes) and scenario-aware provider filtering
- The tour engine, the chapter-1 step catalogue, `data-tour` anchors, `settings.tour`
- Migration of existing users; deletion of `UserTypeSelection`, `OnboardingContext`,
  `Onboarding/`, `react-joyride`, and their locale keys
- `ProviderConfigFactory.getDefaultManagedProvider()` preferring Kizuna Soniox
- Locale sweep (30 catalogues), tests, docs

**Out of scope** (agreed with jiangzhuo)
- **Tour chapter 2 ("advanced features": speech mode, VAD, prompts, voices, logs).** The
  engine and persistence keep the shape for more chapters (`completedChapters`), but only
  chapter 1 ships. Chapter 1's last step says where Advanced mode lives and stops there.
- **Downloading local models from the wizard.** Ruled out: the app cannot recommend a
  model set that fits the user's hardware, a bad pick would reflect on the product, and
  it would pull users away from the managed service. The free/offline path explains the
  requirements and hands the user to the existing Engine page through the tour.
- Collecting more than one provider's credentials at first run. One primary provider;
  others are added later in Settings.
- The `'user-account'` dead navigation target in `sessionStartGate.ts:334`; the 14-branch
  language-write `switch` in `LanguageSection.tsx:152-330`. Both noted, both left alone.
- Extension `popup.js` and `background.js`. Neither knows about onboarding today and
  neither needs to.

## The problem, measured

### The first-launch screen asks the wrong question, before the app can help

`UserTypeSelection.tsx` offers two cards — Regular / Experienced — and a hard-coded
12-entry interface-language `<select>` (`:17-38`) for a product with 30 locales. It is
returned early from `MainLayout.tsx:209-211`, **before `<TitleBar>` renders**
(`:223`), so on a fresh install there is no account button and no way to sign in;
`AuthOverlay` (#439) cannot be opened from there.

The answer is stored twice, in two stores with different lifetimes:

| Flag | Store | Written at |
|---|---|---|
| `sokuji_user_type` | raw `localStorage` | `OnboardingContext.tsx:38`, `:434` |
| `settings.common.uiMode` | `SettingsService` → `chrome.storage.sync` in the extension (`SettingsService.ts:16-17`) | `settingsStore.ts:684` |

They diverge as soon as the user flips the mode toggle in Settings (`Settings.tsx:126-134`
updates only `uiMode`). `startOnboarding` then **forces `uiMode` back** to match
`sokuji_user_type` (`OnboardingContext.tsx:297-303`), so "Restart Setup Guide" silently
throws an Advanced user into Basic. In the extension a synced profile arrives on a new
machine already holding `uiMode` but not `sokuji_user_type`, and sees the choice screen
again.

### The tour teaches settings the user should not have to fill in

Two catalogues — 10 Basic steps (`OnboardingContext.tsx:105-172`), 12 Advanced
(`:176-258`) — and most steps point at a settings section and say "fill this in". The
choreography that opens the settings panel does so by **synthetically clicking
`.settings-button`** (`Onboarding.tsx:52-79`) with 300/400 ms sleeps, keys off a
hard-coded step index 2 (`:88`, `:146`), and targets ad-hoc classes and ids that carry
"keep this legacy class for onboarding" comments (`TitleBar.tsx:67-69`). No
`data-tour` / `data-onboarding` attribute exists anywhere in `src/`. Copy does not
branch by platform: the participant step (`:153`, `:236`) describes the extension and
the desktop app in one sentence, so every user reads instructions for a platform they
are not on. A bump of `ONBOARDING_VERSION` auto-restarts the tour for existing users
(`:341-349`), which — via the forced `uiMode` — also changes their mode.

`react-joyride` is a runtime dependency listed under `devDependencies`
(`package.json:182`). `Onboarding.tsx` has no tests; `OnboardingContext.steps.test.ts`
covers step counts and numbering only.

### Nothing in the app knows what the user is trying to do

There is no preset, scenario, or profile concept. The nearest thing is the `ModePicker`'s
You / Others / Both channel scope. The settings a scenario would set already exist:

| Setting | Where | Notes |
|---|---|---|
| `audio.mode` | `audioStore.ts:101`, `setMode` `:273` | `'speaker' \| 'participant' \| 'both'` |
| `common.textOnly` | `settingsStore.ts:109` | A *request*; see below |
| `common.speakerDisplayMode`, `participantDisplayMode` | `:111-112` | `'source' \| 'translation' \| 'both'` |

**The participant leg never speaks.** Every descriptor's `buildParticipantSessionConfig`
forces `textOnly: true` and `descriptorRegistry.test.ts` pins it as a registry-wide
invariant (`src/utils/effectiveTextOnly.ts:11-16`). So the text-only toggle is meaningful
only when a speaker leg runs — mode `speaker` or `both`.

Providers declare whether they can be text-only (`ProviderCapabilities.textOnlyCapability`,
`ProviderConfig.ts:36`):

| Value | Providers | Cannot serve |
|---|---|---|
| `'always'` (text only, no speech) | `volcengine_st`, `zoom_ai` | scenarios that speak (#2, #4) |
| `'never'` (always speaks) | `palabraai`, `openai_translate`, `kizunaai_openai_translate` | scenarios that want subtitles only (#3, #5) |
| `'optional'` | everything else | — |

Only `kizunaai_soniox` is actually open in production; the managed OpenAI Translate and
Doubao twins are not. Yet `getDefaultManagedProvider()` prefers them
(`ProviderConfigFactory.ts:156-160`), and `settingsStore.ts:390` falls back to
`KIZUNA_AI_OPENAI_TRANSLATE`.

## Decisions

Recorded rulings from the brainstorm, so the plan does not re-open them:

1. **Scenario = what the user is trying to do**, not a business domain. Five scenarios,
   enumerating every `mode × textOnly` combination that is meaningful (§1.2).
2. **Provider path is asked as "what do you have"**, three ways, one primary provider.
3. **Everyone starts in Basic.** `uiMode` stays a normal setting with the existing
   toggle as its only entry point. Offline users do not need Advanced: since #436 the
   Engine page is reachable from Basic through the provider section's engine chips
   (`SimpleSettings.tsx:112-156`, `ProviderSection.tsx:382-390`).
4. **The wizard never downloads models** (see Scope).
5. **Every wizard step is reversible**; the cost of each provider path is stated on its
   card before the user commits to it.
6. **The tour is one catalogue with predicates**, not N catalogues. It varies by
   scenario, provider path, and platform.
7. **Only tour chapter 1 ships.**
8. **Tour engine is custom on `@floating-ui/react`**; `react-joyride` is removed.
9. **`getDefaultManagedProvider()` prefers Kizuna Soniox.**

## §1 Setup wizard

### 1.1 Placement and lifecycle

`src/components/SetupWizard/` replaces `src/components/UserTypeSelection/`.

`MainLayout` keeps the early return at the same point (after its hooks, before
`<TitleBar>`) but the condition becomes "setup not completed" read from the store, not
from `useOnboarding()`. Sign-in from inside the wizard calls `setAuthOverlay('sign-in')`
(`settingsStore.ts:1315`); `AuthOverlay` is a sibling of `MainLayout` in `Home`
(`Home.tsx:40`), so it paints over the wizard, and on success it closes itself and the
wizard is still on the same step. Signing in and the interface language (step 0) are the
two side effects a backed-out wizard leaves behind; both are acceptable — an account is
not a setting, and the language was chosen to *read* the wizard, not by it.

The wizard holds a **draft** in local component state (a reducer, tested as a pure
function). Nothing except the interface language (step 0, see its row) touches a store
until Finish. Back is available on every step after
the first; the step indicator at the top shows position.

### 1.2 Steps

| # | Step | Content | Source of options / constraints |
|---|---|---|---|
| 0 | Interface language | One `<select>` over `INTERFACE_LANGUAGES` (`Settings/sections/interfaceLanguages.ts`, added by #443 — one entry per locale directory, guarded by `locales.consistency.test.ts`). Default: the i18next-detected language. Changing it re-renders the wizard in that language immediately via `changeLanguageWithLoad`. | This is the one setting applied *during* the wizard rather than at Finish, because the rest of the wizard must be read in it. Backing out does not revert it. |
| 1 | Scenario | Five cards (table below). Each card's footer states what it will set, e.g. "Mode: Others · Subtitles". | — |
| 2 | Provider path | Three cards (table below); the first is marked *Recommended*. "I have my own API key" expands a provider list filtered by scenario; "Free, offline" on Electron offers WASM / Native, on the extension only WASM. | Filter: scenario speaks (#2, #4) → exclude `textOnlyCapability === 'always'`; scenario wants text (#3, #5) → exclude `'never'`. Excluded providers are shown greyed with the reason, not hidden. List order = `ProviderConfigFactory` registration order. |
| 3 | Credentials | *Direct start*: a Sign in / Create account button; if already signed in, the step shows the account and passes. *Own key*: one input per entry in the descriptor's new `credentialFields` (§1.8), plus **Validate**, which builds `Credentials` with the descriptor's existing `extractCredentials({ ...defaults, ...draft.credentials }, ctx)` and calls `validateAndFetchModels(creds)` directly — never `settingsStore.validateApiKey`, so nothing is written. *Offline*: requirements text only, no control. **Both credential sub-paths also offer a secondary "Skip for now" action** — the user can finish without a key or an account and add it later in Settings; the existing Start gate (`api-key-invalid`, `sign-in-required`) blocks Start until then and already routes to the right place. | Validation errors are shown inline; Back is always available. |
| 4 | Language pair | Source and target selects. Options from the chosen descriptor's `resolveSourceLanguages()` and `resolveTargetLanguages(source)` (`ProviderDescriptor.ts:252-253`). Default source = the interface language if the descriptor offers it, else the descriptor's default; default target = English if offered, else the descriptor's default; if source and target coincide, target falls to the descriptor's default. | Comes after credentials so the "you need an email" cost surfaces early, and because options depend on the provider. |
| 5 | Finish | One-screen summary: scenario, mode, spoken/subtitles, provider, language pair. If credentials were skipped, one highlighted line says what is still needed before Start ("No API key yet — add it in Settings → Provider" / "Not signed in — sign in from the account button"). **Finish** applies the draft. | Writes listed in §1.5. |

#### Scenarios

| Id | Card title (en) | `audio.mode` | `textOnly` | Display modes (speaker / participant) |
|---|---|---|---|---|
| `understand-others` | Understand what others say — online meetings, classes, videos, streams | `participant` | (forced by mode) | — / `translation` |
| `be-heard` | Be understood in a meeting — they hear my translated voice | `speaker` | `false` | `both` / — |
| `subtitle-myself` | Subtitle my own speech — talks, streams, presentations; no audio | `speaker` | `true` | `translation` / — |
| `two-way-voice` | Two-way online conversation — they hear my voice, I read their subtitles | `both` | `false` | `both` / `both` |
| `two-way-text` | Two-way online conversation, subtitles only — bilingual captions, minutes | `both` | `true` | `both` / `both` |

`understand-others` writes `textOnly: true` for hygiene (it is forced anyway); only the
display mode on its own leg is set. A display mode marked "—" is left at its current
value.

#### Provider paths

| Id | Card title (en) | Cost stated on the card | Resolves to |
|---|---|---|---|
| `managed` | Start right away *(Recommended)* | "Needs a Kizuna AI account (email) with a balance. New accounts get a trial credit." | `ProviderConfigFactory.getDefaultManagedProvider()` — Kizuna Soniox after §3.3 |
| `own-key` | I have my own API key | "You pay the provider for usage." | The provider the user picks from the filtered list |
| `offline` | Free, offline | "Downloads models onto your disk (gigabytes). Runs well with a GPU and enough VRAM; CPU-only is noticeably slower." | `local_inference`, or `local_native` on Electron when chosen |

The card copy is final only after rendering; the sentences above fix the *content*
(email, balance, trial; pays provider; disk, GPU, VRAM, CPU-slow), not the wording.

### 1.3 Platform and gating

The wizard reads the same registry and gates the rest of the app does
(`ProviderConfigFactory.isProviderSupported`, `isLocalNativeEnabled`, …). It never
lists a provider the factory did not register. If the `managed` path has no registered
provider (`getDefaultManagedProvider()` returns `null` — a build with Kizuna off), that
card is not rendered.

### 1.4 Draft state

```ts
interface SetupDraft {
  step: 0 | 1 | 2 | 3 | 4 | 5;
  scenario: ScenarioId | null;
  providerPath: 'managed' | 'own-key' | 'offline' | null;
  provider: ProviderType | null;           // resolved from path (+ pick)
  credentials: Record<string, string>;     // own-key only; cleared when path changes
  credentialsValidated: boolean;           // own-key only
  credentialsPending: boolean;             // "Skip for now" was taken on step 3
  sourceLanguage: string | null;
  targetLanguage: string | null;
}
```

Reducer invariants (tested): changing `scenario` clears `providerPath` onward when the
current provider is no longer compatible; changing `providerPath` or `provider` clears
`credentials`, `credentialsValidated`, and the language pair; Back never clears.
Next is enabled only when the step's requirement is met: a scenario, a path (and a
provider for `own-key`), and a pair. Step 3 is satisfied by signed in / validated /
nothing (offline) **or** by "Skip for now", which sets `credentialsPending` and clears
`credentials`. `settings.setup` does not record the pending state — the store's
`isApiKeyValid` is the truth, and the Start gate reads it.

### 1.5 Finish: what is written, in order

1. `audioStore.setMode(preset.mode)`
2. `settingsStore.setTextOnly(preset.textOnly)`
3. `setSpeakerDisplayMode` / `setParticipantDisplayMode` for the legs the preset names
4. `settingsStore.updateProviderSlice(descriptor.settingsSliceKey, { sourceLanguage, targetLanguage, ...credentials })` (`settingsStore.ts:326`) — credentials only on `own-key`. The slice is written **before** the provider so that the validation effect (next paragraph) fires once, with the final values.
5. `settingsStore.setProvider(draft.provider)`
6. `settingsService.setSetting('settings.setup', { version: SETUP_VERSION, scenario, providerPath, provider, completedAt })`

`uiMode` is not written. `settings.setup` goes through `SettingsService`, so in the
extension it roams with the rest of the profile.

**Start-gate validation is not the wizard's job.** `isApiKeyValid` / `availableModels`
are written only by `settingsStore.validateApiKey`, and `SettingsInitializer` already
decides when to call it: on a provider change or a credential change for every API
provider (`SettingsInitializer.tsx:104-145`, with a one-deep queue for changes that land
mid-validation), through its own fetch-then-validate effect for Kizuna managed providers
(`:59-98`), and through per-provider reactive effects for the two local providers.
`updateProviderSlice` sets state synchronously before persisting (`settingsStore.ts:573`),
so steps 4-5 in one tick give that effect a single run over the final state. The wizard
does not call `validateApiKey` itself — a second caller would run concurrently with the
effect (its `isValidatingRef` is component-local) and, for Kizuna, would need the auth
token getter.

One gap, handled explicitly: Soniox's regional keys are deliberately absent from the
effect's dependency list (`SettingsInitializer.tsx:49-55`). A wizard re-run from Help
(§1.6) that keeps the provider and changes only the key would therefore not
re-validate. Finish calls `validateApiKey()` **only** when `providerPath === 'own-key'`
and the provider is unchanged from before step 5.

### 1.6 Re-entry

`HelpSection` gains **Run setup again** next to the existing tour restart
(`HelpSection.tsx:60`). It mounts the same wizard as an overlay over the running app
(not the `MainLayout` early return), pre-filled from `settings.setup`; Finish overwrites.
It is disabled while a session is active, with the same notice `SimpleSettings` shows.

### 1.7 Language-pair rules live in the descriptor

Two providers apply a pair rule beyond their option lists: the Volcengine AST2 twins
(`resolveAST2LanguagePair`, `volcengineAST2LanguageSync.ts:38` — `zhen` on either side
forces both sides) and the two local providers (`getTranslationTargetLanguages(source)`,
which `LanguageSection.tsx:209-224` uses to reset an incompatible target). The wizard
does **not** re-implement either. It relies on `resolveTargetLanguages(source)` returning
only targets the rule accepts; the parity test in §4.2 proves that for every registered
descriptor, and any failure is fixed inside that descriptor's `resolveTargetLanguages`,
never in the wizard.

### 1.8 Descriptor addition: `credentialFields`

`ProviderDescriptor` gains

```ts
interface CredentialField { key: string; labelKey: string; secret: boolean; placeholderKey?: string }
readonly credentialFields: CredentialField[];   // [] for managed and local providers
```

listing the **slice keys** a user must fill for the provider to validate (`apiKey` for
most; the regional keys for Soniox; client id/secret for Palabra's BYOK mode; app id and
token for Volcengine; endpoint and key for OpenAI-compatible). `descriptorRegistry.test.ts`
gains an invariant: every descriptor whose `extractCredentials` reads a slice key lists
that key. `ProviderSection`'s hand-written inputs are **not** migrated to this table in
this round; the field is the wizard's contract only, and the invariant keeps the two from
drifting.

### 1.9 Analytics

`user_type_selected` and `user_type_applied` are retired. New events:
`setup_started`, `setup_step_viewed { step }`, `setup_abandoned { step }` (window closed
or app quit mid-wizard — best effort), `setup_completed { scenario, provider_path,
provider, source_language, target_language }`. `docs/app/app-analytics-events.md` is
updated in the same change.

## §2 Tour

### 2.1 Engine

`src/components/Tour/`: `TourProvider` (state, persistence, start/stop), `TourOverlay`
(scrim + spotlight), `TourPopover` (card), `useTour`. `TourProvider` mounts where
`OnboardingProvider` does today (`Home.tsx:34`).

- **Anchors.** Steps name a `data-tour="<id>"` value. The engine resolves it with
  `querySelector` and requires visibility (`getClientRects().length > 0`) — panels kept
  alive inside `<Activity>` (`MainLayout.tsx:260-268`) report zero rects while hidden.
  Anchors replace the legacy classes; the "kept for onboarding" comments go.
- **Spotlight.** A `position: fixed` element sized to the target rect with
  `box-shadow: 0 0 0 9999px rgba(0,0,0,.6)`, 8 px radius, `pointer-events: none`. The
  target is not interactive during the tour. Steps without an anchor render a centred
  card over a full scrim.
- **Popover.** `useFloating` with `autoUpdate`, anchored to a virtual element wrapping
  the target rect; `FloatingFocusManager` (modal) owns focus; Escape skips the tour,
  Enter advances. Title, body, `n / N`, Back, Next, Skip, Finish. Styled with the
  `AccountPopover` tokens.
- **Prepare and wait.** A step may declare `prepare(ctx)`. The one non-trivial prepare
  opens the settings panel and navigates: `MainLayout`'s `showSettings` state
  (`MainLayout.tsx:37-104`, `sessionStorage`-backed) is lifted into a small **`layoutStore`**
  (`showSettings`, `setShowSettings`, `logsVisible` untouched) so the tour can open the
  panel through the same state the button uses — **no synthetic clicks**. Then
  `navigateToSettings(target)`. After prepare the engine polls with `requestAnimationFrame`
  for the anchor to become visible, up to 1.5 s, then `scrollIntoView({ block: 'center' })`
  and highlights.
- **Missing target.** On timeout the step is skipped with a `console.warn` and an
  `onboarding_step_skipped { step, reason: 'target-missing' }` event. The tour never
  wedges. There is no hard-coded index anywhere; every "open the panel first" lives in
  the step's own `prepare`.

### 2.2 Catalogue

```ts
export interface TourStep {
  id: string;                                   // i18n: tour.steps.<id>.{title,content}
  anchor?: string;                              // data-tour value; absent = centred card
  when?: (ctx: TourCtx) => boolean;             // absent = always
  prepare?: (ctx: TourCtx) => void | Promise<void>;
  placement?: Placement;
  copyVariant?: (ctx: TourCtx) => string | null; // appended: tour.steps.<id>.content_<variant>
}

export interface TourCtx {
  scenario: ScenarioId | null;                  // null for migrated users
  providerPath: 'managed' | 'own-key' | 'offline' | null;
  provider: ProviderType;
  platform: 'electron' | 'extension';
  os: 'linux' | 'mac' | 'windows' | 'other';    // environment.ts isLinux/isMacOS/isWindows
  mode: 'speaker' | 'participant' | 'both';     // audio.mode at tour start
  textOnly: boolean;
  isSignedIn: boolean;
  apiKeyValid: boolean | null;                  // settingsStore.isApiKeyValid at tour start
}
```

Predicates read **`mode` and `textOnly`**, not the scenario id, so a migrated user with
`scenario: null` gets the right device steps from their current mode. The scenario id is
kept in the context for copy only.

Chapter 1, in order:

| # | id | anchor | when | prepare | Says (content fixed; wording after rendering) |
|---|---|---|---|---|---|
| 1 | `welcome` | — | always | — | Set up for your scenario; a short look around |
| 2 | `mode-picker` | `mode-picker` | always | — | Set to *X*; switch here any time; switching resets spoken/subtitle |
| 3 | `microphone` | `microphone-section` | `mode !== 'participant'` | open settings → `microphone` | Your mic, system default already chosen; never pick the Sokuji virtual mic |
| 4 | `monitor` | `speaker-section` | `mode === 'speaker' && !textOnly` | open settings → `speaker` | Hear your own translated voice; can be turned off |
| 5 | `output-routing` | — | `mode !== 'participant' && !textOnly` | — | `copyVariant`: `extension` → pick "Sokuji Virtual Microphone" as the mic in Meet / Zoom / Teams; `electronLinux` → Sokuji created a virtual microphone, pick it in your meeting app; `electronOther` → needs a virtual audio cable (e.g. VB-Cable); route Sokuji's output to it |
| 6 | `participant-source` | `participant-section` | `mode !== 'speaker'` | open settings → `participant` | `copyVariant`: `electron` → pick the app to translate, or all system audio; `extension` → translates the current tab; original audio still plays |
| 7 | `subtitle` | `subtitle-enter` | always | close settings | Subtitle mode: floating window / in-page overlay; OBS and screen share can capture it |
| 8 | `account` | `account-button` | `providerPath === 'managed'` | — | `copyVariant`: `!isSignedIn` → sign in here; Start unlocks once you are signed in; else → balance and top-up live here |
| 9 | `provider-settings` | `provider-section` | `providerPath === 'own-key'` | open settings → `provider` | `copyVariant`: `apiKeyValid !== true` → paste your key here; Start unlocks once it validates; else → change key or provider here |
| 10 | `models` | `engine-chips` | `providerPath === 'offline'` | open settings → `provider` | Models download here: one per stage; try several |
| 11 | `start` | `main-action` | always | close settings | `copyVariant`: `offline` → lights up once models are ready; `managed && !isSignedIn` → lights up once you sign in; `own-key && apiKeyValid !== true` → lights up once your key validates; else → press to start |
| 12 | `done` | — | always | — | Finished; Advanced mode (speech detection, prompts, voices, logs) is in Settings' top-right toggle; replay from Help |

Step counts per scenario on the `managed` path: #1 → 7, #2 → 9, #3 → 7, #4 → 9, #5 → 8.
Each body is one or two sentences.

New `data-tour` anchors to add (the element already exists in every case):

| anchor | element |
|---|---|
| `mode-picker` | `ModePicker.tsx:66` root |
| `microphone-section`, `speaker-section` | `AudioDeviceSection.tsx:167`, `:245` |
| `participant-section` | `SystemAudioSection.tsx:86` |
| `provider-section` | `ProviderSection.tsx:604` |
| `engine-chips` | the chip row container around `ProviderSection.tsx:382-390` |
| `subtitle-enter` | `SubtitleEnterButton.tsx:71` |
| `account-button` | `AccountButton.tsx` root |
| `main-action` | `MainPanel.tsx:4290` (Basic footer) |
| `settings-button` | `TitleBar.tsx:70` — kept as an anchor for future chapters, not used by chapter 1 |

### 2.3 Start, persistence, re-entry

- **Auto-start exactly once**: `MainLayout` starts the tour on the render after the
  wizard's Finish (`settings.setup.version` present, `settings.tour.completedChapters`
  lacks `'basics'`). Nothing else starts it. For this run `TourCtx.apiKeyValid` is
  seeded from the wizard's own outcome (`!credentialsPending`), not from the store:
  `SettingsInitializer`'s validation is still in flight at that moment and
  `isApiKeyValid` would read `null` for a key the wizard just validated. Help restarts
  read the store. **A `TOUR_VERSION` bump never auto-restarts**;
  it only changes what "Restart" records.
- Finish or Skip writes `settings.tour = { version: TOUR_VERSION, completedChapters:
  ['basics'], completedAt, method: 'finished' | 'skipped' }` via `SettingsService`.
- `HelpSection`'s existing **Restart Setup Guide** re-runs chapter 1 with a fresh
  `TourCtx` built from `settings.setup` and the live stores.
- Events keep their names — `onboarding_started`, `onboarding_step_viewed`,
  `onboarding_completed` — with `step` carrying the step id and a new
  `onboarding_step_skipped`. The doc is updated.

## §3 Migration, cleanup, and the managed default

### 3.1 Existing users never see the wizard

On store load (`settingsStore.loadSettings`, next to the existing Palabra and managed-
provider migrations at `settingsStore.ts:380-420`), if `settings.setup` is absent:

| Evidence found | Action |
|---|---|
| `settings.common.uiMode` present in `SettingsService`, or `sokuji_user_type` in `localStorage` | Write `settings.setup = { version, scenario: null, providerPath: null, provider: <current>, migratedFrom: 'legacy', completedAt }`. If `sokuji_onboarding_completed` parses with `completed: true`, write `settings.tour = { version, completedChapters: ['basics'], method: 'migrated' }`. Remove both legacy `localStorage` keys. |
| Neither | Fresh install: leave `settings.setup` absent; the wizard shows. |

Migrated users keep whatever `uiMode` they had. Their `TourCtx.scenario` is `null`, which
§2.2's mode-driven predicates handle.

**Sequencing note (from Plan 1's final review).** The two legacy `localStorage` keys are
removed only in the change that deletes `OnboardingContext` (delivery slice 3), because
that context still reads them until then; slice 1 records the decision
(`clearLegacyKeys`) but gates its application behind `LEGACY_KEYS_RETIRED`. A migrated
user's `settings.setup.provider` is the raw persisted id and is informational only —
`settingsStore.loadSettings` normalises the live value separately.

### 3.2 Deletions

- `src/components/UserTypeSelection/` (tsx, scss)
- `src/contexts/OnboardingContext.tsx`, `src/contexts/OnboardingContext.steps.test.ts`
- `src/components/Onboarding/` (tsx, scss)
- `react-joyride` from `package.json` and `package-lock.json`
- Locale keys `userTypeSelection.*` (14) and `onboarding.*` (52) from all 30 catalogues
- The "legacy class kept for onboarding" comments and, where nothing else uses the class,
  the class itself (`TitleBar.tsx:67-70`; the `#…-section` ids stay — `SimpleSettings`'
  scroll-and-highlight uses them)
- `docs/guides/onboarding-guide.md` is rewritten for the wizard + tour

`MainLayout.keepAlive.test.tsx:19,44` mocks `UserTypeSelection` and `useOnboarding`; they
become mocks of `SetupWizard` and `useTour`.

### 3.3 Managed default

`ProviderConfigFactory.getDefaultManagedProvider()` (`:155-162`) prefers
`[KIZUNA_AI_SONIOX, KIZUNA_AI_OPENAI_TRANSLATE, KIZUNA_AI_VOLCENGINE_AST2]`; the
`settingsStore.ts:390` fallback becomes `KIZUNA_AI_SONIOX`. `kizunaProviderGating.test.ts`
(`:156-189`) is updated to the new order. `MainLayout`'s sign-in auto-switch
(`:176-206`) is unchanged and now lands on Soniox.

## §4 Locales and verification

### 4.1 Locales

New namespaces `setup.*` (wizard: step titles, five scenario cards, three path cards,
requirement sentences, buttons) and `tour.*` (`steps.<id>.title`, `.content`,
`.content_<variant>`, and chrome: `back`, `next`, `skip`, `finish`, `progress`). One
sweep across all 30 catalogues so `locales.consistency.test.ts:50-59` passes. `en`,
`zh_CN`, and `ja` are authored; the other 27 receive the English text as placeholders,
and the spec's implementation plan lists those keys so a later translation pass has a
worklist (the practice established in #436, whose gap was exactly that no marker
existed).

### 4.2 Tests (written first)

- **Wizard reducer**: forward/back; clearing rules from §1.4; Next-enabled predicate.
- **Provider filtering**: table over every registered descriptor × five scenarios,
  asserting inclusion/exclusion and the reason, driven by `textOnlyCapability`.
- **Finish**: given a draft, the stores end in the §1.5 state, `settings.setup` has the
  documented shape, `uiMode` is untouched, and the write order matches §1.5.
- **Credentials do not leak**: validating a key in step 3 leaves `settingsStore`
  unchanged.
- **Skip for now**: a draft with `credentialsPending` finishes; the slice receives the
  language pair but no credential keys; the Finish summary shows the pending line.
- **Language pair parity**: for every registered descriptor and every `(source,
  target)` with `target ∈ resolveTargetLanguages(source)`, the provider's pair rule
  (§1.7) leaves the pair unchanged — so a wizard-chosen pair written via
  `updateProviderSlice` equals what `LanguageSection` would have written.
- **`credentialFields` invariant** (§1.8) in `descriptorRegistry.test.ts`.
- **Tour predicates**: table over 5 scenarios × 3 paths × 2 platforms (× 3 OSes for the
  routing variant), plus `scenario: null` with each mode, asserting the visible step ids
  and copy variants.
- **Anchor consistency**: every `anchor` in the catalogue appears as `data-tour="…"`
  somewhere under `src/` (file-scan test, same style as the site-plugin consistency
  test).
- **Engine (jsdom)**: resolves a visible anchor; skips on the 1.5 s timeout with the
  event; Escape skips, Enter advances; Finish/Skip persist the documented record; a
  hidden-in-`<Activity>` element is treated as absent.
- **Migration**: the three inputs of §3.1 produce the documented `settings.setup` /
  `settings.tour` and remove the legacy keys.
- **Managed default**: order and fallback.
- Existing: `locales.consistency.test.ts`, the `settingsStore.*.test.ts` family,
  `MainLayout.keepAlive.test.tsx` with the new mocks.

### 4.3 By rendering

Per the house rule, the visual decisions are settled in the running app, not argued:
headless Chromium against the Electron renderer and the extension's `fullpage.html`,
walking the wizard on all three paths and the tour on scenarios #1, #2, and #4 on both
platforms, screenshots kept with the PR. Things to look at specifically: the three path
cards' cost sentences at the narrowest side-panel width; the spotlight over a target
inside a scrolled settings panel; the centred `output-routing` card; focus landing in
the popover and returning after Finish; the wizard rendered in `ja` and `ar` (longest and
RTL).

## Delivery slices

1. **Persistence, migration, managed default** — `settings.setup` / `settings.tour`
   types and store fields, §3.1 migration, §3.3 order change, `layoutStore` lift. No UI.
2. **Wizard** — reducer, scenario/path tables, filtering, steps, Finish, Help re-entry,
   `en` strings.
3. **Tour** — engine, catalogue, anchors, auto-start, Help restart, `en` strings.
4. **Cleanup and locales** — §3.2 deletions, 30-locale sweep with `zh_CN`/`ja`
   authored, docs, analytics doc, rendering pass.

Slices 2 and 3 are independent once 1 lands; 4 depends on both.

## Risks

- **Two entry points into the settings panel state.** Lifting `showSettings` into a store
  touches `MainLayout`, `TitleBar`, and the `sessionStorage` persistence. The keepAlive
  test guards the `<Activity>` behaviour; the lift must keep that test green unchanged
  before the tour uses the store.
- **Anchors in two footers.** `main-action` exists only in the Basic footer
  (`MainPanel.tsx:4290`); the Advanced footer's `.session-button` (`:4406`) gets the same
  `data-tour` so a migrated Advanced user's "Restart" still finds Start.
- **Key validation without the store.** `validateAndFetchModels` is the same call the
  store makes, but a descriptor that reads store state during validation would misbehave.
  Covered by the "does not leak" test plus a manual check of each own-key provider in the
  rendering pass.
- **Sign-up requires email verification** (backend trial-credit rule). The wizard's
  step 3 treats "signed in" as sufficient; a user who signs up but has not verified
  proceeds and hits the existing Start-gate blocker later, with its existing copy. Not
  worse than today; noted so the copy on the `managed` card mentions the email.

## Open items deferred to the plan

- Exact card and step wording (fixed by rendering).
- Whether `subtitle` (step 7) shows for every scenario or only #3/#5 — default is every
  scenario, one short sentence; revisit if the rendering pass finds the tour too long on
  #2/#4.
