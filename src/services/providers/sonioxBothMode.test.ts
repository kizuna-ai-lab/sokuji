import { describe, it, expect } from 'vitest';
import { sonioxBothModePlan } from './sonioxBothMode';

/**
 * The shared-vs-split decision used to be a four-clause `&&` written inline in
 * MainPanel.connectConversation, with a second partial copy twenty lines above
 * it in the `sonioxAutoParticipantBlocked` gate. Three consumers now need the
 * same answer — the managed session-key request (`bothSplit`), the Start-gate
 * balance floor, and the client wiring (`bidirectional` + the secondary-port
 * participant) — so it is one pure function, tested here directly.
 *
 * Provider dispatch (BYOK vs the Kizuna-managed twin, and every non-Soniox
 * provider) no longer lives in this function — it is answered by which
 * descriptor you asked (see SonioxProviderConfig.planBothMode and its
 * KizunaAISonioxProviderConfig inheritance). Those cases are pinned in
 * descriptorRegistry.test.ts's 'S3 planBothMode' suite instead; this file only
 * tests the shared/split decision itself.
 *
 * The managed-split cases at the bottom were added when the UI switch landed:
 * `sonioxUsesSharedBothSession` no longer forces shared on for the managed
 * twin, so what a managed account does with a stored `bothModeSharedSession:
 * false` is now a real question with a pinned answer.
 */
describe('sonioxBothModePlan', () => {
  const concrete = { bothModeSharedSession: true, sourceLanguage: 'en' };

  it('is inert outside Both mode', () => {
    expect(sonioxBothModePlan({ settings: concrete, mode: 'speaker' }))
      .toEqual({ shared: false, split: false });
    expect(sonioxBothModePlan({ settings: concrete, mode: 'participant' }))
      .toEqual({ shared: false, split: false });
  });

  it('reports shared for BYOK Both with the toggle on and a concrete source language', () => {
    expect(sonioxBothModePlan({ settings: concrete, mode: 'both' }))
      .toEqual({ shared: true, split: false });
  });

  it('reports split for BYOK Both with the toggle off', () => {
    expect(sonioxBothModePlan({
      settings: { bothModeSharedSession: false, sourceLanguage: 'en' },
      mode: 'both',
    })).toEqual({ shared: false, split: true });
  });

  // Shared mode tells the two sides apart by LANGUAGE, so an 'auto' source
  // makes it unrunnable. This combination reaches neither answer: the Start
  // gate closes on `sonioxAutoParticipantBlocked` before a session exists.
  // Preserving this clause is the whole point of centralising the expression —
  // calling `sonioxUsesSharedBothSession` alone silently drops it.
  it('reports neither when the shared toggle is on but the source language is auto', () => {
    expect(sonioxBothModePlan({
      settings: { bothModeSharedSession: true, sourceLanguage: 'auto' },
      mode: 'both',
    })).toEqual({ shared: false, split: false });
  });

  it('defaults to shared when nothing is stored', () => {
    expect(sonioxBothModePlan({ settings: {}, mode: 'both' }))
      .toEqual({ shared: true, split: false });
    expect(sonioxBothModePlan({ settings: null, mode: 'both' }))
      .toEqual({ shared: true, split: false });
    expect(sonioxBothModePlan({ settings: undefined, mode: 'both' }))
      .toEqual({ shared: true, split: false });
  });

  // The managed twin no longer forces shared. MainPanel reads the helper
  // rather than the raw `bothModeSharedSession` field precisely so this stays
  // one decision: if the UI lets a managed user pick split, the session must
  // actually run split, and if the UI ever locks it again a stored `false`
  // must not resurrect split behind the UI's back.
  it('lets the Kizuna-managed twin run split Both when that is what is stored', () => {
    expect(sonioxBothModePlan({
      settings: { bothModeSharedSession: false, sourceLanguage: 'en' },
      mode: 'both',
    })).toEqual({ shared: false, split: true });
  });

  it('still defaults the managed twin to shared with nothing stored', () => {
    expect(sonioxBothModePlan({
      settings: { sourceLanguage: 'en' },
      mode: 'both',
    })).toEqual({ shared: true, split: false });
  });
});
