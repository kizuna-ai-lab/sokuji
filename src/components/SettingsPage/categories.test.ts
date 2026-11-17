import { describe, expect, it } from 'vitest';
import { CATEGORIES, filterCategories, targetToCategory } from './categories';

const EN: Record<string, string> = {
  'settingsPage.categories.lineup': 'Languages and line-up',
  'settingsPage.categories.accounts': 'Accounts and keys',
  'settingsPage.categories.models': 'Models and storage',
  'settingsPage.categories.audio': 'Audio',
  'settingsPage.categories.display': 'Display',
  'settingsPage.categories.general': 'General',
};
const ZH: Record<string, string> = {
  'settingsPage.categories.audio': '音频',
  'settingsPage.words.audio': '麦克风 噪声抑制 扬声器 耳机',
  'settingsPage.words.models': '模型 下载 存储',
};
const t = (k: string) => EN[k] ?? '';
const zh = (k: string) => ZH[k] ?? '';

describe('the settings categories', () => {
  it('maps every navigation target used today to a category', () => {
    for (const target of ['languages', 'provider', 'microphone', 'speech', 'participant', 'system-audio', 'turn-detection', 'turn-detection-tuning', 'voice-settings', 'model-management', 'model-asr', 'model-translation', 'model-tts', 'user-account', 'system-instructions'])
      expect(targetToCategory(target).category).not.toBeUndefined();
    expect(targetToCategory('microphone')).toEqual({ category: 'audio', anchor: 'microphone' });
    expect(targetToCategory('languages')).toEqual({ category: 'lineup', anchor: 'languages' });
    expect(targetToCategory('provider')).toEqual({ category: 'accounts', anchor: null });
    expect(targetToCategory('system-audio')).toEqual({ category: 'audio', anchor: 'participant' });
    expect(targetToCategory('model-asr')).toEqual({ category: 'lineup', anchor: 'model-asr' });
  });

  // B-20: each stage's models open in Models and storage; the local engine's voices are in the speech card.
  it("maps each stage's models to its group in Models and storage, where a slot's library opens", () => {
    for (const stage of ['asr', 'translation', 'tts'])
      expect(targetToCategory(`models-${stage}`)).toEqual({ category: 'models', anchor: `models-${stage}` });
  });

  it("maps the local engine's voices to the line-up", () => {
    expect(targetToCategory('local-voices')).toEqual({ category: 'lineup', anchor: 'local-voices' });
  });

  // B-27: the audio drawing goes to each speech row, not only to the speech section.
  it('maps the speech rows the audio drawing goes to', () => {
    for (const target of ['speech-other-hears', 'speech-me-too', 'speech-passthrough', 'speech-i-hear'])
      expect(targetToCategory(target)).toEqual({ category: 'audio', anchor: target });
    expect(targetToCategory('participant')).toEqual({ category: 'audio', anchor: 'participant' });
  });

  // Owner, 2026-11-17: a link about one provider's key lands on that provider's row in Accounts and keys (the OpenAI services share
  // one row; the hosted ones are Kizuna AI's sign-in).
  it("maps a provider's key to its own row in the accounts", () => {
    expect(targetToCategory('provider:openai')).toEqual({ category: 'accounts', anchor: 'account-openai' });
    expect(targetToCategory('provider:openai_live')).toEqual({ category: 'accounts', anchor: 'account-openai' });
    expect(targetToCategory('provider:soniox')).toEqual({ category: 'accounts', anchor: 'account-soniox' });
    expect(targetToCategory('provider:kizunaai_soniox')).toEqual({ category: 'accounts', anchor: 'user-account' });
  });

  it('filters categories by title and search words', () => {
    expect(filterCategories('key', t).map((c) => c.id)).toEqual(['accounts']);
    expect(filterCategories('麦克风', zh).map((c) => c.id)).toEqual(['audio']);
  });

  it('lists the categories in the agreed order', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(['lineup', 'words', 'accounts', 'models', 'audio', 'display', 'history', 'general']);
  });
});

describe('the targets that lead into the line-up', () => {
  it("opens the provider's own options for what a provider needs besides a key, and the stage rows for choosing one", () => {
    expect(targetToCategory('provider-options')).toEqual({ category: 'lineup', anchor: 'provider-options' });
    expect(targetToCategory('lineup')).toEqual({ category: 'lineup', anchor: 'lineup' });
    expect(targetToCategory('provider')).toEqual({ category: 'accounts', anchor: null });
  });
});
