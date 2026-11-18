// The line-up's notes service: always one (owner, 2026-11-17: no "None"); whether notes are written is the switches' call.
import { describe, it, expect } from 'vitest';
import { notesServiceOf, KIZUNA_NOTES } from './notesService';

const d = (hostedOffered: boolean, signedIn: boolean, openAiKeyed: boolean) => ({ hostedOffered, signedIn, openAiKeyed });

describe('the notes service', () => {
  // Owner, 2026-11-18: named like the other hosted services (kizunaai_soniox, kizunaai_qwen): Kizuna AI, by OpenAI.
  it("is stored as 'kizunaai_openai' for Kizuna AI's", () => {
    expect(KIZUNA_NOTES).toBe('kizunaai_openai');
  });

  // Not released under the old name, so nothing is migrated; a value the app no longer knows (the old 'kizunaai', a
  // service since removed) reads as none chosen, so the notes are not left unwritten.
  it('reads a value it does not know as none chosen', () => {
    expect(notesServiceOf({ summarisation: 'kizunaai_openai' }, d(true, true, false))).toBe(KIZUNA_NOTES);
    expect(notesServiceOf({ summarisation: 'gone' }, d(false, false, true))).toBe('openai');
  });

  it('is the one the line-up chose', () => {
    expect(notesServiceOf({ summarisation: 'openai' }, d(true, true, false))).toBe('openai');
    expect(notesServiceOf({ summarisation: KIZUNA_NOTES }, d(false, false, true))).toBe(KIZUNA_NOTES);
  });

  // The owner's call (2026-11-17): Kizuna AI by default where it can write the notes, otherwise OpenAI.
  it('with none chosen, is Kizuna AI where it is offered and signed in to', () => {
    expect(notesServiceOf({ summarisation: null }, d(true, true, false))).toBe(KIZUNA_NOTES);
    expect(notesServiceOf({ summarisation: null }, d(true, true, true))).toBe(KIZUNA_NOTES);
  });

  it('with none chosen and Kizuna AI not usable, is OpenAI once it has a key', () => {
    // Review: signed out with an OpenAI key, notes are written with that key, not held for a sign-in.
    expect(notesServiceOf({ summarisation: null }, d(true, false, true))).toBe('openai');
    expect(notesServiceOf({ summarisation: null }, d(false, false, true))).toBe('openai');
  });

  it('with none chosen and neither usable, names what to set up: Kizuna AI where offered, OpenAI otherwise', () => {
    expect(notesServiceOf({ summarisation: null }, d(true, false, false))).toBe(KIZUNA_NOTES);
    expect(notesServiceOf({ summarisation: null }, d(false, false, false))).toBe('openai');
    expect(notesServiceOf(null, d(false, false, false))).toBe('openai');
  });
});
