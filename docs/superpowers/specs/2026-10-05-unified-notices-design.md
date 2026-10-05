# One way to tell the user something: three kinds of notice, three renderers, no toast

Status: approved in conversation 2026-10-05, written for review.
Issue: kizuna-ai-lab/sokuji#481. Builds on `origin/main` e2c28b61 (#596 and #597 merged).
Rendered references (private artifacts, jiangzhuo's account):
today's surfaces https://claude.ai/artifact/6ivZPuGimrKgmLa1ugF9kt ·
round-1 candidates https://claude.ai/artifact/LDHrXE2a3Fefaj8PmdDSMU ·
the design as approved https://claude.ai/artifact/HEdyYUhSnxkeCzdBQu11zb.
Every specimen on those pages is the product's own class chain and SCSS compiled from
e2c28b61, with strings from `locales/en` and `locales/zh_CN`; the rulings below were made
by looking at them.

## Problem

#481 was filed on 2026-09-04 against ten notice surfaces. The client-contract rewrite
(#570) and #596 have since done the plumbing half of its goal: L1 holds session notices
(`Conversation.ts:90-132`), MainPanel draws a projection instead of replacing React state,
the subtitle band reads the same entries, every notice has a code and `noticeText()`
localises it, and `Notice.lifetime: 'transient'` is a kind-level lifetime with one
constant (`src/lib/view/filter.ts:38-42`). What remains is the half the issue called
"placement decided by whoever wrote the call site". On e2c28b61 the renderer has 31
places that tell the user something; the four this design covers are:

1. **Conversation notices** — `NoticeBubble` (`src/components/Conversation/ConversationList.tsx:189-227`).
   The warning bubble has no CSS of its own: `message-bubble error warning` renders
   identically to error, only the header word differs. Three severities are drawn as
   message-sized bubbles headed ERROR / WARNING / NOTICE, so a microphone changing
   (#596) reads like an accident. `.message-action` is `font: inherit` with no root font
   size set, so it is 16px beside 14px text.
2. **Current-state blockers** — five drawings for one class of information. Why Start
   is disabled is a native `title` in basic mode (`PanelFooter.tsx:122`, invisible until
   hover) and a `<span class="tooltip">` in advanced (`:213-215`) that inherits the
   disabled button's `opacity: .6`; the Electron subtitle window shows the same code as a
   visible fix button (`SubtitleIdle.tsx:96`). Reconnecting has a label in basic and
   nothing in advanced (`.status-dot.reconnecting` is unstyled there). Echo is a
   `position: fixed` chip (`EchoNotice.scss:1-24`) floating over the transcript; in a
   450px panel its `left: 50%` leaves it at most ~225px wide. A start that failed is
   drawn as an error bubble in the timeline (`src/lib/view/lastEnd.ts`) although it is a
   state, not an event.
3. **App-level banners** — `UpdateBanner` and `AudioSystemBanner`, two components with
   the same geometry and different lifetime rules; the update banner's whole content is
   the button and "check failed" is a red banner that hides itself after 5 s
   (`updateStore.ts:170-185`).
4. **Toast** — one component, six call sites, durations picked per call (2/4/5/6/8 s),
   `fixed; bottom: 24px` over the control footer, the same ~225px ceiling at 450px, no
   dedupe, no cap, and the one message a user would want to find again ("Conversation
   saved: <file>") gone after 6 s.

Modal interrupts (`WarningModal`) and the Settings panel's inline validation are not in
scope: their placement is right, each message sits where the user acts (ruling 1).

## Goals

1. Where a notice is drawn, how long it lives and whether it can be dismissed follow from
   its **kind**, decided once in this document, never at the call site.
2. A user can always see why Start is disabled, and what is wrong while running, without
   hovering.
3. The transcript keeps its record (events stay with the conversation and its export)
   but reads as a record: system rows are quieter than messages and distinct per severity.
4. No floating layer in the main panel. Nothing overlaps the footer; nothing is limited
   to half the panel's width.
5. Basic and advanced mode, the 300px extension side panel and the 450px panel show the
   same things in the same places.
6. No new locale keys: every string drawn here already exists in the 30 catalogs.

## Rulings (jiangzhuo, 2026-10-05)

- Scope: categories 1–4 above. Modals and Settings inline validation stay as they are.
- Approach A — placement by kind, one renderer per kind, one lifetime table — over B (one
  footer strip for everything, no system rows) and C (a notification centre with a bell).
- Event rows: **R2**, the centred small system row (chat convention), over R1 (today's
  bubble recoloured) and R3 (a full-width bar with a severity edge).
- State line: **P1**, its own line between the conversation and the control footer, over
  P2 (inside the footer, replacing the language pair) and P3 (a pill pinned at the bottom
  of the conversation area).
- Banner tone for "new version": the brand green, as today, with an explicit action button.
- The advanced footer's status dot gets basic's amber reconnecting style.
- **Toast is removed.** Results of an action are not a kind: a result about the
  conversation is an event row; a result about a control or form is shown there.
- Copy success/failure is an event row too, not feedback on the export button: "the export
  button is too small, and adding feedback there disturbs the layout".
- Session expired goes into the sign-in card's existing red `.error-message` slot.
- E-mail verified adds nothing: the title-bar dot clearing and the green check beside the
  address, both of which exist, are the feedback.

## Design

### 1. The model: three kinds

| kind | what it is | renderer, where | lifetime | dismiss | actions |
|---|---|---|---|---|---|
| **event** | something that happened at a moment of the session; part of the record | `SystemRow` in the conversation list, in time order | with the conversation (Clear, the next start); `transient` rows hide after `TRANSIENT_NOTICE_MS` (8 s) but stay in the record; the JSON export keeps them | no | rarely: only when the run continued and the user can change something (`voice_fallback` → Settings; "Show in folder") |
| **state** | why the user cannot start, or what is wrong right now; not a record | `StatusLine`, one line above the control footer | while the condition holds; when several hold, the highest priority is shown | echo and the subtitle-entry hint only | the fix: Settings, Top up, Sign in, Open System Settings |
| **app** | an environment condition unrelated to the session, handled once | `Banner` at the top of the panel; `attention` tone above `brand` | until dismissed or resolved; `downloading` cannot be dismissed | yes | Repair / Retry / Download now / Restart and Update |

Results of a user action are **not a kind**. Each is shown where it belongs (section 5).

The runner, L1 and the stores do not change what they record. This design changes what the
view does with it: one selector per kind, one component per kind, one table of rules.

### 2. event — the system row (R2)

**Source.** L1 `Notice` (`src/lib/conversation/types.ts:35-46`), unchanged: `severity`
`error | warning | info`, `code`, `params`, `lifetime?: 'transient'`. The projection and
`useVisibleEntries` (`src/components/Conversation/useVisibleEntries.ts`) stay as they are.

**Rendering.** `SystemRow` replaces `NoticeBubble` (`ConversationList.tsx:189-227`):

- A centred block, `font-size: 12px; line-height: 1.4; padding: 3px 8px; text-align: center`,
  no background, no border, no header word. The icon is inline before the first word
  (`display: inline-block; vertical-align: -2px; margin-right: 5px`, 13px), so it flows
  with centred text instead of sitting at the left edge.
- Severity is carried by the icon colour and the text's brightness, nothing else:
  error — `CircleAlert` `#ff6b6b`, text `#d8d8d8`; warning — `TriangleAlert` `#f39c12`
  (`$color-degraded`), text `#bdbdbd`; info — `Info` `#8a8a8a`, text `#8a8a8a`.
- An action is an inline link after the text, ` · Settings`, `#0fbb8f` underlined, the
  separator `#666`. The row carries at most one action.
- At 300px a two-sentence row wraps to three lines and stays centred; nothing truncates.
- The row never opens or breaks a header group (`filter.ts:62-79` is unchanged) and shows
  under every display filter, as today.

**Which events carry an action.** Only a notice that says "the run continues, but you can
change something": the voice-preparation warnings (`voice_clip_missing`, `voice_pool_busy`,
`voice_build_failed`, `voice_unavailable`, `voice_fallback` → Settings via
`src/lib/view/noticeTargets.ts`) and the panel notes of section 5 ("Show in folder"). Why a
run ended (`budget_exhausted`, `segment_ended`, `leg_closed`, `source_ended`,
`connection_lost`, a leg's `failed`) is recorded without an action: the fix, if there is
one, is the state line's job, so it appears once (section 3, and X2 on the approved page).

**Removed with it.** `NoticeBubble`; the `.message-bubble.error`, `.error.warning`,
`.error-content`, `.message-action` and `.message-bubble.system` rules in
`MainPanel.scss:127-213` once nothing else uses them (the old Local Native settings shell
is unmounted; check before deleting); `mainPanel.error` / `mainPanel.warning` /
`mainPanel.notice` stop being drawn (the keys stay; removing locale keys is not this
design's job).

### 3. state — the status line (P1)

**One selector, `statusLine(inputs) → StatusEntry | null`** in `src/lib/view/statusLine.ts`,
pure, with its inputs passed in so it is testable without React:

```ts
interface StatusEntry {
  key: string;                                   // stable per condition, for dedupe and dismiss
  code: string; params?: Record<string, string>; // for noticeText()
  text?: string;                                 // when the words are not a notice code (echo)
  icon: 'mic-off' | 'key-round' | 'wallet' | 'refresh-cw' | 'triangle-alert' | 'captions' | 'circle-alert';
  action?: NoticeAction;                          // section 6
  dismissible: boolean;
}
```

Inputs and priority, highest first; the first that holds is the line:

1. **Cannot start** (idle only).
   a. `idleOf()` reports `unready` (`src/lib/subtitle/session.ts:57-69`): `no_microphone`,
      the start gate's refusals (`src/lib/session/shape.ts`: `credentials_missing`,
      `balance_below_floor`, `quota_pending`, `quota_unknown`, `wallet_frozen`,
      `participant_*`, `turn_mode_unsupported`, `no_legs`), or the provider's readiness
      code (`not_ready`, `auth`, …).
   b. else the last start's refusal or failure: `runner.state.idle.lastEnd` with reason
      `refused` or `start-failed` (`runner.ts:168-249`), shown until the next start or
      Clear. This replaces the timeline's "last end" bubble (`src/lib/view/lastEnd.ts`),
      which is removed; MainPanel's `dismissedEnd` state stays, as the "until Clear" the
      selector reads (Clear records the end it dismissed).
   Action by code: `NOTICE_TARGETS` codes → Settings (deep link); `balance_below_floor`,
   `insufficient_balance` → Top up; `sign_in_*` → Sign in;
   `loopback_denied` → Open System Settings (today's `MainPanel.tsx:209`). Icon:
   `mic-off` for `no_microphone`, `key-round` for credentials, `wallet` for balance,
   otherwise `circle-alert`.
2. **Reconnecting** (running): any leg `'reconnecting'` (`run.ts:521-527`). Text
   `connectionStatus.reconnecting`, icon `refresh-cw`, no action. The status dot keeps its
   amber pulse in basic and gains the same rule in advanced; the basic footer's
   `.reconnecting-label` (`PanelFooter.tsx:78-94`) is removed, the line carries the words.
3. **Waiting for a microphone** (running, speaker leg, no usable input selected — the
   state #596 introduced in `audioStore`): text `notices.mic_lost_waiting`, icon `mic-off`,
   no action. The moment the microphone went away is still an event row
   (`mic_lost_using_other` / `mic_lost_waiting` as #596 records them); this line is the
   wait that follows and disappears when a microphone is in use again. The waiting
   notice's `transient` lifetime stays: the row hides after 8 s, the line stays.
4. **Subtitle layer unavailable** (extension): `SubtitleEnterButton.tsx:49-56` raised
   `CONTENT_SCRIPT_UNAVAILABLE` on the last attempt. Text
   `subtitle.enterButton.refreshPageHint`, icon `captions`, dismissible; cleared by the
   next successful entry or by dismiss. Held in a new `subtitleStore.entryHint` field
   (`'refresh' | null`), set where the toast is shown today. It ranks above echo because
   the user just pressed the button and nothing happened.
5. **Echo**: `useEchoNotice`'s state (`src/components/EchoNotice/useEchoNotice.ts:42-84`),
   unchanged as a source: cause-keyed dismiss, all-clear resets. Text is the cause's
   message plus its advice (`echoNotice.ttsEcho` + `echoNotice.actionHeadphones`, etc.),
   icon `triangle-alert`, dismissible. `EchoNotice.tsx` and `EchoNotice.scss` are removed.

Only one line shows. A lower-priority condition that still holds when the higher one
clears appears then (S3 on the approved page). `key` lets the dismiss of echo stay
per-cause while another line is on top.

**Rendering.** `StatusLine` (`src/components/MainPanel/StatusLine.tsx`), mounted in
`MainPanel.tsx` between `.conversation-display` and `.control-footer` in both modes, and in
the Electron subtitle takeover's expanded view (`SubtitleBody` → the same component):

- `display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: #252525;
  border-top: 1px solid #333; font-size: 12px; line-height: 1.4; color: #e8e8e8;
  flex-shrink: 0` — the text-input row's colours (`MainPanel.scss:265-269`).
- Icon 14px, `#f39c12`. Text `flex: 1; min-width: 0`, wraps. The row is as tall as its
  tallest item (the action button), so the items are centred on it: with top alignment a
  one-line text sat 6px under the top edge and 12px over the bottom one. The words and the
  action's label are centred by their ink, not their line boxes, where the browser can trim
  a line (`text-box: trim-both cap alphabetic` under `@supports`, the `cap-centred` mixin,
  the trimmed height given back as padding): a centred box left Chinese 0.6–0.8px high,
  and a fixed 1px that fixed one platform pushed another off (measured on Linux and macOS).
- Action: a small button at the right, `background: rgba(255,255,255,.1); color: #fff;
  padding: 3px 8px; border-radius: 3px; font: inherit`. Dismiss: an `X` 14px, `#aaa`,
  `aria-label` `common.dismiss`. A line has an action or a dismiss, not both.
- The Start button keeps `disabled`; its `title` (basic) and `.tooltip` (advanced,
  `MainPanel.scss:539-581`) are removed. `startBlockMessage` (`MainPanel.tsx:216-218`)
  moves into the selector. The ModePicker's amber inset ring (`mode-picker__segment--warn`)
  stays: it points at *where* to fix. The lease countdown stays in the footer; it is a
  number, not a blocker.

### 4. app — one Banner

`Banner` (`src/components/Banner/Banner.tsx`) replaces `UpdateBanner` and
`AudioSystemBanner`. Geometry is today's `AudioSystemBanner.scss`: `display: flex;
align-items: center; gap: 12px; padding: 6px 12px; font-size: 12px; color: #fff;
flex-shrink: 0`; content = 14px icon + wrapping text; actions = one `.banner__btn`
(`rgba(255,255,255,.15)`, `padding: 3px 8px; border-radius: 3px`, optional 12px icon) and
an `X` 12px. Two tones: `attention` `$color-usage #e67e22`, `brand` `$color-primary-fill
#008261`. Each line of words and the button's label is an element of its own, centred by its
ink the same way as the status line's (`cap-centred`), so the button is equally tall with or
without an icon and in every interface language.

`useBanners()` returns the ordered list to draw, `attention` first:

| store state | tone | icon | text | action | dismiss |
|---|---|---|---|---|---|
| `audioSystemStore.status === 'unavailable' && !dismissed` | attention | `TriangleAlert` | by `reason`, as today (`AudioSystemBanner.tsx:43-78`) | Repair (`Wrench`) or Retry (`RefreshCw`), spinning while busy | yes; a live `ok:false` push re-shows it, as today |
| `updateStore.status === 'available'` | brand | `Download` | `update.available` (or `linuxMigrateTitle`) | `update.downloadNow` → start the download (the handler `UpdateDialog`'s primary uses today); on a build without auto-update, `update.goToDownload` → open `UpdateDialog`, which keeps the AppImage/deb links | yes; re-armed by the next `available` |
| `'downloading'` | brand | `RefreshCw` spinning | `update.downloading` + the progress bar | — | no |
| `'downloaded'` | brand | `RefreshCw` | `update.downloaded` | `update.restartNow` → `installUpdate()` | yes |

The banner's text is no longer a button (`UpdateBanner.tsx:54-104`'s `role="button"` goes).
`updateStore`'s `error` status no longer draws a banner and loses its 5 s self-reset
(`updateStore.ts:170-185`); the Help link consumes it (section 5). A failure while
`downloading` returns the banner to `available` (Download now is the retry) and one while
`downloaded` keeps `downloaded`, from the status the error interrupted
(`updateStore.errorFrom`); other check failures stay silent. `UpdateDialog` stays for
the no-auto-update path only; whether anything else still opens it is checked in the plan.

### 5. Results: where each toast goes

`components/Toast/` (`ToastContext`, `Toast`, `useToast`, the `ToastProvider` in
`AppProviders.tsx:16`) and the `notify` bridge (`useAppSession.ts:22-28`, `session.ts:145-152`)
are deleted. Each of the six uses:

| today (`showToast` at) | becomes |
|---|---|
| copy to clipboard ok / failed (`ExportButton.tsx:207-209`) | **panel note** (below): info `mainPanel.export.copySuccess` / warning `mainPanel.export.copyFailed`, `transient` |
| session-end auto-save ok / failed (`lib/transcript/autoSave.ts:27,57`) | **panel note**: info `mainPanel.export.autoSave.saved` with action Show in folder (`open-directory`, as today) / warning `…autoSave.failed`; not transient |
| session expired (`UserAccountInfo.tsx:274-277`) | the sign-in card's `.error-message` (`SignInForm.tsx:89-93`), text `auth.sessionExpired`. `setAuthOverlay('sign-in')` gains a reason: `settingsStore.authOverlayReason: 'session_expired' \| null`, set beside `authOverlay`, read once by `SignInForm` as its initial `error`, cleared when the overlay closes or switches kind (not on submit) |
| e-mail verified (`AccountButton.tsx:66-73`) | nothing. The `unverified` dot (`AccountButton.scss:36-49`) clears and the address shows its green check (`UserAccountInfo.tsx`, `email-verified-icon`), both existing; the effect is deleted |
| refresh the meeting tab (`SubtitleEnterButton.tsx:52`) | **state** line, priority 4 (section 3) |
| update check failed (today a banner, `UpdateBanner.tsx:37-46`) | the Help link's label (`HelpSection.tsx:76-84`), which already swaps to `update.checking` while checking: on a result it shows `update.upToDate` (green, `Check` 13px) or `update.error` (red `#ff6b6b`, `CircleAlert` 13px) for 5 s, then returns to `update.checkButton`. status `not-available` draws `update.upToDate`, `error` draws `update.error`, both read from `updateStore.status`; the 5 s timer lives in the component |

**Panel notes** — results about the conversation that are not part of it. A small store,
`src/stores/panelNotesStore.ts`: `{ id, at, severity, code, params?, action?, lifetime? }`,
the same shape `SystemRow` draws for an L1 notice. MainPanel appends them after the
conversation's visible entries (the slot the "last end" item used, `MainPanel.tsx:178-183`),
`useVisibleEntries`'s transient rule applies to them too. They also draw in the Electron
takeover's expanded list and, while the extension overlay runs, under the panel's
placeholder — never in the compact view, the bands or the exports. They are cleared by Clear and by
the next start, and a result that answers only after that is dropped: the copy and the
auto-save take their writer (`panelNoteWriter`) before they await, bound to the store's
epoch, so a clipboard that answers late or a save that outlives the runner's 5 s bound never
writes after another conversation. They are not L1 notices on purpose: the text export, the JSON export and
the subtitle bands read L1 only, so nothing has to filter them out, and the contract's
`Notice` type does not change.

### 6. Actions, in one place

`src/lib/view/noticeActions.ts` replaces the ad-hoc mapping in `MainPanel.tsx:205-212`:

```ts
type NoticeAction =
  | { kind: 'settings'; target: SettingsTarget }   // from noticeTargets.ts
  | { kind: 'top-up' }                              // settingsStore.accountPopoverRequested (settingsStore.ts:198; AccountButton.tsx:46-51 opens on it)
  | { kind: 'sign-in' }                             // setAuthOverlay('sign-in')
  | { kind: 'system-settings'; pane: 'screen-recording' | 'audio-capture' }
  | { kind: 'show-in-folder'; dir: string };
```

`actionFor(code, params)` returns the action for a code (events and the state line alike);
`labelFor(action)` returns the locale key (`settings.title`, `common.topUp`,
`common.signIn`, `audioPanel.openSystemSettings`, `mainPanel.export.autoSave.showInFolder`);
MainPanel owns the handlers. Rows and the status line stay presentational.

### 7. Subtitle window and extension overlay

- **event** → the compact bands as today (`src/lib/subtitle/bands.ts`); the Electron
  takeover's expanded list draws `SystemRow`. Panel notes are not L1, so they never reach
  a band.
- **state** → idle: `SubtitleIdle` keeps its fix button and its own idle drawing; it does not
  read the selector — its words come from the same `idleOf` and `noticeText`, so both windows
  say the same thing. Running: the takeover's expanded view
  mounts `StatusLine`; the compact bands and the extension overlay do not.
- **app** → not drawn in either subtitle surface.

### 8. What this does not change

`report()` / `CLIENT_DIAGNOSTICS` / LogsPanel (the diagnostics policy of #441); how
adapters raise `failed` and `degraded`; `Notice`'s type and L1's recording; `noticeText`,
`NOTICE_WORDS` (no locale key is added or removed; `NOTICE_ALIASES` gains four rows for the
panel notes — a code table, not a catalog); the subtitle bands' shape;
`WarningModal` and every Settings inline message (ruling 1); Local Native's old `IClient`
path, which draws through the kept shell until #578.

## Testing

Unit, colocated, vitest:

- `statusLine.test.ts`: every input alone yields its entry with the right code, icon,
  action and dismissibility; two at once yield the higher priority; the lower appears when
  the higher clears; a dismissed echo cause stays dismissed under a reconnect; `lastEnd`
  with `lease-ended` or `user` yields nothing; Clear removes a `start-failed` line.
- `panelNotesStore.test.ts`: append; transient notes hide after `TRANSIENT_NOTICE_MS` and
  non-transient stay; cleared on Clear and on the next start; `renderTranscriptTxt`,
  `renderTranscriptJson` (`src/lib/export/transcript.ts`) and `buildBands`
  (`src/lib/subtitle/bands.ts`) never see them, since they take L1 entries only.
- `SystemRow.test.tsx`: severity → icon and class; at most one action; the action calls
  the handler with the resolved `NoticeAction`.
- `StatusLine.test.tsx`: renders text via `noticeText` for a code and raw text for echo;
  action xor dismiss; `aria-label` from `common.dismiss`.
- `Banner.test.tsx` + `useBanners.test.ts`: tones, order (attention above brand),
  `downloading` has no dismiss, update `error` draws no error banner (a failed download or
  install keeps its way back, section 4).
- `HelpSection.test.tsx`: the link label swaps to `upToDate` / `error` on a result and back
  after 5 s (fake timers); `checking` as today.
- `SignInForm.test.tsx`: `authOverlayReason: 'session_expired'` shows `auth.sessionExpired`
  in `.error-message` once; closing clears the reason.
- `PanelFooter.test.tsx`: no `title` on the disabled Start, no `.tooltip`, no
  `.reconnecting-label`; the advanced dot has `reconnecting`.
- Consistency: `src/lib/diagnostics/consoleLedger.consistency.test.ts` rows for the removed
  files go; a new assertion that nothing under `src/` imports `useToast`, `EchoNotice`,
  `UpdateBanner`, `AudioSystemBanner` or `lastEnd`; `locales.consistency.test.ts` is
  unaffected because no key changes.

By hand (jiangzhuo's live checks), against the approved page:

- Basic and advanced at 450px and the extension at 300px: disabled Start shows its line;
  unplug the mic mid-run → event row, then the waiting line, then the "now using" row;
  echo with speakers → the line, dismiss, all-clear re-arms.
- Electron: audio-system banner above the update banner; Download now / Restart and Update;
  Help → Check for updates → the label swap; session end → the saved row and Show in folder.
- A 401 on an external link → the sign-in card opens with the red line.

## Out of scope

- `WarningModal` and the Settings panel's inline messages (categories 5 and 6).
- The subtitle bands' own design; the extension overlay beyond section 7.
- Local Native's old path (#578), LogsPanel, `EchoMonitor`'s thresholds.
- Removing now-unused locale keys (`mainPanel.error`, `mainPanel.warning`, `mainPanel.notice`,
  `auth.emailVerifiedToast`); a locale sweep is its own PR.
- Showing app banners or the state line in the extension's subtitle overlay.

## Delivery

Four pull requests, in order, each leaving `main` consistent:

1. **event** — `SystemRow` replaces `NoticeBubble`; `panelNotesStore`; copy and auto-save
   become panel notes and their `showToast` calls go; `noticeActions.ts`.
2. **state** — `statusLine` selector and `StatusLine`; removes the Start `title`/`.tooltip`,
   `lastEnd.ts` and `dismissedEnd`, `EchoNotice`, the basic `reconnecting-label`; the
   advanced dot's style; `subtitleStore.entryHint` and the subtitle-entry toast; the
   takeover window mounts the line; `SubtitleIdle` keeps its own idle drawing.
3. **app** — `Banner` + `useBanners` replace both banners; update actions; the Help link's
   result label; `updateStore` drops the error banner and its timer.
4. **no toast** — `authOverlayReason` and the sign-in card line; the e-mail-verified effect
   goes; `components/Toast/` and the `notify` bridge are deleted; the import assertion lands.
   #481 closes here.

Each PR renders its surfaces at 450px and 300px, in `en` and `zh_CN`, and compares them
with the approved page before review.
