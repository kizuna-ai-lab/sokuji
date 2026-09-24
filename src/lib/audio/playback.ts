/**
 * Everything the app plays, behind the runner's `PlaybackPort` (spec:
 * "Playback"): a clip queue per leg and one for replay, the preview route,
 * the route table kept live from the routing settings, and the tts tap.
 */
import type { LegName, Segment } from '../conversation/types';
import type { PlaybackPort } from '../session/ports';
import { ClipQueue, type QueueView } from './clipQueue';
import type { AudioGraph, OneShot } from './graph';
import { LiveStream } from './liveStream';
import type { PcmTap } from './pcmTap';
import { routesFor, type RoutingSettings } from './routes';

/** One clip: a leg, the segment its `ref` names ('none' when it names none), and which of the segment's speech entries. */
export type ClipKey = `${LegName}:${number | 'none'}:${number}`;

export function clipKey(leg: LegName, ref: number | undefined, index: number): ClipKey {
  return `${leg}:${ref ?? 'none'}:${index}`;
}

/** The routing settings, live: the app reads its stores, the preview its toggles, a test a fixture. */
export interface RoutingSource {
  get(): RoutingSettings;
  subscribe(listener: () => void): () => void;
}

/** A voice sample or the test tone, at its own rate. */
export interface PreviewClip {
  audio: Float32Array;
  sampleRate: number;
}

export interface Playback extends PlaybackPort {
  readonly queues: Readonly<Record<'speaker' | 'participant' | 'replay', QueueView<ClipKey>>>;
  /** Plays a segment's kept speech on the real device, replacing any replay in progress. */
  replay(leg: LegName, segment: Segment): void;
  stopReplay(): void;
  /** Plays a clip on the real device, stopping the previous one; resolves when it ends or is stopped. */
  preview(clip: PreviewClip): Promise<void>;
  stopPreview(): void;
  /** The microphone's chunk, processed: the original voice under the translation. The passthrough route and its ratio decide whether the meeting hears it. */
  passthrough(pcm: Int16Array): void;
  /** The translated speech as played, before any route: the echo monitor's reference. */
  readonly ttsTap: PcmTap;
  dispose(): Promise<void>;
}

export function createPlayback(graph: AudioGraph, routing: RoutingSource): Playback {
  const live: Record<LegName, ClipQueue<ClipKey>> = {
    speaker: new ClipQueue<ClipKey>(graph.timeline('speaker')),
    participant: new ClipQueue<ClipKey>(graph.timeline('participant')),
  };
  const replayQueue = new ClipQueue<ClipKey>(graph.timeline('replay'));
  const passthroughStream = new LiveStream(graph.timeline('passthrough'));
  /**
   * Per `${leg}:${ref}`, how many clips have arrived: the next one's speech
   * entry index, since L1 appends one entry per `audio` event, in order.
   */
  const counts = new Map<string, number>();
  let held = false;
  let current: OneShot | null = null;

  const apply = () => {
    const settings = routing.get();
    graph.route(routesFor(settings, held));
    void graph.setSinks(settings.sinks);
  };
  apply();
  const unsubscribe = routing.subscribe(apply);

  const stopPreview = () => {
    current?.stop();
    current = null;
  };

  return {
    queues: { speaker: live.speaker, participant: live.participant, replay: replayQueue },

    audio(leg, ref, pcm) {
      const id = `${leg}:${ref ?? 'none'}`;
      const index = counts.get(id) ?? 0;
      counts.set(id, index + 1);
      void graph.resume();
      live[leg].enqueue(clipKey(leg, ref, index), pcm);
    },

    held(next) {
      if (next === held) return;
      held = next;
      apply();
    },

    clear() {
      live.speaker.clear();
      live.participant.clear();
      replayQueue.clear();
      // L1's `clear()` empties every segment's speech too: the indices restart together.
      counts.clear();
    },

    replay(leg, segment) {
      replayQueue.clear();
      void graph.resume();
      segment.speech.forEach((entry, index) => {
        // An entry whose pcm retention dropped plays nothing, but keeps its index.
        if (entry.pcm.length > 0) replayQueue.enqueue(clipKey(leg, segment.ref, index), entry.pcm);
      });
    },

    stopReplay: () => replayQueue.clear(),

    preview(clip) {
      stopPreview();
      if (clip.audio.length === 0) return Promise.resolve();
      void graph.resume();
      let shot: OneShot;
      try {
        shot = graph.playOnce(clip.audio, clip.sampleRate);
      } catch (error) {
        // createBuffer rejects a rate outside its supported range: a caller
        // awaiting this promise must see a rejection, not a synchronous throw.
        return Promise.reject(error);
      }
      current = shot;
      return shot.ended.then(() => {
        if (current === shot) current = null;
      });
    },

    stopPreview,

    passthrough(pcm) {
      void graph.resume();
      passthroughStream.push(pcm);
    },

    ttsTap: graph.ttsTap,

    async dispose() {
      unsubscribe();
      live.speaker.clear();
      live.participant.clear();
      replayQueue.clear();
      passthroughStream.clear();
      stopPreview();
      await graph.close();
    },
  };
}
