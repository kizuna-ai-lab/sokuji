import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { useMemo } from 'react';
import { sanitizeEvent } from './sanitizeEvent';
import { redact } from '../lib/diagnostics/redact';

// Define the core event data structure
export interface EventData {
  type: 
    // General message types
    | 'message'
    // Connection state types
    | 'session.opened'
    | 'session.closed'
    | 'session.reconnecting'
    | 'session.reconnected'
    | 'session.error'
    | 'session.reconnect_failed'
    | 'session.init_error'
    | 'session.webrtc_fallback'
    // Participant/local inference status types
    | 'participant.error'
    // Managed-lease notifications (ProviderDescriptor.onEvent)
    | 'session.retry'
    | 'session.started_refused'
    | 'session.notify_failed'
    | 'participant.warning'
    | 'participant.info'
    // Gemini-specific top-level message types
    | 'setupComplete'
    | 'usageMetadata'
    | 'toolCall'
    | 'toolCallCancellation'
    | 'goAway'
    | 'sessionResumptionUpdate'
    // Gemini-specific serverContent types
    | 'serverContent.interrupted'
    | 'serverContent.turnComplete'
    | 'serverContent.generationComplete'
    | 'serverContent.groundingMetadata'
    | 'serverContent.modelTurn'
    | 'serverContent.outputTranscription'
    | 'serverContent.inputTranscription'
    // OpenAI server events (shared between beta and GA)
    | 'session.created' | 'session.updated'
    | 'conversation.created'
    | 'conversation.item.created' | 'conversation.item.deleted' | 'conversation.item.truncated'
    | 'conversation.item.input_audio_transcription.completed'
    | 'conversation.item.input_audio_transcription.failed'
    | 'conversation.item.input_audio_transcription.delta'
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
    // OpenAI translate client events (the wire prefix is `session.`)
    | 'session.input_audio_buffer.append'
    | 'conversation.item.create' | 'conversation.item.truncate' | 'conversation.item.delete'
    | 'response.create' | 'response.cancel'
    // openai-realtime-api custom events (for beta clients)
    | 'conversation.item.appended' | 'conversation.item.completed'
    | 'conversation.updated' | 'conversation.interrupted'
    | 'realtime.event'
    // PalabraAI-specific request types (client → server)
    | 'set_task'
    | 'end_task'
    | 'get_task'
    | 'pause_task'
    | 'tts_task'
    | 'input_audio_data'
    // PalabraAI-specific response types (server → client)
    | 'partial_transcription'
    | 'partial_translated_transcription'
    | 'validated_transcription'
    | 'translated_transcription'
    | 'output_audio_data'
    | 'current_task'
    // LocalInference pipeline event types
    | 'local.session.opened'
    | 'local.session.closed'
    | 'local.asr.start'
    | 'local.asr.partial'
    | 'local.asr.end'
    | 'local.asr.error'
    | 'local.translation.start'
    | 'local.translation.end'
    | 'local.tts.start'
    | 'local.tts.end'
    | 'zoom.speech_start'
    | 'local.tts.sentence.start'
    | 'local.tts.sentence.end'
    | 'local.tts.error'
    | 'local.pipeline.error'
    // LocalInference init progress event types
    | 'local.init.start'
    | 'local.init.asr.start'
    | 'local.init.asr.ready'
    | 'local.init.asr.error'
    | 'local.init.translation.start'
    | 'local.init.translation.ready'
    | 'local.init.translation.error'
    | 'local.init.tts.start'
    | 'local.init.tts.ready'
    | 'local.init.tts.error'
    // LocalNative (Electron sidecar) pipeline event types
    | 'local.native.session.closed'
    | 'local.native.hardware'
    | 'local.native.error'
    | 'local.native.asr.partial'
    | 'local.native.asr.end'
    | 'local.native.translation.start'
    | 'local.native.translation.end'
    | 'local.native.tts.start'
    | 'local.native.tts.sentence.start'
    | 'local.native.tts.sentence.end'
    | 'local.native.tts.end'
    | 'local.native.tts.error'
    // LocalNative init progress event types
    | 'local.native.init.start'
    | 'local.native.init.ready'
    | 'local.native.init.asr.ready'
    | 'local.native.init.asr.fallback'
    | 'local.native.init.translation.ready'
    | 'local.native.init.translation.fallback'
    | 'local.native.init.tts.ready'
    | 'local.native.init.tts.fallback';
  data: any;
  // Support additional properties for flexible event handling (e.g., OpenAI properties)
  [key: string]: any;
}

