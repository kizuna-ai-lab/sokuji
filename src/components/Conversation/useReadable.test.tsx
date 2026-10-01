import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Readable } from '../../lib/view/conversationView';
import { useReadable } from './useReadable';

function box<T>(initial: T): Readable<T> & { set(next: T): void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next) { value = next; listeners.forEach((listener) => listener()); },
  };
}

describe('useReadable', () => {
  it("returns the source's value and follows its changes", () => {
    const source = box(1);
    const { result } = renderHook(() => useReadable(source));
    expect(result.current).toBe(1);
    act(() => source.set(2));
    expect(result.current).toBe(2);
  });
});
