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
import { setUseOwnBalance } from '../../lib/session/payerChoice';
import { useAccountStore } from '../../stores/accountStore';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { sonioxRolesFloorMicroUsd } from '../../providers/soniox/kizunaBudget';
import { liveGate } from '../../lib/session/appShape';
import { useBalanceShortfall } from './useBalanceShortfall';

/**
 * The account button's dot, through the start gate (Stage 2 Kizuna Soniox,
 * choice 9): the same computation over the same stores as Start, so the two
 * never disagree.
 */
describe('useBalanceShortfall', () => {
  beforeEach(() => {
    useProviderStore.setState({ entries: {}, intent: undefined, readiness: {}, selected: null, legs: ['speaker'] });
    useAudioStore.setState({ mode: 'speaker', otherSide: 'meeting', selectedParticipantSource: useAudioStore.getInitialState().selectedParticipantSource });
    useRoutingStore.setState({ participantSpeech: null });
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
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 12_499, frozen: false } });
    const { result } = renderHook(() => useBalanceShortfall());
    expect(result.current).toBe(true);

    act(() => {
      useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 12_500, frozen: false } });
    });
    expect(result.current).toBe(false);
  });

  it("follows a member's payer switch", () => {
    useProviderStore.setState({
      selected: 'kizunaai_soniox',
      entries: { kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    });
    localStorage.clear();
    useAccountStore.setState({ account: {
      status: 'known', balanceMicroUsd: 0, frozen: false,
      organization: { name: 'Acme', availableMicroUsd: 0, frozen: false }, personal: { balanceMicroUsd: 5_000_000, frozen: false },
    } });
    const { result } = renderHook(() => useBalanceShortfall());
    expect(result.current).toBe(true);
    act(() => setUseOwnBalance(true));
    expect(result.current).toBe(false);
    act(() => setUseOwnBalance(false));
    expect(result.current).toBe(true);
    localStorage.clear();
  });

  it('does not flag a low balance for a personal payer whose wallet is not known', () => {
    useProviderStore.setState({
      selected: 'kizunaai_soniox',
      entries: { kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    });
    localStorage.clear();
    setUseOwnBalance(true);
    useAccountStore.setState({ account: {
      status: 'known', balanceMicroUsd: 0, frozen: false,
      organization: { name: 'Acme', availableMicroUsd: 0, frozen: false },
    } });
    const { result } = renderHook(() => useBalanceShortfall());
    expect(result.current).toBe(false);
    localStorage.clear();
  });

  it('follows text only and the mode', () => {
    useProviderStore.setState({
      selected: 'kizunaai_soniox',
      entries: { kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    });
    useAudioStore.setState({ mode: 'speaker' });
    // Between the text-only floor (8 334) and the speaking floor (12 500); split Both text only is 16 667.
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 10_000, frozen: false } });
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

  it('prices face-to-face as one shared stream with both voices, like the start gate', () => {
    useProviderStore.setState({
      selected: 'kizunaai_soniox',
      entries: { kizunaai_soniox: { settings: { ...SONIOX_DEFAULTS, bothModeSharedSession: false }, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    });
    // Both sets reach the $1.00/h cap, so their floors are equal; the boundary
    // below is what pins face-to-face to its own set.
    const faceToFace = sonioxRolesFloorMicroUsd(['mix_stt', 'mix_tts', 'par_tts']);
    const meeting = sonioxRolesFloorMicroUsd(['spk_stt', 'spk_tts', 'par_stt']);
    expect(faceToFace).toBe(meeting);
    useAudioStore.setState({ mode: 'both', otherSide: 'meeting' });
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: meeting, frozen: false } });
    const { result } = renderHook(() => useBalanceShortfall());
    expect(result.current).toBe(false);
    expect(liveGate('electron')).toBeNull();

    act(() => {
      useAudioStore.setState({ otherSide: 'beside' });
      useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: faceToFace - 1, frozen: false } });
    });
    expect(result.current).toBe(true);
    expect(liveGate('electron')).not.toBeNull();

    act(() => {
      useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: faceToFace, frozen: false } });
    });
    expect(result.current).toBe(false);
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
