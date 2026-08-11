import { describe, it, expect } from 'vitest';
import { sonioxBothModePlan } from './sonioxBothMode';
import { Provider } from '../../types/Provider';

/**
 * The shared-vs-split decision used to be a four-clause `&&` written inline in
 * MainPanel.connectConversation, with a second partial copy twenty lines above
 * it in the `sonioxAutoParticipantBlocked` gate. Three consumers now need the
 * same answer — the managed session-key request (`bothSplit`), the Start-gate
 * balance floor, and the client wiring (`bidirectional` + the secondary-port
 * participant) — so it is one pure function, tested here directly.
 *
 * NOTE for whoever lands the managed-split UI: this file deliberately does NOT
 * assert what a managed account does with a stored `bothModeSharedSession:
 * false`. At this point `sonioxUsesSharedBothSession` still forces shared on
 * for the managed twin, and that policy is inverted in its own task, which
 * adds the managed-split cases here.
 */
describe('sonioxBothModePlan', () => {
  const concrete = { bothModeSharedSession: true, sourceLanguage: 'en' };

  it('is inert for a provider that is not Soniox', () => {
    expect(sonioxBothModePlan({ provider: Provider.OPENAI, settings: concrete, mode: 'both' }))
      .toEqual({ shared: false, split: false });
  });

  it('is inert outside Both mode', () => {
    expect(sonioxBothModePlan({ provider: Provider.SONIOX, settings: concrete, mode: 'speaker' }))
      .toEqual({ shared: false, split: false });
    expect(sonioxBothModePlan({ provider: Provider.SONIOX, settings: concrete, mode: 'participant' }))
      .toEqual({ shared: false, split: false });
  });

  it('reports shared for BYOK Both with the toggle on and a concrete source language', () => {
    expect(sonioxBothModePlan({ provider: Provider.SONIOX, settings: concrete, mode: 'both' }))
      .toEqual({ shared: true, split: false });
  });

  it('reports split for BYOK Both with the toggle off', () => {
    expect(sonioxBothModePlan({
      provider: Provider.SONIOX,
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
      provider: Provider.SONIOX,
      settings: { bothModeSharedSession: true, sourceLanguage: 'auto' },
      mode: 'both',
    })).toEqual({ shared: false, split: false });
  });

  it('defaults to shared when nothing is stored', () => {
    expect(sonioxBothModePlan({ provider: Provider.SONIOX, settings: {}, mode: 'both' }))
      .toEqual({ shared: true, split: false });
    expect(sonioxBothModePlan({ provider: Provider.SONIOX, settings: null, mode: 'both' }))
      .toEqual({ shared: true, split: false });
    expect(sonioxBothModePlan({ provider: Provider.SONIOX, settings: undefined, mode: 'both' }))
      .toEqual({ shared: true, split: false });
  });

  // The managed twin must resolve through kizunaBaseProvider. A raw
  // `provider === Provider.SONIOX` test is always false for it, which is
  // exactly how this expression once opened two managed sessions instead of
  // one and got the second refused with a 409.
  it('resolves the Kizuna-managed twin to Soniox rather than treating it as another provider', () => {
    expect(sonioxBothModePlan({
      provider: Provider.KIZUNA_AI_SONIOX,
      settings: concrete,
      mode: 'both',
    }).shared).toBe(true);
  });
});
