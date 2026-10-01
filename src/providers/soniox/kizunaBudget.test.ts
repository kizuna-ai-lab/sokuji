import { describe, it, expect } from 'vitest';
import type { LegName } from '../../lib/conversation/types';
import {
  kizunaSonioxMinimumBalance, SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR, SONIOX_MANAGED_MIN_SESSION_S,
  SONIOX_MAX_SYNTHESIS_SESSION_S, SONIOX_MAX_TRANSCRIPTION_SESSION_S, sonioxRolesFloorMicroUsd, sonioxSessionCapSeconds, sonioxStartFloorMicroUsd,
} from './kizunaBudget';
import { SONIOX_DEFAULTS } from './settings';

/**
 * The backend refuses a session key below its shortest session's price at
 * the stream set's conservative rate (sokuji-backend `computeSessionBudget`,
 * `src/routes/soniox.ts:46-92`), and caps the grant per set. These literals
 * restate its arithmetic (`src/services/soniox-budget.ts:76-77`,
 * `src/config/soniox.ts:33, 35, 72, 81` at 7b2259c), so a change on either
 * side fails here rather than as a Start button or a grant-end sentence
 * that lies.
 */
describe('Kizuna Soniox floors and caps mirror the backend', () => {
  const STT = 1_100_000;
  const TTS = 1_400_000;
  const MIN_SESSION_S = 60;
  // Integer µUSD throughout: the float spelling of the 2+1 sum ceils to 60001.
  const floor = (stt: number, tts: number) => Math.ceil(((stt * STT + tts * TTS) * MIN_SESSION_S) / 3600);

  it('mirrors the conservative per-stream rates, the shortest session and the two caps', () => {
    expect(SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR).toEqual({ stt: STT, tts: TTS });
    expect(SONIOX_MANAGED_MIN_SESSION_S).toBe(MIN_SESSION_S);
    expect(SONIOX_MAX_TRANSCRIPTION_SESSION_S).toBe(18_000);
    // MAX_SYNTHESIS_SESSION_S = min(MAX_TRANSCRIPTION_SESSION_S, TTS_KEY_MAX_TTL_S = 3600).
    expect(SONIOX_MAX_SYNTHESIS_SESSION_S).toBe(Math.min(18_000, 3_600));
  });

  it('prices every issuable stream set as the backend does', () => {
    expect(sonioxStartFloorMicroUsd(1, 0)).toBe(floor(1, 0)); // 18 334
    expect(sonioxStartFloorMicroUsd(1, 1)).toBe(floor(1, 1)); // 41 667
    expect(sonioxStartFloorMicroUsd(2, 0)).toBe(floor(2, 0)); // 36 667
    expect(sonioxStartFloorMicroUsd(2, 1)).toBe(floor(2, 1)); // 60 000
    expect([floor(1, 0), floor(1, 1), floor(2, 0), floor(2, 1)]).toEqual([18_334, 41_667, 36_667, 60_000]);
  });

  it('prices a role list as the backend prices its stream set', () => {
    expect(sonioxRolesFloorMicroUsd(['spk_stt'])).toBe(18_334);
    expect(sonioxRolesFloorMicroUsd(['spk_stt', 'spk_tts'])).toBe(41_667);
    expect(sonioxRolesFloorMicroUsd(['spk_stt', 'par_stt'])).toBe(36_667);
    expect(sonioxRolesFloorMicroUsd(['spk_stt', 'spk_tts', 'par_stt'])).toBe(60_000);
  });

  it("names today's floor for the start, the participant-speech flag off: split Both opens a second STT stream, only the speaker speaks", () => {
    const shared = { ...SONIOX_DEFAULTS, bothModeSharedSession: true };
    const split = { ...SONIOX_DEFAULTS, bothModeSharedSession: false };
    const at = (legs: LegName[], textOnly: boolean, s = shared) => kizunaSonioxMinimumBalance({ legs, textOnly, participantSpeech: true }, s);
    // `participantSpeech: true` in every shape: with the flag off (the default) it prices nothing.
    expect(at(['speaker'], false)).toBe(41_667);
    expect(at(['speaker'], true)).toBe(18_334);
    expect(at(['participant'], false)).toBe(18_334);
    expect(at(['speaker', 'participant'], false)).toBe(41_667);
    expect(at(['speaker', 'participant'], false, split)).toBe(60_000);
    expect(at(['speaker', 'participant'], true, split)).toBe(36_667);
    // A single leg ignores the Both-mode setting.
    expect(at(['speaker'], true, split)).toBe(18_334);
  });

  it("prices the participant's speech stream once the flag is on — a role the backend has no floor for yet", () => {
    // The backend mints no `par_tts` today, so it prices none: these are
    // this formula's answers, which its floor must match when it does
    // (the "turning it on" checklist updates this test then).
    const shared = { ...SONIOX_DEFAULTS, bothModeSharedSession: true };
    const split = { ...SONIOX_DEFAULTS, bothModeSharedSession: false };
    const on = (legs: LegName[], textOnly: boolean, s = shared) => kizunaSonioxMinimumBalance({ legs, textOnly, participantSpeech: true }, s, true);
    expect(on(['participant'], true)).toBe(41_667); // par_stt + par_tts
    expect(on(['speaker', 'participant'], false)).toBe(65_000); // mix_stt + mix_tts + par_tts
    expect(on(['speaker', 'participant'], false, split)).toBe(83_334); // two STT + two TTS
    expect(on(['speaker', 'participant'], true, split)).toBe(60_000); // spk_stt + par_stt + par_tts
    // The flag on but the participant quiet: today's floor.
    expect(kizunaSonioxMinimumBalance({ legs: ['speaker', 'participant'], textOnly: false, participantSpeech: false }, split, true)).toBe(60_000);
  });

  it('caps a session at an hour when it speaks, five hours when it does not', () => {
    expect(sonioxSessionCapSeconds(true)).toBe(3_600);
    expect(sonioxSessionCapSeconds(false)).toBe(18_000);
  });
});
