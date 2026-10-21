# Kizuna AI Managed Qwen — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sokuji-backend lends a 60-second Qwen token from a pool of Kizuna-owned keys, attributes every session in Alibaba's request log to the lease whose key window contains its start, charges it at Alibaba's price × K, and gives admins a page to see and manage the key pool.

**Architecture:** A Qwen lease shares `session_leases`' one-lease-per-account lock, with every Soniox query filtered to `provider = 'soniox'`. A slot service holds one key per lease for its token's window and records every mint in `qwen_key_windows`. A singleton `QwenReconcilerDO` reads each workspace's `listModelLogs` through an ACS3-signed RAM AccessKey, stores rows, attributes them (window decides, the client's report checks), charges through `BillingService`, and releases leases.

**Tech Stack:** Cloudflare Workers, Hono, D1 (Drizzle schema + `drizzle/` SQL migrations), Durable Objects, WebCrypto, vitest 2.1.9 with `node:sqlite` (Node ≥ 22), React admin web (`web/src/admin`).

**Spec:** `docs/superpowers/specs/2026-10-17-kizuna-managed-qwen-design.md` (sokuji repo, branch `docs/kizuna-managed-qwen-design`, commit `3a8ab39a9`). This plan runs in a worktree of **kizuna-ai-lab/sokuji-backend**; every path below is in that repo.

## Global Constraints

- Model `qwen3.8-livetranslate-flash-realtime`. Mint `POST https://maas.qwencloudapi.com/api/v1/tokens?expire_in_seconds=60` with `Authorization: Bearer <key>`; answer `{ token: "st-…", expires_at: <unix seconds> }`, header `resp-start-time` (Alibaba ms). Endpoint id in grants: `'intl'`.
- Gateway: `POST https://bailian.ap-southeast-1.aliyuncs.com/`, `x-acs-action: IntlBroadScopeAspnGateway`, `x-acs-version: 2023-06-01`, query `Api=zeldaEasy.bailian-telemetry.platform-model.listModelLogs`, `V=1.0`, `Data=<JSON {reqDTO:{startTime,endTime,maxResults:50,skip}, cornerstoneParam:{domain:'cli.qwencloud.com', consoleSite:'QWENCLOUD', console:'ONE_CONSOLE', xsp_lang:'en-US', protocol:'V2', productCode:'p_efm', switchAgent:<tenantId>}}>`. Success = `DataV2.ret[0]` starts with `SUCCESS`; rows at `DataV2.data.data.list[].originLog`, count at `DataV2.data.data.totalCount`. Every originLog field is a string; `usage` is a JSON string or absent. The time range filters on a row's write time (its session's end). Retention 14 days.
- ModelStudio `GET https://modelstudio.ap-southeast-1.aliyuncs.com/modelstudio/workspaces`, action `ListWorkspaces`, version `2026-02-10` → `workspaces[].{workspaceId, tenantId, workspaceName}` (`tenantId` is a string).
- BSS `POST https://business.ap-southeast-1.aliyuncs.com/`, action `DescribeInstanceBill`, version `2017-12-14`, `{BillingCycle:'YYYY-MM', Granularity:'DAILY', BillingDate:'YYYY-MM-DD', ProductCode:'sfm', IsBillingItem:'true', MaxResults:300}` → `Data.Items[].{InstanceID:'<apikeyId>;<ws-…>;<model>;<io_type>;0', PretaxGrossAmount}`.
- Price, USD per 1M tokens: audio in 7.5, text out 20, audio out 30, image in 0.55; text in 0. Tokens × that price = µUSD. Provider cost per row = `Math.round(sum)`; charge = `BillingService` `cost_times_k` (ceil(cost × `REVENUE_COEFFICIENT_K`), K = 2.0). A row whose cost is 0 is never charged.
- Worst-case rate per leg: audio in 7 tok/s, text out 4 tok/s, audio out 12.5 tok/s (speaking legs only) → 3.654 USD/h speaking, 0.954 USD/h text-only, after K. Grant cap 3600 s; start floor 60 s (`MIN_SESSION_S`).
- Windows: `[opened_at − 5000, expires_at + 5000]` on Alibaba's clock; slot `held_until = expires_at + 5000`. Lease margin `LEASE_MARGIN_MS` (15 s); lookout `UNRECONCILED_LEASE_MAX_AGE_MS` (10 min).
- Reading: every 30 s while work exists; every 5 s for at most 90 s after a `session-end`, only for that lease's workspaces; an idle heartbeat read of every workspace with a window in the last 14 days every 5 minutes; all reads under `QWEN_READ_BUDGET_PER_MIN = 60`.
- No response, log line or admin payload ever carries a key secret, a token or the RAM secret. Admin shows a secret's last four characters only.
- The trial credit pays for Qwen like any balance (spec M11): nothing in this plan filters the wallet by provider.
- A workspace whose log reads have failed for 10 minutes (`log_failing_since <= now − 600_000`) gives no keys: the picker skips it, and the reconciler alarms `gateway_down` once when it crosses (spec §5, "stops new leases").
- New Worker secrets: `QWEN_RAM_ACCESS_KEY_ID`, `QWEN_RAM_ACCESS_KEY_SECRET`, `QWEN_KEY_ENCRYPTION_KEY` (base64 of 32 random bytes). New DO binding `QWEN_RECONCILER`.
- Code, comments and docs in English. Commit messages conventional, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: tests `npx vitest run <paths>`; types `npx tsc --noEmit` (root) and `cd web && npx tsc --noEmit`.

## Review Focus

1. A row with only the session's fixed 47 text tokens costs 0: it must be stored and never charged — `BillingService` would fall back to a time rate and throw on the unknown SKU. (Task 2 pins the cost; Task 10 pins "no charge".)
2. A workspace's gateway call fails (`No Authority`, HTTP 5xx, a malformed body): its watermark must not move, the error is recorded on the workspace, and the other workspaces' reads go on. (Task 10.)
3. Rows of other models or keys outside the pool appear in the same workspace (the default workspace holds `qwen-mt-plus` rows): they are ignored, never stored, never alarmed as a leak. (Task 10.)
4. Two accounts race for the last free slot, or the mint fails after a slot is claimed: exactly one wins; a failed mint frees the slot and the lease and opens no window. (Task 7.)
5. A window holds more than 50 rows: all pages are read before the watermark moves, and rows met twice across overlapping reads are stored once (`request_id`). (Task 10.)

## File Structure