// Define the realtime event type that includes source and event info
export interface RealtimeEvent {
  source: RealtimeEventSource;
  event: EventData;
  // Support additional properties for flexible event handling (e.g., OpenAI raw events)
  [key: string]: any;
}

// Define the realtime event source type
export type RealtimeEventSource = 'client' | 'server';

// Define the client ID type for dual-client support
export type ClientId = 'speaker' | 'participant';

// Define the log entry type
export interface LogEntry {
  /**
   * Stable identity, monotonic across the store's lifetime.
   *
   * LogsPanel keys rows by this rather than by array index: entries are trimmed
   * from the front at MAX_LOG_ENTRIES, which shifts every index and would
   * migrate an expanded <Event>'s open/JSON state onto a different entry.
   */
  id: number;
  timestamp: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error' | 'token';
  events?: EventData[]; // For storing all events (single or grouped)
  source?: RealtimeEventSource; // To identify if it's a client or server event
  eventType?: string; // The type of the event (e.g., 'session.created', 'response.text.delta')
  groupingKey?: string; // Custom grouping key for specific event types
  /**
   * Which session leg produced this, or undefined for an app-scope failure
   * (settings, auth, devices, models). LogsPanel shows undefined under BOTH
   * tabs; it is not a synonym for 'speaker'.
   */
  clientId?: ClientId;
}

interface LogStore {
  logs: LogEntry[];
  pendingLogs: LogEntry[];
  allLogs: LogEntry[]; // Combined logs for display
  batchTimer: NodeJS.Timeout | null;
  addLog: (message: string, type?: LogEntry['type'], clientId?: ClientId) => void;
  addRealtimeEvent: (event: EventData, source: RealtimeEventSource, eventType: string, clientId?: ClientId) => void;
  clearLogs: () => void;
  flushPendingLogs: () => void;
}

// Batch update configuration - increased for better performance
const BATCH_DELAY_MS = 150; // Batch updates every 150ms for better performance

/**
 * Hard ceiling on retained entries; oldest are dropped first in flush.
 *
 * A session runs for hours and every realtime event lands here, so without a cap
 * `allLogs` grows for as long as the app is open — and each write spreads the
 * whole array. Session separators are derived per entry in LogsPanel, so
 * trimming cannot orphan one.
 */
const MAX_LOG_ENTRIES = 2000;

let nextLogId = 0;
const takeLogId = (): number => ++nextLogId;

/**
 * Schedule a flush unless one is already pending.
 *
 * THROTTLE, not debounce. This used to clear the pending timeout on every write
 * and set a fresh one, so any write stream spaced closer than BATCH_DELAY_MS —
 * audio deltas during a live session, the settings burst at boot — pushed the
 * flush forever into the future: `pendingLogs` grew without bound and
 * MAX_LOG_ENTRIES, enforced in flush, would never have run. Scheduling only when
 * no timer exists guarantees a flush every <=150ms. Grouping is unaffected: it
 * looks up the last entry for a client, not the timer state.
 */
function scheduleFlush(
  state: { batchTimer: NodeJS.Timeout | null },
  flush: () => void,
): NodeJS.Timeout {
  if (state.batchTimer) return state.batchTimer;
  return setTimeout(flush, BATCH_DELAY_MS);
}

/**
 * Severity for a realtime event, from its type name.
 *
 * Every event row used to be stamped 'info', so a session failure rendered
 * exactly like a transcript delta and the `.error`/`.warning` rules in
 * LogsPanel.scss were unreachable for events. Suffix-anchored on purpose:
 * `session.error_recovered` is not a failure.
 */
