# Session reconnect (client) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Soniox or Qwen connection drops unexpectedly, managed or with the user's own key, it reconnects within 30 s. The run, the conversation and the countdown carry on, and the user sees the attempt count and elapsed time while it reconnects and one notice after.

**Architecture:**
- **Shared policy:** a platform-neutral reconnector in `src/lib/session/reconnect.ts` owns the attempt schedule, the 30 s budget, the flapping rule, the online wake and the frames. Each adapter creates one per connection and gives it an `attempt()` callback that gets credentials and brings a new socket live.
- **Adapters:** they classify drops, reuse their start-path connect, and get managed credentials from a new `reissue()` on their lease port.
- **Run layer:** the run turns the richer `reconnecting` / `reconnected` / `failed` payloads into leg state for the status line, a conversation notice and the PostHog events. The events' types are shared with mobile through `src/lib/session/reconnectEvents.ts`.

**Tech Stack:** TypeScript, React, Vitest, the repo's virtual clock and fake sockets (`src/lib/contract/testing/*`), i18next catalogs (30 locales).

**Spec:** `docs/superpowers/specs/2026-11-05-session-reconnect-design.md` at 03786e5ca, on this branch. The backend half is `kizuna-ai-lab/sokuji-backend` `docs/superpowers/plans/2026-11-05-reconnect-reissue.md` on branch `feat/reconnect-reissue`.

## Rulings made during implementation

The executing session recorded these against the plan text below; the spec is updated where they change it. Full list with reasons: the SDD ledger, summarised at hand-over.
- Every Soniox 5xx reconnects (spec §4.1), not only 503/408.
- Reconnect payload types live in `src/lib/contract/reconnect.ts` (lib/contract imports nothing from lib/session).
- `AdapterSession.info.shared` marks a shared-Both pair; its analytics and totals count once per connection; the restored notice and the new events need the new payloads, so Gemini/OpenAI keep today's UI.
- `notices.connection_restored` landed with Task 4, not Task 5.
- `SONIOX_STALL_MS` is 5000, measured: on a real 263 s managed Soniox session the longest gap between server messages was 1071 ms during speech and 1214 ms during silence (p99 912 / 1213 ms), so Task 7 Step 1's max(5000, 2 × the longest gap) keeps 5000.
- Qwen detects a dead connection after all (spec §4.2), because a real managed Qwen session whose network was cut stayed open and unnoticed until it was stopped. Under automatic turns an `input_audio_buffer.clear` probe goes every 2 000 ms (`QWEN_PROBE_MS`); server VAD refuses it within 100 ms (probe 2026-11-06), and a probe unanswered for 6 000 ms (`QWEN_STALL_MS`) drops as `stall`. Under push-to-talk there is no probe, and a commit unanswered for 5 000 ms (`QWEN_TURN_ANSWER_MS`) drops as `stall`.
- A managed Qwen reconnect never dials a token minted before its drop (owner, 2026-11-06; spec §4.2, §6). `QwenLeasePort.reissue({ notBefore, refused? })` takes the drop's start on the run's clock; the lease serves only a token it fetched at or after it and still valid, else one request that concurrent asks share, and never the grant's token. Qwen's `session-started` is tried again after 1, 2, 5 and 10 s, then every 30 s, while its connection is open, as Soniox's is; the port gains `sessionEnded(id)`. The 30 s budget, `lease_ended` ending the session and the 429 retry are unchanged. This replaces Task 8's `a token still valid is reused without a request` and the Qwen sentence of the Global Constraints' credentials line.

## Global Constraints

- Schedule: attempts at 0, then 250, 500, 1 000, 2 000 and 4 000 ms, then every 4 000 ms, until 30 000 ms after the drop. Each attempt's connect is aborted at the budget's end.
- Flapping: a drop within 10 000 ms of the previous reconnect keeps that drop's deadline, but never less than 5 000 ms from now. At most 100 reconnects per connection (spec §4.2). The 101st drop gives up as `session_cap`.
- What reconnects is §4.1. Close codes 1000, 1001, 1005, 1006 and 1011–1014 reconnect. Codes 1003 and 1007–1010 end. Any other close code ends. Soniox: `503`, `408`, `socket_error`, a connect timeout and a stall reconnect; `401`, `402`, `403` (except at grant end), `429` and other 4xx end. Qwen: `server` reconnects; `auth`, `rate_limit`, `client` and `model_access_denied` end.
- Credentials are fetched at most once per drop. A Soniox key whose socket never opened is reused while its start window lasts, until 1 s before its `expiresAt`. A Qwen token is reused until 5 s before its `expiresAt`, and serves both legs.
- Reissue refusals: `lease_ended`, `reissue_limit`, `sign_in_required`, `wallet_frozen`, and `unsupported` for a 404 or any other 4xx without a code. A 429 from the reissue (its per-minute limit) is not a refusal: it is a failed attempt, like a 5xx. Every refusal stops the attempts. `sign_in_required` and `wallet_frozen` show as themselves. `lease_ended` ends as a lease end when the lease is at its grant end, and as `connection_lost` otherwise. Everything else shows `connection_lost`.
- During the gap, audio is dropped and agent text is not sent. In-flight segments close as they stand (`utterances.abandon()`, `QwenSegments.stop()`). Nothing is re-sent. Part C, deferred to a follow-up, would change this.
- Copy, in English. The other 29 locales are translated in the same commit, and `{{placeholders}}` must survive verbatim:
  - `connectionStatus.reconnectingAttempt`: "Reconnecting… (attempt {{attempt}}, {{seconds}} s)"
  - `notices.connection_restored`: "Connection lost and restored"
