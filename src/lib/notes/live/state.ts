// src/lib/notes/live/state.ts
//
// The live notes (stage 4): their state, what each update sends, and the program's rules that fold an answer in, as
// they were tested before this port (two kinds of marks, to-dos that can be withdrawn, points anchored to sentence
// numbers, owners as sides). The notes only grow: a written point is never rewritten; the open topic takes new points until it has
// twelve, then it is closed (a backstop against a topic that never ends, not a cap: the update that takes it past twelve
// stays in it); what the model still writes into a closed topic, opening no new one, starts a topic of the same title,
// numbered; a closed topic is frozen except for an `earlier` point; a to-do may be withdrawn (the mark goes, the text
// stays). Sentences are named by their record numbers (`n`), which grow as sentences arrive.
import type { WordEntry } from '../../words/list';
import { notesNames } from '../prompts';
import type { HistorySentenceInput, HistorySentenceSide } from '../../history/types';
import type { NoteKind } from '../write';

export type LiveSentence = HistorySentenceInput & {
  /** Cut from a segment the recognizer had not finished: the text may still change (spec §5.2). */
  fromOpen: boolean;
};

export type LivePoint = {
  /** The sentence that says it. */
  n: number;
  text: string;
  kinds: NoteKind[];
  owner?: string | null;
  due?: string | null;
  /** It was a to-do until the meeting said otherwise. */
  wasTodo?: true;
  /** The model named no new sentence: moved to the nearest (kept, not shown). */
  anchorMoved?: true;
  /** Written from unfinished text (kept, not shown; counted for §12). */
  unstable?: true;
};
export type LiveTopic = { n: number; title: string; summary: string; points: LivePoint[] };
export type LiveState = { title: string | null; topics: LiveTopic[] };

/** A topic with this many points is closed (FULL). */
export const LIVE_FULL = 12;
/** The most points one update may add (BURST), and seconds of speech per point (RATE_S). */
const BURST = 3;
const RATE_MS = 20_000;
/** Sentences before the new ones, for understanding only (CONTEXT). */
const CONTEXT = 3;
/** A pause this long before a sentence is said (PAUSE_MS). */
const PAUSE_MS = 2_000;
const KINDS: readonly NoteKind[] = ['decision', 'todo', 'risk'];
const SIDE_WORDS: Record<HistorySentenceSide, string> = { mine: 'My side', other: 'Other side' };

export const emptyLive = (): LiveState => ({ title: null, topics: [] });

type Raw = Record<string, unknown>;
const isRaw = (x: unknown): x is Raw => typeof x === 'object' && x !== null && !Array.isArray(x);
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const text = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');
const optional = (x: unknown): string | null => text(x) || null;
const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

const isFull = (t: LiveTopic | undefined) => t !== undefined && t.points.length >= LIVE_FULL;

/** The to-dos still marked, by the ids the payload gives them (t1, t2, … in reading order). */
function todoIds(state: LiveState): Map<string, LivePoint> {
  const ids = new Map<string, LivePoint>();
  for (const t of state.topics) for (const p of t.points) if (p.kinds.includes('todo')) ids.set(`t${ids.size + 1}`, p);
  return ids;
}

export interface LivePayloadInput {
  state: LiveState;
  /** The sentences not yet sent. */
  fresh: readonly LiveSentence[];
  /** Every sentence so far, in the order they arrived (the fresh ones last). */
  seen: readonly LiveSentence[];
  language: { code: string };
  speakerLabel(s: LiveSentence): string;
  /** The word list: spellings to prefer (stage 5). */
  names?: readonly WordEntry[];
}

