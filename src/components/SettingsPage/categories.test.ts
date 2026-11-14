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

  it('filters categories by title and search words', () => {
    expect(filterCategories('key', t).map((c) => c.id)).toEqual(['accounts']);
    expect(filterCategories('麦克风', zh).map((c) => c.id)).toEqual(['audio']);
  });

  it('lists the categories in the agreed order', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(['lineup', 'words', 'accounts', 'models', 'audio', 'display', 'history', 'general']);
  });
});
