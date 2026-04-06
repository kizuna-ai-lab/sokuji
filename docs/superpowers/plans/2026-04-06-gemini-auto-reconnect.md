# Gemini Auto-Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement transparent auto-reconnection for Gemini Live API sessions using Google's Session Resumption API and Context Window Compression, so users never have to manually reconnect after server-side timeouts.

**Architecture:** All reconnection logic is encapsulated within `GeminiClient`. On `goAway` or unexpected WebSocket close, the client automatically reconnects using a stored session resumption handle. MainPanel is notified via two new optional callbacks (`onReconnecting`/`onReconnected`) and displays a brief "Reconnecting..." indicator via `sessionStore.isReconnecting`. Other providers are unaffected.

**Tech Stack:** TypeScript, @google/genai SDK (Session Resumption API, Context Window Compression), Zustand, Vitest

**Spec:** `docs/superpowers/specs/2026-04-06-gemini-auto-reconnect-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/services/interfaces/IClient.ts` | Modify | Add `onReconnecting`/`onReconnected` to `ClientEventHandlers` |
| `src/stores/sessionStore.ts` | Modify | Add `isReconnecting` state, setter, and selector |
| `src/services/clients/GeminiClient.ts` | Modify | Core reconnection logic, handle storage, config changes, dev test method |
| `src/components/MainPanel/MainPanel.tsx` | Modify | Wire up new callbacks, dev shortcut (Ctrl+Shift+G) |
| `src/components/ConnectionStatus/ConnectionStatus.tsx` | Modify | Add `'reconnecting'` state |
| `src/services/clients/GeminiClient.test.ts` | Create | Unit tests for reconnection state machine |

---

### Task 1: Add Reconnection Callbacks to IClient Interface

**Files:**
- Modify: `src/services/interfaces/IClient.ts:202-209`

- [ ] **Step 1: Add `onReconnecting` and `onReconnected` to `ClientEventHandlers`**

In `src/services/interfaces/IClient.ts`, add two optional callbacks after `onRealtimeEvent`:

```typescript
export interface ClientEventHandlers {
  onOpen?: () => void;
  onClose?: (event: any) => void;
  onError?: (error: any) => void;
  onConversationUpdated?: (data: { item: ConversationItem; delta?: any }) => void;
  onConversationInterrupted?: () => void;
  onRealtimeEvent?: (event: RealtimeEvent) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors (existing errors unrelated to this change are OK).

- [ ] **Step 3: Commit**

```bash
git add src/services/interfaces/IClient.ts
git commit -m "feat(gemini): add onReconnecting/onReconnected callbacks to ClientEventHandlers"
```

---

### Task 2: Add `isReconnecting` State to sessionStore

**Files:**
- Modify: `src/stores/sessionStore.ts`

- [ ] **Step 1: Add `isReconnecting` to the store interface, initial state, setter, and selectors**

In `src/stores/sessionStore.ts`, add to the `SessionStore` interface after `translationCount`:

```typescript
interface SessionStore {
  // State
  isSessionActive: boolean;
  sessionId: string | null;
  sessionStartTime: number | null;
  translationCount: number;
  isReconnecting: boolean;
  
  // Actions
  setIsSessionActive: (active: boolean) => void;
  setSessionId: (id: string | null) => void;
  setSessionStartTime: (time: number | null) => void;
  setTranslationCount: (count: number) => void;
  incrementTranslationCount: () => void;
  setIsReconnecting: (reconnecting: boolean) => void;
  
  // Compound actions
  startSession: (sessionId: string) => void;
  endSession: () => void;
  resetSession: () => void;
}
```

Add to the store implementation, after `incrementTranslationCount`:

```typescript
    isReconnecting: false,
    
    setIsReconnecting: (reconnecting) => set({ isReconnecting: reconnecting }),
```

Add `isReconnecting: false` to the `endSession` and `resetSession` compound actions:

```typescript
    endSession: () => set({
      isSessionActive: false,
      isReconnecting: false,
      sessionId: null,
      sessionStartTime: null,
    }),
    
    resetSession: () => set({
      isSessionActive: false,
      isReconnecting: false,
      sessionId: null,
      sessionStartTime: null,
      translationCount: 0,
    }),
