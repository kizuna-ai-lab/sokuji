/**
 * The segmentation mode, and the rules that resolve one stored choice against
 * what a given provider can actually do.
 *
 * Amendment A2 of the sentence segmentation design turned A1's on/off switch
 * into a three-way choice, because the pause timers two client families
 * already run are a second way of cutting a bubble and the two ways are
 * mutually exclusive. The mode, the size and the two pause durations are
 * stored ONCE, not per provider: a per-provider copy would make the same
 * question look answered differently on every row of the provider list, and
 * A2 chose one answer clamped on read instead.
 *
 * Clamping on read is what these two functions are. Nothing here reads a
 * store or a React hook — the caller brings the stored value and the current
 * provider's offer, and gets back what that provider will run.
 */

export type SegmentationMode = 'off' | 'pause' | 'sentences';
/** 0 is Auto: punctuate, never seal. 1-5 seal every N sentences. */
export type SegmentationSize = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Both pauses, in milliseconds, when nothing supplied one — the same 1.5 s the
 * store defaults to and clamps around (0.1-3 s). A client reached by a path
 * that carries no pause, and a client built in a test, run on this.
 */
export const DEFAULT_SEGMENT_PAUSE_MS = 1500;

/**
 * Seconds in settings, milliseconds in clients.
 *
 * Each descriptor converts here, on its way into a client's constructor, which
 * is where this provider's slice values were converted before A2 made the pair
 * global. One function rather than a `Math.round(x * 1000)` in every
 * descriptor: the default above has to be the same number at each of the five
 * call sites — the four pause providers plus the Kizuna twin.
 */
export function segmentPauseMs(seconds: number | undefined): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return DEFAULT_SEGMENT_PAUSE_MS;
  return Math.round(seconds * 1000);
}

/**
 * The range a silence timer usefully takes, the store's 0.1-3 s in
 * milliseconds. The guard belongs to the client that arms the timer, because
 * the store is not the only way in: a client can be built directly, and a
 * pause of a few milliseconds would fire between two words.
 */
export function clampSegmentPauseMs(ms: number | undefined): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return DEFAULT_SEGMENT_PAUSE_MS;
  return Math.max(100, Math.min(3000, ms));
}

/** Which of the three choices a provider offers. Built by the descriptor. */
export interface SegmentationOffer {
  /** The client cuts on its own silence timers, and the user may tune them. */
  pause: boolean;
  /** Something else decides the boundary, so "punctuate, do not split" is a
   *  meaningful choice. */
  auto: boolean;
  /** A bubble every N sentences is implementable here. */
  sizes: boolean;
}

/** The size a provider falls back to. Every provider offers at least one of
 *  Auto and sizes, so exactly one of these two is always reachable. */
function defaultSize(offer: SegmentationOffer): SegmentationSize {
  return offer.sizes ? 3 : 0;
}

/**
 * The mode this provider actually runs, given what the user chose.
 *
 * Off and By sentences survive everywhere: Off asks for nothing, and By
 * sentences is runnable wherever either Auto or a size is, which is
 * everywhere. By pause is the one that can fail, and it fails to Off — which
 * is the point of the `pause` default, since it means By pause on the three
 * clients that have timers and Off on every other provider.
 *
 * A mode string this build does not know — an older build's value, a
 * hand-edited settings file — takes the same path as the default rather than
 * being reported: there is no user action to take, and the resolved value is
 * the one the settings section will show as selected.
 */
export function resolveSegmentationMode(
  stored: SegmentationMode,
  offer: SegmentationOffer,
): SegmentationMode {
  if (stored === 'off' || stored === 'sentences') return stored;
  return offer.pause ? 'pause' : 'off';
}

/**
 * The size this provider actually uses, given what the user chose.
 *
 * The two ways this can miss are symmetric: Auto asked of a provider that
 * decides its own boundaries has nothing to keep, so it becomes the default
 * 3; a count asked of a provider that cannot be split has nothing to count
 * into, so it becomes Auto.
 *
 * The value is validated before either rule, because it reaches a
 * SentenceStream that multiplies it into thresholds — `settingsStore`'s
 * `clampChunkSentences` guards the store, and this guards everything that
 * never went through the store.
 */
export function resolveSegmentationSize(
  stored: number,
  offer: SegmentationOffer,
): SegmentationSize {
  const n = Math.round(Number(stored));
  const size: SegmentationSize = Number.isFinite(n) && n >= 0 && n <= 5
    ? (n as SegmentationSize)
    : defaultSize(offer);
  if (size === 0 && !offer.auto) return 3;
  if (size !== 0 && !offer.sizes) return 0;
  return size;
}
