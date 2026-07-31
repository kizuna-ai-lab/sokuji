import { describe, it, expect } from 'vitest';
import { SonioxSideTracker } from './SonioxSideTracker';

// Channel A = mic = 'speaker' side; channel B = far end = 'participant'.
describe('SonioxSideTracker', () => {
  it('returns an energy verdict for a window where one channel dominates', () => {
    const t = new SonioxSideTracker();
    t.recordFrame(500, 0);   // frame 0: 0-100 ms, A hot
    t.recordFrame(0, 500);   // frame 1: 100-200 ms, B hot
    expect(t.inferSide(undefined, 0, 100)).toEqual({ side: 'speaker', tier: 'energy' });
    expect(t.inferSide(undefined, 100, 200)).toEqual({ side: 'participant', tier: 'energy' });
  });

  it('spans multi-frame windows and uses summed energy', () => {
    const t = new SonioxSideTracker();
    t.recordFrame(100, 0);
    t.recordFrame(400, 30);
    expect(t.inferSide(undefined, 0, 200)).toEqual({ side: 'speaker', tier: 'energy' }); // 500 vs 30
  });

  it('returns null on ambiguous energy (ratio < 2x), silence, or missing timing', () => {
    const t = new SonioxSideTracker();
    t.recordFrame(100, 60);  // 100 < 2*60 → ambiguous
    t.recordFrame(0, 0);     // silence
    expect(t.inferSide(undefined, 0, 100)).toBeNull();
    expect(t.inferSide(undefined, 100, 200)).toBeNull();
    expect(t.inferSide(undefined, undefined, undefined)).toBeNull();
  });

  it('treats a window entirely outside the retained ring as a miss', () => {
    const t = new SonioxSideTracker({ capacity: 2 });
    t.recordFrame(500, 0);   // frame 0 — will be evicted
    t.recordFrame(500, 0);   // frame 1
    t.recordFrame(500, 0);   // frame 2 → ring keeps frames 1-2
    expect(t.inferSide(undefined, 0, 100)).toBeNull();               // frame 0 evicted
    expect(t.inferSide(undefined, 200, 300)).not.toBeNull();         // frame 2 retained
  });

  it('treats a window with an evicted head as a miss — no verdict from a partial window', () => {
    const t = new SonioxSideTracker({ capacity: 2 });
    t.recordFrame(0, 500);   // frame 0 — will be evicted
    t.recordFrame(500, 0);   // frame 1
    t.recordFrame(500, 0);   // frame 2 → ring keeps frames 1-2
    expect(t.inferSide(undefined, 0, 300)).toBeNull();               // head evicted → miss, even though 1-2 retained
    expect(t.inferSide(undefined, 100, 300)).toEqual({ side: 'speaker', tier: 'energy' }); // fully retained
  });

  it('defaults a missing endMs to one frame from startMs', () => {
    const t = new SonioxSideTracker();
    t.recordFrame(500, 0);
    expect(t.inferSide(undefined, 20, undefined)).toEqual({ side: 'speaker', tier: 'energy' });
  });

  it('establishes a label after net >= 2 energy-backed votes, then answers by label on ambiguous energy', () => {
    const t = new SonioxSideTracker();
    t.recordFrame(0, 500);   // frame 0: B hot
    t.recordFrame(0, 500);   // frame 1: B hot
    t.recordFrame(300, 300); // frame 2: ambiguous
    expect(t.inferSide('2', 0, 100)).toEqual({ side: 'participant', tier: 'energy' });   // vote → net -1
    expect(t.inferSide('2', 100, 200)).toEqual({ side: 'participant', tier: 'label' });  // vote → net -2, established in the same call
    expect(t.inferSide('2', 200, 300)).toEqual({ side: 'participant', tier: 'label' });  // ambiguous energy → label memory
  });

  it('does not answer by label before establishment; energy governs and can erode a wrong early vote', () => {
    const t = new SonioxSideTracker();
    t.recordFrame(0, 500);   // frame 0: B hot — spurious vote for label '1'
    t.recordFrame(500, 0);   // frame 1: A hot
    t.recordFrame(500, 0);   // frame 2: A hot
    t.recordFrame(500, 0);   // frame 3: A hot
    expect(t.inferSide('1', 0, 100)).toEqual({ side: 'participant', tier: 'energy' }); // net -1
    expect(t.inferSide('1', 100, 200)).toEqual({ side: 'speaker', tier: 'energy' });   // net 0
    expect(t.inferSide('1', 200, 300)).toEqual({ side: 'speaker', tier: 'energy' });   // net +1
    expect(t.inferSide('1', 300, 400)).toEqual({ side: 'speaker', tier: 'label' });    // net +2 — established
  });

  it('thin label memory yields to strong contrary energy; deep memory absorbs a single glitch', () => {
    const t = new SonioxSideTracker();
    // Barely established (net +2): one strong contrary verdict erodes it
    // below the threshold, so fresh energy governs the display (no lock-in).
    t.recordFrame(500, 0);   // frame 0: A hot
    t.recordFrame(500, 0);   // frame 1: A hot
    t.recordFrame(0, 500);   // frame 2: contrary energy
    t.inferSide('1', 0, 100);                                  // net +1
    t.inferSide('1', 100, 200);                                // net +2 — established
    expect(t.inferSide('1', 200, 300)).toEqual({ side: 'participant', tier: 'energy' }); // net erodes to +1
    // Deep history: net climbs back above the threshold with margin, so the
    // next single glitch (e.g. echo leakage) no longer flips the answer.
    t.recordFrame(500, 0);   // frame 3: A hot
    t.recordFrame(500, 0);   // frame 4: A hot
    t.recordFrame(0, 500);   // frame 5: glitch
    t.inferSide('1', 300, 400);                                // net +2
    t.inferSide('1', 400, 500);                                // net +3
    expect(t.inferSide('1', 500, 600)).toEqual({ side: 'speaker', tier: 'label' });      // net +2 — still established
  });

  it('a token with a speaker but no usable energy neither votes nor answers before establishment', () => {
    const t = new SonioxSideTracker();
    expect(t.inferSide('3', undefined, undefined)).toBeNull();
    expect(t.inferSide('3', 5000, 5100)).toBeNull(); // nothing recorded there
  });

  it('reset clears both the ring and the vote map', () => {
    const t = new SonioxSideTracker();
    t.recordFrame(0, 500);
    t.recordFrame(0, 500);
    t.inferSide('2', 0, 100);
    t.inferSide('2', 100, 200); // established
    t.reset();
    t.recordFrame(300, 300);
    expect(t.inferSide('2', 0, 100)).toBeNull(); // no label memory, ambiguous energy
  });
});
