import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { useMemo } from 'react';

interface SessionStore {
  // State
  isSessionActive: boolean;
  sessionId: string | null;
  sessionStartTime: number | null;
  translationCount: number;
  
  // Actions
  setIsSessionActive: (active: boolean) => void;
  setSessionId: (id: string | null) => void;
  setSessionStartTime: (time: number | null) => void;
  setTranslationCount: (count: number) => void;
  incrementTranslationCount: () => void;
  
  // Compound actions
  startSession: (sessionId: string) => void;
  endSession: () => void;
  resetSession: () => void;
}

const useSessionStore = create<SessionStore>()(
  subscribeWithSelector((set) => ({
    // Initial state
    isSessionActive: false,
    sessionId: null,
    sessionStartTime: null,
    translationCount: 0,
    
    // Basic setters
    setIsSessionActive: (active) => set({ isSessionActive: active }),
    setSessionId: (id) => set({ sessionId: id }),
    setSessionStartTime: (time) => set({ sessionStartTime: time }),
    setTranslationCount: (count) => set({ translationCount: count }),
    
    // Increment translation count
    incrementTranslationCount: () => set((state) => ({ 
      translationCount: state.translationCount + 1 
    })),
    
    // Compound action to start a session
    startSession: (sessionId) => set({
      isSessionActive: true,
      sessionId,
      sessionStartTime: Date.now(),
      translationCount: 0,
    }),
    
    // Compound action to end a session
    endSession: () => set({
      isSessionActive: false,
      sessionId: null,
      sessionStartTime: null,
      // Keep translation count for reference
    }),
    
    // Reset all session data
    resetSession: () => set({
      isSessionActive: false,
      sessionId: null,
      sessionStartTime: null,
      translationCount: 0,
    }),
  }))
);

// Export individual selectors for optimized subscriptions
export const useIsSessionActive = () => useSessionStore((state) => state.isSessionActive);
export const useSessionId = () => useSessionStore((state) => state.sessionId);
export const useSessionStartTime = () => useSessionStore((state) => state.sessionStartTime);
export const useTranslationCount = () => useSessionStore((state) => state.translationCount);

// Export individual action selectors to avoid recreating objects
export const useSetIsSessionActive = () => useSessionStore((state) => state.setIsSessionActive);
export const useSetSessionId = () => useSessionStore((state) => state.setSessionId);
export const useSetSessionStartTime = () => useSessionStore((state) => state.setSessionStartTime);
export const useSetTranslationCount = () => useSessionStore((state) => state.setTranslationCount);
export const useIncrementTranslationCount = () => useSessionStore((state) => state.incrementTranslationCount);
export const useStartSession = () => useSessionStore((state) => state.startSession);
export const useEndSession = () => useSessionStore((state) => state.endSession);
export const useResetSession = () => useSessionStore((state) => state.resetSession);

// Export actions - use individual hooks and memoize to prevent recreating objects
export const useSessionActions = () => {
  const setIsSessionActive = useSetIsSessionActive();
  const setSessionId = useSetSessionId();
  const setSessionStartTime = useSetSessionStartTime();
  const setTranslationCount = useSetTranslationCount();
  const incrementTranslationCount = useIncrementTranslationCount();
  const startSession = useStartSession();
  const endSession = useEndSession();
  const resetSession = useResetSession();
  
  return useMemo(
    () => ({
      setIsSessionActive,
      setSessionId,
      setSessionStartTime,
      setTranslationCount,
      incrementTranslationCount,
      startSession,
      endSession,
      resetSession,
    }),
    [
      setIsSessionActive,
      setSessionId,
      setSessionStartTime,
      setTranslationCount,
      incrementTranslationCount,
      startSession,
      endSession,
      resetSession,
    ]
  );
};

// For backward compatibility with useSession hook
export const useSession = () => {
  const isSessionActive = useIsSessionActive();
  const sessionId = useSessionId();
  const sessionStartTime = useSessionStartTime();
  const translationCount = useTranslationCount();
  const actions = useSessionActions();
  
  return useMemo(
    () => ({
      isSessionActive,
      sessionId,
      sessionStartTime,
      translationCount,
      ...actions,
    }),
    [isSessionActive, sessionId, sessionStartTime, translationCount, actions]
  );
};

export default useSessionStore;