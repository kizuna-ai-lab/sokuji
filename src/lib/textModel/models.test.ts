import { describe, it, expect } from 'vitest';
import { defaultTextModel, NOTES_MODEL_PREFERENCES, TEXT_MODEL_PREFERENCES, textModelIds } from './models';

// The ids each list held when it was read (2026-11-22), the ones that are not chat text models among them.
const OPENAI_LIST = [
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o-mini', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.1', 'gpt-5.2', 'gpt-5.4',
  'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-mini-tts', 'gpt-4o-search-preview', 'gpt-5-codex', 'gpt-5-pro',
  'gpt-5.4-pro', 'o3-pro', 'gpt-image-1', 'gpt-4o-audio-preview', 'gpt-realtime', 'gpt-4o-realtime-preview',
  'text-embedding-3-small', 'omni-moderation-latest', 'whisper-1', 'tts-1', 'dall-e-3', 'davinci-002',
  'gpt-3.5-turbo-instruct', 'chatgpt-4o-latest', 'o4-mini',
];
const GEMINI_LIST = [
  'gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-3.8-flash',
  'gemini-2.5-flash-image', 'gemini-2.5-flash-preview-tts', 'gemini-embedding-001', 'text-embedding-004',
  'gemini-2.5-flash-native-audio-preview', 'gemini-live-2.5-flash-preview', 'imagen-4.0-generate-001', 'veo-3.0-generate-001',
  'aqa', 'gemini-robotics-er-1.5-preview', 'gemini-2.5-computer-use-preview', 'gemma-3-27b-it',
];

describe('the text models of a list', () => {
  it("keeps OpenAI's chat text models, in the list's order, and drops speech, search, code, pro, image, audio and realtime ids", () => {
    expect(textModelIds('openai', OPENAI_LIST)).toEqual([
      'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o-mini', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.1', 'gpt-5.2', 'gpt-5.4',
      'chatgpt-4o-latest', 'o4-mini',
    ]);
  });

  it("keeps Gemini's text models and drops image, speech, embedding, live, video and the like", () => {
    expect(textModelIds('gemini', GEMINI_LIST)).toEqual([
      'gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-3.8-flash',
      'gemma-3-27b-it',
    ]);
  });

  it("keeps a compatible service's list as it is: nothing is known of its names", () => {
    expect(textModelIds('compatible', ['qwen3:8b', 'llama3.2', 'nomic-embed-text'])).toEqual(['qwen3:8b', 'llama3.2', 'nomic-embed-text']);
  });

  it('names each id once', () => {
    expect(textModelIds('openai', ['gpt-5-mini', 'gpt-5-mini'])).toEqual(['gpt-5-mini']);
  });
});

describe('the default text model', () => {
  it('is the first of the preference list the service lists', () => {
    expect(TEXT_MODEL_PREFERENCES).toEqual({
      openai: ['gpt-5-mini', 'gpt-5-nano', 'gpt-4.1-mini'],
      gemini: ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.8-flash'],
    });
    expect(defaultTextModel('openai', OPENAI_LIST)).toBe('gpt-5-mini');
    expect(defaultTextModel('openai', ['gpt-4.1-mini', 'gpt-5-nano'])).toBe('gpt-5-nano');
    expect(defaultTextModel('gemini', GEMINI_LIST)).toBe('gemini-3.1-flash-lite');
    expect(defaultTextModel('gemini', ['gemini-3.8-flash', 'gemini-flash-lite-latest'])).toBe('gemini-flash-lite-latest');
  });

  it('is none when the list has none of them, and for a compatible service, which has no list of its own', () => {
    expect(defaultTextModel('openai', ['gpt-4o-mini'])).toBeNull();
    expect(defaultTextModel('gemini', [])).toBeNull();
    expect(defaultTextModel('compatible', ['qwen3:8b'])).toBeNull();
  });
});

// Text models, part C: the notes have a preference list of their own. OpenAI's starts with the model the notes were
// written with before (the old setting's default, measured on OpenAI's own endpoint), so a user who never chose one
// writes with it as before; then the translation's.
describe("the notes' default text model", () => {
  it("is the first of the notes' preferences the service lists", () => {
    expect(NOTES_MODEL_PREFERENCES).toEqual({
      openai: ['gpt-6-luna', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1-mini'],
      gemini: ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'],
    });
    expect(defaultTextModel('openai', ['gpt-5-mini', 'gpt-6-luna'], 'notes')).toBe('gpt-6-luna');
    expect(defaultTextModel('openai', OPENAI_LIST, 'notes')).toBe('gpt-5-mini');
    expect(defaultTextModel('gemini', GEMINI_LIST, 'notes')).toBe('gemini-3.8-flash');
    // The translation's stays its own.
    expect(defaultTextModel('openai', ['gpt-5-mini', 'gpt-6-luna'])).toBe('gpt-5-mini');
  });

  it('is none for a compatible service', () => {
    expect(defaultTextModel('compatible', ['qwen3:8b'], 'notes')).toBeNull();
  });
});
