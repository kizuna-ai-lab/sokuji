/**
 * What MainPanel decides about segmentation before a client is built.
 *
 * The offers here are the REAL descriptors' — `ProviderConfigFactory` is not
 * mocked — so every "this provider offers X" below is the registry's own
 * answer rather than a literal this file made up. Phase 2 made the fourth
 * shape real, so three of the four are now reachable from a provider
 * registered in every environment: Gemini (pause + sizes), Local Inference
 * (Auto + sizes) and OpenAI (Auto only). Sizes without Auto is the one shape
 * no descriptor declares any more — the local engines were its last holders —
 * so it is the one that has to be written out by hand.
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
    expect(segmentationOfferFor(Provider.LOCAL_INFERENCE)).toEqual({ pause: false, auto: true, sizes: true });
    expect(segmentationOfferFor(Provider.SONIOX)).toEqual({ pause: false, auto: true, sizes: true });
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
  const AUTO_AND_SIZES = segmentationOfferFor(Provider.LOCAL_INFERENCE);
  const AUTO_ONLY = segmentationOfferFor(Provider.OPENAI);
  /** Not a registered shape any more: every provider that can count sentences
   *  can also leave the boundary to whoever already decided it. Kept because
   *  the resolvers still have a rule for it and nothing else exercises it. */
  const SIZES_ONLY = { pause: false, auto: false, sizes: true };

  const ALL_SHAPES = [PAUSE_AND_SIZES, AUTO_AND_SIZES, AUTO_ONLY, SIZES_ONLY];

  it('runs By pause where it is offered and Off where it is not', () => {
    expect(segmentationForProvider({ storedMode: 'pause', storedSize: 3, offer: PAUSE_AND_SIZES }).mode)
      .toBe('pause');
    expect(segmentationForProvider({ storedMode: 'pause', storedSize: 3, offer: AUTO_ONLY }).mode)
      .toBe('off');
    expect(segmentationForProvider({ storedMode: 'pause', storedSize: 3, offer: AUTO_AND_SIZES }).mode)
      .toBe('off');
  });

  it('runs By sentences everywhere, and Off everywhere', () => {
    for (const offer of ALL_SHAPES) {
      expect(segmentationForProvider({ storedMode: 'sentences', storedSize: 3, offer }).mode)
        .toBe('sentences');
      expect(segmentationForProvider({ storedMode: 'off', storedSize: 3, offer }).mode)
        .toBe('off');
    }
  });

  it('keeps a size a provider can count, and hands the clients the same number', () => {
    const got = segmentationForProvider({ storedMode: 'sentences', storedSize: 4, offer: AUTO_AND_SIZES });
    expect(got.size).toBe(4);
    expect(got.sentencesPerChunk).toBe(4);
  });

  it('resolves Auto to a size where Auto is not offered', () => {
    const got = segmentationForProvider({ storedMode: 'sentences', storedSize: 0, offer: PAUSE_AND_SIZES });
    expect(got.size).toBe(3);
    expect(got.sentencesPerChunk).toBe(3);
  });

  it('resolves a size to Auto where sizes are not offered, and sends the clients the 0', () => {
    const got = segmentationForProvider({ storedMode: 'sentences', storedSize: 5, offer: AUTO_ONLY });
    expect(got.size).toBe(0);
    expect(got.sentencesPerChunk).toBe(0);
  });

  it('sends Auto as a 0 on a provider that also counts, instead of refusing it', () => {
    // Phase 1 threw here, because no client could tell Auto from a size and
    // picking 3 would have silently turned Auto into three-sentence bubbles.
    // Phase 2's answer is the 0 itself: the clients learn what it means.
    const got = segmentationForProvider({
      storedMode: 'sentences',
      storedSize: 0,
      offer: AUTO_AND_SIZES,
    });
    expect(got.size).toBe(0);
    expect(got.sentencesPerChunk).toBe(0);
  });

  it('does not change what a picked size sends on that same provider', () => {
    const got = segmentationForProvider({
      storedMode: 'sentences',
      storedSize: 2,
      offer: AUTO_AND_SIZES,
    });
    expect(got.size).toBe(2);
    expect(got.sentencesPerChunk).toBe(2);
  });

  it('hands the clients the resolved size itself, for every stored value and every shape', () => {
    for (const offer of ALL_SHAPES) {
      for (const storedSize of [0, 1, 2, 3, 4, 5, -1, 9, Number.NaN]) {
        const { size, sentencesPerChunk } = segmentationForProvider({
          storedMode: 'sentences', storedSize, offer,
        });
        expect(sentencesPerChunk, `same number for ${storedSize}`).toBe(size);
        expect(Number.isInteger(sentencesPerChunk), `integer for ${storedSize}`).toBe(true);
        expect(sentencesPerChunk >= 0 && sentencesPerChunk <= 5, `0-5 for ${storedSize}`).toBe(true);
      }
    }
  });

  it('answers every registered provider, in every mode, at every stored size', () => {
    // Nothing throws any more, and every answer is one the section can render
    // — a mode it draws a button for, and a size that is either Auto or one
    // of its five — and one a client can use, which is the same number.
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const offer = segmentationOfferFor(id);
      for (const storedMode of ['off', 'pause', 'sentences'] as const) {
        for (const storedSize of [0, 1, 2, 3, 4, 5]) {
          const where = `${id} ${storedMode} ${storedSize}`;
          const got = segmentationForProvider({ storedMode, storedSize, offer });
          expect(['off', 'pause', 'sentences'], where).toContain(got.mode);
          expect([0, 1, 2, 3, 4, 5], where).toContain(got.size);
          expect(got.sentencesPerChunk, where).toBe(got.size);
          // A resolved size is one the provider actually offers: Auto only
          // where Auto is offered, a count only where counting is.
          if (got.size === 0) expect(offer.auto, `Auto offered on ${where}`).toBe(true);
          else expect(offer.sizes, `sizes offered on ${where}`).toBe(true);
        }
      }
    }
  });
});
