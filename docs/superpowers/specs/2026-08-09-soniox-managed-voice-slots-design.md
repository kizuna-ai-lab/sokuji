# Managed Soniox Custom Voices — Dynamic Slot Design

**Date**: 2026-08-09
**Status**: Approved (brainstormed with user)
**Scope**: `sokuji-react` + `sokuji-backend`
**Supersedes**: the "Phase 2 — managed dynamic slots" sketch in
`2026-07-31-soniox-voice-cloning-byok-design.md`
**Related**: PR #372 (BYOK voice cloning), PR #379 (preview without a session)

## Summary

Give every Kizuna-managed Soniox user a voice cloned from their own recording,
under a hard ceiling of 20 voice objects for the entire organization.

The ceiling is structural: Soniox counts voices per organization across all
projects, and its TTS wire accepts only a registered `voice` string — there is
no inline reference audio. So 20 registered voices must serve an unbounded
number of users. They do it by becoming a **cache**: a voice is built on
demand, kept warm between sessions, and evicted when someone else needs the
slot. Slots therefore track *recently active* users, not registered ones.

The reference recording never reaches our servers' storage. It lives in the
user's browser, is uploaded only when a voice must be built, and is forgotten
by the backend the moment Soniox has it. That is what makes eviction cheap:
anything evicted can be rebuilt by the one party that still holds the clip.

## Verified constraints (2026-08-09)

- **20 voices per organization**, across all projects. Not per project, not
  per key.
- **`create` → `ready` takes ~10 s** (measured, recorded in the BYOK design).
  The voice is unusable until then.
- **The TTS wire takes `voice`, `language`, `audio_format`, `sample_rate` and
  `speed` — nothing else.** No inline reference audio (so a registered voice
  is the only route to a real clone), and no pitch/timbre knobs (so a built-in
  cannot be shaped toward a user).
- **Voice management needs the permanent org key**; temporary keys are
  live-verified 401 on `/v1/voices`. The backend already holds that key as
  `env.SONIOX_API_KEY`.
- **No voice-level ACL at Soniox** — any `tts_rt` temporary key can synthesize
  with any project voice UUID. Isolation is ours to enforce.
- **No rename and no re-point-at-a-new-clip API** — only create, delete, and
  `recompute` (for a new model). Keeping 20 stable UUIDs and rewriting their
  contents is therefore impossible.
- **Cloning is not billed** (confirmed by the account owner), so churn costs
  nothing and eviction policy is free to be chosen on UX grounds alone.
- The backend has **D1, KV and Durable Objects — no R2**.
- `docs/ANALYTICS_EVENTS.md` and `sessionStartGate.ts` are shared with the
  subtitle window; see Architecture §5.

## Decisions

| Decision | Rationale |
|---|---|
| Dynamic slots, not static claims or voice-matching | The alternatives each cut the promise: static claims cap the feature at 20 users forever; matching a user to the nearest built-in never delivers *their* voice. Dynamic slots is the only option under current constraints that keeps the promise intact and scales with concurrency rather than with registrations. |
| Reference clip lives client-side only | No biometric data at rest on our servers, so no retention or deletion obligations; no R2 to add. Eviction becomes safe because the owner can always rebuild. |
| One slot per **account** | `account_id` is the primary key, so the table itself enforces it — the same trick, for the same reason, as `session_leases`. Removes the per-account cap, the fake-device-id abuse vector, and the cross-device rebuild problem in one move. |
| No `device_id` column | After the per-account change it gated nothing. Whether *this* device can rebuild is a question the client answers from its own IndexedDB; the backend never needs to know. A real hardware id is also only obtainable on Electron — browsers withhold it as a fingerprinting vector — so the field would mean different things on different platforms. |
| Warm between sessions, LRU eviction | Cloning is free, so the only cost of keeping a voice is the slot itself, and the only benefit of deleting one is freeing that slot. Evict lazily, when the slot is actually wanted. |
| Build on voice **selection**, not on Start | Moves the ~10 s off the critical path for the common case. |
| Cold at Start blocks with progress | Honest semantics, and the case is rare once selection pre-warms. |
| Pool exhausted → built-in voice + explanation | The session still starts. |
| No heartbeat | See §2. |

## Architecture

### 1. Slot model

New D1 table (Drizzle migration `0009`):

