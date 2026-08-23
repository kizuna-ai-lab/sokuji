# Title Bar Account Slot — Design

**Date**: 2026-08-24
**Status**: Drafted for review by jiangzhuo. Every `file:line` verified against
`worktree-feat+titlebar-account-slot` at **`9d81aeca` (v0.38.0)**.

An earlier draft cited line numbers read from the main checkout, which still sits at
`14b5496f` (v0.37.4) and is one release behind this worktree. Re-checked: between the
two, only `SimpleSettings.tsx`, `ProviderSection.tsx`, `settingsStore.ts` and a new
engine test differ. `TitleBar/`, `ModeDevicePopover.scss`, `AccountSection.tsx`,
`UserAccountInfo.tsx`, `OnboardingContext.tsx` and `MainLayout.tsx` are byte-identical
across the two, so the width measurements and the popover spec are unaffected. Only
`ProviderSection.tsx` line references actually moved, and they are corrected below.

## Problem

Registration opened three days ago and almost nobody signs up. The entry is not
merely buried, it is **circular**:

- A new install lands on `Provider.OPENAI` (`src/stores/settingsStore.ts:124`) — a
  bring-your-own-key provider.
- The only in-app sign-in entry is `AccountSection`, which returns `null` unless the
  *currently selected* provider is Kizuna-managed
  (`src/components/Settings/sections/AccountSection.tsx:26-28`).
- The app auto-switches a basic-mode user to a managed provider **only after they
  sign in** (`src/components/MainLayout/MainLayout.tsx:152-176`).

So seeing the sign-in entry requires already having picked the managed provider, and
picking the managed provider is what signing in is supposed to cause. Two further
consequences fall out of the same knot:

- Basic onboarding step 2 is titled "User Account" and targets
  `#user-account-section` (`src/contexts/OnboardingContext.tsx:71-73`), an element
  that does not exist in the default state. Basic steps are not filtered by provider
  (`OnboardingContext.tsx:249-253` calls `createBasicOnboardingSteps(t)` with no
  capabilities argument), so the step cannot opt out.
- Selecting the managed provider while signed out renders a grey
  `api-key-warning` line, not an actionable control
  (`src/components/Settings/sections/ProviderSection.tsx:961-964`).
- A signed-out user can be shown the raw engineering string
  `Failed to get auth session` (`src/stores/settingsStore.ts:1069`) instead of that
  line at all — see §10.

## Decisions

Settled with jiangzhuo across this session; recorded so the rationale is not lost.

| Decision | Rationale |
|---|---|
| Account entry lives in the **title bar**, not in the settings list | The title bar is not the provider's region, so a BYOK user is not asked to log in where they are configuring their own key. `AccountSection`'s provider scoping was deliberate (`AccountSection.tsx:20-25`) and is respected. |
| Signed-in mark is a **20px outlined circle with the initial**, not a filled avatar | Rendered comparison: a filled `#10a37f` disc outweighs the row of 14px monochrome line icons around it. The outline keeps the avatar's circular semantics inside the existing wireframe language. Height was never the constraint — 18–22px all fit in 36px. |
| Click opens a **popover**, not a third side panel | Settings and Logs are mutually exclusive panels; making the account a third one means opening it *closes the settings panel* — precisely interrupting the conversion path being optimised. The product already has five popovers (`Tooltip`, `ExportButton`, `SubtitleBar`, `ModeDevicePopover`, `MainPanel`), so the split is established: panels for sustained configuration, popovers for a glance. |
| The entry shows **when signed out too** | If it only appeared after sign-in, its contribution to registration would be zero. |
| Signed out opens the **same popover**, not `/sign-up` directly | A returning user on a new device has an account; dropping them on a registration form strands them. The popover carries one line of explanation and both routes. |
| `AccountSection` is **removed** | Every item has a destination (see *Migration* below). The one gap — visibility of the e-mail-verification state — is closed by the status dot, which also fixes an existing defect. |
| Logs button becomes **advanced-mode only** | It is a diagnostic tool basic users rarely need. A hidden right-click gesture is undiscoverable and would have to be taught during support; `uiMode` is a concept the product already has, with a visible toggle at `src/components/Settings/Settings.tsx:126-145`. |
| Status dot uses **two colours**, red outranking amber | Blocking and reminding are different states; one colour would flatten them. |
| Top-up label is **"Top up"** | Matches 「充值」 more closely than "Add funds" or "Recharge". |
| `ONBOARDING_VERSION` stays at `1.2.0` | Settled 2026-08-24. Bumping it auto-restarts the whole tour for everyone who already finished it (`OnboardingContext.tsx:289-296`), and the only new content is one sentence pointing at the title bar — where a new icon now sits in plain view anyway. Ten forced steps is out of proportion to that. A decision, not an oversight. |
| Interface language moves to **just above `HelpSection`** | It is set once and never revisited, yet sits second (first whenever `AccountSection` is hidden), directly adjacent to *Translation* languages — two adjacent sections both named "language". Moving it makes translation languages the first thing in the settings list, which is what the panel is for. |