- Analytics carry no content, keys or reference ids. `client` is `desktop` for `electron` and `web`, and `extension` for `extension`. `network` is `wifi`, `cellular`, `ethernet` or `unknown`. `api_error` is sent at give-up only, as today. `connection_status` is unchanged and still sent once per drop.
- `reconnect.ts` and `reconnectEvents.ts` import nothing from the DOM, React, Electron, `src/stores`, `utils/environment` or `lib/diagnostics/report`. They use only the injected `Clock`, so `vendor/sokuji` on mobile can import them.
- Gemini and OpenAI adapters are unchanged. Their payload-less `reconnecting()` / `reconnected()` calls stay valid.
- Never `Date.now()` or global timers on the session side (`sessionSide.consistency.test.ts`).

## Review Focus

1. **The user presses Stop while attempts are running.** Waits and in-flight connects are cancelled with no stray timers. `connection_reconnect_failed` goes out with reason `stopped`, and no `failed` event follows. Tested in Task 4.
2. **Both legs of split Both drop at the same moment.** The two reconnectors run independently, with one status line naming the earlier drop. On Qwen, the two legs share one token fetch. Tested in Tasks 7 and 9.
3. **The network comes back in the middle of a 4 s wait.** The `online` wake starts the attempt at once. A wake during an in-flight attempt makes the next attempt skip its delay. Tested in Task 1.
4. **A reissued key expires before its socket opens**, for example when a connect stalls past 10 s. The next attempt fetches a new key and does not reuse the dead one. Tested in Task 7.
5. **The grant's own timer fires during the attempts.** The run ends as a lease end, the reconnector is cancelled, and the reason is `lease_ended`. Tested in Task 4 at the run and in Task 7 at the adapter.

---

## Part A: shared pieces

### Task 1: The reconnector

**Files:**
- Create: `src/lib/session/reconnect.ts`, `src/lib/session/reconnect.test.ts`
- Modify: `src/providers/sessionSide.consistency.test.ts`. Also scan `src/lib/session/reconnect.ts` and `reconnectEvents.ts` for global timers and `Date.now()`, and check that they import nothing from the forbidden list in Global Constraints.

**Interfaces:**
- Produces:
```ts
export const RECONNECT_DELAYS_MS: readonly number[];   // [0, 250, 500, 1000, 2000, 4000]
export const RECONNECT_REPEAT_MS: number;               // 4000
export const RECONNECT_BUDGET_MS: number;               // 30000
export const FLAP_WINDOW_MS: number;                    // 10000
export const FLAP_MIN_REMAINING_MS: number;             // 5000
export const MAX_RECONNECTS: number;                    // 100
export type DropCause = 'close' | 'error' | 'timeout' | 'stall';
export interface DropInfo { cause: DropCause; closeCode?: number; errorCode?: string; retryable: boolean; managed: boolean }
export type AttemptResult =
  | { ok: true; reissued: boolean; reissueMs: number }
  | { ok: false; final: false; code?: string; message: string; reissued: boolean; reissueMs: number }
  | { ok: false; final: true; reason: 'refused' | 'terminal_error' | 'lease_ended'; code: string; message: string; refusalCode?: string };
export interface ReconnectedInfo { attempts: number; credentialsReissued: boolean; reissueMs: number; budgetShared: boolean }
export interface GiveUp { attempts: number; reason: 'timeout' | 'refused' | 'terminal_error' | 'session_cap' | 'lease_ended'; code: string; message: string; errorCode?: string; refusalCode?: string }
export interface ReconnectorOptions {
  clock: Clock;
  frame(type: string, payload: Record<string, unknown>): void;
  reconnecting(e: { attempt: number; drop?: DropInfo }): void;   // drop only on attempt 1
  reconnected(e: ReconnectedInfo): void;
  gaveUp(e: GiveUp): void;
  attempt(ctx: { attempt: number; signal: AbortSignal }): Promise<AttemptResult>;
}
export interface Reconnector { dropped(drop: DropInfo): void; wake(): void; cancel(): void; readonly active: boolean }
export function createReconnector(o: ReconnectorOptions): Reconnector;
export function closeCodeAction(code: number | undefined): 'reconnect' | 'end';
```
- `GiveUp.code` is the code the leg fails with: `connection_lost`, except a final refusal's own code.
- Frames: `session.reconnecting {cause, code}` at the drop; `session.reconnect_failed {attempt, message}` per failed attempt; `session.reconnected {downMs, attempts}`; `session.connection_lost {attempts}` at give-up. `cancel()` emits nothing.