| File | Responsibility |
|---|---|
| `src/config/qwen.ts` | Every Qwen constant above. |
| `src/db/qwen.schema.ts`, `drizzle/0021_qwen_managed.sql` (+ meta) | The six tables. |
| `src/services/qwen-pricing.ts` | Usage parsing, provider cost, leg rates, the session budget. |
| `src/services/qwen-crypto.ts` | AES-GCM for key secrets. |
| `src/services/acs3.ts` | The ACS3-HMAC-SHA256 signer. |
| `src/services/qwen-logs.ts` | RAM-AccessKey reads: `listModelLogs`, `ListWorkspaces`, `DescribeInstanceBill`. |
| `src/services/qwen-mint.ts` | Token mint with a slot key. |
| `src/services/qwen-slots.ts` | Pick, hold and release a slot; record windows; pause refused keys. |
| `src/services/qwen-attribution.ts` | The six attribution cases and their lookups. |
| `src/services/qwen-reconcile.ts` | One sweep: read, store, attribute, charge, release; the daily cross-check. |
| `src/durable-objects/QwenReconcilerDO.ts` | Cadence, budget, poke handling. |
| `src/routes/qwen.ts` | `/api/qwen/session-key`, `/session-started`, `/session-end`. |
| `src/admin/api/qwen-data.ts`, `src/admin/api/handlers/qwen.handler.ts` | Admin reads and writes. |
| `web/src/admin/lib/qwen-keys-view.ts`, `web/src/admin/pages/QwenKeysPage.tsx` | The key-pool page. |
| Modified | `src/services/session-lease.ts`, `src/services/soniox-reconcile.ts`, `src/routes/pricing.ts`, `src/index.ts`, `src/env.d.ts`, `wrangler.toml`, `src/admin/api/index.ts`, `src/admin/api/sessions-data.ts`, `web/src/admin/{AdminApp.tsx,layout/AdminLayout.tsx,pages/index.ts,lib/admin-api.ts}`, `web/src/locales/docs/{en,zh}.ts`. |

---

### Task 1: Config, schema and migration

**Files:**
- Create: `src/config/qwen.ts`, `src/db/qwen.schema.ts`, `drizzle/0021_qwen_managed.sql` (+ `drizzle/meta/0021_snapshot.json`, journal entry), `src/db/qwen.schema.sqlite.test.ts`
- Modify: `src/db/index.ts`

**Interfaces:**
- Produces: tables `qwen_workspaces`, `qwen_key_slots`, `qwen_key_windows`, `qwen_key_events`, `qwen_sessions`, `qwen_usage_logs`; constants `QWEN_MODEL`, `QWEN_MINT_URL`, `QWEN_TOKEN_TTL_S = 60`, `QWEN_GATEWAY_HOST`, `QWEN_CORNERSTONE` (without `switchAgent`), `QWEN_MODELSTUDIO_HOST`, `QWEN_BSS_HOST`, `QWEN_PRICE_USD_PER_M = { audioIn: 7.5, textOut: 20, audioOut: 30, imageIn: 0.55 }`, `QWEN_WORST_TOKENS_PER_S = { audioIn: 7, textOut: 4, audioOut: 12.5 }`, `QWEN_GRANT_CAP_S = 3600`, `QWEN_WINDOW_MARGIN_MS = 5000`, `QWEN_PROVISIONAL_HOLD_MS = 30_000`, `QWEN_SLOW_READ_MS = 30_000`, `QWEN_FAST_READ_MS = 5_000`, `QWEN_FAST_FOR_MS = 90_000`, `QWEN_HEARTBEAT_MS = 300_000`, `QWEN_READ_BUDGET_PER_MIN = 60`, `QWEN_SKU = 'qwen:livetranslate'`.

Columns (all times are ms integers; ids are text):
- `qwen_workspaces`: `id` PK, `alibaba_workspace_id` UNIQUE NOT NULL, `tenant_id` NOT NULL, `name` NOT NULL, `status` NOT NULL DEFAULT `'active'`, `log_watermark_ms` NOT NULL DEFAULT 0, `log_read_at`, `log_error`, `log_failing_since`, `created_at` NOT NULL.
- `qwen_key_slots`: `id` PK, `workspace_id` NOT NULL, `apikey_id` NOT NULL, `label` NOT NULL, `secret_ciphertext` NOT NULL, `secret_last4` NOT NULL, `status` NOT NULL DEFAULT `'active'`, `pause_reason`, `held_until` NOT NULL DEFAULT 0, `last_issued_at`, `created_at` NOT NULL; UNIQUE (`workspace_id`, `apikey_id`).
- `qwen_key_windows`: `id` PK, `slot_id`, `workspace_id`, `apikey_id`, `lease_id`, `account_id`, `legs` (JSON text), `opened_at`, `expires_at`, `held_until`, `minted_at` — all NOT NULL; index (`workspace_id`, `apikey_id`, `opened_at`), index (`lease_id`).
- `qwen_key_events`: `id` PK, `slot_id`, `workspace_id`, `action` NOT NULL, `admin_user_id`, `note`, `created_at` NOT NULL; index (`slot_id`), index (`workspace_id`).
- `qwen_sessions`: `task_uuid` PK, `request_id` UNIQUE (nullable), `lease_id` NOT NULL, `account_id` NOT NULL, `leg` NOT NULL, `reported_at` NOT NULL; index (`lease_id`).
- `qwen_usage_logs`: `request_id` PK, `workspace_id`, `apikey_id`, `task_uuid`, `start_ms`, `duration_ms`, `usage`, `provider_cost_micro_usd` NOT NULL DEFAULT 0, `lease_id`, `account_id`, `attributed_by` NOT NULL, `report_ignored` NOT NULL DEFAULT 0, `charge_state` NOT NULL (`'none' | 'charged' | 'held' | 'failed'`), `charged_at`, `created_at` NOT NULL; index (`lease_id`), index (`account_id`, `attributed_by`), index (`workspace_id`, `apikey_id`).

- [ ] **Step 1: Write the failing test** `src/db/qwen.schema.sqlite.test.ts`, in the `node:sqlite` pattern of `src/services/session-lease.sqlite.test.ts:55-108`, loading `0021_qwen_managed.sql`:
  - `it('refuses a second key with the same workspace and apikey id')` — inserting (`ws1`, `1309643`) twice throws a UNIQUE error.
  - `it('refuses a request id reported for two sessions')` — two `qwen_sessions` rows with one `request_id` throw; two with `request_id` NULL succeed.
  - `it('stores a usage row once per request id')` — `INSERT OR IGNORE` twice leaves one row.
- [ ] **Step 2: Run** `npx vitest run src/db/qwen.schema.sqlite.test.ts` — FAIL (file `0021_qwen_managed.sql` missing).
- [ ] **Step 3: Write `src/db/qwen.schema.ts`** (Drizzle tables matching the columns above), export it from `src/db/index.ts`, write `src/config/qwen.ts`, then run `npx drizzle-kit generate --name qwen_managed` to produce the SQL, snapshot and journal entry 21.
- [ ] **Step 4: Run** `npx vitest run src/db/qwen.schema.sqlite.test.ts src/db/migrations.sqlite.test.ts` — PASS (the second checks the journal chain and that every column matches Drizzle).
- [ ] **Step 5: Commit** `feat(qwen): tables and constants for managed Qwen`.

