import { describe, it, expect } from 'vitest';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import { FRAME_MS, FRAME_SAMPLES, ReleaseTail, TAIL_MAX_MS, TAIL_QUIET_MS, type TailSummary } from './tail';

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

describe("Live Translate's release tail (Gemini/AST2 follow-up, ruling 4)", () => {
  it('works in 100 ms frames of 24 kHz silence, from one second of quiet capped at three', () => {
    expect([FRAME_MS, FRAME_SAMPLES, TAIL_QUIET_MS, TAIL_MAX_MS]).toEqual([100, 2_400, 1_000, 3_000]);
  });

  it('sends nothing at the release, then 100 ms of silence every 100 ms, and stops once the model has been quiet 1 s from the release', () => {
    const { t, clock, timers, ended, shape } = tail();
    t.start(false);
    expect(shape()).toEqual([]);
    expect(t.running).toBe(true);
    clock.advance(1_000);
    expect(shape()).toEqual(frames(10));
    expect(ended).toEqual([]);
    clock.advance(FRAME_MS);
    expect(shape()).toHaveLength(10);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null }]);
    expect(t.running).toBe(false);
    expect(timers()).toBe(0);
  });

  it('keeps going while the model still transcribes, until it has been quiet 1 s — the probe: the last words about a second behind', () => {
    const { t, clock, timers, ended, shape } = tail();
    t.start(false);
    for (const at of [900, 1_300]) {
      clock.advance(at - clock.now());
      t.output();
    }
    clock.advance(2_300 - clock.now());
    expect(ended).toEqual([]);
    clock.advance(FRAME_MS);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 2_300, lastOutputMs: 1_300 }]);
    expect(shape()).toEqual(frames(23));
    expect(timers()).toBe(0);
  });

  it('stops at 3 s after the release however long the model goes on', () => {
    const { t, clock, timers, ended, shape } = tail();
    t.start(false);
    for (let at = 250; at <= 5_000; at += 250) {
      clock.advance(250);
      t.output();
    }
    expect(ended).toEqual([{ reason: 'cap', silenceMs: 3_000, lastOutputMs: 3_000 }]);
    expect(shape()).toEqual(frames(30));
    expect(timers()).toBe(0);
  });

  it.each(['press', 'audio', 'text'] as const)('%s ends it at once and says so; nothing more goes up', (reason) => {
    const { t, clock, timers, ended, shape } = tail();
    t.start(false);
    clock.advance(350);
    t.stop(reason);
    expect(ended).toEqual([{ reason, silenceMs: 300, lastOutputMs: null }]);
    expect(t.running).toBe(false);
    clock.advance(5_000);
    expect(shape()).toEqual(frames(3));
    expect(timers()).toBe(0);
  });

  it("says a cancelled press's tail is one, and runs it the same", () => {
    const { t, clock, ended, shape } = tail();
    t.start(true);
    clock.advance(1_100);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null, cancelled: true }]);
    expect(shape()).toEqual(frames(10));
  });

  it('cancel ends it silently: no summary, no timer, nothing more sent', () => {
    const { t, clock, timers, ended, shape } = tail();
    t.start(false);
    clock.advance(400);
    t.cancel();
    expect(t.running).toBe(false);
    clock.advance(5_000);
    expect(ended).toEqual([]);
    expect(shape()).toEqual(frames(4));
    expect(timers()).toBe(0);
    t.stop('press');
    expect(ended).toEqual([]);
  });

  it("ignores output while no tail runs: a release's quiet counts from the release", () => {
    const { t, clock, ended } = tail();
    t.output();
    clock.advance(500);
    t.start(false);
    clock.advance(1_100);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null }]);
  });

  it('a second release restarts the tail: the first ends silently, one timer runs', () => {
    const { t, clock, timers, ended } = tail();
    t.start(false);
    clock.advance(400);
    t.start(false);
    expect(timers()).toBe(1);
    clock.advance(1_100);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null }]);
  });

  it('counts beats, not clock.now() deltas: a timer firing late, or a wall clock stepped back, still ends after exactly 10 frames of quiet', () => {
    const { clock: base, timers } = trackedClock();
    let offset = 0;
    const clock = {
      now: () => base.now() - offset,
      advance: (ms: number) => base.advance(ms),
      setTimeout: (fn: () => void, ms: number) => base.setTimeout(fn, ms + 3),
    };
    const sent: Int16Array[] = [];
    const ended: TailSummary[] = [];
    const t = new ReleaseTail({ clock, send: (pcm) => sent.push(pcm), ended: (s) => ended.push(s) });
    t.start(false);
    clock.advance(500);
    offset = 3_600_000;
    clock.advance(60_000);
    expect(sent).toHaveLength(10);
    expect(ended).toEqual([{ reason: 'quiet', silenceMs: 1_000, lastOutputMs: null }]);
    expect(timers()).toBe(0);
  });
});