/** What one update sends: the notes so far in short form, the sentences before, the new sentences, and limits. */
export function livePayload(o: LivePayloadInput): unknown {
  const { state } = o;
  const last = state.topics[state.topics.length - 1];
  const sealed = isFull(last);
  const current = sealed ? undefined : last;
  const closed = sealed ? state.topics : state.topics.slice(0, -1);
  const firstFresh = o.fresh.length > 0 ? o.seen.findIndex((s) => s.n === o.fresh[0].n) : o.seen.length;
  const before = o.seen.slice(Math.max(0, firstFresh - CONTEXT), Math.max(0, firstFresh));
  // The silence before a sentence, in the order things were said: the two sides' sentences arrive out of turn.
  const pauseBefore = (x: LiveSentence): number => {
    let end: number | null = null;
    for (const y of o.seen) {
      if (y.startMs < x.startMs || (y.startMs === x.startMs && y.n < x.n)) end = end === null ? y.endMs : Math.max(end, y.endMs);
    }
    return end === null ? 0 : x.startMs - end;
  };
  const spokenMs = o.seen.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
  const written = state.topics.reduce((sum, t) => sum + t.points.length, 0);
  const names = notesNames(o.names);
  return {
    output_language: o.language.code,
    ...(names.length > 0 ? { names } : {}),
    title: state.title,
    closed_topics: closed.map((t) => ({ n: t.n, title: t.title })),
    current_topic: current
      ? { title: current.title, summary: current.summary, points: current.points.map((p) => (p.kinds.length > 0 ? { text: p.text, kinds: p.kinds } : p.text)) }
      : null,
    ...(sealed ? { just_closed: { title: last.title, summary: last.summary } } : {}),
    recorded: {
      decisions: closed.flatMap((t) => t.points.filter((p) => p.kinds.includes('decision')).map((p) => p.text)),
      risks: closed.flatMap((t) => t.points.filter((p) => p.kinds.includes('risk')).map((p) => p.text)),
    },
    context: before.map((s) => ({ speaker: o.speakerLabel(s), text: s.text })),
    new: o.fresh.map((s) => {
      const pause = pauseBefore(s);
      return { sid: s.n, speaker: o.speakerLabel(s), text: s.text, ...(pause >= PAUSE_MS ? { pause_before_s: Math.round(pause / 100) / 10 } : {}) };
    }),
    todos: [...todoIds(state)].map(([id, p]) => ({ id, text: p.text })),
    max_points: Math.min(BURST, Math.max(1, Math.floor(spokenMs / RATE_MS) - written)),
  };
}

export interface LiveApplyInput {
  fresh: readonly LiveSentence[];
  seen: readonly LiveSentence[];
  speakerLabel(s: LiveSentence): string;
}

/**
 * Folds one answer in. Returns the new state, or null when the answer cannot be used at all (its sentences are then
 * sent again with the next update). The state given is never changed.
 */