- [ ] **Step 1: Write the failing tests**, on `createVirtualClock(0)` via `trackedClock()`. Each test has a fake `attempt` whose answers the test queues.
  - `attempts run at 0, 250, 750, 1750, 3750, 7750, 11750 … ms after the drop` (the cumulative offsets of the schedule)
  - `an attempt still running at 30 000 ms is aborted and the reconnector gives up with timeout and code connection_lost`
  - `the last failed attempt's code is GiveUp.errorCode`
  - `a final refusal gives up at once with its reason and code`
  - `reconnecting carries attempt N on every attempt and drop on the first only`
  - `reconnected carries attempts, budgetShared false, and reissue time summed across attempts`
  - `a drop 5 s after reconnecting shares the deadline; 11 s after gets a fresh 30 s`
  - `a shared deadline is never less than 5 s away`
  - `the 101st drop gives up with session_cap without an attempt`
  - `wake during a wait starts the attempt at once; wake during an attempt skips the next delay` (Review Focus 3)
  - `cancel stops waits and aborts the attempt; nothing more is emitted and no timers are left`
  - `frames are written as listed`
  - `closeCodeAction: 1000, 1001, 1005, 1006, 1011–1014 reconnect; 1003, 1007–1010, 4000 and undefined end`

  **Ruling:** undefined ends. Socket-error paths call `dropped` directly and never pass through `closeCodeAction`.
- [ ] **Step 2: Run the tests and see them fail.** Run `npx vitest run src/lib/session/reconnect.test.ts`. Expected: FAIL. The module does not exist.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and see them pass.** Run `npx vitest run src/lib/session/reconnect.test.ts src/providers/sessionSide.consistency.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(session): a shared reconnect policy (#692)`

### Task 2: Event definitions and the leg-event payloads

**Files:**
- Create: `src/lib/session/reconnectEvents.ts`
- Modify: `src/lib/analytics.ts`. `AnalyticsEvents` extends `ReconnectAnalyticsEvents`. `translation_session_end` gains three optional fields: `reconnect_count?: number; reconnect_down_ms?: number; reconnect_failed?: boolean`.
- Modify: `src/lib/contract/adapter.ts`, at `AdapterEvents` (106–144) and `AdapterSession`.
- Test: `src/lib/contract/events.test.ts` (or the existing conformance tests), `src/lib/session/reconnectEvents.test.ts`

**Interfaces:**
- Produces in `reconnectEvents.ts`:
  - `ReconnectClient`: `'desktop' | 'extension' | 'ios' | 'android'`
  - `NetworkType`: `'wifi' | 'cellular' | 'ethernet' | 'unknown'`
  - `ReconnectAnalyticsEvents`, holding the three events with exactly the properties in spec §4.5:
    - `connection_dropped`: `{ session_id; provider; managed: boolean; channel: 'speaker' | 'participant' | 'shared'; cause: DropCause; close_code?: number; error_code?: string; retryable: boolean; session_elapsed_ms: number; drop_index: number; since_last_reconnect_ms?: number; online?: boolean; client: ReconnectClient; network?: NetworkType }`
    - `connection_reconnected`: `{ session_id; provider; managed; channel; down_ms; attempts; credentials_reissued; reissue_ms; drop_index; budget_shared; client; network? }`
    - `connection_reconnect_failed`: `{ session_id; provider; managed; channel; down_ms; attempts; reason: GiveUp['reason'] | 'stopped'; error_code?; refusal_code?; drop_index; client }`
  - `reconnectClient(platform: 'electron' | 'extension' | 'web'): ReconnectClient`
