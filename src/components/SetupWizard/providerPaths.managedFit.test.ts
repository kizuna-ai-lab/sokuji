/**
 * The managed card used to be offered for every scenario, while the own-key
 * list beside it greyed out providers that could not serve the chosen one —
 * so a build whose managed provider cannot run subtitles-only would offer
 * "start right away" and then hand the user a session it refuses to start.
 * Raised by Codex on #444.
 *
 * Unreachable in the shipping build (Kizuna Soniox is 'optional', which fits
 * every scenario) and reachable in one that ships a different managed twin:
 * each has its own gate precisely so it can be released alone. This file is
 * that build.
 */
import { describe, it, expect, vi } from 'vitest';

// Kizuna on, Soniox OFF, Translate ON: getDefaultManagedProvider falls through
// to OpenAI Translate, whose textOnlyCapability is 'never'.
vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isKizunaSonioxEnabled: () => false,
  isKizunaOpenAITranslateEnabled: () => true,
  isKizunaVolcengineAST2Enabled: () => false,
  isPalabraAIEnabled: () => true,
  isLocalNativeEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
  getRelayWsUrl: () => 'wss://r.example/v1',
}));

const { Provider } = await import('../../types/Provider');
const { managedProvider, managedOption, availablePaths } = await import('./providerPaths');

describe('the managed path answers for the scenario, like every other card', () => {
  it('still offers the path — the card is the only way to reach the managed provider', () => {
    expect(managedProvider()).toBe(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
    expect(availablePaths()).toContain('managed');
  });

  it('reports the provider as unfit for a scenario it cannot serve', () => {
    // subtitle-myself and two-way-text both ask the speaker leg to stay silent,
    // which a 'never' provider cannot do.
    expect(managedOption('subtitle-myself')).toMatchObject({
      id: Provider.KIZUNA_AI_OPENAI_TRANSLATE,
      fit: { ok: false, reason: 'cannot-be-text-only' },
    });
    expect(managedOption('two-way-text')?.fit.ok).toBe(false);
  });

  it('reports it fit for the scenarios it can serve', () => {
    expect(managedOption('understand-others')?.fit).toEqual({ ok: true });
    expect(managedOption('be-heard')?.fit).toEqual({ ok: true });
    expect(managedOption('two-way-voice')?.fit).toEqual({ ok: true });
  });
});
