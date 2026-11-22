import { describe, it, expect } from 'vitest';
import {
  ANSWER_TOKENS, automaticModel, DEFAULT_MODEL_CHOICE, DEFAULT_NOTES_REASONING_CHOICE, DEFAULT_REASONING_CHOICE, isDefaultNotesReasoning, maxTokensFor,
  modelChoiceOf, modelToUse, notesProbeAsk, reasoningAskOf, reasoningChoiceOf, translationTemperature, TRANSLATION_TEMPERATURE,
} from './choice';

describe('the model a stage asks for', () => {
  const OPENAI = ['gpt-4.1-mini', 'gpt-5-nano', 'gpt-5-mini', 'gpt-5.4'];

  it("the name typed wins, trimmed, whatever the list holds or the list's choice says", () => {
    expect(modelToUse('openai', { listed: 'gpt-5.4', typed: '  my-fine-tune  ' }, OPENAI)).toBe('my-fine-tune');
    expect(modelToUse('compatible', { listed: '', typed: 'llama3.3:70b' }, [])).toBe('llama3.3:70b');
  });

  it('then the one chosen from the list, even one the list no longer holds: the check says whether it still answers', () => {
    expect(modelToUse('openai', { listed: 'gpt-5.4', typed: '' }, OPENAI)).toBe('gpt-5.4');
    expect(modelToUse('openai', { listed: 'gpt-gone', typed: ' ' }, OPENAI)).toBe('gpt-gone');
  });

  it("then the service's preferred one it lists, else its first text model; a compatible service has no default", () => {
    expect(modelToUse('openai', DEFAULT_MODEL_CHOICE, OPENAI)).toBe('gpt-5-mini');
    expect(modelToUse('openai', DEFAULT_MODEL_CHOICE, ['gpt-4o', 'gpt-4.1'])).toBe('gpt-4o');
    expect(modelToUse('gemini', DEFAULT_MODEL_CHOICE, ['gemini-3.8-flash', 'gemini-3.1-flash-lite'])).toBe('gemini-3.1-flash-lite');
    expect(modelToUse('openai', DEFAULT_MODEL_CHOICE, [])).toBeNull();
    expect(modelToUse('compatible', DEFAULT_MODEL_CHOICE, ['deepseek-chat'])).toBeNull();
    expect(automaticModel('compatible', ['deepseek-chat'])).toBeNull();
  });
});

describe('the reasoning a stage asks for', () => {
  it("Lowest is the client's lowest, lowered further where refused; the default is Lowest", () => {
    expect(DEFAULT_REASONING_CHOICE).toEqual({ level: 'lowest', typed: '' });
    expect(reasoningAskOf(DEFAULT_REASONING_CHOICE)).toBe('lowest');
  });

  it('a level the user chose is sent exactly: Off is none, Low, Medium and High their own words', () => {
    expect(reasoningAskOf({ level: 'off', typed: '' })).toEqual({ exact: 'none' });
    expect(reasoningAskOf({ level: 'low', typed: '' })).toEqual({ exact: 'low' });
    expect(reasoningAskOf({ level: 'medium', typed: '' })).toEqual({ exact: 'medium' });
    expect(reasoningAskOf({ level: 'high', typed: '' })).toEqual({ exact: 'high' });
  });

  it('a value typed wins and goes as it is typed, trimmed', () => {
    expect(reasoningAskOf({ level: 'lowest', typed: ' xhigh ' })).toEqual({ exact: 'xhigh' });
    expect(reasoningAskOf({ level: 'off', typed: 'minimal' })).toEqual({ exact: 'minimal' });
  });
});

describe('what was stored, made valid', () => {
  it('keeps a choice, and reads anything else as the default', () => {
    expect(modelChoiceOf({ listed: 'gpt-5.4', typed: 'x' })).toEqual({ listed: 'gpt-5.4', typed: 'x' });
    expect(modelChoiceOf('gpt-5.4')).toEqual(DEFAULT_MODEL_CHOICE);
    expect(modelChoiceOf({ listed: 5 })).toEqual(DEFAULT_MODEL_CHOICE);
    expect(reasoningChoiceOf({ level: 'high', typed: '' })).toEqual({ level: 'high', typed: '' });
    expect(reasoningChoiceOf({ level: 'ultra', typed: 'ultra' })).toEqual({ level: 'lowest', typed: 'ultra' });
    expect(reasoningChoiceOf(null)).toEqual(DEFAULT_REASONING_CHOICE);
  });
});

