// src/lib/history/file/sentences.ts
//
// A file transcript's words (Soniox's file recognition) as the record's sentences. The words are grouped into turns —
// a new speaker, or a silence of TURN_GAP_MS, begins one — and each turn is cut by the same cutter as live text, as a
// finished segment whose words are its heard pieces: sentence ends, the cut after a pause and the 45 s cap apply alike,
// and every time is given. A turn's sentences share one segment id, so the record page shows a turn as one row.
//
// Translated words (asked for with the transcription) have no time: they follow the words they translate. A run of
// them translates the spoken words since the run before (a round), and belongs to the turn that round began in; a turn
// in which several rounds began has their translations joined. The rounds are the service's, the turns ours: a round
// over two turns is shown with the first.
import type { HistorySentenceInput, HistorySentenceSide, HistorySentenceTrack, HistoryTranslationInput, FileToken } from '../types';
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
  /** The translations of the rounds that began in this turn, in order. */
  rounds: string[];
  language?: string;
}

const isSpoken = (t: FileToken): t is SpokenToken =>
  t.translation_status !== 'translation' && Number.isFinite(t.start_ms) && Number.isFinite(t.end_ms);

/** The transcript's turns, each with the translations that belong to it. */
function turnsOf(tokens: readonly FileToken[]): Turn[] {
  const turns: Turn[] = [];
  /** The turn the round now being spoken began in; null until a spoken word follows a translation. */
  let roundBegan: Turn | null = null;
  /** The turn whose translation is being read, while translated words follow one another. */
  let reading: Turn | null = null;
  for (const t of tokens) {
    if (typeof t.text !== 'string' || t.text.length === 0) continue;
    if (t.translation_status === 'translation') {
      if (!reading) {
        reading = roundBegan;
        roundBegan = null;
        reading?.rounds.push('');
      }
      if (!reading) continue;
      reading.rounds[reading.rounds.length - 1] += t.text;
      if (t.language) reading.language = t.language;
      continue;
    }
    if (!isSpoken(t)) continue;
    reading = null;
    const turn = turns[turns.length - 1];
    const last = turn?.words[turn.words.length - 1];
    if (turn && last && (t.speaker ?? '1') === (last.speaker ?? '1') && t.start_ms - last.end_ms < TURN_GAP_MS) turn.words.push(t);
    else turns.push({ words: [t], rounds: [] });
    // A word already in the language asked for is not translated: it begins no round.
    if (t.translation_status !== 'none') roundBegan ??= turns[turns.length - 1];
  }
  return turns;
}

/** Each turn's translation, under the segment id its sentences have. */
export function fileTranslations(tokens: readonly FileToken[], o: Pick<FileSentenceOptions, 'idPrefix'>): HistoryTranslationInput[] {
  const out: HistoryTranslationInput[] = [];
  turnsOf(tokens).forEach((turn, k) => {
    const text = joinSegmentTexts(turn.rounds);
    if (text) out.push({ segmentId: `${o.idPrefix}-${k + 1}`, text, ...(turn.language ? { language: turn.language } : {}) });
  });
  return out;
}

export function fileSentences(tokens: readonly FileToken[], o: FileSentenceOptions): FileSentence[] {
  const out: FileSentence[] = [];
  turnsOf(tokens).forEach(({ words: turn }, k) => {
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
    for (const s of added) {
      out.push({
        segmentId: `${o.idPrefix}-${k + 1}`, side: o.side, sideCertain: o.sideCertain, track: o.track, speaker: first.speaker ?? '1',
        startMs: Math.round(s.startAt), endMs: Math.round(s.endAt), text: s.text, ...(language ? { language } : {}), timeKind: 'given',
      });
    }
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