- Produces in `adapter.ts`:
  - `reconnecting(e?: { attempt: number; drop?: DropInfo }): void`
  - `reconnected(e?: ReconnectedInfo): void`
  - `failed(e: { message: string; code?: string; cause?: unknown; drop?: DropInfo; giveUp?: Omit<GiveUp, 'code' | 'message'> }): void`
  - `AdapterSession.networkRestored?(): void`
  - `DropInfo`, `ReconnectedInfo` and `GiveUp` are imported from Task 1.

- [ ] **Step 1: Write the failing tests.**
  - `reconnectClient` maps all three platforms.
  - A type-level test (`expectTypeOf`) that `AnalyticsEvents['connection_reconnected']` is `ReconnectAnalyticsEvents['connection_reconnected']`.
  - `recordEvents()` records the payloads of `reconnecting({attempt: 2})` and of a payload-less `reconnecting()`.
- [ ] **Step 2: Run the tests and see them fail.** Run `npx vitest run src/lib/session/reconnectEvents.test.ts src/lib/contract`. Expected: FAIL.
- [ ] **Step 3: Implement.** `events.ts`'s `KINDS` gains nothing, because no new event kind is added.
- [ ] **Step 4: Run the checks.** Run `npx vitest run src/lib && npx tsc --noEmit`. Expected: PASS. Gemini and OpenAI still compile.
- [ ] **Step 5: Commit.** `feat(session): reconnect event definitions shared with mobile (#692)`

### Task 3: The network port

**Files:**
- Modify: `src/lib/session/ports.ts`. `NetworkPort` and an optional `network?: NetworkPort` on `RunnerDeps`, guarded like the other ports.
- Create: `src/app/network.ts`. `createBrowserNetwork(): NetworkPort` reads `navigator.onLine`, maps `navigator.connection?.type` to `NetworkType` (otherwise `unknown`), and listens to `window` `online`.
- Modify: `src/app/session.ts`, near line 136. Pass `network: createBrowserNetwork()`.
- Test: `src/app/network.test.ts` (jsdom)

**Interfaces:**
- Produces: `interface NetworkPort { online(): boolean | undefined; type(): NetworkType; onOnline(fn: () => void): () => void }`.

- [ ] **Step 1: Write the failing tests.**
  - `type()` maps wifi, cellular, ethernet and anything else to unknown.
  - `onOnline` fires on a dispatched `online` event and stops after unsubscribe.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and see them pass.** Run `npx vitest run src/app/network.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(app): a network port for reconnects (#692)`

### Task 4: The run: leg state, the notice, analytics, totals

**Files:**
- Modify: `src/lib/session/run.ts`, at `onEvent` (561–637) and `setLegState` (639). Also: a subscription to `deps.network.onOnline` while running, which calls `networkRestored?.()` on each live session and is undone on end.
- Modify: `src/lib/session/types.ts`. `running` gains `reconnect?: Partial<Record<LegName, { attempt: number; since: number }>>`.
- Modify: `src/lib/session/runner.ts`, at `RunHost.legState`, its implementation (182) and `translation_session_end` (139).
- Modify: `src/lib/session/codes.ts`. Add `connection_restored` to `RUN_NOTICE_CODES`.
- Test: `src/lib/session/run.test.ts`, `src/lib/session/runner.test.ts` (update the equality at 688), `src/app/telemetry.test.ts`

**Interfaces:**
- Consumes: Task 2's payloads and event types; Task 3's port.
- Produces: `RunHost.legState(leg: LegName, state: LegState, reconnect?: { attempt: number; since: number }): void`, and a `RunState` carrying `reconnect`.
- Produces on `Run`: `reconnectTotals(): { count: number; downMs: number; failed: boolean }`, merged into `translation_session_end`.
- Behaviour:
  - **On `reconnecting`:**
    - First of a drop: stamp `since = deps.clock.now()`, send `connection_status: reconnecting` once, and send `connection_dropped` from `e.drop`.
      - `session_elapsed_ms` is measured from `liveSince`.
      - `drop_index` counts drops across the run, starting at 1.
      - `since_last_reconnect_ms` is measured from this leg's last `reconnected`.
      - `online` and `network` come from the port.
      - `channel` is `shared` when the shape is shared Both, otherwise the leg.
    - Every attempt updates `attempt`.
  - **On `reconnected`:** the leg goes live and its `reconnect` entry is cleared. Add a notice `{ severity: 'info', code: 'connection_restored', message: 'Connection lost and restored' }` to that leg's conversation, then send `connection_reconnected` with `down_ms` = now − since.
  - **On `failed`:**
    - With `drop`: send `connection_dropped` with `retryable: false`.
    - With `giveUp`: send `connection_reconnect_failed`.
    - Either way, `api_error` and `host.end` follow as today.
  - **A run ending while a leg is reconnecting:** send `connection_reconnect_failed` with reason `lease_ended` for a `lease-ended` end and `stopped` for any other end. No `failed` follows.

