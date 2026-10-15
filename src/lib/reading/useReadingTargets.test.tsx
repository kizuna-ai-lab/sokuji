import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProviderStore } from '../../stores/providerStore';
import { currentReadingTarget, useReadingTargets } from './useReadingTargets';

const choose = (target: string | null) => useProviderStore.setState({
  selected: target ? 'soniox' : null,
  entries: target ? { soniox: { pair: { source: 'zh', target } } } : {},
} as never);

describe('the current reading target', () => {
  it("is the selected provider's pair target, and its reading languages", () => {
    choose('ja');
    expect(currentReadingTarget()).toBe('ja');
    const { result } = renderHook(() => useReadingTargets());
    expect([...result.current]).toEqual(['ja']);
    act(() => choose('zh+en'));
    expect([...result.current]).toEqual(['zh']);
    act(() => choose(null));
    expect(result.current.size).toBe(0);
  });
});
