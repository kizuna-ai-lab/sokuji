# OpenAI Realtime API GA Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the OpenAI direct provider from the deprecated beta Realtime API protocol to the GA protocol using the official `openai` SDK, while keeping `openai-realtime-api` for OpenAI Compatible and Kizuna AI providers.

**Architecture:** New `OpenAIGAClient` using `OpenAIRealtimeWebSocket` from official `openai` SDK for `Provider.OPENAI` WebSocket transport. Existing `OpenAIClient` stays for beta-protocol providers. `OpenAIWebRTCClient` gets defensive dual event name handling.

**Tech Stack:** `openai` SDK v6.27.0+, TypeScript, WebSocket, Zustand

**Spec:** `docs/superpowers/specs/2026-03-14-openai-ga-migration-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `package.json` | Root dependencies | Modify: add `openai` |
| `extension/package.json` | Extension dependencies | Modify: add `openai` |
| `src/services/interfaces/IClient.ts` | Client interface contract | Modify: fix import |
| `src/services/clients/OpenAIClient.ts` | Beta WebSocket client (Compatible/KizunaAI) | Modify: fix import |
| `src/services/clients/OpenAIGAClient.ts` | GA WebSocket client (OpenAI direct) | **Create** |
| `src/services/clients/OpenAIWebRTCClient.ts` | WebRTC client | Modify: add GA event names |
| `src/services/clients/ClientFactory.ts` | Client routing | Modify: route to GA client |
| `src/stores/logStore.ts` | Event type definitions | Modify: decouple from library |
| `evals/runner/clients/NodeOpenAIClient.ts` | Eval runner client | Modify: add TODO |

---

## Chunk 1: Dependencies and Import Fixes

### Task 1: Add `openai` SDK dependency

**Files:**
- Modify: `package.json`
- Modify: `extension/package.json`

- [ ] **Step 1: Add openai to root package.json**

In `package.json`, add to `"dependencies"`:
```json
"openai": "^6.27.0"
```

- [ ] **Step 2: Add openai to extension package.json**

In `extension/package.json`, add to `"dependencies"`:
```json
"openai": "^6.27.0"
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: Clean install, no errors. Both `openai` and `openai-realtime-api` coexist.

- [ ] **Step 4: Verify SDK exports**

Run: `node -e "const { OpenAIRealtimeWebSocket } = require('openai/beta/realtime/websocket'); console.log(typeof OpenAIRealtimeWebSocket)"`

If that path fails, try: `node -e "const openai = require('openai'); console.log(Object.keys(openai))"`

Document the correct import path. The issue mentions `openai/realtime/websocket` but the actual path may differ in v6.27.0+. Check `node_modules/openai/` for the exact export structure.

- [ ] **Step 5: Commit**

```bash
git add package.json extension/package.json package-lock.json
git commit -m "chore: add official openai SDK dependency for GA Realtime API migration"
```

---

### Task 2: Fix stale LogContext imports

**Files:**
- Modify: `src/services/interfaces/IClient.ts:6`
- Modify: `src/services/clients/OpenAIClient.ts:8`

- [ ] **Step 1: Fix IClient.ts import**

In `src/services/interfaces/IClient.ts`, line 6, change:
```typescript
// FROM:
import { RealtimeEvent } from '../../contexts/LogContext';
// TO:
import { RealtimeEvent } from '../../stores/logStore';
```

- [ ] **Step 2: Fix OpenAIClient.ts import**

In `src/services/clients/OpenAIClient.ts`, line 8, change:
```typescript
// FROM:
import { RealtimeEvent } from '../../contexts/LogContext';
// TO:
import { RealtimeEvent } from '../../stores/logStore';
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/interfaces/IClient.ts src/services/clients/OpenAIClient.ts
git commit -m "fix: correct stale LogContext imports to use logStore"
```

---

### Task 3: Decouple logStore.ts from openai-realtime-api types

**Files:**
- Modify: `src/stores/logStore.ts`

- [ ] **Step 1: Remove the openai-realtime-api type imports**

