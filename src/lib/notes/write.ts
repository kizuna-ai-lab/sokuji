// src/lib/notes/write.ts
//
// One version of a record's notes, written the way the tested post-meeting scripts write them (in their decided
// configuration, with their names step): the transcript in parts of about twenty minutes, one
// call per part, all at once; a finishing call that reconciles the marks across the whole recording; the names step
// beside it. The model points at sentences by their numbers; the program's own rules then hold whatever it answers:
// a point needs text, a number that is no sentence is moved to the nearest one and marked, only the three kinds are
// kept, and a todo's owner that is only a speaker label becomes that speaker's side.
import type { WordEntry } from '../words/list';
import type { HistorySentence, HistorySentenceSide } from '../history/types';
import type { ChatPort, ChatRequest } from './chat';
import { ChatError } from './chat';
import { finishPrompt, namesPrompt, partPrompt, notesNames } from './prompts';
import { activePrompts, type NotesPrompts } from './promptSource';

/** Less transcript than this has nothing to write notes from: no call is made. */
export const NOTES_MIN_MS = 60_000;
/** A part's length: up to about one and a half of these is one part (the script's SEG_CHUNK_MIN=20). */
const PART_MS = 20 * 60_000;
/** The names step reads the transcript in parts of this length (as measured). */
const NAMES_PART_MS = 20 * 60_000;
/** A call is tried this many times in all (the script's RETRIES = 2). */
const TRIES = 3;
const PART_TOKENS = 32_000;
const FINISH_TOKENS = 12_000;
const NAMES_TOKENS = 8_000;

export type NoteKind = 'decision' | 'todo' | 'risk';
const KINDS: readonly NoteKind[] = ['decision', 'todo', 'risk'];

/** Where a topic starts: the number of its first sentence. */
export type NotesTopic = { title: string; summary: string; first: number };
/** A point of the notes. `topic` is its topic's index in `topics`; `sentences` the numbers of what says it. */
export type NotesPoint = {
  topic: number;
  text: string;
  sentences: number[];
  kinds: NoteKind[];
  owner?: string | null;
  due?: string | null;
  /** Marks the finishing call took off: the point stays, the mark goes. */
  was?: NoteKind[];
  /** The model named no sentence that exists: the point was moved to the nearest one (kept, not shown). */
  anchorMoved?: true;
};
/** A name or term the recognizer has probably written wrong. `likely` is null when what was meant is unclear. */
export type NotesName = { written: string; likely: string | null; sentences: number[]; dismissed?: true };
export type NotesBody = {
  title: string;
  overview: { text: string; format: 'plain' };
  topics: NotesTopic[];
  points: NotesPoint[];
  names: NotesName[];
};

const listOr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * A stored body as the record page and the exports read it. A body from elsewhere may leave out a list: a point
 * without its kinds reads as a plain point, without its sentences as one that names none.
 */
export function readNotesBody(stored: unknown): NotesBody {
  const b = stored as NotesBody;
  return {
    ...b,
    topics: listOr<NotesTopic>(b.topics),
    points: listOr<NotesPoint>(b.points).map((p) => ({ ...p, kinds: listOr<NoteKind>(p.kinds), sentences: listOr<number>(p.sentences) })),
    names: listOr<NotesName>(b.names),
  };
}

/** `requestIds`: the service's ids of every answer the version got (a hosted relay bills by them). */
export type WriteNotesResult =
  | { ok: true; body: NotesBody; requestIds: string[] }
  | { ok: false; failure: string; requestIds: string[] }
  | { ok: false; tooShort: true };

export interface WriteNotesOptions {
  sentences: readonly HistorySentence[];
  speakerLabel(s: HistorySentence): string;
  language: { code: string; name: string };
  chat: ChatPort;
  signal: AbortSignal;
  /** Filled with the request ids as answers come, so they are known even when the version is cancelled. */
  requestIds?: string[];
  /** The word list: spellings every call is asked to prefer (stage 5). */
  names?: readonly WordEntry[];
  /** The prompts every call of this version uses; absent: those in use now. */
  prompts?: NotesPrompts;
}

