# Kizuna AI Managed Qwen LiveTranslate — Design

**Date**: 2026-10-17
**Status**: Approach agreed. Worked out in chat between 2026-10-14 and 2026-10-17 and backed by live
probes; the owner answered the open decisions on 2026-10-17 ("Owner's rulings", folded in below).
**Scope**: a managed (Kizuna-billed) twin of the own-key provider `qwen_livetranslate`. The backend
lends Alibaba credentials for each session, the device still dials Alibaba directly, and the backend
learns each session's usage from Alibaba's request log and charges the user's wallet.
**Repos**: `kizuna-ai-lab/sokuji` (the provider, its lease and the adapter's report) and
`kizuna-ai-lab/sokuji-backend` (the lease routes, key slots, reconciliation, billing).
**Related**: `2026-10-13-qwen-livetranslate-provider-design.md` (the own-key provider this composes,
with the keepalive, server-cut and quiet rules of #637); `2026-09-22-client-contract-design.md`
("Managed twins are composition"); managed Soniox — sokuji `src/providers/soniox/kizuna.ts` and
`lease.ts`, sokuji-backend `src/routes/soniox.ts`, `src/services/session-lease.ts`,
`src/durable-objects/SonioxReconcilerDO.ts`, `src/services/billing-service.ts` (read on its
`origin/main` of 2026-10-14).
**Evidence**: live probes from 2026-10-13 to 2026-10-17 on the owner's Alibaba Cloud international
account (a QwenCloud login is the same account), first with the root AccessKey and then with a RAM
user's; the Alibaba Cloud Japan account manager's answers of 2026-10-15 and 2026-10-16. The probe
scripts were throwaway; the findings are below.

## Summary

A signed-in user picks **Kizuna AI Qwen** and needs no Alibaba key. At Start the backend takes the
account's one session lease, picks a free key from a small pool of Kizuna keys, mints a 60-second
temporary token from it and hands the token to the client. Both legs dial QwenCloud with that token,
exactly as the own-key provider dials with a user's key; no audio passes through Kizuna. Each leg
reports the session id Alibaba gave it (`sess_…`) to the backend. A reconciler reads Alibaba's
per-request log with a RAM AccessKey, finds every session's row — by the reported id, or, when a
client reported nothing, by the key and the start time that only that lease's token could have
produced — and charges the session's tokens at cost × K to the user's wallet.

**Out of scope:**
- relaying audio (it must not pass through Kizuna);
- the Beijing region and mainland keys;
- WebRTC or AOQ transports;
- cutting a running session off from the server side (Alibaba offers no way; see Constraints);
- face-to-face, image input, pre-created cloned voices (as for the own-key provider).

## Constraints (probed)

| Topic | What holds |
|---|---|
| Audio path | Audio must not be addressed to Kizuna (the privacy claim; "the relay must go"). The device dials Alibaba. |
| Device credentials | `POST https://maas.qwencloudapi.com/api/v1/tokens?expire_in_seconds=60` with a key returns `{token: "st-…", expires_at}`. Asked for less, it grants about 60 s. The token inherits the key's model scope, can open several sessions while valid, and cannot be revoked. A session outlives its token. |
| No server cutoff | Disabling, resetting or deleting the parent key never ends a live session (watched for 60 s after each). Disable and delete refuse new dials, outstanding tokens included; reset does not (old tokens still dial). A re-enabled key's old tokens work again. Reset keeps the key's id. |
| Attribution | Nothing the client or the token mint sends reaches the log: no pass-through field, no custom header or query. A token's sessions log the parent key's `apikey_id`. The one per-session id in the log is `task_uuid`, the client's `sess_…` from `session.created` (confirmed by Alibaba's product team, 2026-10-16). |
| Usage source | `listModelLogs`, called as `bailian` 2023-06-01 `IntlBroadScopeAspnGateway` (RPC, V3-signed, `bailian.ap-southeast-1.aliyuncs.com`), undocumented. A row appears about 2–60 s after its session ends, with `request_id`, `task_uuid`, `apikey_id`, `start_unix_timestamp` (ms, session start), `duration`, `usage` (text and audio × input and output), `status_code` (400 is normal for realtime), `workspace_id`, `client_ip`. One workspace per call (`cornerstoneParam.switchAgent` = its tenant id); pages of ≤ 50; 14-day retention. `taskUuid` is a filter field but rejects `sess_…` ("taskUuid illegal"); `modelRequestId` filters. |
| Access to it | A RAM user with `AliyunBailianReadOnlyAccess` that is a member of the workspace with the 模型日志 permission. No OAuth. |
| Official cross-check | BSS `DescribeInstanceBill` (DAILY, `IsBillingItem=true`) and ModelStudio `GetBillingTrend` (`groupBy API_KEY_ID`) show a key's day about 7.5–8 min after a session ends; amounts are 0 while free quota covers usage. |
| Rate limits | 10 RPM and 100K TPM per root account per model, shared by every workspace and key. A request is a session start (counted at `session.update`), in calendar minutes; turns do not count. Raised only through the account manager. |
| Session lifetime | Closed after 300 s with nothing sent (`1007 Idle timeout!`); the adapter's keepalive (#637) prevents it. No 600 s cap in 22 minutes on any host; the true maximum is unknown (the docs say 3600 s for the workspace host). |
| Region | LiveTranslate exists only in Singapore and Beijing; Beijing needs mainland identity verification. |
| Price | Singapore, USD per 1M tokens: audio in 7.5, text out 20, audio out 30, image in 0.55. Input text is not billed (the fixed 47 text tokens per session never reach the bill). Audio in is 7 tokens per second of each turn's window, audio out 12.5 per second of speech. |
| Keys | ModelStudio 2026-02-10 `CreateApiKey` can limit a key to listed models (`auth.modelAccessScope`): another model answers 403. "Each workspace supports up to 20 API keys", and an account has up to 20 workspaces (QwenCloud's workspace guide). |
| Lease release, managed Soniox | Read on sokuji-backend `origin/main` (1253c2f): `/session-end` only sets `end_signalled_at` and nudges the reconciler, which then retries on a 3 / 6 / 12 s ladder. A started lease is released once every started stream's usage log has landed (`noteStreamEnded`); the clock frees the account at `expires_at` — 60 s + a 15 s margin for a lease that never started, the grant + 15 s otherwise. |

## Decisions

- **M1 Composition.** `managed(qwenLiveTranslateProvider, …)` with id `kizunaai_qwen` and vendor
  `Qwen`: the own-key provider's languages, voices, turns, builder and adapter, the sign-in in place
  of a key, and a lease (spec 2026-09-22, "Managed twins are composition").
- **M2 Storefront.** QwenCloud international only (`maas.qwencloudapi.com`, the Singapore account).
  The grant names the endpoint, so the adapter never detects one.
- **M3 One token per lease.** Both legs dial with the same token while it is valid.
- **M4 Attribution.** The reported `task_uuid` is the primary match. The slot window is the safety net
  that still attributes a session nobody reported. The two must agree.
- **M5 Key slots.** A pool of model-scoped keys in one dedicated workspace. A slot belongs to one
  lease from the mint until its token expires (plus a margin), then returns to the pool.
- **M6 Usage truth.** `listModelLogs` through a RAM AccessKey; the official per-key bill once a day
  as a cross-check.
- **M7 Price.** Each row's billable tokens at Alibaba's price, × `REVENUE_COEFFICIENT_K` = 2.0 (ruling
  1), the managed Soniox pricing mode `cost_times_k`; the per-hour price is shown as Kizuna Soniox's,
  from `/api/pricing`.
- **M8 Budget.** Managed Soniox's pattern: a worst-case rate sets the granted duration (at most
  3600 s, ruling 9) and the start floor; the client ends the run at the grant; the post-paid wallet
  takes any overrun.
- **M9 Platforms.** As the own-key provider: the desktop app and the extension (the header seam).
  Neither provider has a web build; one made later would dial with the undocumented `?api_key=`
  query (ruling 3).
- **M10 Separation.** The Qwen lease shares `session_leases`' one-lease-per-account lock and nothing
  Soniox-specific; Soniox's reconciler and counters ignore Qwen leases.
- **M11 Trial credit.** The trial credit may pay for managed Qwen (ruling 2).
- **M12 Unreported sessions.** A session attributed by window is recorded against its lease and
  account for audit. Nothing is shown to the user and nothing happens automatically: a missing report
  may be the network or our own bug, not the user (ruling 6).
- **M13 Lease release.** As managed Soniox: the log row that proves a session ended releases the
  lease, so it frees seconds to about a minute after the session ends (ruling 8; section 5).
- **M14 Release gate.** The twin is `flagged` (ruling 7).

## 1. Flow

1. The user starts. The client's lease calls `POST /api/qwen/session-key`.
2. The backend checks the sign-in, the wallet and the budget, takes the account's lease (provider
   `qwen`), takes a free slot, mints a token with the slot's key, records the slot window, and answers
   with the token.
