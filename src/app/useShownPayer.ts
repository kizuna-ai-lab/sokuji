/**
 * The wallet the account surfaces show (the title bar's balance, Accounts and keys' Kizuna AI row and its panel), one
 * rule for all so they never disagree: idle, the payer switch; during a run, the payer the run was started with —
 * another window can flip the switch, and a running session keeps what it was granted. A run started with no payer
 * (not an organization member then) shows none: who pays it is not the switch's to say.
 */
import { useAccountPayer } from '../lib/session/payerChoice';
import type { AccountState, Payer } from '../lib/session/types';
import { useRunState } from './useRun';

export function useShownPayer(account: AccountState | null | undefined): Payer | undefined {
  const live = useAccountPayer(account);
  const run = useRunState();
  return run.phase === 'idle' ? live : run.payer;
}
