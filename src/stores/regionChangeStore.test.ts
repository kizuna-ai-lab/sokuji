import { beforeEach, describe, expect, it } from 'vitest';
import { useRegionChangeStore, type RegionChangeQuestion } from './regionChangeStore';

const q = (to: 'jp' | 'eu' = 'jp'): RegionChangeQuestion => ({
  providerId: 'kizunaai_soniox', managed: true, from: 'us', to, warning: { kind: 'custom' },
});

beforeEach(() => useRegionChangeStore.setState({ question: null }));

describe('regionChangeStore', () => {
  it('holds the question until answered, then clears it', async () => {
    const p = useRegionChangeStore.getState().ask(q());
    expect(useRegionChangeStore.getState().question).toMatchObject({ to: 'jp' });
    useRegionChangeStore.getState().answer(true);
    await expect(p).resolves.toBe(true);
    expect(useRegionChangeStore.getState().question).toBeNull();
  });

  it('answers an open earlier question false when a new one is asked', async () => {
    const first = useRegionChangeStore.getState().ask(q('jp'));
    const second = useRegionChangeStore.getState().ask(q('eu'));
    await expect(first).resolves.toBe(false);
    expect(useRegionChangeStore.getState().question).toMatchObject({ to: 'eu' });
    useRegionChangeStore.getState().answer(false);
    await expect(second).resolves.toBe(false);
  });

  it('answer with nothing open is harmless', () => {
    expect(() => useRegionChangeStore.getState().answer(true)).not.toThrow();
  });
});
