import { Utterances, type SegmentEvent } from '@shared/providers/soniox/utterances';
import type { SonioxToken } from '@shared/providers/soniox/sttStream';
import { Conversation } from '@shared/lib/conversation/Conversation';
import type { Leg } from '@shared/lib/conversation/types';
import { createProjector, DEFAULT_PROJECTION } from '@shared/lib/projection/project';
import type { Entry } from '@shared/lib/projection/types';
import { realClock, type Clock } from '@shared/lib/contract/clock';
import type { AdapterEvent } from '@shared/lib/contract/events';

// The desktop's own transcript pipeline, for the one leg the phone has:
// Soniox tokens → Utterances (the <end>/<fin> handling, speaker labels and the
// fin-grace timer are its own) → Conversation (the leg's segments) →
// the projector's entries, which the subtitle list and the exporters render.
/** Where the translation's final text goes to be spoken (the desktop's LegSpeech); none while nothing speaks. */
export interface SpeechSink {
  speak(ref: number, text: string, span: [number, number], language: string): void;
  endUtterance(): void;
}

export interface Transcript {
  message(tokens: readonly SonioxToken[]): void;
  /** Attach (or detach, with null) what speaks the translation. */
  setSpeech(sink: SpeechSink | null): void;
  /** A new socket numbers speakers from 1 again: open utterances are abandoned. */
  reconnected(): void;
  /** The session's clock (its ticker) for the fin grace: timers armed from now on go there. */
  setClock(clock: Clock): void;
  entries(): readonly Entry[];
  leg(): Leg;
  /** Called once per message that changed something, not once per token. */
  subscribe(listener: () => void): () => void;
  /** The session is over: every open segment becomes final. */
  end(): void;
}

export function createTranscript(o: { source: string; target: string; sessionId: string; clock?: Clock }): Transcript {
  // Delegates, so the clock can be swapped after construction: the transcript
  // is created before the session whose ticker it should run on.
  let inner: Clock = o.clock ?? realClock;
  const clock: Clock = { now: () => inner.now(), setTimeout: (fn, ms) => inner.setTimeout(fn, ms) };
  const conversation = new Conversation({
    leg: 'participant',
    session: o.sessionId,
    languages: { source: o.source, target: o.target },
    clock,
    retention: { keepPcm: false, maxPcmBytes: 0 },
  });
  let speech: SpeechSink | null = null;
  const utterances = new Utterances({
    sink: {
      segment: (_leg, event: SegmentEvent) => conversation.apply(event as AdapterEvent),
      speak: (_leg, ref, text, span, language) => speech?.speak(ref, text, [span[0], span[1]], language),
      endSpeech: () => speech?.endUtterance(),
    },
    clock,
    legFor: () => 'participant',
    targetFor: () => o.target,
  });
  const projector = createProjector();
  let projectedLeg: Leg | null = null;
  let projected: readonly Entry[] = [];

  // Conversation notifies per event; a message is several events. Listeners
  // hear once per message, and once per change that arrives outside one (the
  // fin-grace timer).
  const listeners = new Set<() => void>();
  let inMessage = false;
  let dirty = false;
  const notify = () => listeners.forEach((l) => l());
  conversation.subscribe(() => {
    if (inMessage) dirty = true;
    else notify();
  });
  const settle = (fn: () => void) => {
    inMessage = true;
    try {
      fn();
    } finally {
      inMessage = false;
      if (dirty) {
        dirty = false;
        notify();
      }
    }
  };

  return {
    message: (tokens) => settle(() => utterances.message(tokens)),
    setSpeech: (sink) => { speech = sink; },
    setClock: (c) => { inner = c; },
    reconnected: () => settle(() => utterances.abandon()),
    entries: () => {
      const leg = conversation.snapshot();
      if (leg !== projectedLeg) {
        projectedLeg = leg;
        projected = projector.project([leg], DEFAULT_PROJECTION);
      }
      return projected;
    },
    leg: () => conversation.snapshot(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    end: () => settle(() => {
      utterances.abandon();
      conversation.finalizeAll();
    }),
  };
}
