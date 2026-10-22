import { describe, it, expect } from 'vitest';
import type { LegName } from '../../lib/conversation/types';
import { kizunaQwenMinimumBalance, QWEN_SCREEN_MICRO_USD_PER_HOUR } from './kizunaBudget';
import type { QwenRegion } from './regions';
import { QWEN_DEFAULTS } from './settings';

/**
 * The backend refuses a session token below its shortest session's price at
 * the leg set's rate (`computeQwenBudget`'s `floorMicroUsd`): 60 s at the
 * region's rate after its K. Singapore's is USD list prices × K 1.4, exact:
 * 2.5578 USD/h per speaking leg, 0.6678 per text-only leg. Beijing's is CNY
 * list prices × K 1.5 — 14.472 CNY/h and 3.672 CNY/h — converted by the
 * backend at the day's rate, which the client cannot know: it floors at
 * 8 CNY per USD, above any rate the backend converts at, so the gate never
 * refuses a start the backend would grant, and the backend's 402 words the
 * rest. These literals restate that arithmetic, so a change on either side
 * fails here rather than as a Start button that lies.
 */
describe('Kizuna Qwen start floor mirrors the backend', () => {
  const at = (region: QwenRegion, legs: LegName[], textOnly: boolean, participantSpeech: boolean, screenContext = false) =>
    kizunaQwenMinimumBalance({ legs, textOnly, participantSpeech }, { ...QWEN_DEFAULTS, region, screenContext });
  // Integer µUSD per hour, so the ceil is exact.
  const floor = (speaking: number, text: number, rate: { speaking: number; text: number }) => Math.ceil(((speaking * rate.speaking + text * rate.text) * 60) / 3600);
  const SG = { speaking: 2_557_800, text: 667_800 };
  const CN = { speaking: 14_472_000 / 8, text: 3_672_000 / 8 };

  it('prices a Singapore leg that speaks at 2.5578 USD/h and one that does not at 0.6678', () => {
    expect(floor(1, 0, SG)).toBe(42_630);
    expect(floor(0, 1, SG)).toBe(11_130);
    expect(floor(1, 1, SG)).toBe(53_760);
    expect(floor(2, 0, SG)).toBe(85_260);
  });

  it('prices a Beijing leg at 14.472 and 3.672 CNY/h, at 8 CNY per USD', () => {
    expect(CN).toEqual({ speaking: 1_809_000, text: 459_000 });
    expect(floor(1, 0, CN)).toBe(30_150);
    expect(floor(0, 1, CN)).toBe(7_650);
    expect(floor(1, 1, CN)).toBe(37_800);
    expect(floor(2, 0, CN)).toBe(60_300);
  });

  it('names the Singapore floor for each shape', () => {
    expect(at('sg', ['speaker'], false, false)).toBe(42_630);
    expect(at('sg', ['speaker'], true, false)).toBe(11_130);
    expect(at('sg', ['speaker', 'participant'], false, false)).toBe(53_760);
    expect(at('sg', ['speaker', 'participant'], false, true)).toBe(85_260);
    expect(at('sg', ['participant'], false, false)).toBe(11_130);
    expect(at('sg', ['participant'], false, true)).toBe(42_630);
    // The speaker's text-only switch silences the speaker leg, never the participant's voice.
    expect(at('sg', ['speaker', 'participant'], true, true)).toBe(53_760);
  });

  it("names the Beijing floor for each shape, under the backend's at any rate below 8", () => {
    expect(at('cn', ['speaker'], false, false)).toBe(30_150);
    expect(at('cn', ['speaker'], true, false)).toBe(7_650);
    expect(at('cn', ['speaker', 'participant'], false, false)).toBe(37_800);
    expect(at('cn', ['speaker', 'participant'], false, true)).toBe(60_300);
    expect(at('cn', ['participant'], false, true)).toBe(30_150);
    // At 6.678 CNY per USD (2026-10-21) the backend floors a speaking leg at 36 119 µUSD: this stays under it.
    expect(at('cn', ['speaker'], false, false)).toBeLessThan(36_119);
  });

  it('adds the screen-context add-on to every leg while the switch is on', () => {
    expect(QWEN_SCREEN_MICRO_USD_PER_HOUR).toEqual({ sg: 665_280, cn: 534_600 });
    expect(at('sg', ['speaker'], false, false, true)).toBe(53_718);
    expect(at('sg', ['speaker'], true, false, true)).toBe(22_218);
    expect(at('sg', ['speaker', 'participant'], false, false, true)).toBe(75_936);
    expect(at('cn', ['speaker'], false, false, true)).toBe(39_060);
    expect(at('cn', ['speaker'], true, false, true)).toBe(16_560);
    expect(at('sg', ['speaker'], false, false, false)).toBe(42_630);
  });

  it('floors a region it does not know as Singapore, the region every backend serves', () => {
    expect(kizunaQwenMinimumBalance({ legs: ['speaker'], textOnly: false, participantSpeech: false }, { ...QWEN_DEFAULTS, region: 'mars' as QwenRegion })).toBe(42_630);
  });
});
