// src/components/SettingsPage/accountRows.ts
//
// Which row of Accounts and keys holds a provider's key or sign-in, and the navigation target that lands on that row
// (the owner, 2026-11-17: a link about one provider's key went to the page's top, or opened the row of the provider
// the session runs on).
import { caps } from '../../lib/lineup/catalog';

/** The OpenAI services share one key, so one row. */
export const OPENAI_IDS: readonly string[] = ['openai', 'openai_translate', 'openai_live'];

const PREFIX = 'provider:';

/** The target that opens Accounts and keys at this provider's row, its key shown. */
export function providerTarget(providerId: string): string {
  return `${PREFIX}${providerId}`;
}

/** The provider a `provider:<id>` target names; null for any other target. */
export function providerOfTarget(target: string | null | undefined): string | null {
  return target && target.startsWith(PREFIX) && target.length > PREFIX.length ? target.slice(PREFIX.length) : null;
}

/** The row that holds a provider's key or sign-in: the hosted services are Kizuna AI's sign-in. */
export function accountKeyOf(providerId: string): string {
  if (OPENAI_IDS.includes(providerId)) return 'openai';
  if (caps(providerId)?.account === 'kizuna') return 'kizuna';
  return providerId;
}

/** A row's anchor: its element's id is `<anchor>-section`. Kizuna AI's keeps the one the account links already use. */
export function accountAnchor(key: string): string {
  return key === 'kizuna' ? 'user-account' : `account-${key}`;
}
