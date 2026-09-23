/**
 * The providers, in UI order (D19). One list: its order is the order the
 * picker shows, `ProviderId` is derived from it, and `isPresent` decides what
 * this build and platform offer.
 */
import { isPresent, type PresenceEnv } from '../lib/provider/presence';
import type { AnyProvider } from '../lib/provider/types';
import { enabledProviderIds, getEnvironment, isDevelopmentMode } from '../utils/environment';
import { fakeProvider } from './fake/provider';

/** Shipped providers, in UI order. Plan 1e adds LocalInference here first. */
const RELEASED = [] as const;
/** Compiled into development builds only (D24). */
const DEV_ONLY = [fakeProvider] as const;

export type ProviderId = (typeof RELEASED)[number]['id'] | (typeof DEV_ONLY)[number]['id'];

// `import.meta.env.DEV` itself, not `isDevelopmentMode()`: the literal is what
// a release build replaces with `false`, which drops the fake from the bundle.
export const PROVIDERS: readonly AnyProvider[] = import.meta.env.DEV ? [...RELEASED, ...DEV_ONLY] : [...RELEASED];

export function currentPresenceEnv(): PresenceEnv {
  return { platform: getEnvironment(), dev: isDevelopmentMode(), enabled: enabledProviderIds() };
}

/** The providers offered here, in UI order. */
export function presentProviders(env: PresenceEnv = currentPresenceEnv()): readonly AnyProvider[] {
  return PROVIDERS.filter((p) => isPresent(p, env));
}

export function getProvider(id: string): AnyProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
