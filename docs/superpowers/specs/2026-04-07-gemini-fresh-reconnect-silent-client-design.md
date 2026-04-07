# Gemini Fresh Reconnect for Silent Clients

**Issue:** [#179](https://github.com/kizuna-ai-lab/sokuji/issues/179) (follow-up to the auto-reconnect work)
**Date:** 2026-04-07
**Builds on:** [2026-04-06-gemini-auto-reconnect-design.md](2026-04-06-gemini-auto-reconnect-design.md)

## Problem

The auto-reconnect feature shipped in #180 transparently re-establishes a Gemini Live session when the server sends `goAway` or unexpectedly closes the WebSocket. It works **only when the client has previously stored a session resumption handle**.

A new failure mode was discovered during testing of the dual-client scenario (speaker + participant):

1. The user runs both a **speaker** client (translates user mic) and a **participant** client (translates incoming audio).
2. The user mutes their microphone — speaker has audio input disabled or is just silent.
3. Only the participant produces turns. Google's Live API issues `sessionResumptionUpdate` messages **only after the model completes a response turn**, so the speaker client **never receives a handle**.
4. After ~7-15 minutes the server sends `goAway` to both connections.
5. Participant has a stored handle → `reconnect()` succeeds → keeps running.
6. Speaker has no handle → `reconnect()` is gated out by `if (savedResumptionHandle && lastConfig)` → falls through to "real disconnect".
7. Speaker's `onclose` triggers MainPanel's cleanup, which **force-disconnects the still-healthy participant**, ending the entire session.

User report: *"虽然 participant 的 client 在 goaway 后重新连接了，但是到了时间还是断开了。... 我们如何设计处理这样的情况。"*

### Root cause

`GeminiClient.reconnect()` and the `onclose` / `goAway` handlers all use `savedResumptionHandle` as the precondition for "should I reconnect?" But for a silent client, the absence of a handle does **not** mean "don't reconnect" — it means "there is nothing to resume **from**, but a fresh connection is still valid".

A silent client has no conversation state to lose:
- `conversationItems` is empty
- No in-progress turn
- `lastConfig` is fully preserved (API key, model, instructions)

A new connection without a handle is functionally equivalent to a resume for this client.

## Solution Overview

Remove the `savedResumptionHandle` precondition from the reconnect path. Use `lastConfig` alone as the signal for "session is still expected to be alive". Inside the retry loop, `connect(lastConfig)` already does the right thing: if `savedResumptionHandle` is set it sends it as part of `liveConfig.sessionResumption.handle`, otherwise the new connection is fresh.

User-initiated disconnect is distinguished by clearing `lastConfig` in `disconnect()`.

The two-client coupling in `MainPanel.tsx` is **made symmetric**: today only the speaker's `onClose` tears down the participant (`MainPanel.tsx:689-713`); the participant's `onClose` only logs. With the fresh-reconnect fix, the participant client can now legitimately reach a permanent-failure `onClose` of its own (its own silent retries exhausted), and the user explicitly asked for "陪葬" — both clients share fate. We add symmetric cleanup so participant's permanent failure also tears down the speaker. The user explicitly rejected the alternative ("decoupled with a degraded-state UI").

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Reconnect when no handle | Yes — start a fresh session | Silent client has no state to lose; fresh connect ≡ resume |
| User-disconnect signal | Clear `lastConfig` in `disconnect()` | Single source of truth, no extra flag needed |
| Speaker/participant coupling | Symmetric — either one dying tears down both | User explicitly chose "陪葬"; the existing asymmetric behavior is a latent bug |
| Add proactive Gemini "anchor" keepalive | No | Out of scope; would require API-specific design and is not needed once fresh reconnect exists |
| UI indicator changes | None | Existing `isReconnecting` indicator covers both resume and fresh-reconnect transitions |
| Scope of fix | `GeminiClient.ts` + small `MainPanel.tsx` symmetry patch | Smallest possible change that closes the bug AND honors the "陪葬" principle |

## Detailed Design

### File: `src/services/clients/GeminiClient.ts`

#### Change 1 — `disconnect()` clears `lastConfig`

`lastConfig` becomes the canonical "is this client expected to be active?" signal.

```typescript
async disconnect(): Promise<void> {
  this.isReconnecting = false;
  this.savedResumptionHandle = undefined;
  this.lastConfig = null;          // NEW — marks user-initiated disconnect
  if (this.session) {
    this.session.close();
    this.session = null;
  }
  this.isConnectedState = false;
  this.conversationItems = [];
  this.resetCurrentTurn();
}
```

#### Change 2 — `reconnect()` guard relaxed

Drop the `!this.savedResumptionHandle` clause. Inside the retry loop, the existing `connect(this.lastConfig)` call already reads `this.savedResumptionHandle` and passes it through `liveConfig.sessionResumption.handle`; if it is `undefined`, the SDK opens a fresh session.

```typescript
private async reconnect(): Promise<void> {
  if (this.isReconnecting || !this.lastConfig) return;   // CHANGED

  this.isReconnecting = true;
  this.eventHandlers.onReconnecting?.();

  // ... close old session, retry loop unchanged ...
  // The retry loop body is identical to the current implementation:
  //   await this.connect(this.lastConfig);
  //   this.savedResumptionHandle = undefined;  // single-use, cleared after success
}
```

The `savedResumptionHandle = undefined` clear inside the success branch is preserved unchanged. It is correct in both modes: in the resume path Google's handles are single-use, and in the fresh path it was already `undefined`.

#### Change 3 — `onclose` handler guard relaxed

```typescript
onclose: (event: CloseEvent) => {
  console.info('[Sokuji] [GeminiClient] Session closed', event);
  this.session = null;

  if (this.isReconnecting) return;

  // CHANGED: lastConfig is now the sole guard. With or without a saved
  // handle, an unexpected close while we still have lastConfig means the
  // user did not initiate the disconnect — try to reconnect.
  if (this.lastConfig) {
    this.reconnect();
    return;
  }

  // No lastConfig — disconnect() was called explicitly by the user. Run
  // the existing real-disconnect cleanup path.
  this.isConnectedState = false;
  this.conversationItems = [];
  this.eventHandlers.onRealtimeEvent?.({
    source: 'client',
    event: { type: 'session.closed', data: { ... } }
  });
  this.eventHandlers.onClose?.(event);
}
```

#### Change 4 — `goAway` handler guard relaxed

```typescript
if (message.goAway) {
  this.eventHandlers.onRealtimeEvent?.({
    source: 'server',
    event: { type: 'goAway', data: message.goAway }
  });
  // CHANGED: drop savedResumptionHandle precondition
  if (this.lastConfig) {
    this.reconnect();
  }
}
```

#### Change 5 — `simulateDisconnectForTesting()` precondition relaxed

The dev-only `Ctrl+Shift+G` helper currently refuses to fire if there is no saved handle. To exercise the new fresh-reconnect path manually, drop the handle check.

```typescript
simulateDisconnectForTesting(): void {
  if (!this.session) {
    console.warn('[Sokuji] [GeminiClient] Cannot simulate disconnect: no session');
    return;
  }
  console.info('[Sokuji] [GeminiClient] DEV: Simulating disconnect to test reconnection');
  this.session.close();
}
```

#### Change 6 — Reconnect failure path also clears `lastConfig`

After all retries fail, the existing failure path emits `session.closed` and calls `onClose`. We must also clear `lastConfig` here so a subsequent `onclose` from the failed session does not loop back into `reconnect()`.

```typescript
// All retries failed — treat as real disconnect
this.isReconnecting = false;
this.savedResumptionHandle = undefined;
this.lastConfig = null;             // NEW
this.isConnectedState = false;
this.conversationItems = [];
// ... existing emit + onClose ...
```

### File: `src/components/MainPanel/MainPanel.tsx`

#### Change 7 — Symmetric participant `onClose` cleanup

`createParticipantEventHandlers` (currently `MainPanel.tsx:268-294`) only logs in `onClose`. Replace its `onClose` with a handler that mirrors the speaker cleanup when the participant client permanently fails.

Extract the existing speaker cleanup body in `MainPanel.tsx:674-730` into a small shared helper, e.g. `cleanupSession()`, that:

1. Sets `isSessionActive = false`, `isAIResponding = false`, `isReconnecting = false`.
2. Tracks the disconnection event (analytics).
3. Clears `pendingTextRef.current`.
4. Disconnects whichever client is still alive (the **other** one) by calling `disconnect()` and `reset()` on it, then nulling the ref.
5. Stops audio recording, clears streaming tracks, interrupts pending audio.

Then both `onClose` handlers call this helper:

- **Speaker `onClose`**: calls `cleanupSession({ deadClient: 'speaker' })` — kills participant if alive.
- **Participant `onClose`**: calls `cleanupSession({ deadClient: 'participant' })` — kills speaker if alive.

With both sides going through the same helper, the only difference is which client is the dead one (already torn down) and which one needs an active `disconnect()` call.

The helper guards against re-entry: if `isSessionActive` is already `false`, return immediately. This prevents a feedback loop when client A's `disconnect()` triggers client B's `onClose`, which would otherwise try to disconnect client A again.

#### Change 8 — Dev shortcut works on both clients

The current `Ctrl+Shift+G` shortcut (`MainPanel.tsx:2244-2260`) only fires `simulateDisconnectForTesting()` on `clientRef.current` (speaker). To exercise both reconnect paths during manual testing, add an `Alt`-modified variant or simply call both clients on the same shortcut. Concrete proposal:

- `Ctrl+Shift+G` → simulate disconnect on **speaker**
- `Ctrl+Shift+H` → simulate disconnect on **participant** (`systemAudioClientRef.current`)

This is dev-only behind `isDevelopment()`, no production impact.

### Files NOT modified

- `src/services/interfaces/IClient.ts` — no new callbacks.
- `src/stores/sessionStore.ts` — `isReconnecting` already exists from #180, no new state.
- Any UI component — no new visual element.
- All other provider clients (`OpenAIClient`, `OpenAIGAClient`, `OpenAIWebRTCClient`, `PalabraAIClient`, `KizunaAIClient`, `VolcengineSTClient`, `VolcengineAST2Client`, `LocalInferenceClient`) — `GeminiClient` is the only one with this bug because it is the only one that requires session-level resumption handles to reconnect.

## Behavior Mapping

### Scenario A — silent speaker, server `goAway` (the reported bug)

1. User mutes mic at session start. Speaker connects, participant connects, both have `lastConfig` set, neither has been talked over yet.
2. Participant produces turns → receives `sessionResumptionUpdate` → has `savedResumptionHandle`. Speaker stays silent → never receives a handle.
3. After ~10 minutes Google sends `goAway` to both connections.
4. **Participant**: `lastConfig` truthy → `reconnect()` runs → resume path → success.
5. **Speaker**: `lastConfig` truthy → `reconnect()` now also runs → fresh-connect path → `connect(lastConfig)` opens a brand new session with `sessionResumption.handle = undefined` → success.
6. Both clients are alive again. The user notices nothing.

### Scenario B — fresh reconnect actually fails (network drop)

1. Same setup as A, but the network has dropped.
2. Speaker fresh-reconnect retries 3 times with backoff, all fail.
3. Speaker's failure path emits `session.closed` and calls `onClose` → `lastConfig` cleared inside the speaker GeminiClient.
4. MainPanel's speaker `onClose` handler invokes `cleanupSession({ deadClient: 'speaker' })`. The helper sets `isSessionActive = false`, then calls `participantClient.disconnect()`.
5. Participant's `disconnect()` clears its `lastConfig` and `isReconnecting`. Any in-flight participant reconnect bails out at the next loop iteration check. The participant's eventual `onclose` falls through the new `lastConfig === null` guard → real-disconnect path → `onClose` handler fires → `cleanupSession({ deadClient: 'participant' })` → sees `isSessionActive` already `false` → no-op (re-entry guard).
6. User sees the start button again — same as a complete network failure today.

### Scenario B' — participant fresh reconnect fails alone (symmetric)

1. The user is mostly speaking and listening, but the participant audio source has been silent for a while; participant has no handle. (This is rare in practice — the speaker is the more common silent side — but it's the symmetric case.)
2. Participant gets `goAway`, fresh-reconnects, all retries fail.
3. Participant's failure path emits `session.closed`, calls participant's `onClose` in MainPanel.
4. **NEW**: Participant `onClose` invokes `cleanupSession({ deadClient: 'participant' })` → kills the still-alive speaker → both end together.
5. Today this would silently strand the participant; with the fix the user gets a clean disconnect they can react to.

### Scenario C — user presses Stop

1. `disconnectConversation()` calls `client.disconnect()` on both clients.
2. `disconnect()` clears `lastConfig` on both.
3. WebSocket close fires `onclose` on both → guard `if (this.lastConfig)` is now false → real-disconnect path runs as today.
4. No spurious reconnect attempts.

### Scenario D — speaker has handle, normal reconnect

Unchanged from #180. `lastConfig` is set, `savedResumptionHandle` is set, `reconnect()` runs the resume path. The new fresh-connect branch is never reached because `savedResumptionHandle` is non-null and the retry loop's `connect()` call uses it.

## Edge Cases

| Scenario | Behavior |
|---|---|
| `goAway` arrives during the very brief window between `connect()` resolving and `lastConfig` being set | Cannot happen — `lastConfig = config` is the first line of `connect()`, well before the WebSocket is open. |
| `goAway` arrives while `reconnect()` is already running | `isReconnecting` guard short-circuits the second call. |
| User presses Stop mid-reconnect | `disconnect()` sets `isReconnecting = false` and `lastConfig = null`. The retry loop's `if (!this.isReconnecting) break;` exits at the next iteration; if `connect()` in flight, it will fail or settle and the post-`connect` cleanup hits the cleared `lastConfig`. |
| `connect()` throws because the saved handle is server-rejected (expired) | Retry uses the same handle, which will keep failing. **Pre-existing limitation, not addressed here.** A separate fix would clear `savedResumptionHandle` after the first handle-rejected error and let subsequent retries fall through to fresh. Out of scope. |
| Other providers (OpenAI, Palabra, KizunaAI, Volcengine, LocalInference) | Untouched — only `GeminiClient` is modified. |
| Both clients silent for a long time | Both fresh-reconnect successfully, no user impact. |
| Participant reconnect succeeds before speaker reconnect finishes | No coordination needed; the two clients are independent at the GeminiClient layer. |

## Testing Strategy

### Unit tests (`src/services/clients/GeminiClient.test.ts`)

Add new cases on top of the existing reconnect test suite:

| Test case | Setup | Expected |
|---|---|---|
| Fresh reconnect on `goAway` without handle | Mock `connect()` to succeed; do NOT emit `sessionResumptionUpdate`; emit `goAway` | `reconnect()` runs, `connect()` is called with `sessionResumption.handle === undefined`, `onReconnected` fires |
| Fresh reconnect on unexpected `onclose` without handle | Mock `connect()` to succeed; do NOT emit handle; trigger `onclose` | `reconnect()` runs, fresh `connect()`, `onReconnected` fires |
| `disconnect()` clears `lastConfig` | Call `connect()` then `disconnect()` | After `disconnect()`, a forced `onclose` does **not** trigger `reconnect()` |
| All-retries-failed clears `lastConfig` | Mock `connect()` to throw 3 times | After failure, `lastConfig === null`; a subsequent stray `onclose` is a no-op |
| Resume path still works | Existing test, ensure unchanged | `connect()` called with the stored handle on retry |
| Re-entry guard with no handle | Two `goAway` messages back-to-back, no handle | Second call is no-op via `isReconnecting` guard |

The existing test for "GoAway without handle → no reconnection" must be **updated**: with this fix, the expected behavior flips to "fresh reconnection attempted".

### Manual test (Ctrl+Shift+G)

1. Start the app, configure Gemini, enable mic, set up the participant capture.
2. Start a session **without speaking** so the speaker never produces a turn (mute the mic completely).
3. Speak from the participant audio source (or play a meeting clip) so the participant produces at least one turn and stores a handle.
4. Press Ctrl+Shift+G to force-close the speaker session.
5. Observe in logs:
   - `[GeminiClient] DEV: Simulating disconnect`
   - `[GeminiClient] Session closed`
   - `[MainPanel] Session reconnecting...`
   - `[GeminiClient] Session opened` (note: no resumption handle in the new connection's config)
   - `[MainPanel] Session reconnected successfully`
6. Verify: participant audio still flows, speaker is back online, no full cleanup happened.
7. Repeat with `Ctrl+Shift+H` (which Change 8 wires to the participant client) to confirm symmetry.

## Files to Modify

1. `src/services/clients/GeminiClient.ts` — six small changes listed above (changes 1-6)
2. `src/components/MainPanel/MainPanel.tsx` — symmetric participant `onClose` cleanup, dev shortcut on both clients (changes 7-8)
3. `src/services/clients/GeminiClient.test.ts` — add new fresh-reconnect cases, update the "no handle → no reconnect" case

## Acceptance Criteria

- [ ] A silent Gemini speaker client whose server connection is closed (`goAway` or unexpected `onclose`) attempts reconnection via a fresh `connect()` call without a resumption handle.
- [ ] The same is true for the participant client (symmetry).
- [ ] A successful fresh reconnect emits `onReconnected` and leaves both speaker and participant clients running.
- [ ] An all-retries-failed fresh reconnect on either client emits the existing `session.closed` event and tears down **both** clients via the shared `cleanupSession()` helper.
- [ ] User-initiated `disconnect()` does not trigger a reconnect attempt (verified by `lastConfig === null` guard).
- [ ] Existing handle-based resume path is unchanged for clients that have a saved handle.
- [ ] Other providers are unaffected (only `GeminiClient` and Gemini-related MainPanel code are modified).
- [ ] Unit tests cover both fresh-reconnect paths (`goAway` and unexpected `onclose`), the `disconnect()` clear, and the failure-clears-`lastConfig` invariant.
- [ ] `cleanupSession()` re-entry guard verified — symmetric `onClose` from the second client during cleanup is a no-op.
- [ ] Manual test via Ctrl+Shift+G (speaker) and Ctrl+Shift+H (participant) works on sessions with no saved handle.

## Out of Scope

- Decoupled speaker/participant lifecycles with a degraded-state UI (explicitly rejected by user).
- Any new UI element for degraded state.
- Gemini-side proactive keepalive / "anchor" mechanism analogous to the OpenAI out-of-band response. May be revisited later as an optimization but is not required by this fix.
- Fixing the pre-existing edge case where a server-rejected (expired) handle causes all retries to fail with the same invalid handle. Independent issue.
- Extending fresh-reconnect to other providers — none of them currently rely on session resumption handles for reconnection, so the bug does not exist there.
