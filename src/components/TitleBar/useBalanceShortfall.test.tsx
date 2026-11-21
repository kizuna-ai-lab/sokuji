import { describe, it, expect, beforeEach, onTestFinished, vi } from 'vitest';
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
import { useLineUpStore } from '../../stores/lineUpStore';
import { runsOn } from '../../stores/lineUpStore.testing';
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
    runsOn(null);
    useProviderStore.setState({ entries: {}, intent: undefined, readiness: {}, legs: ['speaker'] });
    useAudioStore.setState({ mode: 'speaker', otherSide: 'meeting', selectedParticipantSource: useAudioStore.getInitialState().selectedParticipantSource });
    useRoutingStore.setState({ participantSpeech: null });
    useSettingsStore.setState({ textOnly: false });
    useAccountStore.setState({ account: null });
  });

  it("is short below the selected provider's floor for these legs", () => {
    runsOn('kizunaai_soniox');
    useProviderStore.setState({
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
    runsOn('kizunaai_soniox');
    useProviderStore.setState({
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
    runsOn('kizunaai_soniox');
    useProviderStore.setState({
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
    runsOn('kizunaai_soniox');
    useProviderStore.setState({
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
    runsOn('kizunaai_soniox');
    useProviderStore.setState({
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
    runsOn('kizunaai_soniox');
    useProviderStore.setState({
      entries: { kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    });
    useAudioStore.setState({ mode: 'speaker' });

    useAccountStore.setState({ account: null });
    expect(renderHook(() => useBalanceShortfall()).result.current).toBe(false);

    useAccountStore.setState({ account: { status: 'loading' } });
    expect(renderHook(() => useBalanceShortfall()).result.current).toBe(false);

    useAccountStore.setState({ account: { status: 'unknown' } });
    expect(renderHook(() => useBalanceShortfall()).result.current).toBe(false);

    runsOn('soniox');
    useProviderStore.setState({
      entries: { soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    });
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 0, frozen: false } });
    expect(renderHook(() => useBalanceShortfall()).result.current).toBe(false);

    runsOn('kizunaai_soniox');
    useProviderStore.setState({
      entries: { kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    });
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 0, frozen: true } });
    expect(renderHook(() => useBalanceShortfall()).result.current).toBe(false);
  });

  it("is short below the floor of Kizuna AI's Soniox voice alone, though the text runs on the user's own key", () => {
    useProviderStore.setState({
      entries: {
        soniox: { settings: SONIOX_DEFAULTS, credentials: { apiKey: 'k' }, pair: { source: 'ja', target: 'en' } },
        kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } },
      },
    });
    const before = useLineUpStore.getState();
    onTestFinished(() => useLineUpStore.setState({ lineUp: before.lineUp, stored: before.stored }));
    useLineUpStore.setState({ lineUp: { transcription: 'soniox', translation: 'soniox', speech: 'kizunaai_soniox', summarisation: null }, stored: true, unstoredProvider: null });
    useAudioStore.setState({ mode: 'speaker' });
    // The one speech stream's floor: a whole speaking session's would be 12 500.
    const floor = sonioxRolesFloorMicroUsd(['spk_tts']);
    expect(floor).toBe(4_167);
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: floor - 1, frozen: false } });
    const { result } = renderHook(() => useBalanceShortfall());
    expect(result.current).toBe(true);
    expect(liveGate('electron')?.code).toBe('balance_below_floor');
    act(() => {
      useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: floor, frozen: false } });
    });
    expect(result.current).toBe(false);
    expect(liveGate('electron')).toBeNull();
    // Text only: no voice is leased, so no balance is short.
    act(() => {
      useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 0, frozen: false } });
      useSettingsStore.setState({ textOnly: true });
    });
    expect(result.current).toBe(false);
  });

  it('finds the plan as the live gate does: nothing before the line-up store has loaded, then the provider that runs', () => {
    runsOn(null);
    useProviderStore.setState({
      entries: { kizunaai_soniox: { settings: SONIOX_DEFAULTS, credentials: {}, pair: { source: 'ja', target: 'en' } } },
    });
    useAudioStore.setState({ mode: 'speaker' });
    useAccountStore.setState({ account: { status: 'known', balanceMicroUsd: 1_000, frozen: false } });
    // No fallback to the first provider offered: the dot and Start agree that nothing is known yet.
    expect(renderHook(() => useBalanceShortfall()).result.current).toBe(false);
    expect(liveGate()).toBeNull();
    runsOn('kizunaai_soniox');
    expect(renderHook(() => useBalanceShortfall()).result.current).toBe(true);
    expect(liveGate()?.code).toBe('balance_below_floor');

    runsOn(null);
    useProviderStore.setState({ entries: {} });
    expect(renderHook(() => useBalanceShortfall()).result.current).toBe(false);
    expect(liveGate()).toBeNull();
  });
});
