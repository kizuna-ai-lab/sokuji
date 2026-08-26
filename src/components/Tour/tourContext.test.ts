import { describe, it, expect } from 'vitest';
import { buildTourCtx } from './tourContext';
import { Provider } from '../../types/Provider';

const base = {
  record: null,
  provider: Provider.OPENAI,
  mode: 'speaker' as const,
  textOnly: false,
  isSignedIn: false,
  apiKeyValid: null,
};
const env = (over: Partial<{ isElectron: boolean; isExtension: boolean }>) => ({
  isElectron: false, isExtension: false, isLinux: false, isMacOS: false, isWindows: true, ...over,
});

describe('buildTourCtx platform', () => {
  it('reports electron, extension and — for a plain browser build — web', () => {
    // Three, not two: a dev build in a plain browser renders neither the
    // subtitle button nor anything else extension-only, so the steps that need
    // those surfaces must be able to exclude it by predicate.
    expect(buildTourCtx({ ...base, env: env({ isElectron: true }) }).platform).toBe('electron');
    expect(buildTourCtx({ ...base, env: env({ isExtension: true }) }).platform).toBe('extension');
    expect(buildTourCtx({ ...base, env: env({}) }).platform).toBe('web');
  });

  it('prefers electron when the environment claims both', () => {
    expect(buildTourCtx({ ...base, env: env({ isElectron: true, isExtension: true }) }).platform).toBe('electron');
  });
});

describe('buildTourCtx providerPath', () => {
  it('follows the live provider, not the path the setup record froze', () => {
    // The bug this replaced: a user who set up offline and later switched to
    // the managed provider from Settings still got the `models` step, whose
    // engine-chips anchor only ProviderSection's local branch renders. The
    // step waited out its anchor timeout and then skipped itself.
    const ctx = buildTourCtx({ ...base, record: { scenario: 'be-heard' }, provider: Provider.KIZUNA_AI_SONIOX, env: env({ isExtension: true }) });
    expect(ctx.providerPath).toBe('managed');
    expect(ctx.scenario).toBe('be-heard');
  });

  it('gives a migrated user, who recorded no path, the one their provider implies', () => {
    expect(buildTourCtx({ ...base, record: { scenario: null }, provider: Provider.LOCAL_NATIVE, env: env({}) }).providerPath).toBe('offline');
    expect(buildTourCtx({ ...base, record: null, provider: Provider.OPENAI, env: env({}) }).providerPath).toBe('own-key');
  });
});
