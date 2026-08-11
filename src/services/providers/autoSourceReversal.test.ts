import { describe, it, expect } from 'vitest';
import { reversesDirectionViaSourceLanguage } from './autoSourceReversal';
import { Provider } from '../../types/Provider';

const TRANSLATE = 'gemini-3.5-live-translate-preview';
const DIALOGUE = 'gemini-3.1-flash-live-preview';

describe('reversesDirectionViaSourceLanguage', () => {
  it('is true for Soniox, which swaps source/target directly', () => {
    expect(reversesDirectionViaSourceLanguage(Provider.SONIOX, undefined)).toBe(true);
  });

  it('follows a kizuna twin back to its base provider', () => {
    // The managed twin runs the same client and reverses the same way; a raw
    // enum comparison would miss it and the gate would silently no-op.
    expect(reversesDirectionViaSourceLanguage(Provider.KIZUNA_AI_SONIOX, undefined)).toBe(true);
  });

  it('is true for Gemini only on the translate models', () => {
    expect(reversesDirectionViaSourceLanguage(Provider.GEMINI, TRANSLATE)).toBe(true);
  });

  it('is false for Gemini dialogue models, which reverse through the instruction', () => {
    expect(reversesDirectionViaSourceLanguage(Provider.GEMINI, DIALOGUE)).toBe(false);
  });

  it('is false for Gemini with no model chosen yet', () => {
    expect(reversesDirectionViaSourceLanguage(Provider.GEMINI, undefined)).toBe(false);
    expect(reversesDirectionViaSourceLanguage(Provider.GEMINI, '')).toBe(false);
  });

  it('is false for providers that carry direction in the instruction', () => {
    expect(reversesDirectionViaSourceLanguage(Provider.OPENAI, 'gpt-realtime')).toBe(false);
    expect(reversesDirectionViaSourceLanguage(Provider.OPENAI_TRANSLATE, 'gpt-realtime-translate')).toBe(false);
    expect(reversesDirectionViaSourceLanguage(Provider.PALABRA_AI, undefined)).toBe(false);
    expect(reversesDirectionViaSourceLanguage(Provider.LOCAL_NATIVE, undefined)).toBe(false);
  });
});
