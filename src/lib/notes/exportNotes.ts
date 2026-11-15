// src/lib/notes/exportNotes.ts
//
// A record's notes as a file or for the clipboard: the title, the overview, then each topic with its points, each
// point with what it is and a to-do's owner and date. The names to check are for the record page, not the export.
import type { NoteKind, NotesBody, NotesPoint } from './write';

export type NotesWords = Record<NoteKind, string>;

/** What a point is and who and when: "To do · My side · Tuesday"; empty for a plain point. */
function marks(p: NotesPoint, words: NotesWords): string {
  return [...p.kinds.map((k) => words[k]), p.owner, p.due].filter(Boolean).join(' · ');
}

const pointsOf = (body: NotesBody, topic: number) => body.points.filter((p) => p.topic === topic);

export function notesMarkdown(body: NotesBody, words: NotesWords): string {
  const lines = [`# ${body.title}`, ''];
  if (body.overview.text) lines.push(body.overview.text, '');
  body.topics.forEach((t, i) => {
    lines.push(`## ${t.title}`, '');
    if (t.summary) lines.push(t.summary, '');
    const points = pointsOf(body, i);
    for (const p of points) {
      const m = marks(p, words);
      lines.push(`- ${p.text}${m ? ` — ${m}` : ''}`);
    }
    if (points.length > 0) lines.push('');
  });
  return lines.join('\n');
}

export function notesText(body: NotesBody, words: NotesWords): string {
  const lines = [body.title, ''];
  if (body.overview.text) lines.push(body.overview.text, '');
  body.topics.forEach((t, i) => {
    lines.push(t.title);
    if (t.summary) lines.push(t.summary);
    for (const p of pointsOf(body, i)) {
      const m = marks(p, words);
      lines.push(`  - ${p.text}${m ? ` (${m})` : ''}`);
    }
    lines.push('');
  });
  return lines.join('\n');
}