### Task 2: Pricing and budget

**Files:**
- Create: `src/services/qwen-pricing.ts`, `src/services/qwen-pricing.test.ts`
- Modify: `src/routes/pricing.ts`, `src/routes/pricing.test.ts`

**Interfaces:**
- Consumes: `QWEN_PRICE_USD_PER_M`, `QWEN_WORST_TOKENS_PER_S`, `QWEN_GRANT_CAP_S` (Task 1); `microUsdForRate`, `REVENUE_COEFFICIENT_K` (`src/services/pricing.ts`); `MIN_SESSION_S`, `SessionBudget` (`src/config/soniox.ts`).
- Produces:
  - `interface QwenUsage { audioIn: number; textOut: number; audioOut: number; imageIn: number }`
  - `parseQwenUsage(raw: string | null | undefined): QwenUsage | null` — reads `input_tokens_details.{audio_tokens,image_tokens}` and `output_tokens_details.{text_tokens,audio_tokens}`; ignores `text_tokens` of the input; `null` for absent or unparsable.
  - `qwenProviderCostMicroUsd(u: QwenUsage): number`
  - `type QwenLeg = { leg: 'speaker' | 'participant'; speaks: boolean }`
  - `qwenRateUsdPerHour(legs: readonly QwenLeg[]): number` (after K)
  - `computeQwenBudget(balanceMicroUsd: number, legs: readonly QwenLeg[]): SessionBudget` — `seconds = balance / 1e6 / rate × 3600`; `durationS = min(3600, max(60, floor(seconds)))`; `budgetMicroUsd = microUsdForRate(rate, durationS)`; `floorMicroUsd = microUsdForRate(rate, 60)`; `affordable = balance >= floorMicroUsd`.

- [ ] **Step 1: Write the failing tests** in `src/services/qwen-pricing.test.ts`:
  - real rows (strings verbatim from Alibaba):
    - `{"total_tokens":1825,"input_tokens":845,"output_tokens":980,"input_tokens_details":{"text_tokens":47,"audio_tokens":798},"output_tokens_details":{"text_tokens":295,"audio_tokens":685}}` → cost `32435`;
    - `{"total_tokens":697,"input_tokens":474,"output_tokens":223,"input_tokens_details":{"text_tokens":47,"audio_tokens":427},"output_tokens_details":{"text_tokens":223}}` → `7663`;
    - `{"total_tokens":75,"input_tokens":75,"input_tokens_details":{"text_tokens":47,"audio_tokens":28}}` → `210`;
    - `{"total_tokens":47,"input_tokens":47,"input_tokens_details":{"text_tokens":47}}` → `0`;
    - `parseQwenUsage(null)` and `parseQwenUsage('not json')` → `null`.
  - rates: one speaking leg `3.654`, one text-only `0.954`, speaking + text-only `4.608`, two speaking `7.308` (`toBeCloseTo(…, 9)`).
  - budget at a $1 balance (`1_000_000`): speaking → `{durationS: 985, budgetMicroUsd: 999776, floorMicroUsd: 60900, affordable: true}`; text-only → `{durationS: 3600, budgetMicroUsd: 954000, floorMicroUsd: 15900}`; speaking + text-only → `{durationS: 781, budgetMicroUsd: 999680, floorMicroUsd: 76800}`; speaking at `50_000` → `affordable: false`.
- [ ] **Step 2: Run** `npx vitest run src/services/qwen-pricing.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement** `src/services/qwen-pricing.ts` with the signatures above.
- [ ] **Step 4: Add the `/api/pricing` entry** in `buildPricingResponse()` (`src/routes/pricing.ts:89`), shaped like the Soniox entry: id `kizunaai_qwen`, name `Kizuna AI Qwen`, token rates after K (audio in 15, text out 40, audio out 60 USD per 1M), conversions 7 audio-in tokens per second and 12.5 audio-out per second of speech, shapes "speaking" 3.654 and "text only" 0.954 USD/h. Extend `src/routes/pricing.test.ts` with `it('publishes Qwen after K only')`: the entry exists and no figure in it equals a pre-K price (7.5, 20, 30, 1.827, 0.477).
- [ ] **Step 5: Run** `npx vitest run src/services/qwen-pricing.test.ts src/routes/pricing.test.ts` — PASS.
- [ ] **Step 6: Commit** `feat(qwen): price a log row and size a session's grant`.

### Task 3: Key secret encryption

**Files:**
- Create: `src/services/qwen-crypto.ts`, `src/services/qwen-crypto.test.ts`

**Interfaces:**
- Produces: `encryptQwenSecret(plain: string, keyB64: string): Promise<string>` → `"v1:<ivB64>:<ciphertextB64>"` (AES-GCM, 12-byte random IV); `decryptQwenSecret(blob: string, keyB64: string): Promise<string>` — throws on a wrong key, a tampered blob or an unknown version; `secretLast4(plain: string): string`.

- [ ] **Step 1: Write the failing tests:** round trip of `'sk-ws-test-0123456789'`; two encryptions of one plaintext differ; decrypting with another 32-byte key rejects; flipping one character of the ciphertext rejects; `'v2:…'` rejects; `secretLast4('sk-ws-test-0123456789') === '6789'`.
- [ ] **Step 2: Run** `npx vitest run src/services/qwen-crypto.test.ts` — FAIL.
- [ ] **Step 3: Implement** with `crypto.subtle.importKey('raw', …, 'AES-GCM')`, base64 via `btoa`/`atob`.
- [ ] **Step 4: Run** the test — PASS.
- [ ] **Step 5: Commit** `feat(qwen): encrypt pool key secrets at rest`.

### Task 4: ACS3 signer and the RAM-AccessKey reads

**Files:**
- Create: `src/services/acs3.ts`, `src/services/acs3.test.ts`, `src/services/qwen-logs.ts`, `src/services/qwen-logs.test.ts`
- Modify: `src/env.d.ts` (`QWEN_RAM_ACCESS_KEY_ID: string; QWEN_RAM_ACCESS_KEY_SECRET: string; QWEN_KEY_ENCRYPTION_KEY: string;`)

