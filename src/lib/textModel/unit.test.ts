/**
 * What a text-model provider's translation unit declares, and the config it builds for a leg: the model the run's
 * check found usable, the reasoning as chosen, the system prompt with the languages by name and the word list.
 */
import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../contract/adapter';
import { isSpeechUnit, isTranslationUnit } from '../plan/types';
import type { SharedSettings } from '../provider/types';
import { DEFAULT_REASONING_CHOICE } from './choice';
import { TEXT_MODEL_UNSET } from './check';
import { textModelTranslates } from './languages';
import { buildTextModelTranslation, describeTextModelTranslation, migrateTextModelSettings, TEXT_MODEL_DEFAULTS, textModelTranslationUnit } from './unit';

const EN_JA: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const shared = (models: string[], words?: SharedSettings['words']): SharedSettings => ({
  pauses: { sourceSeconds: 1, translationSeconds: 1 },
  reversed: () => false,
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: models.map((id) => ({ id })),
  ...(words ? { words } : {}),
});

describe("a text model's translation unit", () => {
  const unit = textModelTranslationUnit('openai', () => { throw new Error('not started here'); });

  it('occupies translation alone, and is started through the translation contract', () => {
    expect(unit.id).toBe('translation');
    expect(unit.occupies(TEXT_MODEL_DEFAULTS, new Set(['translation']))).toEqual(['translation']);
    expect(unit.occupies(TEXT_MODEL_DEFAULTS, new Set(['transcription', 'translation']))).toBeNull();
    expect(unit.occupies(TEXT_MODEL_DEFAULTS, new Set(['translation', 'speech']))).toBeNull();
    expect(isTranslationUnit(unit)).toBe(true);
    expect(isSpeechUnit(unit)).toBe(false);
    expect(unit.start).toBeUndefined();
  });

  it('never speaks, takes no typed text, has no face-to-face, and translates any two languages but a language into itself or one not known yet', () => {
    const c = unit.capabilities(TEXT_MODEL_DEFAULTS);
    expect([c.speech, c.textInput, c.faceToFace]).toEqual(['never', false, false]);
    expect(c.translates!('en', 'ja')).toBe(true);
    expect(c.translates!('ja', 'zh-Hant')).toBe(true);
    expect(c.translates!('fil', 'sw')).toBe(true);
    expect(c.translates!('en', 'en')).toBe(false);
    expect(c.translates!('auto', 'en')).toBe(false);
    expect(c.translates).toBe(textModelTranslates);
    expect(textModelTranslates('en', 'en+ja')).toBe(false);
  });

  it('names the model it translates with', () => {
    expect(describeTextModelTranslation({ model: 'gpt-5-mini', reasoning: 'lowest', system: '', maxTokens: 1024 })).toEqual({ translationModel: 'gpt-5-mini' });
  });

  it('its settings: a model and a reasoning for the translation, stored as they were chosen; anything else read as the default', () => {
    expect(TEXT_MODEL_DEFAULTS).toEqual({
      translationModel: { listed: '', typed: '' }, translationReasoning: DEFAULT_REASONING_CHOICE,
      // Text models, part C: the notes' pair, Medium by default.
      notesModel: { listed: '', typed: '' }, notesReasoning: { level: 'medium', typed: '' },
    });
    expect(migrateTextModelSettings({
      translationModel: { listed: 'gpt-5.4', typed: '' }, translationReasoning: { level: 'high', typed: '' },
      notesModel: { listed: '', typed: 'gpt-6-sol' }, notesReasoning: { level: 'off', typed: '' },
    })).toEqual({
      translationModel: { listed: 'gpt-5.4', typed: '' }, translationReasoning: { level: 'high', typed: '' },
      notesModel: { listed: '', typed: 'gpt-6-sol' }, notesReasoning: { level: 'off', typed: '' },
    });
    expect(migrateTextModelSettings({ translationModel: 'x', translationReasoning: 3, notesModel: null, notesReasoning: { level: 'ultra' } })).toEqual(TEXT_MODEL_DEFAULTS);
  });
});

describe('the config a leg is built with', () => {
  it("the automatic model among those the run's check listed, the lowest reasoning, the languages by name, and an answer's budget", () => {
    const config = buildTextModelTranslation('openai', EN_JA, TEXT_MODEL_DEFAULTS, shared(['gpt-4.1-mini', 'gpt-5-mini']));
    expect(config).toMatchObject({ model: 'gpt-5-mini', reasoning: 'lowest', maxTokens: 1024 });
    expect(config).not.toHaveProperty('temperature');
    const system = (config as { system: string }).system;
    expect(system).toContain('from English into Japanese');
    expect(system).toContain('nothing else');
  });

  it('the model and reasoning chosen; a temperature only to a model that takes one', () => {
    const config = buildTextModelTranslation('openai', EN_JA, { ...TEXT_MODEL_DEFAULTS, translationModel: { listed: 'gpt-4.1-mini', typed: '' }, translationReasoning: { level: 'off', typed: '' } }, shared(['gpt-5-mini']));
    expect(config).toMatchObject({ model: 'gpt-4.1-mini', reasoning: { exact: 'none' }, temperature: 0.2, maxTokens: 1024 });
    const high = buildTextModelTranslation('gemini', EN_JA, { ...TEXT_MODEL_DEFAULTS, translationModel: { listed: '', typed: 'gemini-3.8-pro' }, translationReasoning: { level: 'high', typed: '' } }, shared([]));
    expect(high).toMatchObject({ model: 'gemini-3.8-pro', reasoning: { exact: 'high' }, maxTokens: 8192 });
    expect(high).not.toHaveProperty('temperature');
  });

  it('the word list and the session background, with the translations to use', () => {
    const config = buildTextModelTranslation('openai', EN_JA, TEXT_MODEL_DEFAULTS, shared(['gpt-5-mini'], {
      entries: [{ written: 'Kizuna AI', translation: 'キズナAI' }, { written: 'Sokuji' }],
      background: 'A weekly product meeting.',
    }));
    const system = (config as { system: string }).system;
    expect(system).toContain('About this conversation: A weekly product meeting.');
    expect(system).toContain('Keep these names and terms as written: Sokuji.');
    expect(system).toContain('Translate these as given: Kizuna AI → キズナAI.');
  });

  it('refused with no model to name: a compatible service where none is chosen or typed', () => {
    expect(buildTextModelTranslation('compatible', EN_JA, TEXT_MODEL_DEFAULTS, shared(['deepseek-chat']))).toEqual({ refused: 'No model is chosen: choose one, or type its name.', code: TEXT_MODEL_UNSET });
    expect(buildTextModelTranslation('compatible', EN_JA, { ...TEXT_MODEL_DEFAULTS, translationModel: { listed: 'deepseek-chat', typed: '' } }, shared(['deepseek-chat']))).toMatchObject({ model: 'deepseek-chat', maxTokens: 4096 });
  });

  it('refused for a pair it does not translate (a source not known yet)', () => {
    expect(buildTextModelTranslation('openai', { ...EN_JA, direction: { source: 'auto', target: 'ja' } }, TEXT_MODEL_DEFAULTS, shared(['gpt-5-mini']))).toHaveProperty('refused');
  });
});