- [ ] **Step 1: Write the failing tests**, using the run harness in `run.test.ts` with a fake adapter that emits events.
  - `reconnecting sets the leg to reconnecting with attempt and since; a second attempt updates attempt only`
  - `connection_status reconnecting is sent once per drop`
  - `connection_dropped carries drop_index 1 then 2, session_elapsed_ms, since_last_reconnect_ms on the second, online and network from the port, channel shared for shared Both`
  - `reconnected makes the leg live, adds one info notice connection_restored to that leg, and sends connection_reconnected with down_ms`
  - `failed with giveUp sends connection_reconnect_failed then api_error, and ends the run as leg-failed`
  - `failed with a non-retryable drop sends connection_dropped retryable false`
  - `Stop during reconnecting sends connection_reconnect_failed reason stopped and no api_error` (Review Focus 1)
  - `a lease end during reconnecting sends reason lease_ended` (Review Focus 5)
  - `an online event calls networkRestored on each live session; none after the run ends`
  - `translation_session_end carries reconnect_count, reconnect_down_ms, reconnect_failed`
  - In `runner.test.ts` and `telemetry.test.ts`: update the exact-equality expectations to include the three fields.
- [ ] **Step 2: Run the tests and see them fail.** Run `npx vitest run src/lib/session src/app/telemetry.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and see them pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(session): the run tracks reconnects for the status line, the notice and PostHog (#692)`

### Task 5: Status line, notice words, locales

**Files:**
- Modify: `src/lib/view/statusLine.ts`.
  - `StatusLineInput` gains `now: number`.
  - The `key` kind of `StatusWords` gains `params?: Record<string, string | number>`.
  - At lines 83–85, when the reconnecting leg with the earliest `since` has an entry, it returns `{ kind:'key', key:'connectionStatus.reconnectingAttempt', fallback:'Reconnecting… (attempt {{attempt}}, {{seconds}} s)', params:{ attempt, seconds: Math.floor((now - since) / 1000) } }`. Otherwise it returns today's words.