**Interfaces:**
- Produces:
  - `interface Acs3Request { method: 'GET' | 'POST'; host: string; path: string; query: Record<string, string>; action: string; version: string; accessKeyId: string; accessKeySecret: string; date: string; nonce: string }`
  - `signAcs3(r: Acs3Request): Promise<{ url: string; headers: Record<string, string> }>` — empty body; RFC 3986 encoding (`encodeURIComponent` plus `!'()*`); canonical query sorted by key; signed headers `host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version`; `Authorization: ACS3-HMAC-SHA256 Credential=<id>,SignedHeaders=<…>,Signature=<hex>`; the returned headers omit `host`.
  - `interface QwenLogRow { requestId: string; taskUuid: string | null; apikeyId: string; workspaceId: string; model: string; startMs: number; durationMs: number; usage: string | null }`
  - `class QwenGatewayError extends Error { readonly detail: string }`
  - `createQwenAlibabaReader(env: CloudflareBindings, deps?: { fetch?: typeof fetch; now?: () => Date; nonce?: () => string }): QwenAlibabaReader` with `listModelLogs(q: { tenantId: string; startMs: number; endMs: number; skip: number }): Promise<{ rows: QwenLogRow[]; totalCount: number }>`, `listWorkspaces(): Promise<{ workspaceId: string; tenantId: string; name: string }[]>`, `describeInstanceBill(day: string): Promise<{ instanceId: string; pretaxGrossAmount: number }[]>`.

- [ ] **Step 1: Write the failing signer test** `acs3.test.ts` — the known-answer vector, computed with the reference signer used for every probe of the spec:
  ```ts
  const data = '{"reqDTO":{"startTime":1792218693798,"endTime":1792218885178,"maxResults":50,"skip":0},"cornerstoneParam":{"domain":"cli.qwencloud.com","consoleSite":"QWENCLOUD","console":"ONE_CONSOLE","xsp_lang":"en-US","protocol":"V2","productCode":"p_efm","switchAgent":1690620}}';
  const { headers } = await signAcs3({ method: 'POST', host: 'bailian.ap-southeast-1.aliyuncs.com', path: '/',
    query: { Api: 'zeldaEasy.bailian-telemetry.platform-model.listModelLogs', Data: data, V: '1.0' },
    action: 'IntlBroadScopeAspnGateway', version: '2023-06-01', accessKeyId: 'LTAI-test-id', accessKeySecret: 'test-secret',
    date: '2026-10-17T06:15:38Z', nonce: '0123456789abcdef0123456789abcdef' });
  expect(headers.Authorization).toBe('ACS3-HMAC-SHA256 Credential=LTAI-test-id,SignedHeaders=host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,Signature=ae0516bf9ec3a6457b148186341c7e1ab4a1a4ce927e86bfdc265b20e2bb9a07');
  ```
- [ ] **Step 2: Write the failing reader tests** `qwen-logs.test.ts` with a fake `fetch`:
  - `listModelLogs` puts `switchAgent: Number(tenantId)` and the cornerstone constants into `Data`, and `skip` into `reqDTO`;
  - it maps an `originLog` with string fields (`start_unix_timestamp: "1792046259741"`, `duration: "895"`, `usage` a JSON string) to numbers and strings;
  - `ret: ['FAIL_SYS_GW::…']` and `ret: ['10032390::No Authority']` reject with `QwenGatewayError` whose `detail` is the ret text; HTTP 500 rejects too;
  - `listWorkspaces` maps `workspaces[].{workspaceId, tenantId, workspaceName}`;
  - `describeInstanceBill('2026-10-15')` sends `BillingCycle: '2026-10'` and maps `Data.Items[].{InstanceID, PretaxGrossAmount}`;
  - no request URL, header or thrown message contains `QWEN_RAM_ACCESS_KEY_SECRET`'s value.
- [ ] **Step 3: Run** `npx vitest run src/services/acs3.test.ts src/services/qwen-logs.test.ts` — FAIL.
- [ ] **Step 4: Implement** both modules (HMAC and SHA-256 via `crypto.subtle`; ROA-style `GET` for `ListWorkspaces`, RPC-style `POST` with the query for the gateway and BSS).
- [ ] **Step 5: Run** the tests — PASS.
- [ ] **Step 6: Commit** `feat(qwen): ACS3-signed reads of Alibaba's log, workspaces and bill`.

### Task 5: Token mint

**Files:**
- Create: `src/services/qwen-mint.ts`, `src/services/qwen-mint.test.ts`

**Interfaces:**
- Produces: `type QwenMintResult = { ok: true; token: string; openedAtMs: number; expiresAtMs: number } | { ok: false; refused: boolean; status: number }`; `mintQwenToken(secret: string, deps?: { fetch?: typeof fetch; timeoutMs?: number }): Promise<QwenMintResult>` — `openedAtMs` = header `resp-start-time`, `expiresAtMs` = `expires_at × 1000`; `refused` for 401 and 403; a timeout (default 10 000 ms) or transport error → `{ ok: false, refused: false, status: 0 }`.

