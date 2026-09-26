/**
 * The providers, in UI order (D19). One list: its order is the order the
 * picker shows, `ProviderId` is derived from it, and `isPresent` decides what
 * this build and platform offer.
 */
import { isPresent, type PresenceEnv } from '../lib/provider/presence';
import type { AnyProvider } from '../lib/provider/types';
import { debugSwitchOn, enabledProviderIds, getEnvironment, isDevelopmentMode, isKizunaAIEnabled } from '../utils/environment';
import { fakeLeasedProvider } from './fake/leased';
import { fakeProvider } from './fake/provider';
import { localInferenceProvider } from './localInference/provider';

/** Shipped providers, in UI order (ruling 10: LocalInference first). */
const RELEASED = [localInferenceProvider] as const;
/** Compiled into development builds only (D24): the fake, and the leased fake that carries the session hooks (Stage 2 foundation, choice 1). */
const DEV_ONLY = [fakeProvider, fakeLeasedProvider] as const;

export type ProviderId = (typeof RELEASED)[number]['id'] | (typeof DEV_ONLY)[number]['id'];

// `import.meta.env.DEV` itself, not `isDevelopmentMode()`: the literal is what
// a release build replaces with `false`, which drops the fake from the bundle.
export const PROVIDERS: readonly AnyProvider[] = import.meta.env.DEV ? [...RELEASED, ...DEV_ONLY] : [...RELEASED];

export function currentPresenceEnv(): PresenceEnv {
  return { platform: getEnvironment(), dev: isDevelopmentMode(), enabled: enabledProviderIds(), kizuna: isKizunaAIEnabled(), switchOn: debugSwitchOn };
}

/** The providers offered here, in UI order. */
export function presentProviders(env: PresenceEnv = currentPresenceEnv()): readonly AnyProvider[] {
  return PROVIDERS.filter((p) => isPresent(p, env));
}

export function getProvider(id: string): AnyProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
