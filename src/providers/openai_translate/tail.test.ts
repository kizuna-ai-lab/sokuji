import { describe, it, expect } from 'vitest';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import { FRAME_MS, FRAME_SAMPLES, padSamples, ReleaseTail, TAIL_MAX_MS, TAIL_QUIET_MS, type TailSummary } from './tail';

function tail() {
  const { clock, timers } = trackedClock();
  const sent: Int16Array[] = [];
  const ended: TailSummary[] = [];
  const t = new ReleaseTail({ clock, send: (pcm) => sent.push(pcm), ended: (s) => ended.push(s) });
  /** What went up, as [length, all zero]. */
  const shape = () => sent.map((p) => [p.length, p.every((s) => s === 0)]);
  return { t, clock, timers, sent, ended, shape };
}
const frames = (n: number) => new Array(n).fill([FRAME_SAMPLES, true]);

describe("OpenAI Translate's release tail (ruling 2)", () => {
  it('works in the engine\'s 200 ms frames, and starts from one second of quiet capped at three', () => {
    expect([FRAME_MS, FRAME_SAMPLES, TAIL_QUIET_MS, TAIL_MAX_MS]).toEqual([200, 4_800, 1_000, 3_000]);
  });

  it('pads what was sent to the next 200 ms boundary, and nothing when it ends on one', () => {
    expect(padSamples(0)).toBe(0);
    expect(padSamples(1)).toBe(4_799);
    expect(padSamples(4_800)).toBe(0);
    // Three 85.3 ms capture chunks.
    expect(padSamples(3 * 2_048)).toBe(3_456);
    expect(padSamples(5 * 4_800 + 1)).toBe(4_799);
  });

  it('sends the pad at once, then 200 ms of silence every 200 ms, and stops once the translation has been quiet 1 s from the release', () => {
    const { t, clock, timers, ended, shape } = tail();
    expect(t.start(3 * 2_048, false)).toBe(3_456);
    expect(shape()).toEqual([[3_456, true]]);
    expect(t.running).toBe(true);
    clock.advance(1_000);
    expect(shape()).toEqual([[3_456, true], ...frames(5)]);
    expect(ended).toEqual([]);
    clock.advance(FRAME_MS);
    expect(shape()).toHaveLength(6);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null }]);
    expect(t.running).toBe(false);
    expect(timers()).toBe(0);
  });

  it("keeps going while the translation still writes or speaks, until it has been quiet 1 s", () => {
    const { t, clock, timers, ended, shape } = tail();
    t.start(4_800, false);
    for (const at of [300, 900, 1_500]) {
      clock.advance(at - clock.now());
      t.output();
    }
    clock.advance(2_400 - clock.now());
    expect(ended).toEqual([]);
    clock.advance(FRAME_MS);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 2_400, lastOutputMs: 1_500 }]);
    // No pad: what was sent ended on the grid.
    expect(shape()).toEqual(frames(12));
    expect(timers()).toBe(0);
  });

  it('stops at 3 s after the release however long the translation goes on', () => {
    const { t, clock, timers, ended, shape } = tail();
    t.start(0, false);
    for (let at = 250; at <= 5_000; at += 250) {
      clock.advance(250);
      t.output();
    }
    expect(ended).toEqual([{ reason: 'cap', silenceMs: 3_000, lastOutputMs: 3_000 }]);
    expect(shape()).toEqual(frames(15));
    expect(timers()).toBe(0);
  });

  it('a new press, or audio, ends it at once and says so; nothing more goes up', () => {
    const press = tail();
    press.t.start(0, false);
    press.clock.advance(700);
    press.t.stop('press');
    expect(press.ended).toEqual([{ reason: 'press', silenceMs: 600, lastOutputMs: null }]);
    expect(press.t.running).toBe(false);
    press.clock.advance(5_000);
    expect(press.shape()).toEqual(frames(3));
    expect(press.timers()).toBe(0);

    const audio = tail();
    audio.t.start(0, false);
    audio.t.stop('audio');
    expect(audio.ended).toEqual([{ reason: 'audio', silenceMs: 0, lastOutputMs: null }]);
    expect(audio.t.running).toBe(false);
    audio.clock.advance(5_000);
    expect(audio.shape()).toEqual([]);
    expect(audio.timers()).toBe(0);
  });

  it("says a cancelled press's tail is one, and runs it the same (the press appended audio no clear can take back)", () => {
    const { t, clock, ended, shape } = tail();
    t.start(100, true);
    clock.advance(1_200);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null, cancelled: true }]);
    expect(shape()).toEqual([[4_700, true], ...frames(5)]);
  });

  it('cancel ends it silently: no summary, no timer, nothing more sent', () => {
    const { t, clock, timers, ended, shape } = tail();
    t.start(0, false);
    clock.advance(400);
    t.cancel();
    expect(t.running).toBe(false);
    clock.advance(5_000);
    expect(ended).toEqual([]);
    expect(shape()).toEqual(frames(2));
    expect(timers()).toBe(0);
    t.stop('press');
    expect(ended).toEqual([]);
  });

  it("ignores output while no tail runs: a release's quiet counts from the release", () => {
    const { t, clock, ended } = tail();
    t.output();
    clock.advance(500);
    t.start(0, false);
    clock.advance(1_200);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null }]);
  });

  it('a second release restarts the tail: the first ends silently, one timer runs', () => {
    const { t, clock, timers, ended } = tail();
    t.start(0, false);
    clock.advance(400);
    t.start(0, false);
    expect(timers()).toBe(1);
    clock.advance(1_200);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null }]);
  });

  it.each([1, 3])('counts beats, not clock.now() deltas, so a timer firing %dms late still ends after exactly 5 frames of quiet, and never past 15 at the cap', (lateMs) => {
    // A late-firing setTimeout, as the real clock's routinely is: `every()`'s
    // own re-arm still lands one tick per beat, but a raw `now() - releasedAt`
    // check would see less than 1 000 ms / 3 000 ms elapsed at each beat and
    // cut the tail short (ruling 2's 5 and 15 frames).
    function lateTail() {
      const { clock: base, timers } = trackedClock();
      const clock = {
        now: () => base.now(),
        advance: (ms: number) => base.advance(ms),
        setTimeout: (fn: () => void, ms: number) => base.setTimeout(fn, ms + lateMs),
      };
      const sent: Int16Array[] = [];
      const ended: TailSummary[] = [];
      const t = new ReleaseTail({ clock, send: (pcm) => sent.push(pcm), ended: (s) => ended.push(s) });
      return { t, clock, timers, sent, ended };
    }

    const quiet = lateTail();
    quiet.t.start(0, false);
    quiet.clock.advance(6_000);
    expect(quiet.sent).toHaveLength(5);
    expect(quiet.ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null }]);
    expect(quiet.timers()).toBe(0);

    const capped = lateTail();
    capped.t.start(0, false);
    for (let at = 250; at <= 6_000; at += 250) {
      capped.clock.advance(250);
      capped.t.output();
    }
    expect(capped.sent).toHaveLength(15);
    expect(capped.ended).toEqual([{ reason: 'cap', silenceMs: 3_000, lastOutputMs: 3_000 }]);
    expect(capped.timers()).toBe(0);
  });

  it('a wall clock that steps backwards mid-tail still ends after 5 frames of quiet, and never sends past the cap', () => {
    // A stepped `Date.now()` (the system clock moved) makes `now() - releasedAt`
    // negative forever on a raw check, so counting beats is what still ends
    // the tail — not `clock.now()`.
    const { clock: base, timers } = trackedClock();
    let offset = 0;
    const clock = {
      now: () => base.now() - offset,
      advance: (ms: number) => base.advance(ms),
      setTimeout: (fn: () => void, ms: number) => base.setTimeout(fn, ms),
    };
    const sent: Int16Array[] = [];
    const ended: TailSummary[] = [];
    const t = new ReleaseTail({ clock, send: (pcm) => sent.push(pcm), ended: (s) => ended.push(s) });
    t.start(0, false);
    clock.advance(500);
    offset = 3_600_000;
    clock.advance(60_000);
    expect(sent).toHaveLength(5);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null }]);
    expect(t.running).toBe(false);
    expect(timers()).toBe(0);
  });
});
