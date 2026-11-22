// The line-up's notes service: always one (owner, 2026-11-17: no "None"); whether notes are written is the switches' call.
import { describe, it, expect } from 'vitest';
import { COMPATIBLE_NOTES, GEMINI_NOTES, notesProviderOf, notesServiceOf, KIZUNA_NOTES, NOTES_SERVICES, OPENAI_NOTES } from './notesService';

const d = (hostedOffered: boolean, signedIn: boolean, openAiKeyed: boolean, geminiKeyed = false, textModelsOffered = true) => ({
  hostedOffered, signedIn, openAiKeyed, geminiKeyed, textModelsOffered,
});

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

  // Text models, part C: the notes can be written by OpenAI's, Gemini's or a compatible service's text model. The
  // stored id 'openai' is kept, served by OpenAI's text model.
  it('knows Kizuna AI, OpenAI, Gemini and a compatible service, each served by its provider', () => {
    expect(NOTES_SERVICES).toEqual(['kizunaai_openai', 'openai', 'gemini_text', 'openai_compatible']);
    expect([OPENAI_NOTES, GEMINI_NOTES, COMPATIBLE_NOTES].map(notesProviderOf)).toEqual(['openai_text', 'gemini_text', 'openai_compatible']);
    expect(notesProviderOf(KIZUNA_NOTES)).toBeNull();
    expect(notesProviderOf('gone')).toBeNull();
  });

  it('is Gemini or a compatible service where chosen, in the desktop app, which offers them', () => {
    expect(notesServiceOf({ summarisation: 'gemini_text' }, d(true, true, true))).toBe(GEMINI_NOTES);
    expect(notesServiceOf({ summarisation: 'openai_compatible' }, d(true, true, true))).toBe(COMPATIBLE_NOTES);
    // Elsewhere they are no choice: the default.
    expect(notesServiceOf({ summarisation: 'gemini_text' }, d(false, false, true, true, false))).toBe(OPENAI_NOTES);
  });

  it('with none chosen and neither Kizuna AI nor OpenAI usable, is Gemini once it has a key; never a compatible service', () => {
    expect(notesServiceOf({ summarisation: null }, d(true, false, false, true))).toBe(GEMINI_NOTES);
    expect(notesServiceOf({ summarisation: null }, d(false, false, false, true))).toBe(GEMINI_NOTES);
    // OpenAI first, as before; Kizuna AI first where it can write them.
    expect(notesServiceOf({ summarisation: null }, d(false, false, true, true))).toBe(OPENAI_NOTES);
    expect(notesServiceOf({ summarisation: null }, d(true, true, false, true))).toBe(KIZUNA_NOTES);
    // Not offered, Gemini's key does not make it the default.
    expect(notesServiceOf({ summarisation: null }, d(false, false, false, true, false))).toBe(OPENAI_NOTES);
  });
});
