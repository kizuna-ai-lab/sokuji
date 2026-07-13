import { describe, it, expect } from 'vitest';
import { RequestRegistry } from './RequestRegistry';

describe('RequestRegistry', () => {
  it('resolves the pending promise for a matching id', async () => {
    const r = new RequestRegistry<string>();
    const p = r.create('a');
    r.resolve('a', 'done');
    await expect(p).resolves.toBe('done');
    expect(r.size).toBe(0); // settled entries are removed
  });

  it('rejects the pending promise for a matching id', async () => {
    const r = new RequestRegistry<string>();
    const p = r.create('a');
    r.reject('a', new Error('boom'));
    await expect(p).rejects.toThrow('boom');
    expect(r.size).toBe(0);
  });

  it('resolve/reject for an unknown id is a no-op', () => {
    const r = new RequestRegistry<string>();
    expect(() => r.resolve('missing', 'x')).not.toThrow();
    expect(() => r.reject('missing', new Error('x'))).not.toThrow();
    expect(r.size).toBe(0);
  });

  it('tracks multiple concurrent pending requests independently', async () => {
    const r = new RequestRegistry<number>();
    const a = r.create('a');
    const b = r.create('b');
    expect(r.size).toBe(2);
    r.resolve('b', 2);
    r.resolve('a', 1);
    await expect(a).resolves.toBe(1);
    await expect(b).resolves.toBe(2);
    expect(r.size).toBe(0);
  });

  it('rejectAll rejects every pending request and clears the map', async () => {
    const r = new RequestRegistry<number>();
    const a = r.create('a');
    const b = r.create('b');
    r.rejectAll(new Error('disposed'));
    await expect(a).rejects.toThrow('disposed');
    await expect(b).rejects.toThrow('disposed');
    expect(r.size).toBe(0);
  });
});
