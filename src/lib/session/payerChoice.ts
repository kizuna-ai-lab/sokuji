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

export function getUseOwnBalance(): boolean {
  try {
    return localStorage.getItem(USE_OWN_BALANCE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setUseOwnBalance(on: boolean): void {
  try {
    localStorage.setItem(USE_OWN_BALANCE_KEY, String(on));
  } catch {
    // Storage is unavailable: the switch reads off, the organization pays.
  }
  for (const listener of listeners) listener();
}

/** Calls `listener` whenever the switch is set; for code outside React that must follow it (the start gate). */
export function subscribeUseOwnBalance(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
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

/** The balance and frozen flag of the wallet the chosen payer spends; a non-member's is the account's own. */
export function payerBalance(account: Extract<AccountState, { status: 'known' }>): { microUsd: number; frozen: boolean } {
  switch (chosenPayer(account)) {
    case 'organization': {
      const org = account.organization!;
      return { microUsd: org.availableMicroUsd, frozen: org.frozen };
    }
    case 'personal': {
      const own = account.personal;
      return { microUsd: own?.balanceMicroUsd ?? 0, frozen: own?.frozen ?? false };
    }
    default:
      return { microUsd: account.balanceMicroUsd, frozen: account.frozen };
  }
}
