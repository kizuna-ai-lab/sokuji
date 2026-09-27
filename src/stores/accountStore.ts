/**
 * The signed-in account's wallet as last fetched, for code outside React:
 * the start gate's balance floor (Stage 2 Kizuna Soniox, ruling 5;
 * choice 8). `UserProfileProvider` writes it: null while signed out;
 * `loading` until the first fetch lands; `unknown` once a fetch failed
 * with no wallet known; else the wallet as last fetched.
 */
import { create } from 'zustand';
import type { AccountState } from '../lib/session/types';

interface AccountStore {
  account: AccountState | null;
  setAccount(account: AccountState | null): void;
}

export const useAccountStore = create<AccountStore>()((set) => ({
  account: null,
  setAccount: (account) => set({ account }),
}));
