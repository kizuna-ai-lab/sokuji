// src/lib/history/recordView.ts
//
// A record's transcript as the record page shows it: its sentences, in reading order, grouped into rows by round
// (one stored segment) and speaker, each with the round's translation and a speaker label; and the cues of its
// subtitles.
import type { Leg, LegName } from '../conversation/types';
import type { TranscriptScope } from '../export/transcript';
import { joinSegmentTexts } from '../projection/join';
import { createProjector, DEFAULT_PROJECTION } from '../projection/project';
import type { Cue } from './subtitles';
import type { HistorySentence, HistorySentenceSide, HistoryTimeKind } from './types';

export interface SpeakerLabels {
  mine: string;
  other: string;
  /** The n-th speaker of a side, counted by first appearance, when the side has several. */
  person(side: HistorySentenceSide, n: number): string;
  /** The n-th speaker where no side is known (an imported file: everyone on one track), one speaker or several. */
  anyone(n: number): string;
}

export interface RecordRow {
  segmentId: string;
  leg: LegName;
  side: HistorySentenceSide;
  /** The effective speaker: the one the user gave, else the recognizer's. */
  speaker: string;
  speakerLabel: string;
  /** Whether the row's side is known: not for an imported file, where everyone is on one track. */
  sideKnown: boolean;
  startMs: number;
  endMs: number;
  timeKind: HistoryTimeKind;
  sentences: readonly { n: number; text: string }[];
  translation: string | null;
}

const legOf = (side: HistorySentenceSide): LegName => (side === 'mine' ? 'speaker' : 'participant');
const effective = (s: HistorySentence) => s.speakerByUser ?? s.speaker;
/** The weakest of a row's times: one estimated sentence makes the row's time estimated. */
const RANK: Record<HistoryTimeKind, number> = { given: 0, spread: 1, estimated: 2 };

export function recordRows(o: {
  sentences: readonly HistorySentence[];
  legs: readonly Leg[];
  textKind: 'original' | 'translation';
  labels: SpeakerLabels;
  /**
   * Whether the sentences' sides mean who spoke: not for an imported file, where everyone is on one track. (A
   * session's sentences keep their sides, even where the side was inferred: a shared microphone, face to face.)
   * Default: true, the sides are known.
   */
  sidesKnown?: boolean;
}): RecordRow[] {
  // The round's translation, by the source segments it pairs with (as the conversation shows it); a file transcript's
  // own, carried by its sentences, when it has them: a row shows its sentences' translations. A transcript cut from the
  // translation has none: its sentences already are the translation.
  const translationOf = new Map<string, string>();
  // A transcript is a file's (its sentences carry translations) or a session's (they never do), never a mix of the two.
  const carried = o.textKind === 'original' && o.sentences.some((s) => s.translation);
  if (o.textKind === 'original' && !carried && o.legs.length > 0) {
    for (const e of createProjector().project(o.legs, DEFAULT_PROJECTION)) {
      if (e.kind !== 'exchange') continue;
      const text = joinSegmentTexts(e.translation.map((r) => r.text));
      if (!text) continue;
      for (const r of e.source) if (!translationOf.has(r.segmentId)) translationOf.set(r.segmentId, text);
    }
  }

  // Speakers per side by first appearance, and the names given to them.
  const order: Record<HistorySentenceSide, string[]> = { mine: [], other: [] };
  const names = new Map<string, string>();
  for (const s of o.sentences) {
    const who = effective(s);
    if (!order[s.side].includes(who)) order[s.side].push(who);
    if (s.speakerName) names.set(`${s.side}\u0000${who}`, s.speakerName);
  }
  // An imported file's speakers are named by number, not by a side.
  const sidesKnown = o.sidesKnown ?? true;
  const labelOf = (side: HistorySentenceSide, who: string) => {
    const named = names.get(`${side}\u0000${who}`);
    if (named) return named;
    const n = order[side].indexOf(who) + 1;
    if (!sidesKnown) return o.labels.anyone(n);
    return order[side].length >= 2 ? o.labels.person(side, n) : side === 'mine' ? o.labels.mine : o.labels.other;
  };

  const rows: RecordRow[] = [];
  const translated = new Set<string>();
  for (const s of o.sentences) {
    const who = effective(s);
    const last = rows[rows.length - 1];
    if (last && s.segmentId !== null && last.segmentId === s.segmentId && last.speaker === who && last.side === s.side) {
      rows[rows.length - 1] = {
        ...last,
        endMs: Math.max(last.endMs, s.endMs),
        timeKind: RANK[s.timeKind] > RANK[last.timeKind] ? s.timeKind : last.timeKind,
        sentences: [...last.sentences, { n: s.n, text: s.text }],
        ...(carried && s.translation ? { translation: joinSegmentTexts([last.translation ?? '', s.translation]) } : {}),
      };
      continue;
    }
    const segmentId = s.segmentId ?? `n${s.n}`;
    // A round split between speakers shows its translation once, on its first row.
    const translation = carried ? s.translation || null
      : s.segmentId !== null && !translated.has(s.segmentId) ? translationOf.get(s.segmentId) ?? null : null;
    if (s.segmentId !== null) translated.add(s.segmentId);
    rows.push({
      segmentId, leg: legOf(s.side), side: s.side, speaker: who, speakerLabel: labelOf(s.side, who), sideKnown: sidesKnown,
      startMs: s.startMs, endMs: s.endMs, timeKind: s.timeKind, sentences: [{ n: s.n, text: s.text }], translation,
    });
  }
  return rows;
}

/** Chinese and Japanese characters and their punctuation: written without spaces between sentences. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;

/** A row's sentences as they stood in the segment: a space between them, none between Chinese or Japanese ones. */
function joinSentences(sentences: readonly { text: string }[]): string {
  let out = '';
  for (const { text } of sentences) {
    if (!text) continue;
    const before = [...out].pop();
    const after = [...text][0];
    out += out && !(before && UNSPACED.test(before) && after && UNSPACED.test(after)) ? ` ${text}` : text;
  }
  return out;
}

export function recordCues(rows: readonly RecordRow[], scope: TranscriptScope): Cue[] {
  const cues: Cue[] = [];
  for (const r of rows) {
    const show = scope[r.leg];
    if (show === 'none') continue;
    const lines: string[] = [];
    if (show === 'both' || show === 'source') lines.push(joinSentences(r.sentences));
    if ((show === 'both' || show === 'translation') && r.translation) lines.push(r.translation);
    cues.push({ startMs: r.startMs, endMs: r.endMs, lines });
  }
  return cues;
}
