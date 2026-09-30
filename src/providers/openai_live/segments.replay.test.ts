import { describe, it, expect } from 'vitest';
import type { AdapterEvents } from '../../lib/contract/adapter';
import { replay, type Recording, type RecordedEvent } from '../../lib/segmentation/recordings/replay.testing';
import type { LiveConfig } from './config';
import mute from './recordings/mute.json';
import release from './recordings/release.json';
import timeline from './recordings/timeline.json';
import { computeRms, FLOOR_RMS, LiveSegments } from './segments';

const RECORDED = { timeline, release, mute } as unknown as Readonly<Record<'timeline' | 'release' | 'mute', Recording>>;
const BY_PAUSE: [LiveConfig['silence'], number] = [{ sourceMs: 1500, translationMs: 1500, deferMidSentence: false }, 1];
const BY_SENTENCE: [LiveConfig['silence'], number] = [{ sourceMs: 1500, translationMs: 1500, deferMidSentence: true }, 3];

/** One emitted `audio` event: its segment, its range, its window on the output's sample clock (ms), and when it arrived. */
interface Played { ref: number; range?: [number, number]; t0: number; t1: number; at: number }

/** Plays a recorded session into OpenAI Live's real segments, and through L1 and L2, recording where each played frame sat on the sample clock. */
function replayLive(recording: Recording, [silence, n]: [LiveConfig['silence'], number]) {
  const played: Played[] = [];
  let samples = 0;
  let window = { t0: 0, t1: 0 };
  const result = replay(recording, (clock, events) => {
    const sink: AdapterEvents = { ...events, audio: (e) => { played.push({ ref: e.ref as number, range: e.range, ...window, at: clock.now() }); events.audio(e); } };
    const s = new LiveSegments({ clock, silence, sentencesPerSegment: n, sink });
    return {
      input: (d, st) => s.input(d, st.startMs, st.endMs),
      output: (d, st) => s.output(d, st.startMs, st.endMs),
      audio: (pcm) => {
        window = { t0: samples / 24, t1: (samples + pcm.length) / 24 };
        samples += pcm.length;
        s.audio(pcm, { voiced: computeRms(pcm) > FLOOR_RMS, play: true });
      },
    };
  });
  return { ...result, played };
}

/** Each exchange as its two ends: its source's first four characters, its translation's first two words and last word. */
const ends = (exchanges: Array<[string, string]>) => exchanges.map(([source, translation]) => {
  const words = translation.split(' ');
  return [source.slice(0, 4), words.slice(0, 2).join(' '), words[words.length - 1]];
});

/** The pairs each recording makes, by pause and by sentence, three to a row: every source stated, none alone, none without its translation. */
const PAIRS: Array<[string, 'timeline' | 'release' | 'mute', [LiveConfig['silence'], number], string[][]]> = [
  ['timeline, by pause', 'timeline', BY_PAUSE, [
    ['今天我吃', 'Today I', 'Japanese.'], ['店里的装', 'The decor', 'randomly.'], ['下午快接', 'You can', 'alone.'], ['排骨有点', 'The spare', 'soup.'], ['店里的贩', 'Surprisingly, the', 'bills.'],
  ]],
  ['timeline, by sentence', 'timeline', BY_SENTENCE, [
    ['今天我吃', 'Today I', 'Japanese.'], ['店里的装', 'The decor', 'put'], ['下午快接', 'thought into', 'alone.'], ['排骨有点', 'The spare', 'soup.'], ['店里的贩', 'Surprisingly, the', 'bills.'],
  ]],
  ['release, by pause', 'release', BY_PAUSE, [
    ['今天我吃', 'Today I', 'noodles.'], ['店里的装', 'The owner', 'like'], ['下午快接', 'they put', 'everything.'], ['排骨有点', 'The ribs', 'soup.'], ['店里的贩', 'The vending', 'bills.'],
  ]],
  ['release, by sentence', 'release', BY_SENTENCE, [
    ['今天我吃', 'Today I', 'Sichuan.'], ['店里的装', 'Anyway, definitely', 'it.'], ['下午快接', 'In the', 'everything.'], ['排骨有点', 'The ribs', 'soup.'], ['店里的贩', 'The vending', 'bills.'],
  ]],
  ['mute, by pause', 'mute', BY_PAUSE, [
    ['今天我吃', 'Today I', 'owner'], ['店里的装', 'seemed like', 'thoughtful.'], ['天气有点', 'The weather', 'nice.'],
  ]],
  ['mute, by sentence', 'mute', BY_SENTENCE, [
    ['今天我吃', 'Today I', 'Sichuan,'], ['店里的装', 'Anyway, definitely', 'thoughtful.'], ['天气有点', 'The weather', 'nice.'],
  ]],
];

