// The keys the settings page builds from its own lists (a category's title
// and search words, a group, a display mode, a stage) exist in en, so no
// language shows a raw key; the locale test keeps the other 29 in step.
import { describe, it, expect } from 'vitest';
import en from '../../locales/en/translation.json';
import { CATEGORIES, GROUPS } from './categories';

const flat = (o: Record<string, unknown>, prefix = ''): Record<string, unknown> => Object.fromEntries(
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? Object.entries(flat(v as Record<string, unknown>, `${prefix}${k}.`)) : [[`${prefix}${k}`, v]])),
);
const EN = flat(en as Record<string, unknown>);

describe('the settings page words', () => {
  it('every key the page builds exists in en', () => {
    const keys = [
      ...CATEGORIES.flatMap((c) => [c.titleKey, c.wordsKey]),
      ...GROUPS.map((g) => `settingsPage.groups.${g}`),
      ...['both', 'source', 'translation', 'none'].map((m) => `settingsPage.display.modes.${m}`),
      ...['transcription', 'translation', 'speech', 'summarisation'].map((s) => `settingsPage.lineup.stages.${s}`),
    ];
    expect(keys.filter((k) => typeof EN[k] !== 'string')).toEqual([]);
  });

  it('the page, the headphones entry and the new audio and storage rows have their words in en', () => {
    const keys = [
      'settingsPage.title', 'settingsPage.search', 'settingsPage.back', 'settingsPage.backToList', 'settingsPage.lockedLine',
      'settingsPage.accounts.signedIn', 'settingsPage.lineup.joint', 'settingsPage.display.previewMain', 'settingsPage.display.previewCaptions',
      'settingsPage.display.mineSide', 'settingsPage.display.theirsSide', 'settingsPage.display.empty', 'subtitle.settings.defaultColour',
      'settingsPage.audio.micHint', 'settingsPage.audio.otherHint', 'settingsPage.audio.device', 'settingsPage.audio.source', 'audioPanel.captionReplay', 'settingsPage.lineup.speechModeHint', 'settingsPage.lineup.hint',
      'mainPanel.whatIHear', 'mainPanel.audioSettings', 'audioPanel.captionMine', 'audioPanel.captionTheirs',
      'audioPanel.defaultPlaybackAid', 'models.readingsDictionary', 'models.readingsDictionaryNotStored',
    ];
    expect(keys.filter((k) => typeof EN[k] !== 'string')).toEqual([]);
  });

  // PR review: the Quick/Advanced layouts are gone, so the tour must not send anyone to their toggle.
  it("the tour's last step names no Advanced toggle", () => {
    expect(EN['tour.steps.done.content']).not.toMatch(/Advanced/);
  });
});
