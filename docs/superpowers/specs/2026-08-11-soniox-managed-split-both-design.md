# Managed Soniox: user-selectable split "Both" mode — Design

**Status**: design agreed, not implemented. Backend and frontend both in scope.
**Repos**: `sokuji-react` (client), `sokuji-backend` (lease, keys, billing, reconciler).

## Why

"Both" mode translates in both directions — the user's microphone and the far end's
audio. BYOK Soniox lets the user choose how that runs:

- **Shared**: one Soniox session. `PcmMixer` mixes mic (A) and system audio (B) into a
  single STT stream, and `SonioxSideTracker` infers which side spoke from an energy
  timeline plus speaker-label memory.
- **Split**: two independent Soniox sessions, one per audio source. Attribution is
  physical rather than inferred.

Managed (Kizuna AI) Soniox **forces shared**, because the backend's session lease is one
per account and two sessions would need two leases. `sonioxUsesSharedBothSession` returns
`true` unconditionally for the managed twin whatever the stored preference says.

Shared mode's attribution is a guess, and it guesses wrong often enough to be a complaint:
the two sides are distinguished by *language*, not by channel, which is also why shared
mode requires a concrete `sourceLanguage` and refuses `auto`. Two people speaking the same
language, or a far end that switches languages, defeats it.

This design lets managed users choose split, as BYOK users already can.

## Decisions taken

Recorded here because several were contested during design and the reasoning is not
recoverable from the code:

1. **Split is a user-selectable option, not the new default.** Shared stays, and keeps its
   code path. Users who choose split pay for it.
2. **Split costs roughly 2× per wall-clock minute, and that is reflected honestly.** The
   granted duration and the on-screen countdown halve at the same balance, and the Start
   gate's balance floor rises accordingly. A low-balance user will find split refused. We
   do not absorb the difference.
3. **One leg dying mid-session stops the whole session**, matching today's symmetric
   teardown. Split roughly doubles how often that happens; it does not change what happens.
4. **A participant leg that never comes up does not block the session.** It continues on
   whichever channel did come up — see *Degradation is one-way, not shared* below for what
   is and is not achievable in v1.
5. **Legacy three-segment usage logs are not supported.** Sessions live at deploy time lose
   their revenue. They must not lose their lease lifecycle — see A4.
6. **Billing moves to provider cost × coefficient.** Charging stops being a function of
   wall-clock time at a per-SKU list rate.
7. **The lease moves out of `SonioxClient`.** A client becomes a thing that runs one
   stream with credentials it was handed.

## What is true today

Load-bearing facts, verified against the code. Each one is a constraint the design has to
respect, and several were discovered only by reading rather than by reasoning.

**The lease is one row per account.** `session_leases.account_id` is the primary key and
`client_ref_id` is unique. `acquire` is a single `INSERT … ON CONFLICT(account_id) DO
UPDATE … WHERE expires_at <= ? OR reconciled_at IS NOT NULL`, so the "is there a live
lease" test and the claim cannot interleave.

**A usage log is emitted only when a Soniox stream ends.** Nothing appears mid-session.
This is what makes a usage log un-forgeable proof that a session is over, and it is why the
reconciler releases a lease on an `stt-*` log. It does *not* release on a `tts-*` log,
because Soniox closes an idle TTS socket after ~5.3 s and the client reconnects, so a TTS
log routinely arrives while the session is still running.

**Release is gated behind charge ownership.** `releaseLease` and `unpinVoiceSlot` are
called only from inside the branch that has already decided the log is ours. A log whose
`client_reference_id` does not parse takes the "not ours" path — which is the *normal*
path for BYOK customers' traffic in the same org log stream — and is skipped silently.