In `src/stores/logStore.ts`, remove lines 5-9:
```typescript
import type {
  RealtimeServerEvents,
  RealtimeClientEvents,
  RealtimeCustomEvents
} from 'openai-realtime-api';
```

- [ ] **Step 2: Replace type references in EventData**

In `src/stores/logStore.ts`, replace the three type references (lines 36-38):
```typescript
// FROM:
    | RealtimeServerEvents.EventType
    | RealtimeClientEvents.EventType
    | RealtimeCustomEvents.EventType
```

With explicit string literals:
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
    | 'response.output_text.annotation.added'
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

- [ ] **Step 3: Verify grouping logic handles GA events**

Check the grouping logic around line 242 in `logStore.ts`. The existing code uses `eventType.includes('delta')` which catches GA delta events like `response.output_audio.delta`. Also verify `eventType === 'input_audio_buffer.append'` has no issue. No changes needed — just verify.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: No TypeScript errors. The `EventData.type` union now covers all event names inline.

- [ ] **Step 5: Run tests**

Run: `npm run test`
Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/stores/logStore.ts
git commit -m "refactor: decouple logStore event types from openai-realtime-api package"
```

---

## Chunk 2: Create OpenAIGAClient

### Task 4: Create OpenAIGAClient.ts — Connection & Session Management

**Files:**
- Create: `src/services/clients/OpenAIGAClient.ts`

**Reference:** `src/services/clients/OpenAIWebRTCClient.ts` for conversation tracking patterns, `src/services/clients/OpenAIClient.ts` for session config mapping and static methods.

- [ ] **Step 1: Create the file with imports and class skeleton**

Create `src/services/clients/OpenAIGAClient.ts`:

```typescript
/**
 * OpenAIGAClient
 *
 * OpenAI Realtime API client using the official openai SDK's GA protocol.
 * Uses OpenAIRealtimeWebSocket for WebSocket transport to api.openai.com.
 *
 * This client is used ONLY for Provider.OPENAI with WebSocket transport.
 * OpenAI Compatible and Kizuna AI providers use OpenAIClient (beta protocol).
 *
 * Key differences from OpenAIClient (beta):
 * - Uses official openai SDK instead of third-party openai-realtime-api
 * - GA event names (response.output_text.delta vs response.text.delta)
 * - Manual conversation item tracking (no library helper)
 * - Manual base64 audio encoding/decoding
 */

// NOTE: The exact import path may vary by openai SDK version.
// Check node_modules/openai/ for the correct export.
// Possible paths: 'openai/beta/realtime/websocket', 'openai/realtime/websocket'
import { OpenAIRealtimeWebSocket } from 'openai/beta/realtime/websocket';
import {
  IClient,
  ConversationItem,
  SessionConfig,
  ClientEventHandlers,
  ApiKeyValidationResult,
  FilteredModel,
  ResponseConfig,
  isOpenAISessionConfig,
  OpenAISessionConfig
} from '../interfaces/IClient';
import { RealtimeEvent } from '../../stores/logStore';
import { Provider, ProviderType } from '../../types/Provider';
import { unwrapTranslationText } from '../../utils/textUtils';
import i18n from '../../locales';

/**
 * OpenAI Realtime API client using official SDK (GA protocol)
 */
export class OpenAIGAClient implements IClient {
  private static readonly DEFAULT_API_HOST = 'https://api.openai.com';

  private rt: OpenAIRealtimeWebSocket | null = null;
  private eventHandlers: ClientEventHandlers = {};
  private apiKey: string;
  private connected: boolean = false;
  private deltaSequenceNumber: number = 0;
  private turnDetectionDisabled: boolean = false;

  // Conversation tracking (manual, no library helper)
  private conversationItems: ConversationItem[] = [];
  private itemLookup: Map<string, ConversationItem> = new Map();
  private itemCreatedAtMap: Map<string, number> = new Map();
  private currentResponseItemId: string | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // --- Connection lifecycle ---

