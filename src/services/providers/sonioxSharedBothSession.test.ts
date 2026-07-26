import { describe, it, expect } from 'vitest';
import { sonioxUsesSharedBothSession } from './SonioxProviderConfig';
import { Provider } from '../../types/Provider';

/**
 * The managed twin's backend lease is ACCOUNT-scoped and single-session, so
 * "Disabled" (two clients, one per direction) cannot work there: the second
 * connect is refused with 409 and Others→You silently never runs while the
 * user still sees You→Others working. The settings UI therefore locks the
 * control on for managed accounts, and both that UI and MainPanel read this
 * one helper — a stored `false` (carried over from BYOK use of the same
 * install) must not resurrect the half-failed session.
 */
describe('sonioxUsesSharedBothSession', () => {
  it('forces the shared session on for the Kizuna-managed twin, whatever is stored', () => {
    expect(sonioxUsesSharedBothSession(Provider.KIZUNA_AI_SONIOX, { bothModeSharedSession: false })).toBe(true);
    expect(sonioxUsesSharedBothSession(Provider.KIZUNA_AI_SONIOX, { bothModeSharedSession: true })).toBe(true);
    expect(sonioxUsesSharedBothSession(Provider.KIZUNA_AI_SONIOX, {})).toBe(true);
    expect(sonioxUsesSharedBothSession(Provider.KIZUNA_AI_SONIOX, undefined)).toBe(true);
  });

  it('honours the BYOK user\'s choice — two keys, two sessions, no lease involved', () => {
    expect(sonioxUsesSharedBothSession(Provider.SONIOX, { bothModeSharedSession: false })).toBe(false);
    expect(sonioxUsesSharedBothSession(Provider.SONIOX, { bothModeSharedSession: true })).toBe(true);
  });

  it('defaults to shared when BYOK has no stored preference', () => {
    expect(sonioxUsesSharedBothSession(Provider.SONIOX, {})).toBe(true);
    expect(sonioxUsesSharedBothSession(Provider.SONIOX, null)).toBe(true);
  });
});