```
soniox_voice_slots
  account_id       TEXT PRIMARY KEY      -- one slot per account, enforced by the DB
  soniox_voice_id  TEXT NOT NULL UNIQUE
  created_at       INTEGER NOT NULL
  last_used_at     INTEGER NOT NULL      -- the LRU key; touched by every ensure
  pinned_until     INTEGER NOT NULL      -- protection window; see §2
  INDEX (pinned_until, last_used_at)     -- serves the eviction query
```

`account_id` as the primary key mirrors `session_leases`, whose schema comment
explains the property we want: *"the table itself enforces the single-session
rule — there is no second row to race with."*

**States** (of one account's slot):

```
                    ensure(clip)
                    pool has room, or an evictable LRU victim exists
        ┌──────┐  ─────────────────────────────────►  ┌──────────┐
        │ NONE │                                       │ BUILDING │
        └──────┘  ◄─────────────────────────────────   └──────────┘
         ▲  ▲       create failed / user cancelled          │
         │  │                                    poll ┌─────┴─────┐
         │  │                                   ready │           │ failed (terminal)
         │  │                                         ▼           ▼
         │  │                                   ┌──────────┐  ┌────────┐
         │  └── pool full and all 20 pinned      │   WARM   │  │ FAILED │
         │      → refused, stays NONE            └──────────┘  └────────┘
         │      (client falls back to built-in)   ▲       │         │
         │                                        │       │         │ re-record
         │  ① evicted (LRU victim)                │       │ ◄───────┘
         │  ② user removes the voice              │       │
         │  ③ account deleted                     │       │ ensure(pin=1)
         │  ④ gone at Soniox (404 on ensure)      │       │ before Start
         └────────────────────────────────────────┼───────┤
                                                  │       ▼
                     ⓐ session-end received       │  ┌──────────┐
                     ⓑ reconciler proves it ended └──│  PINNED  │  never evictable
                     ⓒ pinned_until elapsed           └──────────┘
```

| From | Event | To | Notes |
|---|---|---|---|
| NONE | `ensure` with clip, pool has room | BUILDING | create at Soniox, pin for the build window |
| NONE | `ensure` with clip, pool full but something is unpinned | BUILDING | atomically evict the LRU victim first |
| NONE | `ensure`, all 20 pinned | NONE | `pool_exhausted`; client uses a built-in and says so |
| NONE | `ensure` without a clip | NONE | `clip_required`; client offers to record here |
| BUILDING | poll sees `ready` | WARM | usable |
| BUILDING | poll sees `failed` | FAILED | terminal at Soniox — recreate, never retry |
| BUILDING | create failed / cancelled | NONE | no row is left behind |
| WARM | `ensure(pin=1)` before Start | PINNED | phase-one pin |
| WARM | another account's `ensure` finds the pool full | NONE | deleted at Soniox, row removed |
| WARM | user removes the voice | NONE | explicit delete |
| WARM | Soniox 404 | NONE | deleted out of band; next `ensure` rebuilds |
| PINNED | `session-end` | WARM | trusted; see §2 |
| PINNED | reconciler releases the lease | WARM | the un-forgeable path |
| PINNED | `pinned_until` elapses | WARM | last-resort backstop |
| FAILED | user re-records | BUILDING | old row dropped |
| any | account deleted | NONE | Better Auth `afterDelete`; ignores the pin |

**Invariants**

1. A row with `pinned_until >= now` is never evicted. One column covers both
   "being built" and "in a session", so there is one rule rather than two.
2. Eviction is atomic: `DELETE ... WHERE soniox_voice_id = ? AND pinned_until
   < ?`, then check `changes` — never SELECT-then-DELETE, or two concurrent
   `ensure` calls pick the same victim. Same idiom as
   `SessionLeaseService.acquire`.
3. Every `ensure` touches `last_used_at`, whether it pre-warms or pins.

### 2. The pin lifecycle

The pin window cannot be "the session duration": that number is derived from
the wallet balance inside `sessionKeyHandler` (`routes/soniox.ts:34`,
`min(3600, max(60, balance/rate))`) and exists nowhere else. Copying that
computation into the voice endpoints would duplicate billing logic in a place
that has nothing to do with billing.

Instead, mirror what the lease already does — a two-phase TTL:

- **Phase one — `ensure(pin=1)`**, before Start, when no lease exists yet:
  `pinned_until = now + KEY_START_WINDOW_S*1000 + LEASE_MARGIN_MS` (75 s).
  Same expression and same constants as `SessionLeaseService.acquire`'s
  `initialExpiry`, for the same reason: it must cover "voice is ready" through
  session-key to socket-up.
- **Phase two — the existing `session-started` endpoint**: raise
  `pinned_until` to the account's lease row's `expires_at`. Read it, never
  recompute it. The slot's protection window and the session's billing window
  then share one clock and cannot drift.

`LEASE_MARGIN_MS` is the existing 15 s constant (`config/soniox.ts:45`,
*"Slack added to a lease's deterministic expiry"*): it absorbs client/server
clock skew and the gap between computing an expiry and the socket actually
opening.

The build window gets its own constant even though it evaluates to the same
75 s today (`waitUntilReady`'s 60 s timeout + `LEASE_MARGIN_MS`). It bounds a
different thing — a Soniox build, not a socket handshake — and `config/soniox.ts`
already made exactly this call for `MAX_SESSION_S` vs `TTS_KEY_MAX_TTL_S`,
whose comment warns that merging two coincidentally-equal constants silently
breaks when one of them moves.

**Why no heartbeat.** `max_duration_s` is a ceiling, not a prediction: a user
with a large balance who talks for three minutes and then force-quits would
hold a slot for nearly an hour. A heartbeat is the standard fix, but this
codebase already owns a better signal. Soniox usage logs appear only after a
session ends (measured 2–4.5 s), which makes "a log exists" un-forgeable proof
that the session is over — `soniox-reconcile.ts:451` already releases leases on
exactly that basis. Slots ride along: **when a sweep releases an account's
lease, it unpins that account's slot too.**

What makes this sufficient is that a leaked pin only hurts when the pool is
contended, and contention is the trigger that heals it: before returning
`pool_exhausted`, `ensure` pokes the reconciler with `blocked: true` — the same
move `sessionKeyHandler` already makes on a lease 409 (`routes/soniox.ts:205`)
— which sweeps, proves the dead sessions dead, and frees their slots within
seconds. When nobody is contending, a stale pin costs nothing.

A heartbeat would also be *weaker*: a lying client can hold a slot forever by
continuing to send one, which the usage-log path structurally cannot do.

Three layers, in order: `session-end` (immediate, trusted because lying only
hurts the liar — the same argument `markStarted` documents), the reconciler
(un-forgeable, contention-triggered), `pinned_until` (backstop for a reconciler
outage).

### 3. Endpoints

A new file, `sokuji-backend/src/routes/soniox-voices.ts`, mounted at
`/soniox/voices`. Not added to `routes/soniox.ts`: that file is already 390+
lines carrying lease acquisition, concurrency ceilings, dual-key minting and
409 retries, and voice lifecycle is a different concern.

| Endpoint | Request | Response |
|---|---|---|
| `GET /mine` | — | `{ voice: null }` or `{ voice: { voiceId, status, createdAt } }`. `status` is read through to Soniox (`GET /v1/voices/{id}`) rather than cached in our row — the row would go stale against a build that finishes, fails, or is deleted out of band, and a 404 here is exactly the signal that the slot must be rebuilt |
| `POST /ensure` | multipart: `pin` (`0`/`1`), `clip` (file, optional) | `200 { voiceId, status: 'ready' }` — slot live; `last_used_at` touched, pin applied if asked<br>`200 { voiceId, status: 'processing' }` — created or still building; client polls `GET /mine`<br>`409 { error: 'clip_required' }`<br>`409 { error: 'pool_exhausted', retryAfterMs }` — reconciler poked first<br>`502` — Soniox create failed |
| `DELETE /mine` | — | deletes at Soniox and drops the row; `409` while pinned — a voice cannot be pulled out from under a live session |

`ensure` is idempotent for a warm slot: it only refreshes `last_used_at`.

It returns as soon as the voice exists rather than blocking ~10 s for `ready`,
and the client polls — which reuses the polling shape `waitUntilReady` already
implements on the frontend.

Two existing handlers each gain a few lines (`session-started` raises the pin,
`session-end` clears it) and the reconciler gains one port. No new lifecycle
endpoints.

### 4. Service layer

`VoiceSlotService`, shaped after `SessionLeaseService`: `ensure`, `pin`,
`unpin`, `evictLru`, `release`. Pure D1, no HTTP, so the allocator — the part
most worth testing — is testable directly.

### 5. Frontend

**Clip storage.** A **separate** IndexedDB database (`sokuji-voice-clip`), not
a new store in `sokuji-models`: raising that database's version blanks the
Models UI on any older branch sharing the browser profile, which has bitten
this project before. One record: `{ blob, createdAt }`.

**The seam.** `SonioxVoiceSection` currently constructs a `SonioxVoicesClient`
inside itself from `settings.apiKey`, with `managed` short-circuiting it to
`null`. Lift that out: the section takes a source, and stops knowing where
voices come from.

```ts
interface VoiceLibrarySource {
  list(): Promise<SonioxVoice[]>;
  create(name: string, clip: Blob): Promise<SonioxVoice>;
  delete(id: string): Promise<void>;
  waitUntilReady(id: string): Promise<SonioxVoice>;
}
```

`SonioxVoicesClient` already satisfies it. `ManagedVoiceSource` implements it
against the endpoints above and returns a zero-or-one-element list, so the
section's list UI is unchanged.

**The stored voice id is not stable.** `settings.voice` holds the Soniox UUID,
exactly as it does for a BYOK clone — but a managed slot that is evicted and
later rebuilt comes back with a *different* UUID. Every `ensure` response is
therefore authoritative: whenever it returns a `voiceId` that differs from the
stored one, the client writes the new value through `onUpdate({ voice })`
before using it. Nothing else in the pipeline needs to change, because
`buildSessionConfig` and the TTS wire treat `voice` as an opaque string.

**Preparing the voice at Start.** In `connectConversation`, after the gate
allows the session and before `connect()`: `ensure(pin=1)`, poll to `ready`,
show progress.

This does **not** belong in `computeStartGate`. That function is pure and is
called by the subtitle window, a sibling React tree; an async, uploading,
ten-second side effect inside it would destroy the property that lets both
surfaces share one answer.

**The `pool_exhausted` notice is appended after `connect()` returns**, never
before: `connectConversation` resets the rendered list, so anything appended
earlier is wiped. Only items the *client* holds survive that reset — the trap
PR #383 documented.

### 6. Consent

Reuse `SonioxCloneConfirmModal` and its mandatory checkbox (PR #372). The
wording needs a managed variant: the recording is sent to Kizuna AI and passed
on to Soniox to build the voice, and is **not stored on our servers**. One new
locale key across all 30 catalogs.

## Failure paths

| Situation | Behaviour |
|---|---|
| Soniox returns `voice_failed` (terminal) | Prompt to re-record; BYOK already maps this code |
| `pool_exhausted` at Start | Built-in voice; explanation appended after connect |
| No clip on this device | `clip_required` → offer to record here |
| Voice deleted at Soniox out of band | Next `ensure` 404s and rebuilds from the local clip |
| Connect slower than 75 s, slot evicted before `session-started` | TTS gets `voice_not_found`; the existing `handleTtsError` already reports that spoken output stopped while transcription continues. Not fatal |
| Upload fails / offline | `ensure` errors; Start aborts with a retry, or the user picks a built-in |
| Account deleted mid-session | `afterDelete` removes the voice; TTS degrades. Rare, accepted |
| Reconciler unavailable | `pinned_until` backstop |

## Testing

`VoiceSlotService` against **real `node:sqlite`**, following
`session-lease.sqlite.test.ts` — a fake database hides SQL bugs, and the suite
must *fail* rather than skip on Node < 22:

- allocation into an empty pool
- allocation when full evicts the oldest unpinned row
- allocation refuses when all 20 are pinned
- **concurrent allocation: exactly one wins** (the atomic CAS)
- both pin phases, and unpin
- account deletion drops the row and the Soniox voice

Route level (mirroring `soniox.test.ts`): authentication required,
`clip_required`, and that `pool_exhausted` really pokes the reconciler.

Reconciler: releasing a lease also unpins that account's slot.

Frontend: clip storage round-trip; `ManagedVoiceSource` satisfies
`VoiceLibrarySource`; the Start-preparation step's three outcomes (warm,
building→ready, pool-exhausted fallback); and a **BYOK regression pass** — the
seam change is the riskiest frontend edit here.

## Not doing

Heartbeats; cross-device clip sync; more than one voice per account; voice
rename (no API — the BYOK design already declined it); an admin UI for the
pool.

## Known limitations

- **20 concurrent cloned-voice sessions is the ceiling.** The 21st gets a
  built-in voice with an explanation. Raising it means asking Soniox for a
  larger quota; nothing in this design changes if that number moves.
- **A voice is only rebuildable from a device holding the clip.** Warm slots
  work anywhere the user signs in; a cold slot on a clip-less device needs a
  fresh recording there. This follows from storing the clip client-side.
- **The build takes ~10 s and cannot be hidden** when a session starts cold —
  only moved off the critical path by pre-warming at selection.
