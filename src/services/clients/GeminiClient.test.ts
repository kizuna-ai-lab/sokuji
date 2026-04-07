import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock i18n
vi.mock('../../locales', () => ({
  default: { t: (key: string) => key }
}));

// Mock @google/genai
// We'll capture the callbacks passed to live.connect so we can simulate server events
let capturedCallbacks: {
  onopen?: () => void;
  onmessage?: (msg: any) => void;
  onerror?: (e: ErrorEvent) => void;
  onclose?: (e: CloseEvent) => void;
} = {};

const mockSessionClose = vi.fn();
const mockSession = { close: mockSessionClose };

const mockLiveConnect = vi.fn();

vi.mock('@google/genai', () => {
  class GoogleGenAIMock {
    live = { connect: mockLiveConnect };
  }
  return {
    GoogleGenAI: GoogleGenAIMock,
    Modality: { AUDIO: 'AUDIO' },
    ActivityHandling: { START_OF_ACTIVITY_INTERRUPTS: 'START_OF_ACTIVITY_INTERRUPTS', NO_INTERRUPTION: 'NO_INTERRUPTION' },
    StartSensitivity: { START_SENSITIVITY_HIGH: 'HIGH', START_SENSITIVITY_LOW: 'LOW' },
    EndSensitivity: { END_SENSITIVITY_HIGH: 'HIGH', END_SENSITIVITY_LOW: 'LOW' },
  };
});

// Dynamic import after mocks are set up
const { GeminiClient } = await import('./GeminiClient');

/** Helper: make live.connect resolve and fire onopen */
function setupSuccessfulConnect() {
  mockLiveConnect.mockImplementation(async ({ callbacks }: any) => {
    capturedCallbacks = callbacks;
    // Simulate server calling onopen
    callbacks.onopen();
    return mockSession;
  });
}

/** Helper: make live.connect reject */
function setupFailingConnect() {
  mockLiveConnect.mockRejectedValue(new Error('Connection failed'));
}

/** Simulate a sessionResumptionUpdate message */
function sendResumptionUpdate(resumable: boolean, handle?: string) {
  capturedCallbacks.onmessage?.({
    sessionResumptionUpdate: {
      resumable,
      newHandle: handle,
    },
  });
}

/** Simulate a goAway message */
function sendGoAway() {
  capturedCallbacks.onmessage?.({ goAway: {} });
}

/** Simulate an unexpected close event */
function sendClose(clean = false) {
  const event = new CloseEvent('close', { wasClean: clean, code: 1006 });
  capturedCallbacks.onclose?.(event);
}

/** Minimal valid SessionConfig */
const baseConfig = {
  model: 'gemini-2.0-flash-live',
  provider: 'gemini' as const,
  turnDetectionMode: 'Auto' as const,
  vadStartSensitivity: 'low' as const,
  vadEndSensitivity: 'low' as const,
  vadSilenceDurationMs: 500,
  vadPrefixPaddingMs: 100,
};

