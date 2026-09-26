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
import { useProviderStore } from '../../stores/providerStore';
import { ownProps, useSelectedProvider } from './useSelectedProvider';

beforeEach(() => {
  useProviderStore.setState({ entries: {}, readiness: {}, models: {}, selected: 'fake', legs: ['speaker'] });
});

describe('ownProps', () => {
  it("hands a provider's components its settings, update, lock, pair and the models its readiness found", () => {
    useProviderStore.setState({
      selected: 'fake',
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } },
      models: { fake: [{ id: 'm1' }] },
    });
    const { result } = renderHook(() => useSelectedProvider([fakeProvider]));
    const props = ownProps(result.current!, result.current!.entry!, true);
    expect(props).toMatchObject({ settings: FAKE_DEFAULTS, disabled: true, pair: { source: 'en', target: 'ja' }, models: [{ id: 'm1' }] });
    expect(props.update).toBe(result.current!.update);
  });

  it('gives the same empty list while no answer has models', () => {
    useProviderStore.setState({
      entries: { fake: { settings: FAKE_DEFAULTS, credentials: {}, pair: { source: 'en', target: 'ja' } } },
      models: {},
    });
    const { result, rerender } = renderHook(() => useSelectedProvider([fakeProvider]));
    const first = ownProps(result.current!, result.current!.entry!, false).models;
    rerender();
    const second = ownProps(result.current!, result.current!.entry!, false).models;
    expect(second).toBe(first);
    expect(first).toHaveLength(0);
  });
});
