import { describe, expect, it } from 'vitest';
import { isPresent } from '../../lib/provider/presence';
import { LOCAL_NATIVE_DEBUG_KEY } from '../../utils/environment';
import { localNativeProvider } from './provider';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

const env = (over: Partial<Parameters<typeof isPresent>[1]> = {}) =>
  ({ platform: 'electron' as const, dev: false, enabled: new Set<string>(), kizuna: false, switchOn: () => false, ...over });

describe('localNativeProvider', () => {
  it("keeps the old enum's id and the old slice's storage prefix", () => {
    expect(localNativeProvider.id).toBe('local_native');
    expect(localNativeProvider.kind).toBe('local');
    expect(localNativeProvider.settings).toEqual({ key: 'localNative', defaults: LOCAL_NATIVE_DEFAULTS });
    expect(localNativeProvider.credentials.keys).toEqual([]);
  });

  it('is flagged, Electron only, and unlocked by its tester switch (#578 ruling 1)', () => {
    expect(localNativeProvider.flagged).toBe(true);
    expect(localNativeProvider.testerSwitch).toBe(LOCAL_NATIVE_DEBUG_KEY);
    expect(isPresent(localNativeProvider, env())).toBe(false);
    expect(isPresent(localNativeProvider, env({ switchOn: (k) => k === LOCAL_NATIVE_DEBUG_KEY }))).toBe(true);
    expect(isPresent(localNativeProvider, env({ enabled: new Set(['local_native']) }))).toBe(true);
    expect(isPresent(localNativeProvider, env({ platform: 'web', dev: true }))).toBe(false);
  });

  it('speaks optionally, takes typed text, decides its own boundaries, and offers both turn modes', () => {
    expect(localNativeProvider.speech).toBe('optional');
    expect(localNativeProvider.textInput(LOCAL_NATIVE_DEFAULTS)).toBe(true);
    expect(localNativeProvider.boundaries(LOCAL_NATIVE_DEFAULTS)).toBe('provider');
    expect(localNativeProvider.turns(LOCAL_NATIVE_DEFAULTS)).toEqual(['auto', 'manual']);
    expect(localNativeProvider.session?.admit).toBeTypeOf('function');
    expect(localNativeProvider.Engine).toBeTypeOf('function');
    expect(localNativeProvider.EngineSummary).toBeTypeOf('function');
    expect(localNativeProvider.watchReadiness).toBeTypeOf('function');
  });
});
