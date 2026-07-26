import { describe, it, expect } from 'vitest';
import {
  SONIOX_MANAGED_MIN_BALANCE_MICRO_USD,
  sonioxManagedMinBalanceMicroUsd,
} from './SonioxProviderConfig';

/**
 * The Start button's managed-Soniox gate must match the backend's floor, or a
 * user between $0 and the floor sees a green Start and is then handed a 402.
 *
 * The floor is the price of the backend's shortest session (MIN_SESSION_S =
 * 60s) at the SKU's hourly rate, rounded up to whole µUSD — the same
 * `minBalanceMicroUsd` arithmetic sokuji-backend/src/services/pricing.ts does.
 * These literals restate that arithmetic so a rate change on either side shows
 * up as a failing test rather than as a silently wrong button.
 */
describe('managed Soniox start floor', () => {
  const MIN_SESSION_S = 60;
  const micro = (usdPerHour: number) => Math.ceil((MIN_SESSION_S / 3600) * usdPerHour * 1_000_000);

  it('matches the backend formula at each SKU rate', () => {
    expect(SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.text_only).toBe(micro(0.6)); // $0.01
    expect(SONIOX_MANAGED_MIN_BALANCE_MICRO_USD.speech_to_speech).toBe(micro(1.5)); // $0.025
  });

  it('picks the floor for the session the user is about to start', () => {
    expect(sonioxManagedMinBalanceMicroUsd(true)).toBe(10_000);
    expect(sonioxManagedMinBalanceMicroUsd(false)).toBe(25_000);
  });

  it('is strictly above zero, so "any positive balance" was never the same gate', () => {
    // The exact regression: $0.005 in the wallet passed `balance > 0`.
    expect(sonioxManagedMinBalanceMicroUsd(false)).toBeGreaterThan(5_000);
    expect(sonioxManagedMinBalanceMicroUsd(true)).toBeGreaterThan(5_000);
  });
});
