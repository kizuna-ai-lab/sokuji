import { describe, it, expect } from 'vitest';
import { lowestReasoningEffort, refusesNone, takesReasoningEffort } from './reasoning';

describe('the lowest reasoning a model is asked for', () => {
  it("asks OpenAI's GPT-5, mini and nano for 'minimal', dated snapshots included", () => {
    for (const model of ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-2025-08-07', 'gpt-5-mini-2025-08-07']) {
      expect(lowestReasoningEffort('openai', model), model).toBe('minimal');
    }
  });

  it("asks OpenAI's GPT-5.1 and later for 'none', and 'low' of the listed models that refuse 'none'", () => {
    for (const model of ['gpt-5.1', 'gpt-5.2', 'gpt-5.4', 'gpt-6-luna', 'gpt-6.1-terra']) {
      expect(lowestReasoningEffort('openai', model), model).toBe('none');
    }
    expect(lowestReasoningEffort('openai', 'gpt-6-astra')).toBe('low');
    expect(lowestReasoningEffort('openai', 'gpt-6.1-sol')).toBe('low');
  });

  it("asks OpenAI's o-series for 'low', the least they take", () => {
    expect(lowestReasoningEffort('openai', 'o3-mini')).toBe('low');
    expect(lowestReasoningEffort('openai', 'o4-mini')).toBe('low');
  });

  it("sends nothing to OpenAI's models that do not reason", () => {
    for (const model of ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o-mini', 'gpt-5-chat-latest', 'chatgpt-4o-latest']) {
      expect(lowestReasoningEffort('openai', model), model).toBeNull();
    }
  });

  it("asks Gemini for 'none', and sends a compatible service none", () => {
    expect(lowestReasoningEffort('gemini', 'gemini-3.8-flash')).toBe('none');
    expect(lowestReasoningEffort('compatible', 'qwen3:8b')).toBeNull();
  });

  it("keeps the notes' rule for which models take an effort", () => {
    expect(takesReasoningEffort('gpt-5.1')).toBe(true);
    expect(takesReasoningEffort('gpt-5')).toBe(false);
    expect(takesReasoningEffort('gpt-4.1')).toBe(false);
    expect(refusesNone('gpt-6-astra-2026-01-01')).toBe(true);
    expect(refusesNone('gpt-6-luna')).toBe(false);
  });
});