3. Each leg dials `wss://maas.qwencloudapi.com/api-ws/v1/realtime` with the token through the
   header seam. Everything after that is the own-key adapter.
4. On `session.created` the adapter hands the session id to the lease port; the lease calls
   `POST /api/qwen/session-started` with the leg and the id.
5. The client ends the run at the granted duration, or when the user stops, and calls
   `POST /api/qwen/session-end`.
6. The reconciler, running while any Qwen lease is open or still awaits a row, reads the log every
   30 s, and every 5 s while a `session-end` waits on its rows; it attributes each new row to a
   lease and charges it.
7. The lease is released once every reported session has its row, or by the clock (section 5). The
   slot returned to the pool already, at its window's end.
8. Once a day the reconciler compares each slot key's charged provider cost with the official bill.

## 2. Key slots

**Pool.** 20 keys, one workspace's limit (ruling 5), in a dedicated workspace for managed Qwen.
Each key is created with `auth.type = Custom` and `modelAccessScope.accessibleModels =
["qwen3.8-livetranslate-flash-realtime"]`, so a leaked slot key or token calls nothing else. The
keys' secrets are backend secrets; D1 holds only their ids and holds.

**Hold.** `session-key` takes a free slot atomically (`held_until <= now`) and holds it for the
window: from the mint request's start to the token's `expires_at`, both on Alibaba's clock (the mint
response's `resp-start-time` header and its body), widened by a 5 s margin, the same clock that stamps
`start_unix_timestamp`. After the window the slot is free again, whatever the sessions it started are
still doing.

