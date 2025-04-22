import React, { createContext, useContext, useState, ReactNode } from 'react';

// Define the log entry type
export interface LogEntry {
  timestamp: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error' | 'token';
  event?: {[key:string]: any}; // For storing OpenAI Realtime API events
  source?: 'client' | 'server'; // To identify if it's a client or server event
  eventType?: string; // The type of the event (e.g., 'session.created', 'response.text.delta')
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
    
    setLogs(prevLogs => [
      ...prevLogs,
      { 
        timestamp, 
        message, 
        type: 'info', 
        event, 
        source, 
        eventType 
      }
    ]);
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
