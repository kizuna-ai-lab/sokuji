# Kizuna AI Managed Qwen — Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sokuji offers `kizunaai_qwen`, a flagged managed twin of Qwen LiveTranslate that runs on a token lent by sokuji-backend and reports each session's ids so the backend can attribute and bill it.

**Architecture:** `managed(qwenLiveTranslateProvider, …)` keeps the own-key adapter and settings and swaps the key for the sign-in and a lease. The lease calls `/api/qwen/session-key`, hands every leg the token, the grant's endpoint and a port; on `session.created` the adapter calls the port with the session id and the handshake's `x-request-id`, which the header seam reads where it sets the upgrade's headers (Electron's main process, the extension's background).

**Tech Stack:** React + TypeScript, Vitest (jsdom), Electron main process (CommonJS), Chrome MV3 background.

**Spec:** `docs/superpowers/specs/2026-10-17-kizuna-managed-qwen-design.md` (commit `3a8ab39a9`), §3 (routes) and §4 (client). The backend plan beside this one, `2026-10-17-kizuna-managed-qwen-backend.md`, Task 8, fixes the route contract this plan calls.

## Global Constraints

- Routes, under `getApiUrl()` (`src/utils/environment.ts:134`), `Authorization: Bearer <shape.auth.getToken()>`, `Content-Type: application/json`:
  - `POST /qwen/session-key` `{ legs: ['speaker'] | ['participant'] | ['speaker','participant'], speech: { speaker: boolean, participant: boolean } }` → 200 `{ leaseId, endpoint: 'intl', apiKey, expiresAt, maxSessionDurationSeconds, budgetMicroUsd, rateUsdPerHour }`; 401, 402 `{requiredMicroUsd, balanceMicroUsd}`, 403, 409 `{retryAfterMs}`, 502, 503 `{error:'qwen_busy', retryAfterMs}`.
  - `POST /qwen/session-started` `{ leaseId, leg, taskUuid, requestId? }` (omit `requestId` when unknown).
  - `POST /qwen/session-end` `{ leaseId }`.
