// What one notes request asks a text model for (text models, part C): the reasoning, from the user's choice and the
// call's own measured level, and a budget that leaves the reasoning room.
import { describe, it, expect } from 'vitest';
import { DEFAULT_NOTES_REASONING_CHOICE } from './choice';
import { NOTES_REASONING_ROOM, notesRequest } from './notes';

const PART = { effort: 'low', maxTokens: 32_000 } as const;
const FINISH = { effort: 'medium', maxTokens: 12_000 } as const;
const LIVE = { effort: 'low', maxTokens: 2_500 } as const;

describe('a notes request with the default reasoning (Medium)', () => {
  // A line-up that runs today sends what it sends today: OpenAI's notes asked each call's own level of the models
  // that take one, and nothing of the others, with the budgets the notes have always had.
  it("OpenAI: each call's own level to a model that takes one, nothing to the others, today's budgets", () => {
    expect(notesRequest('openai', 'gpt-6-luna', DEFAULT_NOTES_REASONING_CHOICE, PART)).toEqual({ reasoning: { preferred: 'low' }, maxTokens: 32_000 });
    expect(notesRequest('openai', 'gpt-6-luna', DEFAULT_NOTES_REASONING_CHOICE, FINISH)).toEqual({ reasoning: { preferred: 'medium' }, maxTokens: 12_000 });
    expect(notesRequest('openai', 'gpt-6-luna', DEFAULT_NOTES_REASONING_CHOICE, LIVE)).toEqual({ reasoning: { preferred: 'low' }, maxTokens: 2_500 });
    for (const model of ['gpt-5-mini', 'o3', 'gpt-4.1-mini']) {
      expect(notesRequest('openai', model, DEFAULT_NOTES_REASONING_CHOICE, PART), model).toEqual({ reasoning: 'default', maxTokens: 32_000 });
    }
    // The two listed models that refuse 'none' get 'low' for it, as before.
    expect(notesRequest('openai', 'gpt-6-astra', DEFAULT_NOTES_REASONING_CHOICE, { effort: 'none', maxTokens: 10 }).reasoning).toEqual({ preferred: 'low' });
  });

  it("Gemini: each call's own level, lowered where refused, with the same budgets", () => {
    expect(notesRequest('gemini', 'gemini-3.8-flash', DEFAULT_NOTES_REASONING_CHOICE, PART)).toEqual({ reasoning: { preferred: 'low' }, maxTokens: 32_000 });
    expect(notesRequest('gemini', 'gemini-3.8-flash', DEFAULT_NOTES_REASONING_CHOICE, FINISH)).toEqual({ reasoning: { preferred: 'medium' }, maxTokens: 12_000 });
  });

  it("a compatible service: nothing sent (its model is unknown), so it reasons as it likes: a medium level's room", () => {
    expect(notesRequest('compatible', 'qwen3:8b', DEFAULT_NOTES_REASONING_CHOICE, PART)).toEqual({ reasoning: 'default', maxTokens: 32_000 + NOTES_REASONING_ROOM.medium - NOTES_REASONING_ROOM.low });
    expect(notesRequest('compatible', 'qwen3:8b', DEFAULT_NOTES_REASONING_CHOICE, FINISH)).toEqual({ reasoning: 'default', maxTokens: 12_000 });
    expect(notesRequest('compatible', 'qwen3:8b', DEFAULT_NOTES_REASONING_CHOICE, LIVE).maxTokens).toBe(4_548);
  });
});

describe('a notes request with a reasoning the user chose', () => {
  it('is sent exactly, to every call: a level or a value typed', () => {
    expect(notesRequest('openai', 'gpt-6-luna', { level: 'off', typed: '' }, PART).reasoning).toEqual({ exact: 'none' });
    expect(notesRequest('openai', 'gpt-6-luna', { level: 'high', typed: '' }, FINISH).reasoning).toEqual({ exact: 'high' });
    expect(notesRequest('gemini', 'gemini-3.8-flash', { level: 'low', typed: '' }, FINISH).reasoning).toEqual({ exact: 'low' });
    // Medium typed is exact, where Medium chosen from the list is the default.
    expect(notesRequest('openai', 'gpt-5-mini', { level: 'medium', typed: 'medium' }, PART).reasoning).toEqual({ exact: 'medium' });
    expect(notesRequest('compatible', 'qwen3:8b', { level: 'off', typed: 'think' }, PART).reasoning).toEqual({ exact: 'think' });
  });

  it('Lowest is the least the model takes, as for the translation', () => {
    expect(notesRequest('openai', 'gpt-5-mini', { level: 'lowest', typed: '' }, PART).reasoning).toBe('lowest');
  });

  it("leaves the call's budget as it is up to the call's own level, and adds the room of each level above it", () => {
    const at = (level: 'off' | 'lowest' | 'low' | 'high', call: { effort: 'low' | 'medium'; maxTokens: number }) => notesRequest('openai', 'gpt-6-luna', { level, typed: '' }, call).maxTokens;
    expect(at('off', PART)).toBe(32_000);
    expect(at('lowest', PART)).toBe(32_000);
    expect(at('low', FINISH)).toBe(12_000);
    expect(notesRequest('openai', 'gpt-6-luna', { level: 'medium', typed: 'medium' }, PART).maxTokens).toBe(32_000 + 2_048);
    expect(notesRequest('openai', 'gpt-6-luna', { level: 'medium', typed: 'medium' }, LIVE).maxTokens).toBe(4_548);
    expect(at('high', PART)).toBe(32_000 + 6_144);
    expect(at('high', FINISH)).toBe(12_000 + 4_096);
    expect(at('high', LIVE)).toBe(8_644);
    // A value typed is taken for the most a model could reason.
    expect(notesRequest('openai', 'gpt-6-luna', { level: 'low', typed: 'xhigh' }, LIVE).maxTokens).toBe(8_644);
  });
});
