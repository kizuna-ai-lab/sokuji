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

  it('keeps the previous pieces, the new text plain after them, while a growing row waits (R11)', () => {
    pieces = [{ text: '今日', reading: 'きょう' }];
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useReading(text, 'ja', false),
      { initialProps: { text: '今日' } },
    );
    expect(result.current).toEqual([{ text: '今日', reading: 'きょう' }]);
    pieces = null;
    rerender({ text: '今日は雨' });
    expect(result.current).toEqual([{ text: '今日', reading: 'きょう' }, { text: 'は雨' }]);
    rerender({ text: '今日は雨です' });
    expect(result.current).toEqual([{ text: '今日', reading: 'きょう' }, { text: 'は雨です' }]);
    pieces = [{ text: '今日', reading: 'きょう' }, { text: 'は' }, { text: '雨', reading: 'あめ' }, { text: 'です' }];
    act(() => listeners.forEach((l) => l()));
    expect(result.current).toEqual(pieces);
  });

  it('shows nothing kept for a text that does not start with the previous one', () => {
    pieces = [{ text: '今日', reading: 'きょう' }];
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useReading(text, 'ja', false),
      { initialProps: { text: '今日' } },
    );
    pieces = null;
    rerender({ text: '明日' });
    expect(result.current).toBeNull();
  });

  it('forgets the kept pieces when the language changes', () => {
    pieces = [{ text: '雨', reading: 'あめ' }];
    const { result, rerender } = renderHook(
      ({ text, lang }: { text: string; lang: 'ja' | 'zh' }) => useReading(text, lang, false),
      { initialProps: { text: '雨', lang: 'ja' } },
    );
    pieces = null;
    rerender({ text: '雨天', lang: 'zh' });
    expect(result.current).toBeNull();
    rerender({ text: '雨天です', lang: 'ja' });
    expect(result.current).toBeNull();
  });

  it('is null and asks for nothing without a language', () => {
    requestReading.mockClear();
    const { result } = renderHook(() => useReading('rain', null, false));
    expect(result.current).toBeNull();
    expect(requestReading).not.toHaveBeenCalled();
  });
});