**Why the window is enough.** A session can only start while its token is valid, and the log stamps
each session with its start. So a row under a slot's key whose start falls inside one lease's window
belongs to that lease and to no other, however long the session ran. (The earlier slot idea, built on
the minute bill, which stamps a session by its end, needed a slot for the whole session; the log's
start time removes that.)

**Capacity.** A slot is busy about 70 s per lease. Sessions start at most 10 times a minute account-wide
(the RPM), so about 12 slots carry the full rate; 20 leave room. With every slot held, `session-key`
answers 503 `qwen_busy` with a retry hint. A raised RPM is met with more keys, or a second workspace
(the reconciler then reads each workspace with its own `switchAgent`).

**Keys over time.** The owner creates the keys by hand in the console (ruling 4); the RAM user gets no
key management, so the backend never creates, resets or disables a key. A key suspected of leaking is
reset by hand: its id, and so its slot, stays; a disabled key is skipped by the picker.

## 3. Backend lease routes (`/api/qwen`)

**`POST /session-key`** `{ legs: ['speaker'] | ['speaker', 'participant'], speech: { speaker, participant } }`
- Order, as Soniox's: sign-in (401) → wallet (403 frozen) → budget from the balance and the rate
  (402 with `requiredMicroUsd`, `balanceMicroUsd`) → lease (409 `active_lease` with `retryAfterMs`)
  → slot (503 `qwen_busy`) → mint (502 on failure; the slot and the lease are released).