```

Add selectors after the existing exports (around line 81):

```typescript
export const useIsReconnecting = () => useSessionStore((state) => state.isReconnecting);
export const useSetIsReconnecting = () => useSessionStore((state) => state.setIsReconnecting);
```

Add `setIsReconnecting` to the `useSessionActions` hook and its `useMemo` dependencies. Add `isReconnecting` to the `useSession` hook and its `useMemo` dependencies.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/stores/sessionStore.ts
git commit -m "feat(gemini): add isReconnecting state to sessionStore"
```

---

### Task 3: Add `reconnecting` State to ConnectionStatus Component

**Files:**
- Modify: `src/components/ConnectionStatus/ConnectionStatus.tsx`

- [ ] **Step 1: Add `'reconnecting'` to `ConnectionState` type and handle it in `getStateInfo`**

In `src/components/ConnectionStatus/ConnectionStatus.tsx`, update the type:

```typescript
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'no-api-key' | 'no-mic';
```

Add a new case in `getStateInfo()` after `'connected'`:

```typescript
      case 'reconnecting':
        return {
          icon: <Loader size={compact ? 16 : 24} />,
          label: t('connectionStatus.reconnecting', 'Reconnecting...'),
          color: 'connecting',
          animate: true
        };
```

This reuses the `connecting` color and spin animation for visual consistency.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ConnectionStatus/ConnectionStatus.tsx
git commit -m "feat(gemini): add reconnecting state to ConnectionStatus component"
```

---

### Task 4: Implement GeminiClient Reconnection Logic

This is the core task. All reconnection logic is encapsulated within `GeminiClient`.

**Files:**
- Modify: `src/services/clients/GeminiClient.ts`

- [ ] **Step 1: Add new state properties**

After line 33 (`private isUserSpeaking = false;`), add:

```typescript
  // Session resumption state
  private savedResumptionHandle: string | undefined = undefined;
  private isReconnecting = false;
  private lastConfig: SessionConfig | null = null;
```

- [ ] **Step 2: Add `delay` helper method**

After the `arrayBufferToBase64` method (around line 943), add:

```typescript
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
```

- [ ] **Step 3: Store `lastConfig` at the start of `connect()`**

At the very beginning of `connect()` (line 300, after `if (this.isConnectedState)` block), add:

```typescript
    this.lastConfig = config;
```

Place it right after the existing disconnect check (after line 303), before `this.currentModel = config.model;`.

- [ ] **Step 4: Add `sessionResumption` and `contextWindowCompression` to `liveConfig`**

In the `connect()` method, after the existing `realtimeInputConfig` property in the `liveConfig` object (around line 359), add:

```typescript
      sessionResumption: {
        handle: this.savedResumptionHandle ?? undefined,
      },
      contextWindowCompression: {
        slidingWindow: {},
      },
```

- [ ] **Step 5: Modify the `onclose` callback to support reconnection**

Replace the existing `onclose` callback (lines 409-430) with:

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
            this.conversationItems = [];
            this.eventHandlers.onRealtimeEvent?.({
              source: 'client',
              event: { 
                type: 'session.closed', 
                data: {
                  code: event.code,
                  reason: event.reason,
                  type: event.type,
                  wasClean: event.wasClean,
                  isTrusted: event.isTrusted,
                  timestamp: event.timeStamp
                }
              }
            });
            this.eventHandlers.onClose?.(event);
          }
```

- [ ] **Step 6: Enhance `sessionResumptionUpdate` handler to store handles**

In `handleMessage()`, replace the existing `sessionResumptionUpdate` block (lines 480-485) with:

```typescript
    if (message.sessionResumptionUpdate) {
      // Store the latest resumption handle when the session is resumable
      if (message.sessionResumptionUpdate.resumable && message.sessionResumptionUpdate.newHandle) {
        this.savedResumptionHandle = message.sessionResumptionUpdate.newHandle;
      }
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: 'sessionResumptionUpdate', data: message.sessionResumptionUpdate }
      });
    }
```

