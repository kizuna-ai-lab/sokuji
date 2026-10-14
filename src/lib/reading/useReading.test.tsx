import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let pieces: unknown = null;
const listeners = new Set<() => void>();
const requestReading = vi.fn();
vi.mock('./annotate', () => ({
  peekReading: () => pieces,
  requestReading: (...args: unknown[]) => requestReading(...args),
  subscribeReading: (_t: string, _l: string, listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  holdLastReading: (ps: { text: string; reading?: string }[]) => ps.map((p, i) => (i === ps.length - 1 ? { text: p.text } : p)),
}));
const { useReading } = await import('./useReading');

describe('useReading', () => {
  it('asks for what it lacks, then shows it when told', () => {
    pieces = null;
    const { result } = renderHook(() => useReading('雨', 'ja', false));
    expect(result.current).toBeNull();
    expect(requestReading).toHaveBeenCalledWith('雨', 'ja');
    pieces = [{ text: '雨', reading: 'あめ' }];
    act(() => listeners.forEach((l) => l()));
    expect(result.current).toEqual([{ text: '雨', reading: 'あめ' }]);
  });

  it('holds back the last reading when asked', () => {
    pieces = [{ text: '雨', reading: 'あめ' }];
    const { result } = renderHook(() => useReading('雨', 'ja', true));
    expect(result.current).toEqual([{ text: '雨' }]);
  });

  it('is null and asks for nothing without a language', () => {
    requestReading.mockClear();
    const { result } = renderHook(() => useReading('rain', null, false));
    expect(result.current).toBeNull();
    expect(requestReading).not.toHaveBeenCalled();
  });
});
