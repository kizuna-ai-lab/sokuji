import { createContext, useContext, useState, ReactNode } from 'react';

interface SessionContextType {
  isSessionActive: boolean;
  setIsSessionActive: (active: boolean) => void;
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  sessionStartTime: number | null;
  setSessionStartTime: (time: number | null) => void;
  translationCount: number;
  setTranslationCount: (count: number) => void;
}

const SessionContext = createContext<SessionContextType | null>(null);

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
};

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [translationCount, setTranslationCount] = useState(0);

  return (
    <SessionContext.Provider
      value={{
        isSessionActive,
        setIsSessionActive,
        sessionId,
        setSessionId,
        sessionStartTime,
        setSessionStartTime,
        translationCount,
        setTranslationCount,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}; 