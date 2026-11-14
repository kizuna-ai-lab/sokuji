import { describe, it, expect, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { setRegionMeasure } from '../../lib/region/measure';
import type { RegionMedians } from '../../lib/region/probe';
import { useRegionLatencyStore } from '../../stores/regionLatencyStore';
import { regionOptionLabel, useRegionLatencies } from './regionLatency';

const t = ((_key: string, fallback: string, values?: Record<string, unknown>) =>
  values ? fallback.replace(/\{\{(\w+)\}\}/g, (_, n: string) => String(values[n])) : fallback) as never;

describe('regionOptionLabel', () => {
  it('appends the measuring text, the milliseconds or unreachable, and leaves an unknown latency plain', () => {
    expect(regionOptionLabel(t, 'India', 'measuring')).toBe('India — measuring…');
    expect(regionOptionLabel(t, 'India', 177)).toBe('India — 177 ms');
    expect(regionOptionLabel(t, 'India', 'unreachable')).toBe('India — unreachable');
    expect(regionOptionLabel(t, 'India', undefined)).toBe('India');
  });
});

describe('useRegionLatencies', () => {
  it('is null with nothing cached, and measures on mount only when live', () => {
    const measure = vi.fn(() => new Promise<RegionMedians | null>(() => {}));
    setRegionMeasure(measure);
    const idle = renderHook(() => useRegionLatencies('soniox', false));
    expect(idle.result.current).toBeNull();
    expect(measure).not.toHaveBeenCalled();
    idle.unmount();
    const live = renderHook(() => useRegionLatencies('soniox', true));
    expect(measure).toHaveBeenCalledTimes(1);
    expect(Object.values(live.result.current ?? {})).toEqual(['measuring', 'measuring', 'measuring', 'measuring']);
  });

  it('reads the cached numbers, with unreachable for a null median', () => {
    act(() => useRegionLatencyStore.getState().fill('soniox', { us: 177, eu: 237, jp: 13, in: null }, Date.now()));
    const { result } = renderHook(() => useRegionLatencies('soniox', false));
    expect(result.current).toEqual({ us: 177, eu: 237, jp: 13, in: 'unreachable' });
  });

  it('reopening within 10 minutes reuses the numbers', () => {
    const measure = vi.fn(async (): Promise<RegionMedians | null> => ({ us: 1, eu: 2, jp: 3, in: 4 }));
    setRegionMeasure(measure);
    act(() => useRegionLatencyStore.getState().fill('soniox', { us: 1, eu: 2, jp: 3, in: 4 }, Date.now()));
    const a = render(<Probe />);
    a.unmount();
    render(<Probe />);
    expect(measure).not.toHaveBeenCalled();
  });
});

function Probe() {
  useRegionLatencies('soniox', true);
  return null;
}
