# Diagnostics Reporting — Design

**Date**: 2026-08-25
**Status**: Drafted for review by jiangzhuo. Resolves kizuna-ai-lab/sokuji#441 at the root.
`file:line` references verified against `main` at `4e5f4488`. Produced by a judged design panel
(three independent proposals, three review lenses, synthesis, adversarial verification of the
seven load-bearing claims — two were refuted and are corrected below; see §10).

# `report()` + client `onDiagnostic` + one session-failure sink + an exact console ledger

Resolves kizuna-ai-lab/sokuji#441 at the root. Base: **minimal-fundamental** (highest aggregate: 7/8/8). Grafts: `onDiagnostic` on `ClientEventHandlers` and a small closed client-code table (events-notifications), the `JSON.stringify` grep, the deferred-write invariant test and the pre-listed components/modern-audio ledger (logger-sinks), plus fixes for the three flaws no design handled (flush-starvation cap, `persistErrors` test, CI not running vitest). Every file:line below was re-read on `main` at 4e5f4488.

Ground truth corrections: the in-scope count is **154 calls in 27 files** (SonioxClient is 7); there are **5** `addLog` callers: `ModelManagementSection.tsx:517`, `ChildWindowPopover.tsx:73`, `OpenAIWebRTCClient.ts:299`, `EphemeralTokenService.ts:109`, and `MainPanel.tsx:1309` (the echo notice, where `addLog` is destructured from `useLogActions()` — so any guard must match `\baddLog\(`, `useAddLog` and `useLogActions`, never `\.addLog\(`).

## 1. Problem statement

Nothing in the repo decides where a caught failure goes, so every call site — and CodeRabbit, which quotes CLAUDE.md as "coding guidelines" — decides again. There are three partial decision points today and they disagree with each other: `buildChannelTelemetryHandlers` (`participantTelemetry.ts:62-75`: console + `session.error` panel row + `api_error` analytics, tagged speaker/participant) handles only the client `onError` stream — 9 of the 44 client-side `console.error` lines sit beside an `onError` emission and duplicate it; the speaker connect catch (`MainPanel.tsx:2790-2830`) emits `session.init_error` + `error_occurred`; the participant connect catch (`MainPanel.tsx:2445-2472`) emits `participant.error` with **no** `clientId` and **no** analytics, so the row is filed under the *speaker* tab (`logStore.ts:235` defaults to `'speaker'`). PalabraAIClient (10 lines) and ManagedSonioxSession (3) reach none of the three; ~24 client lines (validation, parse, cleanup) have no counterpart in any sink, so deleting them would delete the only record. The panel is not an attractive destination because it has three real defects: `addLog` forces `clientId || 'speaker'` (`logStore.ts:208`) so non-session failures file under the "Me" tab; `handleCopyLogs` exports only `log.events` (`LogsPanel.tsx:200-215`) so every plain entry is dropped from bug reports; and `addLog` has no redaction, no cap and no dedupe while `addRealtimeEvent` stamps everything `'info'` (`:442`). The 154 console lines are the symptom of that missing rule plus those three defects.

## 2. Decisions (the CLAUDE.md policy)

