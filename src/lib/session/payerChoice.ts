/**
 * Who pays for a session a member of an organization starts: the
 * organization (the default) or the member's own balance. The choice is one
 * switch, off by default, remembered on this device only. It is read once,
 * when a request is built (at Start, or at a voice `ensure`), and sent as
 * `payer`; flipping it mid-session changes nothing for a running one. A
 * non-member has no choice: no `payer` is sent and nothing changes for them.
 */
import { useSyncExternalStore } from 'react';
import type { AccountState, Payer, PayerWallets } from './types';

export type { Payer };

export const USE_OWN_BALANCE_KEY = 'sokuji.payer.useOwnBalance';

const listeners = new Set<() => void>();

/**
 * The choice the storage could not hold (a private window, blocked or full storage): kept for this
 * document's life, so the switch still works; null while the storage holds it.
 */
let inMemory: boolean | null = null;

export function getUseOwnBalance(): boolean {
  if (inMemory !== null) return inMemory;
  try {
    return localStorage.getItem(USE_OWN_BALANCE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setUseOwnBalance(on: boolean): void {
  try {
    localStorage.setItem(USE_OWN_BALANCE_KEY, String(on));
    inMemory = null;
  } catch {
    inMemory = on;
  }
  for (const listener of listeners) listener();
}

/** Calls `listener` whenever the switch is set; for code outside React that must follow it (the start gate). */
export function subscribeUseOwnBalance(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// Another document of this origin (the extension's side panel and a full-page tab) set the switch: follow it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== USE_OWN_BALANCE_KEY) return;
    // Another document wrote a value for the switch, so the storage holds the choice again. A
    // clear (`key === null`) or a removal (`newValue === null`) is no choice: a switch kept in
    // memory because this document could not write it stays as the user set it.
    if (event.key === USE_OWN_BALANCE_KEY && event.newValue !== null) inMemory = null;
    for (const listener of listeners) listener();
  });
}

/** The switch as a React value. */
export function useUseOwnBalance(): boolean {
  return useSyncExternalStore(subscribeUseOwnBalance, getUseOwnBalance);
}

/** `undefined` for a non-member (no organization in the wallet): no choice, no `payer`. Otherwise `personal` while the switch is on, else `organization`. */
export function chosenPayer(wallets: PayerWallets | null | undefined): Payer | undefined {
  if (!wallets?.organization) return undefined;
  return getUseOwnBalance() ? 'personal' : 'organization';
}

/** `chosenPayer` over the account as the start gate holds it; none unless the wallet is known. */
export function accountPayer(account: AccountState | null | undefined): Payer | undefined {
  return account?.status === 'known' ? chosenPayer(account) : undefined;
}

/** The payer the next Start sends, following the switch; for a component that shows or checks the wallet it will spend. */
export function useAccountPayer(account: AccountState | null | undefined): Payer | undefined {
  // Subscribed, so the payer follows the switch; `accountPayer` reads the value the subscription just saw.
  useUseOwnBalance();
  return accountPayer(account);
}
