/**
 * L2 — session-wide, runs once: cut every segment into rows, group rows by
 * origin (stated, else inferred, else alone), order groups by time. Incremental:
 * a segment object that did not change keeps its rows; an entry whose inputs
 * did not change keeps its identity; identical input yields the same array.
 */
import type { Leg, Segment, SegmentId } from '../conversation/types';
import { cutSegment } from './cut';
import { DEFAULT_PAIRING, inferPairs } from './pair';
import type { CutSettings, Entry, PairingThresholds, ProjectionSettings, Row } from './types';

export const DEFAULT_PROJECTION: ProjectionSettings = { mode: 'off', sentencesPerRow: 0, pauseMs: 0, pairing: DEFAULT_PAIRING };

export interface Projector {
  project(legs: readonly Leg[], settings: ProjectionSettings): readonly Entry[];
}

type Exchange = Extract<Entry, { kind: 'exchange' }>;

interface Group { id: string; pairing: Exchange['pairing']; source: Segment[]; translation: Segment[]; t: number }

export function createProjector(): Projector {
  const rows = new WeakMap<Segment, { cut: CutSettings; rows: Row[] }>();
  const pairs = new WeakMap<readonly Segment[], { thresholds: PairingThresholds; map: Map<SegmentId, SegmentId> }>();
  let entries = new Map<string, Entry>();
  let last: readonly Entry[] = [];

  const rowsOf = (seg: Segment, cut: CutSettings): Row[] => {
    const hit = rows.get(seg);
    if (hit && sameCut(hit.cut, cut)) return hit.rows;
    const fresh = cutSegment(seg, cut);
    rows.set(seg, { cut, rows: fresh });
    return fresh;
  };

  const pairsOf = (leg: Leg, thresholds: PairingThresholds): Map<SegmentId, SegmentId> => {
    const hit = pairs.get(leg.segments);
    if (hit && hit.thresholds === thresholds) return hit.map;
    const map = inferPairs(leg.segments, thresholds);
    pairs.set(leg.segments, { thresholds, map });
    return map;
  };

  return {
    project(legs, settings) {
      const cut: CutSettings = { mode: settings.mode, sentencesPerRow: settings.sentencesPerRow, pauseMs: settings.pauseMs };
      const kept = new Map<string, Entry>();
      const next: Entry[] = [];
      for (const leg of legs) {
        for (const group of groupsOf(leg, pairsOf(leg, settings.pairing))) {
          const candidate: Exchange = {
            kind: 'exchange', id: group.id, leg: leg.leg, languages: leg.languages, pairing: group.pairing,
            source: group.source.flatMap((s) => rowsOf(s, cut)),
            translation: group.translation.flatMap((s) => rowsOf(s, cut)),
            t: group.t,
          };
          next.push(reuse(entries, kept, candidate));
        }
        for (const notice of leg.notices) {
          next.push(reuse(entries, kept, { kind: 'notice', id: `${leg.leg}:n:${notice.id}`, leg: leg.leg, severity: notice.severity, message: notice.message, code: notice.code, at: notice.at }));
        }
      }
      entries = kept;
      next.sort((a, b) => timeOf(a) - timeOf(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      if (next.length === last.length && next.every((e, i) => e === last[i])) return last;
      last = next;
      return next;
    },
  };
}

function groupsOf(leg: Leg, inferred: Map<SegmentId, SegmentId>): Group[] {
  const byId = new Map<string, Group>();
  const order: Group[] = [];
  const get = (id: string, pairing: Exchange['pairing']): Group => {
    let g = byId.get(id);
    if (!g) {
      g = { id, pairing, source: [], translation: [], t: Infinity };
      byId.set(id, g);
      order.push(g);
    }
    return g;
  };
  const pairedSources = new Set(inferred.values());
  for (const seg of leg.segments) {
    let g: Group;
    if (seg.origin !== undefined) g = get(`${leg.session}:${leg.leg}:o:${seg.origin}`, 'stated');
    else if (seg.side === 'translation' && inferred.has(seg.id)) g = get(`${leg.leg}:s:${inferred.get(seg.id)}`, 'inferred');
    else if (seg.side === 'source' && pairedSources.has(seg.id)) g = get(`${leg.leg}:s:${seg.id}`, 'inferred');
    else g = get(`${leg.leg}:s:${seg.id}`, 'none');
    (seg.side === 'source' ? g.source : g.translation).push(seg);
    g.t = Math.min(g.t, seg.openedAt);
  }
  return order;
}

function timeOf(e: Entry): number { return e.kind === 'exchange' ? e.t : e.at; }

function sameCut(a: CutSettings, b: CutSettings): boolean {
  return a.mode === b.mode && a.sentencesPerRow === b.sentencesPerRow && a.pauseMs === b.pauseMs;
}

/** The previous call's entry when nothing about it changed, else the candidate. Either way
 *  it is recorded in `kept`, so the cache holds exactly the last output — no orphans. */
function reuse(prev: Map<string, Entry>, kept: Map<string, Entry>, candidate: Entry): Entry {
  const old = prev.get(candidate.id);
  const entry = old && sameEntry(old, candidate) ? old : candidate;
  kept.set(candidate.id, entry);
  return entry;
}

function sameEntry(a: Entry, b: Entry): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'notice' && b.kind === 'notice') {
    return a.at === b.at && a.severity === b.severity && a.message === b.message && a.code === b.code && a.leg === b.leg;
  }
  if (a.kind === 'exchange' && b.kind === 'exchange') {
    // Languages by value: a Leg snapshot may be rebuilt around the same segments.
    return a.leg === b.leg && a.languages.source === b.languages.source && a.languages.target === b.languages.target
      && a.pairing === b.pairing && a.t === b.t
      && sameRows(a.source, b.source) && sameRows(a.translation, b.translation);
  }
  return false;
}

function sameRows(a: readonly Row[], b: readonly Row[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x !== y && (x.key !== y.key || x.segmentId !== y.segmentId || x.side !== y.side || x.start !== y.start || x.end !== y.end)) return false;
  }
  return true;
}
