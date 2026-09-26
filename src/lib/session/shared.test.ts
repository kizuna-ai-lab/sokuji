import { describe, it, expect } from 'vitest';
import { fakeProvider } from '../../providers/fake/provider';
import { FAKE_DEFAULTS } from '../../providers/fake/settings';
import { buildSharedSettings, type InstructionSettings } from './shared';

const pair = { source: 'en', target: 'ja' };
const pauses = { sourceSeconds: 1.2, translationSeconds: 0.8 };
const settings = (patch: Partial<InstructionSettings>): InstructionSettings => ({
  useTemplateMode: true,
  templateSystemInstructions: 'Translate {{SOURCE_LANGUAGE}} into {{TARGET_LANGUAGE}}. Only {{TARGET_LANGUAGE}}.',
  systemInstructions: 'mine',
  participantSystemInstructions: 'theirs',
  ...patch,
});

const segmentation = { mode: 'off' as const, sentencesPerRow: 0 };

describe('buildSharedSettings', () => {
  it("fills the template with each direction's English names", () => {
    const shared = buildSharedSettings(fakeProvider, FAKE_DEFAULTS, pair, settings({}), pauses, segmentation);
    expect(shared.instructions({ source: 'en', target: 'ja' })).toBe('Translate English into Japanese. Only Japanese.');
    expect(shared.instructions({ source: 'ja', target: 'en' })).toBe('Translate Japanese into English. Only English.');
  });

  it('falls back to the code for a language the provider does not name', () => {
    const shared = buildSharedSettings(fakeProvider, FAKE_DEFAULTS, pair, settings({}), pauses, segmentation);
    expect(shared.instructions({ source: 'xx', target: 'ja' })).toBe('Translate xx into Japanese. Only Japanese.');
  });

  it("uses the user's prompt for the speaker's direction and the participant prompt for the reverse", () => {
    const shared = buildSharedSettings(fakeProvider, FAKE_DEFAULTS, pair, settings({ useTemplateMode: false }), pauses, segmentation);
    expect(shared.instructions({ source: 'en', target: 'ja' })).toBe('mine');
    expect(shared.instructions({ source: 'ja', target: 'en' })).toBe('theirs');
  });

  it("falls back to the user's prompt when the participant prompt is blank", () => {
    const shared = buildSharedSettings(fakeProvider, FAKE_DEFAULTS, pair, settings({ useTemplateMode: false, participantSystemInstructions: '  ' }), pauses, segmentation);
    expect(shared.instructions({ source: 'ja', target: 'en' })).toBe('mine');
  });

  it('passes the pauses through', () => {
    expect(buildSharedSettings(fakeProvider, FAKE_DEFAULTS, pair, settings({}), pauses, segmentation).pauses).toEqual(pauses);
  });

  it("says which direction is the participant's, and carries the display segmentation", () => {
    const shared = buildSharedSettings(fakeProvider, FAKE_DEFAULTS, pair, settings({}), pauses, { mode: 'sentences', sentencesPerRow: 0 });
    expect(shared.reversed({ source: 'en', target: 'ja' })).toBe(false);
    expect(shared.reversed({ source: 'ja', target: 'en' })).toBe(true);
    expect(shared.segmentation).toEqual({ mode: 'sentences', sentencesPerRow: 0 });
  });
});
