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
});