## Measurements

Method: `TitleBar.scss` compiled with the project's own sass, the base font stack from
`src/index.scss`, and the real translations of all three button labels from the 30
`src/locales/*/translation.json` catalogs. Viewport swept 300–1000px in 5px steps over
CDP, asserting horizontal *and* vertical overflow per bar. Probe self-check: at a
200px viewport 300 of 330 bars report overflow, confirming it can detect the failure
it is looking for. Hardest locale in every configuration is Tamil
(`துணைத்தலைப்பு / அமைப்புகள் / பதிவுகள்`).

Browser-extension side panel has no window controls and is **clean across 300–1000px
in every configuration**. Electron Windows/Linux, which carries three 46px window
buttons:

| Configuration | Icon-mode band | Text-mode band | Safe from |
|---|---|---|---|
| Today (logs button, no account slot) | 300–325px | 580–590px | 595px |
| + account slot, avatar only | 300–370px | 580–635px | 640px |
| + account slot + `$12.34` | 300–370px | 580–680px | 685px |
| + account slot + `$0.001552` | 300–370px | 580–700px | 705px |
| **Logs removed**, no account slot | — | — | **300px, clean** |
| **Logs removed** + account slot + `$12.34` | 300–330px | — | **335px** |
| **Logs removed** + account slot + `$0.001552` | 300–330px | 580–595px | 600px |

Two findings drive the design:

1. **The current build already overflows.** Tamil breaks at 580–590px on Electron
   Win/Linux today, with no account slot involved: `@media (max-width: 576px)`
   (`TitleBar.scss:84-90`) hides the labels too low, so just past 576px all three
   labels reappear while the window buttons still consume 138px.
2. **Removing the logs button pays for the account slot outright** and repairs that
   pre-existing overflow as a side effect. No breakpoint change is needed — provided
   the balance string stays short (next section).

## Changes

### 1. `AccountButton` — new self-contained component

New: `src/components/TitleBar/AccountButton.tsx` + `.scss`.

Follows `SubtitleEnterButton`'s pattern: it reads its own stores so `TitleBar` stays a
props-only component. Rendered inside `.title-bar__actions`, **before**
`<SubtitleEnterButton />`.

| State | Mark |
|---|---|
| Signed out | lucide `User` at 14px — identical weight to its siblings |
| Signed in | 20px circle, `background: transparent`, `border: 1.5px solid currentColor`, the initial at 11px |

The initial comes from `user.firstName?.[0] ?? user.email[0]`, uppercased — the same
expression `UserAccountInfo.tsx:64` already uses. `betterAuthUser.image` is **not**
consulted: the backend registers `emailAndPassword` only
(`sokuji-backend/src/auth/index.ts:62`, no `socialProviders` block), so it is always
`null` today. When OAuth lands, the outlined circle becomes a filled photo — a real
photograph earns the visual weight a flat colour disc does not.

**Balance label.** Reuses `.title-bar__action-label`, so the existing 576px breakpoint
hides it on narrow windows with no new media query. It renders a **compact** form,
not `formatUsdFloor`'s full precision:

- below one cent → `< $0.01`
- otherwise → two decimals, floored

Rationale is measured, not aesthetic: `$0.001552` costs 265px of safe width
(600px vs 335px). The title bar is a glance; the popover shows the exact floored
value. Truncation direction is unchanged — `< $0.01` never overstates the balance,
which is the property `formatUsdFloor` exists to guarantee
(`src/utils/formatters.ts:122-136`).

**Status dot.** 7px, top-right, with a 1.5px `#1a1a1a` ring so it reads against the
bar. Two conditions, deliberately different scopes:

| Condition | Shown when | Colour |
|---|---|---|
| Balance too low to start a session | `isKizunaManagedProvider(provider)` **and** `quota.balance ?? quota.remaining` `< sonioxManagedMinBalanceMicroUsd(textOnly, bothSplit)` | red `#e0665c` |
| E-mail not verified | `!betterAuthUser.emailVerified`, any provider | amber `#d99231` |

The low-balance scope is narrow on purpose: a BYOK user's wallet funds nothing, so
warning them would be the same "balance nothing draws from" noise that justified
`AccountSection`'s provider scoping. E-mail verification is account-level and shows
regardless. **When both apply, red wins** — it is blocking, the other is a reminder.

No dot renders while signed out — there is no account to report on.
`textOnly` and `bothSplit` are the same store values `sessionStartGate.ts:126` feeds
the floor, read from `settingsStore`; the button must not recompute them differently
or the dot and the Start button would disagree.

This dot is not only migration cover. Today a user discovers an insufficient balance
by finding the Start button greyed out; `sessionStartGate.ts:126` already computes the
floor, so surfacing it costs nothing new.

### 2. `AccountPopover` — new component

New: `src/components/TitleBar/AccountPopover.tsx` + `.scss`.

Shell copied from `ModeDevicePopover` (`FloatingPortal`, `useDismiss`,
`offset`/`flip`/`shift`/`size`, `autoUpdate`) and styled with that component's own
values: `background #2a2a2a`, `border 1px solid #444`, `border-radius 8px`,
`width 320px`, `font-size 12px`, `box-shadow 0 4px 16px rgba(0,0,0,.5)`
(`ModeDevicePopover.scss:4-13`).

**Signed out** — the rewritten `simpleConfig.signInRequired` (see §7), then two
buttons side by side: **Sign Up** (primary, `#10a37f`) and **Sign In** (ghost,
`1px solid #555`). Both are button-weight; sign-in is not demoted to a text link.
They `navigate('/sign-up')` / `navigate('/sign-in')` — the routes already exist
(`src/App.tsx:24-31`, `src/routes/SignUp.tsx`).

**Signed in** — renders `<UserAccountInfo />` unchanged plus the top-up button of §3.

### 3. `UserAccountInfo` — add a top-up button

`src/components/Auth/UserAccountInfo.tsx`.

The app currently has **no top-up entry at all**: the only route to money is the
`UserCog` icon opening `/dashboard` (`:255`), leaving the user to find Billing
themselves. Add a primary button below the balance line calling the existing
`openExternalWithAuth('/dashboard/billing')` — that path is the canonical one
(`sokuji-backend/web/src/App.tsx:127` redirects `/dashboard/wallet` to it).

`openExternalWithAuth` is a local function inside this component (`:223-249`) and
stays local — adding the button here rather than in the popover avoids extracting it,
and after §5 this component has exactly one consumer.

New locale key: `common.topUp`.

### 4. `TitleBar` — logs button behind advanced mode

`src/components/TitleBar/TitleBar.tsx`.

New prop `showLogsButton: boolean`; the logs `<button>` renders only when true.
`MainLayout` passes `uiMode === 'advanced'` — it already holds `uiMode`
(`MainLayout.tsx:26`), so `TitleBar` stays props-only.