- Answer: `{ leaseId, endpoint: 'intl', apiKey: '<st- token>', expiresAt, maxSessionDurationSeconds,
  budgetMicroUsd, rateUsdPerHour }`. The token is the only secret in it; the slot's key never leaves
  the backend.

**`POST /session-started`** `{ leaseId, leg, taskUuid }`
- Records `qwen_sessions(task_uuid PK, lease_id, account_id, leg, reported_at)`. Idempotent for the
  same lease; a `task_uuid` already bound to another lease is refused (409) and alarmed.
- `task_uuid` is Alibaba's random `sess_…`: a client cannot report another user's session, and the
  account is the authenticated one, never a field.

**`POST /session-end`** `{ leaseId }` — a hint, as Soniox's: it sets `end_signalled_at` and pokes the
reconciler into fast polling; it releases nothing by itself.

## 4. Client (`sokuji`)

- **`src/providers/qwen_livetranslate/kizuna.ts`** — the twin: `managed(qwenLiveTranslateProvider,
  { id: 'kizunaai_qwen', vendor: 'Qwen', settingsKey: 'kizunaQwen', Settings: <managed flavour>,
  signedOut, session: { acquire: createQwenLease(), minimumBalance } })`. The managed Settings view
  drops the key field and the storefront line.
- **`QwenCredentials.lease?: QwenLeasePort`**, as `SonioxLeasePort`: `sessionCreated(id: string)`.
  An own key carries none.
- **Adapter.** One addition: on `session.created` it calls `credentials.lease?.sessionCreated(id)`.
  The grant's `endpoint` is in the config, so no detection runs. Everything else — turns, keepalive,
  server cuts, quiet trimming — is the own-key adapter's. The session side still reaches no store and
  no reporter (`sessionSide.consistency.test.ts`).
- **`src/providers/qwen_livetranslate/lease.ts`** — modelled on Soniox's: acquire calls
  `session-key` within a bound (a 409 retried once), hands each leg `{ apiKey: token, lease port }`
  and the endpoint, arms the grant's end on the run's clock (`budget_exhausted`), reports each
  leg's `sessionCreated` to `session-started` (retried a few times, `keepalive` fetch), and releases
  with `session-end`.
- **Registry and copy.** One line in `src/providers/registry.ts` beside Kizuna Soniox, with
  `flagged: true` (ruling 7): `isPresent` offers it only where `isKizunaAIEnabled()` holds, and then
  in every development build, but in a release only once `VITE_ENABLED_PROVIDERS` lists
  `kizunaai_qwen`. `providers.kizunaai_qwen.name` and `.description` in the 30 catalogs. The
  extension manifest already lists the QwenCloud hosts.

## 5. Reconciliation (backend)

**`QwenReconcilerDO`** (a singleton, alarm-driven, poked by the routes and the minute cron) runs while
any Qwen lease is open or still awaits a row.

**Reading.** Every 30 s; and every 5 s while a lease that signalled `session-end` still lacks a
reported session's row, for at most 90 s after the signal (a row lands 2–60 s after its session
ends), after which the 30 s cadence resumes. Soniox backs off (3 / 6 / 12 s) because each of its
sweeps spends a per-minute Soniox API budget; one `listModelLogs` call lists a whole workspace's
window and so serves every waiting lease at once, so a flat interval costs the same however many
users are waiting: at most 12 calls a minute per workspace. Each tick, for each workspace of the
pool: `listModelLogs` over
`[watermark − 2 min, now]`, paged by 50, model `qwen3.8-livetranslate-flash-realtime`. New rows,
deduplicated by `request_id`, go to `qwen_usage_logs(request_id PK, task_uuid, apikey_id, start_ms,
duration_ms, usage, lease_id, account_id, attributed_by, charged_at)`. A failing call is retried with
backoff; a gateway that keeps failing (it is undocumented) raises an alarm and stops new leases.

