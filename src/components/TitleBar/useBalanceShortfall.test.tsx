import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

import { SONIOX_DEFAULTS } from '../../providers/soniox/settings';
import { useAccountStore } from '../../stores/accountStore';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { liveGate } from '../../lib/session/appShape';
import { useBalanceShortfall } from './useBalanceShortfall';

/**
 * The account button's dot, through the start gate (Stage 2 Kizuna Soniox,
 * choice 9): the same computation over the same stores as Start, so the two
 * never disagree.
 */
describe('useBalanceShortfall', () => {
  beforeEach(() => {
    useProviderStore.setState({ entries: {}, readiness: {}, selected: null, legs: ['speaker'] });
    useAudioStore.setState({ mode: 'speaker', selectedParticipantSource: useAudioStore.getInitialState().selectedParticipantSource });
    useRoutingStore.setState({ participantSpeech: false });
    useSettingsStore.setState({ textOnly: false });
    useAccountStore.setState({ account: null });
  });

  it("is short below the selected provider's floor for these legs", () => {
    useProviderStore.setState({
      selected: 'kizunaai_soniox',
      entries: { kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    });
    useAudioStore.setState({ mode: 'speaker' });
    useSettingsStore.setState({ textOnly: false });
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 41_666, frozen: false } });
    const { result } = renderHook(() => useBalanceShortfall());
    expect(result.current).toBe(true);

    act(() => {
      useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 41_667, frozen: false } });
    });
    expect(result.current).toBe(false);
  });

  it('follows text only and the mode', () => {
    useProviderStore.setState({
      selected: 'kizunaai_soniox',
      entries: { kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    });
    useAudioStore.setState({ mode: 'speaker' });
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 20_000, frozen: false } });
    const { result, rerender } = renderHook(() => useBalanceShortfall());
    expect(result.current).toBe(true);

    act(() => {
      useSettingsStore.setState({ textOnly: true });
    });
    rerender();
    expect(result.current).toBe(false);

    act(() => {
      useSettingsStore.setState({ textOnly: true });
      useAudioStore.setState({ mode: 'both' });
      useProviderStore.setState({
        entries: {
          kizunaai_soniox: {
            settings: { ...SONIOX_DEFAULTS, bothModeSharedSession: false },
            credentials: {},
            pair: { source: 'ja', target: 'en' },
          },
        },
      });
    });
    rerender();
    expect(result.current).toBe(true);
  });

  it('is never short signed out, for a wallet loading or unknown, an own-key provider, or a frozen wallet', () => {
    useProviderStore.setState({
      selected: 'kizunaai_soniox',
      entries: { kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    });
    useAudioStore.setState({ mode: 'speaker' });

    useAccountStore.setState({ account: null });
    expect(renderHook(() => useBalanceShortfall()).result.current).toBe(false);

    useAccountStore.setState({ account: { status: 'loading' } });
    expect(renderHook(() => useBalanceShortfall()).result.current).toBe(false);

    useAccountStore.setState({ account: { status: 'unknown' } });
    expect(renderHook(() => useBalanceShortfall()).result.current).toBe(false);

    useProviderStore.setState({
      selected: 'soniox',
      entries: { soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    });
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 0, frozen: false } });
    expect(renderHook(() => useBalanceShortfall()).result.current).toBe(false);

    useProviderStore.setState({
      selected: 'kizunaai_soniox',
      entries: { kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    });
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 0, frozen: true } });
    expect(renderHook(() => useBalanceShortfall()).result.current).toBe(false);
  });

  it('finds the provider as the live gate does: before the load selects one, the first present', () => {
    useProviderStore.setState({
      selected: null,
      entries: { kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    });
    useAudioStore.setState({ mode: 'speaker' });
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 1_000, frozen: false } });
    expect(renderHook(() => useBalanceShortfall()).result.current).toBe(true);
    expect(liveGate()?.code).toBe('balance_below_floor');

    useProviderStore.setState({ selected: null, entries: {} });
    expect(renderHook(() => useBalanceShortfall()).result.current).toBe(false);
    expect(liveGate()).toBeNull();
  });
});
