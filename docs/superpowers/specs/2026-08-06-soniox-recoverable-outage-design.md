# Soniox Recoverable Outage — Design

**Date**: 2026-08-06
**Status**: Approved (brainstormed with user)
**Scope**: sokuji-react only — `sokuji-backend` needs no change.
**Related**: PR #374 (BYOK 503 auto-resume), PR #362 (managed Soniox provider)

## Summary

When a Soniox session dies for a reason the user did not cause and can
recover from by tapping Start, say so — in their language — instead of
printing the server's raw English error frame or, for a plain network drop,
nothing at all.

This closes the managed twin's half of the 503 story. PR #374 gave BYOK
sessions a silent auto-resume ladder; managed sessions are structurally
excluded from it (the backend mints STT temporary keys `single_use: true`, so
a reconnect with the same key 401s after the socket opens — see
`SonioxClient.handleSttError`'s docstring). Rather than build the backend
machinery to make managed resumes possible, managed 503s — and every other
recoverable failure, in both modes — get a decent ending.

The change is deliberately small and reuses the seam every client in this
repo already uses to talk to the UI: the client pushes a
`role: 'system', type: 'error'` item into its own `conversationItems` and
calls `onConversationUpdated`. No new cross-layer fields, no new MainPanel
branches. It also **removes** the one Soniox-specific channel that exists
today, so Soniox ends up more like its peers than it started.

## Findings that shaped this (verified by code reading, 2026-08-06)

- **The lease is already released promptly.** A managed 503 today runs the
  full teardown: `handleSttClose` → `onClose` → MainPanel's
  `disconnectConversation()` → `SonioxClient.disconnect()` →
  `notifySessionEnd` → backend `markEndSignalled` + a reconciler poke with a
  3 s delay. Nothing on the backend needs to change for the account to be
  free again.
- **The final UI state is one bubble, not two.** `surfaceSttError` pushes an
  item *and* calls `onError`; MainPanel's `onError` appends a second copy —
  but the teardown that follows does `setItems(client.getConversationItems())`,
  which replaces the list with the client's own. Only items the *client*
  holds survive. This is why the existing duration-cutoff notice has to be
  appended by MainPanel *after* `disconnectConversation()`, and why the fix
  below is to have the client hold the item instead.
- **The shared seam already exists in every client.** `PalabraAIClient`,
  `VolcengineSTClient`, `VolcengineAST2Client`, `OpenAIGAClient`,
  `OpenAIWebRTCClient`, `OpenAITranslateGAClient`, `ZoomAIClient` and
  `SonioxClient` all build a system/error `ConversationItem` inline, push it,
  and fire `onConversationUpdated`. `conversationFilter.ts:13` shows
  `type === 'error' || role === 'system'` unconditionally, so such an item
  reaches the main panel and the subtitle overlay alike.
- **`SonioxClient` already localizes its own user-facing text** — see
  `handleTtsError`'s `i18n.t('mainPanel.sonioxTtsFailed', …)`. Emitting a
  localized notice from the client is the house pattern, not a new one.
- **`sonioxDurationCutoff` is the only provider-specific close field in the
  codebase.** One producer (`SonioxClient.ts:405`), one consumer
  (`MainPanel.tsx:1323`), five test assertions, no other reader anywhere in
  `src/` or `extension/`.

## Decisions

| Decision | Rationale |
|---|---|
| Do **not** auto-resume managed 503s | Chosen over a backend resume endpoint + lease socket accounting, and over an auto Stop+Start restart. Managed resumes need a new `/soniox/session-resume` endpoint, two new lease columns and a rewrite of the reconciler's "an STT log proves the session ended" invariant — a large blast radius on the billing path for a transient failure. |
| Emit through the existing system-item seam | The alternative (a new `sonioxConnectionLost` field on `onClose` plus a MainPanel branch) would add a second Soniox-only channel. Divergence between clients is the thing to shrink here, not grow. |
| Fold the existing 403 duration cutoff into the same seam | Removes `sonioxDurationCutoff` and its MainPanel branch. Soniox returns to the same shape as every other client. |
| Keep firing `onError` | It is what produces the `api_error` analytics event. Its duplicate bubble is transient and collapses on teardown (see Findings). Suppressing it would silently lose outage telemetry. |
| Keep the raw server text | Only in the debug timeline (`session.connection_lost`), so LogsPanel keeps every technical detail while the conversation shows the actionable sentence. |
| Do **not** extract a shared error-item factory | Eight clients duplicate the item construction. Unifying them is a repo-wide refactor unrelated to this goal; noted, not done. |
| Do **not** harden the session-key 409 retry ladder | See Known limitations. |

## Architecture

Classifying an outage and emitting the notice for it live entirely inside
`src/services/clients/SonioxClient.ts` — that is the decision this design
moves. `MainPanel.tsx` keeps the session-lifecycle behaviour it already owns
(the `isSessionActive` teardown guard, the `setItems(getConversationItems())`
that decides which items survive) and only loses the `sonioxDurationCutoff`
branch (§3) — a deletion, no new logic. The 30 locale catalogs gain one key
(§4). `IClient`, the stores and the backend are untouched.

### 1. One emission point

Extract the item construction already inside `surfaceSttError` into a private
helper — call it `emitSystemNotice(text: string)` — that builds the
`role: 'system', type: 'error'` item, pushes it onto `conversationItems` and
fires `onConversationUpdated`. Three callers:

- `surfaceSttError(code, message)` — unchanged behaviour: `[Soniox <code>] <message>`
  plus `onError`. This stays the path for errors the user can act on
  (`400`, `401`, `429`, anything unrecognised).
- the recoverable-outage path (new, §2).
- the duration-cutoff path (moved from MainPanel, §3).

### 2. Recoverable outages

A new predicate names the failures that are neither the user's fault nor
worth a raw wire dump:

```
isRecoverableSttFailure(code) → code is '503' | '408' | 'socket_error'
```

- `503` — service unavailable. Transient by definition.
- `408` — request timeout, i.e. no audio for ~20 s. Reachable in a live
  session when input stops (e.g. a long mute), and the fix is the same: start
  again.
- `socket_error` — `SonioxSttStream` emits this for transport-level failures
  (`SonioxSttStream.ts:161`).

`handleSttError` gains one branch, placed **after** the existing managed-403
cutoff branch and the BYOK-503 resume branch so neither changes behaviour:
when the predicate matches, emit the localized notice, fire `onError` with
the same localized message, and emit a `session.connection_lost` debug event
carrying the wire code and the server's own text.

**Bare closes.** A network drop may produce no error frame at all — just a
close. A per-stream `sttOutcomeAnnounced` flag lets `handleSttClose`'s
fall-through branch emit the notice only when nothing has told the user
anything yet. It is set by `surfaceSttError`, by the recoverable path, and —
critically — by **every graceful ending that closes the stream on purpose**.
Budget exhaustion is the one that exists today: `handleBudgetExhausted`
announces "your balance is used up" and then calls `stt.end()`, so without
the flag the resulting close would report an outage on top of it and, since
teardown replaces the rendered list with `getConversationItems()`, that
outage would be the *only* message left — telling a user with no balance to
tap Start, which the start gate refuses. Any future path that ends the
stream deliberately must either announce an outcome or bump `generation`.
The flag is cleared whenever a new stream is wired. This is the only
genuinely new code path; without it the drop is silent.

**Stale closes.** A close whose captured `generation` no longer matches
`this.generation` describes a socket nobody is listening to any more —
`disconnect()` and `connect()` both bump it. `handleSttClose` returns
immediately on those, before touching anything: it must not clear
`isConnectedState` (that would mark a freshly started session disconnected)
and must not call `onClose` (MainPanel's `isSessionActive` guard passes for
the new session, so its full teardown would run). This also removes a
guaranteed duplicate: `disconnect()` reports the close itself, so every Stop
used to deliver `onClose` twice.

**BYOK symmetry.** `resumeSttStream`'s exhausted-ladder tail currently calls
`surfaceSttError('503', originalMessage)` before its synthetic
`onClose({ code: 1006 })`. It calls the recoverable path instead, so "the
service was unavailable and never came back" reads identically in both modes.

### 3. Duration cutoff, moved

`handleSttClose`'s `pendingDurationCutoff` branch emits
`i18n.t('mainPanel.sonioxSegmentEnded')` through `emitSystemNotice` and then
calls `onClose(event)` with no extra field. `MainPanel.tsx`'s
`if (event?.sonioxDurationCutoff)` block and its inline item construction are
deleted; its teardown path already renders whatever the client holds.

The key already exists in all 30 locales — this is a move, not a new string.

Product behaviour is unchanged: still no auto-reconnect after a cutoff (a
silent reconnect would restart billing without the user knowing), still one
notice, still the same words.

### 4. Copy

One new key, `mainPanel.sonioxConnectionLost`, across all 30 locales
(`src/locales/*/translation.json`; `locales.consistency.test.ts` fails on any
catalog that lags `en`).
English source string:

> The connection was interrupted — tap Start Session in a moment to continue.

"in a moment" is load-bearing, not filler: see Known limitations.

**The button name is not free text.** Both this notice and the existing
`mainPanel.sonioxSegmentEnded` tell the user to tap the session-start button,
and they spell its label out rather than interpolating it — so a translation
can name a word that appears nowhere in the UI. It already had: 18 of the 30
catalogs said "Start" (or a local equivalent) while their button read
"Start Session" / "Sessione starten" / "セッション開始". Every catalog now
quotes its own `mainPanel.startSession` label in both notices, using that
locale's quoting convention, and `locales.consistency.test.ts` asserts the
containment so a future translation pass — or a rename of the button — fails
there instead of shipping.

## Testing

`SonioxClient` holds every decision, so every decision is unit-testable —
`MainPanel.tsx` has no test file and gains no logic here.

- Managed 503 → exactly one system item, localized (no `[Soniox` prefix), and
  the raw server text present in the emitted debug event.
- BYOK 503 → resume ladder still runs first (existing tests must stay green);
  after the ladder is exhausted, the same localized item.
- `408` and `socket_error` → same treatment.
- Close with no preceding error frame → one notice; close *with* a preceding
  error frame → exactly one item, not two (the `sttOutcomeAnnounced` guard).
- Budget exhausted mid-session → the session ends with exactly one item and it
  is the balance message, not an outage notice. Drive the FULL sequence (meter
  tick to exhaustion → the client's own `stt.end()` → `onClose`), not just the
  `end()` call: stopping one step short is what let this regress unnoticed.
- A user-initiated `disconnect()` → no notice, and exactly one `onClose` (the
  one `disconnect()` reports); the browser's later close for that socket
  changes nothing. A stale close from a previous session leaves the new
  session connected and delivers no `onClose` at all.
- Duration cutoff → the item now comes from the client and appears in
  `getConversationItems()`; `onClose` carries no `sonioxDurationCutoff`.
  Update the five existing assertions in `SonioxClient.test.ts` and
  `SonioxClient.managed.test.ts` accordingly.
- Recoverable failures still fire `onError` (analytics preserved); errors
  outside the bucket keep their `[Soniox <code>] <message>` text.

Manual smoke: a managed session with the network cut mid-utterance should end
with the localized notice and a Start button that works. A managed session
whose budget is exhausted mid-session must end with the balance message, not
an outage notice — the network-kill smoke above and a clean Stop already
cover the other two ways this stream ends; this is the third, clean-close
ending (the meter's own graceful `this.stt?.end()`).

## Known limitations

- **Tapping Start immediately can still hit a 409.** The lease is released
  only once Soniox's usage log lands (2–5 s) and a reconciler sweep runs; the
  client retries `session-key` once, 3 s later. The server's 409 path already
  pokes an immediate sweep, so the retry usually succeeds — but "immediately"
  is not guaranteed, which is why the copy says "in a moment". Hardening the
  retry ladder was considered and deliberately deferred; it affects the
  duration-cutoff restart identically and is not specific to this change.
- **Managed sessions still cannot resume in place.** A 503 ends the session.
  Making one resumable needs, at minimum: a `POST /soniox/session-resume`
  endpoint that mints a fresh `single_use` STT key for the caller's live
  lease with `max_session_duration_seconds` set to the lease's *remaining*
  time and the same `client_reference_id`; two new `session_leases` columns
  (`stt_sockets_issued`, `stt_logs_seen`, both reset in `acquire()`); and a
  reconciler that releases the lease only once every issued socket has
  reported a usage log (or `end_signalled_at` is set, or the lease expires),
  replacing today's "the first STT log proves the session ended" rule in
  `soniox-reconcile.ts:451`. Deliberately not built.
- **`408` is classified by wire code, not by cause.** If Soniox ever returns
  408 for something the user *could* fix, it would read as a transient
  outage. No such case is known today.
- **Eight clients still duplicate the system-item construction.** This design
  uses that seam without unifying it.
