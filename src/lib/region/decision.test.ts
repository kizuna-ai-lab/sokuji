import { describe, it, expect } from 'vitest';
import { decideRegion } from './decision';

const R = ['us', 'eu', 'jp', 'in'];
describe('decideRegion', () => {
  it('recommends at a 50 ms gain, not at 49', () => {
    expect(decideRegion(R, { us: 63, eu: 200, jp: 13, in: 136 }, 'us')).toEqual({ kind: 'recommend', region: 'jp' });
    expect(decideRegion(R, { us: 62, eu: 200, jp: 13, in: 136 }, 'us')).toEqual({ kind: 'no-change' });
  });
  it('recommends the best when the current region is unmeasured; nothing when best is current or tied', () => {
    expect(decideRegion(R, { us: null, eu: 240, jp: 13, in: null }, 'us')).toEqual({ kind: 'recommend', region: 'jp' });
    expect(decideRegion(R, { us: 177, eu: 240, jp: 13, in: 136 }, 'jp')).toEqual({ kind: 'no-change' });
    expect(decideRegion(['sg', 'cn'], { sg: 80, cn: 80 }, 'sg')).toEqual({ kind: 'no-change' });
  });
  it('every region unmeasured is unmeasured', () => {
    expect(decideRegion(R, { us: null, eu: null, jp: null, in: null }, 'us')).toEqual({ kind: 'unmeasured' });
  });
  it('a region missing from the medians counts as unmeasured', () => {
    expect(decideRegion(R, {}, 'us')).toEqual({ kind: 'unmeasured' });
  });
});