**Edge case that must be handled**: `showLogs` persists in `sessionStorage`
(`MainLayout.tsx:33-35`). A user who opens logs in advanced mode and then switches to
basic is left with an open panel and no button to close it. `MainLayout` closes the
logs panel when `uiMode` becomes `'basic'`, clearing `panelState.showLogs`. Switching
back to advanced does **not** reopen it: the panel is closed, not suspended, which is
the predictable reading of a cleared flag.

Basic users needing logs switch to advanced mode via the existing toggle
(`Settings.tsx:126-145`). This is deliberately not a hidden gesture.

### 5. Remove `AccountSection`

Delete `src/components/Settings/sections/AccountSection.tsx` and
`AccountSection.test.tsx`; drop the export at `sections/index.ts:1` and the usage at
`SimpleSettings.tsx:170`. `UserAccountInfo` is **kept** — the popover renders it.

#### Migration

| `AccountSection` content | Destination |
|---|---|
| Avatar / name / e-mail | Popover header |
| Balance (floored) + 30-day usage | Popover body, balance promoted to display size |
| Refresh / manage account / sign out | Popover header, three icons |
| Feedback button | Popover header |
| E-mail verify button + 60s cooldown | Popover header — **plus the new status dot**, without which the unverified state has nowhere to be seen |
| Signed-out sign-in / sign-up buttons | Popover, signed-out state |
| `sign-in-prompt` copy | Popover, signed-out state (rewritten, §7) |
| Heading tooltip ("use your own key, or sign up for ours") | Already covered: the rewritten `signInRequired` copy (§7) states exactly this, so nothing is lost. The provider-dropdown marker listed under *Not in scope* would reinforce it, not carry it. |
| Section only rendered under a managed provider | No longer needed: a popover is opened deliberately, not a panel occupying space passively |

### 6. Settings order — interface language to the bottom

`src/components/Settings/SimpleSettings/SimpleSettings.tsx`.

Move the first `<LanguageSection showInterfaceLanguage={true} …>` (`:173-178`) to
immediately **before** `<HelpSection />` (`:216`). It stays its own section rather
than folding into Help: changing the interface language is infrequent but a
deliberate, searched-for action, and burying it inside Help makes it unfindable.

Onboarding is unaffected: that instance renders **no `id`**
(`LanguageSection.tsx:617`); `id="languages-section"` belongs to the *translation*
instance (`:657`).

Resulting order: translation languages → provider → microphone → speaker →
participant audio → **interface language** → help.

### 7. Copy — `simpleConfig.signInRequired`

Current copy opens by telling the reader they do not need to log in, and describes
registration as a purchase — on the one control whose job is to produce registrations.
Reverse the order: lead with what signing up gives, keep bring-your-own-key as the
fallback, and do not mention money in the first sentence.

- **en**: `Sign up to use Sokuji's built-in translation service — no API key needed. You can also keep using your own provider and key.`
- **zh_CN**: `注册后即可使用 Sokuji 自带的翻译服务，无需申请任何 API key。也可以继续使用你自己的服务商和密钥。`

All 30 locales are updated. Existing catalogue phrasings are reused where they exist
(each locale already renders "API key" its own way).

### 8. Onboarding — delete basic step 2, fold it into step 4

`src/contexts/OnboardingContext.tsx`.

Step 2 targets `#user-account-section`, which §5 deletes. **Re-pointing it at
`#provider-section` is not viable**: step 4 already targets that same element
(`:83`), and two consecutive steps spotlighting one element reads as a bug.

So step 2 is **deleted** and its message — that Sokuji has a built-in service needing
no API key — is folded into step 4's provider copy, which already enumerates the
provider choices. Basic onboarding goes from 9 steps to 8, and the "Step N" prefixes
in `onboarding.basic.steps.*.title` renumber accordingly across all 30 locales.

### 9. `ProviderSection` sign-in line becomes an entry point