export function applyLive(given: LiveState, answer: unknown, o: LiveApplyInput): LiveState | null {
  if (!isRaw(answer) || o.fresh.length === 0) return null;
  const state = structuredClone(given);
  const fresh = new Map(o.fresh.map((s) => [s.n, s]));
  const freshNs = o.fresh.map((s) => s.n);

  // A to-do's owner that is only who was speaking becomes that speaker's side, and stays empty where the side was
  // only inferred (ruling 13, §5.2).
  const labelSide = new Map<string, { side: HistorySentenceSide; certain: boolean }>();
  const uncertain: Record<HistorySentenceSide, boolean> = { mine: false, other: false };
  for (const s of o.seen) {
    const key = o.speakerLabel(s).trim().toLowerCase();
    const known = labelSide.get(key);
    labelSide.set(key, { side: known?.side ?? s.side, certain: (known?.certain ?? true) && s.sideCertain });
    if (!s.sideCertain) uncertain[s.side] = true;
  }
  for (const side of ['mine', 'other'] as const) {
    const key = SIDE_WORDS[side].toLowerCase();
    if (!labelSide.has(key)) labelSide.set(key, { side, certain: !uncertain[side] });
  }
  const ownerOf = (value: unknown): string | null => {
    const owner = optional(value);
    if (owner === null) return null;
    const who = labelSide.get(owner.toLowerCase());
    return !who ? owner : who.certain ? SIDE_WORDS[who.side] : null;
  };

  /** Well-formed points, anchored to a new sentence; a point is never dropped for a bad anchor, only moved and marked. */
  const anchored = (raw: unknown[], known: Set<string>): LivePoint[] => {
    const out: LivePoint[] = [];
    for (const p of raw) {
      const said = isRaw(p) ? text(p.text) : '';
      if (!isRaw(p) || !said || known.has(said)) continue;
      known.add(said);
      let n: number;
      let moved = false;
      if (isNumber(p.sid) && fresh.has(p.sid)) n = p.sid;
      else {
        moved = true;
        const sid = p.sid;
        n = isNumber(sid) ? freshNs.reduce((a, b) => (Math.abs(b - sid) < Math.abs(a - sid) ? b : a)) : freshNs[0];
      }
      const given = [...list(p.kinds), p.kind];
      const point: LivePoint = { n, text: said, kinds: KINDS.filter((k) => given.includes(k)) };
      if (point.kinds.includes('todo')) {
        point.owner = ownerOf(p.owner);
        point.due = optional(p.due);
      }
      if (moved) point.anchorMoved = true;
      if (fresh.get(n)?.fromOpen) point.unstable = true;
      out.push(point);
    }
    return out;
  };
  const asKind = (raw: unknown, kind: NoteKind) => list(raw).filter(isRaw).map((x) => ({ ...x, kind, text: x.text ?? x.task }));

  const topics = state.topics;
  const last = topics[topics.length - 1];
  const sealed = isFull(last);
  const current = sealed ? undefined : last;
  let block: Raw = isRaw(answer.current_topic) ? answer.current_topic : {};
  let next: Raw = isRaw(answer.new_topic) ? answer.new_topic : {};
  let nextTitle = text(next.title);
  // Decisions, to-dos and risks the model listed apart are points with that kind.
  block = { ...block, add: [...list(block.add), ...asKind(block.decisions, 'decision'), ...asKind(answer.todos, 'todo'), ...asKind(answer.risks, 'risk')] };
  next = { ...next, points: [...list(next.points), ...asKind(next.decisions, 'decision')] };
  // A "next" topic that is the open one again.
  if (current && nextTitle === current.title) {
    block = { ...block, add: [...list(block.add), ...list(next.points)] };
    nextTitle = '';
  }

  // A title an earlier topic already has: kept apart by a number, (2), then (3), counted from the title without its own
  // number, so "Delivery (2)" goes on as "Delivery (3)", never "Delivery (2) (2)".
  const numbered = (title: string) => {
    const used = new Set(topics.map((t) => t.title));
    if (!used.has(title)) return title;
    const base = title.replace(/ \(\d+\)$/, '');
    let k = 2;
    while (used.has(`${base} (${k})`)) k += 1;
    return `${base} (${k})`;
  };
  let opened: LiveTopic | null = null;
  if (nextTitle) {
    nextTitle = numbered(nextTitle);
    const raw = [...(sealed ? list(block.add) : []), ...list(next.points)];
    const points = anchored(raw, new Set());
    // A title with nothing under it is not a topic.
    if (points.length > 0) opened = { n: topics.length + 1, title: nextTitle, summary: text(next.summary), points };
  }
  // Written into the topic that is already full, with no new topic opened: those points start a topic of the same
  // title, numbered (nothing written is cut, and a full topic takes nothing more but an `earlier` point).
  if (sealed && !opened) {
    const points = anchored(list(block.add), new Set(last.points.map((p) => p.text)));
    if (points.length > 0) opened = { n: topics.length + 1, title: numbered(last.title), summary: last.summary, points };
  }
  if (!last && !opened) return null;
  if (text(answer.title)) state.title = text(answer.title);

  // The open topic takes what is written into it; the update that takes it past twelve stays in it whole.
  const target = current;
  if (target) {
    const known = new Set(target.points.map((p) => p.text));
    if (opened) for (const p of opened.points) known.add(p.text);
    target.points.push(...anchored(list(block.add), known));
    // Not on a move: a summary written while the speakers move on describes the move.
    if (!opened && !sealed && text(block.summary)) target.summary = text(block.summary);
  }
  if (opened) topics.push(opened);

  const closedTopics = new Map((opened || !sealed ? topics.slice(0, -1) : topics).map((t) => [t.n, t]));
  for (const e of list(answer.earlier)) {
    const topic = isRaw(e) && isNumber(e.topic) ? closedTopics.get(e.topic) : undefined;
    if (topic) topic.points.push(...anchored([e], new Set(topic.points.map((p) => p.text))));
  }

  const ids = todoIds(given);
  const byText = new Map(topics.flatMap((t) => t.points.map((p) => [`${t.n}\u0000${p.n}\u0000${p.text}`, p] as const)));
  for (const id of list(answer.withdraw)) {
    const was = typeof id === 'string' ? ids.get(id) : undefined;
    if (!was) continue;
    // The same point in the copy being changed.
    const topicN = given.topics.find((t) => t.points.includes(was))!.n;
    const point = byText.get(`${topicN}\u0000${was.n}\u0000${was.text}`);
    if (point && point.kinds.includes('todo')) {
      point.kinds = point.kinds.filter((k) => k !== 'todo');
      point.wasTodo = true;
    }
  }
  return state;
}
