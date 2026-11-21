import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { sonioxProvider } from '../../providers/soniox/provider';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import { runsOn } from '../../stores/lineUpStore.testing';
import { ownProps, useProviderEntry, useStageProvider } from './useProviderEntry';

beforeEach(() => {
  useLineUpStore.setState({ lineUp: null, stored: false, unstoredProvider: null });
  useProviderStore.setState({ entries: {}, intent: undefined, readiness: {}, models: {}, legs: ['speaker'] });
});

describe('useProviderEntry', () => {
  it('shows a provider before its entry has loaded, and loads it', () => {
    const realLoad = useProviderStore.getState().load;
    const load = vi.fn(async () => {});
    useProviderStore.setState({ entries: {}, load });
    const { result } = renderHook(() => useProviderEntry(sonioxProvider));
    expect(result.current!.provider).toBe(sonioxProvider);
    expect(result.current!.entry).toBeUndefined();
    expect(load).toHaveBeenCalledWith(sonioxProvider);
    useProviderStore.setState({ load: realLoad });
  });

  it('is null without a provider, and loads nothing', () => {
    const realLoad = useProviderStore.getState().load;
    const load = vi.fn(async () => {});
    useProviderStore.setState({ load });
    expect(renderHook(() => useProviderEntry(undefined)).result.current).toBeNull();
    expect(load).not.toHaveBeenCalled();
    useProviderStore.setState({ load: realLoad });
  });
});

describe('useStageProvider', () => {
  const offered = [fakeProvider, sonioxProvider];

  it('is undefined before the line-up store has loaded: no fallback to the first provider offered', () => {
    expect(renderHook(() => useStageProvider(offered, 'transcription')).result.current).toBeUndefined();
  });

  it('is the provider that runs while no line-up is stored, on every stage, before its entry has loaded', () => {
    runsOn('soniox');
    expect(renderHook(() => useStageProvider(offered, 'transcription')).result.current).toBe(sonioxProvider);
    expect(renderHook(() => useStageProvider(offered, 'speech')).result.current).toBe(sonioxProvider);
  });

  it("is the host of the stored line-up's option for the stage, whatever ran before it was stored", () => {
    useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'edge', summarisation: null }, stored: true, unstoredProvider: 'fake' });
    expect(renderHook(() => useStageProvider(offered, 'transcription')).result.current).toBe(sonioxProvider);
    // The local provider hosts Edge, and is not among the providers offered to this hook.
    expect(renderHook(() => useStageProvider(offered, 'speech')).result.current).toBeUndefined();
  });
});

describe('ownProps', () => {
  it("hands a provider's components its settings, update, lock, pair and the models its readiness found", () => {
    useProviderStore.setState({
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } },
      models: { fake: [{ id: 'm1' }] },
    });
    const { result } = renderHook(() => useProviderEntry(fakeProvider));
    const props = ownProps(result.current!, result.current!.entry!, true);
    expect(props).toMatchObject({ settings: FAKE_DEFAULTS, disabled: true, pair: { source: 'en', target: 'ja' }, models: [{ id: 'm1' }] });
    expect(props.update).toBe(result.current!.update);
  });

  it('gives the same empty list while no answer has models', () => {
    useProviderStore.setState({
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } },
      models: {},
    });
    const { result, rerender } = renderHook(() => useProviderEntry(fakeProvider));
    const first = ownProps(result.current!, result.current!.entry!, false).models;
    rerender();
    const second = ownProps(result.current!, result.current!.entry!, false).models;
    expect(second).toBe(first);
    expect(first).toHaveLength(0);
  });
});