- [ ] **Step 1: Write the failing tests:** 200 `{token:'st-x', expires_at:1792217798}` with `resp-start-time: 1792217738712` → `{ok:true, token:'st-x', openedAtMs:1792217738712, expiresAtMs:1792217798000}`; 401 → `refused: true`; 503 → `refused: false, status: 503`; a hanging fetch past `timeoutMs: 10` → `status: 0`; the request is `POST QWEN_MINT_URL` with `Authorization: Bearer <secret>`.
- [ ] **Step 2: Run** `npx vitest run src/services/qwen-mint.test.ts` — FAIL.
- [ ] **Step 3: Implement** `mintQwenToken`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(qwen): mint a 60 s token with a pool key`.

### Task 6: The shared lease table

**Files:**
- Modify: `src/services/session-lease.ts`, `src/services/soniox-reconcile.ts`
- Test: `src/services/session-lease.qwen.sqlite.test.ts` (new, lease migration list of `session-lease.sqlite.test.ts`)

**Interfaces:**
- Produces on `SessionLeaseService`:
  - `acquire(p)` accepts `provider: 'qwen'` with `sttStreamCount: 0, usesTts: false`, skips the Soniox concurrency check for it, and stores `region` as its default;
  - `markQwenStarted(accountId: string, leaseId: string, now: number): Promise<boolean>` — `started_at = COALESCE(started_at, now)`, `expires_at = MAX(expires_at, now + max_duration_s*1000 + LEASE_MARGIN_MS)`, only for that account's live `provider = 'qwen'` row;
  - `findQwenLease(accountId: string, leaseId: string): Promise<{ expiresAt: number; endSignalledAt: number | null; reconciledAt: number | null } | null>`;
  - `releaseQwenLease(accountId: string, leaseId: string, now: number): Promise<number>`;
  - `listOpenQwenLeases(): Promise<{ accountId: string; leaseId: string; expiresAt: number; endSignalledAt: number | null }[]>` (`reconciled_at IS NULL`).
- `countActive`, `releaseSatisfiedOrExpired`, and `unreconciledLeaseQuery` / `blockedSweepLeaseQuery` (`soniox-reconcile.ts:302,347`) gain `provider = 'soniox'`.

- [ ] **Step 1: Write the failing tests:**
  - `it('a Qwen lease takes no Soniox stream')` — after a Qwen `acquire`, `countActive(now)` is `{stt: 0, tts: 0}`;
  - `it('a Qwen lease holds the account')` — a second `acquire` (either provider) for that account while it is live → `{ok:false, reason:'active_lease'}`; after `expires_at` it succeeds;
  - `it('Soniox's sweeps never see a Qwen lease')` — the two lease queries return no region for it, and `releaseSatisfiedOrExpired` leaves its `reconciled_at` NULL;
  - `it('markQwenStarted stretches the lease to the grant')` — with `maxDurationS: 985` at `now`, `expires_at === now + 985_000 + 15_000`; a Soniox lease is not touched;
  - `releaseQwenLease` sets `reconciled_at`; `listOpenQwenLeases` lists only unreconciled Qwen leases.
- [ ] **Step 2: Run** `npx vitest run src/services/session-lease.qwen.sqlite.test.ts` — FAIL.
- [ ] **Step 3: Implement** the filters and methods; the "at least one stream" assertion applies to `provider = 'soniox'` only.
- [ ] **Step 4: Run** it with the existing suites: `npx vitest run src/services/session-lease src/services/soniox-reconcile src/routes/soniox` — PASS.
- [ ] **Step 5: Commit** `feat(qwen): share the account lease without touching Soniox's`.

### Task 7: Slot service

**Files:**
- Create: `src/services/qwen-slots.ts`, `src/services/qwen-slots.sqlite.test.ts`

**Interfaces:**
- Consumes: `mintQwenToken` (Task 5), `decryptQwenSecret` (Task 3), `QwenLeg` (Task 2).
- Produces:
  - `interface QwenWindow { id: string; slotId: string; workspaceId: string; apikeyId: string; leaseId: string; accountId: string; openedAtMs: number; expiresAtMs: number; heldUntilMs: number }`
  - `type QwenTakeResult = { ok: true; token: string; expiresAtMs: number; window: QwenWindow } | { ok: false; reason: 'busy'; retryAfterMs: number } | { ok: false; reason: 'mint_failed' }`
  - `createQwenSlotService(env: CloudflareBindings, deps: { mint: typeof mintQwenToken; now: () => number; newId: () => string; alarm: (kind: string, detail: Record<string, unknown>) => void }): { take(p: { accountId: string; leaseId: string; legs: readonly QwenLeg[] }): Promise<QwenTakeResult> }`
  - `qwenAlarm(kind: string, detail: Record<string, unknown>): void` — one `console.error(JSON.stringify({ event: 'qwen_alarm', kind, ...detail }))` line (exported from this module; Tasks 8 and 10 reuse it).

`take` claims the least recently issued active key of an active workspace — skipping a workspace whose `log_failing_since <= now − 600_000` — with `held_until <= now` (`last_issued_at` NULLS FIRST) by a conditional `UPDATE … SET held_until = now + QWEN_PROVISIONAL_HOLD_MS WHERE id = ? AND held_until <= ?` (zero changes → try the next candidate), mints, and on success sets `held_until = expiresAtMs + 5000`, `last_issued_at = now`, inserts the window (`opened_at = openedAtMs`) and alarms `window_overlap` if the slot's previous window's `expires_at` ≥ the new `openedAtMs`. A refused mint pauses the slot (`status 'paused'`, `pause_reason 'mint_refused'`, a `qwen_key_events` row `action 'auto_pause'`), alarms `key_refused`, and tries the next (at most 3 attempts). Any other mint failure sets `held_until` back to 0 and returns `mint_failed`. With no candidate: `busy`, `retryAfterMs` = earliest active `held_until` − now (minimum 1000).

- [ ] **Step 1: Write the failing tests** (fake `mint`, fixed `now`):
  - picks the key with the oldest `last_issued_at`, and a never-issued key first;
  - two `take`s racing for one free key: one `ok`, one `busy`;
  - a paused key, the keys of a paused workspace, and the keys of a workspace failing its log reads for 10 minutes are never picked (9 minutes failing still picks);
  - refused mint on key A → A is paused with an `auto_pause` event and key B serves the lease;
  - a 503 mint → `mint_failed`, `held_until` of the claimed key back to 0, no window row;
  - the window row holds the mint's `openedAtMs`/`expiresAtMs`, the lease, the account, the legs JSON; `held_until = expiresAtMs + 5000`;
  - a previous window ending after the new `openedAtMs` raises `window_overlap`;
  - all keys held → `busy` with `retryAfterMs` = earliest `held_until − now`.
- [ ] **Step 2: Run** `npx vitest run src/services/qwen-slots.sqlite.test.ts` — FAIL.
- [ ] **Step 3: Implement** `createQwenSlotService` and `qwenAlarm`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(qwen): hold a pool key for one token's window`.

### Task 8: Lease routes

**Files:**
- Create: `src/routes/qwen.ts`, `src/routes/qwen-session.sqlite.test.ts`
- Modify: `src/index.ts` (mount `app.route("/api/qwen", qwenRoutes)` beside `/api/soniox` at 919, with the same CORS blocks as 372-389)

**Interfaces:**
- Consumes: `computeQwenBudget` (2), `createSessionLeaseService` methods (6), `createQwenSlotService` (7), `sessionConflictRetryAfterMs` (`config/soniox.ts:363`), `QwenReconciler.poke` (Task 11; until then a no-op fake in tests).
- Produces: `createQwenHandlers(deps: { makeWalletService; makeSessionLeaseService; makeSlotService; makeReconciler; now: () => number; newId: () => string })` and `export default qwen` (Hono router with `post('/session-key' | '/session-started' | '/session-end')`).

Contract:
- `POST /session-key` `{ legs: ['speaker'] | ['participant'] | ['speaker','participant'], speech: { speaker: boolean, participant: boolean } }` — legs map to `QwenLeg[]` with `speaks = speech[leg]`. 400 for any other shape. Then, in order: no session → 401 `{error:'Authentication required'}`; wallet `null` → 503 `{error:'Wallet unavailable'}`; frozen → 403 `{error:'Wallet is frozen'}`; `!affordable` → 402 `{error:'Insufficient balance', requiredMicroUsd: floorMicroUsd, balanceMicroUsd}`; `acquire({ provider:'qwen', sku: QWEN_SKU, usesTts:false, sttStreamCount:0, maxDurationS: durationS, budgetMicroUsd, startWindowS: 60, … })` not ok → 409 `{error:'Another session is already active', retryAfterMs: sessionConflictRetryAfterMs(UA)}`; slot `busy` → `releaseQwenLease` then 503 `{error:'qwen_busy', retryAfterMs}`; `mint_failed` → `releaseQwenLease` then 502 `{error:'Failed to issue Qwen session key'}`; else 200 `{ leaseId, endpoint:'intl', apiKey: token, expiresAt: expiresAtMs, maxSessionDurationSeconds: durationS, budgetMicroUsd, rateUsdPerHour }`.
- `POST /session-started` `{ leaseId, leg, taskUuid, requestId? }` — 400 unless `leaseId` has no `:`, `leg` is `speaker|participant`, `taskUuid` matches `/^sess_[A-Za-z0-9]{8,64}$/`, `requestId` absent or matches `/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/`; 404 `{error:'unknown_lease'}` unless `findQwenLease(user, leaseId)` exists; `INSERT` into `qwen_sessions` — the same `task_uuid` already on this lease → 200 (idempotent), on another lease or a `request_id` already used → 409 `{error:'session_already_reported'}` and `qwenAlarm('report_conflict', …)`; then `markQwenStarted`; 200 `{ok:true}`.
- `POST /session-end` (body ignored, as Soniox's) — `markEndSignalled(user, now)`; the user's open Qwen lease's windows give the workspace ids; `waitUntil(makeReconciler(env).poke({ fast: { workspaceIds } }))`; 200 `{ok:true}`.

- [ ] **Step 1: Write the failing tests** with fake `c` (`makeCtx` of `src/routes/soniox-session.sqlite.test.ts:66-122`), real sqlite, fake mint and reconciler: every status above in order (401, 503, 403, 402 with both figures, 409 with `retryAfterMs`, 503 `qwen_busy` releasing the lease, 502 releasing the lease and opening no window, the 200 body with `endpoint:'intl'` and no key secret anywhere in it); `session-started` 400s, 404 for another account's lease, idempotent 200, 409 on another lease and on a reused `requestId`, `expires_at` stretched; `session-end` pokes `{fast:{workspaceIds:['<ws id of the lease's window>']}}`.
- [ ] **Step 2: Run** `npx vitest run src/routes/qwen-session.sqlite.test.ts` — FAIL.
- [ ] **Step 3: Implement** `src/routes/qwen.ts` and the mount.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(qwen): session-key, session-started and session-end`.