describe("OpenAI Live's segments on the owner's recorded sessions (rulings 3, 10; choice 18)", () => {
  it.each(PAIRS)(
    '%s: a row ends only at a pause of the source pause, so no comma\'s pause leaves a row without its translation; a translation longer than its row\'s sentence count runs over into the next row, and may be cut mid-sentence there',
    (_name, recording, settings, expected) => {
      const r = replayLive(RECORDED[recording], settings);
      expect({ sources: r.sources, paired: r.paired, orphans: r.orphans }).toEqual({ sources: expected.length, paired: expected.length, orphans: 0 });
      expect(r.pairings).toEqual(new Array(expected.length).fill('stated'));
      expect(r.exchanges.filter(([, translation]) => translation === '')).toEqual([]);
      expect(ends(r.exchanges)).toEqual(expected);
    },
  );
});

/** Words, lower-cased, with where each starts and ends in its text (the probe's `norm`, for an English translation). */
function words(text: string): Array<{ w: string; at: number; end: number }> {
  const out: Array<{ w: string; at: number; end: number }> = [];
  for (const m of text.matchAll(/[\p{L}\p{N}']+/gu)) {
    const at = m.index ?? 0;
    const w = m[0].toLowerCase().replace(/^'+|'+$/g, '');
    if (w) out.push({ w, at, end: at + m[0].length });
  }
  return out;
}

/** The longest common subsequence of two word lists, as index pairs (the probe's `lcs`). */
function lcs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const W = b.length + 1;
  const dp = new Uint32Array((a.length + 1) * W);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i * W + j] = a[i] === b[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++; else j++;
  }
  return out;
}

const quantile = (xs: readonly number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i));
};

