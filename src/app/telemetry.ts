/**
 * What the app records about a run beyond what the runner sends (plan 1e-3a
 * rulings 11, 12): every frame into the Logs panel, one run's segmentation
 * tallies taken from the frames, and the start/end properties the app keeps.
 */
import type { AnalyticsEvents } from '../lib/analytics';
import type { LegName } from '../lib/conversation/types';
import { sentenceEnds, skeleton } from '../lib/segmentation/sentenceEnd';
import {
  resolveSegmentationMode,
  resolveSegmentationSize,
  type SegmentationMode,
  type SegmentationSize,
} from '../lib/segmentation/segmentationMode';
import type { AdapterFrame, AnalyticsPort, FramePort } from '../lib/session/ports';
import { offerFor, selectedBoundaries } from '../lib/view/appViewSettings';
import useAudioStore from '../stores/audioStore';
import useLogStore, { type EventData } from '../stores/logStore';
import { useSettingsStore } from '../stores/settingsStore';

/** One run's segmentation counts, taken from its frames (1e-3 ruling 11). */
export interface SessionTally {
  /** `${leg}_${reason}` -> seals. */
  seals: Record<string, number>;
  /** Punctuator model calls, for the whole run: one punctuator serves both
   *  legs, and L1 fills the translation side too, so a call cannot name its
   *  leg (the stated departure from today's per-leg count). */
  modelCalls: number;
  /** `${leg}|${model}` -> the raw characters an ASR final produced, and how
   *  many sentence terminals were already in it. */
  text: Record<string, { leg: LegName; model: string; chars: number; terminals: number }>;
}

function emptyTally(): SessionTally {
  return { seals: {}, modelCalls: 0, text: {} };
}

function copyTally(tally: SessionTally): SessionTally {
  const text: SessionTally['text'] = {};
  for (const [key, bucket] of Object.entries(tally.text)) text[key] = { ...bucket };
  return { seals: { ...tally.seals }, modelCalls: tally.modelCalls, text };
}

/**
 * The one place a frame becomes a count. A `local.segmentation.seal` whose
 * text has no letters or digits queues nothing and repeats with every later
 * partial (plan 1e-2b ruling 9 as amended), so it is not counted; nor is one
 * whose `reason` is not a string. A `local.asr.end` with no `modelId` is
 * charged to `'unknown'`. Any other frame, or one with no payload at all,
 * changes nothing.
 */
function count(tally: SessionTally, leg: LegName, frame: AdapterFrame): void {
  const payload = (frame.payload ?? {}) as Record<string, unknown>;
  if (frame.type === 'local.segmentation.seal') {
    const { reason, text } = payload;
    if (typeof reason === 'string' && typeof text === 'string' && skeleton(text) !== '') {
      const key = `${leg}_${reason}`;
      tally.seals[key] = (tally.seals[key] ?? 0) + 1;
    }
    return;
  }
  if (frame.type === 'local.asr.end') {
    const { text } = payload;
    if (typeof text === 'string') {
      const model = typeof payload.modelId === 'string' ? payload.modelId : 'unknown';
      const key = `${leg}|${model}`;
      const bucket = tally.text[key] ?? (tally.text[key] = { leg, model, chars: 0, terminals: 0 });
      bucket.chars += text.length;
      bucket.terminals += sentenceEnds(text).length;
    }
  }
}

/** The runner's `frames` port, and this run's tallies taken from what passed
 *  through it. */
export interface FrameLog {
  readonly port: FramePort;
  countModelCall(): void;
  snapshot(): SessionTally;
  reset(): void;
}

export function createFrameLog(): FrameLog {
  let tally = emptyTally();
  return {
    port: {
      frame(leg, frame) {
        // The Logs panel's feed, under the leg's tab, as MainPanel's
        // `addRealtimeEvent(…, leg)` is today; it records nothing while
        // diagnostic logs are off. A frame's type is an open string — the
        // union names the old clients' events.
        useLogStore.getState().addRealtimeEvent(
          { type: frame.type as EventData['type'], data: frame.payload ?? {} },
          frame.direction === 'out' ? 'client' : 'server',
          frame.type,
          leg,
        );
        count(tally, leg, frame);
      },
    },
    countModelCall: () => { tally.modelCalls += 1; },
    snapshot: () => copyTally(tally),
    reset: () => { tally = emptyTally(); },
  };
}

/** `first`'s behaviour when there is no `second`; otherwise every frame
 *  reaches both, `first` first. */
export function teeFrames(first: FramePort, second?: FramePort): FramePort {
  return second ? { frame: (leg, f) => { first.frame(leg, f); second.frame(leg, f); } } : first;
}

/** What `sessionStartProperties` needs, frozen at the moment a run starts. */
export interface StartInputs {
  audio: Pick<
    ReturnType<typeof useAudioStore.getState>,
    'noiseSuppressionMode' | 'isRealVoicePassthroughEnabled' | 'isMicMuted' | 'isMonitorMuted'
  >;
  segmentation: { mode: SegmentationMode; size: SegmentationSize };
  punctuationActive: boolean;
}

/** The eight kept properties of `translation_session_start` (1e-3 ruling 13):
 *  today's MainPanel session-analytics effect, word for word. */
export function sessionStartProperties(i: StartInputs): Pick<
  AnalyticsEvents['translation_session_start'],
  | 'noise_suppression_enabled' | 'noise_suppression_mode' | 'real_voice_passthrough_enabled'
  | 'input_device_on' | 'monitor_device_on'
  | 'sentence_segmentation_enabled' | 'sentence_segmentation_active' | 'sentence_segmentation_chunk_sentences'
