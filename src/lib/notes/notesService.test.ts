// The line-up's notes service: always one (owner, 2026-11-17: no "None"); whether notes are written is the switches' call.
import { describe, it, expect } from 'vitest';
import { notesServiceOf, KIZUNA_NOTES } from './notesService';

describe('the notes service', () => {
  it('is the one the line-up chose', () => {
    expect(notesServiceOf({ summarisation: 'openai' }, true)).toBe('openai');
    expect(notesServiceOf({ summarisation: KIZUNA_NOTES }, false)).toBe(KIZUNA_NOTES);
  });

  it('with none chosen, is Kizuna AI where the build offers the hosted services, OpenAI otherwise', () => {
    expect(notesServiceOf({ summarisation: null }, true)).toBe(KIZUNA_NOTES);
    expect(notesServiceOf({ summarisation: null }, false)).toBe('openai');
    expect(notesServiceOf(null, false)).toBe('openai');
  });
});
