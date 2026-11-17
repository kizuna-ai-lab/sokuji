// Playing a record: where a sentence starts playing, which row is being played, what has audio.
import { describe, it, expect } from 'vitest';
import type { HistoryTrack } from './types';
import type { RecordRow } from './recordView';
import { audible, EARLY_MS, playable, recordLength, rowAt, startFor, trackOf, trackUrl } from './playback';

const track = (source: string, offsetMs: number, durationMs: number, over: Partial<HistoryTrack> = {}): HistoryTrack =>
  ({ source, file: `${source}.opus`, format: 'ogg-opus', durationMs, bytes: 100, offsetMs, goneAt: null, ...over });
const row = (startMs: number, side: 'mine' | 'other' = 'mine', over: Partial<RecordRow> = {}): RecordRow => ({
  sideKnown: true,
  segmentId: `s${startMs}`, leg: side === 'mine' ? 'speaker' : 'participant', side, speaker: '1', speakerLabel: 'Me', startMs, endMs: startMs + 900,
  timeKind: 'given', sentences: [{ n: 1, text: 'x' }], translation: null, ...over,
});

describe('playing a record', () => {
  it('starts a sentence whose time was not given 2.5 s early', () => {
    expect(EARLY_MS).toBe(2500);
    expect(startFor({ startMs: 10_000, timeKind: 'given' })).toBe(10_000);
    expect(startFor({ startMs: 10_000, timeKind: 'estimated' })).toBe(7_500);
    expect(startFor({ startMs: 1_000, timeKind: 'spread' })).toBe(0);
  });

  it('finds the row being played', () => {
    const rows = [row(0), row(4000, 'other'), row(9000)];
    expect(rowAt(rows, 3999)?.startMs).toBe(0);
    expect(rowAt(rows, 4000)?.startMs).toBe(4000);
    expect(rowAt(rows, 20_000)?.startMs).toBe(9000);
    expect(rowAt([], 100)).toBeNull();
  });

  it('plays the tracks that are kept, for as long as the longest reaches', () => {
    const tracks = [track('speaker', 0, 10_000), track('participant', 2000, 9000), track('x', 0, 0)];
    expect(playable(tracks).map((t) => t.source)).toEqual(['speaker', 'participant']);
    expect(recordLength(tracks)).toBe(11_000);
    expect(playable([track('speaker', 0, 10_000, { goneAt: 5 })])).toEqual([]);
  });

  it('a sentence beyond the end of its track, or on a side with no track, has no audio', () => {
    const tracks = [track('speaker', 0, 10_000)];
    expect(audible(row(9000), tracks)).toBe(true);
    expect(audible(row(10_000), tracks)).toBe(false);
    expect(audible(row(1000, 'other'), tracks)).toBe(false);
  });

  it('in face-to-face both people play from the one microphone track', () => {
    const tracks = [track('speaker', 0, 10_000)];
    expect(audible(row(1000, 'other'), tracks, 'face-to-face')).toBe(true);
    expect(trackOf('other', 'face-to-face')).toBe('speaker');
    expect(trackOf('other', 'both')).toBe('participant');
    expect(trackOf('mine', 'both')).toBe('speaker');
  });

  it('names the address the player reads a track from', () => {
    expect(trackUrl('run-0001-aaaa', 'speaker')).toBe('sokuji-history://track/run-0001-aaaa/speaker');
  });
});
