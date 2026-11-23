import { describe, it, expect } from 'vitest';
import { DetectorLeg } from './turn-detector-leg';
import type { DetectorNotice, DetectorOutput } from './turn-detector-protocol';

const pcm = (n: number) => new Int16Array(n).fill(1000);

/** A manual leg: every press is one segment, and no VAD is needed. */
function leg() {
  const posted: DetectorOutput[] = [];
  const notices: DetectorNotice[] = [];
  const l = new DetectorLeg({
    core: { turns: 'manual', vad: {}, limit: {} },
    post: (msg) => posted.push(msg),
    notify: (n) => notices.push(n),
  });
  const press = async (id: number, samples = 2400) => {
    l.begin(id);
    l.push(pcm(samples));
    l.drain();
    await l.core.idle();
  };
  const segments = () => posted.filter((m) => m.type === 'segment');
  return { l, posted, notices, press, segments };
}

describe('DetectorLeg', () => {
  it('a decode-queue failure followed by an input overload posts one notice', async () => {
    const { l, notices, press, segments } = leg();
    for (let p = 1; p <= 6; p++) await press(p); // nobody takes: the sixth waits behind five
    expect(notices.filter((n) => n.type === 'failed')).toHaveLength(1);
    expect(notices[0]).toMatchObject({ type: 'failed', code: 'turn_detection_overloaded' });
    const before = segments().length;
    l.push(pcm(24000 * 3)); // far past the 2 s input bound
    await l.core.idle();
    expect(notices.filter((n) => n.type === 'failed')).toHaveLength(1);
    expect(segments()).toHaveLength(before);
  });

  it('an input overload followed by a decode-queue failure posts one notice too', async () => {
    const { l, notices, press } = leg();
    l.push(pcm(24000 * 3));
    await l.core.idle();
    expect(notices).toHaveLength(1);
    for (let p = 1; p <= 6; p++) await press(p);
    expect(notices).toHaveLength(1);
  });

  it('after the first failure fed audio makes no segment and no speech_start', async () => {
    const { l, posted, notices, press } = leg();
    for (let p = 1; p <= 6; p++) await press(p);
    const count = posted.length;
    await press(7);
    l.push(pcm(2400));
    l.drain();
    await l.core.idle();
    expect(posted).toHaveLength(count);
    expect(notices.map((n) => n.type)).toEqual(['failed']);
  });

  it('taken acknowledgements keep a leg that decodes as fast as it hears from failing', async () => {
    const { l, notices, press, posted } = leg();
    for (let p = 1; p <= 12; p++) {
      await press(p);
      const seg = posted.filter((m) => m.type === 'segment').pop()!;
      l.taken({ type: 'taken', epoch: seg.epoch, seq: seg.seq });
    }
    expect(notices).toEqual([]);
  });
});
