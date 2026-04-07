# Gemini Fresh Reconnect for Silent Clients Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `GeminiClient` instances that have never received a session resumption handle (typically a muted speaker client) to recover from server-initiated disconnects by opening a fresh session, instead of tearing down the entire dual-client session as today.

**Architecture:** Replace the `savedResumptionHandle && lastConfig` reconnect guards inside `GeminiClient` with a single `lastConfig` guard. `lastConfig` becomes the canonical "this client is expected to be alive" signal — it is set in `connect()` and cleared in `disconnect()` and on permanent reconnect failure. The retry loop is unchanged: `connect(this.lastConfig)` already passes `savedResumptionHandle` through `liveConfig.sessionResumption.handle`, so when no handle is set the SDK opens a brand-new session. In `MainPanel`, both speaker and participant `onClose` handlers route through the existing `disconnectConversation()` (gated by a new re-entry guard) so either side dying tears down both — the symmetric "陪葬" behavior the user requested. A second dev shortcut (`Ctrl+Shift+H`) is added for testing the participant client's reconnect path.

**Tech Stack:** TypeScript, @google/genai SDK, Zustand (`sessionStore`), Vitest

**Spec:** `docs/superpowers/specs/2026-04-07-gemini-fresh-reconnect-silent-client-design.md`

**Builds on:** `docs/superpowers/plans/2026-04-06-gemini-auto-reconnect.md` (PR #180 — auto-reconnect with session resumption)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/services/clients/GeminiClient.test.ts` | Modify | Update existing 4 tests to reflect flipped behavior; add 2 new tests for `lastConfig`-based guards |
| `src/services/clients/GeminiClient.ts` | Modify | Relax reconnect/onclose/goAway guards from `savedResumptionHandle && lastConfig` to `lastConfig` only; clear `lastConfig` in `disconnect()` and on permanent reconnect failure; relax `simulateDisconnectForTesting()` precondition |
| `src/components/MainPanel/MainPanel.tsx` | Modify | Add re-entry guard at the top of `disconnectConversation()`; route both speaker and participant `onClose` handlers through it; add `Ctrl+Shift+H` dev shortcut for participant simulate-disconnect |

No new files. No interface or store changes (everything needed already exists from PR #180).

---

## Task ordering rationale

Tests come first (red phase) for the GeminiClient changes (Tasks 1-3) so the implementation step (Task 4) has a clear PASS/FAIL signal. The MainPanel changes (Tasks 5-9) are not unit-tested in this codebase (the existing GeminiClient test suite is the only test file under `src/services/clients`), so they are validated by manual smoke testing in Task 11.

---

### Task 1: Update existing GeminiClient reconnect tests for fresh-reconnect behavior

Four existing tests assume that an unexpected close or goAway WITHOUT a stored handle results in `onClose` firing (real disconnect). After this fix the same condition should result in a fresh reconnect attempt. Update the tests to match the new contract.

**Files:**
- Modify: `src/services/clients/GeminiClient.test.ts`

- [ ] **Step 1: Update Test 2 (`does NOT update handle when sessionResumptionUpdate is resumable: false`)**

Find the `it('does NOT update handle when sessionResumptionUpdate is resumable: false', ...)` block (around line 136) and replace its body with the version below. Rename it to reflect the flipped behavior.

```typescript
  // ── Test 2: handle NOT updated when resumable: false → fresh reconnect on close ──
  it('does NOT update handle when sessionResumptionUpdate is resumable: false (fresh reconnects on close)', async () => {
    await client.connect(baseConfig);
    sendResumptionUpdate(false, 'handle-never-stored');

    // Without a handle but with lastConfig still set, an unexpected close
    // should now trigger a fresh reconnect (no handle in the new connection).
    setupSuccessfulConnect();
    sendClose();
    await vi.runAllTimersAsync();

    expect(handlers.onReconnecting).toHaveBeenCalled();
    expect(handlers.onReconnected).toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Update Test 4 (`does NOT reconnect on goAway when no handle is stored`)**

Find the test (around line 164) and replace it.

```typescript
  // ── Test 4: goAway without handle → fresh reconnect ──────────────────────
  it('fresh reconnects on goAway when no handle is stored', async () => {
    await client.connect(baseConfig);
    // No resumption update sent → no handle

    setupSuccessfulConnect();
    sendGoAway();
    await vi.runAllTimersAsync();

    expect(handlers.onReconnecting).toHaveBeenCalled();
    expect(handlers.onReconnected).toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Update Test 6 (`fires onClose on unexpected close without a stored handle`)**

Find the test (around line 188) and replace it.

```typescript
  // ── Test 6: unexpected close without handle → fresh reconnect ────────────
  it('fresh reconnects on unexpected close without a stored handle', async () => {
    await client.connect(baseConfig);
    // No handle stored

    setupSuccessfulConnect();
    sendClose();
    await vi.runAllTimersAsync();

    expect(handlers.onReconnecting).toHaveBeenCalled();
    expect(handlers.onReconnected).toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });
```

- [ ] **Step 4: Update Test 12 (`clears savedResumptionHandle when disconnect() is called explicitly`)**

The intent is now clearer: verify that `disconnect()` clears `lastConfig` so a stray `onclose` from the closed session does NOT trigger a reconnect. Find the test (around line 318) and replace it.

```typescript
  // ── Test 12: disconnect() clears lastConfig → no reconnect on stray close ─
  it('does NOT reconnect after explicit disconnect() (lastConfig cleared)', async () => {
    await client.connect(baseConfig);
    sendResumptionUpdate(true, 'handle-to-clear');

    // Disconnect explicitly — clears lastConfig, savedResumptionHandle, and isReconnecting
    await client.disconnect();

    // Reset mocks so we can detect any spurious reconnect attempt
    handlers.onReconnecting.mockClear();
    handlers.onReconnected.mockClear();
    handlers.onClose.mockClear();

    // A stray close event from the now-dead session should be a no-op
    sendClose();
    await vi.runAllTimersAsync();

    expect(handlers.onReconnecting).not.toHaveBeenCalled();
    expect(handlers.onReconnected).not.toHaveBeenCalled();
    // The onClose callback should also NOT fire — there is no lastConfig and
    // disconnect() already cleaned up. The new onclose guard short-circuits.
    expect(handlers.onClose).not.toHaveBeenCalled();
  });
```

- [ ] **Step 5: Run the test file to confirm the four updated tests now FAIL**

Run: `npx vitest run src/services/clients/GeminiClient.test.ts 2>&1 | tail -40`

Expected: Tests 2, 4, 6, and 12 FAIL. The other tests (1, 3, 5, 7, 8, 9, 10, 11) PASS. The failures should be of the form "expected onReconnecting to have been called" or similar — the assertions changed but the implementation hasn't yet, so the new expectations fail.

If Tests 2, 4, 6, or 12 unexpectedly PASS at this step, stop and re-read the test changes — you may have made the assertion too lenient.

- [ ] **Step 6: Commit the failing test updates**

```bash
git add src/services/clients/GeminiClient.test.ts
git commit -m "test(gemini): update reconnect tests for fresh-reconnect behavior

Tests 2, 4, 6, and 12 are flipped to expect fresh reconnection
when a Gemini client without a session resumption handle is
unexpectedly closed (or receives goAway). Test 12 is reframed
to verify that disconnect() clears lastConfig so subsequent
onclose events are no-ops. The implementation that satisfies
these tests follows in the next commit.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add new GeminiClient test for "all retries failed clears lastConfig"

Verify that after a permanent reconnect failure, `lastConfig` is cleared so a subsequent stray `onclose` event does not loop back into `reconnect()`.

**Files:**
- Modify: `src/services/clients/GeminiClient.test.ts`

- [ ] **Step 1: Add the new test after Test 12**

Place this block immediately after the closing `});` of Test 12 (the one you just updated), still inside the `describe(...)` block:

```typescript
  // ── Test 13: failed reconnect clears lastConfig → no zombie reconnect ────
  it('clears lastConfig after all reconnect retries fail', async () => {
    await client.connect(baseConfig);
    sendResumptionUpdate(true, 'handle-doomed');

    // All reconnects fail
    setupFailingConnect();
    sendGoAway();
    await vi.runAllTimersAsync();

    // After failure, onClose has fired
    expect(handlers.onClose).toHaveBeenCalledTimes(1);

    // Reset mocks and simulate one more stray close event (e.g., the failed
    // reconnect's pending socket finally cleans up and fires onclose)
    handlers.onReconnecting.mockClear();
    handlers.onReconnected.mockClear();
    handlers.onClose.mockClear();

    // setupSuccessfulConnect to make sure that, if any reconnect attempt
    // were spawned, it would resolve and we'd see onReconnected.
    setupSuccessfulConnect();
    sendClose();
    await vi.runAllTimersAsync();

    // Nothing should fire — lastConfig is null after the failure path
    expect(handlers.onReconnecting).not.toHaveBeenCalled();
    expect(handlers.onReconnected).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to confirm it FAILS**

Run: `npx vitest run src/services/clients/GeminiClient.test.ts -t "clears lastConfig after all reconnect retries fail" 2>&1 | tail -30`

Expected: Test FAILS. The current implementation does not clear `lastConfig` in the failure path, so the stray `sendClose()` falls through the existing `if (this.savedResumptionHandle && this.lastConfig)` guard — `savedResumptionHandle` is undefined (cleared in the failure path) so it short-circuits and goes to the `onClose` callback. With the **current** code the test will likely fail with "expected onClose not to have been called" because the stray close DOES fire onClose.

This is OK — we're confirming the test catches the bug. Move on to the implementation in Task 4.

- [ ] **Step 3: Commit the new failing test**

```bash
git add src/services/clients/GeminiClient.test.ts
git commit -m "test(gemini): add test for lastConfig cleared after failed retries

After all reconnect retries fail, the failure path must clear
lastConfig so subsequent stray onclose events do not loop back
into reconnect(). The implementation follows.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add new GeminiClient test for "fresh reconnect uses no handle"

Verify that when `connect()` is called as part of fresh reconnect, the `liveConfig.sessionResumption.handle` is `undefined`. This is what guarantees the SDK opens a brand-new session.

**Files:**
- Modify: `src/services/clients/GeminiClient.test.ts`

- [ ] **Step 1: Add the new test after Test 13**

```typescript
  // ── Test 14: fresh reconnect passes undefined handle to connect() ────────
  it('fresh reconnect calls connect() with sessionResumption.handle === undefined', async () => {
    await client.connect(baseConfig);
    // No resumption update sent → no handle

    // Capture the next connect() call's config
    let secondCallConfig: any = undefined;
    mockLiveConnect.mockImplementationOnce(async ({ config, callbacks }: any) => {
      secondCallConfig = config;
      capturedCallbacks = callbacks;
      callbacks.onopen();
      return mockSession;
    });

    sendGoAway();
    await vi.runAllTimersAsync();

    expect(secondCallConfig).toBeDefined();
    expect(secondCallConfig.sessionResumption).toBeDefined();
    expect(secondCallConfig.sessionResumption.handle).toBeUndefined();
    expect(handlers.onReconnected).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to confirm it FAILS**

Run: `npx vitest run src/services/clients/GeminiClient.test.ts -t "fresh reconnect calls connect" 2>&1 | tail -30`

Expected: Test FAILS. With the current code, `goAway` without a handle does not trigger reconnect at all, so `mockLiveConnect.mockImplementationOnce` is never consumed and `secondCallConfig` remains `undefined`.

- [ ] **Step 3: Commit the new failing test**

```bash
git add src/services/clients/GeminiClient.test.ts
git commit -m "test(gemini): verify fresh reconnect passes undefined handle

The fresh-reconnect path must call connect() with
sessionResumption.handle === undefined so the SDK opens a
brand-new session instead of trying to resume.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Implement the GeminiClient fresh-reconnect changes

Make all six code changes from the spec in a single atomic commit. The failing tests from Tasks 1-3 should all pass after this.

**Files:**
- Modify: `src/services/clients/GeminiClient.ts`

- [ ] **Step 1: Change `disconnect()` to clear `lastConfig`**

In `src/services/clients/GeminiClient.ts`, find the `disconnect()` method (around line 851) and add the `this.lastConfig = null;` line. Existing method:

```typescript
  async disconnect(): Promise<void> {
    this.isReconnecting = false;
    this.savedResumptionHandle = undefined;
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    this.isConnectedState = false;
    this.conversationItems = [];
    this.resetCurrentTurn();
  }
```

Replace with:

```typescript
  async disconnect(): Promise<void> {
    this.isReconnecting = false;
    this.savedResumptionHandle = undefined;
    this.lastConfig = null;  // Marks user-initiated disconnect — onclose must not reconnect
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    this.isConnectedState = false;
    this.conversationItems = [];
    this.resetCurrentTurn();
  }
```

- [ ] **Step 2: Relax `reconnect()` guard**

Find the `reconnect()` method (around line 863) and change its guard line. Existing first line of method body:

```typescript
    if (this.isReconnecting || !this.savedResumptionHandle || !this.lastConfig) return;
```

Replace with:

```typescript
    // Guard: only reconnect when the client is still expected to be alive (lastConfig set)
    // and we're not already in the middle of a reconnect. We deliberately do NOT require
    // savedResumptionHandle — a silent client that never produced a turn has no handle but
    // also has no state to lose, so a fresh connection is functionally equivalent to a resume.
    if (this.isReconnecting || !this.lastConfig) return;
```

- [ ] **Step 3: Clear `lastConfig` in the failure path of `reconnect()`**

Within the same `reconnect()` method, find the "All retries failed" block (around line 911-928). Existing code:

```typescript
    // All retries failed — treat as real disconnect
    const closeEvent = {
      code: 0,
      reason: 'Reconnection failed after 3 attempts',
      error: lastReconnectError instanceof Error ? lastReconnectError.message : String(lastReconnectError),
    };
    this.isReconnecting = false;
    this.savedResumptionHandle = undefined;
    this.isConnectedState = false;
    this.conversationItems = [];
```

Replace with (one new line):

```typescript
    // All retries failed — treat as real disconnect
    const closeEvent = {
      code: 0,
      reason: 'Reconnection failed after 3 attempts',
      error: lastReconnectError instanceof Error ? lastReconnectError.message : String(lastReconnectError),
    };
    this.isReconnecting = false;
    this.savedResumptionHandle = undefined;
    this.lastConfig = null;  // Prevent stray onclose from looping back into reconnect()
    this.isConnectedState = false;
    this.conversationItems = [];
```

- [ ] **Step 4: Relax the `onclose` guard**

Find the `onclose` callback inside `connect()` (around line 421). Existing code:

```typescript
          onclose: (event: CloseEvent) => {
            console.info('[Sokuji] [GeminiClient] Session closed', event);
            this.session = null;

            // If already reconnecting (triggered by goAway), skip — reconnect() handles it
            if (this.isReconnecting) return;

            // Unexpected close — attempt reconnection if we have a handle
            if (this.savedResumptionHandle && this.lastConfig) {
              this.reconnect();
              return;
            }

            // No handle available — real disconnect (existing cleanup logic)
            this.isConnectedState = false;
```

Replace the entire block (from the `// Unexpected close — attempt reconnection if we have a handle` comment through the `// No handle available — real disconnect (existing cleanup logic)` comment, **inclusive** of both comment lines) with:

```typescript
          onclose: (event: CloseEvent) => {
            console.info('[Sokuji] [GeminiClient] Session closed', event);
            this.session = null;

            // If already reconnecting (triggered by goAway), skip — reconnect() handles it
            if (this.isReconnecting) return;

            // Unexpected close — attempt reconnection if the client is still expected
            // to be alive. Fresh-connect path is taken automatically when there is no
            // saved handle (silent client with no state to lose).
            if (this.lastConfig) {
              this.reconnect();
              return;
            }

            // No lastConfig — disconnect() was called explicitly. Run real cleanup.
            this.isConnectedState = false;
```

- [ ] **Step 5: Relax the `goAway` handler guard**

Find the `goAway` block in `handleMessage()` (around line 495). Existing:

```typescript
    if (message.goAway) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: 'goAway', data: message.goAway }
      });
      // Proactive reconnection — we have ~60s before ABORTED
      if (this.savedResumptionHandle && this.lastConfig) {
        this.reconnect();
      }
    }
```

Replace with:

```typescript
    if (message.goAway) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: 'goAway', data: message.goAway }
      });
      // Proactive reconnection — we have ~60s before ABORTED.
      // Fresh-connect path is taken when no handle has been issued yet.
      if (this.lastConfig) {
        this.reconnect();
      }
    }
```

- [ ] **Step 6: Relax `simulateDisconnectForTesting()` precondition**

Find the dev-only helper (around line 935). Existing:

```typescript
  simulateDisconnectForTesting(): void {
    if (!this.session || !this.savedResumptionHandle) {
      console.warn('[Sokuji] [GeminiClient] Cannot simulate disconnect: no session or no resumption handle');
      return;
    }
    console.info('[Sokuji] [GeminiClient] DEV: Simulating disconnect to test reconnection');
    this.session.close();  // Forces onclose → triggers reconnect path
  }
```

Replace with:

```typescript
  simulateDisconnectForTesting(): void {
    if (!this.session) {
      console.warn('[Sokuji] [GeminiClient] Cannot simulate disconnect: no session');
      return;
    }
    console.info('[Sokuji] [GeminiClient] DEV: Simulating disconnect to test reconnection');
    this.session.close();  // Forces onclose → triggers reconnect path (fresh or resume)
  }
```

- [ ] **Step 7: Run all GeminiClient tests to verify everything passes**

Run: `npx vitest run src/services/clients/GeminiClient.test.ts 2>&1 | tail -50`

Expected: All 14 tests PASS. (Tests 1, 3, 5, 7-11 unchanged; Tests 2, 4, 6, 12 updated in Task 1; Tests 13 and 14 added in Tasks 2-3.)

If any test fails, do not proceed. Read the failure carefully — likely culprits:
- Forgot to apply one of the six changes above
- Typo in `lastConfig` vs `savedResumptionHandle`
- Test 13 still fails: check that the failure path's `this.lastConfig = null;` is in place
- Test 14 still fails: check that `goAway` handler now uses `this.lastConfig` only

- [ ] **Step 8: Run TypeScript compile check**

Run: `npx tsc --noEmit 2>&1 | grep -E "GeminiClient" | head -20`

Expected: No errors mentioning `GeminiClient`. (Pre-existing errors in unrelated files are OK; only the GeminiClient file should be in scope.)

- [ ] **Step 9: Commit the GeminiClient implementation**

```bash
git add src/services/clients/GeminiClient.ts
git commit -m "fix(gemini): fresh reconnect for clients without resumption handle

Closes the silent-speaker bug from #179. A GeminiClient that has
never received a sessionResumptionUpdate (because it never produced
a turn — the typical mute-mic case) used to fall through to the
real-disconnect path on goAway, killing the entire dual-client
session via MainPanel's coupled cleanup. Now the reconnect/onclose/
goAway guards use lastConfig only, so a silent client opens a fresh
session (no handle, no state to lose) and the user notices nothing.

Six small changes inside GeminiClient.ts:
1. disconnect() clears lastConfig (user-initiated disconnect signal)
2. reconnect() guard relaxed to lastConfig only
3. reconnect() failure path clears lastConfig
4. onclose handler guard relaxed to lastConfig only
5. goAway handler guard relaxed to lastConfig only
6. simulateDisconnectForTesting() drops the savedResumptionHandle precondition

All 14 GeminiClient unit tests pass.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Add re-entry guard to `disconnectConversation` in MainPanel

The participant `onClose` will route through `disconnectConversation()`, which itself calls `disconnect()` on the speaker client, which fires speaker `onclose` → speaker `onClose` → `disconnectConversation()` again. A re-entry guard at the top of `disconnectConversation()` short-circuits the second call.

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Add the re-entry guard at the top of `disconnectConversation`**

In `src/components/MainPanel/MainPanel.tsx`, find the start of `disconnectConversation` (around line 843). The current first line is:

```typescript
  const disconnectConversation = useCallback(async () => {
    setIsReconnecting(false);
    setIsSessionActive(false);
```

Replace with:

```typescript
  const disconnectConversation = useCallback(async () => {
    // Re-entry guard: when one client's onClose calls this and we then disconnect
    // the OTHER client, that client's onClose also calls this. The Zustand store
    // updates synchronously, so checking isSessionActive here catches the second call.
    if (!useSessionStore.getState().isSessionActive) {
      console.info('[Sokuji] [MainPanel] disconnectConversation re-entry blocked (already inactive)');
      return;
    }
    setIsReconnecting(false);
    setIsSessionActive(false);
```

- [ ] **Step 2: Verify `useSessionStore` is already imported in this file**

Run: `grep -n "useSessionStore" /home/jiangzhuo/Desktop/kizunaai/sokuji-react/src/components/MainPanel/MainPanel.tsx | head -3`

Expected: At least one match showing the import or a `useSessionStore.getState()` / `useSessionStore(...)` reference. If not present, add `useSessionStore` to the existing `'../../stores/sessionStore'` import.

- [ ] **Step 3: TypeScript compile check**

Run: `npx tsc --noEmit 2>&1 | grep -E "MainPanel" | head -20`

Expected: No new errors in MainPanel.tsx beyond any pre-existing ones.

- [ ] **Step 4: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(main-panel): add re-entry guard to disconnectConversation

Prepares for routing both speaker and participant onClose handlers
through disconnectConversation(). When one client tears down the
other, that other client's onClose will fire and re-enter
disconnectConversation; the guard returns early.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Wire `disconnectConversationRef` so client `onClose` callbacks can call it

The speaker and participant event handlers are defined inside `useCallback` blocks that run BEFORE `disconnectConversation` is defined. Adding `disconnectConversation` to those `useCallback` deps would create a forward reference. Use a ref pattern instead.

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Find a good location for the ref declaration**

The other refs in this component live near the top of the function body (search for `useRef` declarations around lines 460-480). Find the cluster of `*Ref = useRef(...)` declarations near the system audio client ref.

Run: `grep -n "systemAudioClientRef" /home/jiangzhuo/Desktop/kizunaai/sokuji-react/src/components/MainPanel/MainPanel.tsx | head -5`

Note the line of the `useRef` declaration for `systemAudioClientRef`. Insert the new ref immediately after it.

- [ ] **Step 2: Add the ref**

```typescript
  // Ref to disconnectConversation — used by client onClose handlers, which are
  // captured inside setupClientListeners (a useCallback that runs before
  // disconnectConversation is defined). This avoids a forward reference cycle.
  const disconnectConversationRef = useRef<(() => Promise<void>) | null>(null);
```

- [ ] **Step 3: Wire the ref after `disconnectConversation` is defined**

Find the closing `}, [refetchAll, setIsReconnecting]);` of `disconnectConversation` (around line 939). Immediately after it, add the following `useEffect`. Using `useEffect` (rather than a direct assignment in the render body) avoids touching ref state during render:

```typescript
  // Keep the ref in sync so client onClose handlers can call disconnectConversation
  // without creating a useCallback dep cycle. The ref is read inside async event
  // handlers, so a one-render lag is acceptable.
  useEffect(() => {
    disconnectConversationRef.current = disconnectConversation;
  }, [disconnectConversation]);
```

- [ ] **Step 4: TypeScript compile check**

Run: `npx tsc --noEmit 2>&1 | grep -E "MainPanel" | head -20`

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "refactor(main-panel): add disconnectConversationRef for client onClose

Lets the speaker and participant client onClose handlers call
disconnectConversation without creating a useCallback dep cycle.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Route speaker `onClose` through `disconnectConversation`

Replace the inline cleanup body in the speaker client's `onClose` handler with a call through the ref. The trackEvent for analytics is preserved (as it distinguishes "client died" from "user clicked Stop").

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Replace the speaker `onClose` body**

Find the speaker `onClose` handler inside `setupClientListeners` (around line 674-731). Existing:

```typescript
      onClose: async (event: any) => {
        console.info('[Sokuji] [MainPanel] Connection closed, cleaning up session', event);
        setIsReconnecting(false);

        // Track disconnection
        trackEvent('connection_status', {
          status: 'disconnected',
          provider: provider || Provider.OPENAI
        });

        // When connection closes, clean up the session state
        setIsSessionActive(false);
        setIsAIResponding(false);
        pendingTextRef.current = null;

        // Disconnect participant client when speaker disconnects
        const systemClient = systemAudioClientRef.current;
        if (systemClient) {
          try {
            console.info('[Sokuji] [MainPanel] Speaker disconnected, also disconnecting participant client');
            await systemClient.disconnect();
            systemClient.reset();
            systemAudioClientRef.current = null;

            // Stop participant audio recording
            const audioService = audioServiceRef.current;
            if (audioService) {
              if (audioService.isSystemAudioRecordingActive()) {
                await audioService.stopSystemAudioRecording();
              }
              if (audioService.isTabAudioRecordingActive?.()) {
                await audioService.stopTabAudioRecording();
              }
              // Clear participant streaming track
              audioService.clearStreamingTrack('system-audio-assistant');
            }
          } catch (error) {
            console.warn('[Sokuji] [MainPanel] Error disconnecting participant client:', error);
          }
        }

        // Clean up audio recording
        const audioService = audioServiceRef.current;
        if (audioService) {
          try {
            const recorder = audioService.getRecorder();
            if (recorder.isRecording()) {
              await audioService.pauseRecording();
              await audioService.stopRecording();
            }
          } catch (error) {
            console.warn('[Sokuji] [MainPanel] Error cleaning up recorder on close:', error);
          }

          // Interrupt any playing audio
          await audioService.interruptAudio();
        }
      },
```

Replace with:

```typescript
      onClose: async (event: any) => {
        console.info('[Sokuji] [MainPanel] Speaker client closed, tearing down session', event);

        // Track disconnection (analytics distinguishes client-side close from user stop)
        trackEvent('connection_status', {
          status: 'disconnected',
          provider: provider || Provider.OPENAI
        });

        // Route through disconnectConversation — handles both clients, audio,
        // streaming tracks, profile refresh, and the re-entry guard.
        await disconnectConversationRef.current?.();
      },
```

- [ ] **Step 2: TypeScript compile check**

Run: `npx tsc --noEmit 2>&1 | grep -E "MainPanel" | head -20`

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "fix(main-panel): route speaker onClose through disconnectConversation

The speaker onClose used to do its own incomplete cleanup that
forgot to clear ai-assistant streaming tracks, the audio quality
interval, and the profile refetch. Replacing it with a call to
disconnectConversation (gated by the re-entry guard) gives us the
full cleanup path on every speaker client close, regardless of
whether the user clicked Stop or the client died unexpectedly.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Route participant `onClose` through `disconnectConversation` (symmetric "陪葬")

The participant's `onClose` currently only logs. With fresh reconnect enabled, the participant client can now reach a permanent-failure `onClose`, and the user wants both clients to share fate. Route it through `disconnectConversation()` so participant death also tears down the speaker.

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Replace the participant `onClose` handler**

Find `createParticipantEventHandlers` (around line 268). Existing `onClose`:

```typescript
    onClose: async () => {
      console.info('[Sokuji] [MainPanel] Participant audio client closed (triggered by speaker disconnect or manual stop)');
    }
```

Replace with:

```typescript
    onClose: async () => {
      console.info('[Sokuji] [MainPanel] Participant client closed, tearing down session');

      // Track disconnection (analytics distinguishes client-side close from user stop)
      trackEvent('connection_status', {
        status: 'disconnected',
        provider: provider || Provider.OPENAI
      });

      // Symmetric "陪葬": participant death tears down the speaker too. The
      // re-entry guard inside disconnectConversation handles the case where
      // the speaker's own onClose is fired by speaker.disconnect() inside
      // this same call chain.
      await disconnectConversationRef.current?.();
    }
```

- [ ] **Step 2: Verify `trackEvent` and `provider` are in scope**

These come from the same hooks the speaker `onClose` uses. They should already be available because `createParticipantEventHandlers` is a `useCallback` defined in the same component scope.

Run: `grep -n "createParticipantEventHandlers" /home/jiangzhuo/Desktop/kizunaai/sokuji-react/src/components/MainPanel/MainPanel.tsx`

Read 5 lines after the match to see the `useCallback` deps. If `trackEvent` or `provider` is not already in the dep array, add them:

```typescript
  }, [addRealtimeEvent, trackEvent, provider]);
```

- [ ] **Step 3: TypeScript compile check**

Run: `npx tsc --noEmit 2>&1 | grep -E "MainPanel" | head -20`

Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "fix(main-panel): symmetric participant onClose tears down speaker

With fresh reconnect (PR following #180), the participant client
can now legitimately reach a permanent-failure onClose of its own.
Per the user's '陪葬' decision, both clients share fate — so the
participant onClose now routes through disconnectConversation,
which kills the speaker via the re-entry-guarded shared cleanup.

Closes the asymmetry where 'speaker dies → participant also dies'
was wired but 'participant dies → speaker keeps running silently'
was a latent bug.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Add `Ctrl+Shift+H` dev shortcut for participant simulate-disconnect

Extend the existing dev keyboard handler so it fires `simulateDisconnectForTesting()` on the participant client when `Ctrl+Shift+H` is pressed (in addition to the existing speaker shortcut on `Ctrl+Shift+G`).

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Find and replace the dev shortcut handler**

Find the existing dev shortcut block (around `MainPanel.tsx:2244-2260`):

```typescript
  // DEV ONLY: Ctrl+Shift+G to simulate Gemini disconnect for testing reconnection
  useEffect(() => {
    if (!isDevelopment()) return;

    const handleDevShortcut = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        const client = clientRef.current;
        if (client && typeof (client as any).simulateDisconnectForTesting === 'function') {
          (client as any).simulateDisconnectForTesting();
        }
      }
    };

    window.addEventListener('keydown', handleDevShortcut);
    return () => window.removeEventListener('keydown', handleDevShortcut);
  }, []);
```

Replace with:

```typescript
  // DEV ONLY: Ctrl+Shift+G simulates speaker disconnect; Ctrl+Shift+H simulates
  // participant disconnect. Both exercise the GeminiClient reconnection path.
  useEffect(() => {
    if (!isDevelopment()) return;

    const handleDevShortcut = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;

      if (e.key === 'G') {
        e.preventDefault();
        const client = clientRef.current;
        if (client && typeof (client as any).simulateDisconnectForTesting === 'function') {
          console.info('[Sokuji] [MainPanel] DEV: Simulating speaker disconnect');
          (client as any).simulateDisconnectForTesting();
        }
      } else if (e.key === 'H') {
        e.preventDefault();
        const participantClient = systemAudioClientRef.current;
        if (participantClient && typeof (participantClient as any).simulateDisconnectForTesting === 'function') {
          console.info('[Sokuji] [MainPanel] DEV: Simulating participant disconnect');
          (participantClient as any).simulateDisconnectForTesting();
        }
      }
    };

    window.addEventListener('keydown', handleDevShortcut);
    return () => window.removeEventListener('keydown', handleDevShortcut);
  }, []);
```

- [ ] **Step 2: TypeScript compile check**

Run: `npx tsc --noEmit 2>&1 | grep -E "MainPanel" | head -20`

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(dev): Ctrl+Shift+H simulates participant disconnect

Extends the existing Ctrl+Shift+G dev shortcut so we can also
exercise the participant client's reconnection path manually.
Both shortcuts call simulateDisconnectForTesting() which now
works regardless of whether the client has a saved resumption
handle.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Run the full project build to confirm nothing else broke

**Files:** none

- [ ] **Step 1: Run all tests in the repo**

Run: `npm test -- --run 2>&1 | tail -30`

Expected: All tests pass. Pay attention to any new failures in files outside `GeminiClient.test.ts` — they should be zero.

- [ ] **Step 2: TypeScript compile (full)**

Run: `npx tsc --noEmit 2>&1 | tail -40`

Expected: No new errors. Pre-existing errors are tolerated; the diff vs. main should be empty for this metric.

- [ ] **Step 3: Production build smoke**

Run: `npm run build 2>&1 | tail -20`

Expected: Build succeeds. Note any size warnings — they should match what main produces.

If anything fails here, do not move to Task 11 — diagnose and fix the regression first.

---

### Task 11: Manual smoke test (developer-driven)

These tests cannot be unit-tested because they require real WebSocket sessions and audio. Run them in `npm run electron:dev` or `npm run dev` with a real Gemini API key.

**Files:** none

- [ ] **Step 1: Test `Ctrl+Shift+G` on a silent speaker**

1. Start the app and configure Gemini with a valid API key.
2. Start a session WITHOUT speaking — keep the mic muted or completely silent.
3. Trigger participant audio (system audio or tab audio of a meeting/clip) so participant produces at least one turn.
4. Wait until you see `[GeminiClient] sessionResumptionUpdate` in the logs for the **participant** client (this confirms participant has a handle, but speaker still has none).
5. Press `Ctrl+Shift+G`.
6. Watch the logs. Expected sequence:
   - `[GeminiClient] DEV: Simulating speaker disconnect`
   - `[GeminiClient] Session closed`
   - `[MainPanel] Session reconnecting...`
   - `[GeminiClient] Session opened` for the speaker (note: in the new connection's `liveConfig`, `sessionResumption.handle` should be `undefined` — confirm by inspecting the realtime event log)
   - `[MainPanel] Session reconnected successfully`
7. Verify the participant audio still flows uninterrupted.
8. Verify the session is still active (Stop button visible, status dot green).

**If anything fails:** the speaker should fall back to the new fresh-reconnect path. If you see `[MainPanel] Speaker client closed, tearing down session` and the session ends, the fresh reconnect path is not being taken. Check that Task 4 was applied correctly.

- [ ] **Step 2: Test `Ctrl+Shift+H` on a silent participant**

1. Same setup but speak into the mic so the speaker produces a turn (and gets a handle), and DO NOT play any system audio (participant stays silent and has no handle).
2. Wait for the speaker handle to appear in logs.
3. Press `Ctrl+Shift+H`.
4. Expected: participant fresh-reconnects, speaker continues uninterrupted, session stays active.

- [ ] **Step 3: Test the "fresh reconnect fails → 陪葬 cleanup" path**

This is harder to trigger naturally. To force it:

1. Add a temporary breakpoint or `throw new Error('test')` inside `GeminiClient.connect()` (right after the existing `if (this.isConnectedState)` check).
2. Restart the app, start a session, mute mic, trigger participant audio, wait for participant handle.
3. Press `Ctrl+Shift+G`. The speaker will retry 3 times and all will throw → cleanup fires.
4. Expected: both speaker and participant disappear, Stop button reverts to Start button, no spurious errors.
5. Remove the temporary `throw` and re-test once.

- [ ] **Step 4: Test user-initiated Stop while a fresh reconnect is in flight**

1. Start a silent-mic session as in Step 1.
2. Press `Ctrl+Shift+G` and IMMEDIATELY press the Stop button (within ~1 second).
3. Expected: clean shutdown, no console errors, no zombie reconnect attempts.

- [ ] **Step 5: Sanity check that handle-based reconnect still works**

1. Start a session, speak briefly to give the speaker a handle.
2. Wait for `sessionResumptionUpdate` in logs.
3. Press `Ctrl+Shift+G`.
4. Expected: speaker resumes WITH the saved handle. The new connection's `sessionResumption.handle` should match the previously saved handle (NOT undefined). Conversation context is preserved.

This regression-tests that the existing PR #180 behavior still works for non-silent clients.

- [ ] **Step 6: Document the manual test results in the PR description**

When opening the PR, paste the observed log lines from the above steps so reviewers can see the fresh-reconnect path firing.

---

## Spec Coverage Self-Check

| Spec section | Plan task |
|---|---|
| Change 1: `disconnect()` clears `lastConfig` | Task 4 Step 1 |
| Change 2: `reconnect()` guard relaxed | Task 4 Step 2 |
| Change 3: `onclose` guard relaxed | Task 4 Step 4 |
| Change 4: `goAway` guard relaxed | Task 4 Step 5 |
| Change 5: `simulateDisconnectForTesting()` precondition relaxed | Task 4 Step 6 |
| Change 6: Reconnect failure clears `lastConfig` | Task 4 Step 3 |
| Change 7: Symmetric participant `onClose` cleanup | Tasks 5-8 |
| Change 8: Dev shortcut for both clients | Task 9 |
| Unit tests for fresh-reconnect (`goAway` + `onclose`) | Tasks 1, 3 |
| Unit test: `disconnect()` clears `lastConfig` | Task 1 Step 4 |
| Unit test: failure clears `lastConfig` | Task 2 |
| Manual test via Ctrl+Shift+G/H | Task 11 |
| Re-entry guard verified | Task 5 + manual Task 11 Step 3 |

All spec-required changes have a corresponding task.
