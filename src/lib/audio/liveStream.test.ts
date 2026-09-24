import { describe, it, expect } from 'vitest';
import { SAMPLE_RATE } from '../contract/adapter';
import { LEAD_S, type AudioTimeline } from './clipQueue';
import { LiveStream, MAX_BUFFERED_S } from './liveStream';

function fakeTimeline() {
  let now = 0;
  const plays: Array<{ pcm: Int16Array; at: number; onEnded: () => void; stopped: boolean; done: boolean }> = [];
  const timeline: AudioTimeline = {
    now: () => now,
    play(pcm, at, onEnded) {
      const play = { pcm, at, onEnded, stopped: false, done: false };
      plays.push(play);
      return () => {
        play.stopped = true;
        if (!play.done) {
          play.done = true;
          play.onEnded();
        }
      };
    },
  };
  const advance = (seconds: number) => {
    now += seconds;
    for (const play of plays) {
      if (!play.done && play.at + play.pcm.length / SAMPLE_RATE <= now) {
        play.done = true;
        play.onEnded();
      }
    }
  };
  return { timeline, plays, advance };
}

const chunk = (ms: number) => new Int16Array((SAMPLE_RATE * ms) / 1000);

describe('LiveStream', () => {
  it('plays chunks back to back as they arrive, the first one lead ahead of the clock', () => {
    const { timeline, plays, advance } = fakeTimeline();
    const stream = new LiveStream(timeline);
    stream.push(chunk(85));
    advance(0.06);
    stream.push(chunk(85));
    expect(plays.map((p) => p.at)).toEqual([LEAD_S, LEAD_S + 0.085]);
  });

  it('starts fresh once it has run dry', () => {
    const { timeline, plays, advance } = fakeTimeline();
    const stream = new LiveStream(timeline);
    stream.push(chunk(85));
    advance(1);
    stream.push(chunk(85));
    expect(plays[1].at).toBeCloseTo(1 + LEAD_S, 9);
  });

  it('drops a chunk rather than let the delay grow past its bound', () => {
    const { timeline, plays } = fakeTimeline();
    const stream = new LiveStream(timeline);
    const n = Math.ceil((MAX_BUFFERED_S + LEAD_S) / 0.085) + 3;
    for (let i = 0; i < n; i++) stream.push(chunk(85));
    const last = plays[plays.length - 1];
    expect(plays.length).toBeLessThan(n);
    expect(last.at - 0).toBeLessThanOrEqual(MAX_BUFFERED_S + 0.085);
  });

  it('clear stops what plays and starts fresh', () => {
    const { timeline, plays, advance } = fakeTimeline();
    const stream = new LiveStream(timeline);
    stream.push(chunk(85));
    stream.push(chunk(85));
    advance(0.06);
    stream.clear();
    expect(plays.every((p) => p.stopped)).toBe(true);
    stream.push(chunk(85));
    expect(plays[2].at).toBeCloseTo(0.06 + LEAD_S, 9);
  });

  it('ignores an empty chunk', () => {
    const { timeline, plays } = fakeTimeline();
    new LiveStream(timeline).push(new Int16Array(0));
    expect(plays).toHaveLength(0);
  });
});
