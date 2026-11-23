import { describe, expect, it, vi } from 'vitest';
import { fakeNativeModels } from '../../lib/local-inference/native/nativeModels.testing';
import { fakeLocalModels } from '../../lib/local-inference/selection/localModels.testing';
import { capabilitiesAlone } from '../../lib/plan/wholeUnit';
import { isPresent } from '../../lib/provider/presence';
import { LOCAL_NATIVE_DEBUG_KEY } from '../../utils/environment';
import type { LocalNativeConfig } from './config';
import { ONE_SIDE_AT_A_TIME } from './config';
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
    const caps = capabilitiesAlone(localNativeProvider, 'transcription');
    expect(caps).toMatchObject({ speech: 'optional', textInput: true, boundaries: 'provider', turns: ['auto', 'manual'] });
    expect(localNativeProvider.session?.admit).toBeTypeOf('function');
    expect(localNativeProvider.Engine).toBeTypeOf('function');
    expect(localNativeProvider.watchReadiness).toBeTypeOf('function');
  });

  it('declares its whole session as its one unit, which speaks optionally', () => {
    expect(localNativeProvider.units.map((u) => u.id)).toEqual(['whole']);
  });

  it('asks the native models it is handed when it watches (#578 ruling 18)', () => {
    const off = vi.fn();
    const watch = vi.fn(() => off);
    const onChange = vi.fn();
    expect(localNativeProvider.watchReadiness?.(onChange, fakeLocalModels(), fakeNativeModels({ watch }))).toBe(off);
    expect(watch).toHaveBeenCalledWith(onChange);
  });

  it('admit refuses two legs and admits one (#578 ruling 4)', () => {
    const one = {} as LocalNativeConfig;
    const shared = {} as never;
    expect(localNativeProvider.session?.admit?.({ speaker: one }, shared)).toBe(true);
    expect(localNativeProvider.session?.admit?.({ participant: one }, shared)).toBe(true);
    expect(localNativeProvider.session?.admit?.({ speaker: one, participant: one }, shared)).toEqual({ refused: ONE_SIDE_AT_A_TIME });
  });
});
