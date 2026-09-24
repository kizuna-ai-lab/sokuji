/**
 * Karaoke for one surface process (spec: "Karaoke … only where an observed
 * alignment exists"; "The clip queue"). The clock is the clip queues', not a
 * sink's: the speaker's translation normally plays only into the virtual
 * microphone, which a real-output clock would never see. Positions move
 * without an event between a clip's start and its end, so they are sampled
 * while a queue holds clips and someone listens; otherwise this costs nothing.
 * What the user hears lags the queue's clock by the output element's latency
 * — accepted, not offset.
 */
import type { Playing, QueueView } from '../audio/clipQueue';
import { parseClipKey, type ClipKey } from '../audio/playback';
import { SAMPLE_RATE } from '../contract/adapter';
import type { Clock } from '../contract/clock';
import type { Leg, LegName, Segment, SegmentId } from '../conversation/types';
import { describeCause, reportError } from '../diagnostics/report';
import { countSkeleton } from '../segmentation/sealCursor';
import type { Readable } from './conversationView';

/** The queues karaoke reads: each leg's live speech, and the replay. */
export type QueueName = 'speaker' | 'participant' | 'replay';
const QUEUES: readonly QueueName[] = ['speaker', 'participant', 'replay'];

/** Where one queue's karaoke stands: characters [0, upTo) of a segment are spoken. */
export interface Lit {
  segmentId: SegmentId;
  leg: LegName;
  upTo: number;
}

export interface KaraokeState {
  /** Characters spoken so far, per segment. */
  lit: ReadonlyMap<SegmentId, number>;
  /** The segment a replay is playing, with or without ranges; null when none is. */
  replaying: SegmentId | null;
}

/** How often positions are read while clips are queued: today's `PROGRESS_UPDATE_INTERVAL`. */
export const KARAOKE_INTERVAL_MS = 100;

const NOTHING: KaraokeState = { lit: new Map(), replaying: null };

function clipOf(key: ClipKey, legs: readonly Leg[]): { leg: LegName; segment: Segment; index: number } | null {
  const { leg, ref, index } = parseClipKey(key);
  if (ref === undefined) return null;
  const segment = legs.find((l) => l.leg === leg)?.segments.find((s) => s.ref === ref);
  return segment ? { leg, segment, index } : null;
}

/** The characters a playing clip has spoken: its range, reached in proportion to how far into the clip playback is. No range, nothing lit. */
export function litFor(playing: Playing<ClipKey>, legs: readonly Leg[]): Lit | null {
  const clip = clipOf(playing.key, legs);
  const speech = clip?.segment.speech[clip.index];
  if (!clip || !speech?.range) return null;
  const [a, b] = speech.range;
  const ms = (speech.pcm.length / SAMPLE_RATE) * 1000;
  const f = ms > 0 ? Math.min(1, Math.max(0, playing.t / ms)) : 1;
  return { segmentId: clip.segment.id, leg: clip.leg, upTo: a + Math.round((b - a) * f) };
}

/**
 * What a live queue's karaoke shows now, given what it showed. Playing: the
 * clip decides. In a gap — the clip queue has no seal, so `position()` is
 * null between a segment's clips, and a local engine's speech can arrive
 * after its segment closed — the last state holds while the segment's speech
 * may still continue: it is open, or its speech ranges have not reached its
 * last letter or digit. Otherwise the gap ends it. Decided from L1's data,
 * never a timer.
 */
export function nextLit(prev: Lit | null, playing: Playing<ClipKey> | null, legs: readonly Leg[]): Lit | null {
  if (playing) return litFor(playing, legs);
  if (!prev) return null;
  const segment = legs.find((l) => l.leg === prev.leg)?.segments.find((s) => s.id === prev.segmentId);
  if (!segment) return null;
  const reached = segment.speech.reduce((end, s) => Math.max(end, s.range?.[1] ?? 0), 0);
  const mayContinue = !segment.final || countSkeleton(segment.text.slice(reached)) > 0;
  return mayContinue ? prev : null;
}

function sameLit(a: ReadonlyMap<SegmentId, number>, b: ReadonlyMap<SegmentId, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, upTo] of a) if (b.get(id) !== upTo) return false;
  return true;
}

export function createKaraoke(
  queues: Readonly<Record<QueueName, QueueView<ClipKey>>>,
  view: Readable<{ readonly legs: readonly Leg[] }>,
  clock: Pick<Clock, 'setTimeout'>,
  intervalMs = KARAOKE_INTERVAL_MS,
): Readable<KaraokeState> & { dispose(): void } {
  const held: Record<QueueName, Lit | null> = { speaker: null, participant: null, replay: null };
  const listeners = new Set<() => void>();
  let state = NOTHING;
  let cancel: (() => void) | null = null;

  const sample = () => {
    const legs = view.get().legs;
    const lit = new Map<SegmentId, number>();
    for (const name of QUEUES) {
      const playing = queues[name].position();
      // A replay's clips are enqueued at once, back to back: no position means it has not begun or has ended.
      held[name] = name === 'replay' ? (playing ? litFor(playing, legs) : null) : nextLit(held[name], playing, legs);
      const l = held[name];
      if (l) lit.set(l.segmentId, Math.max(lit.get(l.segmentId) ?? 0, l.upTo));
    }
    const replayKey = queues.replay.position()?.key;
    const replaying = replayKey ? clipOf(replayKey, legs)?.segment.id ?? null : null;
    if (replaying === state.replaying && sameLit(lit, state.lit)) return;
    state = { lit, replaying };
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        reportError('Karaoke', `A karaoke subscriber threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'karaoke-subscriber' });
      }
    }
  };
  const schedule = () => {
    if (cancel || listeners.size === 0) return;
    if (QUEUES.some((name) => queues[name].pending > 0)) cancel = clock.setTimeout(tick, intervalMs);
  };
  const tick = () => {
    cancel = null;
    sample();
    schedule();
  };
  // A clip was enqueued, ended or cleared, or the conversation changed: read now, then keep reading while clips remain.
  const wake = () => {
    if (listeners.size === 0) return;
    sample();
    schedule();
  };
  const offs = [...QUEUES.map((name) => queues[name].subscribe(wake)), view.subscribe(wake)];

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      wake();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          cancel?.();
          cancel = null;
        }
      };
    },
    dispose() {
      offs.forEach((off) => off());
      cancel?.();
      cancel = null;
      listeners.clear();
    },
  };
}
