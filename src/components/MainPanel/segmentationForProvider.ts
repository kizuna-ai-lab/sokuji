/**
 * What one provider's stored segmentation choice means for its clients.
 *
 * A2 stores the mode and the size ONCE and clamps both on read to what the
 * current provider offers. `segmentationMode.ts` owns those two clamping
 * rules; this file is the step after them — turning the clamped answer into
 * the two values a session actually needs: whether the stage runs at all, and
 * the number that rides to every client in `ClientOptions.sentencesPerChunk`.
 *
 * It is a pure function, and separate from MainPanel, because this repo has
 * no React rendering harness for MainPanel — the same constraint that
 * produced `segmentationTelemetry.ts` and `clientOptions.ts`. This is the only
 * way the shipped decision is the tested one.
 */
import { ProviderConfigFactory } from '../../services/providers/ProviderConfigFactory';
import { resolveSegmentationOffer, type ProviderCapabilities } from '../../services/providers/ProviderConfig';
import type { ProviderType } from '../../types/Provider';
import {
  DEFAULT_CHUNK_SENTENCES,
  resolveSegmentationMode,
  resolveSegmentationSize,
  type SegmentationMode,
  type SegmentationOffer,
  type SegmentationSize,
} from '../../lib/segmentation/segmentationMode';

/**
 * What this provider offers, or the documented default when the id is not one
 * this build registered — a provider behind a gate that is off, or a stale
 * stored value. `resolveSegmentationOffer` reads only
 * `capabilities.segmentation`, so an empty object yields exactly that default
 * without this file restating it.
 */
export function segmentationOfferFor(provider: string): SegmentationOffer {
  try {
    // `string`, not `ProviderType`: a stale stored id is exactly the case the
    // catch below exists for, and the factory itself throws on one.
    return resolveSegmentationOffer(ProviderConfigFactory.getConfig(provider as ProviderType).capabilities);
  } catch {
    return resolveSegmentationOffer({} as ProviderCapabilities);
  }
}

export interface ProviderSegmentation {
  /** The mode this provider runs. The stage runs in `sentences` and in no
   *  other: `off` asks for nothing, and in `pause` the client's own silence
   *  timer decides the boundary, so a seal on top of it would be a second
   *  rule cutting the same bubble. */
  mode: SegmentationMode;
  /** The size this provider runs: 0 is Auto, 1-5 seal every N sentences. What
   *  the user effectively chose here, which is what telemetry should report —
   *  not necessarily what the clients are given below. */
  size: SegmentationSize;
  /** What rides in `ClientOptions.sentencesPerChunk`, contracted 1-5. */
  sentencesPerChunk: number;
}

/**
 * Resolve the stored mode and size against one provider's offer.
 *
 * The two numbers differ in exactly one case, and the case is worth stating:
 * on a provider that offers Auto and nothing else, the resolved size is 0, but
 * `sentencesPerChunk` cannot be — it is contracted 1-5, and on such a provider
 * it is not a bubble size at all. Those providers reach the stage through
 * `punctuateDefinite`, which never splits and uses the number only as its "too
 * short to bother" length gate (`gateChars`). A 0 there would zero that gate:
 * every two-word segment would be sent to a model and the caller would wait
 * out the fill-in budget before showing it. Auto therefore lands on the same
 * DEFAULT_CHUNK_SENTENCES every client already defaults to, so switching to
 * Auto moves the boundary rule and nothing else.
 *
 * The other direction is a hard stop rather than a default. Phase 2 is where
 * a provider first offers Auto AND sizes: the local engines gain Auto, and the
 * five splittable server-definite providers gain sizes. On such a provider a
 * resolved 0 is a real user choice, and there is no number that expresses it —
 * `SentenceStream` clamps whatever it is given into 1-5 and would seal every
 * single sentence, which is the loudest possible wrong answer and a silent
 * one. So this throws instead of picking a number, and phase 2 has to come
 * back here and decide how Auto crosses to a client that can count.
 */
export function segmentationForProvider(input: {
  storedMode: SegmentationMode;
  storedSize: number;
  offer: SegmentationOffer;
}): ProviderSegmentation {
  const { storedMode, storedSize, offer } = input;
  const mode = resolveSegmentationMode(storedMode, offer);
  const size = resolveSegmentationSize(storedSize, offer);
  if (size === 0 && offer.sizes) {
    throw new Error(
      'Segmentation: Auto resolved on a provider that also offers sizes, which phase 1 has no '
      + 'ClientOptions.sentencesPerChunk for. Decide what Auto means to a client that counts '
      + 'sentences before declaring both capabilities on a descriptor.',
    );
  }
  return { mode, size, sentencesPerChunk: size === 0 ? DEFAULT_CHUNK_SENTENCES : size };
}