### Task 9: Attribution

**Files:**
- Create: `src/services/qwen-attribution.ts`, `src/services/qwen-attribution.test.ts`, `src/services/qwen-attribution.sqlite.test.ts`

**Interfaces:**
- Produces:
  - `type QwenWindowHit = { leaseId: string; accountId: string } | null`
  - `type QwenReportHit = { leaseId: string; accountId: string; requestIdMatches: boolean | null } | null` (`null` match = the report carried no `requestId`)
  - `type QwenAttributedBy = 'both' | 'window' | 'window_mismatch' | 'held' | 'reporter' | 'unclaimed'`
  - `interface QwenAttribution { attributedBy: QwenAttributedBy; chargeTo: { accountId: string; leaseId: string } | null; alarm: 'held_charge' | 'reported_outside_window' | 'unclaimed_row' | null; reportIgnored: boolean }`
  - `attributeQwenRow(window: QwenWindowHit, report: QwenReportHit): QwenAttribution`
  - `findQwenWindow(env, workspaceId: string, apikeyId: string, startMs: number): Promise<QwenWindowHit>` — `opened_at − 5000 <= startMs <= expires_at + 5000`
  - `findQwenReport(env, row: { taskUuid: string | null; requestId: string }): Promise<QwenReportHit>` — by `task_uuid`; `requestIdMatches` compares the stored `request_id` with the row's

- [ ] **Step 1: Write the failing table test** (`qwen-attribution.test.ts`), one `it` per case:
  1. window L1/A, report L1/A, match → `both`, charge L1/A, no alarm;
  2. window L1/A, no report → `window`, charge L1/A, no alarm;
  3. window L1/A, report L2/A → `window_mismatch`, charge L1/A, no alarm;
  4. window L1/A, report L3/B → `held`, `chargeTo: null`, alarm `held_charge`;
  5. no window, report L2/A → `reporter`, charge L2/A, alarm `reported_outside_window`;
  6. neither → `unclaimed`, `chargeTo: null`, alarm `unclaimed_row`;
  - a report with `requestIdMatches: false` counts as none (case 2 or 6) with `reportIgnored: true`; `requestIdMatches: null` counts as a report.
- [ ] **Step 2: Write the failing lookup test** (`qwen-attribution.sqlite.test.ts`): a start 4 999 ms before `opened_at` and 4 999 ms after `expires_at` hits; 5 001 ms either side misses; a window on another workspace with the same `apikey_id` never hits.
- [ ] **Step 3: Run** `npx vitest run src/services/qwen-attribution` — FAIL.
- [ ] **Step 4: Implement** the module.
- [ ] **Step 5: Run** — PASS.
- [ ] **Step 6: Commit** `feat(qwen): attribute a log row by window, checked by the report`.

### Task 10: One reconcile sweep

**Files:**
- Create: `src/services/qwen-reconcile.ts`, `src/services/qwen-reconcile.sqlite.test.ts`

**Interfaces:**
- Consumes: `QwenAlibabaReader` (4), `parseQwenUsage`/`qwenProviderCostMicroUsd` (2), lease methods (6), `qwenAlarm` (7), attribution (9), `BillingService.charge` and `isTerminalChargeError` (`soniox-reconcile.ts:257`).
- Produces:
  - `interface QwenSweepPorts { reader: QwenAlibabaReader; charge(r: ChargeRequest): Promise<ChargeResult>; now(): number }`
  - `sweepQwenWorkspaces(env, ports: QwenSweepPorts, workspaceIds: readonly string[]): Promise<{ read: number; stored: number; charged: number; failedWorkspaces: string[] }>`
  - `releaseQwenLeases(env, now: number): Promise<number>`
  - `qwenWorkspacesWithWork(env, now: number): Promise<{ slow: string[]; heartbeat: string[] }>` — `slow`: workspaces of open Qwen leases, plus of leases expired within `UNRECONCILED_LEASE_MAX_AGE_MS` whose reported sessions lack rows; `heartbeat`: every workspace with a window opened in the last 14 days.
  - `crossCheckQwenBill(env, ports, day: string): Promise<{ checked: number; drifted: number }>`