- [ ] **Step 7: Enhance `goAway` handler to trigger proactive reconnection**

In `handleMessage()`, replace the existing `goAway` block (lines 473-478) with:

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

- [ ] **Step 8: Add `reconnect()` method**

After the `disconnect()` method (around line 829), add:

```typescript
  private async reconnect(): Promise<void> {
    if (this.isReconnecting || !this.savedResumptionHandle || !this.lastConfig) return;

    this.isReconnecting = true;
    this.eventHandlers.onReconnecting?.();

    // Close old session without triggering onClose cleanup
    // (onclose callback checks isReconnecting and returns early)
    if (this.session) {
      this.session.close();
      this.session = null;
    }

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (!this.isReconnecting) break;  // User cancelled via disconnect()
      try {
        if (attempt > 1) {
          await this.delay(1000 * attempt);  // Backoff: 2s, 3s
        }
        await this.connect(this.lastConfig);
        this.isReconnecting = false;
        this.eventHandlers.onReconnected?.();
        return;
      } catch (error) {
        console.warn(`[Sokuji] [GeminiClient] Reconnection attempt ${attempt}/${maxRetries} failed`, error);
      }
    }

    // All retries failed — treat as real disconnect
    this.isReconnecting = false;
    this.savedResumptionHandle = undefined;
    this.isConnectedState = false;
    this.conversationItems = [];
    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'session.closed',
        data: { code: 0, reason: 'Reconnection failed after 3 attempts' }
      }
    });
    this.eventHandlers.onClose?.({} as CloseEvent);
  }
```

- [ ] **Step 9: Modify `disconnect()` to clear handle and cancel reconnection**

In the `disconnect()` method (around line 821), add at the very beginning:

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

- [ ] **Step 10: Add `simulateDisconnectForTesting()` method**

After the `reconnect()` method, add:

```typescript
  /**
   * DEV ONLY: Simulate a disconnect to test the reconnection flow.
   * Called from MainPanel via Ctrl+Shift+G keyboard shortcut.
   */
  simulateDisconnectForTesting(): void {
    if (!this.session || !this.savedResumptionHandle) {
      console.warn('[Sokuji] [GeminiClient] Cannot simulate disconnect: no session or no resumption handle');
      return;
    }
    console.info('[Sokuji] [GeminiClient] DEV: Simulating disconnect to test reconnection');
    this.session.close();  // Forces onclose → triggers reconnect path
  }
```

- [ ] **Step 11: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 12: Commit**

```bash
git add src/services/clients/GeminiClient.ts
git commit -m "feat(gemini): implement auto-reconnect with session resumption and context compression

Enable session resumption and context window compression in the Gemini
Live API connection config. Store resumption handles from
sessionResumptionUpdate messages. On goAway or unexpected WebSocket
close, auto-reconnect with retry + backoff. Preserve conversation
items across reconnections.

Closes #179"
```

---

### Task 5: Wire Up MainPanel Callbacks and Dev Shortcut

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Import `useSetIsReconnecting` from sessionStore**

Add `useSetIsReconnecting` to the existing sessionStore imports at the top of MainPanel.tsx:

```typescript
import { useSetIsReconnecting } from '../../stores/sessionStore';
```

- [ ] **Step 2: Initialize the setter in the component**

Near the other session store hooks (around line 122 where `isSessionActive` is destructured), add:

```typescript
  const setIsReconnecting = useSetIsReconnecting();
```

- [ ] **Step 3: Add `onReconnecting` and `onReconnected` callbacks**

In the `useMemo` block that creates the event handlers (the block containing `onClose` at line 641), add the two new callbacks before `onClose`:

```typescript
      onReconnecting: () => {
        console.info('[Sokuji] [MainPanel] Session reconnecting...');
        setIsReconnecting(true);
        addLog('Session reconnecting...', 'warning');
        // Do NOT set isSessionActive to false
        // Do NOT clean up audio, participant clients, etc.
      },
      onReconnected: () => {
        console.info('[Sokuji] [MainPanel] Session reconnected successfully');
        setIsReconnecting(false);
        addLog('Session reconnected', 'success');
      },
```