`ProviderSection.tsx:963` renders `common.signInRequired` ("Please sign in to use
Kizuna AI as your provider") inside a grey `api-key-warning` — a statement of a
restriction with nothing to act on. The user has to work out for themselves that the
account entry is elsewhere.

The copy gains an inline link, rendered with `<Trans>`. That pattern is live in this
directory (`PoweredBy.tsx`, `ProviderSpecificSettings.tsx`) although the v0.38.0
refactor removed `ProviderSection`'s own last use of it.

Clicking the link **opens the title-bar account popover** rather than navigating.
Two reasons: the sign-in/sign-up affordance is then maintained in exactly one place,
and seeing the popover open up in the title bar teaches the user where the account
entry lives — next time they will know where to look.

Mechanism: `settingsStore` gains `accountPopoverRequested: boolean` and a setter,
mirroring the existing cross-component `settingsNavigationTarget` handshake.
`AccountButton` subscribes, opens its own popover when the flag is set, and clears
it. The popover anchors to `AccountButton`'s own ref, so no anchor element travels
between components.

Copy (en): `<signInLink>Sign in or sign up</signInLink> to use Kizuna AI — no API key needed.`
It must not contradict the popover's longer `simpleConfig.signInRequired` (§7); this
one is the short, inline form of the same claim.

### 10. Fix `Failed to get auth session` reaching signed-out users

`settingsStore.ts:896-899`:

```ts
const hasKey = getAuthToken
  ? await state.ensureKizunaApiKey(getAuthToken, true)   // <- hardcoded
  : false;
```

The literal `true` makes `ensureKizunaApiKey`'s own signed-out guard unreachable from
this call site — the guard at `:1051-1055` that would set the softer
`'User not signed in'`. Any path where `getAuthToken` is non-null but a token cannot
be obtained (an expired session being the obvious one) falls through to `:1069` and
stores the raw string `'Failed to get auth session'`, which `ProviderSection.tsx:952`
renders verbatim.

Two defects, both worth fixing:

1. **The hardcoded `true`.** Pass the real signed-in state so the guard can do its job.
2. **`kizunaKeyError` carries user-facing English.** Every value it can hold —
   `'User not signed in'`, `'Failed to get auth session'`, a raw `error.message` —
   is rendered straight to the user. Users in all 30 locales see untranslated
   engineering strings. It should carry a code the UI maps to a translated message,
   with the raw text logged rather than displayed.

**Not yet reproduced.** The exact path by which a *never-signed-in* user reaches this
string is unconfirmed: `ProviderSection` builds `getAuthToken` as undefined when
signed out, which should short-circuit before `ensureKizunaApiKey` is called. Follow
systematic-debugging — reproduce first, then fix. The two defects above stand on
their own regardless of which path produced the report.

### 11. Close the e-mail verification loop

Verification status is polled **only while the 60-second resend cooldown runs**
(`UserAccountInfo.tsx:108-152` — every 10s, plus once at 1s remaining). When the
cooldown expires the app never checks again. Clicking a link in an e-mail almost
always takes longer than 60 seconds, so the user comes back to an app that shows no
change and offers no instruction.

Removing `AccountSection` makes this worse rather than better: the polling lives
inside `UserAccountInfo`, which after §2 is mounted only while the popover is open.

Three parts, and they ship together:

1. **Refetch on return.** `AccountButton` is always mounted, so it refetches the
   session when the window regains focus or the document becomes visible — only
   while signed in and unverified, throttled to at most once per 10s. This is the
   case that actually happens: the user finishes verifying in the browser and
   switches back.
2. **Confirm it happened.** On `emailVerified` transitioning false to true, show a
   toast (`src/components/Toast`) and drop the amber dot. Without this the only
   feedback is the absence of a warning, which is not feedback.
3. **Say what to expect.** The popover message names the address and the return trip:
   `Verification e-mail sent. Finish it in your inbox and come back —
   Sokuji picks it up automatically.`

Part 3's wording is only honest if part 1 ships, which is why they are one change.

## Tests

TDD: each test written and seen failing before the implementation.

**`AccountButton`**
- signed out → renders the `User` icon, no initial, no dot
- signed in → renders the uppercased initial; falls back from `firstName` to `email`
- balance `$12.34` → label reads `$12.34`; balance `$0.004` → label reads `< $0.01`
- dot: unverified e-mail under a BYOK provider → amber (account-level scope)
- dot: low balance under a BYOK provider → **no dot** (wallet funds nothing)
- dot: low balance under a managed provider → red
- dot: low balance **and** unverified → red wins
- signed in, verified, funded → no dot

**`AccountPopover`**
- signed out → both Sign Up and Sign In present; each navigates to its route
- signed in → renders `UserAccountInfo`; top-up button targets `/dashboard/billing`

**`TitleBar`**
- `showLogsButton={false}` → no `.logs-button` in the tree
- `showLogsButton={true}` → present, toggles as before
- account slot precedes `SubtitleEnterButton` in `.title-bar__actions`

**`MainLayout`**
- switching `uiMode` to `basic` while logs are open closes the panel and clears
  `panelState.showLogs`
- advanced mode passes `showLogsButton={true}`

**`SimpleSettings`**
- no `AccountSection` renders in any provider state
- the interface-language section renders after participant audio and before Help
- `id="languages-section"` still belongs to the translation-languages instance

**`OnboardingContext`**
- basic steps contain no `#user-account-section` target
- no two basic steps share a target
- basic step count is 8

**`ProviderSection`**
- signed out under a managed provider → the sign-in line renders a clickable link
- clicking it sets `accountPopoverRequested`; `AccountButton` opens and clears it

**`settingsStore`**
- `validateApiKey` under a managed provider while signed out does not set
  `kizunaKeyError` to `'Failed to get auth session'`
- `kizunaKeyError` values map to translated copy, never raw English, wherever rendered

**E-mail verification**
- unverified + window focus → session refetched, throttled to once per 10s
- verified + window focus → no refetch
- `emailVerified` false→true → toast shown and the amber dot cleared

**Locales**
- `src/locales/locales.consistency.test.ts` already flattens every catalogue and
  diffs it against `en`, so it fails automatically if `common.topUp` is missing from
  any of the 30. No new test is needed — but it does mean the key cannot be added to
  `en` alone and filled in later.

## Not in scope

Carried out of this session's discussion deliberately, so they are not lost:

- **Google / OAuth sign-in.** Deferred by jiangzhuo. It would populate
  `betterAuthUser.image` (making the filled-photo avatar real) and remove four steps
  from registration, so it remains the single largest lever on sign-up volume.
- **Free credit on registration.** The backend grants nothing on sign-up, and
  `sessionStartGate.ts:126` blocks Start below the minimum balance, so the current
  path is *register → verify e-mail → top up → first translation*. This design makes
  the entry visible; it does not remove that wall.
- **Provider dropdown marker** ("no API key needed · sign up and go") on the
  Kizuna-managed row, whose rich option markup already exists
  (`ProviderSection.tsx:402-427`). The local provider is literally named "Free"
  (`providers.local_inference.name`) while the managed one says nothing about needing
  no key.
- **Registration page value proposition.** `SignUpForm` is a bare form; nothing on it
  says what signing up gives.

## Discovered, deliberately not done

**Annotating `validateApiKey`'s return type repairs 153 of the repository's 466 type
errors.** Found while implementing §10: adding `: Promise<ApiKeyValidationResult>` to
that one action drops repo-wide errors 466 → 337 and `src/stores/` 149 → 33, by
restoring contextual typing across the whole `create<SettingsStore>()` object literal
that one un-annotated action was poisoning.

It was left out on purpose. It surfaces three previously-masked errors — including
that **`isValidated` is written in five places in `settingsStore.ts` and is not
declared on the `SettingsStore` interface at all** — so landing it inside a bugfix
task would have blown that task's zero-new-errors bar and invalidated the baselines
the remaining tasks measure against.

It deserves its own change: one line of annotation, a 33% cut in the repository's
type errors, and a genuine missing field brought to light.

## Open questions

None outstanding. Status-dot colours (red outranking amber) and the "Top up" label
were settled 2026-08-24; both are recorded in *Decisions*.
