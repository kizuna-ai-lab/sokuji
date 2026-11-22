import { describe, it, expect } from 'vitest';
import { directionVoice, speakerIdFor, voicesWithoutImported, withDirectionVoice } from './voices';
import type { LocalInferenceSettings } from './settings';

const table = (v: unknown) => v as LocalInferenceSettings['voices'];

describe('directionVoice', () => {
  it("reads a direction's speaker id, and no Edge voice stored beside it", () => {
    expect(directionVoice(table({ 'ja→en': { edge: 'en-US-AvaNeural', speaker: 3 } }), 'ja→en')).toEqual({ speaker: 3 });
  });

  it('reads another direction as nothing set', () => {
    expect(directionVoice(table({ 'ja→en': { edge: 'en-US-AvaNeural' } }), 'en→ja')).toEqual({});
  });

  it('reads a speaker of the wrong kind as absent', () => {
    expect(directionVoice(table({ d: { speaker: 2 } }), 'd')).toEqual({ speaker: 2 });
    expect(directionVoice(table({ d: { speaker: 'x' } }), 'd')).toEqual({});
    expect(directionVoice(table({ d: { speaker: Number.NaN } }), 'd')).toEqual({});
  });

  it('reads a stored table that is not one as nothing set', () => {
    for (const stored of [null, undefined, 'x', 7, [], { d: 'voice' }]) {
      expect(directionVoice(table(stored), 'd'), JSON.stringify(stored)).toEqual({});
    }
  });
});

describe('speakerIdFor', () => {
  it("uses the direction's own speaker id", () => {
    expect(speakerIdFor({ speaker: 4 }, 'supertonic-3')).toBe(4);
  });

  it("falls back to the model's default speaker, Supertonic's 7", () => {
    expect(speakerIdFor({}, 'supertonic-3')).toBe(7);
  });

  it('falls back to 0 for a model with no default, or an unknown one', () => {
    expect(speakerIdFor({}, 'piper-cy-bu_tts-medium')).toBe(0);
    expect(speakerIdFor({}, 'no-such-model')).toBe(0);
  });
});

describe('withDirectionVoice', () => {
  it("writes one direction's speaker, keeping its other stored fields and every other direction", () => {
    const voices = table({ 'ja→en': { edge: 'en-US-AvaNeural', speaker: 3 }, 'en→ja': { speaker: 5 } });
    expect(withDirectionVoice(voices, 'ja→en', { speaker: 6 })).toEqual({
      voices: { 'ja→en': { edge: 'en-US-AvaNeural', speaker: 6 }, 'en→ja': { speaker: 5 } },
    });
  });

  it('starts a fresh table over a stored value that is not one', () => {
    expect(withDirectionVoice(table('x'), 'd', { speaker: 1 })).toEqual({ voices: { d: { speaker: 1 } } });
  });
});

// An imported Supertonic voice deleted (from the engine's voice library or the Models page): every direction that
// spoke in it on Supertonic goes back to Supertonic's default speaker; on another model the same number is one of
// that model's own speakers, and stays (#619).
describe('voicesWithoutImported', () => {
  const tts = (map: Record<string, string>) => (dir: string) => map[dir];

  it('puts every direction that spoke in the voice on Supertonic back on its default speaker', () => {
    const voices = table({ 'ja→en': { speaker: 1001, edge: 'x' }, 'en→ja': { speaker: 1001 }, 'zh→en': { speaker: 3 } });
    expect(voicesWithoutImported(voices, 1001, tts({ 'ja→en': 'supertonic-3', 'en→ja': 'supertonic-3', 'zh→en': 'supertonic-3' }))).toEqual({
      'ja→en': { speaker: 7, edge: 'x' }, 'en→ja': { speaker: 7 }, 'zh→en': { speaker: 3 },
    });
  });

  it('leaves a direction whose speech is another model, where the number is its own speaker', () => {
    const voices = table({ 'ja→en': { speaker: 1001 } });
    expect(voicesWithoutImported(voices, 1001, tts({ 'ja→en': 'kokoro' }))).toBeNull();
  });

  it('changes nothing, and says so, when no direction spoke in it', () => {
    expect(voicesWithoutImported(table({ d: { speaker: 2 } }), 1001, tts({ d: 'supertonic-3' }))).toBeNull();
    expect(voicesWithoutImported(undefined as never, 1001, tts({}))).toBeNull();
  });
});

describe('withDirectionVoice and a stored Edge voice', () => {
  it('a local voice change keeps the Edge voice stored in the same direction', () => {
    const stored = { 'en→ja': { edge: 'ja-JP-NanamiNeural', speaker: 1 } } as never;
    expect(withDirectionVoice(stored, 'en→ja', { speaker: 4 }).voices['en→ja']).toEqual({ edge: 'ja-JP-NanamiNeural', speaker: 4 });
  });
});