- [ ] **Step 4: Add `setIsReconnecting(false)` at the start of `onClose`**

At the beginning of the existing `onClose` handler (line 641), add:

```typescript
      onClose: async (event: any) => {
        console.info('[Sokuji] [MainPanel] Connection closed, cleaning up session', event);
        setIsReconnecting(false);  // Ensure clean state
        // ...rest of existing onClose logic unchanged...
```

- [ ] **Step 5: Add `setIsReconnecting` to the `useMemo` dependency array**

The `useMemo` block that contains these handlers needs `setIsReconnecting` in its dependency array. Find the closing of the useMemo (the `], [...]` part after the handlers object) and add `setIsReconnecting` to the dependency list.

- [ ] **Step 6: Add Ctrl+Shift+G dev shortcut**

Add a new `useEffect` hook for the dev shortcut, near the existing keyboard shortcut hooks (around line 2143):

```typescript
  // DEV ONLY: Ctrl+Shift+G to simulate Gemini disconnect for testing reconnection
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;

    const handleDevShortcut = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        const client = clientRef.current;
        if (client && 'simulateDisconnectForTesting' in client) {
          (client as any).simulateDisconnectForTesting();
        }
      }
    };

    window.addEventListener('keydown', handleDevShortcut);
    return () => window.removeEventListener('keydown', handleDevShortcut);
  }, []);
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx
git commit -m "feat(gemini): wire up reconnection callbacks and dev shortcut in MainPanel"
```

---

### Task 6: Add Reconnecting Indicator to Basic Mode Footer

**Files:**
- Modify: `src/components/MainPanel/MainPanel.tsx`

- [ ] **Step 1: Add `useIsReconnecting` to the sessionStore import from Task 5**

The import added in Task 5 Step 1 should now include both:

```typescript
import { useIsReconnecting, useSetIsReconnecting } from '../../stores/sessionStore';
```

- [ ] **Step 2: Initialize `isReconnecting` in the component**

Near the `setIsReconnecting` hook added in Task 5 Step 2:

```typescript
  const isReconnecting = useIsReconnecting();
```

- [ ] **Step 3: Add reconnecting indicator to the basic mode footer**

In the basic mode footer (around line 2674), modify the status dot to reflect reconnecting state:

Replace:
```tsx
              <span className={`status-dot ${isSessionActive ? 'active' : ''}`} />
```

With:
```tsx
              <span className={`status-dot ${isReconnecting ? 'reconnecting' : isSessionActive ? 'active' : ''}`} />
              {isReconnecting && (
                <span className="reconnecting-label">
                  {t('connectionStatus.reconnecting', 'Reconnecting...')}
                </span>
              )}
```

- [ ] **Step 4: Add CSS for the reconnecting state**

In `src/components/MainPanel/MainPanel.scss`, find the `.status-dot` styles and add:

```scss
    &.reconnecting {
      background: #f39c12;
      animation: pulse 1s ease-in-out infinite;
    }
```

And add a style for the reconnecting label near the `.status-info` styles:

```scss
  .reconnecting-label {
    color: #f39c12;
    font-size: 12px;
    animation: pulse 1s ease-in-out infinite;
  }
```

- [ ] **Step 5: Verify TypeScript compiles and visuals look correct**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/MainPanel/MainPanel.tsx src/components/MainPanel/MainPanel.scss
git commit -m "feat(gemini): add reconnecting indicator to basic mode footer"
```

---

### Task 7: Write Unit Tests for Reconnection State Machine

**Files:**
- Create: `src/services/clients/GeminiClient.test.ts`

- [ ] **Step 1: Create the test file with mocks and test setup**

Create `src/services/clients/GeminiClient.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ClientEventHandlers, SessionConfig } from '../interfaces/IClient';