- Modify: `src/components/MainPanel/StatusLine.tsx:53`. Use `t(words.key, { defaultValue: words.fallback, ...words.params })`.
- Modify: `src/components/MainPanel/useStatusLine.ts`. Pass `now: Date.now()`, and re-render every 1 s while any leg is reconnecting (the `useSessionClock` pattern).
- Modify: `src/components/dev/NoticesPreview.tsx:263`. Pass `now`.
- Modify: `src/lib/view/noticeText.ts`. `NOTICE_WORDS.connection_restored`.
- Modify: `src/locales/*/translation.json`. Both keys in all 30 catalogs. Edit en by hand, then run `node scripts/sync-locale-keys.mjs`, then translate each catalog's two strings.
- Test: `src/lib/view/statusLine.test.ts` (keep the existing case at 62; add the new one), `noticeText.test.ts`, `locales.consistency.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - `a reconnecting leg with attempt 3 since 12.4 s ago shows connectionStatus.reconnectingAttempt with attempt 3, seconds 12`
  - `two reconnecting legs show the earlier drop`
  - `reconnecting without an entry (Gemini) shows connectionStatus.reconnecting as before`
  - `connection_restored has words`
- [ ] **Step 2: Run the tests and see them fail.** Run `npx vitest run src/lib/view src/locales`. Expected: FAIL.
- [ ] **Step 3: Implement**, including the 29 translations.
- [ ] **Step 4: Run the checks.** Run `npx vitest run src/lib/view src/locales src/components && node scripts/gen-viewer-strings.mjs --check` (or the repo's check script for viewer strings). Expected: PASS.
- [ ] **Step 5: Commit.** `feat(ui): the reconnect attempt and time in the status line, and a restored notice (#692)`

## Part B: providers

### Task 6: Soniox lease port `reissue()`

**Files:**
- Modify: `src/providers/soniox/settings.ts` (139–146). `SonioxLeasePort` gains `reissue(): Promise<SonioxReissue>`.

  **Ruling:** the port is already per role, so there is no role argument. The spec writes `reissue(role)`.
- Modify: `src/providers/soniox/lease.ts`. `reissue` is in the port at 414–421. `reportStarted` (385) now reports once per key reference, not once per role.
- Test: `src/providers/soniox/lease.test.ts` (the port suite at 732)

**Interfaces:**
- Produces:
```ts
export type SonioxReissue =
  | { ok: true; stt: string; clientReferenceId: string; expiresAt: number }
  | { ok: false; retry: true; message: string }
  | { ok: false; retry: false; code: 'lease_ended' | 'reissue_limit' | 'sign_in_required' | 'wallet_frozen' | 'unsupported'; message: string };
```
- Behaviour:
  - **The request:** `reissue()` POSTs `${apiUrl()}/soniox/session-key/reissue` with `{ leaseId, role }`.
    - Its bearer is a fresh `shape.auth.getToken()`, falling back to the cached one.
    - It is bounded by `SESSION_KEY_TIMEOUT_MS` and by the lease context's abort.
  - **Answers:**
    - 200: `expiresAt` = `Date.parse(body.expiresAt)`. When that does not parse, it is `clock.now() + 10_000`.
    - 401 → `sign_in_required`; 403 → `wallet_frozen`; 409 → `body.code`.
    - 429 → `retry: true`.
    - 404 and any other 4xx → `unsupported`.
    - 5xx, a transport failure or a timeout → `retry: true`.
  - **After an ok answer:** the next `streamAccepted()` posts `session-started` with `{ leaseId, role, clientReferenceId }` for that key.
  - **Nothing after release:** after `release()`, `reissue()` answers `lease_ended` without a request.

- [ ] **Step 1: Write the failing tests**, one per answer mapping above. Also:
  - `streamAccepted after a reissue posts session-started with the new clientReferenceId; a second streamAccepted for the same key posts nothing`
  - `reissue after release makes no request`
- [ ] **Step 2: Run the tests and see them fail.** Run `npx vitest run src/providers/soniox/lease.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `lease.ts` DOM-free (`domFree.test.ts`).
- [ ] **Step 4: Run the tests and see them pass.** Run `npx vitest run src/providers/soniox`. Expected: PASS. Update the inline lease objects in `adapter.test.ts` (682, 698, 708, 721) with `reissue: vi.fn()`.
- [ ] **Step 5: Commit.** `feat(soniox): the lease reissues a key for a dropped stream (#692)`

### Task 7: Soniox adapter reconnects

**Files:**
- Modify: `src/providers/soniox/adapter.ts`:
  - Remove `RESUME_DELAYS_MS`, `MAX_RESUME_CYCLES`, `pendingResume` and `resume()`. The shared reconnector replaces them.
  - `onError` (410) and `onClose` (431) classify through a new pure `sonioxDropAction(e: { error?: string; close?: number; atGrantEnd: boolean }): 'reconnect' | 'cutoff' | 'end'`.
  - `sttConfig()` reads the core's current key and reference id rather than `o.primary.credentials`.
  - A stall watchdog.
  - `networkRestored()` on both facades.
- Test: `src/providers/soniox/adapter.test.ts`, plus a new `src/providers/soniox/adapter.reconnect.test.ts` modelled on `gemini/adapter.reconnect.test.ts`.

**Interfaces:**
- Consumes: Task 1 (`createReconnector`, `closeCodeAction`), Task 2 (payloads), Task 6 (`reissue()`).
- Produces: `SONIOX_STALL_MS` (5000 unless Step 1 measures otherwise) and `sonioxDropAction`.
- Behaviour:
  - **At a retryable drop:** run `utterances.abandon()` and `tracker?.reset()`, detach and close the stream, then call `reconnector.dropped({ cause, closeCode, errorCode, retryable: true, managed: !!lease })`.
  - **A non-retryable drop:** call `fail(code, msg)` with `drop: {…, retryable: false}`.
  - **`attempt()`:**
    - **Managed:** reissue first when the current key is spent or within 1 s of its `expiresAt`. An `ok:false, retry:true` answer is a non-final failure. A refusal is final: `lease_ended` gives reason `lease_ended`; any other code gives `refused` with that `refusalCode`.
    - Then `newStt()` and `connect(sttConfig())`. The key is spent once the socket has opened.
    - **Own key:** never reissue.
  - **`gaveUp`:**
    - A `lease_ended` give-up while `lease.atGrantEnd(now)` → `lease.cutoff()`, which ends as a lease end.
    - Any other give-up → `fail(code, message)` with `giveUp`.
  - **Events fan out to every leg of the core.** Shared Both reconnects one socket for both legs; split Both has two cores, so two independent reconnectors.
  - **Stall:** check every 1 000 ms. If audio was sent within the last 1 000 ms and nothing has come from the server for `SONIOX_STALL_MS`, treat it as a drop with cause `stall`.

- [ ] **Step 1: Measure the stall threshold.** With an own Soniox key, a node script under the scratchpad streams 3 minutes of speech and silence to the real-time API at real-time pace. It logs the longest gap between server messages. Set `SONIOX_STALL_MS = max(5000, 2 × longest gap)`. If no key is to hand, use 5000 and ledger it. Never print the key.
- [ ] **Step 2: Write the failing tests** (`adapter.reconnect.test.ts`):
  - `own key: a 1006 after live reconnects with the same key and the leg stays live` (`reconnecting` then `reconnected`; no `failed`)
  - `managed: a 1006 reissues once and connects with the new key and reference id` (assert the config frame's `api_key` and `client_reference_id`)
  - `managed: a key whose socket never opened is reused by the next attempt; after its expiresAt a new one is fetched` (Review Focus 4)
  - `401, 429 and a non-retryable close end at once with their code and drop.retryable false`
  - `a lease_ended reissue at grant end ends as a lease end; before it, as connection_lost`
  - `sign_in_required ends with that code`
  - `503 on a managed key now reconnects` (formerly `lost`)
  - `the own-key 503 path uses the shared schedule` (the existing `resumeOnce()` tests are rewritten to the new offsets)
  - `split Both: a drop on the speaker core reconnects only it; the participant keeps receiving` (Review Focus 2)
  - `shared Both: one socket reconnects and both legs get reconnecting and reconnected`
  - `the in-flight utterance closes at the drop; audio appended during the gap sends nothing`
  - `a stall of SONIOX_STALL_MS while sending audio drops with cause stall; silence on our side never trips it`
  - `networkRestored during a wait attempts at once`
  - `the grant timer firing during attempts cancels the reconnector with no timers left` (Review Focus 5)
  - `checkConformance(h.log, AUTO_CTX)` is `[]` for each
- [ ] **Step 3: Run the tests and see them fail.** Run `npx vitest run src/providers/soniox`. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run the tests and see them pass.** Run `npx vitest run src/providers/soniox src/providers/sessionSide.consistency.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit.** `feat(soniox): reconnect a dropped STT socket, managed or own key (#692)`

### Task 8: Qwen lease port `reissue()`

**Files:**
- Modify: `src/providers/qwen_livetranslate/settings.ts` (163). `QwenLeasePort` gains `reissue(): Promise<QwenReissue>`.
- Modify: `src/providers/qwen_livetranslate/lease.ts`. It keeps a lease-wide token cache, seeded from the grant's `apiKey` and `expiresAt` (or `now + 55_000` when absent). `port(leg)` (423) gains `reissue`.
- Test: `src/providers/qwen_livetranslate/lease.test.ts`

**Interfaces:**
- Produces: `QwenReissue`, with the same failure shapes as `SonioxReissue` and the success shape `{ ok: true; apiKey: string; expiresAt: number }`.
- Behaviour:
  - It answers the cached token while `now < expiresAt − 5_000`. Otherwise it POSTs `${apiUrl()}/qwen/session-key/reissue` with `{ leaseId }`.
  - Concurrent calls from both legs share one request.
  - The status mapping is as in Task 6. A 503 `qwen_busy` is `retry: true`.

- [ ] **Step 1: Write the failing tests.**
  - `a token still valid is reused without a request`
  - `an expired token fetches one; both legs calling together make one request` (Review Focus 2)
  - One test per status mapping.
- [ ] **Step 2: Run the tests and see them fail.** Run `npx vitest run src/providers/qwen_livetranslate/lease.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and see them pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(qwen): the lease reissues a token for a dropped leg (#692)`

### Task 9: Qwen adapter reconnects

**Files:**
- Modify: `src/providers/qwen_livetranslate/adapter.ts`:
  - The header comment at line 13 no longer says "no reconnect (D8)".
  - `closed(e)` (683) classifies through a new pure `qwenDropAction(e: { close?: number; recent?: { code: string } }): 'reconnect' | 'end'`. A recent error code decides first; otherwise `closeCodeAction`.
  - The leg holds its current `apiKey`.
  - A new `resetTurnState()` clears `busy`, `held`, `releaseHeld`, `appended`, `cancelTurnWait`, `quietSamples`, `preRoll`, `latest`, `audioWent`, and stops and recreates `segments`.
  - `networkRestored()`.
- Modify: `src/providers/qwen_livetranslate/adapter.test.ts:60`. Stop skipping the `reconnecting` scenario.
- Test: a new `src/providers/qwen_livetranslate/adapter.reconnect.test.ts`, using `startQwen` and `fakeHeaderSockets`.

**Interfaces:**
- Consumes: Tasks 1, 2, 8.
- Behaviour:
  - **At a retryable drop:** call `segments.stop()`, which closes the in-flight segment as it stands. Then `resetTurnState()`, detach and close the socket, and call `reconnector.dropped({ … managed: !!lease })`.
  - **`attempt()`:** a managed leg first calls `lease.reissue()`; then `connect(endpoint)`, the start path's own function. The new connection reports its `sess_…` as today.
  - **Manual turns:** a press still held when the connection comes back opens a turn on the new socket. An open turn at the drop closes.
  - **Give-up:** `end(...)` with `giveUp`.

- [ ] **Step 1: Write the failing tests.**
  - `own key: a 1011 after live reconnects and the leg stays live`
  - `managed: an expired token is reissued and the new socket's Authorization carries it`
  - `managed: a still-valid token is reused`
  - `[Qwen InvalidApiKey], a quota error and AccessDenied.Unpurchased end at once with their codes`
  - `a server error reconnects`
  - `the in-flight segment closes at the drop; appendAudio during the gap sends nothing`
  - `a held press when it comes back opens a turn on the new socket`
  - `split legs: only the dropped leg reconnects`
  - `the reconnecting scenario passes` (`runScenario`)
  - `checkConformance` is `[]`
- [ ] **Step 2: Run the tests and see them fail.** Run `npx vitest run src/providers/qwen_livetranslate`. Expected: FAIL.
- [ ] **Step 3: Implement.** Start from `wire.ts` `errorCode`. Answer open point §9.2 by recording, in the ledger, which codes were observed and how each is classified.
- [ ] **Step 4: Run the tests and see them pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(qwen): reconnect a dropped leg, managed or own key (#692)`

### Task 10: Whole-repo check and the hand test

- [ ] **Step 1: Run** `npx vitest run`, `npx tsc --noEmit` and `npm run lint`. Expected: all pass. Name any failure, including ones you did not cause.
- [ ] **Step 2: Run OCR** (`ocr review --audience agent --from <merge-base> --to HEAD`, Node v24 PATH). Fix what holds up, then commit.
- [ ] **Step 3: Write the hand-test checklist** in the PR body. It runs against a backend with the reissue endpoints deployed, and covers §8:
  - **Builds:** desktop on macOS and Windows, and the extension.
  - **Sessions:** Kizuna Soniox, Kizuna Qwen and own-key Soniox.
  - **Breaks:**
    - Wi-Fi off for 5 s, and a VPN toggle. Expected: it reconnects, the status line counts, and the notice appears.
    - Wi-Fi off for 40 s. Expected: it gives up with "connection lost".
- [ ] **Step 4: Hand over.** Opening the PR to `kizuna-ai-lab/sokuji` waits for the owner's go-ahead. The PR body and issue text carry no internal task numbers or names.

## Part C: replaying the gap's audio (Soniox only; deferred)

Not in this round: the owner (2026-11-05) wants reconnect finished first and replay after it. This part is kept as the starting point for that follow-up and is not executed with Parts A and B.

### Task 11: Replay unfinalized audio after a reconnect

**Files:**
- Create: `src/providers/soniox/replay.ts`. It is a log of sent audio, indexed by stream offset in ms. Pure, on the injected clock.
- Modify: `src/providers/soniox/adapter.ts`. It records each sent chunk's offset and tracks `final_audio_proc_ms` from responses. During the gap it keeps captured audio in the log instead of dropping it. After `reconnected` it sends the replay paced at `REPLAY_SPEED` times real time, then live audio queued behind it.

**Interfaces:**
- Produces:
  - `REPLAY_MAX_MS = 5000`, `REPLAY_SPEED = 2` and `BACKLOG_MAX_MS = 8000`. All three are set from a live tolerance test like Task 7's Step 1.
  - `createSentAudioLog(sampleRate: number)` with `append(pcm)`, `since(offsetMs): Int16Array[]` and `trimBefore(offsetMs)`.
- Behaviour:
  - Replay starts at the old stream's last `final_audio_proc_ms`, and never more than `REPLAY_MAX_MS` before the drop.
  - The old stream's non-final text is withdrawn, not closed. This changes §4.3 for Soniox only.
  - Live audio that arrives during the replay is appended behind it.
  - A backlog over `BACKLOG_MAX_MS` drops the oldest audio and writes a frame.

- [ ] Steps as in Task 7: measure, failing tests (replay starts at the final offset; is bounded by `REPLAY_MAX_MS`; is paced; live audio follows in order; the non-final text is withdrawn; a backlog over 8 s drops the oldest), implement, pass, commit `feat(soniox): replay unfinalized audio after a reconnect (#692)`.
