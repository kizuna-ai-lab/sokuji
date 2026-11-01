import { createContext, useContext } from 'react';
import type { HistoryStore } from '../history/store';

/** What the signed-in screens share: the account, its history, and the app's sign-in callbacks. */
export interface AppContextValue {
  token: string;
  email: string;
  /** The signed-in account's user id: the sessions on this phone are kept per account. */
  accountId: string;
  history: HistoryStore;
  onSignOut: () => void | Promise<void>;
  onAccountDeleted: () => void;
  /** The sign-in session is gone (a 401): the app drops the token and shows the sign-in screen. */
  onSignInRequired: () => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp outside the signed-in screens');
  return value;
}
