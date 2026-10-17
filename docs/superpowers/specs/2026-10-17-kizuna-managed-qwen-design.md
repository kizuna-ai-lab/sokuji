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
per-request log with a RAM AccessKey and attributes every row by the key and the start time, which
only one lease's token could have produced, using the reported ids (the session's `sess_…` and its
handshake's request id) to find the row and to check the answer; it charges the session's tokens at cost × K to the user's wallet.

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
| Usage source | `listModelLogs`, called as `bailian` 2023-06-01 `IntlBroadScopeAspnGateway` (RPC, V3-signed, `bailian.ap-southeast-1.aliyuncs.com`), undocumented. A row appears about 2–60 s after its session ends, with `request_id`, `task_uuid`, `apikey_id`, `start_unix_timestamp` (ms, session start), `duration`, `usage` (text and audio × input and output), `status_code` (400 is normal for realtime), `workspace_id`, `client_ip`. One workspace per call (`cornerstoneParam.switchAgent` = its tenant id); pages of ≤ 50; 14-day retention. `taskUuid` is a filter field but rejects `sess_…` ("taskUuid illegal"); `modelRequestId` filters. The time range filters on when a row is written — its session's end — not on its start: three 10–11-minute sessions were each listed in a window around their end and in none around their start (probed 2026-10-17). So reading `[watermark − 2 min, now]` sees a long session when it ends, and attribution still uses the row's own start. |
| Its call rate | No throttling seen. Probed 2026-10-17 with the RAM AccessKey over the reconciler's own query ([now − 2 min, now], one page of 50): every 5 s for an hour, 720/720 OK; every 2 s for an hour, 1800/1800 OK (140 of those pages held rows). Latency p50 ≈ 450–500 ms, p95 ≈ 1 s, max 1.6 s, flat across both hours. The 5 s polling of section 5 is well inside it; faster was not tried (the owner: no use for it). |
| Workspaces in the log | Each `listModelLogs` call reads one workspace: `cornerstoneParam.switchAgent` = the workspace's tenant id from ModelStudio `ListWorkspaces` (the default workspace answers without it too). A row carries `workspace_id` as the Alibaba id (`ws-ilmjk0mva2djka6n`, the default workspace, tenant 1683763) beside `apikey_id`; another workspace's rows (sokuji-test, tenant 1690620) appear only under its own `switchAgent` (probed 2026-10-16 and 10-17). New workspaces can call the 3.8 model at once. |
| Access to it | A RAM user with `AliyunBailianReadOnlyAccess` that is a member of the workspace with the 模型日志 permission. No OAuth. |
| Official cross-check | BSS `DescribeInstanceBill` (DAILY, `IsBillingItem=true`) and ModelStudio `GetBillingTrend` (`groupBy API_KEY_ID`) show a key's day about 7.5–8 min after a session ends; amounts are 0 while free quota covers usage. |
| Rate limits | 10 RPM and 100K TPM per root account per model, shared by every workspace and key. A request is a session start (counted at `session.update`), in calendar minutes; turns do not count. Raised only through the account manager. |
| Session lifetime | Closed after 300 s with nothing sent (`1007 Idle timeout!`); the adapter's keepalive (#637) prevents it. No 600 s cap in 22 minutes on any host; the true maximum is unknown (the docs say 3600 s for the workspace host). |
| Region | LiveTranslate exists only in Singapore and Beijing; Beijing needs mainland identity verification. |
| Price | Singapore, USD per 1M tokens: audio in 7.5, text out 20, audio out 30, image in 0.55. Input text is not billed (the fixed 47 text tokens per session never reach the bill). Audio in is 7 tokens per second of each turn's window, audio out 12.5 per second of speech. |
| Keys | ModelStudio 2026-02-10 `CreateApiKey` can limit a key to listed models (`auth.modelAccessScope`): another model answers 403. "Each workspace supports up to 20 API keys", and an account has up to 20 workspaces (QwenCloud's workspace guide). |
| Row start | `start_unix_timestamp` is the WebSocket handshake, when the token is checked, on Alibaba's clock — not `session.update`. Probed 2026-10-17 with a 60 s token and no audio: A updated 20 s after its handshake; B dialled 5 s before the token expired and updated 15 s after it. Both got `session.updated`; both rows start 40 ms before the local 101 (the local clock ran ~43 ms ahead), B's 4.8 s before the expiry; `request_id` = the 101's `x-request-id`; no usage. So no client can push a session's start out of its token's validity. |
| One token, two sessions | Probed 2026-10-17 (no audio): two sessions dialled together with one 60 s token both reached `session.updated` within 10 ms of each other and stayed open together for 10 s; the log holds two rows, each with its own `task_uuid` and `request_id` (each = its own 101's `x-request-id`), both starting 39 ms before their local 101 and 58.8 s before the expiry. |
| Request id | A row's `request_id` is the `x-request-id` header of its WebSocket's 101 response (probed 2026-10-15, and again on both sessions of the 2026-10-17 probe), and `listModelLogs` filters on it exactly (`modelRequestId`). It is a second random id of the same connection, beside `task_uuid`: `task_uuid` arrives in the `session.created` body, `request_id` only in the handshake's response headers, which a browser's `WebSocket` does not expose — the desktop app's main process (`webRequest.onHeadersReceived`, whose one listener per session Better Auth already holds, `electron/better-auth-adapter.js`) and the extension's background (`chrome.webRequest.onHeadersReceived`, which needs the `webRequest` permission the manifest lacks) are where the header seam could read it; neither is verified yet. |
| Lease release, managed Soniox | Read on sokuji-backend `origin/main` (1253c2f): `/session-end` only sets `end_signalled_at` and nudges the reconciler, which then retries on a 3 / 6 / 12 s ladder. A started lease is released once every started stream's usage log has landed (`noteStreamEnded`); the clock frees the account at `expires_at` — 60 s + a 15 s margin for a lease that never started, the grant + 15 s otherwise. |

## Decisions

- **M1 Composition.** `managed(qwenLiveTranslateProvider, …)` with id `kizunaai_qwen` and vendor
  `Qwen`: the own-key provider's languages, voices, turns, builder and adapter, the sign-in in place
  of a key, and a lease (spec 2026-09-22, "Managed twins are composition").
- **M2 Storefront.** QwenCloud international only (`maas.qwencloudapi.com`, the Singapore account).
  The grant names the endpoint, so the adapter never detects one.
- **M3 One token per lease.** Both legs dial with the same token while it is valid. The runner opens
  every leg's source — the microphone, and the system audio behind its permission dialog — before it
  acquires a lease (`src/lib/session/run.ts`, Stage 2 Kizuna Soniox ruling 9), so both legs dial
  within seconds of the mint, and one token carries two sessions at once (probed). Managed Soniox
  mints one key per stream because its usage log names only the key's reference; every Qwen session
  has its own row and its own ids, so one token suffices. Neither adapter redials a managed leg (the
  own-key provider's D8), so no token is needed after the start; a redial added later would need a
  fresh token for the same lease.
- **M4 Attribution.** The slot window (the row's `apikey_id` and start) decides: it rests on our own
  records alone, and a row's start is its handshake, inside its token's validity. The report —
  the session's `task_uuid` and its handshake's `request_id`, both of which must match the same row —
  finds the row quickly and checks the answer; a row it does not match, or none, is attributed by the
  window alone (the owner's rulings, 2026-10-17).
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

**Workspaces.** The pool spans workspaces (the owner, 2026-10-17): it starts as one dedicated
workspace of 20 keys (ruling 5), and when keys run short the owner opens another workspace and adds
its keys. Alibaba allows 20 keys a workspace and 20 workspaces an account. A workspace is a row of
`qwen_workspaces`: its Alibaba id (`ws-…`, what a log row carries as `workspace_id`), its tenant id
(`ListWorkspaces`; what `listModelLogs` takes as `cornerstoneParam.switchAgent`), a name, and a
status, active or paused. Every key belongs to one workspace, and a key is known by the pair
(workspace, `apikey_id`) everywhere: in a slot, a window, a row, a charge. The dial host is
`maas.qwencloudapi.com` whatever the workspace; the key carries its workspace. The RPM is per account
and model, shared by every workspace, so a workspace adds slots, not throughput: a slot is busy about
70 s per lease and a lease starts at least one session, so slots ≈ 1.2 × the RPM — 20 keys carry up
to about 17 RPM, and a raise to 100 RPM wants about six workspaces.

**Pool.** Each key is created with `auth.type = Custom` and `modelAccessScope.accessibleModels =
["qwen3.8-livetranslate-flash-realtime"]`, so a leaked slot key or token calls nothing else. The
keys are entered on the admin page (section 7.1), so their secrets live in D1 encrypted (AES-GCM
under a Worker secret, `QWEN_KEY_ENCRYPTION_KEY`) rather than as Worker secrets, which nothing can
write at run time; a copy of the database alone yields no key.

**Hold.** `session-key` takes a free slot atomically (`held_until <= now`) and holds it for the
window: from the mint request's start to the token's `expires_at`, both on Alibaba's clock (the mint
response's `resp-start-time` header and its body), widened by a 5 s margin, the same clock that stamps
`start_unix_timestamp`. After the window the slot is free again, whatever the sessions it started are
still doing.

**Clocks.** Client clocks are never used: they can be off by any amount. The client sends no time at
all, and its only timer, the grant's end, measures elapsed time on its own run clock. Attribution
compares Alibaba's times only — both ends of a window come from the mint response our backend
receives (`resp-start-time`, `expires_at`), and a row's start is stamped by Alibaba's gateway — so
network delay cannot move a row across a window: the token is checked when the handshake reaches the
gateway, the very moment the row records, and a handshake that arrives after the expiry is refused
(401 "API Token is expired"), not logged late. Delay on the backend's mint only widens a window (it
opens at Alibaba's receipt, before the token reaches us). Our server's clock decides one thing, when
a slot is free again (`held_until <= now`); the 5 s margin absorbs its skew against Alibaba's and the
whole-second `expires_at`. Two windows on one key are disjoint on Alibaba's clock when the new mint's
`resp-start-time` lies past the old `expires_at`; the slot picker checks exactly that after each mint
and alarms if it ever fails.

**Why the window is enough.** A session can only start while its token is valid, and the log stamps
each session with its start. So a row under a slot's key whose start falls inside one lease's window
belongs to that lease and to no other, however long the session ran. (The earlier slot idea, built on
the minute bill, which stamps a session by its end, needed a slot for the whole session; the log's
start time removes that.)

**Capacity.** A slot is busy about 70 s per lease. Sessions start at most 10 times a minute account-wide
(the RPM), so about 12 slots carry the full rate; 20 leave room. With every slot held, `session-key`
answers 503 `qwen_busy` with a retry hint. A raised RPM is met with another workspace and its keys.
The picker takes a free key of an active workspace, the least recently issued first, so the load
spreads over keys and workspaces; a paused workspace's keys are skipped.

**Keys over time.** The owner creates the keys by hand in the console (ruling 4) and adds each to the
pool on the admin page; the RAM user gets no key management, so the backend never creates, resets or
disables a key at Alibaba. A key suspected of leaking is reset by hand in the console and its new
secret entered on the page: its id, and so its slot and history, stays. A key the console disabled
or deleted refuses the next mint (401): the picker pauses that slot, records why, alarms, and takes
another. A deleted key's row stays, paused, since windows and charges point at it.

**Every mint is kept.** `qwen_key_windows` holds one row per mint — the slot, its workspace and
`apikey_id`, the lease and account, the window on Alibaba's clock (`opened_at` = `resp-start-time`,
`expires_at`), `held_until`, our server's mint time — indexed on `(workspace_id, apikey_id,
opened_at)`. Attribution looks windows
up there (a row can land after its slot has moved on to the next lease), and the admin page reads it
as each key's issue history.

## 3. Backend lease routes (`/api/qwen`)

**`POST /session-key`** `{ legs: ['speaker'] | ['participant'] | ['speaker', 'participant'], speech: { speaker, participant } }`
- Order, as Soniox's: sign-in (401) → wallet (403 frozen) → budget from the balance and the rate
  (402 with `requiredMicroUsd`, `balanceMicroUsd`) → lease (409 `active_lease` with `retryAfterMs`)
  → slot (503 `qwen_busy`) → mint (502 on failure; the slot and the lease are released).
- Answer: `{ leaseId, endpoint: 'intl', apiKey: '<st- token>', expiresAt, maxSessionDurationSeconds,
  budgetMicroUsd, rateUsdPerHour }`. The token is the only secret in it; the slot's key never leaves
  the backend.

**`POST /session-started`** `{ leaseId, leg, taskUuid, requestId? }`
- Records `qwen_sessions(task_uuid PK, request_id UNIQUE NULL, lease_id, account_id, leg,
  reported_at)`. Idempotent for the same lease; a `task_uuid` or `request_id` already bound to another
  lease is refused (409) and alarmed.
- Both are Alibaba's random ids of one connection: a client cannot report another user's session,
  and the account is the authenticated one, never a field. `requestId` is optional only for a
  platform whose seam cannot read the header (section 4); a report without it is checked on
  `task_uuid` alone.

**`POST /session-end`** `{ leaseId }` — a hint, as Soniox's: it sets `end_signalled_at` and pokes the
reconciler into fast polling; it releases nothing by itself.

## 4. Client (`sokuji`)

- **`src/providers/qwen_livetranslate/kizuna.ts`** — the twin: `managed(qwenLiveTranslateProvider,
  { id: 'kizunaai_qwen', vendor: 'Qwen', settingsKey: 'kizunaQwen', Settings: QwenSettingsView,
  signedOut, flagged: true, session: { acquire: createQwenLease(), minimumBalance } })`. The own-key
  Settings view already shows no key field (`managed()` empties the credential fields) and no
  storefront line (it shows one only for a detected storefront). `managed()` does not inherit a base's
  `flagged`, so it gains a `flagged?: true` override of its own.
- **`QwenCredentials.lease?: QwenLeasePort`**, as `SonioxLeasePort`: `sessionCreated(id: string,
  requestId?: string)`; and **`QwenCredentials.endpoint?: EndpointId`**, the grant's storefront. An
  own key carries neither.
- **The header seam reads `x-request-id`.** Where it sets the upgrade's headers it also reads the
  101's `x-request-id` and hands it to the caller through an optional `onRequestId` callback on the
  seam's options; the platform answers it when the seam clears its rule: Electron's main process in the
  `onHeadersReceived` listener it shares with Better Auth, the extension's background through
  `chrome.webRequest.onHeadersReceived` (`websocket` type; adds the `webRequest` permission — whether
  Chrome asks installed users to approve it again is to be checked before release). The value leaves
  the seam only to the adapter; it never reaches a log. Proving that each platform sees the header on
  the seam's socket is the implementation plan's first task; a platform that does not reports without
  it.
- **Adapter.** One addition: on `session.created` it calls
  `credentials.lease?.sessionCreated(id, requestId)`.
  The grant's `endpoint` reaches it in the credentials, since `build` runs before the lease is
  acquired: the adapter takes `config.endpoint ?? credentials.endpoint` and detects only when neither
  is set, so a managed leg never detects. Everything else — turns, keepalive,
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
users are waiting: at most 12 calls a minute per workspace. **Per workspace:** every read is one
workspace's (`switchAgent` = its tenant id), with its own watermark; the 30 s cadence reads every
workspace with a window still inside the log's 14-day retention, paused ones included, and the 5 s
polling reads only the workspaces of the leases that wait. Calls grow with workspaces (2 a minute
each at rest, 12 while one waits), all under one per-minute budget the reconciler keeps, as Soniox's
does; whether the gateway's own limit is per AccessKey or per workspace is unmeasured beyond one
workspace at 30 a minute. Each tick, for each such workspace: `listModelLogs` over
`[watermark − 2 min, now]`, paged by 50, model `qwen3.8-livetranslate-flash-realtime`. New rows,
deduplicated by `request_id`, go to `qwen_usage_logs(request_id PK, workspace_id, task_uuid,
apikey_id, start_ms, duration_ms, usage, lease_id, account_id, attributed_by, charged_at)`; the
window looked up for a row is the one on its own `(workspace_id, apikey_id)`. A failing call is retried with
backoff; a gateway that keeps failing (it is undocumented) raises an alarm and stops new leases.

**Attributing** each row (M4). Two answers are looked up: the **window** — the lease whose slot window
on the row's `apikey_id` contains its start (at most one can) — and the **report** — the lease that
reported the row's `task_uuid` and `request_id`, if any. A report counts only when both of its ids
match this one row (or its `task_uuid` does, for a report a platform sent without `requestId`); a
report whose two ids point at different rows, or at none, is wrong data: it counts as no report and
is recorded for audit. The window decides; the report checks it:
1. **Both name the same lease** — charge it (`attributed_by = 'both'`).
2. **Window only, no report** — charge the window's lease (`'window'`). This is the audit record of an
   unreported session: the admin pages count them per lease and account; the user sees nothing and
   nothing is done automatically (M12).
3. **They differ, same account** — a client reported its session under another of its own leases (a
   stale lease id, say): charge the window's lease, and record the mismatch for audit.
4. **They differ, different accounts** — a client cannot know another session's `sess_…`, so this
   points at our own records rather than at a client: hold the charge, alarm, and settle it by hand.
   It should never happen.
5. **A report, no window** — the row lies outside every window: a leaked key, or our records are
   wrong. Charge the reporter (a report binds only the reporting account, so it can bill no one
   else) and alarm.
6. **Neither** — a slot key used outside every window and nobody claims it, i.e. leaked: alarm; the
   owner disables or resets the key by hand; nobody is charged.

A row with no `usage` (a session that sent nothing) is kept and charges nothing. A reported
`request_id` also lets the reconciler fetch that one row directly (`modelRequestId`) — for a held
charge, or a row a page boundary hid — instead of listing a window.

**Charging.** Each row is priced by Alibaba's own formula — the owner's ruling: the row's `usage`
already holds every quantity the bill uses — and the result × K is the charge. Provider cost = audio-in
tokens × 7.5 + text-out tokens × 20 + audio-out tokens × 30 (+ image-in × 0.55) USD per million, the
model's official Singapore price; input text is not billed. Each leg's session is its own row and is
priced on its own: a speaking leg's row carries audio out, a text-only leg's does not; the lease's
charge is their sum. Any rounding of Alibaba's own shows up in the daily cross-check, and the formula
follows it. `BillingService.charge` with provider
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
a leg whose report never arrived — is still attributed (section 5's cases) and charged; the
reconciler keeps looking for a reported session's row for 10 minutes past the lease's expiry, Soniox's
`UNRECONCILED_LEASE_MAX_AGE_MS`. A stop and restart inside the row's delay meets the 409 with its
`retryAfterMs`, which the client waits out, as for Soniox.

**Daily cross-check.** For each slot key and day (BSS names a key's instance with its workspace,
`ApiKeyID;WorkspaceID;…`), the charged provider cost against BSS
`DescribeInstanceBill` (DAILY, `IsBillingItem=true`); a drift beyond rounding raises an alarm.

## 6. Budget, price and exposure

**Rate.** Raw worst case per leg and hour: audio in $0.19 (7 tokens/s), text out about $0.29 (taken
as 4 tokens/s), audio out $1.35 (12.5 tokens/s). A speaking leg ≈ $1.83/h, a text-only leg ≈ $0.48/h,
× K for the user. The granted duration is the balance over the summed rate, capped at 3600 s per
grant (ruling 9; with or without speech, until Qwen's own maximum is known); the start floor is a
minute of it.

**What a client can do that it should not.** Run a session past the grant, or open more sessions
while the token is valid (up to the account's RPM), or not report. None of it escapes the bill:
every session lands in the log and is attributed by its window. The cost is that the
charge comes after the session ends, so the wallet can go negative. Audio sent faster than real time
is bounded only by the account's TPM, which one abuser could use up for everyone; the reconciler
flags a lease whose tokens per second exceed real time.

**What it cannot do.** Bill another user: the window is ours, a row's start is its handshake so no
delay moves it out of the token's validity (probed), and a report binds only the reporting account.
Nor call another model (the key's scope), or reach the slot key (it never leaves the backend).

## 7. Backend changes (`sokuji-backend`)

- `session-lease`: a provider filter in `countActive`, in the reconciler's gate and in
  `releaseSatisfiedOrExpired`, so Soniox's reconciler and stream counters ignore Qwen leases. The
  Soniox masks and roles stay Soniox's.
- New: `src/routes/qwen.ts`; `src/services/qwen-slots.ts`; `src/services/qwen-logs.ts` (the V3-signed
  gateway client); `src/durable-objects/QwenReconcilerDO.ts`; D1 tables `qwen_workspaces`,
  `qwen_key_slots`, `qwen_key_windows`, `qwen_key_events`, `qwen_sessions`, `qwen_usage_logs`; Qwen
  rates in
  `src/services/pricing.ts` and a `/api/pricing` entry; Worker secrets for the RAM AccessKey and
  `QWEN_KEY_ENCRYPTION_KEY`; the cron's poke.
- Admin: the leases page already shows a provider; the ledger shows Qwen charges by their provider;
  a count of window-attributed (unreported) sessions per lease and account, for audit; and the key
  pool page (7.1).

### 7.1 Admin: the Qwen key pool page

The owner's request: one admin page to see and manage the pool — whether each key is in use, by
whom, and to whom it has issued tokens. It follows the console's layout (`src/admin/api/handlers/`,
`*-data.ts`, `requireAdmin`; `web/src/admin/pages/QwenKeysPage.tsx`, beside `SessionsPage`).

**Workspaces** (`GET /admin/qwen/workspaces`), above the keys, one row each: the name, the Alibaba id,
the tenant id, keys in it (with Alibaba's 20 shown, not enforced), held now and free now, its status,
and its log reading — the watermark, the lag, the last error (`No Authority` means the RAM user is not
a member with 模型日志). The keys below can be filtered to one workspace.
- **Add a workspace** `POST /admin/qwen/workspaces` `{ alibabaWorkspaceId, note? }`: the backend looks
  its name and tenant id up with `ListWorkspaces`, then reads its log once with that `switchAgent`, and
  refuses it if the RAM user cannot (not a member, or no 模型日志).
- **Pause / resume a workspace** `POST /admin/qwen/workspaces/:id/status` `{ status, note? }`: the
  picker skips every key in a paused workspace; the reconciler keeps reading it while it has windows
  inside the retention.

**The pool** (`GET /admin/qwen/keys`), one row per key, most recently issued first:
- the key: label, Alibaba's key id (`apikey_id`), the secret's last four characters (never more),
  the workspace;
- its state: free; held until a time, with a countdown; or paused, with the reason (by hand, or a
  refused mint: disabled or deleted in the console);
- who holds it now: the account (linked to the user page), the lease (linked to the sessions
  page), the window, the legs;
- the last issue: when, and to which account;
- today: tokens issued, sessions attributed, provider cost and amount charged;
- open alarms on it: unclaimed rows (a leak), held charges, mismatches.
Above the table: workspaces, keys active, held now and free now, sessions started in the current
minute against the account's RPM, open alarms.

**A key's history** (`GET /admin/qwen/keys/:id/windows`, paged by cursor, newest first): every
window it opened — when, until when, the lease and account, the legs — with the sessions attributed
to it underneath (`task_uuid`, `request_id`, start, duration, usage, cost, charge, how attributed),
and the rows the window caught that nobody reported. Below it, the key's admin actions.

**Management.** Every write runs under `requireAdmin` and lands in `qwen_key_events` with the
admin's user id, the action and an optional note, as the wallet freeze is audited:
- **Add** `POST /admin/qwen/keys` `{ workspaceId, apikeyId, label, secret, note? }`, into a workspace
  already added: the backend mints a 1-second
  token with the secret first (free, `POST /api/v1/tokens`) and refuses a secret Alibaba refuses. The
  page sets no cap of its own: the workspace already holds at most 20 keys, and a deleted key's row,
  kept paused for its history, must not block its replacement.
- **Pause / resume** `POST /admin/qwen/keys/:id/status` `{ status: 'active' | 'paused', note? }`: a
  paused key is skipped by the picker; a window it already opened runs out, since a token cannot be
  revoked.
- **Replace the secret** `POST /admin/qwen/keys/:id/secret` `{ secret, note? }`, after a reset in the
  console: checked by a mint the same way; the id, the slot and its history stay.
The page never shows a secret, and nothing it does reaches Alibaba other than the checking mint.

## 8. Operations

- A dedicated workspace for the pool, its 20 keys created by the owner in the console and added on
  the admin page (7.1), each scoped
  to `qwen3.8-livetranslate-flash-realtime`; the RAM user (`AliyunBailianReadOnlyAccess`,
  `AliyunBSSReadOnlyAccess`) a member of it with 模型日志 only — the least access probed to work.
- Adding a workspace when keys run short: create it in the console; create its keys, each scoped to
  `qwen3.8-livetranslate-flash-realtime`; make the RAM user a member with 模型日志; add the workspace on
  the admin page (which checks the membership), then its keys. More workspaces add slots only, so the
  owner gets the RPM raised through the account manager first, then adds the workspace and its keys
  (the owner, 2026-10-17).
- The RPM increase applied for through the account manager, with the expected concurrent sessions
  and average length.
- The root AccessKey that appeared in chat deleted; the RAM AccessKey rotated before production.
- Alarms: a report and a window naming different accounts (the held charge), a reported row outside
  every window, an unclaimed row (a leak), reconciler lag, gateway errors, bill drift. Unreported
  sessions and same-account mismatches raise no alarm; they are audited from the admin counts.

## 9. Testing

- Backend: slot hold and release under concurrency; the window from a mint response; each of the six
  attribution cases, the held charge and the reporter-pays case included, and a report whose
  `task_uuid` and `request_id` name different rows; the price (input text excluded); idempotent charges;
  the reconciler's paging, a watermark per workspace, reads per workspace with its own `switchAgent`,
  a paused workspace still read while its windows are in retention, a row attributed only to a window
  on its own `(workspace_id, apikey_id)`, the picker spreading over workspaces and skipping paused
  ones, adding a workspace (the `ListWorkspaces` lookup, the membership check); the 5 s polling after a `session-end`,
  ended by the last row or by its 90 s cap; the lease released by its last row, by
  the token's expiry with nothing reported and by `expires_at`, and a row after the release still
  charged; Soniox's reconciler ignoring Qwen leases; the admin endpoints (`requireAdmin`, the
  checking mint on add and replace, every write in
  `qwen_key_events`, no secret in any response) and a refused mint pausing its slot.
- Client: the lease (grant end, refusals in words, `session-started` retries, release); the adapter
  reporting both ids through the port; the seam resolving `x-request-id` on each platform, first as
  a spike in a development build of the desktop app and of the extension; the twin's registry and conformance tests.
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
5. **Pool size** — as many as one workspace allows: 20 for now; more workspaces later (ruling 14).
6. **Unreported sessions** — recorded in the backend for a later audit, never shown to the user: a
   missing report may be the network or our own bug rather than the user. Whether to act on it is
   decided after an audit.
7. **Release** — `flagged`.
8. **Lease release** — as Soniox's, which frees soon after a session ends: the row proves the end.
9. **Grant cap** — 3600 s for now.
10. **Attribution** — the key and the time decide, because they need nothing from the client; the
    reported `task_uuid` finds the row and verifies it; no report, or one that does not verify, means
    the client's data is wrong, and the window alone attributes the row (cases 3–6 of section 5 are
    how that plays out).
11. **Request id** — the handshake's `request_id` is reported with `task_uuid`, and a report counts
    only when both match the same row: a client then has to name two ids it could only have seen on
    that connection, which makes its report more trustworthy and harder to fake.
12. **Charge** — Alibaba's official formula over the row's `usage`, × K.
13. **Admin page** — the key pool is seen and managed on an admin page: each key's state, who holds
    it, and to whom it has issued tokens (section 7.1).
14. **Workspaces** — 20 keys are only today's plan; when keys run short the owner opens another
    workspace with more keys, so key storage and use, attribution, reconciliation and the log reads
    all reckon with workspaces (section 2).

## Known unknowns

- The gateway is undocumented and may change without notice.
- Qwen's maximum session length.
- Whether Electron's `onHeadersReceived` and the extension's `chrome.webRequest` see the 101's
  headers on the seam's socket, and whether adding `webRequest` makes Chrome ask installed users to
  approve the extension again.
- Alibaba's own answer on what a request is and whether concurrency is capped (we measured: a request
  is a session start).
