import { describe, expect, it, vi } from 'vitest';
import type { FrameReason, FrameSource } from '../contract/adapter';
import { createVirtualClock, type Clock, type VirtualClock } from '../contract/clock';
import { FIRST_FRAME_MS, KEEPALIVE_MS, MAX_BYTES, QUALITIES, SAMPLE_MS, createSampler, type Capture, type Picture } from './sampler';

const report = vi.hoisted(() => ({ reportWarning: vi.fn() }));
vi.mock('../diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../diagnostics/report')>()),
  reportWarning: report.reportWarning,
}));

// ---- fixtures ---------------------------------------------------------------------------------

function solid(value: number, width = 640): Picture {
  const height = Math.round((width * 9) / 16);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([value, value, value, 255], i * 4);
  return { rgba, width, height };
}

/**
 * A grey gradient left to right, lifted by 10 per unit of `seed`: `lit(1)` and `lit(2)` are 10 grey
 * levels apart (past the change threshold of 6), `lit(1)` and `lit(1.1)` one (under it). Never blank.
 * 640 wide unless a test needs the size cap: the fake encoder's bytes scale with the width.
 */
function lit(seed: number, width = 640): Picture {
  const height = Math.round((width * 9) / 16);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.round(20 + (x / width) * 100 + seed * 10);
      rgba.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return { rgba, width, height };
}

const BLACK = solid(0);
const FLAT = solid(40);

/**
 * What the fake encoder returns: a 1280-wide picture is 637 500 bytes at 0.85, 525 000 at 0.7, 375 000 at 0.5, so
 * only the last quality fits the 375 000-byte cap; a 640-wide one is 318 750 at 0.85, under it at once.
 */
function sizedBytes(picture: Picture, quality: number, oversize = 1): Uint8Array {
  return new Uint8Array(Math.round((quality * 750_000 * picture.width * oversize) / 1280));
}

interface Scripted extends Capture {
  /** The qualities `encode` was asked for, in order. */
  asked: number[];
  /** How many times `grab` was called. */
  readonly grabs: number;
}

/** A capture whose `grab()` returns the next entry, the last one repeating. */
function scripted(pictures: Array<Picture | null>, o: { oversize?: number; name?: string; kind?: FrameSource['kind'] } = {}): Scripted {
  let grabs = 0;
  const asked: number[] = [];
  return {
    name: o.name ?? 'Slides',
    kind: o.kind ?? 'window',
    asked,
    get grabs() {
      return grabs;
    },
    async grab() {
      return pictures[Math.min(grabs++, pictures.length - 1)];
    },
    async encode(picture, quality) {
      asked.push(quality);
      return sizedBytes(picture, quality, o.oversize);
    },
  };
}

/** A capture whose grabs the test settles by hand. */
function manual(): Capture & { pending: Array<(p: Picture | null) => void> } {
  const pending: Array<(p: Picture | null) => void> = [];
  return {
    name: 'Slow',
    kind: 'window',
    pending,
    grab: () => new Promise((resolve) => pending.push(resolve)),
    async encode(picture, quality) {
      return sizedBytes(picture, quality);
    },
  };
}

/** Everything one subscriber hears, with the clock's time at each call. */
function record(clock: Clock, source: FrameSource) {
  const r = {
    frames: [] as Array<[FrameReason, number]>,
    times: [] as number[],
    jpegs: [] as Uint8Array[],
    losts: [] as number[],
    backs: [] as number[],
    /** 'frame:<reason>' | 'lost' | 'back', in the order heard. */
    events: [] as string[],
    off: () => {},
  };
  r.off = source.subscribe(
    (jpeg, reason) => {
      r.frames.push([reason, jpeg.length]);
      r.times.push(clock.now());
      r.jpegs.push(jpeg);
      r.events.push(`frame:${reason}`);
    },
    () => {
      r.losts.push(clock.now());
      r.events.push('lost');
    },
    () => {
      r.backs.push(clock.now());
      r.events.push('back');
    },
  );
  return r;
}

