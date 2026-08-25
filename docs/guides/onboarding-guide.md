# Sokuji First-Run Guide: Setup Wizard and Tour

Design: `docs/superpowers/specs/2026-08-25-first-run-setup-and-tour-design.md`.

## Two surfaces

| Surface | When | What it does | Writes settings? |
|---|---|---|---|
| **Setup wizard** (`src/components/SetupWizard/`) | Once, on a fresh install; again from Help → "Run setup again" | Asks what the user wants to do (five scenarios), what they have (managed account / own API key / free offline), collects credentials or lets the user skip them, picks a language pair, and applies everything on **Finish**. | Yes — once, on Finish (`applySetup.ts`, in the order the spec fixes). |
| **Tour** (`src/components/Tour/`) | Right after the wizard finishes; again from Help → "Restart Setup Guide" | A spotlight walk over the real interface: mode picker, the devices the scenario uses, subtitle mode, the account / provider / models entry for the chosen path, and Start. 5–9 steps. The app underneath is not operable while a step is showing: the spotlight cutout itself is `pointer-events: none`, but a transparent `.tour-blocker` layer underneath it blocks the app on anchored steps, and a full `.tour-scrim` blocks it on centred steps. Escape ends the tour; Enter advances to the next step. | Never. |

Everyone starts in Basic mode; Advanced stays a setting behind the toggle at the top of Settings. There is no first-launch "Regular / Experienced" choice any more.

The tour is started only from two places: the setup wizard's Finish button (first-run only — a re-run of the wizard from Help does not restart it) and Settings → Help → "Restart Setup Guide".

## Persistence

- `settings.setup` — `{ version, scenario, providerPath, provider, completedAt, migratedFrom? }` via `SettingsService` (roams with `chrome.storage.sync` in the extension). Its presence is the only thing that decides "the wizard has been done".
- `settings.tour` — `{ version, completedChapters, completedAt, method }`. A `TOUR_VERSION` bump never restarts the tour by itself.
- Users of the pre-wizard app are migrated on first hydration (`src/lib/setup/setupMigration.ts`): a persisted `uiMode` or the old `sokuji_user_type` localStorage key marks them as set up (`migratedFrom: 'legacy'`, `scenario: null`); a completed legacy tour becomes a completed `basics` chapter; the old localStorage keys (`sokuji_user_type`, `sokuji_onboarding_completed`) are removed. They never see the wizard.

## Scenarios (`src/lib/setup/scenarios.ts`)

| Id | Mode | Text-only | Display modes |
|---|---|---|---|
| `understand-others` | Others | forced | participant: translation |
| `be-heard` | Me | off | speaker: both |
| `subtitle-myself` | Me | on | speaker: translation |
| `two-way-voice` | Both | off | both: both |
| `two-way-text` | Both | on | both: both |

A provider is greyed out (with the reason) when its `textOnlyCapability` cannot serve the scenario: `'always'` providers cannot speak (#2, #4); `'never'` providers cannot run subtitles-only (#3, #5).

The wizard also picks a starting language pair; its default source and target differ whenever the provider offers more than one target language (the fallback target is ranked by `LANGUAGE_PRIORITY`).

## Tour catalogue (`src/components/Tour/steps.ts`)

One catalogue; each step carries a `when` predicate over `TourCtx` (mode, textOnly, providerPath, platform, os, sign-in and key state) and optional `copyVariant` for platform- or readiness-specific text. Steps target elements by `data-tour="<anchor>"`; `anchors.test.ts` fails if a catalogue anchor has no element. A step whose anchor does not appear within 1.5 s is skipped (never wedges) and reported as `onboarding_step_skipped` with `reason: 'target-missing'` — the same reason is reported when a step's own `prepare` callback throws before the anchor is even looked for, since the tour treats that failure as a missing target too.

To add a step: add the entry to `BASICS_STEPS`, put `data-tour` on the element, add `tour.steps.<id>.{title,content}` to **all 30** catalogues — write the English copy in `src/locales/en/translation.json` and run `node scripts/sync-locale-keys.mjs` to fill the other 29 catalogues with English placeholders (it never rewrites `en`) — and extend `steps.test.ts`.

## Re-entry

Settings → Help: **Run setup again** (overlay wizard, pre-filled, disabled during a session) and **Restart Setup Guide** (tour, built from the live stores).
