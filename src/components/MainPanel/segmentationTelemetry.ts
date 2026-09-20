/**
 * What a session reports about the sentence segmentation stage.
 *
 * Three questions the feature cannot be judged without, and none of which any
 * surface the app has could answer before this: how often did it actually seal
 * and on which rule, how much model work that cost, and — the one that decides
 * whether the stage is worth running at all — how much punctuation the ASR was
 * already producing, per language and per ASR model.
 *
 * The counters are a pure function over a plain tally, and the tally is filled
 * by a collector with no React in it, because MainPanel has no rendering
 * harness in this repo (the same constraint that produced
 * sessionModelTelemetry.ts and clientOptions.ts). This is the only way the
 * shipped decision is the tested one.
 *
 * WHERE THE COUNTS COME FROM. Clients are not allowed to import a store or
 * `report.ts`, and only MainPanel knows which leg a client is on. So MainPanel
 * wraps the one `SegmentationRuntime` once per leg (`instrumentSegmentation`)
 * and hands the wrapper to the client through the `ClientOptions.segmentation`
 * hop that already exists. Every `punctuate()` call passes through that wrapper
 * — that is the model-call count, for free, with no client change at all — and
 * `SentenceStream`/`punctuateDefinite` report seals and raw text measurements
 * back through `runtime.observe()`, which the clients' frozen R2 view forwards.
 *
 * NO TEXT, ANYWHERE. An observation carries two integers about a piece of text;
 * the text itself never leaves the client. The payload below is
 * `Record<string, number>` by construction, and the keys are built here from
 * leg, seal reason, ASR model id and language tag only.
 */
import type {
  SegmentationObservation,
  SegmentationRuntime,
} from '../../lib/segmentation/SegmentationRuntime';

export type SegmentationLeg = 'speaker' | 'participant';

/** Raw characters seen for one (leg, language) pair, and the sentence terminals
 *  the ASR itself put in them. */
interface TextBucket {
  leg: SegmentationLeg;
  lang: string;
  chars: number;
  terminals: number;
}

/** One session's accumulated counts. Plain data, so it can be snapshotted,
 *  handed around and asserted on. */
export interface SegmentationTally {
  /** `${leg}_${reason}` -> seals */
  seals: Record<string, number>;
  /** leg -> `punctuate()` calls */
  modelCalls: Record<string, number>;
  /** `${leg}|${lang}` -> the bucket */
  text: Record<string, TextBucket>;
}

export function emptySegmentationTally(): SegmentationTally {
  return { seals: {}, modelCalls: {}, text: {} };
}

/**
 * The mutable side: one per app, reset when a session's counts have been read.
 *
 * Deliberately not a store. Nothing renders from it, a client must never be
 * able to reach it, and a Zustand store that MainPanel writes on every seal
 * would re-render the conversation panel for a number nobody is looking at.
 */
export class SegmentationCounters {
  private tally = emptySegmentationTally();

  record(leg: SegmentationLeg, event: SegmentationObservation): void {
    if (event.kind === 'model_call') {
      this.tally.modelCalls[leg] = (this.tally.modelCalls[leg] ?? 0) + 1;
      return;
    }
    if (event.kind === 'seal') {
      const key = `${leg}_${event.reason}`;
      this.tally.seals[key] = (this.tally.seals[key] ?? 0) + 1;
    }
    const key = `${leg}|${event.lang}`;
    const bucket = this.tally.text[key] ?? (this.tally.text[key] = {
      leg,
      lang: event.lang,
      chars: 0,
      terminals: 0,
    });
    bucket.chars += event.chars;
    bucket.terminals += event.terminals;
  }

  /** A copy, so counting on after the read cannot rewrite what was reported. */
  snapshot(): SegmentationTally {
    const text: Record<string, TextBucket> = {};
    for (const [key, bucket] of Object.entries(this.tally.text)) text[key] = { ...bucket };
    return { seals: { ...this.tally.seals }, modelCalls: { ...this.tally.modelCalls }, text };
  }

  reset(): void {
    this.tally = emptySegmentationTally();
  }
}

/**
 * The per-leg view of the runtime a client is given.
 *
 * `enabled` stays a live read of the wrapped runtime: the clients freeze it
 * themselves, once per session (R2), and freezing it a second time here would
 * move that decision away from the client that owns it.
 */
export function instrumentSegmentation(
  runtime: SegmentationRuntime | null,
  leg: SegmentationLeg,
  onEvent: (leg: SegmentationLeg, event: SegmentationObservation) => void,
): SegmentationRuntime | null {
  if (!runtime) return null;
  return {
    get enabled(): boolean { return runtime.enabled; },
    punctuate: (lang, text, opts) => {
      onEvent(leg, { kind: 'model_call' });
      return runtime.punctuate(lang, text, opts);
    },
    observe: (event) => onEvent(leg, event),
  };
}

/** PostHog property keys are queried by hand, so a space in one is a query the
 *  analyst cannot write. Model ids and language tags come from provider config
 *  and are not guaranteed to be free of them. */
function slug(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) return fallback;
  return trimmed.replace(/\s+/g, '_');
}

export interface SegmentationTelemetryProps {
  /** Seals by reason, per leg, e.g. `{ speaker_sentences: 12, speaker_length: 3 }`. */
  segmentation_seals?: Record<string, number>;
  /** `punctuate()` calls, per leg. */
  segmentation_model_calls?: Record<string, number>;
  /** Sentence terminals per 100 raw characters, per leg / ASR model / language. */
  segmentation_terminals_per_100?: Record<string, number>;
}

/**
 * The segmentation properties of `translation_session_end`.
 *
 * `asrModels` is the same pair `sessionModelTelemetry` reported at session
 * start, so the two events name the same models; a leg whose provider picks no
 * model of its own reports `unknown`, and the event's own `provider` property
 * is what tells those apart.
 *
 * Every record is omitted when empty, so a session that ran with the stage off
 * carries no segmentation properties at all rather than three empty objects.
 */
export function segmentationTelemetry(
  tally: SegmentationTally,
  asrModels: Partial<Record<SegmentationLeg, string>> = {},
): SegmentationTelemetryProps {
  const props: SegmentationTelemetryProps = {};

  if (Object.keys(tally.seals).length > 0) props.segmentation_seals = { ...tally.seals };
  if (Object.keys(tally.modelCalls).length > 0) props.segmentation_model_calls = { ...tally.modelCalls };

  const perHundred: Record<string, number> = {};
  for (const bucket of Object.values(tally.text)) {
    // A bucket with no characters is a seal of an empty tail, not a rate of
    // zero: there is nothing to divide by and nothing to report.
    if (bucket.chars <= 0) continue;
    const key = `${bucket.leg}_${slug(asrModels[bucket.leg], 'unknown')}_${slug(bucket.lang, 'unknown')}`;
    perHundred[key] = Math.round((bucket.terminals / bucket.chars) * 1000) / 10;
  }
  if (Object.keys(perHundred).length > 0) props.segmentation_terminals_per_100 = perHundred;

  return props;
}
