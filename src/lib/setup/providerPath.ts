// src/lib/setup/providerPath.ts
//
// Which of the wizard's three paths a provider belongs to, read off the
// provider itself. A LEAF beyond the provider enum: no registry, no stores, so
// anything that needs the answer at runtime can ask for it.
//
// `settings.setup.providerPath` records the path the user picked at wizard
// time. It is history: Settings can change the provider afterwards, and every
// surface a tour step points at follows the LIVE provider. Deriving the path
// from that provider is the only way the two can never disagree.
import { Provider, isKizunaManagedProvider } from '../../types/Provider';
import type { ProviderType } from '../../types/Provider';
import type { ProviderPath } from './types';

/** The offline path's two flavours — the engines that run on the user's own
 *  machine. Also the list the wizard excludes from its own-key options. */
export const OFFLINE_PROVIDERS: readonly ProviderType[] = [Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE];

export function providerPathFor(provider: ProviderType): ProviderPath {
  if (isKizunaManagedProvider(provider)) return 'managed';
  if (OFFLINE_PROVIDERS.includes(provider)) return 'offline';
  return 'own-key';
}