/** Lets every promise a tick chains on settle: a grab, then up to three encodes. */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** Advances a second at a time, letting each tick finish before the next, as a real second would. */
async function run(clock: VirtualClock, ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 1000) {
    clock.advance(1000);
    await flush();
  }
}

/** A promise with a flag: has it settled yet. */
function track<T>(promise: Promise<T>): { promise: Promise<T>; settled: () => boolean } {
  let done = false;
  const wrapped = promise.then((value) => {
    done = true;
    return value;
  });
  return { promise: wrapped, settled: () => done };
}

function fresh() {
  const clock = createVirtualClock(0);
  const sampler = createSampler(clock);
  return { clock, sampler, rec: record(clock, sampler.source) };
}

// ---- the sampler -----------------------------------------------------------------------------

describe('createSampler', () => {
  it('keeps the brief constants', () => {
    expect([SAMPLE_MS, KEEPALIVE_MS, FIRST_FRAME_MS, MAX_BYTES]).toEqual([1000, 60_000, 3000, 375_000]);
    expect([...QUALITIES]).toEqual([0.85, 0.7, 0.5]);
  });

  it('emits the first non-blank picture as first, to late subscribers too, and resolves first() with it', async () => {
    const { clock, sampler, rec } = fresh();
    sampler.attach(scripted([BLACK, FLAT, lit(1)]));
    const first = sampler.first(); // asked at attach, as a run does: the frame comes from the beat due at 3 s
    await run(clock, 2000);
    expect(rec.frames).toEqual([]);
    expect(sampler.state().status).toBe('idle');
    await run(clock, 1000);
    expect(rec.frames).toEqual([['first', 318750]]);
    expect(rec.times).toEqual([3000]);
    await run(clock, 1000);
    // A subscriber joining at 4 s has the frame at once, inside subscribe.
    const late = record(clock, sampler.source);
    expect(late.frames).toEqual([['first', 318750]]);
    expect(late.times).toEqual([4000]);
    expect(late.jpegs[0]).toBe(rec.jpegs[0]);
    expect(rec.frames).toHaveLength(1);
    const jpeg = await first;
    expect(jpeg).toBe(rec.jpegs[0]);
  });

  it('resolves first() with null after 3 s of blank pictures, emitting nothing', async () => {
    const { clock, sampler, rec } = fresh();
    const first = sampler.first();
    sampler.attach(scripted([BLACK]));
    await run(clock, FIRST_FRAME_MS);
    expect(await first).toBeNull();
    expect(rec.frames).toEqual([]);
    expect(sampler.state().status).toBe('idle');
    expect(sampler.state().sent).toBe(0);
  });

  it('first() waits out the beat due at 3 s: its frame counts, an empty one answers null at once, a grab that never settles answers null at 4 s', async () => {
    // A frame from the third beat, which settles at 3.4 s, is the first frame.
    const a = fresh();
    const slowA = manual();
    a.sampler.attach(slowA);
    const firstA = track(a.sampler.first());
    for (const i of [0, 1]) {
      a.clock.advance(1000);
      await flush();
      slowA.pending[i](BLACK);
      await flush();
    }
    a.clock.advance(1000); // 3 s: FIRST_FRAME_MS has passed and the third grab is out
    await flush();
    expect(slowA.pending).toHaveLength(3);
    expect(firstA.settled()).toBe(false);
    a.clock.advance(400);
    slowA.pending[2](lit(1));
    await flush();
    expect(await firstA.promise).toHaveLength(318750);
    expect(a.rec.times).toEqual([3400]);

    // The same beat ending blank answers null as it ends, not at the backstop.
    const b = fresh();
    const slowB = manual();
    b.sampler.attach(slowB);
    const firstB = track(b.sampler.first());
    for (const i of [0, 1]) {
      b.clock.advance(1000);
      await flush();
      slowB.pending[i](BLACK);
      await flush();
    }
    b.clock.advance(1400);
    await flush();
    expect(firstB.settled()).toBe(false);
    slowB.pending[2](BLACK);
    await flush();
    expect(firstB.settled()).toBe(true);
    expect(await firstB.promise).toBeNull();
    expect(b.clock.now()).toBe(3400);

    // A grab that never settles cannot hold a start past FIRST_FRAME_MS + SAMPLE_MS.
    const c = fresh();
    c.sampler.attach(manual());
    const firstC = track(c.sampler.first());
    c.clock.advance(3999);
    await flush();
    expect(firstC.settled()).toBe(false);
    c.clock.advance(1);
    await flush();
    expect(firstC.settled()).toBe(true);
    expect(await firstC.promise).toBeNull();
  });

  it('answers a first() asked after the frame went with that frame, and one asked twice with one promise', async () => {
    const { clock, sampler, rec } = fresh();
    sampler.attach(scripted([lit(1)]));
    await run(clock, 1000);
    expect(await sampler.first()).toBe(rec.jpegs[0]);

    const other = fresh();
    expect(other.sampler.first()).toBe(other.sampler.first());
  });

  it('first() answers for the capture attached last: a new attach waits for its own frame, and a keep-alive of the old one does not count', async () => {
    const { clock, sampler, rec } = fresh();
    sampler.attach(scripted([lit(1)]));
    await run(clock, 1000);
    expect(await sampler.first()).toBe(rec.jpegs[0]);

    // At 59 s a capture that shows nothing: the keep-alive at 61 s re-sends the old frame, and first() still answers null.
    await run(clock, 58_000);
    sampler.attach(scripted([BLACK]));
    const blank = track(sampler.first());
    await run(clock, 2000);
    expect(rec.frames[rec.frames.length - 1]).toEqual(['keepalive', 318750]);
    expect(blank.settled()).toBe(false);
    await run(clock, 1000);
    expect(await blank.promise).toBeNull();

    // A capture with a picture: first() is its frame, sent as a change.
    sampler.attach(scripted([lit(3)]));
    const next = sampler.first();
    await run(clock, 1000);
    expect(rec.frames[rec.frames.length - 1]).toEqual(['changed', 318750]);
    expect(await next).toBe(rec.jpegs[rec.jpegs.length - 1]);
  });

  it('emits changed only past the threshold, never more than once a second, and a keepalive after 60 s unchanged', async () => {
    const { clock, sampler, rec } = fresh();
    sampler.attach(scripted([lit(1), lit(1.1), lit(2), lit(2)]));
    await run(clock, 1000);
    expect(rec.frames).toEqual([['first', 318750]]);
    await run(clock, 1000); // lit(1.1): under the threshold of the last frame sent
    expect(rec.frames).toHaveLength(1);
    await run(clock, 1000); // lit(2)
    expect(rec.frames.map(([reason]) => reason)).toEqual(['first', 'changed']);
    await run(clock, 59_000); // 62 s
    expect(rec.frames).toHaveLength(2);
    await run(clock, 1000); // 63 s: 60 s after the last send
    expect(rec.frames.map(([reason]) => reason)).toEqual(['first', 'changed', 'keepalive']);
    expect(rec.times).toEqual([1000, 3000, 63000]);
    // The keepalive is the frame last sent, not a new one.
    expect(rec.jpegs[2]).toBe(rec.jpegs[1]);
    await run(clock, 60_000);
    expect(rec.times).toEqual([1000, 3000, 63000, 123000]);
  });

  it('compares with the frame last sent, not the last frame grabbed: a slow drift past the threshold is a change', async () => {
    const { clock, sampler, rec } = fresh();
    // 4 grey levels a step: each is under the threshold of its neighbour, the second is 8 past the first.
    sampler.attach(scripted([lit(1), lit(1.4), lit(1.8), lit(2.2)]));
    await run(clock, 4000);
    expect(rec.times).toEqual([1000, 3000]);
    expect(rec.frames.map(([reason]) => reason)).toEqual(['first', 'changed']);
  });

  it('a grab of nothing is a loss told once; the last good frame goes again every 60 s; the picture back is back then changed', async () => {
    const { clock, sampler, rec } = fresh();
    sampler.attach(scripted([lit(1), ...Array<null>(128).fill(null), lit(2)]));
    await run(clock, 1000);
    expect(rec.frames).toEqual([['first', 318750]]);
    await run(clock, 1000);
    expect(rec.losts).toEqual([2000]);
    expect(sampler.state().status).toBe('lost');
    await run(clock, 58_000); // 60 s: a loss does not restart the 60 s since the last send
    expect(rec.frames).toHaveLength(1);
    await run(clock, 1000); // 61 s
    expect(rec.frames).toEqual([['first', 318750], ['keepalive', 318750]]);
    expect(rec.jpegs[1]).toBe(rec.jpegs[0]);
    expect(sampler.state().status).toBe('lost');
    expect(sampler.state().lastReason).toBe('keepalive');
    await run(clock, 60_000); // 121 s
    expect(rec.times).toEqual([1000, 61000, 121000]);
    expect(rec.jpegs[2]).toBe(rec.jpegs[0]);
    expect(rec.losts).toEqual([2000]);
    expect(rec.backs).toEqual([]);
    await run(clock, 9000); // 130 s: the picture is back
    expect(rec.backs).toEqual([130000]);
    expect(rec.events.slice(-2)).toEqual(['back', 'frame:changed']);
    expect(rec.frames[3]).toEqual(['changed', 318750]);
    expect(rec.times[3]).toBe(130000);
    expect(sampler.state().status).toBe('live');
    expect(rec.losts).toEqual([2000]);
  });

  it('the gap since the last send never passes 60 s: a loss late in that minute does not push the keepalive out', async () => {
    const { clock, sampler, rec } = fresh();
    // lit(1) from 1 s to 50 s, then nothing: lost at 51 s, 50 s after the last send.
    sampler.attach(scripted([...Array<Picture>(50).fill(lit(1)), null]));
    await run(clock, 51_000);
    expect(rec.losts).toEqual([51000]);
    expect(rec.times).toEqual([1000]);
    await run(clock, 10_000); // 61 s
    expect(rec.times).toEqual([1000, 61000]);
    await run(clock, 60_000); // 121 s
    expect(rec.times).toEqual([1000, 61000, 121000]);
    expect(rec.frames.map(([reason]) => reason)).toEqual(['first', 'keepalive', 'keepalive']);
  });

  it('a loss before any frame is told, and the picture then is back then first', async () => {
    const { clock, sampler, rec } = fresh();
    sampler.attach(scripted([null, lit(1)]));
    await run(clock, 1000);
    expect(rec.events).toEqual(['lost']);
    expect(sampler.state().status).toBe('lost');
    await run(clock, 1000);
    expect(rec.events).toEqual(['lost', 'back', 'frame:first']);
  });

  it('a grab that rejects is a loss, and the chain goes on', async () => {
    const { clock, sampler, rec } = fresh();
    let calls = 0;
    sampler.attach({
      name: 'Flaky',
      kind: 'window',
      async grab() {
        if (++calls === 1) throw new Error('stream ended');
        return lit(1);
      },
      async encode(picture, quality) {
        return sizedBytes(picture, quality);
      },
    });
    await run(clock, 1000);
    expect(rec.events).toEqual(['lost']);
    await run(clock, 1000);
    expect(rec.events).toEqual(['lost', 'back', 'frame:first']);
  });

  it('a blank picture neither ends a loss nor stops the keepalive of the last good frame', async () => {
    const lost = fresh();
    lost.sampler.attach(scripted([lit(1), null, BLACK, BLACK, lit(2)]));
    await run(lost.clock, 4000);
    expect(lost.rec.events).toEqual(['frame:first', 'lost']);
    expect(lost.sampler.state().status).toBe('lost');
    await run(lost.clock, 1000);
    expect(lost.rec.events).toEqual(['frame:first', 'lost', 'back', 'frame:changed']);

    const blank = fresh();
    blank.sampler.attach(scripted([lit(1), BLACK]));
    await run(blank.clock, 61_000);
    expect(blank.rec.times).toEqual([1000, 61000]);
    expect(blank.rec.frames[1]).toEqual(['keepalive', 318750]);
    expect(blank.sampler.state().status).toBe('stale');
    expect(blank.rec.losts).toEqual([]);
  });

  it('re-encodes a frame over 375 000 bytes at 0.7 then 0.5, and skips it when still over', async () => {
    // 1280 wide: 637 500 at 0.85, 525 000 at 0.7, 375 000 at 0.5, which fits.
    const wide = fresh();
    const wideCapture = scripted([lit(1, 1280)]);
    wide.sampler.attach(wideCapture);
    await run(wide.clock, 1000);
    expect(wideCapture.asked).toEqual([0.85, 0.7, 0.5]);
    expect(wide.rec.frames).toEqual([['first', 375000]]);

    // 800 wide: 398 438 at 0.85, 328 125 at 0.7, which fits: 0.5 is never asked.
    const mid = fresh();
    const midCapture = scripted([lit(1, 800)]);
    mid.sampler.attach(midCapture);
    await run(mid.clock, 1000);
    expect(midCapture.asked).toEqual([0.85, 0.7]);
    expect(mid.rec.frames).toEqual([['first', 328125]]);

    // 1.2× the sizes: still 450 000 at 0.5. Three tries, nothing emitted, nothing changed, first() waiting.
    const over = fresh();
    const overCapture = scripted([lit(1, 1280)], { oversize: 1.2 });
    let settled = false;
    const first = over.sampler.first().then((jpeg) => {
      settled = true;
      return jpeg;
    });
    over.sampler.attach(overCapture);
    await run(over.clock, 1000);
    expect(overCapture.asked).toEqual([0.85, 0.7, 0.5]);
    expect(over.rec.frames).toEqual([]);
    expect(over.sampler.state()).toMatchObject({ status: 'idle', sent: 0, lastSentAt: null, lastReason: null, lastJpeg: null });
    expect(settled).toBe(false);
    await run(over.clock, 2000);
    expect(await first).toBeNull();
  });

  it('a frame whose encode throws is skipped like one over the cap, and the chain goes on', async () => {
    const { clock, sampler, rec } = fresh();
    const cap = scripted([lit(1)]);
    sampler.attach({ ...cap, grab: () => cap.grab(), encode: () => Promise.reject(new Error('canvas')) });
    await run(clock, 3000);
    expect(rec.frames).toEqual([]);
    expect(sampler.state().sent).toBe(0);
    expect(cap.grabs).toBe(3);
  });

  it('an encoder that fails is reported when it starts failing, not on every frame it drops, and again only after it worked in between', async () => {
    report.reportWarning.mockClear();
    const { clock, sampler } = fresh();
    const cap = scripted([lit(1), lit(2), lit(3), lit(4), lit(5), lit(6)]);
    let failing = true;
    sampler.attach({ ...cap, grab: () => cap.grab(), encode: (picture, quality) => (failing ? Promise.reject(new Error('canvas lost')) : cap.encode(picture, quality)) });
    await run(clock, 3000);
    expect(report.reportWarning).toHaveBeenCalledTimes(1);
    const [source, message, options] = report.reportWarning.mock.calls[0];
    expect(source).toBe('ScreenContext');
    expect(message).toMatch(/could not be encoded.*canvas lost/);
    expect(options).toMatchObject({ dedupeKey: 'screen-context.encode' });
    expect(options.cause).toBeInstanceOf(Error);

    failing = false;
    await run(clock, 1000);
    expect(sampler.state().sent).toBe(1);
    failing = true;
    await run(clock, 1000);
    expect(report.reportWarning).toHaveBeenCalledTimes(2);
  });

  it('a frame still over the cap at the last quality is skipped without a report: the encoder works', async () => {
    report.reportWarning.mockClear();
    const { clock, sampler } = fresh();
    sampler.attach(scripted([lit(1, 1280), lit(2, 1280)], { oversize: 2 }));
    await run(clock, 2000);
    expect(sampler.state().sent).toBe(0);
    expect(report.reportWarning).not.toHaveBeenCalled();
  });

  it('status is live after a change, stale after a keepalive, lost after a loss; sent counts emits and lastReason names the last', async () => {
    const { clock, sampler } = fresh();
    expect(sampler.state()).toEqual({ status: 'idle', name: '', kind: 'window', sent: 0, lastSentAt: null, lastReason: null, lastJpeg: null });
    sampler.attach(scripted([lit(1), lit(1.1), lit(2), lit(2)], { name: 'Keynote', kind: 'screen' }));
    expect(sampler.state()).toMatchObject({ status: 'idle', name: 'Keynote', kind: 'screen', sent: 0 });
    await run(clock, 1000);
    expect(sampler.state()).toMatchObject({ status: 'live', sent: 1, lastSentAt: 1000, lastReason: 'first' });
    expect(sampler.state().lastJpeg).toHaveLength(318750);
    await run(clock, 1000);
    expect(sampler.state()).toMatchObject({ status: 'live', sent: 1, lastSentAt: 1000, lastReason: 'first' });
    await run(clock, 1000);
    expect(sampler.state()).toMatchObject({ status: 'live', sent: 2, lastSentAt: 3000, lastReason: 'changed' });
    await run(clock, 60_000);
    expect(sampler.state()).toMatchObject({ status: 'stale', sent: 3, lastSentAt: 63000, lastReason: 'keepalive' });

    const lost = fresh();
    lost.sampler.attach(scripted([lit(1), null]));
    await run(lost.clock, 2000);
    expect(lost.sampler.state()).toMatchObject({ status: 'lost', sent: 1, lastReason: 'first' });
    await run(lost.clock, 59_000);
    expect(lost.sampler.state()).toMatchObject({ status: 'lost', sent: 2, lastSentAt: 61000, lastReason: 'keepalive' });
  });

  it('state() is a snapshot, and onState hears every change until it is unsubscribed', async () => {
    const { clock, sampler } = fresh();
    const heard: string[] = [];
    const off = sampler.onState((s) => heard.push(`${s.status}:${s.sent}`));
    const before = sampler.state();
    sampler.attach(scripted([lit(1), null]));
    await run(clock, 2000);
    expect(heard).toEqual(['idle:0', 'live:1', 'lost:1']);
    expect(before).toMatchObject({ status: 'idle', sent: 0 });
    off();
    await run(clock, 60_000);
    expect(heard).toHaveLength(3);
    expect(sampler.state().sent).toBe(2);
  });

  it('detach is a loss by the owner, attach of a new capture is back; close leaves no timer armed', async () => {
    const { clock, sampler, rec } = fresh();
    sampler.attach(scripted([lit(1)]));
    await run(clock, 1000);
    sampler.detach();
    expect(rec.losts).toEqual([1000]);
    expect(sampler.state().status).toBe('lost');
    expect(sampler.state().lastJpeg).toBe(rec.jpegs[0]);
    sampler.detach();
    expect(rec.losts).toEqual([1000]);
    // The last good frame still goes every 60 s while nothing is attached.
    await run(clock, 60_000);
    expect(rec.times).toEqual([1000, 61000]);
    expect(rec.frames[1]).toEqual(['keepalive', 318750]);

    sampler.attach(scripted([lit(5)], { name: 'Other' }));
    expect(sampler.state().name).toBe('Other');
    expect(sampler.source.name).toBe('Other');
    await run(clock, 1000);
    expect(rec.backs).toEqual([62000]);
    expect(rec.events.slice(-2)).toEqual(['back', 'frame:changed']);
    expect(sampler.state().status).toBe('live');

    sampler.close();
    expect(clock.pending()).toBe(0);
    const heard = rec.events.length;
    await run(clock, 130_000);
    expect(rec.events).toHaveLength(heard);
  });

  it('close settles a first() still waiting with null and drops a grab in flight', async () => {
    const { clock, sampler, rec } = fresh();
    const cap = manual();
    const first = sampler.first();
    sampler.attach(cap);
    clock.advance(1000);
    expect(cap.pending).toHaveLength(1);
    sampler.close();
    expect(await first).toBeNull();
    expect(clock.pending()).toBe(0);
    cap.pending[0](lit(1));
    await flush();
    expect(rec.frames).toEqual([]);
    expect(clock.pending()).toBe(0);
    // A closed sampler takes no subscriber and no capture.
    const late = record(clock, sampler.source);
    sampler.attach(scripted([lit(1)]));
    await run(clock, 2000);
    expect(late.events).toEqual([]);
    expect(clock.pending()).toBe(0);
  });

  it('a new capture while live sends its first usable picture as changed, even a picture equal to the last', async () => {
    const { clock, sampler, rec } = fresh();
    sampler.attach(scripted([lit(1)]));
    await run(clock, 1000);
    sampler.attach(scripted([lit(1)]));
    await run(clock, 1000);
    expect(rec.events).toEqual(['frame:first', 'frame:changed']);
  });

  it('drops the result of a grab that was in flight when the capture was replaced', async () => {
    const { clock, sampler, rec } = fresh();
    const slow = manual();
    sampler.attach(slow);
    clock.advance(1000);
    expect(slow.pending).toHaveLength(1);
    sampler.attach(scripted([lit(7, 320)])); // 159 375 bytes at 0.85
    slow.pending[0](lit(1)); // 318 750 bytes: must never be sent
    await flush();
    expect(rec.frames).toEqual([]);
    await run(clock, 1000);
    expect(rec.frames).toEqual([['first', 159375]]);
  });

  it('never has two grabs in flight: a slow grab holds the next until it resolves', async () => {
    const { clock, sampler, rec } = fresh();
    const cap = manual();
    sampler.attach(cap);
    clock.advance(5000);
    await flush();
    expect(cap.pending).toHaveLength(1);
    cap.pending[0](lit(1));
    await flush();
    expect(rec.times).toEqual([5000]);
    clock.advance(1000);
    await flush();
    expect(cap.pending).toHaveLength(2);
    clock.advance(5000);
    await flush();
    expect(cap.pending).toHaveLength(2);
  });

  it('two subscribers each get every frame; unsubscribing one leaves the other', async () => {
    const { clock, sampler, rec: first } = fresh();
    const second = record(clock, sampler.source);
    sampler.attach(scripted([lit(1), lit(1), lit(2)]));
    await run(clock, 3000);
    expect(first.frames).toEqual([['first', 318750], ['changed', 318750]]);
    expect(second.frames).toEqual(first.frames);
    first.off();
    await run(clock, 60_000);
    expect(first.frames).toHaveLength(2);
    expect(second.frames).toHaveLength(3);
  });

  it('never calls a subscriber that was unsubscribed during the same fan-out', async () => {
    const { clock, sampler } = fresh();
    let offSecond = () => {};
    sampler.source.subscribe(() => offSecond(), () => {}, () => {});
    const second = record(clock, sampler.source);
    offSecond = second.off;
    sampler.attach(scripted([lit(1)]));
    await run(clock, 1000);
    expect(second.events).toEqual([]);
  });

  it('tells a subscriber that joins during a loss the frame in hand, then the loss', async () => {
    const { clock, sampler } = fresh();
    sampler.attach(scripted([lit(1), null]));
    await run(clock, 2000);
    const late = record(clock, sampler.source);
    expect(late.events).toEqual(['frame:first', 'lost']);
  });

  it('a subscriber or listener that throws starves nobody: the others get the frame and the loss, and state() is as if nothing threw', async () => {
    const rethrown: Array<() => void> = [];
    vi.stubGlobal('queueMicrotask', (fn: () => void) => rethrown.push(fn));
    try {
      const boom = new Error('boom');
      const throwing = () => {
        throw boom;
      };
      const clock = createVirtualClock(0);
      const sampler = createSampler(clock);
      sampler.onState(throwing);
      const heard: string[] = [];
      sampler.onState((s) => heard.push(`${s.status}:${s.sent}`));
      sampler.source.subscribe(throwing, throwing, throwing);
      const rec = record(clock, sampler.source);
      sampler.attach(scripted([lit(1), null]));
      await run(clock, 2000);
      expect(rec.events).toEqual(['frame:first', 'lost']);
      expect(heard).toEqual(['idle:0', 'live:1', 'lost:1']);
      expect(sampler.state()).toMatchObject({ status: 'lost', sent: 1, lastSentAt: 1000, lastReason: 'first' });
      // Each error went to the microtask queue to be thrown there, none out of the sampler.
      expect(rethrown).toHaveLength(3 + 2);
      for (const fn of rethrown) expect(fn).toThrow(boom);
      // A late subscriber that throws is still a subscriber: subscribe does not throw, and it hears what follows.
      const lateEvents: string[] = [];
      expect(() =>
        sampler.source.subscribe(
          () => {
            lateEvents.push('frame');
            throw boom;
          },
          () => lateEvents.push('lost'),
          () => lateEvents.push('back'),
        ),
      ).not.toThrow();
      expect(lateEvents).toEqual(['frame', 'lost']);
      await run(clock, 59_000);
      expect(lateEvents).toEqual(['frame', 'lost', 'frame']);
      expect(rec.events).toEqual(['frame:first', 'lost', 'frame:keepalive']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never sends two frames less than a second apart, however slow the beat before: a change waits for the next beat', async () => {
    const { clock, sampler, rec } = fresh();
    const cap = manual();
    sampler.attach(cap);
    clock.advance(1000); // beat 1
    await flush();
    cap.pending[0](lit(1));
    await flush();
    expect(rec.times).toEqual([1000]);
    clock.advance(1000); // beat 2 starts at 2 s; its grab settles at 3.5 s with a changed picture
    await flush();
    clock.advance(1500);
    cap.pending[1](lit(2));
    await flush();
    expect(rec.times).toEqual([1000, 3500]);
    // Beat 3 follows at once, since beat 2 took longer than a second, and sees another change: held back, not lost.
    clock.advance(0);
    await flush();
    expect(cap.pending).toHaveLength(3);
    cap.pending[2](lit(3));
    await flush();
    expect(rec.times).toEqual([1000, 3500]);
    clock.advance(1000); // beat 4 at 4.5 s: the change is still a change
    await flush();
    cap.pending[3](lit(3));
    await flush();
    expect(rec.times).toEqual([1000, 3500, 4500]);
    expect(rec.frames.map(([reason]) => reason)).toEqual(['first', 'changed', 'changed']);
    for (let i = 1; i < rec.times.length; i++) expect(rec.times[i] - rec.times[i - 1]).toBeGreaterThanOrEqual(SAMPLE_MS);
  });

  it('is a FrameSource whose identity survives attach and detach', () => {
    const { sampler } = fresh();
    const source = sampler.source;
    sampler.attach(scripted([lit(1)]));
    sampler.detach();
    sampler.attach(scripted([lit(1)]));
    expect(sampler.source).toBe(source);
  });
});
