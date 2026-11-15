// src/lib/history/file/sentences.ts
//
// A file transcript's words (Soniox's file recognition) as the record's sentences. The words are grouped into turns —
// a new speaker, or a silence of TURN_GAP_MS, begins one — and each turn is cut by the same cutter as live text, as a
// finished segment whose words are its heard pieces: sentence ends, the cut after a pause and the 45 s cap apply alike,
// and every time is given. A turn's sentences share one segment id, so the record page shows a turn as one row.
import type { HistorySentenceInput, HistorySentenceSide, HistorySentenceTrack, FileToken } from '../types';
import { createSegmentCut } from '../capture/cut';

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

export function fileSentences(tokens: readonly FileToken[], o: FileSentenceOptions): FileSentence[] {
  const words = tokens.filter((t) => typeof t.text === 'string' && t.text.length > 0);
  const turns: FileToken[][] = [];
  for (const w of words) {
    const turn = turns[turns.length - 1];
    const last = turn?.[turn.length - 1];
    if (last && (w.speaker ?? '1') === (last.speaker ?? '1') && w.start_ms - last.end_ms < TURN_GAP_MS) turn.push(w);
    else turns.push([w]);
  }

  const out: FileSentence[] = [];
  turns.forEach((turn, k) => {
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
