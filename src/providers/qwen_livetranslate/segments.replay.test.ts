/**
 * The owner's two recorded timelines (probe 2026-10-13), replayed through
 * the adapter on the participant leg: four speakers in a row, then two in
 * turn. Every heard item becomes a source and its translation, paired by
 * origin, closed, labelled with the same person on both sides, the speech
 * on the translation.
 */
import { describe, it, expect } from 'vitest';
import type { AdapterEvent } from '../../lib/contract/events';
import abab from './recordings/abab.json';
import twoSpeakers from './recordings/two-speakers.json';
import { b64, PARTICIPANT_CTX, qwenSession } from './testing';

type Recorded = { type: string; samples?: number; [field: string]: unknown };
const TWO_SPEAKERS = twoSpeakers as unknown as Recorded[];
const ABAB = abab as unknown as Recorded[];

/** Each recorded event as the frame the server sent: an audio delta gets audio of its recorded length. */
const frames = (recording: readonly Recorded[]) =>
  recording.map(({ samples, ...e }) => JSON.stringify(e.type === 'response.audio.delta' ? { ...e, delta: b64(samples ?? 0) } : e));

interface Seen { side: string; origin?: string; text: string; person?: string; closed: boolean; audio: number }

/** Each source with its translation, by origin, as L1 would fold them. */
function pairs(log: readonly AdapterEvent[]) {
  const segments = new Map<number, Seen>();
  for (const e of log) {
    if (e.kind === 'segmentOpened') segments.set(e.payload.ref, { side: e.payload.side, origin: e.payload.origin, text: '', person: e.payload.person, closed: false, audio: 0 });
    else if (e.kind === 'segmentText') {
      const s = segments.get(e.payload.ref)!;
      s.text = e.payload.text;
      if (e.payload.person !== undefined) s.person = e.payload.person;
    } else if (e.kind === 'segmentClosed') {
      const s = segments.get(e.payload.ref)!;
      s.closed = true;
      if (e.payload.origin !== undefined) s.origin = e.payload.origin;
    } else if (e.kind === 'audio' && e.payload.ref !== undefined) segments.get(e.payload.ref)!.audio += 1;
  }
  const all = [...segments.values()];
  return all.filter((s) => s.side === 'source').map((source) => {
    const translation = all.find((t) => t.side === 'translation' && t.origin === source.origin);
    return {
      person: source.person, source: source.text, translation: translation?.text, translationPerson: translation?.person,
      closed: source.closed && translation?.closed === true, audio: translation?.audio ?? 0,
    };
  });
}

async function replay(recording: readonly Recorded[]) {
  const h = await qwenSession({ context: PARTICIPANT_CTX });
  for (const frame of frames(recording)) h.socket().receive(frame);
  return { result: pairs(h.log), audio: h.of('audio').length, failed: h.of('failed'), degraded: h.of('degraded') };
}

describe("Qwen LiveTranslate's recorded timelines (spec §12)", () => {
  it('four speakers in a row: four pairs, persons 1 to 4, every audio delta played on its translation', async () => {
    const { result, audio, failed, degraded } = await replay(TWO_SPEAKERS);
    expect(result.map(({ person, source, translation }) => [person, source, translation])).toEqual([
      ['1', '欢迎使用实时翻译 希望这个声音能让交流变得轻松自然', 'Welcome to real-time translation. We hope this voice will make communication easier and more natural.'],
      ['2', '明日の会議は午後三時に始まります 電車が十分遅れています', "Tomorrow's meeting will start at 3:00 p.m. The train is very late."],
      ['3', 'リアルタイム翻訳へようこそ自然な会話をお手伝いします', 'Welcome to real-time translation. We are here to help you have natural conversations.'],
      ['4', '駅の近くに新しいカフェができました', 'A new cafe has opened near the station.'],
    ]);
    for (const pair of result) {
      expect(pair.translationPerson).toBe(pair.person);
      expect(pair.closed).toBe(true);
      expect(pair.audio).toBeGreaterThan(0);
    }
    expect(audio).toBe(TWO_SPEAKERS.filter((e) => e.type === 'response.audio.delta').length);
    expect(failed).toEqual([]);
    expect(degraded).toEqual([]);
  });

  it('two speakers in turn: persons 1, 2, 1, 2', async () => {
    const { result } = await replay(ABAB);
    expect(result.map(({ person, source, translation }) => [person, source, translation])).toEqual([
      ['1', '欢迎使用实时翻译 希望这个声音能让交流变得轻松自然', 'Welcome to real-time translation. We hope this voice will make communication easier and more natural.'],
      ['2', '明日の会議は午後三時に始まります', "Tomorrow's meeting will start at 3:00 p.m."],
      ['1', '欢迎使用实时翻译希望这个声音能让交流变得轻松自然', 'Welcome to real-time translation. We hope this voice will make communication easier and more natural.'],
      ['2', '明日の会議は午後三時に始まります', "Tomorrow's meeting will start at 3:00 p.m."],
    ]);
    expect(result.every((pair) => pair.closed && pair.translationPerson === pair.person)).toBe(true);
  });
});