**Attributing** each row, in order:
1. **By `task_uuid`** — a reported session: its lease. The row's `apikey_id` and start must fit that
   lease's slot window; when they do not, the row is still charged to that lease (the id is
   unforgeable) and a tamper alarm is raised.
2. **By slot window** — no report: the lease whose window on that `apikey_id` contains the row's start
   (exactly one can). The row is marked `attributed_by = 'window'`, which is the audit record of an
   unreported session: the admin pages count them per lease and account; the user sees nothing and
   nothing is done automatically (M12).
3. **Neither** — a slot key used outside every window, i.e. leaked: alarm; the owner disables or
   resets the key by hand.

A row with no `usage` (a session that sent nothing) is kept and charges nothing.

**Charging.** Provider cost = audio-in tokens × 7.5 + text-out tokens × 20 + audio-out tokens × 30
(+ image-in × 0.55) per million; input text is not billed. `BillingService.charge` with provider
`qwen`, pricing `cost_times_k`, `providerCostMicroUsd`, `externalId = request_id` (idempotent),
`sessionRef = account:lease`. The wallet is post-paid, as for Soniox: it can go negative, and a
negative or frozen wallet refuses the next `session-key`.

**Releasing the lease** (M13). The lease, and with it the account's one-lease lock, is released:
- once every reported session has its row. A row is written only when its session has ended, so it
  is the proof, as Soniox's usage log is; `session-end` starts the 5 s polling, so a normal stop
  frees the account at most 5 s after the row lands, seconds to about a minute after the stop;
- by the clock, as Soniox's: a lease with no reported session at its token's expiry + 15 s (no
  session can start after it), any lease at `expires_at` (the grant + 15 s).
Billing does not wait on the lease. A row that lands after the release — a session run past its grant,
a leg whose report never arrived — is still attributed by `task_uuid` or window and charged; the
reconciler keeps looking for a reported session's row for 10 minutes past the lease's expiry, Soniox's
`UNRECONCILED_LEASE_MAX_AGE_MS`. A stop and restart inside the row's delay meets the 409 with its
`retryAfterMs`, which the client waits out, as for Soniox.

**Daily cross-check.** For each slot key and day, the charged provider cost against BSS
`DescribeInstanceBill` (DAILY, `IsBillingItem=true`); a drift beyond rounding raises an alarm.

## 6. Budget, price and exposure