1. A caught failure is recorded by `reportError`/`reportWarning` from `src/lib/diagnostics/report.ts`, never by `console.error`/`console.warn` — because the helper is where console-vs-panel is decided once.
2. `report()` writes the console line synchronously with the full `cause` and a redacted one-sentence `message` to LogsPanel one microtask later — because console is the developer surface and the panel is the user-diagnostic surface, and deferral makes it safe from any call stack including render.
3. `report()` never shows UI; a failure the user must act on becomes state on the owning store (or `handlers.onError`) and a component renders it — because a logger that can pop toasts is how "which tier?" gets re-litigated per site.
4. Inside an `IClient` session, clients use `handlers.onError` (session broken → bubble), `handlers.onDiagnostic` (session continues, degraded → panel, channel-tagged), `handlers.onRealtimeEvent` (wire traffic), or throw out of `connect()` — never `report()` and never `console.*` — because the channel is known only in MainPanel, and PR3 makes `participantTelemetry.ts` the single sink for *all four* (the two connect catches at `MainPanel.tsx:2445` and `:2790` are rewired through it, which also fixes the mis-filed participant row and the missing participant analytics).
5. `message` is typed `Message<T>`, which rejects `any`, `unknown`, `string | undefined` and objects; the caught value goes in `cause`, which never leaves the console — because the full-body dump at `EphemeralTokenService.ts:200` must be a compile error, not a review comment.
6. Redaction happens in the sinks (`logStore.addLog` and `sanitizeEvent`), with one pattern list in `src/lib/diagnostics/redact.ts` shared with `errorTracking.ts` — because sink-side redaction covers legacy callers and future bypasses by construction.
7. Two severities for failures: `error` = what the user asked for did not happen; `warning` = it happened or will (fallback, retry, in-memory but not persisted); `info` is not a failure and stays `console.info`/`addRealtimeEvent` — because the panel's plain-entry stream must be readable as "Problems".
8. If the failure already reaches the panel by another route (`onError`, `onRealtimeEvent`, a rethrow into MainPanel's connect catch, `validationMessage`, descriptor `notices`), add nothing — because a second line is the duplicate CodeRabbit keeps finding.
9. Per-chunk, per-frame and per-poll-tick code never logs per occurrence: return silently, or report on the state transition (ok → failed) with a `dedupeKey` — because the panel array is on the audio thread's write path.
10. Persist settings through `persistSetting()`, which awaits `setSetting`, reads `result.success`, catches rejection, and reports once per key — because today **no call site reads `result.success`** (the failure `setSetting` actually reports — quota, `chrome.runtime.lastError` — is dropped at all 31 sites), while the `.catch`/`catch` around it only fires in the extension when `chrome.storage.sync.set` throws synchronously (`SettingsService.ts:68` returns an un-awaited Promise from inside `try`, so an executor throw bypasses the `catch` at `:95`). The seam owns both channels; the 31 per-site handlers are deleted because the seam replaces them, not because they are dead.
11. Remaining `console.error/warn` in `src/stores`, `src/services`, `src/contexts`, `src/components`, `src/lib/modern-audio` are ledger-tracked in `consoleLedger.consistency.test.ts` and lowered in dedicated PRs, not in passing — because that sentence is what answers the bot on a line the ledger already covers.
12. Workers, AudioWorklets, extension background/content/popup and Electron main cannot import the store; they keep their existing message/IPC channel and the renderer-side caller reports — because a sink stubbed four times is four places where "it logged" is a lie.

## 3. Architecture

### 3.1 Modules and import graph

```
src/lib/diagnostics/
  redact.ts                         leaf. redact(s): string. The only secret-pattern list.
  clientDiagnostics.ts              leaf. CLIENT_DIAGNOSTICS table; ClientDiagnosticCode = keyof typeof.
  report.ts                         → ../../stores/logStore (value). reportError/reportWarning/describeCause/settleReports.
  report.test.ts
  consoleLedger.consistency.test.ts the ratchet (section 7)

src/stores/logStore.ts              → zustand, react, ./sanitizeEvent, ../lib/diagnostics/redact   (stays a leaf)
src/stores/sanitizeEvent.ts         → ../lib/diagnostics/redact
src/lib/errorTracking.ts            → ./diagnostics/redact   (drops its private API_KEY_RE)
src/services/persistSetting.ts      → ../lib/diagnostics/report, ./ServiceFactory
src/services/interfaces/IClient.ts  → import type { ClientDiagnosticCode } from '../../lib/diagnostics/clientDiagnostics'
src/components/MainPanel/participantTelemetry.ts → report (value), clientDiagnostics (value)
                                    gains onConnectFailed(channel, error): the sink for the two
                                    MainPanel connect catches (session.init_error / participant.error,
                                    both channel-tagged, both tracked) — PR3a
stores/*, services/*, contexts/*, components/*, lib/modern-audio/* → report
services/clients/**                 → NO value import of stores/logStore or lib/diagnostics/report (test-enforced)
```

`src/lib → src/stores` already exists (`src/lib/modern-audio/ModernBrowserAudioService.ts` imports stores), so `report.ts → logStore.ts` adds no new edge class. `logStore.ts` imports only `redact.ts`, which imports nothing; `errorTracking.ts`'s posthog import is type-only (`errorTracking.ts:1`). No cycle is possible; the leaf test (section 7) fails if one is introduced.

Not adopted: a `Sink` interface with `timing: 'sync'|'deferred'` (logger-sinks) — the render-safety invariant would be one future sink away from breaking (judge 1). Not adopted: a ~30-row `POLICY` table every failure must edit (events-notifications) — `settingsStore.ts` moved 27 times and `MainPanel.tsx` 66 times in 30 days; a single shared vocabulary file becomes the conflict file for all of them (judge 3). The closed vocabulary survives only where it is structurally needed: client codes, because clients cannot import the store.

### 3.2 TypeScript interfaces

```ts
// src/lib/diagnostics/report.ts
type IsAny<T> = 0 extends 1 & T ? true : false;
/** A string, never `any`/`unknown`/`string|undefined`. Verified with the repo's tsc:
 *  `reportError('X', data)` with `data = await response.json()` does not compile. */
export type Message<T> = IsAny<T> extends true ? never : T extends string ? T : never;

export interface ReportOptions {
  /** The caught value. Console only — never crosses into the panel. */
  cause?: unknown;
  /** Session leg. Omit for settings, auth, devices, models. Undefined = global entry. */
  clientId?: ClientId;
  /** Panel throttle key; defaults to `${scope}|${message}`. Use when the message varies per burst. */
  dedupeKey?: string;
}

export function reportError<T>(scope: string, message: Message<T>, opts?: ReportOptions): void;
export function reportWarning<T>(scope: string, message: Message<T>, opts?: ReportOptions): void;
/** Error → message; string → itself; `{message|error}` objects via `clientErrorMessage`
 *  (`apiErrorProps.ts:36-38`, the shape every `onError` payload has); Palabra `{errors:[{title,detail}]}`
 *  (`PalabraAIClient.ts:194-201`); OpenAI `{error:{message}}` (`EphemeralTokenService.ts:183`);
 *  DOMException → `${name}: ${message}`; anything else → 'unknown error'. Never serialises an object. */
export function describeCause(cause: unknown): string;
/** Tests: `await Promise.resolve()` then flushPendingLogs(). vitest 4 fake timers do not fake queueMicrotask. */
export async function settleReports(): Promise<void>;
```

```ts
// report() body, the whole policy
function emit(level: 'error' | 'warning', scope, message, opts) {
  const line = `[Sokuji] [${scope}] ${message}`;                       // 513/643 existing calls use this prefix;
  (level === 'error' ? console.error : console.warn)(                  // console-text tests keep passing
    ...(opts?.cause === undefined ? [line] : [line, opts.cause]));
  const key = `${scope}|${opts?.dedupeKey ?? message}`;
  if (!throttle.pass(key)) return;                                     // 5 s window, 100-key LRU; console got it anyway
  queueMicrotask(() =>                                                 // never setState inside the caller's stack
    useLogStore.getState().addLog(`[${scope}] ${message}`, level, opts?.clientId));
}
```

```ts
// src/lib/diagnostics/clientDiagnostics.ts  (leaf; the only closed vocabulary in the design)
export const CLIENT_DIAGNOSTICS = {
  parse_error:            { severity: 'warning' },
  cleanup_failed:         { severity: 'warning' },
  input_pipeline_failed:  { severity: 'error'   },   // PalabraAIClient.ts:391
  tts_degraded:           { severity: 'warning' },
  resume_attempt_failed:  { severity: 'warning' },
  send_dropped:           { severity: 'warning' },
  voice_fallback:         { severity: 'warning' },
  lease_notify_failed:    { severity: 'warning' },
} satisfies Record<string, { severity: 'error' | 'warning' }>;
export type ClientDiagnosticCode = keyof typeof CLIENT_DIAGNOSTICS;
```

```ts
// src/services/interfaces/IClient.ts (adds one handler at :384-393)
export interface ClientDiagnostic { code: ClientDiagnosticCode; message: string; cause?: unknown; }
export interface ClientEventHandlers {
  onError?: (error: any) => void;                 // session broken → MainPanel makes the bubble. Unchanged.
  onDiagnostic?: (d: ClientDiagnostic) => void;   // NEW: session continues, degraded. No bubble.
  onRealtimeEvent?: (event: RealtimeEvent) => void; // wire traffic. Unchanged.
  ...
}
```

```ts
// participantTelemetry.ts — the one place client diagnostics AND session-start failures enter the panel
onDiagnostic: (d) => {
  const { severity } = CLIENT_DIAGNOSTICS[d.code];
  (severity === 'error' ? reportError : reportWarning)(
    `Client:${ports.provider}`, `${d.code}: ${d.message}`,
    { cause: d.cause, clientId: channel, dedupeKey: d.code });
},
// PR3a: replaces the bodies of the two connect catches (MainPanel.tsx:2445, :2790).
// Both legs get a channel-tagged row and an analytics event; the participant row stops
// filing under the speaker tab and the participant leg stops being untracked.
onConnectFailed: (error: unknown) => {
  const message = describeCause(error);
  console.error(`[Sokuji] [MainPanel] [${channel}] connect failed:`, error);
  ports.addRealtimeEvent(
    { type: channel === 'speaker' ? 'session.init_error' : 'participant.error', data: { message } },
    'client', channel === 'speaker' ? 'session.init_error' : 'participant.error', channel);
  ports.trackApiError(buildApiErrorProps({ message }, ports.provider, channel));
},
```

`d.message` here is `string` by interface, so the `Message<T>` guard is applied at the client's construction site (`{ code, message: describeCause(err) }`), not at the forwarder.

### 3.3 Sinks per runtime context

| Context | What `report()` does | What degrades |
|---|---|---|
| Electron renderer; extension side panel / fullpage (`shared/index.tsx`) | console + LogsPanel | nothing |
| Subtitle overlay window (`src/subtitle-overlay-entry.tsx`) | console + a separate `logStore` instance nobody renders; callers are `subtitleStore.persist` and `hydrate()` (`subtitle-overlay-entry.tsx:10` → `SettingsService.getSetting`) | write-only panel entry, bounded by the cap. The same failure also occurs in the main window's store copy. |
| Web workers (`src/lib/local-inference/workers/*`) | not importable; excluded from the ledger | nothing new: `postMessage({type:'error'})` → engine → `LocalInferenceClient.emitEvent` → `addRealtimeEvent`. PR3 assigns the missing `translationEngine.onError`/`ttsEngine.onError` (only ASR is wired at `:194/:222`). |
| AudioWorklet processors (`src/services/worklets/*.js`) | not importable; excluded | 5 `console.debug` stay |
| Extension background/content/popup (`extension/*.js`, copied by `viteStaticCopy`) | not importable | failures cross into `src/` as rejected `chrome.runtime.sendMessage` promises; the awaiting caller reports |
| Electron main (`electron/*.js`, Node) | not importable | failures cross as rejected `ipcRenderer.invoke` promises (e.g. `audioSystemStore.ts:44`). A `main-diagnostic` push channel through `preload.js` + `ipc-channels.js` is the named seam, out of scope. |
| Vitest (jsdom) | console synchronously; panel after `await settleReports()` | `setupTests.ts` gains `afterEach(() => useLogStore.getState().clearLogs())` |

### 3.4 Redaction

One pattern list, `src/lib/diagnostics/redact.ts`, replacement `[REDACTED:<kind>]`:

- `sk-…`, `AIza…`, `key-…` (existing `errorTracking.ts:57`), plus `ek_…` (OpenAI ephemeral secrets)
- `[?&](key|api_key|apikey|token|access_token|X-Credential|X-Signature)=<value>` (Gemini `?key=` URLs; Volcengine signed URLs at `VolcengineSTClient.ts:591`)
- `Bearer <token>`, `sokuji-auth.<token>` (relay subprotocol, `VolcengineAST2Client.ts:302`). No free-standing `eyJ…` pattern: every JWT this app handles arrives in one of those two carriers (Palabra's `publisher` JWT stays on `this.sessionConfig`, `PalabraAIClient.ts:455-458`, and never enters an event), and a bare pattern would have no fixture source in `redact.test.ts`
- e-mail addresses — named in #441; the only PII the wallet/auth paths (`UserProfileContext`, `settingsStore.ts:1121`) can carry

Applied at the sinks: `logStore.addLog` redacts `message` before storing (covers `report()`, the 4 legacy callers, any future bypass); `sanitizeEvent` additionally runs `redact()` on string values under the keys `message`, `error`, `rawMessage`, `url`, `filename`, `reason` (covers the `addRealtimeEvent` path: `participantTelemetry.ts:66` embeds the whole `event`; `GeminiClient.ts:502-521` forwards `filename`/`error.toString()`). Key-scoped, strings only, so transcript deltas on the hot path are untouched. `errorTracking.ts` imports `redact` so PostHog shares the list. This resolves judge 2's flaw against minimal-fundamental ("realtime path unredacted except three emit sites") and logger-sinks' "documented bypass".

Structural prevention of the object dump: `Message<T>` (compile-time, verified by two judges with the repo's tsc against `any`, `any.message`, `string|undefined`, objects); `cause: unknown` reaches only `console.*`; `describeCause` never serialises; the ledger test greps `JSON.stringify(` inside any `report*(`/`onDiagnostic(` statement. `EphemeralTokenService.ts:200` becomes `reportError('EphemeralTokenService', 'Unexpected client_secret response shape', { cause: Object.keys(data) })`. This resolves judge 2's fatal flaw against events-notifications (`any` assignable to `DetailValue`), which is why that design's `detail` bag is not adopted.

### 3.5 Dedupe, latches, hot paths

`report.ts` owns a ~20-line keyed throttle: 5 s window, 100-key LRU, keyed on `${scope}|${dedupeKey ?? message}`. That is the whole dedupe story. `once`-per-session latches and a `suppressed: N` / `(×N)` counter were in the draft and are dropped (critic): every site in §5 fits the window, `once` had no reset point outside a live session (settings page before Start, overlay window, extension fullpage), and `(×N)` needs a `LogEntry` field plus a LogsPanel change for a burst nobody has observed. Console receives every call regardless, so frequency is never lost to the developer.

Hot paths are fixed at the source, not by throttling: per-chunk `appendInputAudio` guards adopt `VolcengineAST2Client.ts:917`'s silent return; the passthrough slider (`audioStore.ts:260` ← `VoicePassthroughSection.tsx:92-95`, one `chrome.storage.sync` write per pixel against a 120 writes/min quota) gets a trailing 300 ms debounce at its `onChange` in `VoicePassthroughSection.tsx` — not inside `persistSetting`, where a seam-wide debounce would lose any write followed by a window close within 300 ms, for every setting; the ~150 boot-time `getSetting` failures (`SettingsService.ts:35/56`) share `dedupeKey: 'settings.get'`; the wallet poll (`UserProfileContext.tsx:189/192`) reports only on the ok→failed transition with `dedupeKey: 'wallet.poll'`.

### 3.6 Render safety

`report()` writes the store from `queueMicrotask`, unconditionally; the console call is synchronous. A call from `getCurrentProviderConfig()` (`settingsStore.ts:1233-1240`), reached synchronously from JSX at `ProviderSpecificSettings.tsx:2377` via `getProcessedSystemInstructions()`, therefore cannot `set` during render. `report.test.ts` pins it: "logStore is not written before `reportError()` returns" (graft from logger-sinks). That site is nevertheless removed: `getCurrentProviderConfig` throws like its sibling `getCurrentProviderSettings` at `:1225-1229` — safe because `loadSettings` validates the persisted provider (`settingsStore.ts:1149`).

### 3.7 Memory cap — the flaw all three designs shared

`logStore` batches with a **debounce**: every `addLog`/`addRealtimeEvent` does `clearTimeout(state.batchTimer)` then `setTimeout(flush, 150)` (`logStore.ts:212-218`, `:401-406`, `:455-461`). Any write stream spaced under 150 ms (audio deltas in a live session, the boot-time settings burst) starves `flushPendingLogs`, so a cap placed in flush bounds nothing. Two changes:

1. The timer becomes a **throttle**: schedule only if `batchTimer === null`; never clear it. Flush is then guaranteed every ≤150 ms; grouping is unaffected (it looks up the last entry by client, not by timer state).
2. `flushPendingLogs` trims to `MAX_LOG_ENTRIES = 2000` (oldest first). With (1), `pendingLogs` is bounded by 150 ms of traffic and every `[...logs, ...pending]` spread is bounded by 2000. Session separators are derived per entry (`LogsPanel.tsx:221-222`), so trimming cannot orphan them.

3. `LogEntry` gains a monotonic `id` assigned in the store, and LogsPanel keys rows by it instead of by absolute index (`LogsPanel.tsx:226`, `:230`, `:240`, `:248`). With trimming, index keys would migrate an expanded `<Event>`'s `isExpanded`/`jsonString` state (`:15-18`) onto a different entry, and the memo comparator (`:92-100`: timestamp at one-second resolution, eventType, source, events.length) would keep stale rows on screen. Known and accepted: at cap, a reader with auto-scroll off sees content slide under a fixed `scrollTop`, because `updateVisibleRange` and the auto-scroll effect depend only on `filteredLogs.length` (`:129-146`, `:164-172`), which is constant at cap.

`logStore.test.ts` gains a fake-timer test: 10 000 writes at 10 ms intervals → `allLogs.length ≤ 2000` at every tick, and ids stay strictly increasing across a trim.

## 4. Severity model and LogsPanel changes

- `error` / `warning` as in decision 7; no `info` in `report()`.
- `addLog(message, type, clientId?)` **and** `addRealtimeEvent(...)` both drop `|| 'speaker'` (`logStore.ts:208` and `:235` — the draft fixed only the first, which would have left the two MainPanel connect rows mis-filed). `clientId: undefined` is a global entry; the existing filter `clientId === activeTab || clientId === undefined` (`LogsPanel.tsx:125`) already shows it under both tabs, and the grouping lookup ("last entry for this client") treats `undefined` as its own bucket. The two connect catches pass their channel explicitly from PR3a via `onConnectFailed`.
- After PR1 the plain-entry stream is `error` / `warning` only: `addLog`'s default `type = 'info'` (`logStore.ts:205`) goes away and `LogEntry.type` for plain entries narrows to `'error' | 'warning'` (events keep the derived `'info'`), so nobody re-adds `addLog(msg, 'info')` from a component.
- `addRealtimeEvent`: derive `type` — `/(^|[._])(error|failed)$/` → `'error'`, `/[._]warning$/` → `'warning'`, else `'info'` (replaces the constant at `:442`); `<Event>` gets `className={\`event-entry ${type}\`}` so `.error/.warning` from `LogsPanel.scss:121-145` apply. `session.error`, `participant.warning`, `local.*.error` turn red/amber with no emitter changes.
- `EventData.type` (`logStore.ts:8-138`) is a closed union: PR3 widens it with `'session.parse_error'` and the `client.*` diagnostic types it introduces (judge 2 noted all three designs missed this).
- Severity filter: one `Problems only` chip (`type === 'error' || 'warning'`, after the tab filter), state in `sessionStorage` beside `showLogs`; locale key `logsPanel.problemsOnly`. **Lands in PR4, not PR1**: `locales.consistency.test.ts:51-53` pins every one of the 30 non-`en` catalogs to exactly `en`'s key set, so any new key is a 31-file change in the same PR, and PR1 — the PR that adds the vitest CI job — ships no locale change at all. "English fallback until translated" is not a state this repo allows.
- Copy export: `handleCopyLogs` emits one NDJSON line per plain entry `{ id, ts, level, clientId, message }` in order with events. Safe to export because both sinks redact. `LogsPanel.test.tsx` is new in PR1 — the export defect survived precisely because `handleCopyLogs` has never had a test.

## 5. Disposition of the 154 calls

Counts from the seven maps, reconciled to the per-file totals above (audioStore 29 = 21 persist + 8 device/init; settingsStore 14 = 6 persist + 8 other; SettingsService 5 = 2 get + 2 dead loadAll/saveAll + 236). The ledger, not this table, is authoritative.

| Category | Count | Disposition | Shared helper |
|---|---|---|---|
| Per-site `.catch`/`catch` around `setSetting` (`audioStore` ×21, `settingsStore` ×6, `subtitleStore`, `conversationDisplayStore`, +2 dead `loadAll`/`saveAll`) | 31 | Replace with one `persistSetting` call each; `loadAllSettings`/`saveAllSettings` (zero callers) deleted with their 2 lines | `persistSetting(key, value): Promise<boolean>` — awaits the result, reports `warning` under `dedupeKey: persist:${key}` (5 s window) on `success===false` **or on rejection** (both channels are live in the extension), treats `undefined` (mocked service) as success. PR2 also changes `SettingsService.ts:68` to `return await new Promise(...)` with a test whose `chrome.storage.sync.set` throws synchronously, so the service's own contract becomes what its signature says |
| `getSetting` read failures (`SettingsService.ts:35/56`) | 2 | `reportWarning` with `dedupeKey: 'settings.get'` | — |
| Client lines whose failure already reaches a sink: 9 beside an `onError` emission (LocalInference 195/223, Soniox 1244/1299, OpenAIWebRTC 320, TranslateWebRTC 581, ST 564, AST2 343, Gemini 504) and ~9 `connect()` throws/rejects that land in a MainPanel connect catch (Palabra 256, OpenAIWebRTC 211, TranslateWebRTC 482, ST 591, AST2 287/302/485/533, LocalInference 343) | 18 | **Delete.** The surviving console record is `participantTelemetry.ts:64` for the first group and the connect catches (`MainPanel.tsx:2445`, `:2790`) for the second — which PR3a routes through `onConnectFailed` so both legs get a channel-tagged row and an analytics event. The remaining client lines are NOT deletable on this ground; they are dispositioned in the rows below (parse, cleanup, validate, invisible, duplicates-of-held-items). | `onConnectFailed` |
| Invisible client failures | 8 | Palabra 669 (worklet setup) and Gemini 1153 (lost handle) → `handlers.onError` (bubble); Soniox 381/612 → `onDiagnostic('tts_degraded' / 'resume_attempt_failed')`; ManagedSonioxSession 503/524/555 → `onEvent` (widen union at `ProviderDescriptor.ts:201`; `ManagedSonioxSession.test.ts:594/609` assert on the `events` array they already collect) | `onDiagnostic` |
| Outside a session (UserProfileContext ×6, EphemeralTokenService ×3, audioSystemStore ×1) | 10 | `reportError`/`reportWarning`; wallet poll transition-only with `dedupeKey`; `UserProfileContext.tsx:233-238` dead `refetchProfile` try deleted; Ephemeral :109 `addLog` twin removed, :200 passes `cause: Object.keys(data)` | — |
| Validate | 7 | Static `validate*` catches (Palabra 195/217, ST 418/480, Gemini 226) deleted — message already reaches `validationMessage` (`ProviderSection.tsx:1008`); `SettingsService.ts:236` and `settingsStore.ts:1121` → `reportError` (redacted at sink); `settingsStore.ts:1115` deleted | — |
| Store init/device/other (audioStore 232/236/408/613/619/675 +2, settingsStore 777/796/814/1212, modelStore 202) | 13 | `reportError`/`reportWarning`, no `clientId`; `audioStore.ts:588-615` (unreachable: `supportsVirtualDevices()` is hard-coded false) deleted; `initializeAudioService` stops discarding `connectMonitorDevice`'s result at `:671`. User-facing state fields are PR5. | — |
| Per-chunk guards (Palabra 339/363/369, ST 788, Gemini 1279, +1) | 6 | Silent return; Palabra 391 → `onDiagnostic('input_pipeline_failed')` | — |
| Unsupported-operation stubs (`updateSession` ×5, `cancelResponse` ×3, `appendInputText` ×5) | 13 | Delete the line; no live callers / gated by `capabilities.supportsTextInput` (`MainPanel.tsx:370`) | — |
| Developer invariants (modelStore 431/467, nativeModelStore 518/660, settingsStore 765, OpenAIClient 711) | 6 | `reportWarning`. No allowlist: if they ever fire, a panel line is right. | — |
| Wrong fallback (settingsStore 1236) | 1 | Throw like the sibling getter | — |
| Cleanup (Palabra 287/312/1096/1119/1127/1147/1150/1182, Soniox end-notify) | 9 | One private `reportCleanup(step, cause)` per client → `onDiagnostic('cleanup_failed')`; Palabra 1182 (unreachable) deleted; `MainPanel.tsx:1683-1686` `client.disconnect()` warn → `reportWarning` so Palabra 312's rethrow lands | `onDiagnostic` |
| Parse (AST2 600, ST 664, OpenAIWebRTC 315, TranslateWebRTC 576, GA 539, Palabra 722/1007, Onboarding 351) | 8 | Five → `onDiagnostic('parse_error')` with `describeCause` + 200-char preview, `dedupeKey` per connection; Palabra's two deleted (already emitted); Onboarding → `reportWarning` | `onDiagnostic` |
| Duplicates of client-held error items (Soniox 1244/1261/1299, LocalInference 195/223/296/343/755/779, LocalNative 396, OpenAIClient 654, OpenAIWebRTC 394, localParticipantConfig 110/121, AST2 485) | 11 | **Delete.** Three ride-along correctness fixes: ST 565, OpenAIWebRTC 320, TranslateWebRTC 581 pass a bare `Event`/`RTCErrorEvent` to `onError` so `clientErrorMessage` (`apiErrorProps.ts:37`) yields "Unknown error" — normalise to `{ code, message }` at the emit site, otherwise deleting the console line removes the only readable record | — |
| Provider config (managedVoicePrep 126/152, SonioxProviderConfig 152, LocalInference 149) | 4 | `managedVoicePrep` returns `detail` (guarding `signal?.aborted` first) and `KizunaAISonioxProviderConfig.prepareToStart` reports once; `SonioxProviderConfig` returns `notices` in the `ParticipantNotice` shape (`LocalInferenceProviderConfig.ts:164-174`) and its three `toHaveBeenCalledTimes` assertions move to the returned counts; LocalInference 149 → `onDiagnostic('voice_fallback')` | descriptor `notices` |

Net: ~55 deleted with no replacement (each justified by a named surviving record, never by "it's a client"), 31 collapsed into `persistSetting`, ~30 become `report()`, ~30 move to `onDiagnostic`/`onEvent`/`onError`/`onConnectFailed`, 6 go silent, 1 becomes a throw. In-scope ledger reaches **0** with no permanent allowlist. The 4 legacy `addLog` callers become `report()` in PR1 so "only `report.ts` calls `addLog`" holds from day one.

## 6. User-facing tier (basic mode)

LogsPanel is closed outside advanced mode by construction (`useCloseLogsOutsideAdvanced.ts:20`), so the panel is never the basic-mode surface. Rule (decision 3): **UI is state on the owning store; `report()` never renders.** The repo already has four working surfaces and every gap the maps found fits one:

| Gap | Surface (existing) | Change |
|---|---|---|
| No-channel Start (`MainPanel.tsx:1885-1890`, panel-only today) | speaker error bubble (`MainPanel.tsx:1430-1442`) | append the bubble with the existing `mainPanel.noChannelConfigured` key — one line |
| Device switch failed (`MainPanel.tsx:3956-3965`) | speaker error bubble | same |
| Audio init / device refresh failed (`audioStore.ts:619/675`) | banner beside `AudioSystemBanner` at `MainPanel.tsx:4043` (mounted uiMode-independently) | `audioStore.lastError: AudioErrorReason \| null` (closed union), rendered by `AudioErrorBanner` reusing `AudioSystemBanner`'s markup/scss and dismiss/retry shape |
| Settings failed to load (`settingsStore.ts:1212`; today `settingsLoaded=false` forever, silently) | same banner component | `settingsStore.loadError: 'storage-unavailable' \| null`, action = reload |
| Soniox vocabulary truncated (`SonioxProviderConfig.ts:152`) | descriptor `notices` → `participant.warning` (`MainPanel.tsx:961-975`) | already panel-visible after PR4; a bubble is not in scope |

i18n: the `reasonToI18n` pattern from `sessionStartGate.ts:352` — a closed reason union mapped by a `switch` to `{ key, defaultValue, values }` with keys under `src/locales/en/translation.json`; other locales fall back to English until translated. A consistency test asserts every member of each reason union has an `en` key (the `splitDegraded.test.ts` shape). Panel lines stay English: they are pasted into bug reports and grepped.

No `noticeStore`, no toast bridge: `ToastContext.tsx:25-33` has no dedupe and no cap, is invisible in the overlay window, and routing `showToast`'s success toasts through a failure bus (events-notifications §8) was a type error in its own design (judge 1, judge 2). Five sites do not justify a ninth surface.

## 7. Migration plan

Every PR is green alone and lowers the ledger for the files it touches. Sizes are from the per-file line counts above.

**PR1 — mechanism, panel fixes, ledger, CI, policy, both named files.** (~17 files, ≈ +560 / −70)
- `src/lib/diagnostics/{redact,clientDiagnostics,report}.ts` + `report.test.ts` (throttle window, microtask-not-before-return, `Message<T>` via `// @ts-expect-error`, `describeCause` fixtures for Error / string / `{message}` / `{error}` / Palabra `errors[]` / OpenAI `error.message` / DOMException), `redact.test.ts` (one fixture per pattern, each traced to a named source line).
- `logStore.ts`: honour `clientId` in both `addLog` and `addRealtimeEvent`, redact in `addLog`, monotonic `id`, throttle timer, `MAX_LOG_ENTRIES`, event severity, plain-entry type narrowed; `sanitizeEvent.ts` key redaction; `errorTracking.ts` imports `redact`; `logStore.test.ts` cap-under-burst + id-monotonic tests.
- `LogsPanel.tsx/.scss` + new `LogsPanel.test.tsx`: event severity class, `id`-keyed rows, plain entries in copy export. Tests: "copy emits plain entries as NDJSON in order with events", "an expanded row keeps its state across a store trim". **No locale change in PR1** (Problems chip → PR4).
- `consoleLedger.consistency.test.ts` with the full ledger (in-scope 27 files + `src/components` 73 + `src/lib/modern-audio` 75 + the rest of `src/lib` outside workers/worklets ≈ 8 + `shared/index.tsx` 1 + `src/subtitle-overlay-entry.tsx` 1, exact counts). `extension/`, `electron/`, `sidecar/` are outside the policy and CLAUDE.md says so in one sentence (decision 12) — otherwise the bot comment the design exists to answer keeps appearing there.
- `.github/workflows/build.yml`: a `test` job running `npx vitest run` (no workflow runs vitest today — every design's "fails CI" claim was false; judge 3).
- Migrate `UserProfileContext.tsx` (6→0), `settingsStore.ts` non-persist sites (14→6; the 6 persist catches wait for PR2 rather than being converted twice), `EphemeralTokenService.ts` (3+1→0), and the 3 legacy `addLog` callers outside MainPanel. `MainPanel.tsx:1309` (echo notice) is the one allowlisted `addLog` site until PR3a, so PR1 does not touch the repo's hottest file (66 commits/30 d).
- `CLAUDE.md`: replace the one-sentence claim under "Error Handling" with decisions 1-12 as a table.
- `setupTests.ts`: `afterEach(clearLogs)`.

**PR2 — persistence seam.** (~11 files, ≈ +220 / −300)
`src/services/persistSetting.ts` + test (stub `getSettingsService` → `{success:false}`; one panel line per key; `silent` for the 7 migration writes at `audioStore.ts:465-509`; debounce with fake timers). `audioStore.ts` (29→0, delete `:588-615`), `settingsStore.ts` (6→0, retire `persistErrors`), `subtitleStore.ts`, `conversationDisplayStore.ts` (delete copy-pasted `persist()`), `SettingsService.ts` + `ISettingsService.ts` (delete dead methods, `getSetting` reporting), `modelStore.ts`, `nativeModelStore.ts`, `audioSystemStore.ts`, `VoicePassthroughSection.tsx`. **Budgeted explicitly (all three designs missed it):** `settingsStore.sliceRegistry.test.ts:104-133` pins the 6/6 `persistErrors: 'throw' | 'swallow'` split with `setSetting.mockRejectedValue`. What that split does in production today: none of the six throw-policy actions is awaited or caught anywhere (`useUpdateOpenAI` callers in `ProviderSection.tsx:486`, `LanguageSection.tsx:155`, `ProviderSpecificSettings.tsx:368` all fire-and-forget; the actions are typed `void` at `settingsStore.ts:304-307`), so "throw" means *an `unhandledrejection` that `errorTracking.ts:112` forwards to PostHog*, and "swallow" means *console only*. Neither is user-visible. PR2 retires the split: all 12 slices go through `persistSetting`, which files one `persist:<key>` warning and — to keep the PostHog signal the throw slices had — one explicit `trackEvent('settings_persist_failed', { key })` instead of an accidental unhandled rejection. The test is rewritten to drive both `{success:false}` **and** `mockRejectedValue` through all 12 slices and assert: state applied, promise resolves, exactly one warning per key (~50 LOC).

**PR3 — client contract, in two reviewable halves.** (~18 files, ≈ +260 / −290)
3a: `IClient.ts` `onDiagnostic`, `clientDiagnostics.ts` rows, `participantTelemetry.ts` `onDiagnostic` forwarding + `onConnectFailed`; `MainPanel` wires both legs — the speaker set is hand-built at `:1387` and calls `speakerTelemetry.onError(event)` by hand at `:1430`, not spread like the participant's at `:897`, so `participantTelemetryWiring.test.ts` gains a case asserting **both** legs forward `onDiagnostic` (an optional handler left unwired is silent by construction) — and the two connect catches (`:2445`, `:2790`) delegate to `onConnectFailed`; `EventData.type` widened; Palabra/Volcengine/Gemini sweep. 3b: Soniox/ManagedSoniox/Local*/OpenAI*/Zoom sweep, `Event`→`{code,message}` normalisation, `LocalInferenceClient` translation/TTS `onError` assignment, `ManagedSonioxSession.test.ts` event assertions. `onEvent` becomes **required** in the lease constructor (`ProviderDescriptor.ts:201` is optional today; moving 503/524/555 onto an optional handler would make them silent wherever the lease is built without one).

**PR4 — remainder and the flip.** (~9 files, ≈ +70 / −80)
`managedVoicePrep` + `KizunaAISonioxProviderConfig`, `localParticipantConfig`, `SonioxProviderConfig` + test, `OnboardingContext`. In-scope ledger reaches 0; those entries are removed and the test's rule for `src/stores`, `src/services`, `src/contexts` becomes "must be 0" with no baseline object.

**Basic-mode surfaces (§6) — filed as a separate issue, not PR5.** (~9 files, ≈ +220 / −20)
Two banner components with closed reason unions and a 30-catalog locale change per key is a user-facing feature series, not part of routing caught errors. #441 closes at PR4; §6 is the design for the follow-up issue so the seams (`audioStore.lastError`, `settingsStore.loadError`) are named now.

**Later, under the ledger, file-by-file when touched:** `src/components` (73) and `src/lib/modern-audio` (75). `AppAudioRecorder.test.ts`/`WebRTCAudioBridge.test.ts` console-text assertions keep passing because the `[Sokuji] [Scope] message` line still fires.

### 7.1 The regression guard

`src/lib/diagnostics/consoleLedger.consistency.test.ts`, in the read-source-derive-assert style of `featureGateForwarding.consistency.test.ts:24-45`:

```ts
const ROOTS = ['src/stores', 'src/services', 'src/contexts', 'src/components', 'src/lib', 'shared'];
const ENTRY_FILES = ['src/subtitle-overlay-entry.tsx'];            // top-level src/*.tsx entry points
const SKIP = [/\.test\.tsx?$/, /\/workers\//, /\/worklets\//];    // cannot import the store (decision 12)
const LEDGER: Record<string, number> = {              // exact counts; comments may cite the PR that lowers a row
  'src/stores/audioStore.ts': 29, 'src/services/clients/PalabraAIClient.ts': 20, /* … */
};

it('scanner finds the tree and the pattern', () => {   // cannot vacuously pass over an empty set
  expect(scannedFiles().length).toBeGreaterThan(150);
  expect(count('x; console.error("a"); console.warn(b)')).toBe(2);
});
it('console.error/warn per file equals the ledger exactly', () => {
  for (const file of scannedFiles()) {
    const n = count(read(file)), allowed = LEDGER[file] ?? 0;
    expect(n, `${file}: use reportError/reportWarning (src/lib/diagnostics/report.ts)`).toBeLessThanOrEqual(allowed);
    expect(n, `${file}: below the ledger — lower LEDGER in this PR so the count stays exact`).toBe(allowed);
  }
  for (const file of Object.keys(LEDGER)) expect(existsSync(file), `${file}: stale ledger row`).toBe(true);
});
it('plain panel entries are written only by report.ts', () => {
  // \baddLog\( not \.addLog\( — MainPanel destructures it from useLogActions(); the hooks are matched too.
  const ALLOW_UNTIL_PR3A = ['src/components/MainPanel/MainPanel.tsx'];
  expect(filesMatching(/\baddLog\(|\buseAddLog\b|\buseLogActions\b/, 'src',
    [/logStore\.ts$/, /diagnostics\/report\.ts$/, /\.test\./, /LogsPanel\.tsx$/, ...ALLOW_UNTIL_PR3A])).toEqual([]);
});
it('no object serialisation inside a report or onDiagnostic call', () => { /* JSON.stringify( within the statement */ });
it('leaves stay leaves', () => {
  // denylist, not an exact array (judge 1 on minimal-fundamental): these files import nothing from
  // src/services, src/components, src/contexts, or src/stores other than logStore/sanitizeEvent.
  for (const f of ['src/stores/logStore.ts', 'src/stores/sanitizeEvent.ts', 'src/lib/diagnostics/report.ts',
                   'src/lib/diagnostics/redact.ts', 'src/lib/diagnostics/clientDiagnostics.ts']) …
});
it('clients never import the store or the reporter as a value', () => {
  // services/clients/**: no non-type import of stores/logStore or lib/diagnostics/report
});
```

Why it is a ledger and not a ceiling: the `toBe(allowed)` assertion means a PR that deletes a call without lowering the row fails, so the checked-in number is always the truth a reviewer reads without grepping and no headroom can be silently refilled (the flaw in events-notifications' ceiling-only guard). Why it cannot vacuously pass: the first `it` fails if the scanner finds nothing or the regex stops matching. Unlisted files must be 0, so new files start clean. Rows are removed when they hit 0; when a whole root hits 0, its files are simply "unlisted". Maintenance cost is a one-integer edit per migrated file in the same diff — the reviewable act that replaces per-line bot comments. It runs in CI only because PR1 adds the vitest job.

## 8. Non-goals and rejected alternatives

- **Pluggable `Sink` bus with sync/deferred timing (logger-sinks).** Render safety would rest on every future sink choosing `'deferred'` (judge 1 fatal flaw); five knobs per call site (`level`, `once`, `key`, `channel`, `notice`) move the guessing rather than remove it; six PRs and ~2.4k LOC for 154 sites (judge 3).
- **Global `POLICY` table + `DiagnosticCode` vocabulary for all failures (events-notifications).** `any` from `response.json()` is assignable to `DetailValue`, so its central safety claim was false with no runtime backstop (judge 2 fatal flaw); ~27 rows with no raiser in PR1 in the repo's highest-churn conflict file (judge 3); `ui.message` toast code absent from its own table (judges 1, 2). The closed-vocabulary idea is kept only for client codes, where a type is structurally necessary.
- **`noticeStore` / toast bridge.** Would route success toasts through a failure bus and rewire a provider used by five test files (judge 1 fatal flaw); `ToastContext.tsx:25-33` has no dedupe/cap. Section 6 uses the store-field + banner/bubble surfaces the repo already has.
- **`detail`/`fields` primitive bags.** Not needed once `Message<T>` exists; every proposed `fields` value was a key name or count that fits in the sentence.
- **Global `console.error` monkeypatch.** Forwards unredacted objects, double-wraps `muffleCustomizableSelectWarnings.ts`, cannot carry a channel, misses workers.
- **ESLint `no-console`.** No ESLint installed; the ledger runs under the existing vitest config and is scoped.
- **Making `setSetting` a throwing API.** It already half-is (the extension branch rejects on a synchronous `chrome.storage` throw); standardising on rejection would turn the 13 bare `await service.setSetting(...)` in `settingsStore.ts` and the floating promises in `ProviderSpecificSettings`/`ModelManagementSection` into unhandled rejections routed to PostHog. PR2 goes the other way: `return await` makes `{success:false}` the whole contract, and `persistSetting` still catches rejection so a mocked or future implementation cannot regress it.
- **Ratchet allowlist for "developer invariants" (events-notifications).** Reintroduces per-site judgment; they become `reportWarning` and cost nothing until they fire.
- **Electron-main / extension-background bridge, file logging, persistence across restarts, translating panel lines, making LogsPanel reachable in basic mode.** Each is real work with a named seam; none is needed to decide the policy once.
- **Migrating `console.info`/`console.debug` (287 calls).** Not failures.
- **Analytics inside `report()`.** `report.ts` never reaches PostHog. `participantTelemetry.onError`/`onConnectFailed` keep `api_error`, `persistSetting` fires its one explicit event, and `errorTracking.ts:97-140` hooks only `window.onerror`/`unhandledrejection`. A `trackEvent` in the leaf would couple it to analytics and double-count every `onError`.
- **`once` latches and `(×N)` suppressed counters.** In the draft; dropped on the critic's evidence (§3.5). Re-add only when a real burst shows up in the panel.
- **Problems-only chip in PR1.** Deferred to PR4 with its 31-file locale change; PR1 must be reviewable in one sitting and ship no locale delta.

## 9. Open questions

One, because it needs the maintainer's call: **PR1 adds a vitest job to `build.yml`.** If the full suite is not green on `main` today (memory notes ~12 failing files on a clean worktree base — that observation was worktree-specific and unverified on `main`), the job should initially run `npx vitest run src/lib/diagnostics src/stores/logStore.test.ts src/stores/settingsStore.sliceRegistry.test.ts` and be widened in a follow-up, rather than blocking PR1 on suite hygiene. Default if no answer: ship the narrow job in PR1, widen in PR2.

Everything else is decided above.

## 10. Verification record

Seven load-bearing claims were extracted from the synthesized draft and each handed to an
independent agent instructed to refute it from source. Five held; two were refuted and the
document above has been corrected:

| Claim in draft | Verdict | Correction applied |
|---|---|---|
| `setSetting` never rejects; 31 catches are dead | **Refuted** — `SettingsService.ts:68` returns an un-awaited Promise inside `try`; executor throws bypass `:95`. Also: no site reads `result.success`. | Decision 10, §5 persist row, PR2, §8 |
| `participantTelemetry` is the sink ~⅓ of client lines duplicate | **Refuted** — it sinks only `onError` (9/44). Connect failures go through two separate MainPanel catches with different rows; participant row mis-filed under speaker tab, no analytics. | §1, decision 4, §3.1, §5 connect row, PR3a |
| logStore batching is a debounce → cap in flush bounds nothing | Held | — |
| `addLog` forces `'speaker'`; copy export drops plain entries; no redaction/cap/dedupe | Held | — |
| `report.ts → logStore` adds no new edge class; no cycle possible | Held | — |
| No CI workflow runs vitest | Held | — |
| LogsPanel unreachable in basic mode; ToastContext has no dedupe/cap | Held | — |

Additionally verified by the orchestrator while reviewing the refutations: the six
`persistErrors: 'throw'` slices are never awaited or caught by any caller, so the split's only
production effect is PostHog capture via `unhandledrejection` (folded into PR2 above).

### Completeness critic

After verification, a critic agent read the corrected draft looking for what a maintainer would
hit in week one. It found 2 blockers, 8 should-fix items, 2 nice-to-haves and 5 over-reaches;
all are folded into the text above:

| Finding | Where it landed |
|---|---|
| Any new locale key is a 31-file change (`locales.consistency.test.ts:51-53`) — PR1 would fail its own new CI job | Problems chip → PR4; PR1 ships no locale change (§4, §7) |
| Five `addLog` callers, not four; `\.addLog\(` regex blind to the destructured one | Ground-truth paragraph; §7.1 guard regex + MainPanel allowlist until PR3a |
| Index-keyed LogsPanel rows break under trimming | `LogEntry.id`, §3.7 item 3, PR1 test |
| `describeCause` as drafted discards `{message}`-shaped errors | §3.2 contract, PR1 fixtures |
| `addRealtimeEvent` still defaulted to `'speaker'` | §4 — both writers drop the default; connect catches pass their channel via `onConnectFailed` |
| Ledger roots missed `src/lib`, `shared/`, entry files; `extension/`/`electron/` unstated | §7.1 `ROOTS`/`ENTRY_FILES`; decision 12 sentence in CLAUDE.md |
| LogsPanel has no test | `LogsPanel.test.tsx` in PR1 |
| `once` had no reset point outside a session | `once` dropped (§3.5) |
| Optional `onDiagnostic`/`onEvent` handlers are silent when unwired | PR3a wiring test; `onEvent` required (PR3b) |
| Doc still said `setSetting` never rejects | Corrected in v2 (decision 10, §5, §8) |
| Plain-entry `'info'` left reachable | §4 type narrowing |
| Nothing said `report()` never reaches PostHog | §8 |
| Over-reach: four throttle knobs; four LogsPanel UX features in PR1; seam-wide debounce; unsourced redaction patterns; PR5 inside #441 | §3.5, §4, §7, §3.4, §6 respectively |


## 11. PR1 as landed — deviations from the design above

PR1 is implemented. Two decisions were changed while building it, both after
checking the code rather than the design:

**Redaction writes `[REDACTED]`, not `[REDACTED:<kind>]`** (§3.4 said the latter).
`errorTracking.ts` already emitted the bare form and six of its tests assert on
it; a second format for the same act would have meant either churning those tests
or shipping two conventions. The surrounding text already names what was removed
(`Bearer [REDACTED]`, `?key=[REDACTED]`), so the suffix was redundant.

**`getCurrentProviderConfig` keeps its OpenAI fallback** (§3.6 said: throw like
its sibling). The design's own argument for the throw was that the site is
unreachable because `loadSettings` validates the provider — but a site that is
unreachable in theory is exactly the wrong place to install a crash, and this one
is on a render path (`ProviderSpecificSettings.tsx:2377` calls it synchronously
during render). It now calls `reportWarning` and keeps the fallback, which is
possible *because* `report()` defers the panel write to a microtask. The render
hazard the design worried about is what the mechanism removed.

Also worth recording, found while building:

- **`allLogs` is capped at 2000 + one batch, not 2000.** `allLogs` is
  `logs` + the unflushed batch, so the exact-cap assertion in §3.7 was wrong. The
  invariant is on `logs`; `allLogs` peaks a batch above it (~15 entries at a
  10 ms write rate), which is still bounded — the point of the throttle fix.
- **The ledger regex must require the trailing `(`.** A comment in
  `UserProfileContext.tsx` containing the words "console.error" inflated its row
  by one during development. `console\.(?:error|warn)\(` is the pattern, and the
  self-guard test pins that prose does not count.
- **`OpenAIClient.ts` imported `RealtimeEvent` as a value import**, which the
  "clients never import the store as a value" assertion caught on its first run.
  Changed to `import type`. The client never wrote to the store; the import was
  simply not marked type-only.
- **`tsc --noEmit` is not a gate here**: `main` has 571 pre-existing errors, so
  the `@ts-expect-error` assertions on `Message<T>` are documentation rather than
  something CI verifies. `Message<T>` itself was verified empirically against the
  repo's own tsc: it rejects `any`, `unknown`, `string | undefined`, objects and
  numbers, and accepts string literals, `string`, template literals and
  `Error['message']`.
- **The vitest CI job is scoped, not full-suite.** The open question in §9 is
  answered by measurement: the full suite has 11 failing files / 7 failing tests
  on a clean `main` checkout in a worktree, identical before and after this PR.
  A job that is red on arrival gets ignored, so the job runs the diagnostics and
  log-surface tests only, and widens as suites are cleaned up.


## 12. PR2 as landed — the persistence seam

Ledger: 55 files / 292 calls → **47 files / 244 calls**. Eight files reached zero
(`audioStore` 29, `settingsStore` 6, `SettingsService` 5, `modelStore` 3,
`nativeModelStore` 2, `subtitleStore`, `conversationDisplayStore`,
`audioSystemStore`). Full suite: 11 failing files / 7 failing tests, byte-identical
to a clean `main` checkout. `tsc` total fell 571 → 537.

What the code actually turned out to be, beyond the design:

- **The `.catch` wrappers were guarding the wrong channel, and the rollbacks were
  dead.** `setSetting` resolves `{success:false}` for the failures that really
  happen (quota, `chrome.runtime.lastError`), and *no* call site read it. The four
  optimistic setters in `settingsStore` (`textOnly`, `keepReplayAudio`,
  `speakerDisplayMode`, `participantDisplayMode`) rolled their state back only on a
  rejection — which the Electron build never produces — so a refused write left the
  UI showing a value that was never saved. Reading `persistSetting`'s boolean makes
  those rollbacks real on both platforms. That is a behaviour fix, not just a
  logging change.
- **`persistErrors: 'throw' | 'swallow'` was decorative.** Verified before removing
  it: none of the six "throw" actions is awaited or caught anywhere — they are
  typed `void` (`settingsStore.ts:304-307`) and every caller is fire-and-forget —
  so "throw" meant an unhandled rejection that `errorTracking.ts:112` forwarded to
  PostHog, and "swallow" meant a console line. Neither was user-visible and the
  6/6 split was arbitrary. All twelve slices now go through the seam.
- **`SettingsService.setSetting` needed fixing before the seam could be trusted.**
  `return new Promise(...)` inside `try` adopts the rejection without passing
  through the catch, so the extension build could reject past a signature that
  promises a result. `return await` plus five contract tests (synchronous executor
  throw, missing binding, `lastError`, success, localStorage throw). The seam still
  catches rejection anyway, so a mocked or future implementation cannot regress it.
- **`loadAllSettings` / `saveAllSettings` had zero callers** and were deleted from
  both the class and `ISettingsService`, taking 2 more ledger entries with them.
- **The virtual-devices branch in `refreshDevices` was unreachable.** The sole
  `IAudioService` implementation hard-returns `false` from
  `supportsVirtualDevices()` (`ModernBrowserAudioService.ts:451-453`). Deleted
  rather than migrated: a diagnostic on a dead path reads as if the path is live.
- **`SliceUpdateSpec.defaults` was typed `Record<string, unknown>`**, which every
  concrete settings interface fails (no implicit index signature). Widening it to
  `object` — only `Object.keys` is read — removed 33 pre-existing `tsc` errors.

Two process notes worth keeping:

- **The ledger regex was fooled by its own documentation, twice.** Prose in
  `UserProfileContext` and then the doc comment in `persistSetting` (which shows
  the `.catch(e => console.error(...))` shape it replaces) both counted as calls.
  Requiring the trailing `(` is not enough. `countConsoleCalls` now blanks
  comments and string bodies before matching, with self-tests pinning both
  directions, and the ledger-generation script mirrors the same stripper so the
  two cannot disagree.
- **Mechanical migration needs assertions, not counts.** The first pass at
  `audioStore` produced correct replacements at column 0 for every site whose
  optional `const service = …` prefix was absent — the leading `[ \t]*` sat
  outside the optional group and ate the indentation. A separate assertion caught
  the general rule claiming the three legacy-key writes before the `silent` rule
  could. Both were caught by asserting on the shape, never by the replacement
  count, which was right in both broken runs.
