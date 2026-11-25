import { describe, it, expect, vi } from 'vitest';
import { DetectorLeg } from './turn-detector-leg';
import type { DetectorNotice, DetectorOutput, MarksOutput } from './turn-detector-protocol';

const pcm = (n: number) => new Int16Array(n).fill(1000);

/** A manual leg: every press is one segment, and no VAD is needed. */
function leg() {
  const posted: DetectorOutput[] = [];
  const notices: DetectorNotice[] = [];
  const l = new DetectorLeg({
    core: { turns: 'manual', vad: {}, limit: {} },
    post: (msg) => posted.push(msg as DetectorOutput),
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
  it('a stop that does not raise the epoch changes nothing: the press in hand is not lost', async () => {
    const { l, segments, press } = leg();
    l.begin(1);
    l.push(pcm(2400));
    l.stop(1); // INITIAL_EPOCH: not a raise
    l.push(pcm(2400));
    l.drain();
    await l.core.idle();
    expect(segments().map((m) => (m as { press?: number }).press)).toEqual([1]);
    void press;
  });

  it('a stop that raises it drops the press in hand', async () => {
    const { l, segments } = leg();
    l.begin(1);
    l.push(pcm(2400));
    l.stop(2);
    l.drain();
    await l.core.idle();
    expect(segments()).toEqual([]);
  });

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

/** An automatic leg whose Silero stub says "speech" (or throws), so speech_start would fire. */
function autoLeg(infer: (frame: Float32Array) => Promise<number>) {
  const posted: DetectorOutput[] = [];
  const notices: DetectorNotice[] = [];
  const l = new DetectorLeg({
    core: { turns: 'auto', vad: {}, limit: {}, infer, resetModel: () => {} },
    post: (msg) => posted.push(msg as DetectorOutput),
    notify: (n) => notices.push(n),
  });
  /** One second of speech, drained: a segment, which nobody takes. */
  const utterance = async () => {
    l.push(pcm(24000));
    l.drain();
    await l.core.idle();
  };
  return { l, posted, notices, utterance };
}

describe('DetectorLeg after a failure, with Silero in the loop', () => {
  const speech = async () => 0.9;

  it('speech_start fires before a failure (the stub is speech)', async () => {
    const { notices, utterance } = autoLeg(speech);
    await utterance();
    expect(notices.filter((n) => n.type === 'speech_start').length).toBeGreaterThan(0);
  });

  it('after a decode-queue failure fed audio gives no speech_start, segment, cancel or drained, and Silero is not asked again', async () => {
    const infer = vi.fn(speech);
    const { l, posted, notices, utterance } = autoLeg(infer);
    for (let i = 0; i < 6; i++) await utterance();
    expect(notices.filter((n) => n.type === 'failed')).toHaveLength(1);
    const asked = infer.mock.calls.length;
    const posts = posted.length;
    const noticeCount = notices.length;
    l.push(pcm(24000));
    l.begin(9);
    l.cancel(9);
    l.drain();
    await l.core.idle();
    expect(infer.mock.calls.length).toBe(asked);
    expect(posted).toHaveLength(posts);
    expect(notices).toHaveLength(noticeCount);
  });

  it('a Silero failure after ready posts one turn_detection_unavailable and nothing after it', async () => {
    let calls = 0;
    const infer = vi.fn(async () => {
      if (++calls > 5) throw new Error('session lost');
      return 0.9;
    });
    const { l, posted, notices } = autoLeg(infer);
    l.push(pcm(24000));
    await l.core.idle();
    const failed = notices.filter((n) => n.type === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ code: 'turn_detection_unavailable' });
    expect(notices[notices.length - 1]).toBe(failed[0]);
    const posts = posted.length;
    const asked = infer.mock.calls.length;
    l.push(pcm(24000 * 3)); // an overload too: still no second notice
    l.drain();
    l.begin(1);
    await l.core.idle();
    expect(notices.filter((n) => n.type === 'failed')).toHaveLength(1);
    expect(notices[notices.length - 1]).toBe(failed[0]);
    expect(posted).toHaveLength(posts);
    expect(infer.mock.calls.length).toBe(asked);
  });

  it('stop(epoch) after a failure does not throw and leaves the leg dead', async () => {
    const { l, notices, utterance } = autoLeg(speech);
    for (let i = 0; i < 6; i++) await utterance();
    const count = notices.length;
    l.stop(2);
    await utterance();
    expect(notices).toHaveLength(count);
  });
});

/** A manual leg that delivers audio and marks: what Voxtral 4B and Local Native take. */
function marksLeg() {
  const posted: Array<MarksOutput & { transfer: Transferable[] }> = [];
  const notices: DetectorNotice[] = [];
  const l = new DetectorLeg({
    core: { turns: 'manual', vad: {}, limit: {} },
    delivery: 'marks',
    post: (msg, transfer) => posted.push({ ...(msg as MarksOutput), transfer }),
    notify: (n) => notices.push(n),
  });
  /** The leg's output as one list: `mark:start`, then the sample counts between marks. */
  const trace = () => {
    const out: string[] = [];
    for (const m of posted) {
      if (m.type === 'mark') out.push(`mark:${m.event}`);
      else if (m.type === 'drained') out.push('drained');
      else if (out.length && /^\d+$/.test(out[out.length - 1])) out[out.length - 1] = String(Number(out[out.length - 1]) + m.pcm.length);
      else out.push(String(m.pcm.length));
    }
    return out;
  };
  return { l, posted, notices, trace };
}

describe('DetectorLeg with the marks delivery', () => {
  it('a press is audio, a start mark where the press began, the held key\'s audio, and an end mark where it ended', async () => {
    const { l, trace } = marksLeg();
    l.push(pcm(768));            // before the press: relayed as it came
    await l.core.idle();
    l.begin(1);
    l.push(pcm(1536));
    l.drain();
    await l.core.idle();
    await Promise.resolve();
    const t = trace();
    expect(t.indexOf('mark:start')).toBeGreaterThan(-1);
    expect(t.indexOf('mark:end')).toBeGreaterThan(t.indexOf('mark:start'));
    // The drain's answer comes last: the consumer then has every sample and the end mark.
    expect(t[t.length - 1]).toBe('drained');
    // Every sample that went in comes out once, in order: nothing is held back, copied twice or lost.
    const total = t.filter((x) => /^\d+$/.test(x)).reduce((a, x) => a + Number(x), 0);
    expect(total).toBe(768 + 1536);
  });

  it('a cancel of the open press is a cancel mark, and no segment is ever posted', async () => {
    const { l, posted, trace } = marksLeg();
    l.begin(1);
    l.push(pcm(1536));
    await l.core.idle();
    l.cancel(1);
    await l.core.idle();
    expect(trace()).toContain('mark:cancel');
    expect(posted.some((m) => (m as { type: string }).type === 'segment')).toBe(false);
  });

  it('hands over a copy of each chunk, transferred: the relay keeps views into the frame it holds', async () => {
    const { l, posted } = marksLeg();
    l.begin(1);
    l.push(pcm(1536));
    l.drain();
    await l.core.idle();
    await Promise.resolve();
    const audio = posted.filter((m) => m.type === 'audio');
    expect(audio.length).toBeGreaterThan(0);
    for (const m of audio) {
      const a = m as { type: 'audio'; pcm: Int16Array; transfer: Transferable[] };
      expect(a.transfer).toEqual([a.pcm.buffer]);
      expect(a.pcm.byteOffset).toBe(0);
      expect(a.pcm.buffer.byteLength).toBe(a.pcm.byteLength);
    }
  });

  it('a taken acknowledgement is ignored: there are no segments to free', async () => {
    const { l, notices } = marksLeg();
    l.begin(1);
    l.push(pcm(1536));
    l.drain();
    await l.core.idle();
    expect(() => l.taken({ type: 'taken', epoch: 1, seq: 1 })).not.toThrow();
    expect(notices).toEqual([]);
  });
});