describe("an answer's budget", () => {
  it('room for a long sentence, and more the more the model is asked to reason', () => {
    expect(maxTokensFor('openai', 'gpt-5-mini', 'lowest')).toBe(ANSWER_TOKENS);
    expect(maxTokensFor('openai', 'gpt-4.1-mini', 'lowest')).toBe(ANSWER_TOKENS);
    expect(maxTokensFor('gemini', 'gemini-3.1-flash-lite', 'lowest')).toBe(ANSWER_TOKENS);
    // The o-series' lowest is 'low'.
    expect(maxTokensFor('openai', 'o4-mini', 'lowest')).toBe(ANSWER_TOKENS * 2);
    expect(maxTokensFor('openai', 'gpt-5.4', { exact: 'none' })).toBe(ANSWER_TOKENS);
    expect(maxTokensFor('openai', 'gpt-5.4', { exact: 'medium' })).toBe(ANSWER_TOKENS * 4);
    expect(maxTokensFor('openai', 'gpt-5.4', { exact: 'high' })).toBe(ANSWER_TOKENS * 8);
    expect(maxTokensFor('openai', 'gpt-5.4', { exact: 'xhigh' })).toBe(ANSWER_TOKENS * 8);
  });

  it("a compatible service's lowest sends nothing, so its model reasons as it likes: a medium effort's room", () => {
    expect(maxTokensFor('compatible', 'deepseek-reasoner', 'lowest')).toBe(ANSWER_TOKENS * 4);
  });
});

describe("a translation's temperature", () => {
  it('only to a model known to take one', () => {
    expect(translationTemperature('openai', 'gpt-4.1-mini')).toBe(TRANSLATION_TEMPERATURE);
    expect(translationTemperature('openai', 'gpt-4o')).toBe(TRANSLATION_TEMPERATURE);
    expect(translationTemperature('openai', 'gpt-5-chat-latest')).toBe(TRANSLATION_TEMPERATURE);
    // OpenAI's reasoning models refuse a temperature other than their own.
    for (const model of ['gpt-5', 'gpt-5-mini', 'gpt-5.4', 'gpt-6-luna', 'o3', 'o4-mini']) expect(translationTemperature('openai', model), model).toBeUndefined();
    // Google asks that Gemini 3 and later keep their own.
    expect(translationTemperature('gemini', 'gemini-2.5-flash')).toBe(TRANSLATION_TEMPERATURE);
    expect(translationTemperature('gemini', 'gemma-3-27b-it')).toBe(TRANSLATION_TEMPERATURE);
    expect(translationTemperature('gemini', 'gemini-3.1-flash-lite')).toBeUndefined();
    expect(translationTemperature('compatible', 'anything')).toBeUndefined();
  });
});

// Text models, part C: the notes' model and reasoning, beside the translation's.
describe("the notes' choice", () => {
  it("Automatic is the service's notes preference it lists, else its first text model", () => {
    expect(modelToUse('openai', DEFAULT_MODEL_CHOICE, ['gpt-5-mini', 'gpt-6-luna'], 'notes')).toBe('gpt-6-luna');
    expect(automaticModel('openai', ['gpt-4o'], 'notes')).toBe('gpt-4o');
    expect(automaticModel('compatible', ['deepseek-chat'], 'notes')).toBeNull();
    // A name typed or a model chosen wins, as for the translation.
    expect(modelToUse('openai', { listed: 'gpt-5.4', typed: '' }, ['gpt-6-luna'], 'notes')).toBe('gpt-5.4');
  });

  it('the default is Medium, and a stored level that is no level reads as it', () => {
    expect(DEFAULT_NOTES_REASONING_CHOICE).toEqual({ level: 'medium', typed: '' });
    expect(reasoningChoiceOf(undefined, DEFAULT_NOTES_REASONING_CHOICE)).toEqual(DEFAULT_NOTES_REASONING_CHOICE);
    expect(reasoningChoiceOf({ level: 'ultra', typed: '' }, DEFAULT_NOTES_REASONING_CHOICE)).toEqual({ level: 'medium', typed: '' });
  });

  it('Medium with no value typed is the default; any other level, or a value typed (medium too), is not', () => {
    expect(isDefaultNotesReasoning(DEFAULT_NOTES_REASONING_CHOICE)).toBe(true);
    expect(isDefaultNotesReasoning({ level: 'medium', typed: '  ' })).toBe(true);
    expect(isDefaultNotesReasoning({ level: 'medium', typed: 'medium' })).toBe(false);
    for (const level of ['off', 'lowest', 'low', 'high'] as const) expect(isDefaultNotesReasoning({ level, typed: '' }), level).toBe(false);
  });

  it('a check asks the default with the lowest (it is lowered where refused), and anything else as it would be sent', () => {
    expect(notesProbeAsk(DEFAULT_NOTES_REASONING_CHOICE)).toBe('lowest');
    expect(notesProbeAsk({ level: 'high', typed: '' })).toEqual({ exact: 'high' });
    expect(notesProbeAsk({ level: 'medium', typed: 'medium' })).toEqual({ exact: 'medium' });
    expect(notesProbeAsk({ level: 'lowest', typed: '' })).toBe('lowest');
  });

  it("a stage's default sent as preferred gets the room of its level", () => {
    expect(maxTokensFor('gemini', 'gemini-3.8-flash', { preferred: 'medium' })).toBe(ANSWER_TOKENS * 4);
  });
});