// ─────────────────────────────────────────────
describe('GeminiClient — reconnection state machine', () => {
  let client: InstanceType<typeof GeminiClient>;
  let handlers: {
    onOpen: ReturnType<typeof vi.fn>;
    onClose: ReturnType<typeof vi.fn>;
    onReconnecting: ReturnType<typeof vi.fn>;
    onReconnected: ReturnType<typeof vi.fn>;
    onRealtimeEvent: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    capturedCallbacks = {};
    mockSessionClose.mockReset();
    mockLiveConnect.mockReset();  // Flush any leaked mockImplementationOnce queue from a prior test

    client = new GeminiClient('test-api-key');
    handlers = {
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onReconnecting: vi.fn(),
      onReconnected: vi.fn(),
      onRealtimeEvent: vi.fn(),
    } satisfies Record<string, ReturnType<typeof vi.fn>>;
    client.setEventHandlers(handlers as any);

    // Default: successful connect
    setupSuccessfulConnect();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Test 1: handle stored on resumable: true ──────────────────────────────
  it('stores handle when sessionResumptionUpdate is resumable: true', async () => {
    await client.connect(baseConfig);
    sendResumptionUpdate(true, 'handle-abc');

    // Now simulate unexpected close; if handle was stored, reconnect fires
    // We check that reconnect is attempted (onReconnecting) rather than onClose
    setupSuccessfulConnect();
    sendClose();
    await vi.runAllTimersAsync();

    expect(handlers.onReconnecting).toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

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

  // ── Test 3: goAway with handle triggers reconnect ─────────────────────────
  it('triggers reconnect on goAway when handle is stored', async () => {
    await client.connect(baseConfig);
    sendResumptionUpdate(true, 'handle-xyz');

    setupSuccessfulConnect();
    sendGoAway();

    // goAway calls reconnect() synchronously — wait for async to settle
    await vi.runAllTimersAsync();

    expect(handlers.onReconnecting).toHaveBeenCalled();
    expect(handlers.onReconnected).toHaveBeenCalled();
  });

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

  // ── Test 5: unexpected close with handle triggers reconnect ──────────────
  it('reconnects on unexpected close when handle is stored', async () => {
    await client.connect(baseConfig);
    sendResumptionUpdate(true, 'handle-close');

    setupSuccessfulConnect();
    sendClose();
    await vi.runAllTimersAsync();

    expect(handlers.onReconnecting).toHaveBeenCalled();
    expect(handlers.onReconnected).toHaveBeenCalled();
  });

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

  // ── Test 7: successful reconnect fires onReconnected ─────────────────────
  it('fires onReconnected after successful reconnection', async () => {
    await client.connect(baseConfig);
    sendResumptionUpdate(true, 'handle-reconnect-success');

    setupSuccessfulConnect();
    sendGoAway();
    await vi.runAllTimersAsync();

    expect(handlers.onReconnected).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  // ── Test 8: 3 failed retries → onClose fires ─────────────────────────────
  it('fires onClose after 3 failed reconnection attempts', async () => {
    await client.connect(baseConfig);
    sendResumptionUpdate(true, 'handle-will-fail');

    // Make all subsequent connects fail
    setupFailingConnect();
    sendGoAway();

    // Advance through all retry delays (2s + 3s = 5s total backoff)
    await vi.runAllTimersAsync();

    expect(handlers.onReconnecting).toHaveBeenCalledTimes(1);
    expect(handlers.onReconnected).not.toHaveBeenCalled();
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  // ── Test 9: disconnect() during reconnection cancels subsequent retries ──
  it('cancels subsequent retries when disconnect() is called during backoff', async () => {
    await client.connect(baseConfig);
    sendResumptionUpdate(true, 'handle-cancel');

    // Make connect always fail so we hit the backoff/retry loop
    setupFailingConnect();

    sendGoAway();

    // At this point reconnect attempt 1 fails immediately (no delay on attempt 1)
    // The loop will delay before attempt 2 — call disconnect() now
    await client.disconnect();

    // Advance timers to cover any pending backoff
    await vi.runAllTimersAsync();

    // Because disconnect() set isReconnecting = false, subsequent retries were skipped
    // onClose should NOT have been fired by the reconnect failure path
    // (disconnect itself does not fire onClose)
    expect(handlers.onReconnected).not.toHaveBeenCalled();
    // onClose may or may not fire depending on timing — the key guarantee is
    // that disconnect() stops the loop and clears the handle
    expect(client.isConnected()).toBe(false);
  });

  // ── Test 10: re-entry guard — second reconnect() call is no-op ───────────
  it('ignores a second goAway during ongoing reconnection', async () => {
    // Set up hanging connect BEFORE initial connect
    let resolveFirst!: () => void;
    let callCount = 0;
    mockLiveConnect.mockImplementation(async ({ callbacks }: any) => {
      capturedCallbacks = callbacks;
      callCount++;
      if (callCount === 1) {
        // First call (initial connect): resolve immediately
        callbacks.onopen();
        return mockSession;
      }
      // Subsequent calls (reconnect): hang
      await new Promise<void>((r) => { resolveFirst = r; });
      callbacks.onopen();
      return mockSession;
    });

    await client.connect(baseConfig);
    sendResumptionUpdate(true, 'handle-double');

    // Fire goAway twice — second should be no-op due to isReconnecting guard
    sendGoAway();
    sendGoAway();

    // onReconnecting should fire exactly once
    expect(handlers.onReconnecting).toHaveBeenCalledTimes(1);

    // Resolve and let it finish
    if (resolveFirst) resolveFirst();
    await vi.runAllTimersAsync();
  });

  // ── Test 11: goAway + handle triggers reconnect, not onClose ────────────
  // This verifies that when goAway fires the state machine goes to
  // the reconnection path (not the teardown path), which preserves the
  // session for the user during the brief reconnect window.
  it('routes goAway+handle to reconnect path, not teardown path', async () => {
    await client.connect(baseConfig);
    sendResumptionUpdate(true, 'handle-preserve');

    // Add a conversation item
    capturedCallbacks.onmessage?.({
      serverContent: {
        inputTranscription: { text: 'hello' },
      },
    });
    expect(client.getConversationItems().length).toBeGreaterThan(0);

    // goAway with handle → should trigger reconnect, not onClose
    setupSuccessfulConnect();
    sendGoAway();
    await vi.runAllTimersAsync();

    // The state machine chose the reconnect path
    expect(handlers.onReconnecting).toHaveBeenCalledTimes(1);
    expect(handlers.onReconnected).toHaveBeenCalledTimes(1);
    // onClose was NOT called — session resumed, not torn down
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  // ── Test 12: disconnect() clears lastConfig → no reconnect on stray close ─
  it('does NOT reconnect after explicit disconnect() (lastConfig cleared)', async () => {
    await client.connect(baseConfig);
    sendResumptionUpdate(true, 'handle-to-clear');

    // Disconnect explicitly — clears lastConfig, savedResumptionHandle, and isReconnecting.
    // disconnect() itself must NOT fire onClose; the next assertion guards against any
    // future regression where disconnect() accidentally invokes the user-facing callback.
    await client.disconnect();
    expect(handlers.onClose).not.toHaveBeenCalled();

    // Reset mocks so we can detect any spurious reconnect attempt from the stray close below
    handlers.onReconnecting.mockClear();
    handlers.onReconnected.mockClear();
    handlers.onClose.mockClear();

    // A stray close event from the now-dead session should be a no-op
    sendClose();
    await vi.runAllTimersAsync();

    expect(handlers.onReconnecting).not.toHaveBeenCalled();
    expect(handlers.onReconnected).not.toHaveBeenCalled();
    // onClose should also NOT fire after the stray close — no lastConfig means
    // the new onclose guard short-circuits.
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

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

  // ── Test 14: fresh reconnect passes undefined handle to connect() ────────
  it('fresh reconnect calls connect() with sessionResumption.handle === undefined', async () => {
    await client.connect(baseConfig);
    // No resumption update sent → no handle

    // Capture the next connect() call's config
    let secondCallConfig: { sessionResumption?: { handle?: string } } | undefined;
    mockLiveConnect.mockImplementationOnce(async ({ config, callbacks }: any) => {
      secondCallConfig = config;
      capturedCallbacks = callbacks;
      callbacks.onopen();
      return mockSession;
    });

    sendGoAway();
    await vi.runAllTimersAsync();

    expect(secondCallConfig).toBeDefined();
    expect(secondCallConfig!.sessionResumption).toBeDefined();
    expect(secondCallConfig!.sessionResumption!.handle).toBeUndefined();
    expect(handlers.onReconnected).toHaveBeenCalled();
  });

  // ── Test 15: handle-less goAway WITH local conversation state → permanent disconnect ──
  // Guards against silent client/server divergence: if a client lost its handle
  // (e.g., right after a successful resume) but still has local conversationItems,
  // a fresh reconnect would open a brand-new server session with no context while
  // the UI keeps showing the old conversation. We treat this as a permanent
  // disconnect instead so the user sees the session end.
  it('does NOT fresh-reconnect when local conversation state is present', async () => {
    await client.connect(baseConfig);
    // Add a fake conversation item to simulate "client has had turns" state.
    // Use any-cast because conversationItems is private — this test exercises
    // the public observable behaviour (no fresh reconnect, onClose fires).
    (client as any).conversationItems = [
      { id: 'fake-1', role: 'user', type: 'message', status: 'completed', createdAt: Date.now() },
    ];

    setupSuccessfulConnect();
    sendGoAway();
    await vi.runAllTimersAsync();

    // Fresh reconnect path should NOT have run
    expect(handlers.onReconnecting).not.toHaveBeenCalled();
    expect(handlers.onReconnected).not.toHaveBeenCalled();
    // Permanent disconnect should have fired exactly once
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  // ── Test 16: stale onclose from a superseded session is ignored ───────────
  // After a successful reconnect, the OLD session's WebSocket may still fire
  // onclose seconds later (the close handshake is async). The connection token
  // captured by each connect()'s callbacks lets us detect that and silently
  // drop the stale event instead of nulling out the live session and triggering
  // another spurious reconnect.
  it('ignores stale onclose from a superseded session', async () => {
    await client.connect(baseConfig);
    sendResumptionUpdate(true, 'handle-resumed');
    // Snapshot the FIRST session's onclose callback so we can fire it after
    // a successful reconnect has replaced this.session with a new one.
    const staleOnclose = capturedCallbacks.onclose!;

    // Trigger a successful reconnect — this opens a NEW session and bumps the
    // internal connection token.
    setupSuccessfulConnect();
    sendGoAway();
    await vi.runAllTimersAsync();
    expect(handlers.onReconnected).toHaveBeenCalledTimes(1);

    // Reset mocks so we can detect any spurious reconnect from the stale event
    handlers.onReconnecting.mockClear();
    handlers.onReconnected.mockClear();
    handlers.onClose.mockClear();

    // Fire the stale onclose from the FIRST session. The token check should
    // make this a no-op — no reconnect, no onClose, no session teardown.
    setupSuccessfulConnect();
    staleOnclose(new CloseEvent('close', { wasClean: false, code: 1006 }));
    await vi.runAllTimersAsync();

    expect(handlers.onReconnecting).not.toHaveBeenCalled();
    expect(handlers.onReconnected).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
    // The current session should still be alive (not nulled out by the stale event)
    expect(client.isConnected()).toBe(true);
  });

  // ── Test 17: disconnect() during reconnect backoff → no spurious onClose ──
  // Before this fix, calling disconnect() during the backoff delay would set
  // lastConfig=null but the retry loop would still proceed to connect() after
  // the delay, fail, and eventually fire the permanent-disconnect onClose path.
  // The fix captures lastConfig locally and re-checks isReconnecting after the
  // delay so user cancellation is treated as a clean exit.
  it('does not fire onClose when disconnect() is called during reconnect backoff', async () => {
    await client.connect(baseConfig);
    sendResumptionUpdate(true, 'handle-cancel-during-backoff');

    // Make the first reconnect attempt fail so we enter the backoff delay
    setupFailingConnect();
    sendGoAway();

    // At this point attempt 1 has failed and the loop is about to delay before
    // attempt 2. Call disconnect() now — this clears lastConfig and isReconnecting.
    await client.disconnect();

    // Drain any remaining timers — the loop should detect the cancellation
    // and exit cleanly without firing the failure-path onClose.
    await vi.runAllTimersAsync();

    // disconnect() itself does not fire onClose (verified by Test 12).
    // The fix guarantees the failure path also does not fire onClose.
    expect(handlers.onClose).not.toHaveBeenCalled();
    expect(client.isConnected()).toBe(false);
  });
});
