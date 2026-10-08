import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import { useRoutingStore } from '../../stores/routingStore';
import { useFaceToFace } from './useFaceToFace';

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
