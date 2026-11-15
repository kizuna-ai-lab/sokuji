// src/lib/notes/write.ts
//
// One version of a record's notes, written the way the tested post-meeting script writes them (run_full.py in its
// decided configuration, with the names step of q4/suggest.py): the transcript in parts of about twenty minutes, one
// call per part, all at once; a finishing call that reconciles the marks across the whole recording; the names step
// beside it. The model points at sentences by their numbers; the program's own rules then hold whatever it answers:
// a point needs text, a number that is no sentence is moved to the nearest one and marked, only the three kinds are
// kept, and a todo's owner that is only a speaker label becomes that speaker's side.
import type { HistorySentence } from '../history/types';
import type { ChatPort, ChatRequest } from './chat';
import { ChatError } from './chat';
import { finishPrompt, namesPrompt, partPrompt } from './prompts';

/** Less transcript than this has nothing to write notes from: no call is made. */
export const NOTES_MIN_MS = 60_000;
/** A part's length: up to about one and a half of these is one part (the script's SEG_CHUNK_MIN=20). */
const PART_MS = 20 * 60_000;
/** The names step reads the transcript in parts of this length (q4/suggest.py). */
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

export type WriteNotesResult = { ok: true; body: NotesBody } | { ok: false; failure: string } | { ok: false; tooShort: true };

export interface WriteNotesOptions {
  sentences: readonly HistorySentence[];
  speakerLabel(s: HistorySentence): string;
  language: { code: string; name: string };
  chat: ChatPort;
  signal: AbortSignal;
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

/** The names step's parts: a new part at each twenty-minute edge (q4/suggest.py). */
function namesParts(sentences: readonly HistorySentence[]): HistorySentence[][] {
  const parts: HistorySentence[][] = [];
  let current: HistorySentence[] = [];
  let edge = NAMES_PART_MS;
  for (const s of sentences) {
    if (s.startMs >= edge && current.length > 0) {
      parts.push(current);
      current = [];
      edge += NAMES_PART_MS;
    }
    current.push(s);
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

type Asked = { ok: true; value: Raw } | { ok: false; error: unknown };

/** One call, tried again on its own when it fails; a cancellation is never retried. */
async function ask(chat: ChatPort, r: ChatRequest): Promise<Asked> {
  let error: unknown = null;
  for (let attempt = 0; attempt < TRIES; attempt++) {
    if (r.signal.aborted) throw abortError();
    try {
      const value = await chat(r);
      if (isRaw(value)) return { ok: true, value };
      error = new ChatError('The notes model answered with something other than a JSON object');
    } catch (e) {
      if (r.signal.aborted) throw abortError();
      error = e;
    }
  }
  return { ok: false, error };
}

const failureOf = (error: unknown): string => {
  if (error instanceof ChatError) return error.serviceMessage || error.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

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

  const byN = new Map(sentences.map((s) => [s.n, s]));
  const view = (s: HistorySentence) => ({ sid: s.n, speaker: o.speakerLabel(s), text: s.text });

  // An owner that is exactly a speaker label ("Other side 2") is cut back to that speaker's side: a speaker's number
  // is never an owner. The side of a label is the label without its number.
  const sideOfLabel = new Map<string, string>();
  for (const s of sentences) {
    const label = o.speakerLabel(s);
    const words = label.split(' ');
    const side = words.length > 1 && /^\d+$/.test(words[words.length - 1]) ? words.slice(0, -1).join(' ') : label;
    sideOfLabel.set(label.trim().toLowerCase(), side);
  }
  const ownerOf = (value: unknown): string | null => {
    const owner = optional(value);
    return owner === null ? null : sideOfLabel.get(owner.toLowerCase()) ?? owner;
  };

  // The parts, all at once. A part that still fails after its tries fails the version: nothing half-written is kept.
  const parts = cutParts(sentences);
  const multiPart = parts.length > 1;
  const written = await Promise.all(parts.map((part, k) => ask(chat, {
    system: partPrompt(language.name, multiPart),
    user: {
      output_language: language.code,
      sentences: part.map(view),
      ...(multiPart ? { part: { index: k + 1, of: parts.length } } : {}),
      // The script sends the live notes' marks here; the notes after the session are independent of them.
      candidates: [],
    },
    effort: 'none',
    maxTokens: PART_TOKENS,
    signal,
  })));
  const failed = written.find((r): r is { ok: false; error: unknown } => !r.ok);
  if (failed) return { ok: false, failure: failureOf(failed.error) };

  /** The sentence a point names, or the nearest one in its part when the number is no sentence. */
  const anchor = (sid: unknown, part: readonly HistorySentence[]): { n: number; moved: boolean } => {
    if (isNumber(sid) && byN.has(sid)) return { n: sid, moved: false };
    if (!isNumber(sid)) return { n: part[0].n, moved: true };
    let nearest = part[0].n;
    for (const s of part) if (Math.abs(s.n - sid) < Math.abs(nearest - sid)) nearest = s.n;
    return { n: nearest, moved: true };
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
      const named = isNumber(t.sid) && byN.has(t.sid) ? t.sid : null;
      const firstPoint = own.length > 0 ? own.reduce((a, b) => (startOf(b.n) < startOf(a.n) ? b : a)).n : null;
      const first = firstPoint === null ? named ?? parts[k][0].n
        : named !== null && startOf(named) <= startOf(firstPoint) ? named : firstPoint;
      topics.push({ n: topics.length + 1, part: k + 1, title: text(t.title), summary: text(t.summary), first, points: own });
    }
  });
  if (topics.length === 0) return { ok: false, failure: 'The notes model wrote no topics' };

  const opening = written[0].ok ? written[0].value : {};
  let title = text(opening.title);
  let overview = text(opening.summary);

  // The finishing call reconciles the marks; the names step runs beside it. Either may fail without failing the version.
  const finishing = ask(chat, {
    system: finishPrompt(language.name),
    user: {
      output_language: language.code,
      topics: topics.map((t) => ({ n: t.n, ...(multiPart ? { part: t.part } : {}), title: t.title, summary: t.summary })),
      points: topics.flatMap((t) => t.points.map((q) => ({
        id: q.id, topic: t.n, text: q.text, kinds: q.kinds,
        ...(q.kinds.includes('todo') ? { owner: q.owner ?? null, due: q.due ?? null } : {}),
      }))),
    },
    effort: 'medium',
    maxTokens: FINISH_TOKENS,
    signal,
  });
  const naming = Promise.all(namesParts(sentences).map((part) => ask(chat, {
    system: namesPrompt(),
    user: { sentences: part.map(view) },
    effort: 'medium',
    maxTokens: NAMES_TOKENS,
    signal,
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
      if (!isRaw(item) || !isNumber(item.sid) || !byN.has(item.sid)) continue;
      const writtenAs = text(item.heard);
      const likely = optional(item.meant);
      if (!writtenAs || likely === writtenAs) continue;
      const known = names.find((x) => x.written === writtenAs && x.likely === likely);
      if (!known) names.push({ written: writtenAs, likely, sentences: [item.sid] });
      else if (!known.sentences.includes(item.sid)) known.sentences.push(item.sid);
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
  return { ok: true, body };
}
