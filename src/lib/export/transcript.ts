/**
 * The export is an L3 surface over L2's groups. One block per group, each
 * segment's text whole (never its rows), one timestamp per group, a missing
 * side stated. Inferred pairs are written paired, like stated ones; the JSON
 * form keeps `pairing` so a consumer can tell them apart.
 */
import type { Leg, LegName, Segment, SegmentId } from '../conversation/types';
import type { Entry, Pairing, Row } from '../projection/types';

export interface TranscriptLabels {
  me: string;
  other: string;
  noTranslation: string;
  noSource: string;
}

export interface TranscriptOptions {
  labels: TranscriptLabels;
  formatTime: (ms: number) => string;
  /** Which sides to write. Default: both. */
  scope?: { source: boolean; translation: boolean };
}

export interface TranscriptSide { segmentIds: SegmentId[]; text: string }

export interface TranscriptGroup {
  id: string;
  leg: LegName;
  t: number;
  pairing: Pairing;
  source: TranscriptSide | null;
  translation: TranscriptSide | null;
}

/** A notice as the export writes it: the entry without its `kind`. */
export type TranscriptNotice = Omit<Extract<Entry, { kind: 'notice' }>, 'kind'>;

export interface TranscriptJson {
  groups: TranscriptGroup[];
  notices: TranscriptNotice[];
}

function segmentIndex(legs: readonly Leg[]): Map<SegmentId, Segment> {
  const index = new Map<SegmentId, Segment>();
  for (const leg of legs) for (const seg of leg.segments) index.set(seg.id, seg);
  return index;
}

/** A boundary character that takes no space next to it: Han, kana, CJK and fullwidth punctuation. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;

/** Several segments' text as one: a space between two pieces only where both sides of the
 *  boundary are space-delimited script, so Chinese and Japanese stay unspaced. */
function joinTexts(texts: string[]): string {
  let out = '';
  for (const text of texts) {
    const piece = text.trim();
    if (piece.length === 0) continue;
    if (out.length > 0 && !UNSPACED.test(out[out.length - 1]) && !UNSPACED.test(piece[0])) out += ' ';
    out += piece;
  }
  return out;
}

/** The distinct segments behind a group's rows, in row order, text whole. */
function sideOf(rows: Row[], index: Map<SegmentId, Segment>): TranscriptSide | null {
  const ids = [...new Set(rows.map((row) => row.segmentId))];
  if (ids.length === 0) return null;
  const text = joinTexts(ids.map((id) => index.get(id)?.text ?? ''));
  return { segmentIds: ids, text };
}

export function renderTranscriptJson(entries: readonly Entry[], legs: readonly Leg[]): TranscriptJson {
  const index = segmentIndex(legs);
  const groups: TranscriptGroup[] = [];
  const notices: TranscriptJson['notices'] = [];
  for (const e of entries) {
    if (e.kind === 'notice') {
      notices.push({ id: e.id, leg: e.leg, at: e.at, severity: e.severity, message: e.message, code: e.code, params: e.params });
      continue;
    }
    groups.push({ id: e.id, leg: e.leg, t: e.t, pairing: e.pairing, source: sideOf(e.source, index), translation: sideOf(e.translation, index) });
  }
  return { groups, notices };
}

export function renderTranscriptTxt(entries: readonly Entry[], legs: readonly Leg[], o: TranscriptOptions): string {
  const scope = o.scope ?? { source: true, translation: true };
  const { groups } = renderTranscriptJson(entries, legs);
  const lines: string[] = [];
  for (const g of groups) {
    lines.push(`${o.formatTime(g.t)} ${g.leg === 'speaker' ? o.labels.me : o.labels.other}`);
    if (scope.source) lines.push(`  ${g.source ? g.source.text : o.labels.noSource}`);
    if (scope.translation) lines.push(`  ${g.translation ? `→ ${g.translation.text}` : o.labels.noTranslation}`);
    lines.push('');
  }
  return lines.join('\n');
}
