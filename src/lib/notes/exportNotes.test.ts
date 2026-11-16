// A record's notes as Markdown and as plain text.
import { describe, it, expect } from 'vitest';
import { notesMarkdown, notesText } from './exportNotes';
import { readNotesBody, type NotesBody } from './write';

const BODY: NotesBody = {
  title: 'Supplier sync',
  overview: { text: 'Delivery and packaging.', format: 'plain' },
  topics: [{ title: 'Delivery', summary: 'The date.', first: 1 }, { title: 'Packaging', summary: '', first: 5 }],
  points: [
    { topic: 0, text: 'Ships next Tuesday', sentences: [2], kinds: ['decision'] },
    { topic: 0, text: 'Send the tracking number', sentences: [3], kinds: ['todo'], owner: 'My side', due: 'Tuesday' },
    { topic: 1, text: 'The boxes were redone', sentences: [6], kinds: [], was: ['todo'], owner: 'Other side', due: 'Monday' },
  ],
  names: [{ written: 'Soku G', likely: 'Sokuji', sentences: [4] }],
};
const WORDS = { decision: 'Decision', todo: 'To do', risk: 'Risk', mySide: 'My side', otherSide: 'The other side' };

describe('the notes exported', () => {
  it('as Markdown: the title, the overview, each topic and its points with what they are', () => {
    expect(notesMarkdown(BODY, WORDS)).toBe([
      '# Supplier sync', '', 'Delivery and packaging.', '',
      '## Delivery', '', 'The date.', '',
      '- Ships next Tuesday — Decision',
      '- Send the tracking number — To do · My side · Tuesday', '',
      '## Packaging', '',
      '- The boxes were redone', '',
    ].join('\n'));
  });

  it('as plain text, the same in lines', () => {
    expect(notesText(BODY, WORDS)).toBe([
      'Supplier sync', '', 'Delivery and packaging.', '',
      'Delivery', 'The date.',
      '  - Ships next Tuesday (Decision)',
      '  - Send the tracking number (To do · My side · Tuesday)', '',
      'Packaging',
      '  - The boxes were redone', '',
    ].join('\n'));
  });

  it("writes a side as the interface names it, and an owner only for a to-do", () => {
    const body: NotesBody = { ...BODY, points: [{ topic: 0, text: 'Send it', sentences: [2], kinds: ['todo'], owner: 'Other side', due: null }] };
    expect(notesText(body, WORDS)).toContain('  - Send it (To do · The other side)');
    expect(notesText(BODY, WORDS)).toContain('  - The boxes were redone\n');
  });

  // Review: a stored body from elsewhere can leave out a point's kinds; the export must not throw on it.
  it('reads a stored point with no kinds or sentences as a plain point', () => {
    const stored = { ...BODY, points: [{ topic: 0, text: 'Ships next Tuesday' }], topics: [BODY.topics[0]] } as unknown;
    const body = readNotesBody(stored);
    expect(body.points[0]).toMatchObject({ kinds: [], sentences: [] });
    expect(notesText(body, WORDS)).toContain('Ships next Tuesday');
  });
});