> {
  return {
    noise_suppression_enabled: i.audio.noiseSuppressionMode !== 'off',
    noise_suppression_mode: i.audio.noiseSuppressionMode,
    real_voice_passthrough_enabled: i.audio.isRealVoicePassthroughEnabled,
    input_device_on: !i.audio.isMicMuted,
    monitor_device_on: !i.audio.isMonitorMuted,
    sentence_segmentation_enabled: i.segmentation.mode === 'sentences',
    sentence_segmentation_active: i.punctuationActive,
    sentence_segmentation_chunk_sentences: i.segmentation.size,
  };
}

/** What `sessionEndProperties` needs about the run that just ended: the
 *  language pair (a text bucket's own language is the speaker's source or
 *  the participant's target — it transcribes the translated speech) and
 *  which legs ran (a model call cannot name its own leg; see `SessionTally`). */
export interface RunFacts {
  pair: { source: string; target: string };
  legs: readonly string[];
}

/** PostHog property keys are queried by hand, so a space in one is a query
 *  the analyst cannot write — today's `segmentationTelemetry.ts` rule, word
 *  for word. */
function slug(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  return trimmed.replace(/\s+/g, '_');
}

/**
 * The three segmentation records of `translation_session_end` (1e-3 ruling
 * 11). Every record is omitted when empty, so a run with the stage off — or
 * one with nothing yet to report — carries no segmentation properties at all.
 */
export function sessionEndProperties(tally: SessionTally, run: RunFacts): Pick<
  AnalyticsEvents['translation_session_end'],
  'segmentation_seals' | 'segmentation_model_calls' | 'segmentation_terminals_per_100'
> {
  const props: Pick<
    AnalyticsEvents['translation_session_end'],
    'segmentation_seals' | 'segmentation_model_calls' | 'segmentation_terminals_per_100'
  > = {};

  if (Object.keys(tally.seals).length > 0) props.segmentation_seals = { ...tally.seals };

  if (tally.modelCalls > 0) {
    // Stated departure from today's per-leg count: one punctuator serves both
    // legs, so a call cannot be attributed to one when both ran.
    const key = run.legs.length === 1 ? run.legs[0] : 'both';
    props.segmentation_model_calls = { [key]: tally.modelCalls };
  }

  const perHundred: Record<string, number> = {};
  for (const bucket of Object.values(tally.text)) {
    // A bucket with no characters is a seal of an empty tail, not a rate of
    // zero: there is nothing to divide by and nothing to report.
    if (bucket.chars <= 0) continue;
    const lang = bucket.leg === 'speaker' ? run.pair.source : run.pair.target;
    const key = `${bucket.leg}_${slug(bucket.model, 'unknown')}_${slug(lang, 'unknown')}`;
    perHundred[key] = Math.round((bucket.terminals / bucket.chars) * 1000) / 10;
  }
  if (Object.keys(perHundred).length > 0) props.segmentation_terminals_per_100 = perHundred;

  return props;
}

/** The stores now — the run's shape froze the same values a moment ago. */
export function appStartInputs(punctuationActive: boolean): StartInputs {
  const audio = useAudioStore.getState();
  const s = useSettingsStore.getState();
  const offer = offerFor(selectedBoundaries());
  return {
    audio,
    segmentation: {
      mode: resolveSegmentationMode(s.segmentationMode, offer),
      size: resolveSegmentationSize(s.sentenceSegmentationChunkSentences, offer),
    },
    punctuationActive,
  };
}

/**
 * A decorator over the runner's analytics bridge (1e-3 ruling 12): adds the
 * app-kept properties to `translation_session_start` and
 * `translation_session_end`; every other event passes through unchanged.
 * `track()` is read at each call, not captured once, so swapping the bridge
 * between the two events reaches the new one.
 */
export function decorateSessionAnalytics(
  track: () => AnalyticsPort['track'],
  deps: { frames: FrameLog; startInputs(): StartInputs },
): AnalyticsPort {
  let run: RunFacts = { pair: { source: '', target: '' }, legs: [] };
  const send = <E extends keyof AnalyticsEvents>(event: E, properties: AnalyticsEvents[E]) => track()(event, properties);
  return {
    track: ((event: keyof AnalyticsEvents, properties: AnalyticsEvents[keyof AnalyticsEvents]) => {
      if (event === 'translation_session_start') {
        const start = properties as AnalyticsEvents['translation_session_start'];
        // A run's tallies start with it; the runner sends this the moment
        // the run goes live.
        deps.frames.reset();
        run = { pair: { source: start.source_language, target: start.target_language }, legs: start.channels ?? [] };
        send('translation_session_start', { ...start, ...sessionStartProperties(deps.startInputs()) });
        return;
      }
      if (event === 'translation_session_end') {
        const end = properties as AnalyticsEvents['translation_session_end'];
        send('translation_session_end', { ...end, ...sessionEndProperties(deps.frames.snapshot(), run) });
        return;
      }
      // Passed straight through. `send`'s own generic cannot be called here:
      // `event` and `properties` are each already the wide union of every
      // event this point could see, and asking TS to re-correlate a fresh
      // type parameter against two independently-widened unions is exactly
      // what `AnalyticsPort['track']`'s own cast at the bottom of this
      // function sidesteps for the same reason.
      (track() as (event: string, properties: unknown) => void)(event, properties);
    }) as AnalyticsPort['track'],
  };
}