Per workspace: read `[log_watermark_ms − 120_000, now]` page by page (`skip += rows`) until `totalCount`; on any error write `log_error` and, if unset, `log_failing_since = now`, keep the watermark, alarm `gateway_down` the first time `now − log_failing_since` reaches 600 000, and go on to the next workspace. Keep rows whose `model === QWEN_MODEL` and whose (`workspace_id`, `apikey_id`) is a pool key; `INSERT OR IGNORE` each into `qwen_usage_logs`; for each newly stored row: cost, `findQwenWindow` + `findQwenReport` → `attributeQwenRow`; raise its alarm; charge when `chargeTo` and cost > 0 (`provider:'qwen'`, `sku: QWEN_SKU`, `pricing:'cost_times_k'`, `model`, `providerCostMicroUsd`, `billableSeconds: Math.round(durationMs/1000)`, `externalId: requestId`, `sessionRef: '<account>:<lease>'`, `metadata: { workspaceId, apikeyId, attributedBy }`); `charge_state` = `charged` / `held` / `none` / `failed` (terminal error). After every page succeeded: `log_watermark_ms = now`, `log_read_at = now`, `log_error = NULL`, `log_failing_since = NULL`. A stored row whose audio-in tokens exceed `7 × durationMs / 1000 × 1.2` raises `faster_than_real_time` with its lease and account (spec §6). The direct `modelRequestId` fetch the spec mentions is not built: paging reads every row. `releaseQwenLeases`: an open Qwen lease is released when `end_signalled_at` is set and every `qwen_sessions` row of it has a usage row, or when `expires_at <= now`. `crossCheckQwenBill`: per pool key, our `provider_cost_micro_usd` summed over rows whose end (`start_ms + duration_ms`) falls on `day` in UTC+8, against Σ `PretaxGrossAmount` (USD → µUSD) of instances prefixed `<apikeyId>;<workspace ws-id>;`; alarm `bill_drift` when `|ours − theirs| > max(10_000, 1% of theirs)`; a day whose bill is all 0 counts as checked, not drifted (free quota).

- [ ] **Step 1: Write the failing tests** (sqlite + fake reader + fake charge):
  - a speaking row on a pool key inside L1's window with L1's report → stored, charged once with `providerCostMicroUsd: 32435`, `externalId` = its request id, `sessionRef: 'A:L1'`;
  - the same row read again (overlapping window) → not charged twice;
  - a row of only 47 text tokens → stored, `charge_state 'none'`, charge never called;
  - a `qwen-mt-plus` row, and a row of an apikey outside the pool → not stored, no alarm;
  - 120 rows over three pages → all stored, watermark moved once;
  - workspace W1's reader rejects with `QwenGatewayError('10032390::No Authority')` → W1's `log_error` and `log_failing_since` set and watermark unchanged, W2 still read; still failing 10 minutes later → one `gateway_down` alarm; a later success clears both columns;
  - a row of 60 s with 600 audio-in tokens (> 504) → `faster_than_real_time`; with 420 → no alarm;
  - a `held` row → `charge_state 'held'`, charge never called, alarm `held_charge` logged;
  - `releaseQwenLeases`: an end-signalled lease whose two reported sessions both have rows → released; one row missing → not released; an expired lease → released;
  - `qwenWorkspacesWithWork` lists a lease's workspace while open and for 10 minutes after expiry while a report lacks its row, and lists a workspace in `heartbeat` for 14 days after its last window;
  - `crossCheckQwenBill`: ours 32 435 vs bill 0.032435 USD → not drifted; vs 0.05 USD → `bill_drift`; an all-zero bill → not drifted.
- [ ] **Step 2: Run** `npx vitest run src/services/qwen-reconcile.sqlite.test.ts` — FAIL.
- [ ] **Step 3: Implement** the module.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(qwen): read, attribute, charge and release from Alibaba's log`.

### Task 11: Reconciler Durable Object, cron and pokes

**Files:**
- Create: `src/durable-objects/QwenReconcilerDO.ts`, `src/durable-objects/QwenReconcilerDO.test.ts`
- Modify: `wrangler.toml` (`[[durable_objects.bindings]] name = "QWEN_RECONCILER", class_name = "QwenReconcilerDO"`; `[[migrations]] tag = "v3-qwen-reconciler", new_classes = ["QwenReconcilerDO"]`), `src/env.d.ts` (`QWEN_RECONCILER: DurableObjectNamespace`), `src/index.ts` (re-export the class beside line 31; in `scheduled`, also `ctx.waitUntil(createQwenReconciler(env).poke({ tick: true }))` every minute and `poke({ daily: <yesterday UTC+8> })` on `DAILY_MAINTENANCE_CRON`), `src/routes/qwen.ts` (production `makeReconciler`)

**Interfaces:**
- Produces: `interface QwenReconciler { poke(o: { fast?: { workspaceIds: string[] }; tick?: true; daily?: string }): Promise<Response> }`; `createQwenReconciler(env): QwenReconciler` (singleton `idFromName("singleton")`, `POST https://do/poke`, never rejects).

