import type { Platform, Provider } from './types';

export interface PresenceEnv {
  platform: Platform;
  /** A development build, which offers every flagged provider. */
  dev: boolean;
  /** `VITE_ENABLED_PROVIDERS`. */
  enabled: ReadonlySet<string>;
}

/**
 * Whether a provider is offered here (D19): only on its platforms, and when
 * flagged only in a development build or when the release lists its id.
 */
export function isPresent(
  p: Pick<Provider<unknown, never, never>, 'id' | 'platforms' | 'flagged'>,
  env: PresenceEnv,
): boolean {
  if (!p.platforms.includes(env.platform)) return false;
  return !p.flagged || env.dev || env.enabled.has(p.id);
}