**The reconciler re-processes logs on purpose.** `clampWindow` overlaps the previous
watermark by 60 s so a log landing on a sweep boundary is never missed. Re-charging is
harmless because `externalId` (the log's own uuid) makes the ledger row idempotent. Any new
per-log state must be idempotent under repeated application for the same reason.

**Two temporary keys, not one, with different properties.** `session-key` mints one key per
usage type: the STT key is `single_use` with a 60 s start window; the TTS key is
deliberately **not** `single_use`, with `expires_in_seconds` covering the whole granted
duration, because it must survive the reconnects above. Both carry the lease's
`client_reference_id`.

**The declared mode is self-enforcing.** `usageTypesForMode` derives the key set from the
client-declared mode, and asking for `text_only` yields no TTS key — so the cheap rate
cannot buy the expensive path. This is a structural property, and this design must not
replace it with a blocklist.

**Org concurrency is counted per lease, not per stream.** `countActive` is
`COUNT(*)`/`SUM(uses_tts)` over live lease rows.

**The participant channel is hardcoded text-only.** `createParticipantSessionConfig` sets
`textOnly: true` unconditionally, so no participant-side TTS exists in any mode.

**Participant failure is non-fatal by design.** At least three paths bring a session up on
the speaker alone: loopback permission denied, `createParticipantSessionConfig()` returning
null, and the general participant catch whose comment reads *"the session continues on
whichever channel(s) did come up"*.

**Managed sessions are barred from the 503 STT resume ladder**, because the STT key is
`single_use` and a resume would have nothing to reconnect with.

**The cost meter has no clock.** `SonioxCostMeter` is advanced only by the STT stream's
~5 s keepalive tick, forwarded through the client's stream handler wiring. Its `tick` is
absolute (`now - startedAt`), which is what makes more than one ticker harmless.

**BYOK's client takes a single positional string.** `new SonioxClient(creds.primary)`, one
key serving both the STT and the TTS socket. The credential object below is therefore a
*new* shape for both flavours, not an existing BYOK shape that managed is being moved onto.

**Voice pins are claimed before a lease exists.** `prepareManagedVoice` runs in MainPanel
before any client is constructed, while the lease is minted inside `connect()`. A pin can
exist with no lease behind it, reclaimed only by its own short TTL.

## Architecture

### A1. Stream roles and the four-segment reference

`client_reference_id` becomes `sokuji1:<accountId>:<leaseId>:<role>`, with role drawn from
a closed vocabulary of six:

| role | audio source | kind |
|---|---|---|
| `spk_stt` | microphone | transcription |
| `spk_tts` | — | synthesis |
| `par_stt` | far-end / system audio | transcription |
| `par_tts` | — | synthesis |
| `mix_stt` | mic + system, mixed | transcription |
| `mix_tts` | — | synthesis |

`side` says which audio source feeds the stream; `mix` is shared Both mode's mixed stream,
and naming it `spk_*` would be a lie. `par_tts` is unreachable in v1 (the participant
channel is text-only) but stays in the vocabulary so that adding a second TTS stream later
is a change of policy, not of format.

**Every Soniox stream gets its own reference carrying its own role.** One key, one
reference, one role.

`parseClientRefId` returns `{ accountId, leaseId, role, baseRef }`, where `baseRef` is the
three-segment `sokuji1:<accountId>:<leaseId>`. `role` is validated against the closed set;
an unrecognised role parses as ours-with-unknown-role and alarms, and specifically must not
fall through to "not ours" — that path is silent by design and would hide the failure.
Exactly three segments is rejected (decision 5).

**Ownership and parsing must be two separate predicates, or decisions 5 and A4 contradict
each other.** `parseClientRefId` answers "can I bill this?" and rejects three segments;
a prefix-only `isOurClientRef` answers "is this ours at all?" and accepts both three and
four. A4's release path is gated on the second, never the first. Collapsing them into one
function strands every session that was live at deploy — the exact outcome A4 exists to
prevent — and the failure is silent, because rejecting a reference is indistinguishable
from a BYOK customer's traffic.

**Why the role is worth carrying even though `classifyLog` already derives stt/tts from the
model prefix.** It gives a second, independent signal. The existing alarm text says that if
Soniox renamed a model prefix, *every* session would classify as `other`, bill zero at full
provider cost, and never release its lease. With the kind present in the reference, a
disagreement between role and model is an alarm, and an unrecognised model prefix can fall
back to the role rather than into that state.

### A2. The server owns stream expansion

The `session-key` request carries the **matrix inputs**, not a stream list:

```
{ mode: 'speaker' | 'participant' | 'both', textOnly: boolean, bothSplit: boolean }
```

The server expands them into the role set. The set of reachable sets is exactly the seven
rows of A6 and nothing else.

This is not a stylistic choice. A client-declared stream list with a validating blocklist
is strictly weaker: a request for `['spk_tts']` alone passes "no `par_tts`" and "at most one
`*_tts`", yet mints a non-`single_use` TTS key valid for the whole granted duration, against
an API with no revoke, while an empty STT expectation makes the release predicate below
vacuously true forever. Server-side expansion makes that request unrepresentable, and
preserves the self-enforcing property the current `usageTypesForMode` has.

Everything else derives from the expansion, server-side: which keys to mint, each key's
reference, `uses_tts`, the STT stream count, the budget rate, and the expected mask.

### A3. Lease lifecycle: started and ended masks

Two bitmask columns on the lease row, one bit per role:

- `stt_started_mask` — set when a stream is confirmed connected.
- `stt_ended_mask` — set when that stream's usage log arrives.

**`session-started` becomes per-role and idempotent**: `{ leaseId, role }`. It ORs the
role's bit into `stt_started_mask` and moves expiry with
`expires_at = MAX(expires_at, now + max_duration + margin)`, so a leg that connects late
can neither shrink the lease nor extend it past its grant.

**Release when `(ended & started) === started` and `started != 0`.**

Keying the predicate on *started* rather than on *expected* is the whole point. Expected is
what was requested; started is what actually happened. A participant leg that never
connects — three ordinary paths do exactly that — never sets its started bit, so it is
never waited for. Keying on expected would hold the lease until expiry, up to an hour of
`409` on every Start for a user whose session worked fine, in a case today's rule handles
correctly.

Both masks reset in `acquire`'s `ON CONFLICT` set list, as literals rather than bound
parameters, for the same reason `end_signalled_at` already does: the row is reused, and a
mask left over from the prior lease would make a brand-new session look partly finished.

The OR is fenced on lease identity (`WHERE client_ref_id = <baseRef>`), never on
`account_id`. A log that matches no live lease is visible, not silent.

**Backstops, so that no combination can strand a lease**: the blocked-sweep path invoked on
a `409` may release a lease whose started legs have all ended, and any lease past
`expires_at` is releasable regardless of mask.

### A4. Release is decoupled from charging

A log carrying the `sokuji1` prefix **releases its lease and unpins, even when it produces
no charge.**

Decision 5 accepts losing revenue for sessions live at deploy. Without this decoupling it
would also cost those accounts their lease: `reconciled_at` stays null with `expires_at` up
to an hour out, so the account `409`s on every Start for that hour *and* the ghost lease
keeps counting against `MAX_STT_CONCURRENT` / `MAX_TTS_CONCURRENT`. At 25 TTS leases, a
handful of stranded sessions would take managed speech-to-speech down for the whole
organization. Losing revenue is an accepted cost; losing the account is not.

`release` returns its changed-row count. A managed-prefixed `stt` log that matches no lease
and is younger than `UNRECONCILED_LEASE_MAX_AGE_MS` is an error log, not a silent skip.

### A5. Billing and budget are different questions

**Charging**: every log is charged `usdToMicroUsd(log.cost_usd) × K`, where `K` is the
revenue coefficient over provider cost — one number, defined in one place. This is opt-in per
charge — `ChargeRequest` carries the pricing mode explicitly — so the other providers'
time-based behaviour is provably untouched. A log with a non-positive or unparseable
`cost_usd` but non-zero audio duration alarms with its own summary counter and falls back
to the time-based charge as a floor; it never bills zero.

This dissolves the "TTS is cost-only" special case: with cost-based charging there is no
double-charge to avoid, so TTS logs are simply charged like everything else. One key can
back many successive TTS sockets and therefore many logs; a per-log coefficient handles
that naturally, and nothing downstream may wait on a TTS log — a session may produce zero
of them, because the initial TTS connect is best-effort.

**Budgeting**: the granted duration remains `balance ÷ rate`, but the rate is a
**conservative estimate for the whole stream set**, roughly the sum of the per-role
conservative rates. That one number must reach all four of its consumers or they drift:
the granted `durationS`, the `rateUsdPerHour` returned to the client (which the spec
defines as the aggregate for the set, not a per-stream price), `budgetMicroUsd`, and the
frontend's Start-gate floor.

Invariant, with a test: `conservativeRate(set) >= K × worstCaseProviderCostRate(set)` for
every set the server can issue. The estimate table and any remaining price table are
separate structures, because one number serving both meanings will drift silently.

The frontend floor lives in `sonioxManagedMinBalance.ts`, which is keyed only on `textOnly`
today and whose own comment says to keep it in sync with the backend. It gains the split
input, as does `StartGateInput`. That module stays dependency-free: the subtitle window
renders the same gate and must not pull the client into its bundle.

Consequences that must be written down rather than discovered:

- The ledger's human-readable description is built from billable seconds; a charged TTS row
  would read `0s` in user-visible history.
- The margin KPI degenerates to `cost × (K−1)` and stops being an independent observable.
- `metadata.sku` loses meaning for Soniox rows.
- The unknown-model alarm's claim that an unrecognised prefix "bills the user ZERO at full
  provider cost" becomes false. Its remaining teeth are lease release, not revenue.
- `SonioxCostMeter`'s docstring currently promises "no estimation error: what it reports is
  what will be charged". That guarantee is gone. It becomes a **session allowance**
  countdown — still the real cutoff, no longer the price — and the docstring and the
  wallet-status `rates` payload must say so.

### A6. The mode matrix

| mode | textOnly | both | clients | roles | keys |
|---|---|---|---|---|---|
| speaker | true | — | 1 | `spk_stt` | 1 |
| speaker | false | — | 1 | `spk_stt`, `spk_tts` | 2 |
| participant | *ignored* | — | 1 | `par_stt` | 1 |
| both | true | shared | 1 | `mix_stt` | 1 |
| both | false | shared | 1 | `mix_stt`, `mix_tts` | 2 |
| both | true | split | 2 | `spk_stt`, `par_stt` | 2 |
| both | false | split | 2 | `spk_stt`, `spk_tts`, `par_stt` | 3 |

`textOnly` is ignored for participant-only because the participant config forces it. That
also means participant-only sessions have no spoken output at all — a pre-existing product
gap, noted here because the matrix makes it visible, and out of scope.

**Keys are not sockets.** A TTS key may back zero sockets (best-effort initial connect) or
many (idle-close plus reconnect). Only the STT columns describe a fixed socket population.

The STT bits a row can ever set follow directly: one for every row but the last two, which
can set two. What a row actually sets is decided at connect time, not here — that is the
distinction A3 turns on.

### A7. Concurrency accounting

A split session opens two Soniox transcription streams and must count as two. The issued
stream counts are stored on the lease — the server owns the expansion, so it knows them —
and `countActive` sums them instead of counting rows. `MAX_STT_CONCURRENT`'s docstring,
which currently equates one lease with one transcription, is corrected in the same change.

### A8. The lease leaves the client

A new object owns everything that belongs to the session rather than to a stream:

```
ManagedSonioxSession
  acquire({ mode, textOnly, bothSplit })   // POST /soniox/session-key
  credentialsFor(role, ...)                // { stt, tts?, clientReferenceId }
  markStarted(role)                        // POST /soniox/session-started
  end()                                    // POST /soniox/session-end
  onExhausted                              // the single allowance countdown
```

`SonioxClient` keeps only what a stream needs. It is constructed with a credential bundle
rather than a bare key; BYOK builds that bundle from settings with one key in both slots
and no reference, managed builds it from the session. This is a new construction shape for
both flavours — it unifies them, rather than moving managed onto an existing BYOK shape.

Four details this must get right, each of which is a real failure if missed:

- **The countdown must keep a source.** It is fed by the STT stream's keepalive tick today.
  Either the session gets its own clock, or a stream forwards ticks to it. Because
  `tick` is absolute, more than one forwarder is harmless. Assert the countdown is non-null
  in a managed split session.
- **`session-end` must be sent exactly once per session.** `SonioxClient.disconnect()`
  posts it unconditionally today, and MainPanel disconnects the speaker before the
  participant — so in split the first leg's `session-end` would set `end_signalled_at` and
  unpin the voice slot while the other leg is still streaming, and burn the reconciler's
  fast-retry ladder on a log that cannot exist yet. Contract: in managed mode the client
  sends neither `session-started` nor `session-end`. Test: one POST per split teardown.
- **Exhaustion and the granted-duration cutoff are session-level outcomes.** They tear down
  every stream idempotently and announce **once**. The announcement must go through a
  client's `emitSystemNotice`, because MainPanel's teardown replaces its rendered list with
  `getConversationItems()` and a message held only in React state is wiped. Get this wrong
  and an exhausted balance reads as "the connection was interrupted — tap Start Session",
  sending the user to retry into a `402`.
- **Both STT keys share a `max_session_duration_seconds`**, so at the cutoff both legs
  `403` within the same second. Name one owner for end-of-segment messaging, or the notice
  appears twice or once depending on which close wins the teardown race.

### A9. Voice pin

Reduced to what the slot model actually supports: one account-scoped pin, unpinned exactly
once, gated on the release having really changed a row, and **fenced on lease identity** —
store the pinning `lease_id` on the slot row and unpin `WHERE account_id = ? AND
pinned_by_lease = ?`, the same fencing discipline `reserve`/`finalize` already use.

Deciding pin ownership by role buys nothing while there is one slot per account, and the
earlier "release the set of pins this lease holds" framing is dropped. It would also be
wrong about who owns what: a pin is claimed before any lease exists.

## Failure paths

| Situation | Behaviour |
|---|---|
| Participant leg never connects | Session starts on the speaker alone (decision 4). Its started bit is never set, so release is unaffected. The user is told split did not take effect. |
| Either leg dies mid-session | Whole session stops (decision 3), via the existing symmetric teardown. The notice says which direction died. |
| Balance exhausted | Session-level: every stream torn down, announced once through a client. |
| Granted duration reached | Both legs `403` within the same second; one owner announces. |
| Voice slot evicted mid-session | TTS returns `voice_not_found`; spoken output stops, transcription continues. Unchanged. |
| Soniox key issuance fails | Lease released immediately, as today. |
| A log arrives for a lease that is gone | Charged if parseable; release is a no-op reporting zero rows changed, and alarms if the log is young. |

**Degradation is one-way, not shared.** Decision 4 asked for "degrade to shared or
one-way". Only one-way is achievable in v1: by the time a participant failure is known, the
speaker client is already connected with a non-bidirectional config, and turning that into
a shared session needs a reconnect — which the `single_use` STT key cannot supply. Genuine
fallback-to-shared needs the participant channel acquired *before* the speaker connects,
which reorders `connectConversation` around a permission dialog. Out of scope; recorded as
a follow-up.

**Split has no partial-degradation mode.** Either leg's close tears down both, and managed
sessions cannot use the 503 resume ladder. Split therefore doubles the exposure to a single
leg's failure, which is what decision 3 accepts.

**Telemetry is asymmetric.** `createParticipantEventHandlers` wires only
`onRealtimeEvent`, `onConversationUpdated` and `onClose` — no `onError`, no
`onReconnecting` — and `setupClientListeners` reads the speaker ref, so it can only ever
wire the speaker. Split-mode outages will be under-counted in error dashboards by roughly
half. Either wire the participant's handlers with a `participant` tag, or state the gap.

**A degraded split session looks healthy.** Mode still reads Both, the countdown still
runs, and the only residual signal is a missing participant waveform — in advanced UI mode
only. The indicator for "split did not take effect" must be persistent and present in basic
mode, not a bubble that scrolls away.

## Compatibility and rollout

The `session-key` contract changes additively in both directions. The server keeps
accepting a bare `{ mode }` body, expanding it to the legacy single-stream set, and the
response keeps its flat `sttApiKey` / `ttsApiKey` / `clientReferenceId` fields populated
from the primary leg alongside the per-stream structure. A test replays the
currently-shipped request and response shapes against the new handler.

This is not about supporting old clients — the desktop app and the extension both ship
updated. It is about the deploy window: the backend deploys before the client does, and
`main` auto-deploys to production on merge.

Schema changes are additive: new mask and stream-count columns with defaults. No primary
key is rebuilt, so there is no window in which the deployed Worker and the applied schema
disagree — the failure mode a `session_leases` primary-key change would have introduced.

## Testing

- **SQLite-backed, against the real statements**, following `session-lease.sqlite.test.ts`:
  mask reset on lease reuse; the OR fenced on lease identity; release fires exactly when
  started legs have all ended; the split-then-speaker sequence on one account.
- **Release decoupled from charge**: a `sokuji1`-prefixed log that produces no charge still
  releases and unpins, and reports rows changed.
- **Expansion is total and closed**: every `{mode, textOnly, bothSplit}` maps to exactly one
  of the seven rows, and no other role set is reachable.
- **Budget threading**: for each set, `conservativeRate(set) >= K × worstCaseCost(set)`; the
  Start floor, the granted duration and the returned rate all come from the same number.
- **Client contract**: one `session-end` POST per split teardown; zero `session-started` /
  `session-end` calls from `SonioxClient` in managed mode; the countdown is non-null in a
  split session; the exhaustion notice is emitted exactly once and survives teardown.
- **Frontend regression**: the shared path and BYOK are unchanged. The BYOK client's
  construction shape changes, so its existing tests are the evidence.

## Open items

**Resolved 2026-08-11: Soniox attributes usage to the KEY-BOUND `client_reference_id`
and ignores the socket-level one.** Probed directly — a temporary key was minted bound to
`sokuji1:PROBEACCT:KEYBOUND`, a socket opened with that key declared
`sokuji1:PROBEACCT:SOCKETSAID` in its config frame, and all three probe sessions logged
under the key's value. Two consequences, both now settled rather than assumed:

- **One key per stream is required, not merely convenient.** Attribution comes from the
  key, so two streams sharing one key are indistinguishable in the usage logs — there
  would be no way to tell a split session's two legs apart, and A3's ended-mask could not
  be driven at all.
- **The `client_reference_id` the client sends on its socket frames is inert.** Keep the
  existing hedge or drop it, but document it as a no-op; it must not be relied on, and it
  must never be the only thing carrying a role.

Scope of the finding: our keys always carry a bound reference. Whether Soniox falls back to
the socket-level value for a key with *none* bound was not tested, because no path in this
system mints such a key.

Calibration collected at the same time, for A5's conservative-rate table: a 3.23 s stream
with no recognised speech cost `$0.000110` (≈ `$0.12`/hr); a 10.08 s stream of real speech
with `one_way` translation cost `$0.000776` (≈ `$0.28`/hr). The spread is the translation
output, consistent with output text being the dominant cost term.

**The `par_stt` key's 60 s start window may expire during the loopback permission dialog.**
It is minted inside the speaker's `connect()`, before the participant channel is attempted.
Either mint it lazily, after loopback acquisition, or size its `expires_in_seconds` to
cover the dialog.

**A bare managed `403` is currently read as the granted-duration cutoff.** It should be
accepted as "segment ended" only when elapsed session time is within a margin of the grant,
and otherwise fall through to the recoverable-outage path.

**The shared-vs-split decision is expressed in more than one place in MainPanel**, including
a `sourceLanguage !== 'auto'` clause. It becomes a single derived value that the
`session-key` request, the Start-gate floor and the client wiring all read.

## Not doing

Making split the default. Removing shared mode or `SonioxSideTracker`. Participant-side
TTS. More than two legs. Per-role voice slots. Reordering `connectConversation` so that a
failed participant channel can fall back to a genuinely shared session. Restoring the 503
resume ladder for managed sessions — though extracting the lease makes it possible for the
first time, since a session object can mint a replacement STT key where a client could not.

## Known limitations

- A participant leg that connects and then produces no usage log — if Soniox declines to
  log a stream that carried no audio — would hold the lease until expiry. Whether a muted
  or silent stream logs at all is unverified; if it does not, the started/ended predicate
  needs a third state for "started but provably silent".
- The org-wide TTS key exposure this design inherits is **not** bounded by "one lease per
  account". That bound is already false: the TTS key is non-`single_use` with a lifetime up
  to an hour, Soniox has no revoke API, and a client running short sessions repeatedly
  accumulates independently valid keys as fast as leases release. Pre-existing and out of
  scope, but no part of this design may rest on it. The real enforcement points are the
  number of keys minted and `MAX_TTS_CONCURRENT`.
- Split doubles a session's org concurrency cost. At `MAX_STT_CONCURRENT`, universal split
  adoption halves the number of concurrent managed users.