The DO stores `fastUntil` (ms) and `fastWorkspaceIds`, `lastHeartbeatAt`, and a minute budget (`bucketWindowStart`, `bucketCount`, as `SonioxReconcilerDO.consumeBudget`). `fetch`: `fast` → union the ids, `fastUntil = now + QWEN_FAST_FOR_MS`, alarm at now; `tick` → alarm at now unless one is set sooner; `daily` → `crossCheckQwenBill`. `alarm()`: workspaces = fast ids while `now < fastUntil`, plus `slow` (on the 30 s cadence), plus `heartbeat` when `now − lastHeartbeatAt ≥ QWEN_HEARTBEAT_MS`; each read takes one budget unit (none left → retry at the window's end); `sweepQwenWorkspaces`, then `releaseQwenLeases`; next alarm at +5 s while fast, else +30 s while `slow` is non-empty, else none (the minute tick wakes it).

- [ ] **Step 1: Write the failing tests** (DO class with fake storage and fake sweep ports, as the Soniox DO tests do): a `fast` poke schedules +5 s alarms for 90 s then +30 s; `fast` reads only the named workspaces; no work → no next alarm; the heartbeat reads every 14-day workspace once per 5 minutes; the 61st read in a minute waits for the next window; `daily` calls the cross-check with the given day.
- [ ] **Step 2: Run** `npx vitest run src/durable-objects/QwenReconcilerDO.test.ts` — FAIL.
- [ ] **Step 3: Implement** the DO, the factory, the wrangler entries and the cron and route wiring.
- [ ] **Step 4: Run** it and `npx tsc --noEmit` — PASS.
- [ ] **Step 5: Commit** `feat(qwen): the reconciler's cadence, budget and daily cross-check`.

### Task 12: Admin API

**Files:**
- Create: `src/admin/api/qwen-data.ts`, `src/admin/api/qwen-data.sqlite.test.ts`, `src/admin/api/handlers/qwen.handler.ts`, `src/admin/api/handlers/qwen.handler.test.ts`
- Modify: `src/admin/api/index.ts`, `src/admin/api/sessions-data.ts` (`ledgerStatus` treats `provider === 'qwen'` like `'soniox'`)

**Interfaces:**
- Consumes: reader (4), crypto (3), mint (5).
- Produces (all under `requireAdmin`; every write adds a `qwen_key_events` row with `c.get('adminUserId')`, the action and the note):
  - `GET /api/admin/qwen/workspaces` → `{ workspaces: { id, alibabaWorkspaceId, tenantId, name, status, keys, held, free, logWatermarkMs, logReadAt, logError }[] }`
  - `POST /api/admin/qwen/workspaces` `{ alibabaWorkspaceId, note? }` — looks it up in `listWorkspaces()` (400 `WORKSPACE_NOT_FOUND`), reads its log once with its tenant id (400 `WORKSPACE_UNREADABLE` with the gateway detail), inserts; action `workspace_add`.
  - `POST /api/admin/qwen/workspaces/:id/status` `{ status: 'active' | 'paused', note? }`; action `workspace_status`.
  - `GET /api/admin/qwen/keys?workspace=<id>` → `{ summary: { workspaces, active, held, free, sessionsThisMinute, openAlarms }, keys: { id, workspaceId, workspaceName, apikeyId, label, secretLast4, status, pauseReason, heldUntil, holder: { accountId, email, leaseId, legs, openedAt, expiresAt } | null, lastIssuedAt, lastIssuedTo, today: { tokens, sessions, providerCostMicroUsd, chargedMicroUsd }, alarms: { unclaimed, held, mismatch } }[] }`, most recently issued first.
  - `GET /api/admin/qwen/keys/:id/windows?cursor=<openedAt>` → `{ windows: { …window, sessions: usage rows }[], unclaimed: usage rows, events: qwen_key_events rows, nextCursor }` (page of 20).
  - `POST /api/admin/qwen/keys` `{ workspaceId, apikeyId, label, secret, note? }` — mints once with the secret (400 `SECRET_REFUSED` when refused), stores `encryptQwenSecret(secret)` and `secretLast4`; action `key_add`.
  - `POST /api/admin/qwen/keys/:id/status` `{ status: 'active' | 'paused', note? }`; action `key_status` (resuming clears `pause_reason`).
  - `POST /api/admin/qwen/keys/:id/secret` `{ secret, note? }` — checked by a mint the same way; action `key_secret`.
  - `GET /api/admin/qwen/audit` → per account over 14 days: `{ accountId, email, unreported, mismatched, reportIgnored }[]` from `qwen_usage_logs.attributed_by` / `report_ignored`.
  - New `ADMIN_ERROR_CODES`: `WORKSPACE_NOT_FOUND`, `WORKSPACE_UNREADABLE`, `SECRET_REFUSED` (400).

- [ ] **Step 1: Write the failing tests:** handler tests with a hand-made `c` (pattern of `sessions.handler.test.ts:5-18`) for every route's 200 and 400; a data test (sqlite) that a held key shows its holder and countdown fields, that `today` sums only today's rows, and that **no response of any route contains the plaintext secret** (serialize each body and search for it); writes leave one `qwen_key_events` row each with the admin's id.
- [ ] **Step 2: Run** `npx vitest run src/admin/api/qwen-data.sqlite.test.ts src/admin/api/handlers/qwen.handler.test.ts src/admin/boundary.test.ts` — FAIL.
- [ ] **Step 3: Implement** data, handlers and routes (keep `src/admin` free of `durable-objects` imports, as `boundary.test.ts` requires).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(admin): see and manage the Qwen key pool`.

### Task 13: Admin page

**Files:**
- Create: `web/src/admin/lib/qwen-keys-view.ts`, `web/src/admin/lib/qwen-keys-view.test.ts`, `web/src/admin/pages/QwenKeysPage.tsx`, `web/src/admin/pages/QwenKeysPage.scss`
- Modify: `web/src/admin/lib/admin-api.ts` (types mirrored from Task 12; `getQwenWorkspaces`, `addQwenWorkspace`, `setQwenWorkspaceStatus`, `getQwenKeys(workspace?)`, `getQwenKeyWindows(id, cursor?)`, `addQwenKey`, `setQwenKeyStatus`, `replaceQwenKeySecret`, `getQwenAudit`), `web/src/admin/pages/index.ts`, `web/src/admin/AdminApp.tsx` (`<Route path="qwen-keys" element={<QwenKeysPage />} />`), `web/src/admin/layout/AdminLayout.tsx` (nav item `{ path: '/admin/qwen-keys', icon: KeyRound, labelKey: 'admin.nav.qwenKeys' }`), `web/src/locales/docs/en.ts`, `web/src/locales/docs/zh.ts`

**Interfaces:**
- Consumes: the admin API of Task 12.
- Produces: `slotStateLabel(key, now: number): { state: 'free' | 'held' | 'paused'; remainingS: number | null }`; `formatCountdown(s: number): string` (`'0:41'`); `pauseReasonKey(reason: string | null): string` (`'mint_refused'` → `'admin.qwenKeys.pausedRefused'`, else `'admin.qwenKeys.pausedByHand'`).

The page, in the layout of `SessionsPage.tsx`: the summary strip; the workspaces table with "Add workspace" and pause/resume; the keys table (`DataTable`) with a workspace filter, state pill and countdown (re-rendered each second), holder, last issue, today, alarms, row actions pause/resume and "Replace secret"; "Add key" (workspace select, key id, label, secret as a password field, note); a row click opens the key's history (windows with their sessions, unclaimed rows, events, "Load more" by cursor); an audit table. Copy keys under `admin.qwenKeys.*` in `en.ts` and `zh.ts`.

- [ ] **Step 1: Write the failing test** `qwen-keys-view.test.ts`: held until now + 41 000 → `{state:'held', remainingS:41}` and `formatCountdown(41) === '0:41'`; held until the past → `free`; `status 'paused'` → `paused` whatever `heldUntil`; `formatCountdown(3600) === '60:00'`; the two `pauseReasonKey` cases.
- [ ] **Step 2: Run** `npx vitest run web/src/admin/lib/qwen-keys-view.test.ts` — FAIL.
- [ ] **Step 3: Implement** the helpers, the API client functions, the page, the route, the nav item and the copy.
- [ ] **Step 4: Run** the test, `cd web && npx tsc --noEmit`, and the whole suite `npx vitest run` — PASS.
- [ ] **Step 5: Commit** `feat(admin): the Qwen key pool page`.

---

## Before release (owner's steps, not code)

Set `QWEN_RAM_ACCESS_KEY_ID`, `QWEN_RAM_ACCESS_KEY_SECRET` (the rotated RAM key) and `QWEN_KEY_ENCRYPTION_KEY` with `wrangler secret put`; the deploy applies migration 0021 and the `v3-qwen-reconciler` DO migration; add the workspace and its 20 keys on the page.
