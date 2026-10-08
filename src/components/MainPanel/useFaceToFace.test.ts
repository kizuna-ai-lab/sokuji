import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useFaceToFace, earsLegend } from './useFaceToFace';

describe('useFaceToFace', () => {
  const pick = (selected: string) => useProviderStore.setState({
    selected,
    entries: { [selected]: { settings: {}, credentials: {}, pair: { source: 'ja', target: 'en' } } },
  } as never);
  beforeEach(() => {
    useAudioStore.setState({ mode: 'both', otherSide: 'beside' });
    useRoutingStore.setState({ faceToFaceSwap: false });
  });

  it('is offered and active under Soniox in Both, beside me, with my language and theirs', () => {
    pick('soniox');
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current).toEqual({ offered: true, active: true, swap: false, me: 'ja', other: 'en' });
  });

  it('is neither under a provider without it (Review Focus 1)', () => {
    pick('openai');
    const { result } = renderHook(() => useFaceToFace());
    expect(result.current).toMatchObject({ offered: false, active: false });
  });
});

describe('earsLegend', () => {
  const view = { offered: true, active: true, swap: false, me: 'ja', other: 'en' };
  it('puts my language in the left ear unless swapped', () => {
    expect(earsLegend(view, false)).toEqual({ leftLang: 'ja', rightLang: 'en', leftIsMe: true });
    expect(earsLegend({ ...view, swap: true }, false)).toEqual({ leftLang: 'en', rightLang: 'ja', leftIsMe: false });
  });
  it('is absent when face-to-face is off', () => {
    expect(earsLegend({ ...view, active: false }, false)).toBeNull();
  });
  it('is absent under Text Only: nothing plays in either ear', () => {
    expect(earsLegend(view, true)).toBeNull();
  });
});
