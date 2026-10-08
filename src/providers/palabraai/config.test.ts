import { describe, it, expect } from 'vitest';
import type { SessionContext } from '../../lib/contract/adapter';
import type { SharedSettings } from '../../lib/provider/types';
import { buildPalabra, describePalabra } from './config';
import { PALABRA_DEFAULTS } from './settings';

const SHARED: SharedSettings = {
  pauses: { sourceSeconds: 1, translationSeconds: 1 },
  reversed: () => false,
  segmentation: { mode: 'off', sentencesPerRow: 0 },
  models: [],
};
const ctx = (source: string, target: string, patch: Partial<SessionContext> = {}): SessionContext => ({ direction: { source, target }, speech: true, turns: 'auto', ...patch });

describe("Palabra AI's builder", () => {
  it('builds one leg from its direction and the settings, clamped as the API takes them (ruling 10)', () => {
    expect(buildPalabra(ctx('ja', 'en-US'), PALABRA_DEFAULTS, SHARED)).toEqual({
      source: 'ja', target: 'en-us', speech: true, voiceId: 'default_low', silenceThreshold: 0.7, sentenceSplitter: true, translatePartials: false,
      queue: { desiredMs: 8_000, maxMs: 24_000, autoTempo: false },
    });
    const stored = { ...PALABRA_DEFAULTS, voiceId: 'default_high' as const, segmentConfirmationSilenceThreshold: 0.1, desiredQueueLevelMs: 15_000, maxQueueLevelMs: 12_000, autoTempo: true };
    expect(buildPalabra(ctx('ja', 'en'), stored, SHARED)).toMatchObject({ voiceId: 'default_high', silenceThreshold: 0.3, queue: { desiredMs: 15_000, maxMs: 18_000, autoTempo: true } });
  });

  it('asks for text alone on a leg that does not speak (ruling 7), and builds the participant as the same call on its direction (D17)', () => {
    expect(buildPalabra(ctx('ja', 'en', { speech: false }), PALABRA_DEFAULTS, SHARED)).toMatchObject({ speech: false });
    // `ja → en-us`'s participant, as Palabra's own reverse gives it (ruling 9).
    expect(buildPalabra(ctx('en', 'ja', { speech: false }), PALABRA_DEFAULTS, { ...SHARED, reversed: () => true })).toMatchObject({ source: 'en', target: 'ja', speech: false });
    expect(buildPalabra(ctx('auto', 'es'), PALABRA_DEFAULTS, SHARED)).toMatchObject({ source: 'auto', target: 'es' });
  });

  it('asks for no translation and no speech when transcribing only', () => {
    const c = buildPalabra(ctx('ja', 'en', { translate: false }), PALABRA_DEFAULTS, SHARED);
    expect(c).toMatchObject({ speech: false, transcribeOnly: true });
  });

  it('refuses a direction its lists do not offer, a guard the store and the gate keep unreachable', () => {
    expect(buildPalabra(ctx('ja', 'bn'), PALABRA_DEFAULTS, SHARED)).toEqual({ refused: 'Palabra AI does not translate ja → bn.' });
    expect(buildPalabra(ctx('en-US', 'ja'), PALABRA_DEFAULTS, SHARED)).toEqual({ refused: 'Palabra AI does not translate en-US → ja.' });
  });

  it('names no model: the old start named none for Palabra', () => {
    const c = buildPalabra(ctx('ja', 'en'), PALABRA_DEFAULTS, SHARED);
    if ('refused' in c) throw new Error(c.refused);
    expect(describePalabra(c)).toEqual({});
  });
});

describe("Palabra AI's wire codes", () => {
  it('sends Palabra its own codes', () => {
    const c = buildPalabra(ctx('en', 'es-CL'), PALABRA_DEFAULTS, SHARED);
    expect(c).toMatchObject({ source: 'en', target: 'es-ch' });
  });
});