  async connect(config: SessionConfig): Promise<void> {
    // Reset state for new session
    this.deltaSequenceNumber = 0;
    this.conversationItems = [];
    this.itemLookup.clear();
    this.itemCreatedAtMap.clear();
    this.currentResponseItemId = null;
    this.connected = false;

    // Create OpenAIRealtimeWebSocket instance
    // The SDK connects automatically on construction
    this.rt = new OpenAIRealtimeWebSocket({
      model: config.model,
      apiKey: this.apiKey,
      dangerouslyAllowAPIKeyInBrowser: true,
    });

    // Set up event handlers before waiting for session
    this.setupEventListeners();

    // Wait for session.created with timeout
    await this.waitForSessionCreated();

    // Send session configuration
    if (isOpenAISessionConfig(config)) {
      this.sendSessionUpdate(config);
    }

    this.connected = true;

    // Emit connection events
    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'session.opened',
        data: {
          status: 'connected',
          provider: 'openai',
          model: config.model,
          timestamp: Date.now(),
          voice: config.voice,
          temperature: config.temperature,
        }
      }
    });

    this.eventHandlers.onOpen?.();
  }

  async disconnect(): Promise<void> {
    if (this.rt) {
      this.rt.close();
      this.rt = null;
    }
    this.connected = false;

    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'session.closed',
        data: {
          status: 'disconnected',
          provider: 'openai',
          timestamp: Date.now(),
          reason: 'client_disconnect'
        }
      }
    });
    this.eventHandlers.onClose?.({});
  }

  isConnected(): boolean {
    return this.connected;
  }

  reset(): void {
    this.conversationItems = [];
    this.itemLookup.clear();
    this.itemCreatedAtMap.clear();
    this.currentResponseItemId = null;
  }

  // --- Session management ---

  private waitForSessionCreated(): Promise<void> {
    const SESSION_TIMEOUT = 30000;

    return new Promise<void>((resolve, reject) => {
      let isSettled = false;

      const timeout = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          reject(new Error('Session creation timeout - server did not respond in time'));
        }
      }, SESSION_TIMEOUT);

      // The SDK emits typed events via .on()
      this.rt!.on('session.created', () => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeout);
          resolve();
        }
      });

      this.rt!.on('error', (event: any) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeout);
          const errorMessage = event.error?.message || event.message || 'Session creation failed';
          reject(new Error(errorMessage));
        }
      });
    });
  }

  private sendSessionUpdate(config: OpenAISessionConfig): void {
    if (!this.rt) return;

    const session: any = {
      modalities: config.textOnly ? ['text'] : ['text', 'audio'],
      voice: config.voice || 'alloy',
      instructions: config.instructions,
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      temperature: config.temperature ?? 0.8,
      max_response_output_tokens: config.maxTokens === 'inf' ? 'inf' : config.maxTokens,
      tool_choice: 'none',
      tools: []
    };

    // Turn detection
    if (config.turnDetection) {
      if (config.turnDetection.type === 'none') {
        session.turn_detection = null;
        this.turnDetectionDisabled = true;
      } else {
        this.turnDetectionDisabled = false;
        session.turn_detection = {
          type: config.turnDetection.type,
          threshold: config.turnDetection.threshold,
          prefix_padding_ms: config.turnDetection.prefixPadding
            ? Math.round(config.turnDetection.prefixPadding * 1000)
            : undefined,
          silence_duration_ms: config.turnDetection.silenceDuration
            ? Math.round(config.turnDetection.silenceDuration * 1000)
            : undefined,
          create_response: config.turnDetection.createResponse ?? true,
          interrupt_response: config.turnDetection.interruptResponse ?? false
        };

        if (config.turnDetection.type === 'semantic_vad' && config.turnDetection.eagerness) {
          session.turn_detection.eagerness = config.turnDetection.eagerness.toLowerCase();
        }

        // Remove undefined fields
        Object.keys(session.turn_detection).forEach(key =>
          session.turn_detection[key] === undefined && delete session.turn_detection[key]
        );
      }
    }

    // Input audio transcription
    if (config.inputAudioTranscription?.model) {
      session.input_audio_transcription = {
        model: config.inputAudioTranscription.model
      };
    }

    // Noise reduction
    if (config.inputAudioNoiseReduction?.type) {
      session.input_audio_noise_reduction = {
        type: config.inputAudioNoiseReduction.type
      };
    }

    this.sendEvent({ type: 'session.update', session });
  }

  updateSession(config: Partial<SessionConfig>): void {
    if (isOpenAISessionConfig(config as SessionConfig)) {
      this.sendSessionUpdate(config as OpenAISessionConfig);
    }
  }

  // --- Event handling ---

  private setupEventListeners(): void {
    const rt = this.rt!;

    // Session events
    rt.on('session.created', (event: any) => this.forwardEvent('server', event));
    rt.on('session.updated', (event: any) => this.forwardEvent('server', event));

    // Conversation item lifecycle
    rt.on('conversation.item.created', (event: any) => {
      this.forwardEvent('server', event);
      this.handleItemCreated(event);
    });

    // GA text output events
    rt.on('response.output_text.delta', (event: any) => {
      this.forwardEvent('server', event);
      this.handleTextDelta(event);
    });

    rt.on('response.output_text.done', (event: any) => {
      this.forwardEvent('server', event);
      this.handleTextDone(event);
    });

    // GA audio output events
    rt.on('response.output_audio.delta', (event: any) => {
      this.forwardEvent('server', event);
      this.handleAudioDelta(event);
    });

    rt.on('response.output_audio.done', (event: any) => {
      this.forwardEvent('server', event);
    });

    // GA audio transcript events
    rt.on('response.output_audio_transcript.delta', (event: any) => {
      this.forwardEvent('server', event);
      this.handleTranscriptDelta(event);
    });

    rt.on('response.output_audio_transcript.done', (event: any) => {
      this.forwardEvent('server', event);
      this.handleTranscriptDone(event);
    });

    // Input transcription
    rt.on('conversation.item.input_audio_transcription.completed', (event: any) => {
      this.forwardEvent('server', event);
      this.handleInputTranscriptionCompleted(event);
    });

    // Response lifecycle
    rt.on('response.created', (event: any) => this.forwardEvent('server', event));
    rt.on('response.done', (event: any) => {
      this.forwardEvent('server', event);
      this.handleResponseDone(event);
    });

    // Audio buffer events
    rt.on('input_audio_buffer.speech_started', (event: any) => {
      this.forwardEvent('server', event);
      this.eventHandlers.onConversationInterrupted?.();
    });

    rt.on('input_audio_buffer.speech_stopped', (event: any) => {
      this.forwardEvent('server', event);
    });

    rt.on('input_audio_buffer.committed', (event: any) => {
      this.forwardEvent('server', event);
    });

    // Rate limits
    rt.on('rate_limits.updated', (event: any) => this.forwardEvent('server', event));

    // Error handling
    rt.on('error', (event: any) => {
      this.forwardEvent('server', event);
      this.handleErrorEvent(event);
    });
  }

  private forwardEvent(source: 'server' | 'client', event: any): void {
    const realtimeEvent: RealtimeEvent = {
      source,
      event: {
        type: event.type || 'unknown',
        data: event
      }
    };
    this.eventHandlers.onRealtimeEvent?.(realtimeEvent);
  }

  // --- Conversation item tracking ---

  private handleItemCreated(event: any): void {
    const item = event.item;
    if (!item) return;

    const createdAt = Date.now();
    this.itemCreatedAtMap.set(item.id, createdAt);

    const conversationItem: ConversationItem = {
      id: item.id,
      role: item.role || 'assistant',
      type: item.type || 'message',
      status: item.status || 'in_progress',
      createdAt,
      formatted: {
        text: '',
        transcript: ''
      },
      content: item.content || []
    };

    // Track current assistant response item for audio association
    if (conversationItem.role === 'assistant') {
      this.currentResponseItemId = item.id;
    }

    this.conversationItems.push(conversationItem);
    this.itemLookup.set(item.id, conversationItem);
    this.eventHandlers.onConversationUpdated?.({ item: conversationItem });
  }

  private findItem(itemId: string | undefined): ConversationItem | undefined {
    if (!itemId) return undefined;
    return this.itemLookup.get(itemId);
  }

  private handleTextDelta(event: any): void {
    const itemId = event.item_id;
    const delta = event.delta;
    if (!itemId || !delta) return;

    const item = this.findItem(itemId);
    if (!item) return;

    if (item.formatted) {
      item.formatted.text = (item.formatted.text || '') + delta;
    }

    this.eventHandlers.onConversationUpdated?.({
      item,
      delta: { text: delta }
    });
  }

  private handleTextDone(event: any): void {
    const itemId = event.item_id;
    const text = event.text;
    if (!itemId) return;

    const item = this.findItem(itemId);
    if (!item) return;

    if (item.formatted && text) {
      const cleaned = unwrapTranslationText(text);
      item.formatted.text = cleaned;
    }

    this.eventHandlers.onConversationUpdated?.({ item });
  }

  private handleTranscriptDelta(event: any): void {
    const itemId = event.item_id;
    const delta = event.delta;
    if (!itemId || !delta) return;

    const item = this.findItem(itemId);
    if (!item) return;

    if (item.formatted) {
      item.formatted.transcript = (item.formatted.transcript || '') + delta;
      item.formatted.text = item.formatted.transcript;
    }

    this.eventHandlers.onConversationUpdated?.({
      item,
      delta: { transcript: delta }
    });
  }

  private handleTranscriptDone(event: any): void {
    const itemId = event.item_id;
    const transcript = event.transcript;
    if (!itemId) return;

    const item = this.findItem(itemId);
    if (!item) return;

    if (item.formatted && transcript) {
      const cleaned = unwrapTranslationText(transcript);
      item.formatted.transcript = cleaned;
      item.formatted.text = cleaned;
    }

    this.eventHandlers.onConversationUpdated?.({ item });
  }

  // --- Audio I/O ---

  private handleAudioDelta(event: any): void {
    const itemId = event.item_id;
    if (!itemId || !event.delta) return;

    const item = this.findItem(itemId);
    if (!item) return;

    // Decode base64 audio to Int16Array
    const audioData = this.base64ToInt16Array(event.delta);
    const sequenceNumber = ++this.deltaSequenceNumber;

    this.eventHandlers.onConversationUpdated?.({
      item,
      delta: {
        audio: audioData,
        sequenceNumber,
        timestamp: Date.now()
      }
    });
  }

  appendInputAudio(audioData: Int16Array): void {
    if (!this.rt) return;

    const base64 = this.int16ArrayToBase64(audioData);
    this.sendEvent({
      type: 'input_audio_buffer.append',
      audio: base64
    });
  }

  private int16ArrayToBase64(data: Int16Array): string {
    const uint8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    return btoa(binary);
  }

  private base64ToInt16Array(base64: string): Int16Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Int16Array(bytes.buffer);
  }

  // --- Text input ---

  appendInputText(text: string): void {
    if (!this.rt || !text.trim()) return;

    this.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: text.trim()
        }]
      }
    });

    // Auto-trigger response after text input (matches WebRTC client pattern)
    this.sendEvent({ type: 'response.create' });
  }

  // --- Response management ---

  createResponse(config?: ResponseConfig): void {
    if (!this.rt) return;

    // Commit audio buffer in PTT mode (skip for out-of-band responses)
    if (this.turnDetectionDisabled && config?.conversation !== 'none') {
      this.sendEvent({ type: 'input_audio_buffer.commit' });
    }

    if (config) {
      const responseEvent: any = {
        type: 'response.create',
        response: {}
      };

      if (config.instructions) {
        responseEvent.response.instructions = config.instructions;
      }
      if (config.conversation) {
        responseEvent.response.conversation = config.conversation;
      }
      if (config.modalities) {
        responseEvent.response.modalities = config.modalities;
      }
      if (config.metadata) {
        responseEvent.response.metadata = config.metadata;
      }

      if (config.conversation === 'none') {
        console.debug('[OpenAIGAClient] Sending out-of-band response:', {
          conversation: config.conversation,
          modalities: config.modalities,
          hasInstructions: !!config.instructions,
          metadata: config.metadata
        });
      }

      this.sendEvent(responseEvent);
    } else {
      this.sendEvent({ type: 'response.create' });
    }
  }

  cancelResponse(_trackId?: string, _offset?: number): void {
    if (!this.rt) return;
    this.sendEvent({ type: 'response.cancel' });
  }

  // --- Other handlers ---

  private handleInputTranscriptionCompleted(event: any): void {
    const itemId = event.item_id;
    const transcript = event.transcript;
    if (!itemId) return;

    const item = this.findItem(itemId);
    if (item && item.formatted) {
      item.formatted.transcript = transcript;
      item.formatted.text = transcript;
      this.eventHandlers.onConversationUpdated?.({ item });
    }
  }

  private handleResponseDone(event: any): void {
    const response = event.response;
    if (!response?.output) return;

    for (const outputItem of response.output) {
      const item = this.findItem(outputItem.id);
      if (item) {
        item.status = 'completed';
        this.eventHandlers.onConversationUpdated?.({ item });
      }
    }

    this.currentResponseItemId = null;
  }

  private handleErrorEvent(event: any): void {
    const error = event.error || event;
    const errorItem: ConversationItem = {
      id: `error_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      role: 'system',
      type: 'error',
      status: 'completed',
      formatted: {
        text: `[${error.type || 'error'}] ${error.message || 'Unknown error'}`
      },
      content: [{
        type: 'text',
        text: error.message || 'Unknown error'
      }]
    };

    this.eventHandlers.onConversationUpdated?.({ item: errorItem });
    this.eventHandlers.onError?.(error);
  }

  // --- Event sending ---

  private sendEvent(event: any): void {
    if (!this.rt) {
      console.warn('[OpenAIGAClient] Cannot send event, not connected');
      return;
    }

    this.rt.send(event);

    // Emit client event for logging
    this.forwardEvent('client', event);
  }

  // --- Conversation state ---

  getConversationItems(): ConversationItem[] {
    return [...this.conversationItems];
  }

  setEventHandlers(handlers: ClientEventHandlers): void {
    this.eventHandlers = { ...handlers };
  }

  getProvider(): ProviderType {
    return Provider.OPENAI;
  }

  // --- Static methods (reused from OpenAIClient, REST-based) ---

  static async validateApiKeyAndFetchModels(apiKey: string, apiHost?: string): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    // Delegate to OpenAIClient's static method — it's REST-based, not WebSocket
    const { OpenAIClient } = await import('./OpenAIClient');
    return OpenAIClient.validateApiKeyAndFetchModels(apiKey, apiHost);
  }

  static getLatestRealtimeModel(filteredModels: FilteredModel[]): string {
    const realtimeModels = filteredModels.filter(model => model.type === 'realtime');
    if (realtimeModels.length > 0) {
      return realtimeModels[0].id;
    }
    return 'gpt-realtime-mini';
  }
}
```

- [ ] **Step 2: Verify the import path for OpenAIRealtimeWebSocket**

Check the actual export path in the installed `openai` package:

Run: `ls node_modules/openai/realtime/ 2>/dev/null || ls node_modules/openai/beta/realtime/ 2>/dev/null || echo "Check node_modules/openai/ manually"`

Update the import statement in `OpenAIGAClient.ts` if the path differs from `'openai/beta/realtime/websocket'`.

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: No TypeScript errors. The new client compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/services/clients/OpenAIGAClient.ts
git commit -m "feat: add OpenAIGAClient using official openai SDK for GA Realtime API"
```

---

## Chunk 3: Integration and WebRTC Fix

### Task 5: Update WebRTC client event names

**Files:**
- Modify: `src/services/clients/OpenAIWebRTCClient.ts:337-344`

- [ ] **Step 1: Add GA event name fallthrough cases**

In `src/services/clients/OpenAIWebRTCClient.ts`, in the `handleServerEvent` switch statement (around lines 337-345), add GA event names as fallthrough cases:

```typescript
// FROM:
      case 'response.audio_transcript.delta':
      case 'response.text.delta':
        this.handleTranscriptDelta(event);
        break;

      case 'response.audio_transcript.done':
      case 'response.text.done':
        this.handleTranscriptDone(event);
        break;
```

```typescript
// TO:
      case 'response.audio_transcript.delta':
      case 'response.output_audio_transcript.delta':  // GA
      case 'response.text.delta':
      case 'response.output_text.delta':              // GA
        this.handleTranscriptDelta(event);
        break;

      case 'response.audio_transcript.done':
      case 'response.output_audio_transcript.done':    // GA
      case 'response.text.done':
      case 'response.output_text.done':                // GA
        this.handleTranscriptDone(event);
        break;
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/clients/OpenAIWebRTCClient.ts
git commit -m "fix: add GA event name fallthrough in WebRTC client for forward compatibility"
```

---

### Task 6: Update ClientFactory routing

**Files:**
- Modify: `src/services/clients/ClientFactory.ts`

- [ ] **Step 1: Add OpenAIGAClient import**

At the top of `src/services/clients/ClientFactory.ts`, add:
```typescript
import { OpenAIGAClient } from './OpenAIGAClient';
```

- [ ] **Step 2: Route Provider.OPENAI WebSocket to OpenAIGAClient**

In `ClientFactory.ts`, in the `switch (provider)` statement, change the `case Provider.OPENAI` block. Replace:
```typescript
        return new OpenAIClient(apiKey);
```
With:
```typescript
        return new OpenAIGAClient(apiKey);
```

Keep the WebRTC path (`return new OpenAIWebRTCClient(...)`) unchanged.

Keep `Provider.OPENAI_COMPATIBLE` and `Provider.KIZUNA_AI` using `OpenAIClient` unchanged.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: No TypeScript errors.

- [ ] **Step 4: Run tests**

Run: `npm run test`
Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/clients/ClientFactory.ts
git commit -m "feat: route OpenAI WebSocket transport to GA client"
```

---

### Task 7: Add TODO to eval runner

**Files:**
- Modify: `evals/runner/clients/NodeOpenAIClient.ts`

- [ ] **Step 1: Add TODO comment**

At the top of `evals/runner/clients/NodeOpenAIClient.ts`, after the existing imports, add:
```typescript
// TODO: Migrate to official openai SDK's GA Realtime API before May 7, 2026
// when the beta protocol (OpenAI-Beta: realtime=v1) is shut down.
// See: https://github.com/kizuna-ai-lab/sokuji/issues/115
```

- [ ] **Step 2: Commit**

```bash
git add evals/runner/clients/NodeOpenAIClient.ts
git commit -m "chore: add migration TODO to eval runner client"
```

---

## Chunk 4: Verification

### Task 8: Static verification

- [ ] **Step 1: Full build check**

Run: `npm run build`
Expected: TypeScript compilation succeeds, no errors.

- [ ] **Step 2: Test suite**

Run: `npm run test`
Expected: All existing tests pass.

- [ ] **Step 3: Verify import separation**

Run: `grep -rn "from 'openai-realtime-api'" src/`
Expected: Only `src/services/clients/OpenAIClient.ts` should appear. No imports in `OpenAIGAClient.ts`, `logStore.ts`, or `IClient.ts`.

- [ ] **Step 4: Verify GA client has no beta dependency**

Run: `grep -n "openai-realtime-api" src/services/clients/OpenAIGAClient.ts`
Expected: No matches.

### Task 9: Manual E2E testing (user-performed)

Refer to the **Verification Plan** in `docs/superpowers/specs/2026-03-14-openai-ga-migration-design.md` for the complete 6-phase test checklist covering:

- Phase 1: Static checks (automated, done in Task 8)
- Phase 2: OpenAI GA provider E2E (connection, voice, text, PTT, errors, transcription)
- Phase 3: OpenAI Compatible beta regression
- Phase 4: Kizuna AI (BLOCKED — external dependency)
- Phase 5: WebRTC smoke test
- Phase 6: Cross-cutting concerns (logs, state, extension)
