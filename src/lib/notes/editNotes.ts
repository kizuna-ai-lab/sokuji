// src/lib/notes/editNotes.ts
//
// One field of a stored notes version changed by hand, and what takes it back (design P1 §1). Edits apply to the body
// as stored: everything not edited stays exactly as it was (the names to check, where each topic starts, a point's
// sentences and kinds). Indexes are the stored arrays' own (`readNotesBody` keeps them one to one).
//
// The notes title and a topic title cannot be emptied; an emptied overview or topic summary is left empty; an emptied
// point is removed. Owner and due date belong to a to-do; an emptied one is none.
import type { HistoryNotesBody } from '../history/types';

export type NotesField =
  | { part: 'title' }
  | { part: 'overview' }
  | { part: 'topicTitle'; topic: number }
  | { part: 'topicSummary'; topic: number }
  | { part: 'point'; point: number };

export interface NotesEdit {
  field: NotesField;
  text: string;
  /** A to-do's owner and due date; ignored on any other point. */
  owner?: string | null;
  due?: string | null;
}

interface FieldValue { text: string; owner?: string | null; due?: string | null }

export type NotesUndo =
  | { kind: 'text'; field: NotesField; was: FieldValue; now: FieldValue }
  | { kind: 'removed'; at: number; point: Record<string, unknown> };

type Point = HistoryNotesBody['points'][number];

const isTodo = (p: Point) => Array.isArray(p.kinds) && (p.kinds as unknown[]).includes('todo');
const optional = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/** The field's value in `body`, or undefined when the place does not exist. */
function read(body: HistoryNotesBody, field: NotesField): FieldValue | undefined {
  switch (field.part) {
    case 'title': return { text: body.title };
    case 'overview': return { text: body.overview.text };
    case 'topicTitle': return body.topics[field.topic] ? { text: body.topics[field.topic].title } : undefined;
    case 'topicSummary': return body.topics[field.topic] ? { text: body.topics[field.topic].summary } : undefined;
    case 'point': {
      const p = body.points[field.point];
      if (!p) return undefined;
      return isTodo(p) ? { text: p.text, owner: (p.owner as string | null | undefined) ?? null, due: (p.due as string | null | undefined) ?? null } : { text: p.text };
    }
  }
}

function write(body: HistoryNotesBody, field: NotesField, v: FieldValue): void {
  switch (field.part) {
    case 'title': body.title = v.text; break;
    case 'overview': body.overview.text = v.text; break;
    case 'topicTitle': body.topics[field.topic].title = v.text; break;
    case 'topicSummary': body.topics[field.topic].summary = v.text; break;
    case 'point': {
      const p = body.points[field.point];
      p.text = v.text;
      if ('owner' in v) p.owner = v.owner ?? null;
      if ('due' in v) p.due = v.due ?? null;
      break;
    }
  }
}

const same = (a: FieldValue, b: FieldValue) => a.text === b.text && (a.owner ?? null) === (b.owner ?? null) && (a.due ?? null) === (b.due ?? null);

/** The body with `edit` made, and what takes it back; null when the place is missing, the edit refused, or nothing changes. */
export function applyNotesEdit(body: HistoryNotesBody, edit: NotesEdit): { body: HistoryNotesBody; undo: NotesUndo } | null {
  const was = read(body, edit.field);
  if (!was) return null;
  const text = edit.text.trim();
  const next = structuredClone(body);
  if (edit.field.part === 'point' && text === '') {
    const at = edit.field.point;
    const [point] = next.points.splice(at, 1);
    return { body: next, undo: { kind: 'removed', at, point: point as Record<string, unknown> } };
  }
  if ((edit.field.part === 'title' || edit.field.part === 'topicTitle') && text === '') return null;
  const now: FieldValue = 'owner' in was
    ? { text, owner: edit.owner === undefined ? was.owner : optional(edit.owner), due: edit.due === undefined ? was.due : optional(edit.due) }
    : { text };
  if (same(was, now)) return null;
  write(next, edit.field, now);
  return { body: next, undo: { kind: 'text', field: edit.field, was, now } };
}

/** `body` with `undo` taken back; null when the field no longer reads as the edit left it, or a removed point's place is gone. */
export function undoNotesEdit(body: HistoryNotesBody, undo: NotesUndo): HistoryNotesBody | null {
  const next = structuredClone(body);
  if (undo.kind === 'removed') {
    if (undo.at > next.points.length) return null;
    next.points.splice(undo.at, 0, structuredClone(undo.point) as Point);
    return next;
  }
  const current = read(next, undo.field);
  if (!current || !same(current, undo.now)) return null;
  write(next, undo.field, undo.was);
  return next;
}