function severityForEventType(eventType: string): LogEntry['type'] {
  if (/(?:^|[._])(?:error|failed)$/.test(eventType)) return 'error';
  if (/(?:^|[._])warning$/.test(eventType)) return 'warning';
  return 'info';
}

// Create the Zustand store
const useLogStore = create<LogStore>(
  subscribeWithSelector((set, get) => ({
    logs: [],
    pendingLogs: [],
    allLogs: [], // Initialize combined logs
    batchTimer: null,

    flushPendingLogs: () => {
      const state = get();
      if (state.batchTimer) {
        clearTimeout(state.batchTimer);
      }
      if (state.pendingLogs.length > 0) {
        const merged = [...state.logs, ...state.pendingLogs];
        // Oldest first. With the throttle above, `pendingLogs` holds at most
        // 150ms of traffic, so every spread below is bounded by MAX_LOG_ENTRIES.
        const newLogs = merged.length > MAX_LOG_ENTRIES
          ? merged.slice(merged.length - MAX_LOG_ENTRIES)
          : merged;
        set({
          logs: newLogs,
          pendingLogs: [],
          allLogs: newLogs, // Update combined logs
          batchTimer: null
        });
      } else {
        set({ batchTimer: null });
      }
    },

    addLog: (message: string, type: LogEntry['type'] = 'info', clientId?: ClientId) => {
      const now = new Date();
      const timestamp = now.toLocaleTimeString();
      const newLog: LogEntry = {
        id: takeLogId(),
        timestamp,
        // Redacted at the sink, not at the call site: this also covers the
        // legacy addLog callers and any future bypass. Panel text is
        // clipboard-exportable straight into a bug report.
        message: redact(message),
        type,
        clientId,
      };

      set(state => {
        const timer = scheduleFlush(state, () => get().flushPendingLogs());

        const newPendingLogs = [...state.pendingLogs, newLog];
        const newAllLogs = [...state.logs, ...newPendingLogs];

        return {
          pendingLogs: newPendingLogs,
          allLogs: newAllLogs, // Update combined logs
          batchTimer: timer
        };
      });
    },

    addRealtimeEvent: (event: EventData, source: RealtimeEventSource, eventType: string, clientId?: ClientId) => {
      const now = new Date();
      const timestamp = now.toLocaleTimeString();
      // Undefined stays undefined: an app-scope event (MainPanel's
      // session.init_error / participant.error connect rows) is not a speaker
      // event, and LogsPanel already shows undefined under both tabs.
      const logClientId = clientId;
      
      // Sanitize the event to remove binary audio data
      const sanitizedEvent = sanitizeEvent(event);
      
      // Create a descriptive message for the log entry
      const message = `${source}: ${eventType}`;
      
      // For specific event types, use different grouping strategies
      let groupingKey: string | undefined;
      
      // OpenAI-specific grouping. The translate API prefixes the same wire
      // event with `session.`, so collapse both variants under the same key.
      if (eventType === 'input_audio_buffer.append' || eventType === 'session.input_audio_buffer.append') {
        groupingKey = 'input_audio_buffer';
      }
      // For other delta events, group by event type only
      else if (eventType.includes('delta')) {
        groupingKey = eventType;
      }
      // Soniox: collapse the stream of TTS audio chunks into one counted entry.
      else if (eventType === 'tts.audio') {
        groupingKey = 'soniox_tts_audio';
      }
      // Gemini-specific grouping
      else if (eventType === 'serverContent.modelTurn' || eventType === 'serverContent.outputTranscription') {
        // Group Gemini model turn and output transcription events together (both are assistant output)
        groupingKey = 'gemini_model_turn';
      }
      else if (eventType === 'serverContent.interrupted') {
        // Group Gemini interruption events together
        groupingKey = 'gemini_interrupted';
      }
      else if (eventType === 'serverContent.turnComplete') {
        // Group Gemini turn complete events together
        groupingKey = 'gemini_turn_complete';
      }
      else if (eventType === 'serverContent.generationComplete') {
        // Group Gemini generation complete events together
        groupingKey = 'gemini_generation_complete';
      }
      else if (eventType === 'usageMetadata') {
        // Group Gemini usage metadata events together
        groupingKey = 'gemini_usage_metadata';
      }
      else if (eventType === 'serverContent.inputTranscription') {
        // Group Gemini input transcription events together
        groupingKey = 'gemini_input_transcription';
      }
      // PalabraAI-specific grouping
      else if (eventType === 'partial_transcription') {
        // Group PalabraAI partial transcription events together
        groupingKey = 'palabraai_partial_transcription';
      }
      else if (eventType === 'partial_translated_transcription') {
        // Group PalabraAI partial translated transcription events together
        groupingKey = 'palabraai_partial_translated_transcription';
      }
      else if (eventType === 'validated_transcription') {
        // Group PalabraAI validated transcription events together
        groupingKey = 'palabraai_validated_transcription';
      }
      else if (eventType === 'translated_transcription') {
        // Group PalabraAI translated transcription events together
        groupingKey = 'palabraai_translated_transcription';
      }
      else if (eventType === 'output_audio_data') {
        // Group PalabraAI output audio data events together
        groupingKey = 'palabraai_output_audio_data';
      }
      else if (eventType === 'input_audio_data') {
        // Group PalabraAI input audio data events together
        groupingKey = 'palabraai_input_audio_data';
      }
      else if (eventType === 'set_task' || eventType === 'end_task' || eventType === 'get_task' || eventType === 'pause_task' || eventType === 'tts_task') {
        // Group PalabraAI task management events together
        groupingKey = 'palabraai_task_management';
      }
      else if (eventType === 'current_task') {
        // Group PalabraAI current task response events together
        groupingKey = 'palabraai_current_task';
      }
      // Volcengine AST2-specific grouping
      else if (eventType === 'SourceSubtitleResponse' || eventType === 'SourceSubtitleStart' || eventType === 'SourceSubtitleEnd') {
        groupingKey = 'volcengine_source_subtitle';
      }
      else if (eventType === 'TranslationSubtitleResponse' || eventType === 'TranslationSubtitleStart' || eventType === 'TranslationSubtitleEnd') {
        groupingKey = 'volcengine_translation_subtitle';
      }
      else if (eventType === 'TTSResponse' || eventType === 'TTSSentenceStart' || eventType === 'TTSSentenceEnd') {
        groupingKey = 'volcengine_tts';
      }
      else if (eventType === 'UsageResponse') {
        groupingKey = 'volcengine_usage';
      }
      else if (eventType === 'AudioMuted' || eventType === 'AudioUnmuted') {
        groupingKey = 'volcengine_audio_mute';
      }
      // For other events, extract item_id if it exists (OpenAI)
      // Note: Use sanitizedEvent for checking item_id to avoid accessing removed audio data
      else {
        // Check for item_id in various event structures
        if (sanitizedEvent.conversation?.item?.id) {
          groupingKey = sanitizedEvent.conversation.item.id;
        } else if (sanitizedEvent.item?.id) {
          groupingKey = sanitizedEvent.item.id;
        } else if (sanitizedEvent.item_id) {
          groupingKey = sanitizedEvent.item_id;
        }
      }
      
      set(state => {
        // Find the last log with the same clientId for grouping
        // This allows proper grouping even when logs from different clients are interleaved
        //
        // Scanned backwards in place. This used to be
        // `[...arr].reverse().findIndex(...)` on both arrays, which copied and
        // reversed the entire log history on *every* realtime event — an O(n)
        // cost per event against an array that grows all session long, on the
        // same main thread that has to keep up with audio. Walking backwards
        // also stops at the first match, which is usually the last element, and
        // skips `logs` entirely whenever `pendingLogs` already has one.
        const findLastIndexForClient = (arr: LogEntry[]): number => {
          for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i].clientId === logClientId) return i;
          }
          return -1;
        };

        // Determine which array has the more recent log for this client
        let lastLogForClient: LogEntry | undefined;
        let isInPendingLogs = false;
        let actualIndex = -1;

        const pendingLogIndex = findLastIndexForClient(state.pendingLogs);
        if (pendingLogIndex !== -1) {
          // Found in pendingLogs - this is more recent since pendingLogs come after logs
          lastLogForClient = state.pendingLogs[pendingLogIndex];
          isInPendingLogs = true;
          actualIndex = pendingLogIndex;
        } else {
          const logsIndex = findLastIndexForClient(state.logs);
          if (logsIndex !== -1) {
            // Found in logs
            lastLogForClient = state.logs[logsIndex];
            isInPendingLogs = false;
            actualIndex = logsIndex;
          }
        }

        // Check if we should group with the last log for this client
        if (
          lastLogForClient &&
          lastLogForClient.eventType === eventType &&
          lastLogForClient.source === source &&
          lastLogForClient.groupingKey === groupingKey &&
          groupingKey !== undefined
        ) {
          // Update the log with new event
          const updatedLog = {
            ...lastLogForClient,
            timestamp, // Update timestamp to the latest
            events: [...(lastLogForClient.events || []), sanitizedEvent]
          };

          const timer = scheduleFlush(state, () => get().flushPendingLogs());

          if (isInPendingLogs) {
            // Update in pendingLogs
            const updatedPendingLogs = [
              ...state.pendingLogs.slice(0, actualIndex),
              updatedLog,
              ...state.pendingLogs.slice(actualIndex + 1)
            ];
            const newAllLogs = [...state.logs, ...updatedPendingLogs];
            return {
              pendingLogs: updatedPendingLogs,
              allLogs: newAllLogs,
              batchTimer: timer
            };
          } else {
            // Update in logs
            const updatedLogs = [
              ...state.logs.slice(0, actualIndex),
              updatedLog,
              ...state.logs.slice(actualIndex + 1)
            ];
            return {
              logs: updatedLogs,
              allLogs: [...updatedLogs, ...state.pendingLogs],
              batchTimer: timer
            };
          }
        }
        
        // If not a consecutive identical event, add a new log entry to pending
        const newLog: LogEntry = {
          id: takeLogId(),
          timestamp,
          message,
          type: severityForEventType(eventType),
          events: [sanitizedEvent], // Initialize events array with the sanitized event
          source,
          eventType,
          groupingKey,
          clientId: logClientId
        };
        
        const timer = scheduleFlush(state, () => get().flushPendingLogs());

        const newPendingLogs = [...state.pendingLogs, newLog];
        const newAllLogs = [...state.logs, ...newPendingLogs];
        return {
          pendingLogs: newPendingLogs,
          allLogs: newAllLogs,
          batchTimer: timer
        };
      });
    },

    clearLogs: () => {
      const state = get();
      // Clear any pending timer
      if (state.batchTimer) {
        clearTimeout(state.batchTimer);
      }
      set({ logs: [], pendingLogs: [], allLogs: [], batchTimer: null });
    }
  }))
);

// Export selectors for optimized subscriptions
// Use separate selectors to avoid creating new objects
export const useAddLog = () => useLogStore(state => state.addLog);
export const useAddRealtimeEvent = () => useLogStore(state => state.addRealtimeEvent);
export const useClearLogs = () => useLogStore(state => state.clearLogs);
// Use pre-computed allLogs to prevent creating new arrays on every render
export const useLogData = () => useLogStore(state => state.allLogs, shallow);

// For backwards compatibility, provide a combined hook
export const useLogActions = () => {
  const addLog = useAddLog();
  const addRealtimeEvent = useAddRealtimeEvent();
  const clearLogs = useClearLogs();
  
  return useMemo(
    () => ({ addLog, addRealtimeEvent, clearLogs }),
    [addLog, addRealtimeEvent, clearLogs]
  );
};

export default useLogStore;