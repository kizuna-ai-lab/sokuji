import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import type {
  RealtimeServerEvents,
  RealtimeClientEvents,
  RealtimeCustomEvents
} from 'openai-realtime-api';

// Define the core event data structure
export interface EventData {
  type: 
    // General message types
    | 'message'
    // Connection state types
    | 'session.opened'
    | 'session.closed'
    | 'session.error'
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
    // OpenAI event types from the openai-realtime-api package
    | RealtimeServerEvents.EventType
    | RealtimeClientEvents.EventType
    | RealtimeCustomEvents.EventType
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
    | 'current_task';
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

// Define the log entry type
export interface LogEntry {
  timestamp: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error' | 'token';
  events?: EventData[]; // For storing all events (single or grouped)
  source?: RealtimeEventSource; // To identify if it's a client or server event
  eventType?: string; // The type of the event (e.g., 'session.created', 'response.text.delta')
  groupingKey?: string; // Custom grouping key for specific event types
}

interface LogStore {
  logs: LogEntry[];
  pendingLogs: LogEntry[];
  allLogs: LogEntry[]; // Combined logs for display
  batchTimer: NodeJS.Timeout | null;
  addLog: (message: string, type?: LogEntry['type']) => void;
  addRealtimeEvent: (event: EventData, source: RealtimeEventSource, eventType: string) => void;
  clearLogs: () => void;
  flushPendingLogs: () => void;
}

// Sanitize event data by removing large binary audio fields
const sanitizeEvent = (event: any): any => {
  // If event is null or not an object, return as is
  if (!event || typeof event !== 'object') {
    return event;
  }

  // If it's an array buffer or typed array, replace with placeholder
  if (event instanceof ArrayBuffer || ArrayBuffer.isView(event)) {
    return '[Binary audio data removed]';
  }

  // If it's a regular array, check each element
  if (Array.isArray(event)) {
    return event.map(item => sanitizeEvent(item));
  }

  // For objects, recursively sanitize each property
  const sanitized: any = {};
  for (const key in event) {
    if (event.hasOwnProperty(key)) {
      const value = event[key];
      
      // Skip known audio data fields
      if (
        key === 'audio' || 
        key === 'audioData' || 
        key === 'audio_data' || 
        key === 'pcmData' ||
        key === 'buffer' ||
        key === 'wav' ||
        key === 'pcm' ||
        key === 'delta' // Added to catch response.audio.delta events
      ) {
        // Check if it's binary data
        if (
          value instanceof ArrayBuffer || 
          ArrayBuffer.isView(value) ||
          (Array.isArray(value) && value.length > 1000) // Large arrays likely to be audio data
        ) {
          sanitized[key] = '[Binary audio data removed]';
        } else if (typeof value === 'string' && value.length > 500) {
          // Remove any long strings in audio fields (likely Base64 or encoded audio)
          sanitized[key] = '[Audio data removed]';
        } else {
          // Recursively sanitize other types
          sanitized[key] = sanitizeEvent(value);
        }
      } else {
        // Recursively sanitize other properties
        sanitized[key] = sanitizeEvent(value);
      }
    }
  }
  
  return sanitized;
};

// Batch update configuration
const BATCH_DELAY_MS = 100; // Batch updates every 100ms

// Create the Zustand store
const useLogStore = create<LogStore>(
  subscribeWithSelector((set, get) => ({
    logs: [],
    pendingLogs: [],
    allLogs: [], // Initialize combined logs
    batchTimer: null,

    flushPendingLogs: () => {
      const state = get();
      if (state.pendingLogs.length > 0) {
        const newLogs = [...state.logs, ...state.pendingLogs];
        set({
          logs: newLogs,
          pendingLogs: [],
          allLogs: newLogs, // Update combined logs
          batchTimer: null
        });
      }
    },

    addLog: (message: string, type: LogEntry['type'] = 'info') => {
      const now = new Date();
      const timestamp = now.toLocaleTimeString();
      const newLog = { timestamp, message, type };
      
      set(state => {
        // Clear existing timer
        if (state.batchTimer) {
          clearTimeout(state.batchTimer);
        }
        
        // Set new timer to flush batch
        const timer = setTimeout(() => {
          get().flushPendingLogs();
        }, BATCH_DELAY_MS);
        
        const newPendingLogs = [...state.pendingLogs, newLog];
        const newAllLogs = [...state.logs, ...newPendingLogs];
        
        return {
          pendingLogs: newPendingLogs,
          allLogs: newAllLogs, // Update combined logs
          batchTimer: timer
        };
      });
    },

    addRealtimeEvent: (event: EventData, source: RealtimeEventSource, eventType: string) => {
      const now = new Date();
      const timestamp = now.toLocaleTimeString();
      
      // Sanitize the event to remove binary audio data
      const sanitizedEvent = sanitizeEvent(event);
      
      // Create a descriptive message for the log entry
      const message = `${source}: ${eventType}`;
      
      // For specific event types, use different grouping strategies
      let groupingKey: string | undefined;
      
      // OpenAI-specific grouping
      if (eventType === 'input_audio_buffer.append') {
        groupingKey = 'input_audio_buffer';
      } 
      // For other delta events, group by event type only
      else if (eventType.includes('delta')) {
        groupingKey = eventType;
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
        // Check both logs and pendingLogs for grouping
        const allLogs = [...state.logs, ...state.pendingLogs];
        
        // Check if this is a consecutive identical event
        if (allLogs.length > 0) {
          const lastLog = allLogs[allLogs.length - 1];
          
          // Check if the last log has the same event type, source, and grouping key
          if (
            lastLog.eventType === eventType && 
            lastLog.source === source &&
            lastLog.groupingKey === groupingKey &&
            groupingKey !== undefined
          ) {
            // Update the last log with new event
            const updatedLastLog = {
              ...lastLog,
              timestamp, // Update timestamp to the latest
              events: [...(lastLog.events || []), sanitizedEvent] // Add the sanitized event to the events array
            };
            
            // Check if the last log is in pendingLogs or logs
            if (state.pendingLogs.length > 0 && 
                state.pendingLogs[state.pendingLogs.length - 1] === lastLog) {
              // Update in pendingLogs
              const updatedPendingLogs = [...state.pendingLogs.slice(0, -1), updatedLastLog];
              
              // Clear existing timer
              if (state.batchTimer) {
                clearTimeout(state.batchTimer);
              }
              
              // Set new timer to flush batch
              const timer = setTimeout(() => {
                get().flushPendingLogs();
              }, BATCH_DELAY_MS);
              
              const newAllLogs = [...state.logs, ...updatedPendingLogs];
              return { 
                pendingLogs: updatedPendingLogs,
                allLogs: newAllLogs,
                batchTimer: timer
              };
            } else {
              // Update in logs and restart batch timer
              const logsWithoutLast = state.logs.slice(0, -1);
              
              // Clear existing timer
              if (state.batchTimer) {
                clearTimeout(state.batchTimer);
              }
              
              // Set new timer to flush batch
              const timer = setTimeout(() => {
                get().flushPendingLogs();
              }, BATCH_DELAY_MS);
              
              const newLogs = [...logsWithoutLast, updatedLastLog];
              return { 
                logs: newLogs,
                allLogs: [...newLogs, ...state.pendingLogs],
                batchTimer: timer
              };
            }
          }
        }
        
        // If not a consecutive identical event, add a new log entry to pending
        const newLog = { 
          timestamp, 
          message, 
          type: 'info' as const, 
          events: [sanitizedEvent], // Initialize events array with the sanitized event
          source, 
          eventType,
          groupingKey
        };
        
        // Clear existing timer
        if (state.batchTimer) {
          clearTimeout(state.batchTimer);
        }
        
        // Set new timer to flush batch
        const timer = setTimeout(() => {
          get().flushPendingLogs();
        }, BATCH_DELAY_MS);
        
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
export const useLogData = () => useLogStore(state => state.allLogs);

// For backwards compatibility, provide a combined hook
export const useLogActions = () => {
  const addLog = useAddLog();
  const addRealtimeEvent = useAddRealtimeEvent();
  const clearLogs = useClearLogs();
  
  return { addLog, addRealtimeEvent, clearLogs };
};

export default useLogStore;