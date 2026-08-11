import { describe, it, expect } from 'vitest';
import {
  SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR,
  SONIOX_MANAGED_MIN_BALANCE_MICRO_USD,
  SONIOX_MANAGED_MIN_SESSION_S,
  sonioxManagedMinBalanceMicroUsd,
} from './SonioxProviderConfig';

/**
 * The Start button's managed-Soniox gate must match the backend's floor, or a
 * user between $0 and the floor sees a green Start and is then handed a 402.
 *
 * The floor is the price of the backend's shortest session (MIN_SESSION_S =
 * 60 s) at the CONSERVATIVE AGGREGATE rate for the STREAM SET the session will
 * open — not at a per-SKU list price. Those per-stream rates are K (2.0) times
 * the worst-case provider cost rate ($0.55/hr for a transcription stream,
 * $0.70/hr for a synthesis stream). These literals restate that arithmetic so
 * a rate change on either side shows up as a failing test rather than as a
 * silently wrong button.
 */
describe('managed Soniox start floor', () => {
  const MIN_SESSION_S = 60;
  const STT = 1_100_000; // µUSD/hr — K(2.0) × $0.55 worst-case provider cost
  const TTS = 1_400_000; // µUSD/hr — K(2.0) × $0.70 worst-case provider cost
  // Integer µUSD throughout, deliberately. The float spelling of the same sum,
  // `Math.ceil((60 / 3600) * 3.6 * 1_000_000)`, lands one ULP above 60000 and
  // ceils to 60001 — a one-µUSD gate error nobody would ever find by reading.
  const floor = (stt: number, tts: number) =>
    Math.ceil(((stt * STT + tts * TTS) * MIN_SESSION_S) / 3600);

  it('mirrors the backend conservative per-stream rates and its shortest session', () => {
    expect(SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR.stt).toBe(STT);
    expect(SONIOX_CONSERVATIVE_RATE_MICRO_USD_PER_HOUR.tts).toBe(TTS);
    expect(SONIOX_MANAGED_MIN_SESSION_S).toBe(MIN_SESSION_S);
  });

  it('matches the backend formula for every issuable stream set', () => {
    expect(SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.one_stt_text_only).toBe(floor(1, 0));        // $0.018334
    expect(SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.one_stt_speech_to_speech).toBe(floor(1, 1)); // $0.041667
    expect(SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.two_stt_text_only).toBe(floor(2, 0));        // $0.036667
    expect(SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.two_stt_speech_to_speech).toBe(floor(2, 1)); // $0.06
  });

  it('picks the floor for the session the user is about to start', () => {
    expect(sonioxManagedMinBalanceMicroUsd(true)).toBe(18_334);
    expect(sonioxManagedMinBalanceMicroUsd(false)).toBe(41_667);
    expect(sonioxManagedMinBalanceMicroUsd(true, true)).toBe(36_667);
    expect(sonioxManagedMinBalanceMicroUsd(false, true)).toBe(60_000);
  });

  it('defaults bothSplit to false so a caller that predates split keeps the single-stream floor', () => {
    expect(sonioxManagedMinBalanceMicroUsd(false)).toBe(sonioxManagedMinBalanceMicroUsd(false, false));
    expect(sonioxManagedMinBalanceMicroUsd(true)).toBe(sonioxManagedMinBalanceMicroUsd(true, false));
  });

  it('makes split roughly 2x — only the transcription half doubles', () => {
    // Text-only is the pure case: two STT streams, no TTS. Not exactly 2× the
    // single-stream floor: 2 × 18_334 = 36_668, because the single-stream
    // figure was rounded up once and the pair is rounded up once.
    expect(sonioxManagedMinBalanceMicroUsd(true, true))
      .toBe(2 * sonioxManagedMinBalanceMicroUsd(true) - 1);
    // Speech-to-speech carries one synthesis stream in BOTH shapes (the
    // participant leg is hardcoded text-only), so its ratio is below 2×.
    expect(sonioxManagedMinBalanceMicroUsd(false, true))
      .toBeGreaterThan(sonioxManagedMinBalanceMicroUsd(false));
    expect(sonioxManagedMinBalanceMicroUsd(false, true))
      .toBeLessThan(2 * sonioxManagedMinBalanceMicroUsd(false));
  });

  it('is strictly above zero, so "any positive balance" was never the same gate', () => {
    // The exact regression: $0.005 in the wallet passed `balance > 0`.
    expect(sonioxManagedMinBalanceMicroUsd(false)).toBeGreaterThan(5_000);
    expect(sonioxManagedMinBalanceMicroUsd(true)).toBeGreaterThan(5_000);
  });

  // Consequence of moving the budget off the per-SKU list rate and onto the
  // conservative estimate, pinned so it is a decision rather than a surprise:
  // a single-stream user's floor RISES ($0.025 → $0.041667), i.e. the quoted
  // duration at a given balance gets shorter, even though what they are
  // charged (provider cost × K) typically goes down.
  it('sits above the old per-SKU list floors it replaced', () => {
    expect(sonioxManagedMinBalanceMicroUsd(true)).toBeGreaterThan(10_000);
    expect(sonioxManagedMinBalanceMicroUsd(false)).toBeGreaterThan(25_000);
  });
});
