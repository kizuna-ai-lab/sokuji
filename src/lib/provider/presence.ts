import type { Platform, Provider } from './types';

export interface PresenceEnv {
  platform: Platform;
  /** A development build, which offers every flagged provider. */
  dev: boolean;
  /** `VITE_ENABLED_PROVIDERS`. */
  enabled: ReadonlySet<string>;
  /** The Kizuna umbrella flag (`isKizunaAIEnabled`): a managed provider is offered only where it is on (D19). */
  kizuna: boolean;
  /** Whether a tester switch (`Provider.testerSwitch`) is set on this device. */
  switchOn(key: string): boolean;
}

/**
 * Whether a provider is offered here (D19, F6): only on its platforms; a
 * managed provider only where the Kizuna umbrella is on; and a flagged one
 * only in a development build, when the release lists its id, or when its
 * tester switch is set.
 */
export function isPresent(
  p: Pick<Provider<unknown, never, never>, 'id' | 'kind' | 'platforms' | 'flagged' | 'testerSwitch'>,
  env: PresenceEnv,
): boolean {
  if (!p.platforms.includes(env.platform)) return false;
  if (p.kind === 'managed' && !env.kizuna) return false;
  if (!p.flagged || env.dev || env.enabled.has(p.id)) return true;
  return p.testerSwitch !== undefined && env.switchOn(p.testerSwitch);
}
