# Gemini Auto-Reconnect with Session Resumption

**Issue:** [#179](https://github.com/kizuna-ai-lab/sokuji/issues/179)
**Date:** 2026-04-06

## Problem

Gemini Live API sessions disconnect after ~7-15 minutes due to server-side session duration limits and ~10-minute WebSocket connection hard cutoffs. Users must manually press the connect button to restart, losing all conversation context.

Log evidence:
```json
{"type":"goAway","data":{"timeLeft":"50s"}}
{"type":"session.closed","data":{"code":1011,"reason":"Deadline expired before operation could complete."}}
```

## Solution Overview

Implement transparent auto-reconnection using Google's Session Resumption API and Context Window Compression, all encapsulated within `GeminiClient`. The user sees a brief "Reconnecting..." indicator and audio resumes automatically.

**Approach:** Client-Internal Reconnection (follows Google ADK reference architecture).

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Branch strategy | Single feature branch | All 3 phases are tightly coupled |
| UI during reconnection | Subtle "Reconnecting..." indicator | Manages user expectations for the 1-2s audio gap |
| Reconnect without handle | No — treat as normal disconnect | Reconnecting without context is worse than showing disconnect |
| Audio during reconnection gap | Drop silently | 1-2s loss is negligible for real-time translation; avoids complexity |
| Architecture | All logic inside GeminiClient | Encapsulated, minimal cross-layer coordination |

## Research Findings

### Session Resumption API

- `SessionResumptionConfig.handle`: Pass `undefined` for new sessions, latest `newHandle` for resumption. Never pass empty string.
- `SessionResumptionConfig.transparent`: Enables `lastConsumedClientMessageIndex` for zero-loss reconnection — **Vertex AI only**, not supported on Gemini API (AI Studio). Do not use.
- Handles are NOT available immediately — server generates them after model completes first response turn.
- `resumable` can be `false` during function calls or active generation. Only store handles when `resumable === true`.
- Handles are valid for **2 hours** after last session termination.
- A handle is only valid for a single reconnection; new session issues fresh handles.

### Context Window Compression

- `contextWindowCompression: { slidingWindow: {} }` enables server-managed compression with defaults.
- Without compression: audio-only sessions max ~15 minutes (128K token window at ~25 tokens/sec).
- With compression: sessions can run indefinitely (oldest turns discarded).
- Compression manages token limits but does NOT prevent the ~10-minute WebSocket connection cutoff. Session resumption is needed for that.

### GoAway Message

- Server sends `GoAway` with `timeLeft` (typically ~60 seconds before ABORTED).
- Community reports: some connections close after 2-3 minutes of inactivity without GoAway notice.
- Both `goAway` and unexpected `onclose` must trigger reconnection.

### Known Gotchas

- Long system instructions (>200 tokens) may break resumption on some models.
- Sending `sendRealtimeInput` during pending tool calls causes 1008 errors (not relevant for Sokuji currently — no tool use).
- Preview models have varying session resumption support; `gemini-live-2.5-flash-preview-native-audio-*` models have best support.

### SDK Types (Confirmed in installed `@google/genai`)

```typescript
interface SessionResumptionConfig {
  handle?: string;
  transparent?: boolean;
}

interface ContextWindowCompressionConfig {
  triggerTokens?: string;
  slidingWindow?: SlidingWindow;
}

interface SlidingWindow {
  targetTokens?: string;
}

interface LiveServerGoAway {
  timeLeft?: string;
}

interface LiveServerSessionResumptionUpdate {
  newHandle?: string;
  resumable?: boolean;
  lastConsumedClientMessageIndex?: string;
}
```

All types already available in `LiveConnectConfig` and `LiveServerMessage` — no SDK upgrade needed.

## Detailed Design

### 1. GeminiClient Core Changes

**File:** `src/services/clients/GeminiClient.ts`

#### New State Properties

```typescript
private savedResumptionHandle: string | undefined = undefined;
private isReconnecting = false;
private lastConfig: SessionConfig | null = null;
```

#### Connection Config Changes (in `connect()`)

Store `lastConfig` at the start of `connect()`. Add to `liveConfig`:

```typescript
const liveConfig: LiveConnectConfig = {
  // ...existing config...
  sessionResumption: {
    handle: this.savedResumptionHandle ?? undefined,
  },
  contextWindowCompression: {
    slidingWindow: {},
  },
};
```

#### Handle Storage (in `handleMessage()`)

Enhance the existing `sessionResumptionUpdate` handler:

```typescript
if (message.sessionResumptionUpdate) {
  if (message.sessionResumptionUpdate.resumable && message.sessionResumptionUpdate.newHandle) {
    this.savedResumptionHandle = message.sessionResumptionUpdate.newHandle;
  }
  this.eventHandlers.onRealtimeEvent?.({ ... });
}
```

#### GoAway Handler (in `handleMessage()`)

Enhance the existing `goAway` handler to trigger proactive reconnection:

```typescript
if (message.goAway) {
  this.eventHandlers.onRealtimeEvent?.({ ... });
  if (this.savedResumptionHandle && this.lastConfig) {
    this.reconnect();
  }
}
```

#### Reconnection Logic (new private method)

```typescript
private async reconnect(): Promise<void> {
  if (this.isReconnecting || !this.savedResumptionHandle || !this.lastConfig) return;

  this.isReconnecting = true;
  this.eventHandlers.onReconnecting?.();

  // Close old session without triggering onClose cleanup
  if (this.session) {
    this.session.close();
    this.session = null;
  }

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (!this.isReconnecting) break;  // User cancelled via disconnect()
    try {
      if (attempt > 1) {
        await this.delay(1000 * attempt);
      }
      await this.connect(this.lastConfig);
      this.isReconnecting = false;
      this.eventHandlers.onReconnected?.();
      return;
    } catch (error) {
      console.warn(`[GeminiClient] Reconnection attempt ${attempt}/${maxRetries} failed`, error);
    }
  }

  // All retries failed
  this.isReconnecting = false;
  this.savedResumptionHandle = undefined;
  this.isConnectedState = false;
  this.eventHandlers.onClose?.({} as CloseEvent);
}

private delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

#### onclose Handler Changes

Distinguish reconnection-eligible closes from final closes:

```typescript
onclose: (event: CloseEvent) => {
  this.session = null;

  if (this.isReconnecting) return;  // reconnect() handles it

  // Unexpected close — attempt reconnection if we have a handle
  if (this.savedResumptionHandle && this.lastConfig) {
    this.reconnect();
    return;
  }

  // No handle — real disconnect (existing cleanup)
  this.isConnectedState = false;
  this.conversationItems = [];
  this.eventHandlers.onRealtimeEvent?.({ ... });
  this.eventHandlers.onClose?.(event);
}
```

Key: Do NOT clear `conversationItems` during reconnection — context is preserved server-side.

#### disconnect() Changes

Clear handle and cancel reconnection on explicit user disconnect:

```typescript
async disconnect(): Promise<void> {
  this.isReconnecting = false;
  this.savedResumptionHandle = undefined;
  // ...existing logic...
}
```

### 2. Interface Changes

**File:** `src/services/interfaces/IClient.ts`

Add optional callbacks to `ClientEventHandlers`:

```typescript
export interface ClientEventHandlers {
  // ...existing callbacks...
  onReconnecting?: () => void;
  onReconnected?: () => void;
}
```

Optional — other providers are unaffected.

### 3. Store Changes

**File:** `src/stores/sessionStore.ts`

Add `isReconnecting` boolean:

```typescript
interface SessionStore {
  // ...existing...
  isReconnecting: boolean;
  setIsReconnecting: (reconnecting: boolean) => void;
}
```

Initial value `false`. Export `useIsReconnecting()` selector and `useSetIsReconnecting()` action hook.

### 4. MainPanel Changes

**File:** `src/components/MainPanel/MainPanel.tsx`

Wire up new callbacks in the event handlers:

```typescript
onReconnecting: () => {
  setIsReconnecting(true);
  // Do NOT set isSessionActive to false
  // Do NOT clean up audio, participant clients, etc.
},
onReconnected: () => {
  setIsReconnecting(false);
},
onClose: async (event: any) => {
  setIsReconnecting(false);
  // ...existing cleanup logic unchanged...
}
```

### 5. UI Indicator

**File:** `ConnectionStatus` component (or equivalent)

Consume `isReconnecting` from sessionStore. When true, display a transient "Reconnecting..." label in place of the normal connection status. When false, resume normal display. No button changes, no disconnect animation.

## Edge Cases

| Scenario | Behavior |
|---|---|
| GoAway before any handle | No reconnection; normal disconnect flow |
| GoAway during active generation | Use previously stored handle (last resumable checkpoint) |
| Rapid successive disconnects | `isReconnecting` guard prevents re-entry |
| User clicks disconnect during reconnection | `disconnect()` sets `isReconnecting = false`, retry loop bails out |
| All retry attempts fail | `onClose` fires, normal disconnect UI |
| Audio devices changed during reconnection | No special handling; MainPanel audio pipeline is independent |
| Other providers (OpenAI, Palabra, etc.) | Unaffected; callbacks are optional, `isReconnecting` stays `false` |

## Files to Modify

1. `src/services/clients/GeminiClient.ts` — Core reconnection logic, handle storage, config changes
2. `src/services/interfaces/IClient.ts` — Add `onReconnecting`/`onReconnected` callbacks
3. `src/stores/sessionStore.ts` — Add `isReconnecting` state
4. `src/components/MainPanel/MainPanel.tsx` — Wire up new callbacks
5. `src/components/ConnectionStatus/` (or equivalent) — Subtle reconnection indicator

## Acceptance Criteria

- [ ] Gemini sessions auto-reconnect on `goAway` message
- [ ] Gemini sessions auto-reconnect on unexpected WebSocket close (with retry + backoff)
- [ ] Session resumption enabled — context preserved across reconnections
- [ ] Context window compression enabled — sessions can run indefinitely
- [ ] Reconnection transparent to user (no manual button press)
- [ ] Audio streaming resumes automatically after reconnection
- [ ] If all reconnection attempts fail, gracefully disconnect
- [ ] Brief "Reconnecting..." indicator shown during reconnection
- [ ] No impact on other providers
- [ ] Explicit user disconnect clears handle and cancels reconnection
