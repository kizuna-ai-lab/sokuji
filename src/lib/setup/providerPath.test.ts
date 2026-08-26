import { describe, it, expect } from 'vitest';
import { Provider } from '../../types/Provider';
import type { ProviderPath } from './types';
import { OFFLINE_PROVIDERS, providerPathFor } from './providerPath';

/** Every provider, with the answer spelled out rather than recomputed.
 *
 *  An earlier version of this file asserted only that the result was one of the
 *  three paths — which `providerPathFor` cannot violate, since its last branch
 *  returns own-key for anything unrecognised. A local engine added to the enum
 *  but forgotten in OFFLINE_PROVIDERS passed that test while the wizard offered
 *  it as an own-key provider and the tour sent the user to the key field.
 *
 *  This map has teeth in both directions: `Record<Provider, ...>` refuses to
 *  compile with a member missing, and the count check below refuses to run with
 *  a row for a member the enum no longer has. */
const EXPECTED: Record<Provider, ProviderPath> = {
  // Backend-managed twins: Kizuna AI holds the key, the user signs in.
  [Provider.KIZUNA_AI_OPENAI_TRANSLATE]: 'managed',
  [Provider.KIZUNA_AI_VOLCENGINE_AST2]: 'managed',
  [Provider.KIZUNA_AI_SONIOX]: 'managed',
  // Local engines: nothing leaves the machine, models download instead.
  [Provider.LOCAL_INFERENCE]: 'offline',
  [Provider.LOCAL_NATIVE]: 'offline',
  // Everything else is a service the user holds their own key for.
  [Provider.OPENAI]: 'own-key',
  [Provider.GEMINI]: 'own-key',
  [Provider.PALABRA_AI]: 'own-key',
  [Provider.OPENAI_COMPATIBLE]: 'own-key',
  [Provider.OPENAI_TRANSLATE]: 'own-key',
  [Provider.VOLCENGINE_ST]: 'own-key',
  [Provider.VOLCENGINE_AST2]: 'own-key',
  [Provider.ZOOM_AI]: 'own-key',
  [Provider.SONIOX]: 'own-key',
};

describe('providerPathFor', () => {
  it('gives every provider in the enum the path this file names for it', () => {
    const all = Object.values(Provider);
    expect(Object.keys(EXPECTED).sort()).toEqual([...all].sort());
    // The provider rides along in the assertion so a failure names the one that
    // moved, instead of reporting 'own-key' !== 'offline' with no subject.
    for (const p of all) expect([p, providerPathFor(p)]).toEqual([p, EXPECTED[p]]);
  });

  it('exports the offline pair the wizard offers as its engine choice', () => {
    expect(OFFLINE_PROVIDERS).toEqual([Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE]);
  });
});
