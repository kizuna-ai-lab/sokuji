// A record's notes as Markdown and as plain text.
import { describe, it, expect } from 'vitest';
import { notesMarkdown, notesText } from './exportNotes';
import type { NotesBody } from './write';

const BODY: NotesBody = {
  title: 'Supplier sync',
  overview: { text: 'Delivery and packaging.', format: 'plain' },
  topics: [{ title: 'Delivery', summary: 'The date.', first: 1 }, { title: 'Packaging', summary: '', first: 5 }],
  points: [
    { topic: 0, text: 'Ships next Tuesday', sentences: [2], kinds: ['decision'] },
    { topic: 0, text: 'Send the tracking number', sentences: [3], kinds: ['todo'], owner: 'My side', due: 'Tuesday' },
    { topic: 1, text: 'The boxes were redone', sentences: [6], kinds: [], was: ['todo'] },
  ],
  names: [{ written: 'Soku G', likely: 'Sokuji', sentences: [4] }],
};
const WORDS = { decision: 'Decision', todo: 'To do', risk: 'Risk' };

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
});
