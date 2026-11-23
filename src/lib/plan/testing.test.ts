import { describe, expect, it, vi } from 'vitest';
import { FAKE_WHOLE, fakeProvider } from '../../providers/fake/provider';
import { stubProvider, withWhole } from './testing';
import { unitsOf } from './wholeUnit';

describe('testing fixtures', () => {
  it('withWhole: a part goes to the whole unit, any other member to the provider', () => {
    const start = vi.fn();
    const p = withWhole(fakeProvider, FAKE_WHOLE, { start, id: 'other' });
    expect(p.id).toBe('other');
    expect(unitsOf(p).map((u) => u.id)).toEqual(['whole']);
    expect(unitsOf(p)[0].start).toBe(start);
    expect(unitsOf(p)[0].describe).toBe(FAKE_WHOLE.describe);
  });
  it('withWhole: refuses a part beside units, which would lose it', () => {
    expect(() => withWhole(fakeProvider, FAKE_WHOLE, { units: [], start: vi.fn() })).toThrow(/start/);
  });
  it('stubProvider: its whole unit is made of the members it is given, and it carries none of them', () => {
    const p = stubProvider('x', { speech: 'always', kind: 'managed' });
    expect(unitsOf(p)[0].capabilities(undefined).speech).toBe('always');
    expect(p).toMatchObject({ id: 'x', kind: 'managed' });
    expect(p).not.toHaveProperty('speech');
  });
});