type Raw = Record<string, unknown>;
const isRaw = (x: unknown): x is Raw => typeof x === 'object' && x !== null && !Array.isArray(x);
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const text = (x: unknown): string => (typeof x === 'string' ? x.trim() : typeof x === 'number' ? String(x) : '');
const optional = (x: unknown): string | null => text(x) || null;
const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

const abortError = () => new DOMException('Writing the notes was cancelled', 'AbortError');

/**
 * The transcript in parts: one part up to about thirty minutes; longer, `round(total / 20 min)` parts, each cut at the
 * longest pause within 20 min / 6 of its mark (the script's rule, without live topic starts).
 */
export function cutParts(sentences: readonly HistorySentence[]): HistorySentence[][] {
  if (sentences.length === 0) return [];
  const total = Math.max(...sentences.map((s) => s.endMs));
  const count = Math.max(1, Math.round(total / PART_MS));
  const cuts: number[] = [];
  for (let k = 1; k < count; k++) {
    const target = (total * k) / count;
    let at = -1;
    let longest = -Infinity;
    for (let j = 1; j < sentences.length; j++) {
      if (Math.abs(sentences[j].startMs - target) > PART_MS / 6) continue;
      const pause = sentences[j].startMs - sentences[j - 1].endMs;
      if (pause > longest) {
        longest = pause;
        at = j;
      }
    }
    if (at < 0) at = sentences.findIndex((s) => s.startMs >= target);
    if (at > (cuts.length > 0 ? cuts[cuts.length - 1] : 0) && at < sentences.length) cuts.push(at);
  }
  const bounds = [0, ...cuts, sentences.length];
  return bounds.slice(1).map((end, i) => sentences.slice(bounds[i], end));
}

/**
 * The names step's parts: a new part at each twenty-minute edge (as measured). After a silence the next edge is the
 * one after the sentence that opens the part, so twenty minutes with no sentence make no part.
 */