- `speech.speaker = legs has 'speaker' && !shape.textOnly`; `speech.participant = legs has 'participant' && shape.participantSpeech`.
- Refusal → `AdapterStartError` code: 401 `sign_in_required`, 402 `insufficient_balance`, 403 `wallet_frozen`, 409 (after one retry) `session_conflict`, 502 `qwen_service_unavailable`, 503 `qwen_service_busy`; timeout `qwen_service_unavailable`, transport `network`.
- Timings: session-key bound 15 000 ms; a 409 waits `retryAfterMs` (finite ≥ 0, else 3 000) once; session-started retries after 500, 1 000, 2 000 ms on 5xx or transport, first attempt `keepalive: true`; session-end as Soniox's (`SESSION_END_BUDGET_MS = 4_000`, delays `[500, 1_000]`, first attempt `keepalive`).
- Grant end: `maxSessionDurationSeconds × 1000` on the run clock; `maxSessionDurationSeconds >= 3600` → `{code:'segment_ended'}` expected, else `{code:'budget_exhausted', message:'Session budget exhausted'}`.
- Start floor (µUSD, mirrors the backend's `floorMicroUsd`): `Math.ceil((60/3600) × rateUsdPerHour × 1e6)` with 3.654 USD/h per speaking leg and 0.954 per text-only leg → one speaking 60 900, one text-only 15 900, speaking + text-only 76 800, two speaking 121 800.
- The twin is `flagged: true`, sits right after `kizunaSonioxProvider` in `RELEASED`, id `kizunaai_qwen`, settings key `kizunaQwen`, name `KizunaAI Qwen`, `signedOut: 'Sign in to use Kizuna AI Qwen.'`.
- No token or `x-request-id` in a frame or log line beyond what the conformance suite allows (`frame-secret`); `src/providers` has no `console.error`/`console.warn`; adapters only emit events; Qwen's session side stays `['adapter.ts','endpoints.ts','segments.ts','wire.ts']` (type-only imports from elsewhere in the folder).
- Code and comments in English; commits conventional, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: `npx vitest run <paths>`; `npx tsc --noEmit`. Electron and extension tests are outside CI's subset: run them by path.

## Review Focus

1. A `session-started` report that keeps failing (offline, 5xx) is retried three times and then dropped with a frame — it never ends or stalls the run. (Task 6.)
2. The user stops before a leg's `session.created`, or while a report is in flight: no report goes out after `release()`, and `session-end` is still sent once. (Task 6.)
3. A platform that cannot read `x-request-id` (or the web build, which has no seam) still reports, without `requestId`. (Tasks 2 and 5.)
4. A 409 then 200 starts; two 409s refuse with `session_conflict` and wait no longer than one `retryAfterMs`. (Task 6.)
5. A grant capped at 3600 s ends as `segment_ended` (expected, Start continues), a smaller one as `budget_exhausted`. (Task 6.)

## File Structure

| File | Change |
|---|---|
| `src/lib/contract/headerSocket.ts`, `src/lib/contract/testing/headerSocket.ts` | The seam's `onRequestId` callback; `clear` answers the request id. |
| `electron/ws-header-rules.js`, `electron/better-auth-adapter.js`, `electron/main.js` | Read the 101's `x-request-id` for a taken rule; answer it on clear. |
| `extension/background/background.js`, `extension/manifest.json` | The same with `chrome.webRequest`. |
| `src/providers/qwen_livetranslate/settings.ts`, `adapter.ts` | `QwenCredentials.endpoint` and `.lease`; the port call. |
| `src/providers/qwen_livetranslate/lease.ts`, `kizunaBudget.ts`, `kizuna.ts` | The lease, the floor, the twin. |
| `src/lib/provider/managed.ts` | A `flagged?: true` override. |
| `src/providers/registry.ts`, `src/lib/view/noticeText.ts`, `src/locales/*/translation.json` | Registration and copy. |

---

### Task 1: Spike — does each platform see the 101's `x-request-id`?

No production code. Answers spec §4's open question before Tasks 3 and 4.

- [ ] **Step 1: Electron.** In a scratch change (not committed), add to the existing `onHeadersReceived` listener in `electron/better-auth-adapter.js:184` a branch that, for `details.resourceType === 'webSocket'`, logs `details.url` and `details.responseHeaders['x-request-id']` from the main process; widen its `filter` (150-160) with `'wss://*/*'`. Run `npm run electron:dev`, start a run on the own-key **Qwen LiveTranslate** with a test key (no speech needed; a silent run of a few seconds costs nothing billable), and read the main process console.
- [ ] **Step 2: Extension.** In a scratch change, add `"webRequest"` to `extension/manifest.json` permissions and, in `extension/background/background.js`, `chrome.webRequest.onHeadersReceived.addListener(d => console.log(d.url, d.responseHeaders), { urls: ['wss://*/*'], types: ['websocket'] }, ['responseHeaders'])`. Load the unpacked dev build, run the same Qwen start from the side panel, and read the service worker console.
- [ ] **Step 3: Record** for each platform whether a `x-request-id` header appeared on the `maas.qwencloudapi.com` upgrade, in a short note appended to spec §4 ("Probed <date>: Electron yes/no, extension yes/no"), and revert the scratch changes. Commit the spec note: `docs(spec): which platforms see the handshake's request id`.
- [ ] **Step 4: Decide.** A platform that showed no header skips its task (3 or 4); its legs report without `requestId`, which the backend accepts.

### Task 2: The seam's `onRequestId` callback

**Files:**
- Modify: `src/lib/contract/headerSocket.ts`, `src/lib/contract/headerSocket.test.ts`, `src/lib/contract/testing/headerSocket.ts`

**Interfaces:**
- Produces:
  - `OpenHeaderSocket` options gain `onRequestId?: (id: string) => void`: `(url, headers, o: { signal; clock; onRequestId? }) => Promise<WebSocket>` (resolved type unchanged, so OpenAI Live needs no edit).
  - `HeaderRegistrar.clear(rule): Promise<{ requestId?: string } | void>` (was `void`).
  - On the socket's first `open`, the seam awaits `clear`'s answer (bounded by the remaining `HEADER_SOCKET_CAP_MS`; a late or failed answer counts as none), calls `onRequestId(requestId)` when it is a non-empty string, then resolves. On `error`/`close` it clears as today and never calls `onRequestId`.
  - `electronRegistrar.clear` returns the `ws-headers-clear` invoke's answer; `extensionRegistrar.clear` returns the `WS_HEADERS_CLEAR` message's response.
  - `fakeHeaderSockets(sockets?, o?: { requestIds?: string[] })` hands out the next id of `requestIds` per open (none when absent).

- [ ] **Step 1: Write the failing tests** in `headerSocket.test.ts`: a registrar whose `clear` answers `{ requestId: '6c862ba2-2beb-9263-b94a-e6789bdd25bf' }` → `onRequestId` called once with it before the promise resolves; `clear` answering `undefined`, `{}`, or rejecting → `onRequestId` not called and the socket still resolves; a socket that errors before `open` → `onRequestId` never called; the gate is still let go after `clear`.
- [ ] **Step 2: Run** `npx vitest run src/lib/contract/headerSocket.test.ts` — FAIL.
- [ ] **Step 3: Implement** in `createHeaderSocket` (89-190) and the two registrars (196-230), and the fake.
- [ ] **Step 4: Run** `npx vitest run src/lib/contract src/providers/openai_live` — PASS.
- [ ] **Step 5: Commit** `feat(contract): the header seam answers the handshake's request id`.

### Task 3: Electron reads `x-request-id` (skip if Task 1 said no)

**Files:**
- Modify: `electron/ws-header-rules.js`, `electron/better-auth-adapter.js`, `electron/main.js`, `electron/wsHeaderRules.wiring.test.js`, `electron/better-auth-adapter.test.js`
- Test: `electron/ws-header-rules.test.js` (new, or extend the existing rules test if one exists)

**Interfaces:**
- Produces on `createWsHeaderRules()`: `take(url, requestHeaders)` also remembers the taken rule's `host+path` as awaiting a response; `noteResponse(url: string, responseHeaders: Record<string, string[] | string>): void` stores the `x-request-id` (header name case-insensitive) for an awaiting rule matching `url`; `clear({ host, path })` now returns `{ requestId?: string }` and forgets both.
- `betterAuthAdapter({ …, onWebSocketResponse?: (details) => void })`: its single `onHeadersReceived` listener's filter gains `'wss://*/*'`; for `details.resourceType === 'webSocket'` it calls `onWebSocketResponse(details)` and returns the headers untouched; every other URL keeps today's cookie and CORS handling.
- `main.js`: passes `onWebSocketResponse: (d) => wsHeaderRules.noteResponse(d.url, d.responseHeaders)`; `ipcMain.handle('ws-headers-clear', …)` returns `wsHeaderRules.clear(args)`.

- [ ] **Step 1: Write the failing tests:** rules — take → noteResponse with `{'X-Request-Id': ['abc']}` → `clear` answers `{requestId:'abc'}`; noteResponse for a URL with no taken rule → ignored; clear with nothing noted → `{}`; a second clear → `{}`. Better Auth adapter — a websocket `details` calls the hook and passes headers through unchanged; an auth URL still gets its CORS rewrite. Wiring — update the verbatim expectations to the new `noteResponse` and `clear` lines (the test still forbids `wsHeaderRules.get(` / `.delete(`).
- [ ] **Step 2: Run** `npx vitest run electron/ws-header-rules.test.js electron/wsHeaderRules.wiring.test.js electron/better-auth-adapter.test.js` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS. Then `npm run electron:dev`, start an own-key Qwen run, and confirm in DevTools that the seam's `onRequestId` fired (a temporary `console.info` in the adapter, removed before commit).
- [ ] **Step 5: Commit** `feat(electron): answer the WebSocket handshake's request id on clear`.

### Task 4: The extension reads `x-request-id` (skip if Task 1 said no)

**Files:**
- Modify: `extension/background/background.js`, `extension/manifest.json` (`"webRequest"` in `permissions`), `extension/background/background.wsHeaders.test.ts`

**Interfaces:**
- Produces: a `chrome.webRequest.onHeadersReceived` listener (`{ urls: ['wss://*/*'], types: ['websocket'] }`, `['responseHeaders']`) that stores `x-request-id` for a URL matching a set rule's `host+path`; the `WS_HEADERS_CLEAR` handler (488-499) responds `{ requestId }` for that rule and forgets it; a rule cleared before any response answers `{}`.

- [ ] **Step 1: Write the failing tests** in `background.wsHeaders.test.ts` with the existing chrome fakes plus a `webRequest.onHeadersReceived` fake: set rule for `maas.qwencloudapi.com/api-ws/v1/realtime` → fire a websocket response with `x-request-id: abc` → `WS_HEADERS_CLEAR` responds `{requestId:'abc'}`; a response for another host is ignored; clear without a response → `{}`.
- [ ] **Step 2: Run** `npx vitest run extension/background/background.wsHeaders.test.ts extension/manifest.consistency.test.ts` — FAIL (the first).
- [ ] **Step 3: Implement** the listener, the response, the permission.
- [ ] **Step 4: Run** — PASS. Load the unpacked build: Chrome shows whether adding `webRequest` asks for approval on an update; write that answer into spec §4 next to Task 1's note.
- [ ] **Step 5: Commit** `feat(extension): answer the WebSocket handshake's request id on clear`.

### Task 5: Credentials carry the grant; the adapter reports

**Files:**
- Modify: `src/providers/qwen_livetranslate/settings.ts`, `src/providers/qwen_livetranslate/adapter.ts`, `src/providers/qwen_livetranslate/adapter.test.ts`, `src/providers/qwen_livetranslate/testing.ts`

**Interfaces:**
- Consumes: `onRequestId` (Task 2), `fakeHeaderSockets(…, { requestIds })`.
- Produces:
  - `export interface QwenLeasePort { sessionCreated(id: string, requestId?: string): void }`
  - `QwenCredentials { apiKey: string; endpoint?: EndpointId; lease?: QwenLeasePort }` (`qwenCredentials.read` unchanged: an own key carries neither).
  - Adapter: `open()` uses `config.endpoint ?? credentials.endpoint ?? await this.detect()`; `connect()` passes `onRequestId: (id) => { this.requestId = id }` to `openHeaderSocket` (412); `handshake()` on `session.created` (445-452) calls `credentials.lease?.sessionCreated(String(s.id), this.requestId)` once per socket, after framing it.

- [ ] **Step 1: Write the failing tests** in `adapter.test.ts`:
  - `it('a managed leg dials the grant's storefront without detecting')` — credentials `{ apiKey: 'st-token', endpoint: 'intl', lease }` and `config.endpoint: null` → `detect` never called, the socket URL is intl's;
  - `it('reports the session id and the handshake's request id')` — `requestIds: ['6c862ba2-2beb-9263-b94a-e6789bdd25bf']`, server `session.created` `{session:{id:'sess_DQE8tkefuVBLmm4BCkinn'}}` → `sessionCreated('sess_DQE8tkefuVBLmm4BCkinn', '6c862ba2-2beb-9263-b94a-e6789bdd25bf')` once;
  - `it('reports without a request id when the seam has none')` → `sessionCreated('sess_…', undefined)`;
  - an own key (no `lease`) runs as today;
  - the conformance and lifecycle runs (40-130) pass with `SECRETS` including `'st-token'`.
- [ ] **Step 2: Run** `npx vitest run src/providers/qwen_livetranslate/adapter.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/providers/qwen_livetranslate src/providers/sessionSide.consistency.test.ts` — PASS.
- [ ] **Step 5: Commit** `feat(qwen): a managed leg dials the grant and reports its ids`.

### Task 6: The lease

**Files:**
- Create: `src/providers/qwen_livetranslate/lease.ts`, `src/providers/qwen_livetranslate/lease.test.ts`
- Modify: `src/lib/view/noticeText.ts` (aliases `qwen_service_unavailable` → `mainPanel.qwenServiceUnavailable`, `qwen_service_busy` → `mainPanel.qwenServiceBusy`), `src/locales/*/translation.json` (those two keys in all 30 catalogs: each catalog's `mainPanel.sonioxServiceUnavailable` / `sonioxServiceBusy` with `Soniox` replaced by `Qwen` — en: "Qwen is temporarily unavailable. Please try again in a moment." / "Qwen is at capacity right now. Please try again shortly.")

**Interfaces:**
- Consumes: `QwenCredentials`, `QwenLeasePort` (Task 5); `RunShape`, `LeaseContext`, `Resources` (`src/lib/session/types.ts`); `AdapterStartError`.
- Produces: `interface QwenLeaseDeps { fetch?: (url: string, init: RequestInit) => Promise<Response>; apiUrl?: () => string }`; `createQwenLease(deps?: QwenLeaseDeps): (shape: RunShape, s: QwenSettings, ctx: LeaseContext) => Promise<Resources<QwenCredentials>>`.
  - `credentials(leg)` → `{ apiKey: grant.apiKey, endpoint: grant.endpoint, lease: port(leg) }`; `budget` → `{ totalMs, endsAt }`; `release()` cancels the grant timer, stops reports, sends session-end.
  - `port(leg).sessionCreated(id, requestId)` posts `session-started` with `{ leaseId, leg, taskUuid: id, ...(requestId ? { requestId } : {}) }` — at most once per (leg, id), never after the run ended or `release()`.
  - Frames (same names as Soniox's lease): `session.key_requested`, `session.retry`, `session.refused`, `session.lease_acquired`, `session.started`, `session.started_refused`, `session.notify_failed`, `session.end`, `session.lease_ended`; none carries `apiKey`.
  - Like Soniox's lease, a new `acquire` cancels a previous instance's end signal still retrying.

- [ ] **Step 1: Write the failing tests** in `lease.test.ts` (fake fetch, tracked clock, a `LeaseContext` stub):
  - body for speaker-only text-only `{legs:['speaker'], speech:{speaker:false, participant:false}}`; for Both with participant speech `{legs:['speaker','participant'], speech:{speaker:true, participant:true}}`; the `Authorization` header carries the auth token;
  - a 200 grant → `credentials('speaker')` is `{ apiKey, endpoint:'intl', lease }`, `budget.totalMs = maxSessionDurationSeconds × 1000`;
  - 409 `{retryAfterMs: 2500}` then 200 → started after exactly 2 500 ms; 409 twice → `AdapterStartError` `session_conflict`;
  - 401/402/403/502/503 → the five codes; 402's frame carries `requiredMicroUsd` and `balanceMicroUsd`; no answer within 15 000 ms → `qwen_service_unavailable`;
  - `maxSessionDurationSeconds: 3600` → at 3 600 000 ms `ctx.end({code:'segment_ended'}, {expected:true})`; `985` → `ctx.end({code:'budget_exhausted', …}, {expected:false})` at 985 000 ms;
  - `sessionCreated('sess_a', 'rid')` posts once with `keepalive: true` and both ids; a second call with the same id posts nothing; without a request id the body has no `requestId` key;
  - a report answering 503 is retried at +500, +1 000, +2 000 ms, then frames `session.notify_failed` and never calls `ctx.end`;
  - `sessionCreated` after `release()` posts nothing; `release()` posts `session-end` `{leaseId}` once;
  - no frame contains the grant's `apiKey`.
- [ ] **Step 2: Run** `npx vitest run src/providers/qwen_livetranslate/lease.test.ts` — FAIL.
- [ ] **Step 3: Implement** `lease.ts`, the two aliases and the 60 catalog lines (a one-off node script over `src/locales/*/translation.json`, not committed).
- [ ] **Step 4: Run** `npx vitest run src/providers/qwen_livetranslate src/locales src/lib/view` — PASS.
- [ ] **Step 5: Commit** `feat(qwen): the managed lease`.

### Task 7: The twin, its floor and its registration

**Files:**
- Create: `src/providers/qwen_livetranslate/kizunaBudget.ts`, `kizunaBudget.test.ts`, `kizuna.ts`, `kizuna.test.ts`
- Modify: `src/lib/provider/managed.ts`, `src/lib/provider/managed.test.ts`, `src/providers/registry.ts`, `src/providers/registry.test.ts`, `src/locales/*/translation.json`

**Interfaces:**
- Consumes: `createQwenLease` (Task 6); `managed`, `kizunaHostedIcon(QwenIcon)` (`src/components/Icons/ProviderIcons.tsx:199,273`); `QwenSettingsView`, `QwenVoiceSummary`.
- Produces:
  - `ManagedOverrides` gains `flagged?: true`, copied onto the twin when given (the base's `flagged`/`testerSwitch` still never carry over).
  - `kizunaQwenMinimumBalance(shape: BalanceShape): number` (the start floor of Global Constraints).
  - `export const kizunaQwenProvider = managed(qwenLiveTranslateProvider, { id: 'kizunaai_qwen', vendor: 'Qwen', icon: kizunaHostedIcon(QwenIcon), settingsKey: 'kizunaQwen', Settings: QwenSettingsView, VoiceSummary: QwenVoiceSummary, signedOut: 'Sign in to use Kizuna AI Qwen.', flagged: true, session: { acquire: createQwenLease(), minimumBalance: kizunaQwenMinimumBalance } })`.
  - `RELEASED` = `[kizunaSonioxProvider, kizunaQwenProvider, localInferenceProvider, …]`.
  - Catalogs: `providers.kizunaai_qwen.name = "KizunaAI Qwen"` in all 30; `.description` = that catalog's `providers.qwen_livetranslate.description`.

- [ ] **Step 1: Write the failing tests:**
  - `managed.test.ts`: `it('a twin can be flagged on its own')` — `managed(base, { …, flagged: true }).flagged === true`; the existing test that a base's `flagged`/`testerSwitch` are left behind stays green.
  - `kizunaBudget.test.ts`: speaker-only speaking → 60 900; speaker-only `textOnly` → 15 900; Both with participant text only → 76 800; Both with participant speech → 121 800; participant-only without speech → 15 900.
  - `kizuna.test.ts`: `kind 'managed'`, `flagged true`, platforms `['electron','extension']`, no credential fields, `credentials.read` signed out → `code 'sign_in_required'` with the `signedOut` sentence, `session.acquire` and `session.minimumBalance` present.
  - `registry.test.ts`: the pinned release list is unchanged (the twin is flagged, so a release build does not offer it); the development build adds the two fakes **and** `kizunaai_qwen` (update that test); a release build with `VITE_ENABLED_PROVIDERS=kizunaai_qwen` and the umbrella on offers it second, after `kizunaai_soniox`; the settings key is unique; en has its name and description.
- [ ] **Step 2: Run** `npx vitest run src/lib/provider/managed.test.ts src/providers/qwen_livetranslate src/providers/registry.test.ts` — FAIL.
- [ ] **Step 3: Implement** the override, the floor, the twin, the registry line and the 60 catalog lines (a one-off node script, not committed).
- [ ] **Step 4: Run** the CI subset `npx vitest run src/lib/contract src/lib/session src/lib/provider src/providers src/components/providers src/locales` and `npx tsc --noEmit` — PASS.
- [ ] **Step 5: Live check** (development build, which offers flagged providers; the backend of the other plan on a development deployment): sign in, pick KizunaAI Qwen, run Both for a minute with speech, stop; the backend's admin page shows the key held then free, two windows' sessions attributed `both` with their request ids, and the charges. Note the outcome in the PR.
- [ ] **Step 6: Commit** `feat(qwen): Kizuna AI Qwen, flagged`.
