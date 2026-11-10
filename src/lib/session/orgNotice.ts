/**
 * Refusals that name an organization payer, and the wallet a payer spends.
 * Shared by the managed leases and the start gate, so it imports nothing
 * platform-bound.
 *
 * The client's codes: `org_balance_held` and `not_org_member` are the
 * server's own words; `org_insufficient_balance` is a 402 on a request that
 * the organization was to pay, and `org_wallet_frozen` a 403 whose body says
 * `subject: "organization"` (or the gate's frozen check on the organization).
 */
import type { AccountState, Payer } from './types';

export const ORG_BALANCE_HELD = 'org_balance_held';
export const ORG_INSUFFICIENT_BALANCE = 'org_insufficient_balance';
export const NOT_ORG_MEMBER = 'not_org_member';
export const ORG_WALLET_FROZEN = 'org_wallet_frozen';

export type OrgRefusalCode = typeof ORG_BALANCE_HELD | typeof ORG_INSUFFICIENT_BALANCE | typeof NOT_ORG_MEMBER | typeof ORG_WALLET_FROZEN;

/** The codes whose refusal says the organization's wallet changed, so the quota is stale. */
export const ORG_REFUSAL_CODES: ReadonlySet<string> = new Set([ORG_BALANCE_HELD, ORG_INSUFFICIENT_BALANCE, NOT_ORG_MEMBER, ORG_WALLET_FROZEN]);

/** `name` and `role` for the notice's words, each only when known; none when the account holds no organization (a stale quota), so the words fall back. */
export function orgNoticeParams(account: AccountState | null | undefined): Record<string, string> | undefined {
  if (account?.status !== 'known' || !account.organization) return undefined;
  const { name, role } = account.organization;
  const params = { ...(name ? { organization: name } : {}), ...(role ? { role } : {}) };
  return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * The organization's client code for a lease refusal, or null when it is not
 * one. `payer` is what the request carried, never the live switch.
 */
export function orgRefusalCode(status: number, body: unknown, payer: Payer | undefined): OrgRefusalCode | null {
  const b = (body ?? {}) as { reason?: unknown; code?: unknown; subject?: unknown };
  if (status === 402) {
    if (b.reason === 'org_balance_held') return ORG_BALANCE_HELD;
    return payer === 'organization' ? ORG_INSUFFICIENT_BALANCE : null;
  }
  if (status === 403) {
    if (b.code === 'not_org_member') return NOT_ORG_MEMBER;
    if (b.subject === 'organization') return ORG_WALLET_FROZEN;
  }
  return null;
}

/** The organization balance to show: its actual balance when the server sends it, else what is available. The start gate never reads this. */
export function orgDisplayBalance(org: { availableMicroUsd: number; committedBalanceMicroUsd?: number }): number {
  return org.committedBalanceMicroUsd ?? org.availableMicroUsd;
}

/** What running sessions hold of the organization's balance (committed less available); 0 when the server sends no committed figure or nothing is held. */
export function orgHeldMicroUsd(org: { availableMicroUsd: number; committedBalanceMicroUsd?: number }): number {
  return org.committedBalanceMicroUsd === undefined ? 0 : Math.max(0, org.committedBalanceMicroUsd - org.availableMicroUsd);
}

/** What the title bar shows for `payer`: `payerBalance`, except an organization payer shows its committed balance. */
export function payerDisplayBalance(account: Extract<AccountState, { status: 'known' }>, payer: Payer | undefined): number | undefined {
  if (payer === 'organization' && account.organization) return orgDisplayBalance(account.organization);
  return payerBalance(account, payer).microUsd;
}

/**
 * The balance and frozen flag of the wallet `payer` spends (the one a run chose at Start, not the live switch); a non-member, with no payer, spends the account's own.
 * `microUsd` is undefined for a personal payer whose wallet the account does not hold (the response carried none usable): no balance is made up, and the server checks that wallet.
 */
export function payerBalance(account: Extract<AccountState, { status: 'known' }>, payer: Payer | undefined): { microUsd: number | undefined; frozen: boolean } {
  switch (payer) {
    case 'organization': {
      const org = account.organization;
      return org ? { microUsd: org.availableMicroUsd, frozen: org.frozen } : { microUsd: account.balanceMicroUsd, frozen: account.frozen };
    }
    case 'personal': {
      const own = account.personal;
      return { microUsd: own?.balanceMicroUsd, frozen: own?.frozen ?? false };
    }
    default:
      return { microUsd: account.balanceMicroUsd, frozen: account.frozen };
  }
}
