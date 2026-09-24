/**
 * The export is an L3 surface over L2's groups. One block per group, each
 * segment's text whole (never its rows), one timestamp per group, a missing
 * side stated. Inferred pairs are written paired, like stated ones; the JSON
 * form keeps `pairing` so a consumer can tell them apart.
 */
import type { Languages, Leg, LegName, Segment, SegmentId } from '../conversation/types';
import type { Entry, Pairing, Row } from '../projection/types';
import { joinSegmentTexts } from '../projection/join';
import { showsSide, type LegFilters } from '../view/filter';

export interface TranscriptLabels {
  me: string;
  other: string;
  noTranslation: string;
  noSource: string;
}

/** Which sides of each leg an export writes: the display modes' union, per leg (today's four checkboxes). */
export type TranscriptScope = LegFilters;

export const FULL_SCOPE: TranscriptScope = { speaker: 'both', participant: 'both' };

/** The scope left something out. */
export function isNarrowed(scope: TranscriptScope): boolean {
  return scope.speaker !== 'both' || scope.participant !== 'both';
}

export interface TranscriptHeaderLabels {
  title: string;
  generated: string;
  provider: string;
  models: string;
  source: string;
  target: string;
  /** Written only when the scope left something out. */
  narrowed: string;
}

/** What a file says about itself: from the conversation's own run, never the current settings. */
export interface TranscriptMeta {
  exportedAt: number;
  appVersion: string | null;
  /** The provider the conversation ran on; null before any run. */
  provider: string | null;
  models: Readonly<Record<string, string>>;
}

export interface TranscriptOptions {
  labels: TranscriptLabels;
  formatTime: (ms: number) => string;
  /** Default: everything. */
  scope?: TranscriptScope;
  /** A file's header; absent for the clipboard. */
  header?: { labels: TranscriptHeaderLabels; meta: TranscriptMeta; formatDateTime: (ms: number) => string };
}

export interface TranscriptSide { segmentIds: SegmentId[]; text: string }

export interface TranscriptGroup {
  id: string;
  leg: LegName;
  t: number;
  pairing: Pairing;
  /** absent: not in the export's scope; null: none was produced */
  source?: TranscriptSide | null;
  /** absent: not in the export's scope; null: none was produced */
  translation?: TranscriptSide | null;
}

/** A notice as the export writes it: the entry without its `kind`. */
export type TranscriptNotice = Omit<Extract<Entry, { kind: 'notice' }>, 'kind'>;

export interface TranscriptJson {
  groups: TranscriptGroup[];
  notices: TranscriptNotice[];
  exportedAt?: string;
  appVersion?: string | null;
  provider?: string | null;
  models?: Readonly<Record<string, string>>;
  languages?: Languages | null;
  /** Present only when the scope left something out. */
  scope?: TranscriptScope;
}

function segmentIndex(legs: readonly Leg[]): Map<SegmentId, Segment> {
  const index = new Map<SegmentId, Segment>();
  for (const leg of legs) for (const seg of leg.segments) index.set(seg.id, seg);
  return index;
}

/** The distinct segments behind a group's rows, in row order, text whole. */
function sideOf(rows: Row[], index: Map<SegmentId, Segment>): TranscriptSide | null {
  const ids = [...new Set(rows.map((row) => row.segmentId))];
  if (ids.length === 0) return null;
  const text = joinSegmentTexts(ids.map((id) => index.get(id)?.text ?? ''));
  return { segmentIds: ids, text };
}

const ARROW = '→';

/** The speaker's pair: the speaker leg's, or the participant's reversed when only it ran. */
function pairOf(legs: readonly Leg[]): Languages | null {
  const speaker = legs.find((leg) => leg.leg === 'speaker');
  if (speaker) return speaker.languages;
  const participant = legs.find((leg) => leg.leg === 'participant');
  return participant ? { source: participant.languages.target, target: participant.languages.source } : null;
}

function modelsLine(models: Readonly<Record<string, string>>): string {
  return Object.entries(models).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join(', ');
}

function headerLines(header: NonNullable<TranscriptOptions['header']>, legs: readonly Leg[], narrowed: boolean): string[] {
  const { labels, meta } = header;
  const lines = [labels.title, `${labels.generated}: ${header.formatDateTime(meta.exportedAt)}`];
  if (meta.provider) lines.push(`${labels.provider}: ${meta.provider}`);
  const models = modelsLine(meta.models);
  if (models) lines.push(`${labels.models}: ${models}`);
  const pair = pairOf(legs);
  if (pair) lines.push(`${labels.source}: ${pair.source} ${ARROW} ${labels.target}: ${pair.target}`);
  if (narrowed) lines.push(labels.narrowed);
  lines.push('');
  return lines;
}

export function renderTranscriptJson(
  entries: readonly Entry[],
  legs: readonly Leg[],
  o: { scope?: TranscriptScope; meta?: TranscriptMeta } = {},
): TranscriptJson {
  const scope = o.scope ?? FULL_SCOPE;
  const index = segmentIndex(legs);
  const groups: TranscriptGroup[] = [];
  const notices: TranscriptJson['notices'] = [];
  for (const e of entries) {
    if (e.kind === 'notice') {
      notices.push({ id: e.id, leg: e.leg, at: e.at, severity: e.severity, message: e.message, code: e.code, params: e.params });
      continue;
    }
    const filter = scope[e.leg];
    const group: TranscriptGroup = { id: e.id, leg: e.leg, t: e.t, pairing: e.pairing };
    if (showsSide(filter, 'source')) group.source = sideOf(e.source, index);
    if (showsSide(filter, 'translation')) group.translation = sideOf(e.translation, index);
    if (group.source == null && group.translation == null) continue;
    groups.push(group);
  }
  // A downloaded file must say what it is before thousands of groups: key
  // order here is meaningful (JSON.stringify follows insertion order), so
  // metadata is built first and groups/notices are spread in last.
  const meta: Partial<TranscriptJson> = {};
  if (o.meta) {
    meta.exportedAt = new Date(o.meta.exportedAt).toISOString();
    meta.appVersion = o.meta.appVersion;
    meta.provider = o.meta.provider;
    meta.models = o.meta.models;
    meta.languages = pairOf(legs);
  }
  if (isNarrowed(scope)) meta.scope = scope;
  return { ...meta, groups, notices };
}

export function renderTranscriptTxt(entries: readonly Entry[], legs: readonly Leg[], o: TranscriptOptions): string {
  const scope = o.scope ?? FULL_SCOPE;
  const { groups } = renderTranscriptJson(entries, legs, { scope });
  const lines: string[] = o.header ? headerLines(o.header, legs, isNarrowed(scope)) : [];
  for (const g of groups) {
    lines.push(`${o.formatTime(g.t)} ${g.leg === 'speaker' ? o.labels.me : o.labels.other}`);
    if ('source' in g) lines.push(`  ${g.source ? g.source.text : o.labels.noSource}`);
    if ('translation' in g) lines.push(`  ${g.translation ? `${ARROW} ${g.translation.text}` : o.labels.noTranslation}`);
    lines.push('');
  }
  return lines.join('\n');
}
