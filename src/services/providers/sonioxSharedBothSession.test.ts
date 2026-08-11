import { describe, it, expect } from 'vitest';
import { sonioxUsesSharedBothSession } from './SonioxProviderConfig';

/**
 * Both flavours now honour the user's stored preference.
 *
 * Managed (Kizuna AI) used to be forced to `true` here: the backend's session
 * lease was account-scoped and single-session, so two clients meant the second
 * connect was refused with a 409 and Others→You silently never ran while the
 * user still saw You→Others working. One lease now issues one temporary key
 * per stream, so a split managed session (spk_stt + par_stt) is a supported
 * shape rather than a race the backend refuses — and this function no longer
 * needs to know which provider is asking.
 *
 * The settings UI and MainPanel both read this one helper, so a stored value
 * cannot mean one thing to the toggle and another to the session.
 */
describe('sonioxUsesSharedBothSession', () => {
  it('honours a stored preference, whichever way it points', () => {
    expect(sonioxUsesSharedBothSession({ bothModeSharedSession: true })).toBe(true);
    expect(sonioxUsesSharedBothSession({ bothModeSharedSession: false })).toBe(false);
  });

  it('defaults to shared when nothing is stored', () => {
    expect(sonioxUsesSharedBothSession({})).toBe(true);
    expect(sonioxUsesSharedBothSession(null)).toBe(true);
    expect(sonioxUsesSharedBothSession(undefined)).toBe(true);
  });
});
