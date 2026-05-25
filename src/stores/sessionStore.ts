import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { useMemo } from 'react';
import type { ConversationItem } from '../services/interfaces/IClient';

export type LockedFooterMode = 'speaker' | 'participant' | 'both';

interface SessionStore {
  // State
  isSessionActive: boolean;
  sessionId: string | null;
  sessionStartTime: number | null;
  translationCount: number;
  isReconnecting: boolean;
  items: ConversationItem[];
  participantItems: ConversationItem[];
  // Footer mode snapshot captured at session start. While non-null the
  // mode picker (and any consumer of "effective mode") reads this so
  // mid-session mute toggles don't visually change the locked mode.
  // Settings panel uses it too to decide which channel sections are
  // editable during the session.
  lockedMode: LockedFooterMode | null;
  // Monotonic counter — every call to requestClearConversation bumps it.
  // MainPanel watches this version and runs its local clearConversation
  // routine when it changes, so any consumer (subtitle bar, main toolbar)
  // can trigger a clear without holding a direct reference to MainPanel.
  clearConversationVersion: number;

  // Actions
  setIsSessionActive: (active: boolean) => void;
  setSessionId: (id: string | null) => void;
  setSessionStartTime: (time: number | null) => void;
  setTranslationCount: (count: number) => void;
  incrementTranslationCount: () => void;
  setIsReconnecting: (reconnecting: boolean) => void;
  setItems: (items: ConversationItem[]) => void;
  setParticipantItems: (items: ConversationItem[]) => void;
  setLockedMode: (mode: LockedFooterMode | null) => void;
  requestClearConversation: () => void;

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
    isReconnecting: false,
    items: [],
    participantItems: [],
    lockedMode: null,
    clearConversationVersion: 0,

    // Basic setters
    setIsSessionActive: (active) => set({ isSessionActive: active }),
    setSessionId: (id) => set({ sessionId: id }),
    setSessionStartTime: (time) => set({ sessionStartTime: time }),
    setTranslationCount: (count) => set({ translationCount: count }),
    setIsReconnecting: (reconnecting) => set({ isReconnecting: reconnecting }),
    setItems: (items) => set({ items }),
    setParticipantItems: (participantItems) => set({ participantItems }),
    setLockedMode: (mode) => set({ lockedMode: mode }),
    requestClearConversation: () => set((state) => ({
      clearConversationVersion: state.clearConversationVersion + 1,
    })),

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
      isReconnecting: false,
      items: [],
      participantItems: [],
      lockedMode: null,
      // Keep translation count for reference
    }),

    // Reset all session data
    resetSession: () => set({
      isSessionActive: false,
      sessionId: null,
      sessionStartTime: null,
      translationCount: 0,
      isReconnecting: false,
      items: [],
      participantItems: [],
      lockedMode: null,
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
export const useIsReconnecting = () => useSessionStore((state) => state.isReconnecting);
export const useSetIsReconnecting = () => useSessionStore((state) => state.setIsReconnecting);
export const useStartSession = () => useSessionStore((state) => state.startSession);
export const useEndSession = () => useSessionStore((state) => state.endSession);
export const useResetSession = () => useSessionStore((state) => state.resetSession);
export const useItems = () => useSessionStore((state) => state.items);
export const useParticipantItems = () => useSessionStore((state) => state.participantItems);
export const useSetItems = () => useSessionStore((state) => state.setItems);
export const useSetParticipantItems = () => useSessionStore((state) => state.setParticipantItems);
export const useLockedMode = () => useSessionStore((state) => state.lockedMode);
export const useSetLockedMode = () => useSessionStore((state) => state.setLockedMode);
export const useClearConversationVersion = () => useSessionStore((state) => state.clearConversationVersion);
export const useRequestClearConversation = () => useSessionStore((state) => state.requestClearConversation);

// Export actions - use individual hooks and memoize to prevent recreating objects
export const useSessionActions = () => {
  const setIsSessionActive = useSetIsSessionActive();
  const setSessionId = useSetSessionId();
  const setSessionStartTime = useSetSessionStartTime();
  const setTranslationCount = useSetTranslationCount();
  const incrementTranslationCount = useIncrementTranslationCount();
  const setIsReconnecting = useSetIsReconnecting();
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
      setIsReconnecting,
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
      setIsReconnecting,
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
  const isReconnecting = useIsReconnecting();
  const actions = useSessionActions();

  return useMemo(
    () => ({
      isSessionActive,
      sessionId,
      sessionStartTime,
      translationCount,
      isReconnecting,
      ...actions,
    }),
    [isSessionActive, sessionId, sessionStartTime, translationCount, isReconnecting, actions]
  );
};

export default useSessionStore;