**Rate.** Raw worst case per leg and hour: audio in $0.19 (7 tokens/s), text out about $0.29 (taken
as 4 tokens/s), audio out $1.35 (12.5 tokens/s). A speaking leg ≈ $1.83/h, a text-only leg ≈ $0.48/h,
× K for the user. The granted duration is the balance over the summed rate, capped at 3600 s per
grant (ruling 9; with or without speech, until Qwen's own maximum is known); the start floor is a
minute of it.

**What a client can do that it should not.** Run a session past the grant, or open more sessions
while the token is valid (up to the account's RPM), or not report. None of it escapes the bill:
every session lands in the log and is attributed by `task_uuid` or by window. The cost is that the
charge comes after the session ends, so the wallet can go negative. Audio sent faster than real time
is bounded only by the account's TPM, which one abuser could use up for everyone; the reconciler
flags a lease whose tokens per second exceed real time.

**What it cannot do.** Bill another user (`task_uuid` is unforgeable and the account is the
authenticated one), call another model (the key's scope), or reach the slot key (it never leaves the
backend).

## 7. Backend changes (`sokuji-backend`)

- `session-lease`: a provider filter in `countActive`, in the reconciler's gate and in
  `releaseSatisfiedOrExpired`, so Soniox's reconciler and stream counters ignore Qwen leases. The
  Soniox masks and roles stay Soniox's.
- New: `src/routes/qwen.ts`; `src/services/qwen-slots.ts`; `src/services/qwen-logs.ts` (the V3-signed
  gateway client); `src/durable-objects/QwenReconcilerDO.ts`; D1 tables `qwen_key_slots`,
  `qwen_sessions`, `qwen_usage_logs`; Qwen rates in `src/services/pricing.ts` and a `/api/pricing`
  entry; secrets for the RAM AccessKey and the slot keys; the cron's poke.
- Admin: the leases page already shows a provider; the ledger shows Qwen charges by their provider;
  a count of window-attributed (unreported) sessions per lease and account, for audit.

## 8. Operations

- A dedicated workspace for the pool, its 20 keys created by the owner in the console, each scoped
  to `qwen3.8-livetranslate-flash-realtime`; the RAM user (`AliyunBailianReadOnlyAccess`,
  `AliyunBSSReadOnlyAccess`) a member of it with 模型日志 only — the least access probed to work.
- The RPM increase applied for through the account manager, with the expected concurrent sessions
  and average length.
- The root AccessKey that appeared in chat deleted; the RAM AccessKey rotated before production.
- Alarms: tamper, unattributed rows, reconciler lag, gateway errors, bill drift. Unreported sessions
  raise no alarm; they are audited from the admin count.

## 9. Testing

- Backend: slot hold and release under concurrency; the window from a mint response; each
  attribution path, tamper and leak included; the price (input text excluded); idempotent charges;
  the reconciler's paging, watermark and per-workspace reads; the 5 s polling after a `session-end`,
  ended by the last row or by its 90 s cap; the lease released by its last row, by
  the token's expiry with nothing reported and by `expires_at`, and a row after the release still
  charged; Soniox's reconciler ignoring Qwen leases.
- Client: the lease (grant end, refusals in words, `session-started` retries, release); the adapter
  reporting the id through the port; the twin's registry and conformance tests.
- Live, in a development build: two accounts at once; a client patched to report nothing, attributed
  by window; a session run past its grant, charged when it ends; after the free quota, the daily
  cross-check against the bill.

## 10. Rejected

- **Relay.** It breaks the privacy claim.
- **WebRTC with the SDP made by the backend.** Every session would be the backend's, but no
  backend-held id reaches the log either, it is a new transport, and it still cannot cut a session.
- **A key per user.** Exact, but capped at 20 keys a workspace and 20 workspaces, and it needs key
  management.
- **The CLI's OAuth gateway.** A 48-hour token with no refresh and no revoke; the AccessKey route
  replaces it.
- **The official bill alone.** Per key and per day; minute rows only in the daily OSS file.
- **Matching by time alone** (the owner's ruling: 靠时间是不保险的). Time is used here only inside a
  slot window, where one lease alone could have started a session.

## Owner's rulings (2026-10-17)

1. **Price** — K = 2.0.
2. **Trial credit** — the trial credit may pay for managed Qwen.
3. **Web build** — there is none; a web build made later would use the `?api_key=` query.
4. **Keys** — the owner creates the pool by hand.
5. **Pool size** — as many as one workspace allows: 20.
6. **Unreported sessions** — recorded in the backend for a later audit, never shown to the user: a
   missing report may be the network or our own bug rather than the user. Whether to act on it is
   decided after an audit.
7. **Release** — `flagged`.
8. **Lease release** — as Soniox's, which frees soon after a session ends: the row proves the end.
9. **Grant cap** — 3600 s for now.

## Known unknowns

- The gateway is undocumented and may change without notice.
- Qwen's maximum session length.
- Alibaba's own answer on what a request is and whether concurrency is capped (we measured: a request
  is a session start).
