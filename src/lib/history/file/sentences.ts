// src/lib/history/file/sentences.ts
//
// A file transcript's words (Soniox's file recognition) as the record's sentences. The words are grouped into turns —
// a new speaker, or a silence of TURN_GAP_MS, begins one — and each turn is cut by the same cutter as live text, as a
// finished segment whose words are its heard pieces: sentence ends, the cut after a pause and the 45 s cap apply alike,
// and every time is given. A turn's sentences share one segment id, so the record page shows a turn as one row.
//
// Translated words (asked for with the transcription) have no time of their own (Soniox gives 0): they follow the words
// they translate. A run of them translates the spoken words since the run before (a round: a clause or a sentence, as
// Soniox cuts them; checked against its file API, none runs over the end of a sentence). Each sentence carries the
// translations of the rounds that began in it, joined; a round over two sentences, or two turns, is carried by the
// first.
import type { HistorySentenceInput, HistorySentenceSide, HistorySentenceTrack, FileToken } from '../types';
import { createSegmentCut } from '../capture/cut';
import { joinSegmentTexts } from '../../projection/join';

/** A silence this long between two words begins a new turn. */
export const TURN_GAP_MS = 1500;

export type FileSentence = Omit<HistorySentenceInput, 'n'>;

export interface FileSentenceOptions {
  side: HistorySentenceSide;
  sideCertain: boolean;
  track: HistorySentenceTrack;
  /** Where the track's first sample lies on the record's clock. */
  offsetMs: number;
  /** The turns' segment ids are `<idPrefix>-<turn>`, from 1. */
  idPrefix: string;
  /** The language when the words name none. */
  language?: string;
}

/** The value seen most often, the first of equals; undefined for none. */
function mostOf(values: readonly (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  let best: string | undefined;
  for (const v of values) {
    if (!v) continue;
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (best === undefined || c > (counts.get(best) ?? 0)) best = v;
  }
  return best;
}

/** A spoken word: its times are known. */
type SpokenToken = FileToken & { start_ms: number; end_ms: number };

interface Turn {
  words: SpokenToken[];
  /** The rounds that began in this turn, in order: when their first word was spoken, and their translation. */
  rounds: Array<{ at: number; text: string }>;
}

const isSpoken = (t: FileToken): t is SpokenToken =>
  t.translation_status !== 'translation' && Number.isFinite(t.start_ms) && Number.isFinite(t.end_ms);

/** The transcript's turns, each with the translations that belong to it. */
function turnsOf(tokens: readonly FileToken[]): Turn[] {
  const turns: Turn[] = [];
  /** Where the round now being spoken began: its turn and its first word's time; null until a spoken word follows a translation. */
  let roundBegan: { turn: Turn; at: number } | null = null;
  /** The turn whose translation is being read, while translated words follow one another. */
  let reading: Turn | null = null;
  for (const t of tokens) {
    if (typeof t.text !== 'string' || t.text.length === 0) continue;
    if (t.translation_status === 'translation') {
      if (!reading) {
        if (!roundBegan) continue;
        reading = roundBegan.turn;
        reading.rounds.push({ at: roundBegan.at, text: '' });
        roundBegan = null;
      }
      reading.rounds[reading.rounds.length - 1].text += t.text;
      continue;
    }
    if (!isSpoken(t)) continue;
    reading = null;
    const turn = turns[turns.length - 1];
    const last = turn?.words[turn.words.length - 1];
    if (turn && last && (t.speaker ?? '1') === (last.speaker ?? '1') && t.start_ms - last.end_ms < TURN_GAP_MS) turn.words.push(t);
    else turns.push({ words: [t], rounds: [] });
    // A word already in the language asked for is not translated, and a lone space is no word: neither begins a round.
    if (t.translation_status !== 'none' && t.text.trim()) roundBegan ??= { turn: turns[turns.length - 1], at: t.start_ms };
  }
  return turns;
}

export function fileSentences(tokens: readonly FileToken[], o: FileSentenceOptions): FileSentence[] {
  const out: FileSentence[] = [];
  turnsOf(tokens).forEach(({ words: turn, rounds }, k) => {
    let text = '';
    const pieces = [];
    const marks = [];
    for (const w of turn) {
      pieces.push({ at: text.length, len: w.text.length, startAt: o.offsetMs + w.start_ms, endAt: o.offsetMs + w.end_ms });
      text += w.text;
      marks.push({ at: o.offsetMs + w.end_ms, len: text.length });
    }
    if (!text.trim()) return;
    const first = turn[0];
    const last = turn[turn.length - 1];
    const { added } = createSegmentCut().update({
      text, final: true, openedAt: o.offsetMs + first.start_ms, marks, heard: { pieces, stableLen: text.length }, now: o.offsetMs + last.end_ms,
    });
    const language = mostOf(turn.map((w) => w.language)) ?? o.language;
    // Each round to the sentence its first word is in: the last that began by then.
    const translations: string[][] = added.map(() => []);
    for (const round of rounds) {
      if (added.length === 0) break;
      let i = 0;
      while (i + 1 < added.length && Math.round(added[i + 1].startAt) <= o.offsetMs + round.at) i += 1;
      translations[i].push(round.text);
    }
    added.forEach((s, i) => {
      const translation = joinSegmentTexts(translations[i]);
      out.push({
        segmentId: `${o.idPrefix}-${k + 1}`, side: o.side, sideCertain: o.sideCertain, track: o.track, speaker: first.speaker ?? '1',
        startMs: Math.round(s.startAt), endMs: Math.round(s.endAt), text: s.text, ...(language ? { language } : {}), timeKind: 'given',
        ...(translation ? { translation } : {}),
      });
    });
  });
  return out;
}

/** Several tracks' sentences as one transcript: in order of their start (a track's own order between equals), from 1. */
export function numberSentences(lists: ReadonlyArray<readonly FileSentence[]>): HistorySentenceInput[] {
  return lists
    .flatMap((list, l) => list.map((s, i) => ({ s, l, i })))
    .sort((a, b) => a.s.startMs - b.s.startMs || a.l - b.l || a.i - b.i)
    .map(({ s }, k) => ({ n: k + 1, ...s }));
}
