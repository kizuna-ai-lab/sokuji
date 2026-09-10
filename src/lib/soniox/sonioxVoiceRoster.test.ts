import { describe, it, expect } from 'vitest';
import {
  SONIOX_VOICE_ROSTER,
  SONIOX_ACCENTS,
  SONIOX_USE_CASES,
  SONIOX_STYLES,
} from './sonioxVoiceRoster';
import { SONIOX_VOICES, SONIOX_DEFAULT_VOICE } from './ttsCatalog';

/**
 * The roster is generated (scripts/fetch-soniox-voices.mjs), so these are not
 * assertions about data someone typed — they are the checks that a REFRESH is
 * safe to land. The roster moved 71 → 70 → 200 in a month, and the last move
 * silently retired `Hugo` while Sokuji kept offering it; a session started on
 * that voice got HTTP 400 and degraded to subtitles.
 */
describe('SONIOX_VOICE_ROSTER', () => {
  it('holds a plausible number of voices', () => {
    // A floor, not the exact count: Soniox adds voices, and pinning the number
    // would make every refresh a two-file edit. It still catches a regenerate
    // that produced a truncated or empty roster.
    expect(SONIOX_VOICE_ROSTER.length).toBeGreaterThan(150);
  });

  it('names every voice exactly once', () => {
    const ids = SONIOX_VOICE_ROSTER.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('classifies every voice with a gender and an age Soniox defines', () => {
    for (const voice of SONIOX_VOICE_ROSTER) {
      expect(['male', 'female', 'neutral']).toContain(voice.gender);
      expect(['young', 'middle_aged', 'old']).toContain(voice.age);
    }
  });

  it('describes and tags every voice, so no picker row renders blank', () => {
    for (const voice of SONIOX_VOICE_ROSTER) {
      expect(voice.description.length).toBeGreaterThan(0);
      expect(voice.accent.length).toBeGreaterThan(0);
      expect(voice.useCase.length).toBeGreaterThan(0);
      expect(voice.style.length).toBeGreaterThan(0);
    }
  });

  it('derives its facet vocabularies from the roster itself', () => {
    const distinct = (pick: (v: (typeof SONIOX_VOICE_ROSTER)[number]) => string[]) =>
      [...new Set(SONIOX_VOICE_ROSTER.flatMap(pick))].sort();
    expect(SONIOX_ACCENTS).toEqual(distinct((v) => [v.accent]));
    expect(SONIOX_USE_CASES).toEqual(distinct((v) => v.useCase));
    expect(SONIOX_STYLES).toEqual(distinct((v) => v.style));
  });

  it('still contains the voice new sessions default to', () => {
    // The Hugo guard. A refresh that retires SONIOX_DEFAULT_VOICE would ship a
    // provider whose out-of-the-box voice is rejected by the TTS endpoint.
    expect(SONIOX_VOICE_ROSTER.map((v) => v.id)).toContain(SONIOX_DEFAULT_VOICE);
  });

  it('offers exactly the roster in the picker, so no dropdown entry is retired', () => {
    // The other half of the Hugo guard: the selectable list is DERIVED from the
    // roster rather than maintained beside it, so a voice cannot outlive its
    // presence at Soniox.
    expect(SONIOX_VOICES.map((v) => v.value)).toEqual(SONIOX_VOICE_ROSTER.map((v) => v.id));
    expect(SONIOX_VOICES.every((v) => v.name === v.value)).toBe(true);
  });
});
