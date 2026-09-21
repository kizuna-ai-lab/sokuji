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
   *  the user effectively chose here, which is what telemetry reports. */
  size: SegmentationSize;
  /** The same number, under the name it travels to a client by
   *  (`ClientOptions.sentencesPerChunk`). Two names for one value, because
   *  they answer different questions — what the user chose, and what the
   *  session was told — and only one of them is a wire field. */
  sentencesPerChunk: number;
}

/**
 * Resolve the stored mode and size against one provider's offer.
 *
 * The resolved size IS what the clients are told: 0 for Auto, 1-5 for a
 * bubble every N sentences. Phase 1 could not do that. Back then the only
 * provider that could resolve to 0 was one offering Auto alone, whose client
 * reaches the stage through `punctuateDefinite` — which never split anything
 * and used the number only as its "too short to bother" length gate
 * (`gateChars`) — so 0 had no meaning there and Auto was translated into
 * DEFAULT_CHUNK_SENTENCES on the way out. A provider offering Auto *and*
 * sizes had no answer at all, and this function threw rather than guess one:
 * every number in 1-5 says "seal every N sentences", which is the opposite of
 * Auto, and a `SentenceStream` handed a 0 clamps it to 1 and seals every
 * single sentence — the loudest possible wrong answer, arrived at silently.
 *
 * Phase 2 gives 0 a meaning instead of a translation: to a client that counts
 * it means build no stream and punctuate the utterance whole, and to a client
 * whose segments a server already closed it means keep the segment as one
 * piece. So the number crosses untouched, and every reader of it decides what
 * Auto is in its own terms.
 */
export function segmentationForProvider(input: {
  storedMode: SegmentationMode;
  storedSize: number;
  offer: SegmentationOffer;
}): ProviderSegmentation {
  const { storedMode, storedSize, offer } = input;
  const mode = resolveSegmentationMode(storedMode, offer);
  const size = resolveSegmentationSize(storedSize, offer);
  return { mode, size, sentencesPerChunk: size };
}
