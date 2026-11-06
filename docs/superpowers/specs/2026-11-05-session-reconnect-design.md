# Reconnect after an unexpected disconnect: design

Issue: kizuna-ai-lab/sokuji#692 (reported in #690). Status: approved 2026-11-05; amended by the implementation rulings noted inline. Backend: kizuna-ai-lab/sokuji-backend (§7).

## 1. Why

A user on a proxy that switches its exit address lost the Soniox connection five times in half an hour (close 1006), each time at an exit switch. Each drop ended the whole session: the user pressed Start again, a new session began and the conversation on screen was cleared. Today any provider connection that fails ends the run (`src/lib/session/run.ts`, `'failed'` → `host.end({reason:'leg-failed'})`), and the managed (Kizuna AI) Soniox key is single-use, so nothing can reconnect with it.

This work makes a session survive an unexpected disconnect: the dropped connection comes back by itself and the conversation stays.

## 2. Rulings

From the owner (2026-11-05):

1. One mechanism for every provider: a shared interface and policy, each provider adapter implementing its own part.
2. First delivery: Soniox and Qwen LiveTranslate, each both managed (Kizuna AI) and with the user's own key.
3. Managed sessions reconnect within the same session: the backend issues fresh credentials for the session already running. No second session, no new grant.
4. Speech during the gap is dropped. Buffering can come later: replaying the unfinalized audio (Soniox only) follows once this delivery works (owner, 2026-11-05). What the user is told (owner, 2026-11-05): while reconnecting, that it is reconnecting, the attempt number and how long it has been trying; after it, that it reconnected. Not how long it was down, nor how much speech may be lost.
5. Give up about 30 s after the drop.
6. Unchanged: a manual Start after a session ended still begins a new session and clears the screen. Normal ends (Stop, the balance spent, the session's time cap) never reconnect.
7. The aim (owner, 2026-11-05, on the plan): reconnect as fast as possible and lose as little speech as possible.
8. A reissue may take back a lease the reconciler released moments before (§7); taking one back may put the organisation one stream over its concurrency cap, which is acceptable (owner, 2026-11-05).

## 3. Goals, non-goals, anti-goals

Goals

- An unexpected disconnect of a Soniox or Qwen connection, managed or own key, reconnects within about 30 s, and the conversation, its history and the session's countdown carry on.
- While it reconnects the user sees that it is reconnecting, which attempt it is on and how long it has been trying (the existing "Reconnecting…" status, `src/lib/view/statusLine.ts`, extended); after it, a line in the conversation says the connection was lost and restored; if it gives up, the session ends as it does today, with the reason.
- The mechanism is the same for both providers and ready for the next ones.

Non-goals

- Gemini and OpenAI live keep their own reconnects for now (they already have them); Palabra, Volcengine and local models are later deliveries.
- Mobile (sokuji-mobile) is not in this delivery. It imports only Soniox's low-level pieces from this repository (`vendor/sokuji`: the socket, the STT stream, speech, utterances) and runs its own session code, so it does not get this behaviour by itself. What it can reuse afterwards: the backend's reissue endpoints (§7) and the reconnect policy (§5), which is written so that it imports cleanly there. Its own wiring, status and device tests are a follow-up issue.
- Buffering and resending gap audio; resuming the provider's server-side context (Soniox and Qwen have no resumption: a reconnect is a new connection).

Anti-goals

- A reconnect that extends a managed session past its granted end, or runs two sessions for one account at once. The backend enforces this (§7); the client must not try.
- A retry loop on something retrying cannot fix: an invalid key, a frozen wallet, a spent balance, a session the backend has ended.
- Translations arriving late or out of order because of the gap.

## 4. Behaviour

### 4.1 Which ends reconnect

A connection that closes or errors after it was live, while the session did not ask it to, is classified by its adapter:

| Cause | Soniox | Qwen | Action |
|---|---|---|---|
| Transport: close 1006/1001/1011/1012/1013/1014, a socket error, a connect timeout | yes | yes | reconnect |
| Provider overloaded, failing or timed out: any Soniox 5xx (500, 502, 503, 504), 408; Qwen server errors | yes | yes | reconnect |
| Auth: 401, 403 (other than Soniox's 403 at grant end), an invalid or expired own key | | | end, with that reason |
| Quota or balance: Soniox/Qwen quota codes, Kizuna 402 | | | end, with that reason |
| A request the provider rejects (other 4xx, a bad config) | | | end, as today |
| The managed session's grant ending (Soniox 403 within the grant-end margin, the lease timer) | | | end as a lease end, as today |
| The session's own Stop, a source ending, the window closing | | | as today |

Each adapter owns its table (the codes differ); the policy only asks "retryable or not". A close the table does not list defaults to reconnect when it is a transport-level end (1000 or 1005 sent by the server while the session did not ask, 1006 and the 1011–1014 family), and to end when it says the request itself was wrong (1003, 1007, 1008, 1009, 1010). (My call: an end the user cannot act on is better retried within the budget; a malformed or refused request is not.)

### 4.2 The attempts

- Break before make: the dropped socket is detached (no more of its events reach the session) and closed; then the attempts begin. This is Gemini's order (`src/providers/gemini/adapter.ts`, `reconnect()` / `ladder()`).
- Attempts start at once, then after 0.25 s, 0.5 s, 1 s, 2 s and 4 s, and again every 4 s, until 30 s have passed since the drop. Each attempt's connect is bounded so that it cannot run past the 30 s. (Tightened from 1, 2, 4, 8 s, every 8 s, for rule 7.)
- When the system reports the network back (the `online` event), a waiting attempt starts at once instead of at its scheduled time.
- A dead connection that does not close: a Soniox connection that stays open but sends nothing back for about 5 s while audio is being sent is treated as dropped (cause `stall`). The threshold is set from the longest gap between Soniox messages measured on a recorded session: on a real 263 s managed Soniox session the longest gap was 1071 ms during speech and 1214 ms during silence (p99 912 ms and 1213 ms), so 5 s is over four times the longest.
- A dead Qwen connection that does not close: Qwen sends nothing back while the leg is quiet, and a browser cannot send a WebSocket ping, so the leg probes. Under automatic turns a live connection sends `input_audio_buffer.clear` every 2 s (`QWEN_PROBE_MS`), with no `event_id`. With server VAD on, Qwen always refuses it at once (an `error` of type `invalid_request_error`, "Error clear input audio buffer: server_vad is enabled.") and clears nothing. A probe that nothing at all answers for 6 s (`QWEN_STALL_MS`) drops the connection as a `stall`. The wait counts from the first unanswered probe, not from the last frame heard, so a hidden page's timer that fires a minute late does not read as a stall when every probe was answered; on a clock that keeps time a dead connection is found 6–8 s after its last frame. The refusal is the probe's answer, not an error: it is not logged and does not word or classify the next close. The refusal carries Qwen's own `event_id`, not the client's, so it is known by its words. If Qwen ever answers a probe with `input_audio_buffer.cleared`, the leg stops probing for the rest of the session and says so once in the log (`session.probe_stopped`); it then notices only a close, as before. Under push-to-talk no probe is sent: there a clear really empties the buffer, and an empty commit leaves the session refusing the next press. Instead a commit (a release's or the keepalive's) that nothing answers for 5 s (`QWEN_TURN_ANSWER_MS`) is a `stall`, and an idle leg never is. Measured against the real service on 2026-11-06 (international endpoint, `qwen3.8-livetranslate-flash-realtime`): about 50 probes were refused within 95 ms; over a 157 s session with two 70 s silences all 76 probes were answered, the slowest in 296 ms, and both utterances were transcribed, translated and spoken, as in a session without probes; `input_audio_buffer.committed` follows a push-to-talk commit in about 80 ms. (Implementation ruling, 2026-11-06, after a real managed Qwen session whose network was cut stayed open and unnoticed until it was stopped.)
- Managed: each attempt first asks the lease for fresh credentials (§5). A refusal the user can act on (balance, sign-in, frozen wallet) or a session the backend says has ended stops the attempts at once with that reason; a network error or timeout on that request counts as a failed attempt.
- Own key: the credentials are reused.
- The last failure decides the message: an actionable refusal shows as itself, anything else as the existing "connection lost".
- A grant that ends during the attempts ends the session as a lease end, as today.
- Credentials are fetched once per drop, not once per attempt: a Soniox key whose socket never opened is reused by the next attempt while its start window lasts; a new one is asked for only when the previous one was spent (its socket opened) or has expired. (My call.)
- A managed Qwen reconnect never dials a token minted before its drop (owner, 2026-11-06; until then a Qwen token was reused across drops while it was valid). Each drop's first attempt asks the backend for a new token (`POST /qwen/session-key/reissue`), and the drop's later attempts reuse it while it is valid (until 5 s before its expiry). The two legs of split Both that drop in the same blip share one request: the lease serves a token it fetched at or after the asking leg's drop began, on the run's clock, and an ask while a request is out joins it. A token whose fetch time reads after now (a wall clock stepped back) leaves the cache and is never served. Two residuals remain: an ask that joins a request already out, or takes its answer from the cache, can get a token minted up to that request's 15 s timeout before the asking leg's drop, since a token's fetch time is when its answer arrived; and a clock stepped back and caught up again within one flap wait. Both fall under the backend's accepted two-legs residual. The grant's own token serves the Start only, never a reconnect. A token Qwen refuses is handled as before. Why: the backend tells a Qwen lease still in use from an idle one by a session report at or after the lease's latest token mint. A reconnect on a token minted before the drop brings no mint the backend can see, so if that session's `session-started` report were then lost, the backend could release the account's one-session lock while the session runs. Unchanged, deliberately: the 30 s budget and the attempt schedule; a reissue answered `lease_ended` still ends the session with its notice, never a silent new Start; and a reissue answered 429 (the backend's per-minute limit, §7) is still a failed attempt retried within the budget, so a drop whose budget runs out on it ends as "connection lost".
- Flapping: a connection that drops again within 10 s of coming back does not get a fresh 30 s; it continues the budget of the drop before. Each connection reconnects at most 100 times; the next drop ends it as "connection lost". (Owner, 2026-11-05: 20 was too few. The reporting user's longest session ran 1 h 50 min, and at his rate of a drop every six minutes it would have dropped about 18 times. The flapping rule is what stops a runaway loop; the count is only a backstop.) This replaces the own-key Soniox 503 path's `MAX_RESUME_CYCLES` limit, which moves into the shared policy. (My call.)
- A fast loop (a connection that comes back and drops again at once, again and again) is held back three ways (implementation ruling, 2026-11-05, after the final review measured 100 reconnects in 50 s under the rule above): the k-th consecutive drop inside the 10 s window waits the k-th step of the attempt schedule before its first attempt instead of trying at once; a connection reconnects at most 10 times in any 60 s, and the next drop ends it as "connection lost"; and the "Connection lost and restored" notice shows at most once per leg per 10 s.
- A reissued Soniox key's start window is counted on the client's clock from when the answer arrived (10 s, less a 1 s margin), not from Soniox's expiry time, so a skewed client clock cannot reuse a dead key; a connect still running when that window closes is given up and the next attempt asks for a new key. (Implementation ruling.)

### 4.3 The conversation

- At the drop: what the dropped connection had in flight (an unfinished segment, an utterance being read aloud for that leg) is closed as it stands, as a provider `failed` closes it today, but the leg stays and the run goes on. In manual-turn modes an open turn closes; a press still held when the connection comes back opens a turn on the new connection (Gemini's choice).
- During the gap: captured audio is dropped (`appendAudio` has no connection); agent text is not sent; read-aloud already queued for the other leg keeps playing.
- While reconnecting: the status line shows "Reconnecting… (attempt N, X s)" (localized), updated as attempts go.
- After it: one notice on the leg, "Connection lost and restored" (localized), and new segments continue with the next reference numbers. Nothing is re-sent.
- If it gives up: the leg fails as it does today (`connection_lost` or the actionable code), the run ends, auto-save runs. The conversation stays on screen until the next Start, as today.

### 4.4 Two connections

- Split Both (two Soniox cores, or Qwen's legs): only the core or leg that dropped reconnects; the other keeps working.
- Shared Both and face-to-face (one Soniox STT socket for both legs): that socket reconnects and both legs show the notice.
- Soniox TTS sockets already reopen on demand (`src/providers/soniox/speech.ts`); unchanged.

### 4.5 Diagnostics and analytics

- Frames through the existing adapter frame log: `session.reconnecting` (cause, code), `session.reconnect_failed` (attempt, message), `session.reconnected` (downMs, attempts), `session.connection_lost` (attempts) at give-up.
- Analytics (PostHog, owner request): three new events; no content, no keys, no reference ids. Their names and property types are defined next to the reconnect policy, in the same platform-neutral module (§5), so the mobile app sends the same events with the same properties and the two can be compared in PostHog; `src/lib/analytics.ts` takes its types from there. Every one carries `client` (`desktop`, `extension`, `ios`, `android`), since drops from switching between Wi-Fi and mobile data are expected to be more frequent on phones. `connection_dropped` and `connection_reconnected` also carry an optional `network` (`wifi`, `cellular`, `ethernet`, `unknown`): mobile fills it from `expo-network`; the desktop app and the extension usually cannot tell and send `unknown`. A drop on one network and a reconnect on another shows a network switch.
  - `connection_dropped`, at every unexpected drop, retryable or not: `session_id`, `provider`, `managed` (Kizuna AI or own key), `channel` (`speaker`, `participant` or `shared`), `cause` (`close`, `error`, `timeout`, `stall`), `close_code`, `error_code`, `retryable`, `session_elapsed_ms`, `drop_index` (the nth drop of the session), `since_last_reconnect_ms` (absent on the first), `online` (`navigator.onLine` at the drop).
  - `connection_reconnected`: `session_id`, `provider`, `managed`, `channel`, `down_ms` (drop to the new connection live), `attempts`, `credentials_reissued` (whether new credentials were fetched), `reissue_ms` (time spent fetching them), `drop_index`, `budget_shared` (it dropped within 10 s of the previous reconnect, §4.2).
  - `connection_reconnect_failed`, when the attempts end without a connection: `session_id`, `provider`, `managed`, `channel`, `down_ms`, `attempts`, `reason` (`timeout` after 30 s, `refused` by the reissue, `terminal_error` from the provider, `session_cap` at 100 reconnects, `lease_ended`, `stopped` when the user stopped the session meanwhile), `error_code` (the last one), `refusal_code` (the reissue's, when `refused`), `drop_index`.
  - `translation_session_end` gains `reconnect_count`, `reconnect_down_ms` (the total) and `reconnect_failed` (whether the session ended by giving up).
  - The existing `connection_status` events stay as they are, so current charts keep working. `api_error` is no longer sent for a drop that is being retried; it is sent at give-up as today, so its count stays "sessions that lost their connection".

## 5. The shared interface

The run already understands two leg events, `reconnecting` and `reconnected` (`run.ts`, the leg state `'reconnecting'`), and Gemini already sends them. The new shared part is the policy around them, so the two adapters do not each grow their own ladder.

- `src/lib/session/reconnect.ts`: a reconnector an adapter owns, one per connection. The adapter calls it when a connection dropped and the adapter judged the cause retryable; it emits `reconnecting` on the leg(s), runs the attempts on the request's clock (§4.2) by calling back into the adapter, emits `reconnected` with the down time, or reports give-up so the adapter fails the leg with the last reason. It writes the frames (§4.5) and is cancelled by the session ending.
- What each adapter provides: whether a close or error is retryable (§4.1), how to detach and close the dropped socket, how to get credentials for an attempt (managed: the lease; own key: the same), and how to connect and bring a new socket live (the start path's own connect, reused).
- The lease ports gain one method each (§6), so the reconnector never knows whether a session is managed.

The policy numbers (attempt schedule, 30 s budget, connect bound, the flapping rule) live in that one module. It is platform-neutral: no DOM, Electron or React imports, its clock and timers injected, so the mobile app can import it through `vendor/sokuji` as it imports the Soniox stream today.

## 6. Credentials for an attempt

- Soniox, managed: `SonioxLeasePort.reissue(role)` asks the backend for a fresh single-use STT key for the same lease and role (`spk_stt`, `par_stt`, `mix_stt`). The answer carries the key and its own client reference id (§7). The TTS key is already reusable for the session and is not reissued. The client reports `session-started` for the new key's first accepted frame, naming that key's reference id, so a retried report is recognised as a repeat. It connects at once: the key's start window is short (§7).
- Qwen, managed: `QwenLeasePort.reissue({ notBefore })` answers a token for the same lease minted since the leg's drop began (`notBefore`, on the run's clock): the one the lease fetched since then while it is valid, else a new one from the backend, one request for both legs (§4.2). The new connection reports its `sess_…` id as every managed Qwen connection does.
- A managed connection's `session-started` report (Soniox's per key, Qwen's per session) is tried again after a transport failure or a 5xx: after 1, 2, 5 and 10 s, then every 30 s, on the run's clock, for as long as that connection is open, the run has not ended, the lease is not released and the run is not aborted. A 2xx is the report; a 4xx is final. The adapter tells its lease port when a reported connection ends (its drop, a refused or abandoned handshake, a failure, a stop, or a new connection replacing it: Soniox's `streamEnded()`, Qwen's `sessionEnded(id)`), and that report's retries stop. The backend takes a repeat of a stored report as an idempotent retry. A report let go unacknowledged is one `session.notify_failed` line in the Logs; no analytics event is sent for it. Why: the backend holds a lease for a connection it has not heard started only briefly (a reissued Soniox key, about 25 s; a Qwen lease is told from an idle one by a report at or after its latest token mint), so a lost report could let it release the lock while the connection runs. (Implementation rulings, 2026-11-06: Soniox first; Qwen's report had been tried four times in about 3.5 s.)
- Own key: the key the session started with.
- A reissue answers either credentials or a refusal with a code: `lease_ended` (the session is over, ended, released or past its end), `reissue_limit` (the session's reissues are used up), `sign_in_required`, `wallet_frozen`. All refusals stop the attempts; `lease_ended` ends the run as a lease end. There is no balance check: the granted time was covered by the balance when it was granted, and a floor check now would end a session the user already paid for, at the moment its dropped stream's usage is being charged. (My call.)
- An older backend without the endpoint answers 404, read as "cannot reissue": the session ends as it does today. So the client can ship before the backend without harm, and works fully once the backend is deployed.

## 7. Backend (kizuna-ai-lab/sokuji-backend)

Two endpoints, each issuing fresh credentials for a lease that is still running, and never more than that. The backend's current accounting was checked against this section in backend review.

Rules for both:
- The caller owns the lease; the lease is active (no session-end posted, not ending, not past its end); the wallet is not frozen. No balance floor (§6).
- What is issued lasts only the lease's remaining time; the lease's end and its budget do not change, and nothing a reissue triggers moves the lease's expiry.
- At most 150 reissues per lease and role (Soniox) and per lease (Qwen). That is more than the client's 100 reconnects (§4.2), because a drop whose connect outlasts the new key's 10 s start window takes a second key.
- At most 6 reissues per lease in any 60 s for Soniox and 4 for Qwen (2 until 2026-11-06: a looping two-leg Qwen lease at 6 would take its region's whole 10-a-minute start budget; raised to 4 by the owner on 2026-11-06, below), counted from what is already recorded (Soniox: the issued keys; Qwen: its reissue places, each taken before its mint in the same statement that checks both limits, so concurrent reissues cannot all pass; a failed mint's place still counts toward the minute, a busy pool's is given back; backend PR review, 2026-11-05). Over it the answer is a retryable 429. A working Soniox client needs one per drop; this stops a broken one that loops from using up the organisation's key minting (backend review, 2026-11-05). A working Qwen client also needs one per drop since every reconnect takes a token minted since its drop (§4.2), and the two legs of split Both share one only when both drops are found within one reissue's round trip; each leg finds a stall on its own probe timer, so one blip often takes both of the minute's reissues. At 2, a second blip within that minute was refused 429 until the first reissue left the window, and a drop whose 30 s budget ran out first ended as "connection lost". The owner raised Qwen's limit to 4 (2026-11-06), which rides out two blips a minute; the cost, one looping two-leg lease taking 8 of the region's 10 starts a minute, is met by adding Alibaba accounts to the pool when needed. The backend logs each refusal (`qwen_reissue_refused`) with the lease's reissue times in the minute.
- A reissue never creates a second lease, so the one-session-per-account rule holds.
- A reissue whose own key or token mint fails answers a retryable error and leaves the lease as it is. A Soniox key row whose mint failed is kept and marked ended (`ended_at = issued_at`): it no longer holds the lease, but counts toward the 150 cap and the 6-per-60-s rate, so a client retrying through a Soniox outage is answered 429 after six and cannot mint keys in bulk. (Implementation ruling, 2026-11-05.)
- The Qwen per-minute limit counts reissue windows only, not the lease's first (Start) window. (Implementation ruling.)
- Taking back a released lease (owner, 2026-11-05): a dropped connection's usage log can reach the reconciler before the client, still offline, asks for new credentials; the reconciler then releases the lease and the reissue would find it over. So a Soniox reissue first takes the lease back, in one statement, when all of these hold: the account's lease row still carries this lease id (a new session overwrites it); the session had started; no session-end was posted; every connection it started has ended (the reconciler's own release condition, which tells this release apart from the one after a failed key mint); it was released less than 60 s ago; and the granted end (the lease's expiry less its 15 s margin) is more than a new key's start window away. Otherwise the answer is `lease_ended`. The concurrency caps are not checked on a take-back (rule 8); one that goes over is logged.
- A key issued and not yet started counts as in use until its start window and the lease margin have passed, in both release statements (the reconciler's per-log release and the backstop run when a user is blocked by a 409). Without it a sweep in the second between the key's issue and its `session-started` would release the lease.

Soniox (`POST /soniox/session-key/reissue`, body `{ leaseId, role }`):
- Each reissued key gets its own client reference id: today's four parts plus a sequence number (`…:<seq>`), so Soniox's usage log for it is still attributed to the same lease and role, and each key can be tracked on its own. A new `soniox_issued_keys` table (D1 migration) records per key: lease, role, sequence, issued, started, ended. `parseClientRefId` and the billing code that reads reference ids accept the extra part; the first key of a lease keeps today's four-part id.
- `max_session_duration_seconds` is the lease's end minus now minus the key's start window, and that start window is short (10 s). Soniox counts a key's duration from the moment it connects, so a key that may connect up to its start window after issue could otherwise outlive the lease, and an account could start a second session when the lease expires while the old connection still runs (the "one balance, two sessions" case `markStarted` guards against). With this, the lease's expiry never moves.
- The reconciler must change: today it marks a stream ended when it sees that stream's usage log (`noteStreamEnded`) and releases the lease when every stream has ended, without waiting for the client's session-end. A dropped connection's log arrives 2 to 5 s after the drop, so the lease would be released mid-session while the new connection runs.
- The change (checked against the current code in backend review): a role ends when every key **started** for it has its usage log. Per key, as the bitmask does per role today: a key's `session-started` (by its reference id) marks it started, idempotently; its usage log (by its reference id) marks it ended, idempotently, so the reconciler's deliberate 60 s overlap between scans (`WATERMARK_OVERLAP_MS`) cannot count one log twice. A reissued key's `session-started` does not move the lease's expiry (today `markStarted` sets it to now + max duration). A key minted and never started produces no log and is not waited for. The alternative, releasing only after the client's session-end, is not taken: a client that crashes or is force-quit would keep the account locked until the lease expires, where today it clears within seconds.

Qwen (`POST /qwen/session-key/reissue`, body `{ leaseId }`). Qwen leases are released only after the client's session-end or at expiry, so they need no take-back:
- Signs a new token for the same lease and records its time window under that lease (`qwen-attribution.ts` attributes usage by the token's window and the reported session ids).
- The reconciler already supports several connections per lease: release waits for the client's session-end and a usage record for every reported connection (`releaseQwenLeases`); a lease accepts up to `QWEN_REPORTS_PER_LEASE` reports, raised from 20 to 302 = (1 + 150) × 2: every window, the Start one included, may bring one connection per leg, and a lease has at most two legs, so a two-leg lease keeps its full 150 reissues. The Qwen reissue cap counts windows only. (Implementation ruling, 2026-11-05.) Each Qwen reconnect is a new Qwen session and counts against Alibaba's 10 new sessions per minute per region, which the backend already enforces for all users together: when many users drop at once, some reissues answer busy and those clients retry within their 30 s.

Known remaining risk (accepted): a reissued key that connects but whose client crashes or is force-quit before it reports `session-started` is unknown to the backend, which releases the lease once the earlier keys' logs are in. The account can then start another session while that connection runs for a short while. The overlap cannot pass the lease's original end, because the key's duration is cut to end before it. The first key of a lease has the same window today (its start window's two-stage expiry), so no mechanism is added for it.

Release order: the D1 migration, then the backend (endpoints and the Soniox reconciler change; merging to main deploys production), then the client.

## 8. Verification

- Unit tests for the reconnector on a virtual clock: the attempt schedule, the 30 s give-up, cancellation by the session ending, the events and frames, the last reason winning.
- Adapter tests (Soniox, Qwen; own key and managed with a fake lease): a 1006 after live reconnects with a reissued key and keeps the leg live; a 401, a quota code and a `lease_ended` reissue end at once with their reason; split Both reconnects only the dropped core; shared Both reconnects its one socket; the in-flight segment closes and the notice appears; audio in the gap is dropped; a grant ending during the attempts ends as a lease end.
- Backend tests: the reissue rules (ownership, active lease, the duration of lease end − now − start window, the cap, no second lease, a frozen wallet), reference ids with a sequence parsed by billing, `session-started` per key idempotent and not moving the expiry, a log seen twice across overlapping scans counted once, and the reconciler not releasing a lease while a started key has no log.
- By hand, desktop app on macOS and Windows, and the extension: a session with Kizuna AI Soniox, Kizuna AI Qwen and own-key Soniox, broken by switching the network (VPN on/off or Wi-Fi off for 5 s); it reconnects, the conversation stays, the status line counts the attempts and seconds and the restored notice appears; with the network off for over 30 s it gives up with "connection lost".

## 9. Open points

1. (Settled in backend review: per-key reference ids and the issued-keys table; the reissued key's duration shortened by its start window.)
2. Qwen's exact error codes for "retryable" against "end" (from `wire.ts` `errorCode` and recorded sessions).

## 10. Left to the builder

The reconnector's exact API and file layout inside `src/lib/session/`, the connect bound per attempt, the frame field names, the notice's wording in each language, and how the adapters share the start path's connect code.
