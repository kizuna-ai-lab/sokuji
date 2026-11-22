// src/components/SettingsPage/accountRows.ts
//
// Which row of Accounts and keys holds a provider's key or sign-in, and the navigation target that lands on that row
// (the owner, 2026-11-17: a link about one provider's key went to the page's top, or opened the row of the provider
// the session runs on).
import { caps } from '../../lib/lineup/catalog';

// The target itself is made where a notice's action is: the page reads it here.
export { providerOfTarget, providerTarget } from '../../lib/view/providerTarget';

/** The OpenAI services share one key, so one row; OpenAI's text models use it too. */
export const OPENAI_IDS: readonly string[] = ['openai', 'openai_translate', 'openai_live', 'openai_text'];
/** Gemini Live and Gemini's text models share one key, so one row. */
export const GEMINI_IDS: readonly string[] = ['gemini', 'gemini_text'];

/** The row that holds a provider's key or sign-in: the hosted services are Kizuna AI's sign-in. */
export function accountKeyOf(providerId: string): string {
  if (OPENAI_IDS.includes(providerId)) return 'openai';
  if (GEMINI_IDS.includes(providerId)) return 'gemini';
  if (caps(providerId)?.account === 'kizuna') return 'kizuna';
  return providerId;
}

/** A row's anchor: its element's id is `<anchor>-section`. Kizuna AI's keeps the one the account links already use. */
export function accountAnchor(key: string): string {
  return key === 'kizuna' ? 'user-account' : `account-${key}`;
}