function namesParts(sentences: readonly HistorySentence[]): HistorySentence[][] {
  const parts: HistorySentence[][] = [];
  let current: HistorySentence[] = [];
  let edge = NAMES_PART_MS;
  for (const s of sentences) {
    if (s.startMs >= edge) {
      if (current.length > 0) parts.push(current);
      current = [];
      edge = (Math.floor(s.startMs / NAMES_PART_MS) + 1) * NAMES_PART_MS;
    }
    current.push(s);
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

type Asked = { ok: true; value: Raw } | { ok: false; error: unknown };

/**
 * One call, tried again on its own when it fails or its answer is of no use (`usable`); a cancellation, and a
 * refusal another try cannot fix, are never retried.
 */
async function ask(chat: ChatPort, r: ChatRequest, usable: (value: Raw) => boolean = () => true): Promise<Asked> {
  let error: unknown = null;
  for (let attempt = 0; attempt < TRIES; attempt++) {
    if (r.signal.aborted) throw abortError();
    try {
      const value = await chat(r);
      if (isRaw(value) && usable(value)) return { ok: true, value };
      error = isRaw(value)
        ? new ChatError('The notes model wrote no topic', { code: 'no-topics' })
        : new ChatError('The notes model answered with something other than a JSON object', { code: 'not-json' });
    } catch (e) {
      if (r.signal.aborted) throw abortError();
      error = e;
      if (e instanceof ChatError && !e.retryable) break;
    }
  }
  return { ok: false, error };
}

/**
 * What went wrong, for the version: a reason with a code of ours as that code, which the page words in the
 * interface's language (`notes:<code>`); else the service's own words when it gave any; else its status.
 */
const failureOf = (error: unknown): string => {
  if (error instanceof ChatError) return error.code ? `notes:${error.code}` : error.serviceMessage || (error.status ? `notes:refused:${error.status}` : error.message);
  if (error instanceof TypeError) return 'notes:network';
  if (error instanceof Error) return error.message;
  return String(error);
};

/** A part's answer is of use when it has at least one topic with a title. */
const hasTopic = (value: Raw) => list(value.topics).some((t) => isRaw(t) && text(t.title) !== '');

const SIDE_WORDS: Record<HistorySentenceSide, string> = { mine: 'My side', other: 'Other side' };

interface Point {
  id: string;
  n: number;
  text: string;
  kinds: NoteKind[];
  owner?: string | null;
  due?: string | null;
  was?: NoteKind[];
  anchorMoved?: true;
}

interface Topic {
  n: number;
  part: number;
  title: string;
  summary: string;
  first: number;
  points: Point[];
}

export async function writeNotes(o: WriteNotesOptions): Promise<WriteNotesResult> {
  const { sentences, chat, signal, language } = o;
  if (signal.aborted) throw abortError();
  if (sentences.length === 0) return { ok: false, tooShort: true };
  const span = Math.max(...sentences.map((s) => s.endMs)) - Math.min(...sentences.map((s) => s.startMs));
  if (span < NOTES_MIN_MS) return { ok: false, tooShort: true };

  const requestIds = o.requestIds ?? [];
  const onAnswered = (info: { requestId?: string }) => { if (info.requestId) requestIds.push(info.requestId); };
  const outcome = <T extends object>(r: T) => ({ ...r, requestIds: [...requestIds] });

  // The model numbers sentences by their places in reading order (spec §4, as every test ran); the store's numbers
  // follow the order sentences were finalized, which differs when both sides speak. Places are mapped back to them.
  const ordered = [...sentences].sort((a, b) => a.startMs - b.startMs || a.n - b.n);
  const placeOf = new Map(ordered.map((s, i) => [s.n, i + 1]));
  const atPlace = (sid: unknown): HistorySentence | null =>
    (isNumber(sid) && Number.isInteger(sid) && sid >= 1 && sid <= ordered.length ? ordered[sid - 1] : null);
  const byN = new Map(sentences.map((s) => [s.n, s]));
  const view = (s: HistorySentence) => ({ sid: placeOf.get(s.n)!, speaker: o.speakerLabel(s), text: s.text });

  // A todo's owner that is only who was speaking (a speaker's label, named or numbered, or a side word) is cut back
  // to that speaker's side, and left empty where the side was only inferred (ruling 13, §5.2).
  const labelSide = new Map<string, { side: HistorySentenceSide; certain: boolean }>();
  const uncertain: Record<HistorySentenceSide, boolean> = { mine: false, other: false };
  for (const s of sentences) {
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
    if (!who) return owner;
    return who.certain ? SIDE_WORDS[who.side] : null;
  };

  const prompts = o.prompts ?? activePrompts().notes;
  const preferred = notesNames(o.names);
  const withNames = preferred.length > 0 ? { names: preferred } : {};
  // The parts, all at once. A part that still fails after its tries fails the version: nothing half-written is kept.
  const parts = cutParts(ordered);
  const multiPart = parts.length > 1;
  const written = await Promise.all(parts.map((part, k) => ask(chat, {
    system: partPrompt(language.name, multiPart, prompts),
    prompt: multiPart ? 'meeting-part' : 'whole-meeting',
    promptVersion: prompts.version,
    user: {
      output_language: language.code,
      sentences: part.map(view),
      ...(multiPart ? { part: { index: k + 1, of: parts.length } } : {}),
      // The script sends the live notes' marks here; the notes after the session are independent of them.
      candidates: [],
      ...withNames,
    },
    // A little reasoning keeps the notes in the language asked for when the speech is in another (owner, 2026-11-18):
    // with none, Japanese speech asked for in Chinese came out in Japanese or Traditional Chinese in most runs.
    effort: 'low',
    maxTokens: PART_TOKENS,
    signal,
    onAnswered,
  }, hasTopic)));
  const failed = written.find((r): r is { ok: false; error: unknown } => !r.ok);
  if (failed) return outcome({ ok: false as const, failure: failureOf(failed.error) });

  /** The sentence a point names, or the nearest one in its part when the number is no sentence. */
  const anchor = (sid: unknown, part: readonly HistorySentence[]): { n: number; moved: boolean } => {
    const at = atPlace(sid);
    if (at) return { n: at.n, moved: false };
    if (!isNumber(sid)) return { n: part[0].n, moved: true };
    let nearest = part[0];
    for (const s of part) if (Math.abs(placeOf.get(s.n)! - sid) < Math.abs(placeOf.get(nearest.n)! - sid)) nearest = s;
    return { n: nearest.n, moved: true };
  };

  const topics: Topic[] = [];
  const points = new Map<string, Point>();
  written.forEach((r, k) => {
    if (!r.ok) return;
    for (const t of list(r.value.topics)) {
      if (!isRaw(t) || !text(t.title)) continue;
      const own: Point[] = [];
      for (const p of list(t.points)) {
        const said = isRaw(p) ? text(p.text) : '';
        if (!isRaw(p) || !said) continue;
        const { n, moved } = anchor(p.sid, parts[k]);
        const given = list(p.kinds);
        const point: Point = { id: `p${points.size + 1}`, n, text: said, kinds: KINDS.filter((kind) => given.includes(kind)) };
        if (point.kinds.includes('todo')) {
          point.owner = ownerOf(p.owner);
          point.due = optional(p.due);
        }
        if (moved) point.anchorMoved = true;
        points.set(point.id, point);
        own.push(point);
      }
      // A topic starts at the sentence the model named, when that is a sentence and not after the topic's first point;
      // otherwise at its first point. A topic without points keeps the sentence it named, or its part's first.
      const startOf = (n: number) => byN.get(n)!.startMs;
      const named = atPlace(t.sid)?.n ?? null;
      const firstPoint = own.length > 0 ? own.reduce((a, b) => (startOf(b.n) < startOf(a.n) ? b : a)).n : null;
      const first = firstPoint === null ? named ?? parts[k][0].n
        : named !== null && startOf(named) <= startOf(firstPoint) ? named : firstPoint;
      topics.push({ n: topics.length + 1, part: k + 1, title: text(t.title), summary: text(t.summary), first, points: own });
    }
  });
  if (topics.length === 0) return outcome({ ok: false as const, failure: 'notes:no-topics' });

  const opening = written[0].ok ? written[0].value : {};
  let title = text(opening.title);
  let overview = text(opening.summary);

  // The finishing call reconciles the marks; the names step runs beside it. Either may fail without failing the version.
  const finishing = ask(chat, {
    system: finishPrompt(language.name, prompts),
    prompt: 'combine-parts',
    promptVersion: prompts.version,
    user: {
      output_language: language.code,
      topics: topics.map((t) => ({ n: t.n, ...(multiPart ? { part: t.part } : {}), title: t.title, summary: t.summary })),
      points: topics.flatMap((t) => t.points.map((q) => ({
        id: q.id, topic: t.n, text: q.text, kinds: q.kinds,
        ...(q.kinds.includes('todo') ? { owner: q.owner ?? null, due: q.due ?? null } : {}),
      }))),
      ...withNames,
    },
    effort: 'medium',
    maxTokens: FINISH_TOKENS,
    signal,
    onAnswered,
  });
  const naming = Promise.all(namesParts(ordered).map((part) => ask(chat, {
    system: namesPrompt(prompts),
    prompt: 'check-names',
    promptVersion: prompts.version,
    user: { sentences: part.map(view), ...withNames },
    effort: 'medium',
    maxTokens: NAMES_TOKENS,
    signal,
    onAnswered,
  })));
  const [finished, named] = await Promise.all([finishing, naming]);

  if (finished.ok) {
    const m = finished.value;
    if (multiPart) {
      title = text(m.title) || title;
      overview = text(m.summary) || overview;
      const byTopicN = new Map(topics.map((t) => [t.n, t]));
      for (const j of list(m.join)) {
        const a = isRaw(j) ? byTopicN.get(j.first as number) : undefined;
        const b = isRaw(j) ? byTopicN.get(j.second as number) : undefined;
        // Only the last topic of one part with the first topic of the next.
        if (!isRaw(j) || !a || !b || b.n !== a.n + 1 || b.part !== a.part + 1 || !topics.includes(a) || !topics.includes(b)) continue;
        a.points.push(...b.points);
        a.title = text(j.title) || a.title;
        a.summary = text(j.summary) || a.summary;
        topics.splice(topics.indexOf(b), 1);
      }
    }
    for (const d of list(m.drop)) {
      const q = isRaw(d) && typeof d.id === 'string' ? points.get(d.id) : undefined;
      const kind = isRaw(d) ? (d.kind as NoteKind) : undefined;
      if (!q || !kind || !q.kinds.includes(kind)) continue;
      q.kinds = q.kinds.filter((x) => x !== kind);
      (q.was ??= []).push(kind);
    }
    for (const g of list(m.merge)) {
      if (!isRaw(g) || !KINDS.includes(g.kind as NoteKind)) continue;
      const kind = g.kind as NoteKind;
      const keep = typeof g.keep === 'string' ? points.get(g.keep) : undefined;
      const same = list(g.same).filter((id): id is string => typeof id === 'string' && id !== g.keep && points.has(id)).map((id) => points.get(id)!);
      if (!keep || !keep.kinds.includes(kind) || same.length === 0) continue;
      if (text(g.text)) keep.text = text(g.text); // the thing once, in its final state
      if (kind === 'todo') {
        keep.owner = ownerOf('owner' in g ? g.owner : keep.owner);
        keep.due = optional('due' in g ? g.due : keep.due);
      }
      for (const q of same) {
        if (!q.kinds.includes(kind)) continue;
        q.kinds = q.kinds.filter((x) => x !== kind);
        (q.was ??= []).push(kind);
      }
    }
  }

  // Names: one entry per written form and suggestion, pointing at every sentence it was listed for. A suggestion
  // that is what is written already, or a number that is no sentence, is left out.
  const names: NotesName[] = [];
  for (const r of named) {
    if (!r.ok) continue;
    for (const item of list(r.value.items)) {
      const at = isRaw(item) ? atPlace(item.sid) : null;
      if (!isRaw(item) || !at) continue;
      const writtenAs = text(item.heard);
      const likely = optional(item.meant);
      if (!writtenAs || likely === writtenAs) continue;
      const known = names.find((x) => x.written === writtenAs && x.likely === likely);
      if (!known) names.push({ written: writtenAs, likely, sentences: [at.n] });
      else if (!known.sentences.includes(at.n)) known.sentences.push(at.n);
    }
  }

  const body: NotesBody = {
    title,
    overview: { text: overview, format: 'plain' },
    topics: topics.map((t) => ({ title: t.title, summary: t.summary, first: t.first })),
    points: topics.flatMap((t, index) => t.points.map((q): NotesPoint => ({
      topic: index,
      text: q.text,
      sentences: [q.n],
      kinds: q.kinds,
      ...(q.owner !== undefined ? { owner: q.owner } : {}),
      ...(q.due !== undefined ? { due: q.due } : {}),
      ...(q.was ? { was: q.was } : {}),
      ...(q.anchorMoved ? { anchorMoved: true as const } : {}),
    }))),
    names,
  };
  return outcome({ ok: true as const, body });
}
