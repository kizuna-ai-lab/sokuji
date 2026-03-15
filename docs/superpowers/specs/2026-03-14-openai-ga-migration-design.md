# Design: Migrate OpenAI Realtime API from Beta to GA

**Issue**: [#115](https://github.com/kizuna-ai-lab/sokuji/issues/115)
**Date**: 2026-03-14
**Deadline**: 2026-05-07 (beta API shutdown)
**Status**: Design Complete

## Problem

The project uses `openai-realtime-api` v1.0.8 (third-party) which sends the beta header `OpenAI-Beta: realtime=v1` and uses beta event names (`response.text.delta`, `response.audio.delta`, etc.). OpenAI is shutting down the beta Realtime API protocol on May 7, 2026.

Two separate concerns:
- **Model migration**: Beta preview models (`gpt-4o-realtime-preview`) → GA models (`gpt-realtime-mini`, `gpt-realtime-1.5`). Already completed in commit 04c7161.
- **Protocol migration** (this spec): Beta protocol (beta header, beta event names) → GA protocol (no beta header, GA event names like `response.output_text.delta`).

## Decision: Split Client Strategy

**Migrate only the OpenAI direct provider** to the official `openai` SDK's `OpenAIRealtimeWebSocket`. Keep `openai-realtime-api` for OpenAI Compatible and Kizuna AI providers — third-party services and backend proxy may not support GA yet.

### Rationale

- OpenAI Compatible endpoints (CometAPI, etc.) may still use the beta protocol
- Kizuna AI routes through a backend proxy that currently uses beta — migration requires backend coordination
- The `openai-realtime-api` library will continue to work with beta-compatible services indefinitely
- Clean separation: GA client for OpenAI, beta client for everything else

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  ClientFactory                   │
├─────────────────────────────────────────────────┤
│ Provider.OPENAI (ws)       → OpenAIGAClient     │ ← NEW (official openai SDK)
│ Provider.OPENAI (webrtc)   → OpenAIWebRTCClient │   (event names updated)
│ Provider.OPENAI_COMPATIBLE → OpenAIClient       │   (beta, unchanged)
│ Provider.KIZUNA_AI         → OpenAIClient       │   (beta, unchanged)
└─────────────────────────────────────────────────┘

OpenAIGAClient data flow:
  OpenAIRealtimeWebSocket (official SDK)
    ↓ GA events (response.output_text.delta, etc.)
  OpenAIGAClient (manual conversation tracking)
    ↓ maps to ConversationItem + delta
  IClient interface (unchanged)
    ↓
  MainPanel (unchanged)
```

## Pre-existing Bug Fix

`src/services/clients/OpenAIClient.ts:8` and `src/services/interfaces/IClient.ts:6` import `RealtimeEvent` from `../../contexts/LogContext` which does not exist. Should be `../../stores/logStore`. Fix as part of this migration.

---

## Implementation Steps

### Step 1: Add `openai` SDK dependency

- `package.json`: Add `"openai": "^6.27.0"` to dependencies
- `extension/package.json`: Add `"openai": "^6.27.0"` to dependencies
- Keep `openai-realtime-api` in both (still needed for Compatible/KizunaAI)
- Run `npm install`

### Step 2: Fix stale `LogContext` imports

| File | Change |
|------|--------|
| `src/services/clients/OpenAIClient.ts:8` | `../../contexts/LogContext` → `../../stores/logStore` |
| `src/services/interfaces/IClient.ts:6` | `../../contexts/LogContext` → `../../stores/logStore` |

### Step 3: Decouple `logStore.ts` from `openai-realtime-api` types

**File**: `src/stores/logStore.ts`

Remove type imports:
```typescript
// REMOVE:
import type { RealtimeServerEvents, RealtimeClientEvents, RealtimeCustomEvents } from 'openai-realtime-api';
```

Replace `RealtimeServerEvents.EventType | RealtimeClientEvents.EventType | RealtimeCustomEvents.EventType` with explicit string literals covering both beta and GA event names:

```typescript
// OpenAI server events (shared between beta and GA)
| 'session.created' | 'session.updated'
| 'conversation.created'
| 'conversation.item.created' | 'conversation.item.deleted' | 'conversation.item.truncated'
| 'conversation.item.input_audio_transcription.completed'
| 'conversation.item.input_audio_transcription.failed'
| 'input_audio_buffer.committed' | 'input_audio_buffer.cleared'
| 'input_audio_buffer.speech_started' | 'input_audio_buffer.speech_stopped'
| 'response.created' | 'response.done'
| 'response.output_item.added' | 'response.output_item.done'
| 'response.function_call_arguments.delta' | 'response.function_call_arguments.done'
| 'rate_limits.updated'
| 'error'
// Beta-only event names (OpenAI Compatible, Kizuna AI)
| 'response.text.delta' | 'response.text.done'
| 'response.audio.delta' | 'response.audio.done'
| 'response.audio_transcript.delta' | 'response.audio_transcript.done'
// GA-only event names (OpenAI direct)
| 'response.output_text.delta' | 'response.output_text.done'
| 'response.output_audio.delta' | 'response.output_audio.done'
| 'response.output_audio_transcript.delta' | 'response.output_audio_transcript.done'
| 'conversation.item.added' | 'conversation.item.done'
| 'response.content_part.added' | 'response.content_part.done'
// OpenAI client events
| 'session.update'
| 'input_audio_buffer.append' | 'input_audio_buffer.commit' | 'input_audio_buffer.clear'
| 'conversation.item.create' | 'conversation.item.truncate' | 'conversation.item.delete'
| 'response.create' | 'response.cancel'
// openai-realtime-api custom events (for beta clients)
| 'conversation.item.appended' | 'conversation.item.completed'
| 'conversation.updated' | 'conversation.interrupted'
| 'realtime.event'
```

Also add `'response.output_text.annotation.added'` to the GA event type list.

**`getEventGroup()` update**: The existing grouping logic uses `eventType.includes('delta')` which already catches GA delta events generically. The `input_audio_buffer.append` special case and item-ID-based grouping should work unchanged. Verify during implementation that GA audio delta events (`response.output_audio.delta`) are grouped correctly — if the logic checks for `response.audio.delta` specifically, add the GA variant.

### Step 4: Create `OpenAIGAClient.ts`

**File**: `src/services/clients/OpenAIGAClient.ts` (~500 lines)

New client implementing `IClient` using `OpenAIRealtimeWebSocket` from the official `openai` SDK.

**Reference implementation**: `OpenAIWebRTCClient.ts` — already does manual conversation tracking and event handling without `openai-realtime-api`.

#### a) Connection lifecycle
- Constructor takes `apiKey` only (no custom host — GA client is OpenAI-only)
- `connect(config)`: Create `OpenAIRealtimeWebSocket({model, apiKey, dangerouslyAllowAPIKeyInBrowser})`, register event handlers, wait for `session.created` with 30s timeout, send `session.update`
- `disconnect()`: Call `rt.close()`, emit `session.closed`

#### b) Manual conversation item tracking (no library helper)
- Internal `conversationItems: ConversationItem[]` array
- `itemLookup: Map<string, ConversationItem>` for fast access
- Create items on `conversation.item.created`
- Update text/transcript/audio on delta events
- Mark completed on `response.done`

#### c) GA event → internal event mapping

| GA Event | Internal Handler |
|----------|-----------------|
| `response.output_text.delta` | Update item.formatted.text, emit onConversationUpdated with text delta |
| `response.output_audio.delta` | Decode base64 → Int16Array, emit onConversationUpdated with audio delta + sequenceNumber |
| `response.output_audio_transcript.delta` | Update item.formatted.transcript, emit onConversationUpdated |
| `conversation.item.created` | Create new ConversationItem, add to tracking. Note: GA also emits `conversation.item.added` — handle both defensively (fallthrough), prefer `conversation.item.created` as primary trigger since it contains the full item payload. |
| `conversation.item.input_audio_transcription.completed` | Update user item transcript |
| `input_audio_buffer.speech_started` | Emit onConversationInterrupted |
| `response.done` | Mark items completed |
| `error` | Create error ConversationItem, emit |

#### d) Audio I/O
- `appendInputAudio(Int16Array)`: Convert to base64 → `rt.send({type: 'input_audio_buffer.append', audio})`
- Audio output: Receive base64 in `response.output_audio.delta` → decode to Int16Array → emit as delta
- Utility methods: `int16ArrayToBase64()`, `base64ToInt16Array()`

#### e) Text input
- `appendInputText(text)`: Send `conversation.item.create` with `{type: 'message', role: 'user', content: [{type: 'input_text', text}]}` via `rt.send()`. Does NOT auto-trigger response — caller handles that separately (same as WebRTC client pattern).

#### f) Session/response management
- `updateSession(config)`: Same field mapping logic as current `OpenAIClient.ts` but sends via `rt.send({type: 'session.update', session: {...}})`
- `createResponse(config?)`: Send `input_audio_buffer.commit` + `response.create` via `rt.send()`
- `cancelResponse()`: Send `response.cancel` via `rt.send()`

#### g) Connection state
- `isConnected()`: Track via internal `connected: boolean` flag, set `true` after `session.created`, set `false` on close/error. Same pattern as `OpenAIWebRTCClient`.

#### h) Reset
- `reset()`: Clear `conversationItems`, `itemLookup`, `itemCreatedAtMap`, `currentResponseItemId`, reset `deltaSequenceNumber` to 0. Return `[...this.conversationItems]` (defensive shallow copy) from `getConversationItems()`.

#### i) Event forwarding for logging
- No generic `realtime.event` in official SDK — must register individual handlers for each event type
- Each handler calls `forwardEvent(source, event)` to emit `onRealtimeEvent`

#### j) Static methods — Reuse from existing `OpenAIClient.ts`
- `validateApiKeyAndFetchModels()` — REST-based, not WebSocket, so unchanged
- `filterRelevantModels()`, `checkRealtimeModelAvailability()`, etc.

### Step 5: Update `OpenAIWebRTCClient.ts` event names

**File**: `src/services/clients/OpenAIWebRTCClient.ts`

The WebRTC client connects directly to OpenAI's API (not through `openai-realtime-api`) and currently uses beta event names in its `handleServerEvent` switch statement (lines 337-345):

```typescript
// Current (beta):
case 'response.audio_transcript.delta':
case 'response.text.delta':
// ...
case 'response.audio_transcript.done':
case 'response.text.done':
```

**Change**: Handle both beta AND GA event names defensively. This ensures the WebRTC client works regardless of when OpenAI switches the WebRTC endpoint to GA events:

```typescript
// Updated (both beta and GA):
case 'response.audio_transcript.delta':
case 'response.output_audio_transcript.delta':  // GA
case 'response.text.delta':
case 'response.output_text.delta':              // GA
// ...
case 'response.audio_transcript.done':
case 'response.output_audio_transcript.done':    // GA
case 'response.text.done':
case 'response.output_text.done':                // GA
```

This is a minimal, safe change — adding fallthrough cases costs nothing and prevents silent event drops.

### Step 6: Update `ClientFactory.ts`

**File**: `src/services/clients/ClientFactory.ts`

```typescript
import { OpenAIGAClient } from './OpenAIGAClient';

// Route Provider.OPENAI WebSocket → OpenAIGAClient (GA)
// Keep Provider.OPENAI_COMPATIBLE → OpenAIClient (beta)
// Keep Provider.KIZUNA_AI → OpenAIClient (beta)
```

| Provider | Transport | Client |
|----------|-----------|--------|
| OPENAI | websocket | **OpenAIGAClient** (new) |
| OPENAI | webrtc | OpenAIWebRTCClient (event names updated) |
| OPENAI_COMPATIBLE | websocket | OpenAIClient (beta, unchanged) |
| OPENAI_COMPATIBLE | webrtc | OpenAIWebRTCClient (event names updated) |
| KIZUNA_AI | any | OpenAIClient (beta, unchanged) |

### Step 7: EphemeralTokenService (deferred)

`EphemeralTokenService.ts` is only used by `OpenAIWebRTCClient`. WebRTC is not affected by this migration. If the GA API requires `"type": "realtime"` in the session creation body, that can be done separately.

### Step 8: Eval runner (deferred)

`evals/runner/clients/NodeOpenAIClient.ts` — Keep on `openai-realtime-api` for now. Add TODO comment noting future migration need before May 7, 2026.

---

## Files Modified

| File | Action |
|------|--------|
| `package.json` | Add `openai` dependency |
| `extension/package.json` | Add `openai` dependency |
| `src/services/clients/OpenAIGAClient.ts` | **CREATE** — New GA client |
| `src/services/clients/OpenAIWebRTCClient.ts` | Add GA event name fallthrough cases in handleServerEvent |
| `src/services/clients/ClientFactory.ts` | Route OPENAI → OpenAIGAClient |
| `src/services/clients/OpenAIClient.ts` | Fix stale LogContext import |
| `src/services/interfaces/IClient.ts` | Fix stale LogContext import |
| `src/stores/logStore.ts` | Remove `openai-realtime-api` type imports, add explicit event type strings |
| `evals/runner/clients/NodeOpenAIClient.ts` | Add TODO comment |

## Key Reference Files (read-only)

| File | Purpose |
|------|---------|
| `src/services/clients/OpenAIWebRTCClient.ts` | Reference for manual conversation tracking, event handling, session update patterns |
| `src/services/clients/OpenAIClient.ts` | Reference for session config mapping, static validation methods, translation text unwrapping |
| `src/components/MainPanel/MainPanel.tsx` | Understanding how events are consumed by UI |

---

## Verification Plan

### Phase 1: Static Checks (Automated)

- [ ] `npm run build` — TypeScript compilation succeeds, no type errors
- [ ] `npm run test` — All existing unit tests pass
- [ ] Verify no remaining imports from `openai-realtime-api` in GA client code
- [ ] Verify `openai-realtime-api` imports only exist in: `OpenAIClient.ts` (beta), `NodeOpenAIClient.ts` (eval)

### Phase 2: OpenAI GA Provider — End-to-End (Real API Key Required)

**Prerequisites**: OpenAI API key with Realtime API access, microphone + speaker

#### 2a. Connection & Session
- [ ] Select OpenAI provider, choose `gpt-realtime-mini` model
- [ ] Click connect → verify session creation succeeds (no timeout)
- [ ] Check Logs panel → confirm `session.created` and `session.updated` events appear
- [ ] Verify GA event names in logs (e.g., `response.output_text.delta` NOT `response.text.delta`)
- [ ] Disconnect → verify clean disconnection, `session.closed` event logged

#### 2b. Voice Translation (Core Flow)
- [ ] Connect with server VAD → speak → verify:
  - Speech detection triggers (`input_audio_buffer.speech_started` in logs)
  - Translation text appears in conversation bubbles
  - Audio playback works (assistant speaks back)
  - Audio ordering is correct (no garbled/out-of-order audio)
- [ ] Test with semantic VAD → verify similar behavior with different eagerness
- [ ] Test interruption: speak while assistant is responding → verify response is cut off

#### 2c. Text Input
- [ ] Switch to text-only mode or type text input
- [ ] Verify text message appears in conversation
- [ ] Verify translation response received

#### 2d. PTT (Push-to-Talk) Mode
- [ ] Set turn detection to "none" (manual/PTT)
- [ ] Hold PTT → speak → release → verify `input_audio_buffer.commit` sent
- [ ] Verify response generated after commit

#### 2e. Error Handling
- [ ] Connect with invalid API key → verify meaningful error displayed
- [ ] Test network interruption (disconnect WiFi briefly) → verify error state
- [ ] Verify error items appear in conversation with error styling

#### 2f. Input Transcription
- [ ] Enable input audio transcription in settings
- [ ] Speak → verify user's speech transcript appears in conversation

### Phase 3: OpenAI Compatible Provider — Beta Regression (Real Compatible Endpoint Required)

**Prerequisites**: Access to a compatible API service (CometAPI, etc.)

- [ ] Select OpenAI Compatible provider, enter endpoint URL + API key
- [ ] Connect → verify session creation succeeds via beta protocol
- [ ] Check Logs panel → confirm beta event names (`response.text.delta`, `response.audio.delta`)
- [ ] Speak → verify translation works (audio + text)
- [ ] Verify no GA event names appear (confirms beta protocol active)

### Phase 4: Kizuna AI Provider — External Dependency

**Status**: Depends on backend team — mark as **BLOCKED** until backend confirms beta protocol compatibility.

- [ ] 🔒 Verify Kizuna AI provider still connects through backend proxy
- [ ] 🔒 Verify authentication flow works (Better Auth → API key fetch → connect)
- [ ] 🔒 Verify translation output received

> **Note**: If backend team migrates to GA protocol, Kizuna AI routing in `ClientFactory.ts` should be updated to use `OpenAIGAClient` in a follow-up PR.

### Phase 5: WebRTC Transport — Smoke Test

**Prerequisites**: OpenAI API key

- [ ] Select OpenAI provider, switch transport to WebRTC
- [ ] Connect → verify WebRTC connection establishes (ICE + DataChannel)
- [ ] Speak → verify audio flows via MediaStreamTrack (not appendInputAudio)
- [ ] Verify translation output received
- [ ] Disconnect → verify clean cleanup

### Phase 6: Cross-Cutting Concerns

- [ ] **Logs Panel**: Events from all providers display correctly, no crashes
- [ ] **Event grouping**: GA event names grouped properly (audio deltas grouped, etc.)
- [ ] **Conversation state**: `getConversationItems()` returns correct items after multiple exchanges
- [ ] **Multiple sessions**: Connect → translate → disconnect → reconnect → translate again → verify state resets properly
- [ ] **Browser extension**: Build extension (`npm run build`), load in Chrome, verify OpenAI provider works in side panel

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `OpenAIRealtimeWebSocket` browser incompatibility | Medium | High | Fall back to raw WebSocket with manual GA protocol (similar to WebRTC client approach) |
| No generic event listener in official SDK | High | Low | Register individual handlers for each event type |
| Audio base64 encode/decode performance | Low | Medium | Profile in browser; consider Web Workers if needed |
| `cancelResponse` lacks sample count support in GA | Medium | Low | Send basic `response.cancel`; precise truncation is nice-to-have |
| Kizuna AI backend not compatible after migration | Low | Medium | Keep beta client; coordinate with backend team separately |
| WebRTC endpoint switches to GA event names | High | High | Add both beta + GA event name fallthrough in WebRTC client (Step 5) |
| `dangerouslyAllowAPIKeyInBrowser` security concern | Low | Low | Consistent with current beta client; ephemeral tokens for WebSocket is a future improvement |
