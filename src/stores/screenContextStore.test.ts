import { beforeEach, describe, expect, it, vi } from 'vitest';
import { releaseScreenContext } from '../app/screenContext';
import type { CaptureSourceInfo } from '../lib/screen/desktopFrames';
import { useScreenContextStore, type PickedSource } from './screenContextStore';

const SLIDES: CaptureSourceInfo = { id: 'window:1', name: 'Slides', kind: 'window', thumbnail: 'data:,', appIcon: null };
const store = () => useScreenContextStore.getState();

beforeEach(() => {
  useScreenContextStore.setState({ sampler: null, state: null, preparing: false, picked: null, pickSource: null });
});

describe('useScreenContextStore — the held pick (owner, 2026-10-22, rulings 1 and 4)', () => {
  it('holds nothing at first, then the pick it is given, and lets it go', () => {
    expect(store().picked).toBeNull();
    const pick: PickedSource = { kind: 'desktop', source: SLIDES };
    store().setPicked(pick);
    expect(store().picked).toBe(pick);
    store().setPicked({ kind: 'portal' });
    expect(store().picked).toEqual({ kind: 'portal' });
    store().setPicked(null);
    expect(store().picked).toBeNull();
  });

  it("keeps the pick across a run's end: releaseScreenContext empties the sampler, never the pick", () => {
    const pick: PickedSource = { kind: 'desktop', source: SLIDES };
    store().setPicked(pick);
    releaseScreenContext();
    expect(store().sampler).toBeNull();
    expect(store().state).toBeNull();
    expect(store().picked).toBe(pick);
  });

  it("holds the panel's picker for the settings to ask, and lets it go", async () => {
    expect(store().pickSource).toBeNull();
    const pickSource = vi.fn(async () => ({ kind: 'portal' }) as PickedSource);
    store().setPickSource(pickSource);
    await expect(store().pickSource!()).resolves.toEqual({ kind: 'portal' });
    store().setPickSource(null);
    expect(store().pickSource).toBeNull();
  });
});