// Mock the @google/genai module
const mockSessionClose = vi.fn();
const mockSessionSendRealtimeInput = vi.fn();
const mockLiveConnect = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    live: {
      connect: mockLiveConnect,
    },
  })),
  Modality: { AUDIO: 'AUDIO' },
  ActivityHandling: { START_OF_ACTIVITY_INTERRUPTS: 'START_OF_ACTIVITY_INTERRUPTS' },
  StartSensitivity: { START_SENSITIVITY_HIGH: 'HIGH', START_SENSITIVITY_LOW: 'LOW' },
  EndSensitivity: { END_SENSITIVITY_HIGH: 'HIGH', END_SENSITIVITY_LOW: 'LOW' },
}));

// Import after mocking
const { GeminiClient } = await import('./GeminiClient');

// Helper to create a mock session and capture callbacks
function setupMockSession() {
  let capturedCallbacks: any = {};
  const mockSession = {
    close: mockSessionClose,
    sendRealtimeInput: mockSessionSendRealtimeInput,
  };

  mockLiveConnect.mockImplementation(async ({ callbacks }: any) => {
    capturedCallbacks = callbacks;
    // Simulate onopen
    callbacks.onopen?.();
    return mockSession;
  });

  return { mockSession, getCapturedCallbacks: () => capturedCallbacks };
}

function createTestConfig(): SessionConfig {
  return {
    model: 'gemini-2.0-flash-live-001',
    voice: 'Puck',
    instructions: 'Translate from English to Japanese',
    temperature: 0.7,
  };
}

