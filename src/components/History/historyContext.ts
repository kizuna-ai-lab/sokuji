// src/components/History/historyContext.ts
//
// What the History page hands its screens: its store, and the way out of History.
import { createContext, useContext } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { HistoryPageActions, HistoryPageState } from '../../lib/history/historyPageStore';

export interface HistoryPageContextValue {
  store: StoreApi<HistoryPageState & HistoryPageActions>;
  onClose(): void;
}

export const HistoryPageContext = createContext<HistoryPageContextValue | null>(null);

export function useHistoryPageContext(): HistoryPageContextValue {
  const value = useContext(HistoryPageContext);
  if (!value) throw new Error('A History screen is used outside the History page');
  return value;
}
