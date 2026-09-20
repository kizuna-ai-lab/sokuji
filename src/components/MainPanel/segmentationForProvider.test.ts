/**
 * What MainPanel decides about segmentation before a client is built.
 *
 * The offers here are the REAL descriptors' — `ProviderConfigFactory` is not
 * mocked — so every "this provider offers X" below is the registry's own
 * answer rather than a literal this file made up. Three shapes exist in
 * phase 1 and all three are reachable from a provider registered in every
 * environment: Gemini (pause + sizes), Local Inference (sizes only) and
 * OpenAI (Auto only). The fourth shape, Auto + sizes, is phase 2's and is the
 * one case that has to be written out by hand.
 */
import { describe, it, expect } from 'vitest';
import { Provider } from '../../types/Provider';
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import {
  segmentationForProvider,
  segmentationOfferFor,
} from './segmentationForProvider';

describe('segmentationOfferFor', () => {
  it('reads the offer off the provider descriptor', () => {
    expect(segmentationOfferFor(Provider.GEMINI)).toEqual({ pause: true, auto: false, sizes: true });
    expect(segmentationOfferFor(Provider.LOCAL_INFERENCE)).toEqual({ pause: false, auto: false, sizes: true });
    expect(segmentationOfferFor(Provider.OPENAI)).toEqual({ pause: false, auto: true, sizes: false });
  });

  it('falls back to the documented default for an id this build did not register', () => {
    // A provider behind a gate that is off, or a stale stored value. The
    // default is the one `resolveSegmentationOffer` applies, not a literal
    // repeated here.
    expect(segmentationOfferFor('not-a-provider')).toEqual({ pause: false, auto: true, sizes: false });
  });
});

describe('segmentationForProvider', () => {
  const PAUSE_AND_SIZES = segmentationOfferFor(Provider.GEMINI);
  const SIZES_ONLY = segmentationOfferFor(Provider.LOCAL_INFERENCE);
  const AUTO_ONLY = segmentationOfferFor(Provider.OPENAI);

  it('runs By pause where it is offered and Off where it is not', () => {
    expect(segmentationForProvider({ storedMode: 'pause', storedSize: 3, offer: PAUSE_AND_SIZES }).mode)
      .toBe('pause');
    expect(segmentationForProvider({ storedMode: 'pause', storedSize: 3, offer: AUTO_ONLY }).mode)
      .toBe('off');
    expect(segmentationForProvider({ storedMode: 'pause', storedSize: 3, offer: SIZES_ONLY }).mode)
      .toBe('off');
  });

  it('runs By sentences everywhere, and Off everywhere', () => {
    for (const offer of [PAUSE_AND_SIZES, SIZES_ONLY, AUTO_ONLY]) {
      expect(segmentationForProvider({ storedMode: 'sentences', storedSize: 3, offer }).mode)
        .toBe('sentences');
      expect(segmentationForProvider({ storedMode: 'off', storedSize: 3, offer }).mode)
        .toBe('off');
    }
  });

  it('keeps a size a provider can count, and hands the clients the same number', () => {
    const got = segmentationForProvider({ storedMode: 'sentences', storedSize: 4, offer: SIZES_ONLY });
    expect(got.size).toBe(4);
    expect(got.sentencesPerChunk).toBe(4);
  });

  it('resolves Auto to a size where Auto is not offered', () => {
    const got = segmentationForProvider({ storedMode: 'sentences', storedSize: 0, offer: PAUSE_AND_SIZES });
    expect(got.size).toBe(3);
    expect(got.sentencesPerChunk).toBe(3);
  });

  it('resolves a size to Auto where sizes are not offered, and still gives the clients 1-5', () => {
    // `ClientOptions.sentencesPerChunk` is contracted 1-5, and on a provider
    // that cannot count, the number is not a bubble size at all: it is only
    // `punctuateDefinite`'s "too short to bother" length gate. Auto must not
    // move that gate — a 0 there would ask the model to punctuate every
    // two-word segment and make the caller wait out the fill-in budget for it.
    const got = segmentationForProvider({ storedMode: 'sentences', storedSize: 5, offer: AUTO_ONLY });
    expect(got.size).toBe(0);
    expect(got.sentencesPerChunk).toBe(3);
  });

  it('gives the clients 1-5 for every stored value, on every phase-1 offer', () => {
    for (const offer of [PAUSE_AND_SIZES, SIZES_ONLY, AUTO_ONLY]) {
      for (const storedSize of [0, 1, 2, 3, 4, 5, -1, 9, Number.NaN]) {
        const { sentencesPerChunk } = segmentationForProvider({ storedMode: 'sentences', storedSize, offer });
        expect(Number.isInteger(sentencesPerChunk), `integer for ${storedSize}`).toBe(true);
        expect(sentencesPerChunk >= 1 && sentencesPerChunk <= 5, `1-5 for ${storedSize}`).toBe(true);
      }
    }
  });

  it('refuses Auto on a provider that also counts, because phase 1 has no wire value for it', () => {
    // Phase 2's shape, and the reason this throws rather than picking a
    // number: there is no `sentencesPerChunk` that means "punctuate, never
    // seal" to a SentenceStream, which clamps whatever it is given to 1 and
    // would seal every single sentence.
    expect(() => segmentationForProvider({
      storedMode: 'sentences',
      storedSize: 0,
      offer: { pause: false, auto: true, sizes: true },
    })).toThrow(/Auto/);
  });

  it('does not refuse that provider when the user picked a size', () => {
    const got = segmentationForProvider({
      storedMode: 'sentences',
      storedSize: 2,
      offer: { pause: false, auto: true, sizes: true },
    });
    expect(got.size).toBe(2);
    expect(got.sentencesPerChunk).toBe(2);
  });

  it('holds the invariant across every phase-1 provider, whatever is stored', () => {
    // The assertion above must not be reachable from anything the registry
    // actually declares today: every registered provider, every stored mode,
    // every stored size.
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const offer = segmentationOfferFor(id);
      for (const storedMode of ['off', 'pause', 'sentences'] as const) {
        for (const storedSize of [0, 1, 2, 3, 4, 5]) {
          expect(() => segmentationForProvider({ storedMode, storedSize, offer }), `${id} ${storedMode} ${storedSize}`)
            .not.toThrow();
        }
      }
    }
  });
});
