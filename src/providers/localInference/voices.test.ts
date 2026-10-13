import { describe, it, expect } from 'vitest';
import { directionVoice, speakerIdFor, withDirectionVoice } from './voices';
import type { LocalInferenceSettings } from './settings';

const table = (v: unknown) => v as LocalInferenceSettings['voices'];

describe('directionVoice', () => {
  it("reads a direction's Edge voice and speaker id", () => {
    expect(directionVoice(table({ 'ja→en': { edge: 'en-US-AvaNeural', speaker: 3 } }), 'ja→en')).toEqual({ edge: 'en-US-AvaNeural', speaker: 3 });
  });

  it('reads another direction as nothing set', () => {
    expect(directionVoice(table({ 'ja→en': { edge: 'en-US-AvaNeural' } }), 'en→ja')).toEqual({});
  });

  it('reads a field of the wrong kind as absent, keeping the other', () => {
    expect(directionVoice(table({ d: { edge: 5, speaker: 2 } }), 'd')).toEqual({ speaker: 2 });
    expect(directionVoice(table({ d: { edge: '', speaker: 'x' } }), 'd')).toEqual({});
    expect(directionVoice(table({ d: { edge: 'v', speaker: Number.NaN } }), 'd')).toEqual({ edge: 'v' });
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
  it("writes one direction's field, keeping its other field and every other direction", () => {
    const voices = table({ 'ja→en': { edge: 'en-US-AvaNeural', speaker: 3 }, 'en→ja': { speaker: 5 } });
    expect(withDirectionVoice(voices, 'ja→en', { edge: 'en-US-GuyNeural' })).toEqual({
      voices: { 'ja→en': { edge: 'en-US-GuyNeural', speaker: 3 }, 'en→ja': { speaker: 5 } },
    });
  });

  it('starts a fresh table over a stored value that is not one', () => {
    expect(withDirectionVoice(table('x'), 'd', { speaker: 1 })).toEqual({ voices: { d: { speaker: 1 } } });
  });
});
