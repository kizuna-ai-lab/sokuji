import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFaceToFace, earsLegend, voicedEars, type FaceToFaceView } from './useFaceToFace';

describe('useFaceToFace', () => {
  const pick = (selected: string) => useProviderStore.setState({
    selected,
    entries: { [selected]: { settings: {}, credentials: {}, pair: { source: 'ja', target: 'en' } } },
  } as never);
  beforeEach(() => {
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    useRoutingStore.setState({ faceToFaceSwap: false, participantSpeech: false });
    useSettingsStore.setState({ textOnly: false });
  });

  it('is offered and active under Soniox in Both, beside me, with my language and theirs', () => {
    pick('soniox');
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current).toEqual({ offered: true, active: true, swap: false, me: 'ja', other: 'en', speaks: { speaker: true, participant: true } });
  });

  it('is neither under a provider without it (Review Focus 1)', () => {
    pick('openai');
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current).toMatchObject({ offered: false, active: false });
  });

  // The run's own rule (`participantSpeechFromStores`): face-to-face voices the other person whatever the hidden switch says.
  it('voices both legs face-to-face with the participant switch off, and neither under Text Only', () => {
    pick('soniox');
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current.speaks).toEqual({ speaker: true, participant: true });
    act(() => { useSettingsStore.setState({ textOnly: true }); });
    expect(result.current.speaks).toEqual({ speaker: false, participant: false });
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

describe('earsLegend', () => {
  const view: FaceToFaceView = { offered: true, active: true, swap: false, me: 'ja', other: 'en', speaks: { speaker: true, participant: true } };
  it('puts my language in the left ear unless swapped', () => {
    expect(earsLegend(view)).toEqual({ leftLang: 'ja', rightLang: 'en', leftIsMe: true });
    expect(earsLegend({ ...view, swap: true })).toEqual({ leftLang: 'en', rightLang: 'ja', leftIsMe: false });
  });
  it('is absent when face-to-face is off', () => {
    expect(earsLegend({ ...view, active: false })).toBeNull();
  });
  it('is absent under Text Only: nothing plays in either ear', () => {
    expect(earsLegend({ ...view, speaks: { speaker: false, participant: false } })).toBeNull();
  });
  it("names the ear of a silent leg: mine when the participant's leg is silent", () => {
    const silent = { ...view, speaks: { speaker: true, participant: false } };
    expect(earsLegend(silent)).toEqual({ leftLang: 'ja', rightLang: 'en', leftIsMe: true, silent: 'left' });
    expect(earsLegend({ ...silent, swap: true })).toEqual({ leftLang: 'en', rightLang: 'ja', leftIsMe: false, silent: 'right' });
  });
});

describe('voicedEars', () => {
  const view: FaceToFaceView = { offered: true, active: true, swap: false, me: 'ja', other: 'en', speaks: { speaker: true, participant: true } };
  it('gives each voiced leg its ear', () => {
    expect(voicedEars(view)).toEqual({ speaker: 'right', participant: 'left' });
    expect(voicedEars({ ...view, swap: true })).toEqual({ speaker: 'left', participant: 'right' });
  });
  it('gives a silent leg none', () => {
    expect(voicedEars({ ...view, speaks: { speaker: true, participant: false } })).toEqual({ speaker: 'right' });
  });
  it('is absent outside face-to-face, and when no leg is voiced', () => {
    expect(voicedEars({ ...view, active: false })).toBeNull();
    expect(voicedEars({ ...view, speaks: { speaker: false, participant: false } })).toBeNull();
  });
});