describe('GeminiClient Reconnection', () => {
  let client: InstanceType<typeof GeminiClient>;
  let handlers: ClientEventHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    client = new GeminiClient('test-api-key');
    handlers = {
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
      onReconnecting: vi.fn(),
      onReconnected: vi.fn(),
      onConversationUpdated: vi.fn(),
      onRealtimeEvent: vi.fn(),
    };
    client.setEventHandlers(handlers);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Handle Storage', () => {
    it('should store resumption handle when resumable is true', async () => {
      const { getCapturedCallbacks } = setupMockSession();
      await client.connect(createTestConfig());
      const callbacks = getCapturedCallbacks();

      // Simulate sessionResumptionUpdate
      await callbacks.onmessage({
        sessionResumptionUpdate: {
          resumable: true,
          newHandle: 'test-handle-123',
        },
      });

      // Verify handle is stored by triggering a disconnect and checking reconnection
      // If handle is stored, onclose should trigger reconnect instead of onClose
      callbacks.onclose(new CloseEvent('close', { code: 1011 }));

      expect(handlers.onReconnecting).toHaveBeenCalled();
      expect(handlers.onClose).not.toHaveBeenCalled();
    });

    it('should NOT store handle when resumable is false', async () => {
      const { getCapturedCallbacks } = setupMockSession();
      await client.connect(createTestConfig());
      const callbacks = getCapturedCallbacks();

      // Simulate non-resumable update
      await callbacks.onmessage({
        sessionResumptionUpdate: {
          resumable: false,
          newHandle: 'should-not-store',
        },
      });

      // Trigger close — should go through normal disconnect since no handle stored
      callbacks.onclose(new CloseEvent('close', { code: 1011 }));

      expect(handlers.onReconnecting).not.toHaveBeenCalled();
      expect(handlers.onClose).toHaveBeenCalled();
    });
  });

  describe('GoAway Handling', () => {
    it('should trigger reconnection on goAway when handle exists', async () => {
      const { getCapturedCallbacks } = setupMockSession();
      await client.connect(createTestConfig());
      const callbacks = getCapturedCallbacks();

      // Store a handle first
      await callbacks.onmessage({
        sessionResumptionUpdate: { resumable: true, newHandle: 'handle-1' },
      });

      // Simulate goAway
      await callbacks.onmessage({
        goAway: { timeLeft: '60s' },
      });

      expect(handlers.onReconnecting).toHaveBeenCalled();
    });

    it('should NOT trigger reconnection on goAway without handle', async () => {
      const { getCapturedCallbacks } = setupMockSession();
      await client.connect(createTestConfig());
      const callbacks = getCapturedCallbacks();

      // goAway without prior handle storage
      await callbacks.onmessage({
        goAway: { timeLeft: '60s' },
      });

      expect(handlers.onReconnecting).not.toHaveBeenCalled();
    });
  });

  describe('Unexpected Close', () => {
    it('should attempt reconnection on unexpected close with handle', async () => {
      const { getCapturedCallbacks } = setupMockSession();
      await client.connect(createTestConfig());
      const callbacks = getCapturedCallbacks();

      // Store handle
      await callbacks.onmessage({
        sessionResumptionUpdate: { resumable: true, newHandle: 'handle-1' },
      });

      // Simulate unexpected close
      callbacks.onclose(new CloseEvent('close', { code: 1011, reason: 'Deadline expired' }));

      expect(handlers.onReconnecting).toHaveBeenCalled();
      expect(handlers.onClose).not.toHaveBeenCalled();
    });

    it('should fire onClose on unexpected close without handle', async () => {
      const { getCapturedCallbacks } = setupMockSession();
      await client.connect(createTestConfig());
      const callbacks = getCapturedCallbacks();

      // Close without storing any handle
      callbacks.onclose(new CloseEvent('close', { code: 1011 }));

      expect(handlers.onReconnecting).not.toHaveBeenCalled();
      expect(handlers.onClose).toHaveBeenCalled();
    });
  });

  describe('Reconnection Success', () => {
    it('should fire onReconnected after successful reconnection', async () => {
      const { getCapturedCallbacks } = setupMockSession();
      await client.connect(createTestConfig());
      const callbacks = getCapturedCallbacks();

      // Store handle
      await callbacks.onmessage({
        sessionResumptionUpdate: { resumable: true, newHandle: 'handle-1' },
      });

      // Trigger reconnect via unexpected close
      callbacks.onclose(new CloseEvent('close', { code: 1011 }));

      // Wait for reconnect to complete (connect() is async)
      await vi.runAllTimersAsync();

      expect(handlers.onReconnecting).toHaveBeenCalledTimes(1);
      expect(handlers.onReconnected).toHaveBeenCalledTimes(1);
      expect(handlers.onClose).not.toHaveBeenCalled();
    });
  });

  describe('Reconnection Failure', () => {
    it('should fire onClose after all retries fail', async () => {
      const { getCapturedCallbacks } = setupMockSession();
      await client.connect(createTestConfig());
      const callbacks = getCapturedCallbacks();

      // Store handle
      await callbacks.onmessage({
        sessionResumptionUpdate: { resumable: true, newHandle: 'handle-1' },
      });

      // Make connect fail on all retries
      mockLiveConnect.mockRejectedValue(new Error('Connection failed'));

      // Trigger reconnect
      callbacks.onclose(new CloseEvent('close', { code: 1011 }));

      // Wait for all retries with backoff
      await vi.runAllTimersAsync();

      expect(handlers.onReconnecting).toHaveBeenCalledTimes(1);
      expect(handlers.onReconnected).not.toHaveBeenCalled();
      expect(handlers.onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('User Disconnect During Reconnection', () => {
    it('should cancel reconnection when user calls disconnect()', async () => {
      const { getCapturedCallbacks } = setupMockSession();
      await client.connect(createTestConfig());
      const callbacks = getCapturedCallbacks();

      // Store handle
      await callbacks.onmessage({
        sessionResumptionUpdate: { resumable: true, newHandle: 'handle-1' },
      });

      // Make connect slow so we can cancel
      mockLiveConnect.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 5000)));

      // Trigger reconnect
      callbacks.onclose(new CloseEvent('close', { code: 1011 }));

      expect(handlers.onReconnecting).toHaveBeenCalled();

      // User disconnects during reconnection
      await client.disconnect();

      // Run timers to let any pending reconnect attempt complete
      await vi.runAllTimersAsync();

      // onReconnected should NOT have been called
      expect(handlers.onReconnected).not.toHaveBeenCalled();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('Re-entry Guard', () => {
    it('should prevent concurrent reconnection attempts', async () => {
      const { getCapturedCallbacks } = setupMockSession();
      await client.connect(createTestConfig());
      const callbacks = getCapturedCallbacks();

      // Store handle
      await callbacks.onmessage({
        sessionResumptionUpdate: { resumable: true, newHandle: 'handle-1' },
      });

      // Make connect slow
      mockLiveConnect.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 5000)));

      // Trigger reconnect via goAway
      await callbacks.onmessage({ goAway: { timeLeft: '60s' } });

      expect(handlers.onReconnecting).toHaveBeenCalledTimes(1);

      // Second close should be ignored (isReconnecting is true)
      callbacks.onclose(new CloseEvent('close', { code: 1011 }));

      // onReconnecting should still only have been called once
      expect(handlers.onReconnecting).toHaveBeenCalledTimes(1);
    });
  });

  describe('Conversation Items Preservation', () => {
    it('should preserve conversation items during reconnection', async () => {
      const { getCapturedCallbacks } = setupMockSession();
      await client.connect(createTestConfig());
      const callbacks = getCapturedCallbacks();

      // Simulate some conversation
      await callbacks.onmessage({
        serverContent: {
          inputTranscription: { text: 'Hello' },
        },
      });

      // Store handle
      await callbacks.onmessage({
        sessionResumptionUpdate: { resumable: true, newHandle: 'handle-1' },
      });

      const itemsBefore = client.getConversationItems();
      expect(itemsBefore.length).toBeGreaterThan(0);

      // Trigger reconnect
      callbacks.onclose(new CloseEvent('close', { code: 1011 }));
      await vi.runAllTimersAsync();

      // Items should still be there after reconnection
      const itemsAfter = client.getConversationItems();
      expect(itemsAfter.length).toBe(itemsBefore.length);
    });
  });

  describe('Explicit Disconnect', () => {
    it('should clear resumption handle on explicit disconnect', async () => {
      const { getCapturedCallbacks } = setupMockSession();
      await client.connect(createTestConfig());
      const callbacks = getCapturedCallbacks();

      // Store handle
      await callbacks.onmessage({
        sessionResumptionUpdate: { resumable: true, newHandle: 'handle-1' },
      });

      // Explicit disconnect
      await client.disconnect();

      // Re-setup mock for next connect
      setupMockSession();
      await client.connect(createTestConfig());
      const newCallbacks = getCapturedCallbacks();

      // Close again — should NOT reconnect since handle was cleared
      newCallbacks.onclose(new CloseEvent('close', { code: 1011 }));

      // Note: onReconnecting may be called from the first reconnect attempt
      // but the second close should trigger onClose since handle was cleared by disconnect
      expect(handlers.onClose).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run test -- src/services/clients/GeminiClient.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Fix any test failures**

If tests fail due to async timing or mock issues, adjust the test code. The key is that all state machine transitions are covered.

- [ ] **Step 4: Commit**

```bash
git add src/services/clients/GeminiClient.test.ts
git commit -m "test(gemini): add unit tests for auto-reconnect state machine"
```

---

### Task 8: Add i18n Translation Key

**Files:**
- Modify: Translation files for `connectionStatus.reconnecting`

- [ ] **Step 1: Find and update the English translation file**

Search for existing `connectionStatus` keys to find the correct translation file:

```bash
grep -r "connectionStatus.connecting" src/locales/ --include="*.json" -l
```

Add the `reconnecting` key alongside existing `connectionStatus` entries:

```json
"reconnecting": "Reconnecting..."
```

- [ ] **Step 2: Commit**

```bash
git add src/locales/
git commit -m "feat(i18n): add reconnecting translation key"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Run full type check**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 2: Run all tests**

Run: `npm run test`
Expected: All tests pass, including new GeminiClient reconnection tests.

- [ ] **Step 3: Run dev server and manually verify**

Run: `npm run dev`

Manual checklist:
1. Open the app, select Gemini provider
2. Connect to a session, say something
3. Check logs panel for `sessionResumptionUpdate` events (confirms handle is being stored)
4. Press `Ctrl+Shift+G` to simulate disconnect
5. Observe: "Reconnecting..." indicator appears briefly
6. Observe: Session reconnects, audio resumes
7. Say something again to confirm context preserved
8. Test explicit disconnect (click stop) — should NOT attempt reconnection
9. Test with OpenAI/Palabra provider — should behave exactly as before (no reconnection logic)

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(gemini): address issues found during manual testing"
```
