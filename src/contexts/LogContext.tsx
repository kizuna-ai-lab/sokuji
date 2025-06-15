import React, { createContext, useContext, useState, ReactNode } from 'react';

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
    // OpenAI-specific types
    | 'conversation.item.created'
    | 'conversation.item.truncated'
    | 'conversation.item.deleted'
    | 'conversation.item.input_audio_transcription.completed'
    | 'conversation.item.input_audio_transcription.failed'
    | 'input_audio_buffer.committed'
    | 'input_audio_buffer.cleared'
    | 'input_audio_buffer.speech_started'
    | 'input_audio_buffer.speech_stopped'
    | 'input_audio_buffer.append'
    | 'response.created'
    | 'response.done'
    | 'response.output_item.added'
    | 'response.output_item.done'
    | 'response.content_part.added'
    | 'response.content_part.done'
    | 'response.text.delta'
    | 'response.text.done'
    | 'response.audio_transcript.delta'
    | 'response.audio_transcript.done'
    | 'response.audio.delta'
    | 'response.audio.done'
    | 'response.function_call_arguments.delta'
    | 'response.function_call_arguments.done'
    | 'rate_limits.updated'
    | 'session.created'
    | 'session.updated'
    | 'error';
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

interface LogContextType {
  logs: LogEntry[];
  addLog: (message: string, type?: LogEntry['type']) => void;
  addRealtimeEvent: (event: EventData, source: RealtimeEventSource, eventType: string) => void;
  clearLogs: () => void;
}

const LogContext = createContext<LogContextType | undefined>(undefined);

export const useLog = () => {
  const context = useContext(LogContext);
  if (!context) {
    throw new Error('useLog must be used within a LogProvider');
  }
  return context;
};

interface LogProviderProps {
  children: ReactNode;
}

export const LogProvider: React.FC<LogProviderProps> = ({ children }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    
    setLogs(prevLogs => [
      ...prevLogs,
      { timestamp, message, type }
    ]);
  };

  const addRealtimeEvent = (event: EventData, source: RealtimeEventSource, eventType: string) => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    
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
    // For other events, extract item_id if it exists (OpenAI)
    else {
      // Check for item_id in various event structures
      if (event.conversation?.item?.id) {
        groupingKey = event.conversation.item.id;
      } else if (event.item?.id) {
        groupingKey = event.item.id;
      } else if (event.item_id) {
        groupingKey = event.item_id;
      }
    }
    
    setLogs(prevLogs => {
      // Check if this is a consecutive identical event
      if (prevLogs.length > 0) {
        const lastLog = prevLogs[prevLogs.length - 1];
        
        // Check if the last log has the same event type, source, and grouping key
        if (
          lastLog.eventType === eventType && 
          lastLog.source === source &&
          lastLog.groupingKey === groupingKey &&
          groupingKey !== undefined
        ) {
          // Create a new array with all logs except the last one
          const logsWithoutLast = prevLogs.slice(0, -1);
          
          // Update the last log with an incremented count
          const updatedLastLog = {
            ...lastLog,
            timestamp, // Update timestamp to the latest
            events: [...(lastLog.events || []), event] // Add the new event to the events array
          };
          
          // Return the updated logs array
          return [...logsWithoutLast, updatedLastLog];
        }
      }
      
      // If not a consecutive identical event, add a new log entry
      return [
        ...prevLogs,
        { 
          timestamp, 
          message, 
          type: 'info', 
          events: [event], // Initialize events array with the first event
          source, 
          eventType,
          groupingKey
        }
      ];
    });
  };

  const clearLogs = () => {
    setLogs([]);
  };

  return (
    <LogContext.Provider value={{ logs, addLog, addRealtimeEvent, clearLogs }}>
      {children}
    </LogContext.Provider>
  );
};
