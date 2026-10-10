import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';
const environment = vi.hoisted(() => ({ value: 'web' as 'web' | 'electron' | 'extension' }));
vi.mock('../../utils/environment', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../utils/environment')>()), getEnvironment: () => environment.value }));
import { useFaceToFace, earsLegend, voicedEars, type FaceToFaceView } from './useFaceToFace';

describe('useFaceToFace', () => {
  const pick = (selected: string) => useProviderStore.setState({
    selected,
    entries: { [selected]: { settings: {}, credentials: {}, pair: { source: 'ja', target: 'en' } } },
  } as never);
  beforeEach(() => {
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    useRoutingStore.setState({ participantSpeech: null });
    useAudioStore.setState({ audioMonitorDevices: [{ deviceId: 'out-1', label: 'AirPods Pro' }] as never, selectedMonitorDevice: { deviceId: 'out-1', label: 'AirPods Pro' } as never, outlets: { other: { device: null, channel: 'auto' }, me: { device: null, channel: 'auto' }, them: { device: null, channel: 'auto' } }, isMonitorMuted: true });
    useSettingsStore.setState({ textOnly: false });
    environment.value = 'web';
    useAudioStore.setState({ participantCaptureWidened: false, selectedParticipantSource: null });
  });

  it('is offered and active under Soniox in Both, beside me, with my language and theirs', () => {
    pick('soniox');
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current).toEqual({ offered: true, active: true, me: 'ja', other: 'en', speaks: { speaker: true, participant: true }, ears: { speaker: 'right', participant: 'left' }, outletDevices: { other: 'AirPods Pro', them: 'AirPods Pro' } });
  });

  it('is neither under a provider without it (Review Focus 1)', () => {
    pick('openai');
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current).toMatchObject({ offered: false, active: false });
  });

  it('voices both legs face-to-face on auto; Text Only silences mine, the switch theirs', () => {
    pick('soniox');
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current.speaks).toEqual({ speaker: true, participant: true });
    act(() => { useSettingsStore.setState({ textOnly: true }); });
    expect(result.current.speaks).toEqual({ speaker: false, participant: true });
    act(() => { useRoutingStore.setState({ participantSpeech: false }); });
    expect(result.current.speaks).toEqual({ speaker: false, participant: false });
  });

  it('follows an application capture that widens to the whole system, live', () => {
    pick('soniox');
    environment.value = 'electron';
    useAudioStore.setState({ otherSide: 'meeting', selectedParticipantSource: { deviceId: 'app:42', label: 'App' } });
    useRoutingStore.setState({ participantSpeech: true });
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current.speaks.participant).toBe(true);
    act(() => { useAudioStore.setState({ participantCaptureWidened: true }); });
    expect(result.current.speaks.participant).toBe(false);
  });

  it('reads the ears and the devices from the outlets, live', () => {
    pick('soniox');
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current.ears).toEqual({ speaker: 'right', participant: 'left' });
    act(() => { useAudioStore.getState().setOutletChannel('them', 'both'); useAudioStore.getState().setOutletDevice('other', 'out-1'); });
    expect(result.current.ears).toEqual({ speaker: 'right' });
    expect(result.current.outletDevices).toEqual({ other: 'AirPods Pro', them: 'AirPods Pro' });
  });

  it('voices both legs under Kizuna AI too, now that its participant speaks', () => {
    pick('kizunaai_soniox');
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current.active).toBe(true);
    expect(result.current.speaks).toEqual({ speaker: true, participant: true });
  });

  it("in a meeting, follows the participant's switch, live", () => {
    pick('soniox');
    useAudioStore.setState({ otherSide: 'meeting' });
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current.speaks.participant).toBe(false);
    act(() => { useRoutingStore.setState({ participantSpeech: true }); });
    expect(result.current.speaks.participant).toBe(true);
  });
});

const view: FaceToFaceView = { offered: true, active: true, me: 'ja', other: 'en', speaks: { speaker: true, participant: true }, ears: { speaker: 'right', participant: 'left' }, outletDevices: { other: 'AirPods Pro', them: 'AirPods Pro' } };

describe('earsLegend', () => {
  it('one entry per voiced leg, the left ear first, each with its device', () => {
    expect(earsLegend(view)).toEqual([
      { who: 'me', lang: 'ja', ear: 'left', device: 'AirPods Pro' },
      { who: 'other', lang: 'en', ear: 'right', device: 'AirPods Pro' },
    ]);
    expect(earsLegend({ ...view, ears: { speaker: 'left', participant: 'right' } })![0]).toMatchObject({ who: 'other', ear: 'left' });
  });
  it('centred outlets: entries without ears, me first (Review Focus 1)', () => {
    expect(earsLegend({ ...view, ears: {} })).toEqual([
      { who: 'me', lang: 'ja', device: 'AirPods Pro' },
      { who: 'other', lang: 'en', device: 'AirPods Pro' },
    ]);
  });
  it('leaves out a silent leg, and is absent when nothing is voiced or outside face-to-face', () => {
    expect(earsLegend({ ...view, speaks: { speaker: true, participant: false } })).toEqual([{ who: 'other', lang: 'en', ear: 'right', device: 'AirPods Pro' }]);
    expect(earsLegend({ ...view, speaks: { speaker: false, participant: false } })).toBeNull();
    expect(earsLegend({ ...view, active: false })).toBeNull();
  });
});

describe('voicedEars', () => {
  it('gives each voiced leg its ear, and none to a centred outlet (Review Focus 1)', () => {
    expect(voicedEars(view)).toEqual({ speaker: 'right', participant: 'left' });
    expect(voicedEars({ ...view, ears: { participant: 'left' } })).toEqual({ participant: 'left' });
    expect(voicedEars({ ...view, speaks: { speaker: true, participant: false } })).toEqual({ speaker: 'right' });
  });
  it('is absent outside face-to-face, and when no leg is voiced', () => {
    expect(voicedEars({ ...view, active: false })).toBeNull();
    expect(voicedEars({ ...view, speaks: { speaker: false, participant: false } })).toBeNull();
  });
});