describe("OpenAI Live's karaoke on the timeline session, through L1 (ruling 2; choice 9)", () => {
  const r = replayLive(RECORDED.timeline, BY_PAUSE);
  const translations = r.leg.segments.filter((s) => s.side === 'translation');
  const byRef = new Map<number, Played[]>();
  for (const p of r.played) byRef.set(p.ref, [...(byRef.get(p.ref) ?? []), p]);
  /** When the karaoke, sweeping each entry's range over its window, reaches position `c` of a segment, and when it passes it. */
  const reach = (ref: number, c: number) => {
    const p = byRef.get(ref)?.find((x) => x.range && x.range[1] > c);
    if (!p || !p.range) return null;
    const [a, b] = p.range;
    return b > a ? p.t0 + (Math.max(0, c - a) / (b - a)) * (p.t1 - p.t0) : p.t0;
  };
  const pass = (ref: number, c: number) => {
    const p = byRef.get(ref)?.find((x) => x.range && x.range[1] >= c && x.range[1] > x.range[0]);
    if (!p || !p.range) return null;
    const [a, b] = p.range;
    return p.t0 + (Math.min(b - a, Math.max(0, c - a)) / (b - a)) * (p.t1 - p.t0);
  };

  it("holds every range L1 was given, and lights every voiced frame's window it plays", () => {
    const entries = translations.flatMap((s) => s.speech.map((sp) => [s.ref, sp.range ?? null]));
    expect(entries).toEqual(r.played.map((p) => [p.ref, p.range ?? null]));
    expect(r.played).toHaveLength(315);
    expect(r.played.filter((p) => !p.range)).toEqual([]);
  });

  it("lights each output delta's words where whisper-1 hears them about as closely as the deltas' own stamps do — a median of 200 ms; a p90 of 803 ms against their 760, since ' it.', whose stamps fall on the stream's floor, is passed only by its row's next voiced frame, 2.5 s on", () => {
    const outs = RECORDED.timeline.events.filter((e): e is Extract<RecordedEvent, [number, 's' | 't', string, (number | null)?, (number | null)?]> => e[1] === 't');
    const heard = (RECORDED.timeline.words ?? []).flatMap(([start, end, word]) => words(word).map((w) => ({ w: w.w, start, end })));
    const shown = translations.flatMap((s) => words(s.text).map((w) => ({ ...w, ref: s.ref })));
    const sent = outs.flatMap((e, i) => words(e[2]).map((w) => ({ w: w.w, delta: i })));
    const shownOf = new Map(lcs(shown.map((x) => x.w), heard.map((x) => x.w)).map(([a, b]) => [b, a]));
    /** Per delta: whisper's first start and last end, the karaoke's reach and pass of the same words. */
    const perDelta = new Map<number, { heardStart: number; heardEnd: number; litStart: number | null; litEnd: number | null }>();
    for (const [c, b] of lcs(sent.map((x) => x.w), heard.map((x) => x.w))) {
      const a = shownOf.get(b);
      if (a === undefined) continue;
      const { delta } = sent[c];
      const lit = { litStart: reach(shown[a].ref, shown[a].at), litEnd: pass(shown[a].ref, shown[a].end) };
      const d = perDelta.get(delta);
      if (!d) perDelta.set(delta, { heardStart: heard[b].start, heardEnd: heard[b].end, ...lit });
      else { d.heardEnd = heard[b].end; d.litEnd = lit.litEnd; }
    }
    const karaoke: number[] = [];
    const stamps: number[] = [];
    for (const [i, d] of perDelta) {
      const [, , , startMs, endMs] = outs[i];
      if (d.litStart !== null && typeof startMs === 'number') { karaoke.push(Math.abs(d.litStart - d.heardStart)); stamps.push(Math.abs(startMs - d.heardStart)); }
      if (d.litEnd !== null && typeof endMs === 'number') { karaoke.push(Math.abs(d.litEnd - d.heardEnd)); stamps.push(Math.abs(endMs - d.heardEnd)); }
    }
    expect(karaoke).toHaveLength(198);
    expect({ median: Math.round(quantile(karaoke, 0.5)), p90: Math.round(quantile(karaoke, 0.9)) }).toEqual({ median: 200, p90: 803 });
    expect({ median: Math.round(quantile(stamps, 0.5)), p90: Math.round(quantile(stamps, 0.9)) }).toEqual({ median: 200, p90: 760 });
  });
});

describe("OpenAI Live's karaoke across the push-to-talk mute, through L1 (rulings 2, 5)", () => {
  it('lights every voiced frame of the mute session; after the unmute the stream picks up where it paused, then plays the sentence said after it, its ranges running on from its first character', () => {
    const r = replayLive(RECORDED.mute, BY_PAUSE);
    expect(r.played.filter((p) => !p.range)).toEqual([]);
    const rows = r.leg.segments.filter((s) => s.side === 'translation');
    const last = rows[rows.length - 1];
    expect(last.text.startsWith('The weather is a bit cold')).toBe(true);
    // The probe unmuted 44.3 s in (its log's `session.input_audio.unmute`). The output's sample clock waited with the stream:
    // its first frame after, 100 ms of the word the pending translation had reached, plays on that row.
    const [resumed, ...weather] = r.played.filter((p) => p.at > 44_328);
    expect(rows.find((s) => s.ref === resumed.ref)?.text).toBe(' It looks really thoughtful.');
    expect(resumed.range).toEqual([16, 22]);
    expect(new Set(weather.map((p) => p.ref))).toEqual(new Set([last.ref]));
    const ranges = weather.map((p) => p.range as [number, number]);
    expect(ranges[0][0]).toBe(0);
    ranges.forEach(([a, b], i) => {
      expect(b).toBeGreaterThanOrEqual(a);
      if (i > 0) expect(a).toBe(ranges[i - 1][1]);
    });
    expect(ranges[ranges.length - 1][1]).toBeGreaterThanOrEqual('The weather is a bit cold'.length);
  });
});
