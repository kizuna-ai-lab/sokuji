import { describe, it, expect } from 'vitest';
import type { LegName } from '../../lib/conversation/types';
import {
  kizunaSonioxMinimumBalance, SONIOX_CONSERVATIVE_RATE_CAP_MICRO_USD_PER_HOUR, SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR, SONIOX_MANAGED_MIN_SESSION_S,
  SONIOX_MAX_SYNTHESIS_SESSION_S, SONIOX_MAX_TRANSCRIPTION_SESSION_S, sonioxRolesFloorMicroUsd, sonioxSessionCapSeconds, sonioxStartFloorMicroUsd,
} from './kizunaBudget';
import { SONIOX_DEFAULTS } from './settings';

/**
 * The backend refuses a session key below its shortest session's price at
 * the stream set's conservative rate (sokuji-backend `computeSessionBudget`,
 * `src/routes/soniox.ts:46-92`), and caps the grant per set. These literals
 * restate its arithmetic (`src/services/soniox-budget.ts`: the per-stream
 * rates and their $1.00/h cap; `src/config/soniox.ts:33, 35, 72, 81` at
 * 7b2259c), so a change on either
 * side fails here rather than as a Start button or a grant-end sentence
 * that lies.
 */
describe('Kizuna Soniox floors and caps mirror the backend', () => {
  const STT = 500_000;
  const TTS = 250_000;
  const CAP = 1_000_000;
  const MIN_SESSION_S = 60;
  // Integer µUSD throughout; a set above the cap is budgeted at the cap.
  const floor = (stt: number, tts: number) => Math.ceil((Math.min(stt * STT + tts * TTS, CAP) * MIN_SESSION_S) / 3600);

  it('mirrors the conservative per-stream rates, the shortest session and the two caps', () => {
    expect(SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR).toEqual({ stt: STT, tts: TTS });
    expect(SONIOX_CONSERVATIVE_RATE_CAP_MICRO_USD_PER_HOUR).toBe(CAP);
    expect(SONIOX_MANAGED_MIN_SESSION_S).toBe(MIN_SESSION_S);
    expect(SONIOX_MAX_TRANSCRIPTION_SESSION_S).toBe(18_000);
    // MAX_SYNTHESIS_SESSION_S = min(MAX_TRANSCRIPTION_SESSION_S, TTS_KEY_MAX_TTL_S = 3600).
    expect(SONIOX_MAX_SYNTHESIS_SESSION_S).toBe(Math.min(18_000, 3_600));
  });

  it('prices every issuable stream set as the backend does', () => {
    expect(sonioxStartFloorMicroUsd(1, 0)).toBe(floor(1, 0)); // 8 334
    expect(sonioxStartFloorMicroUsd(1, 1)).toBe(floor(1, 1)); // 12 500
    expect(sonioxStartFloorMicroUsd(2, 0)).toBe(floor(2, 0)); // 16 667
    expect(sonioxStartFloorMicroUsd(2, 1)).toBe(floor(2, 1)); // 16 667: 1.25 $/h, capped at 1.00
    expect([floor(1, 0), floor(1, 1), floor(2, 0), floor(2, 1)]).toEqual([8_334, 12_500, 16_667, 16_667]);
  });

  it('prices a role list as the backend prices its stream set', () => {
    expect(sonioxRolesFloorMicroUsd(['spk_stt'])).toBe(8_334);
    expect(sonioxRolesFloorMicroUsd(['spk_stt', 'spk_tts'])).toBe(12_500);
    expect(sonioxRolesFloorMicroUsd(['spk_stt', 'par_stt'])).toBe(16_667);
    expect(sonioxRolesFloorMicroUsd(['spk_stt', 'spk_tts', 'par_stt'])).toBe(16_667);
  });

  it("names the floor for the start with the participant-speech flag off: split Both opens a second STT stream, only the speaker speaks", () => {
    const shared = { ...SONIOX_DEFAULTS, bothModeSharedSession: true };
    const split = { ...SONIOX_DEFAULTS, bothModeSharedSession: false };
    const at = (legs: LegName[], textOnly: boolean, s = shared) => kizunaSonioxMinimumBalance({ legs, textOnly, participantSpeech: true }, s);
    // `participantSpeech: true` in every shape: with the flag off (the parameter's default) it prices nothing.
    expect(at(['speaker'], false)).toBe(12_500);
    expect(at(['speaker'], true)).toBe(8_334);
    expect(at(['participant'], false)).toBe(8_334);
    expect(at(['speaker', 'participant'], false)).toBe(12_500);
    expect(at(['speaker', 'participant'], false, split)).toBe(16_667);
    expect(at(['speaker', 'participant'], true, split)).toBe(16_667);
    // A single leg ignores the Both-mode setting.
    expect(at(['speaker'], true, split)).toBe(8_334);
  });

  it("prices the participant's speech stream as the backend does (par_tts at the TTS rate)", () => {
    // sokuji-backend `sonioxStartFloorMicroUsd` sums per-kind conservative rates:
    // par_tts is a `tts` role, so these are its floors (sokuji-backend#94).
    const shared = { ...SONIOX_DEFAULTS, bothModeSharedSession: true };
    const split = { ...SONIOX_DEFAULTS, bothModeSharedSession: false };
    const on = (legs: LegName[], textOnly: boolean, s = shared) => kizunaSonioxMinimumBalance({ legs, textOnly, participantSpeech: true }, s, true);
    expect(on(['participant'], true)).toBe(12_500); // par_stt + par_tts
    expect(on(['speaker', 'participant'], false)).toBe(16_667); // mix_stt + mix_tts + par_tts: 1.00 $/h
    expect(on(['speaker', 'participant'], false, split)).toBe(16_667); // two STT + two TTS: 1.50 $/h, capped at 1.00
    expect(on(['speaker', 'participant'], true, split)).toBe(16_667); // spk_stt + par_stt + par_tts: 1.25 $/h, capped at 1.00
    // The flag on but the participant quiet: today's floor.
    expect(kizunaSonioxMinimumBalance({ legs: ['speaker', 'participant'], textOnly: false, participantSpeech: false }, split, true)).toBe(16_667);
  });

  it('caps a session at an hour when it speaks, five hours when it does not', () => {
    expect(sonioxSessionCapSeconds(true)).toBe(3_600);
    expect(sonioxSessionCapSeconds(false)).toBe(18_000);
  });
});
