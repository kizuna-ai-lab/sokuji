import React, { createContext, useContext, useState, ReactNode } from 'react';

// Define the log entry type
export interface LogEntry {
  timestamp: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error' | 'token';
  events?: {[key:string]: any}[]; // For storing all events (single or grouped)
  source?: 'client' | 'server'; // To identify if it's a client or server event
  eventType?: string; // The type of the event (e.g., 'session.created', 'response.text.delta')
  groupingKey?: string; // Custom grouping key for specific event types
}

interface LogContextType {
  logs: LogEntry[];
  addLog: (message: string, type?: LogEntry['type']) => void;
  addRealtimeEvent: (event: {[key:string]: any}, source: 'client' | 'server', eventType: string) => void;
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

  const addRealtimeEvent = (event: any, source: 'client' | 'server', eventType: string) => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    
    // Create a descriptive message for the log entry
    const message = `${source}: ${eventType}`;
    
    // For specific event types, use different grouping strategies
    let groupingKey: string | undefined;
    
    // For input_audio_buffer.append events, group by event type only
    if (eventType === 'input_audio_buffer.append') {
      groupingKey = 'input_audio_buffer';
    } 
    // For other delta events, group by event type only
    else if (eventType.includes('delta')) {
      groupingKey = eventType;
    }
    // For other events, extract item_id if it exists
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
