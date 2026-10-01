/**
 * Test-only (its `.testing.ts` name puts it under the kit rule: only tests
 * may import it): recorded sessions, as
 * `scripts/dev/wire-probe/translation-cuts-fixtures.mts` wrote them — the
 * OpenAI Translate spike's three (the owner's six sentences with his own
 * pauses, `user`; every pause 1.7 s, `tight`; an eight-sentence mix, `long`)
 * and one Gemini Live Translate session, pushed to talk in two presses
 * (`geminiLiveTranslate`) — replayed
 * into a leg at each event's own arrival time, and what the conversation
 * panel then shows (L1, then L2): which sources have a translation beside
 * them, and which translations stand alone (Stage 2 translation cuts,
 * choice 15).
 */
import type { AdapterEvents } from '../../contract/adapter';
import { createVirtualClock, type VirtualClock } from '../../contract/clock';
import { eventsFrom } from '../../contract/events';
import { Conversation } from '../../conversation/Conversation';
import type { Leg } from '../../conversation/types';
import { createProjector, DEFAULT_PROJECTION } from '../../projection/project';
import type { Pairing } from '../../projection/types';
import geminiLiveTranslate from './gemini-live-translate.json';
import long from './long.json';
import tight from './tight.json';
import user from './user.json';

/**
 * `[arrival ms, 's' | 't', delta, start ms?, end ms?]` — a source or
 * translation transcript delta, with its stamps where the provider sends
 * them (OpenAI Live's `start_ms` / `end_ms`) — or `[arrival ms, 'a',
 * samples, rms?]`, an output audio frame (heartbeats left out; no RMS where
 * the probe measured none).
 */
export type RecordedEvent = [number, 's' | 't', string, (number | null)?, (number | null)?] | [number, 'a', number, number?];

export interface Recording {
  run: string;
  events: RecordedEvent[];
  /** whisper-1's words for the voiced output, `[start ms, end ms, word]` on the output's sample clock, where the probe measured them (OpenAI Live's U4). */
  words?: Array<[number, number, string]>;
}

/** A transcript delta's stamps: null where the recording has none. */
export interface Stamps { startMs: number | null; endMs: number | null }

export const RECORDINGS = { user, tight, long, geminiLiveTranslate } as unknown as Readonly<Record<'user' | 'tight' | 'long' | 'geminiLiveTranslate', Recording>>;

/** What a leg is fed: each side's transcript, and the translation's audio. */
export interface ReplayTarget {
  input(delta: string, stamps: Stamps): void;
  output(delta: string, stamps: Stamps): void;
  audio(pcm: Int16Array): void;
}

export interface ReplayResult {
  /** Source segments with text. */
  sources: number;
  /** Of those, the ones whose exchange holds a translation. */
  paired: number;
  /** Exchanges that hold a translation and no source: fragments standing alone. */
  orphans: number;
  /** Each exchange that holds a translation: how it was paired. */
  pairings: Pairing[];
  /** Each exchange, in order: its source text and its translation text, trimmed. */
  exchanges: Array<[string, string]>;
  /** The leg as L1 holds it at the end: its segments, their speech and its ranges. */
  leg: Leg;
}

/** The level a frame with no measured RMS is filled at: speech, 0.03. */
const SPEECH_RMS = 0.03;

/** A frame of `samples` at the recorded RMS, or at speech level when none was measured; never all zero, which the adapter would have dropped as a heartbeat. */
export function frameAt(samples: number, rms = SPEECH_RMS): Int16Array {
  return new Int16Array(samples).fill(Math.max(1, Math.round(rms * 32768)));
}

/**
 * Plays `recording` into the leg `build` makes on a virtual clock — every
 * event at its own arrival time — lets every timer run out, and folds what
 * the leg emitted into L1 as it came, so each segment opens at its own time.
 */
export function replay(recording: Recording, build: (clock: VirtualClock, events: AdapterEvents) => ReplayTarget): ReplayResult {
  const clock = createVirtualClock(0);
  const conversation = new Conversation({
    leg: 'speaker',
    session: recording.run,
    languages: { source: 'zh', target: 'en' },
    clock,
    retention: { keepPcm: false, maxPcmBytes: 0 },
  });
  const leg = build(clock, eventsFrom((e) => conversation.apply(e)));
  for (const e of recording.events) {
    clock.advance(e[0] - clock.now());
    if (e[1] === 'a') leg.audio(frameAt(e[2], e[3]));
    else if (e[1] === 's') leg.input(e[2], { startMs: e[3] ?? null, endMs: e[4] ?? null });
    else leg.output(e[2], { startMs: e[3] ?? null, endMs: e[4] ?? null });
  }
  clock.advance(30_000);
  const snapshot = conversation.snapshot();
  const entries = createProjector().project([snapshot], { ...DEFAULT_PROJECTION, mode: 'off', sentencesPerRow: 0 });
  const exchanges = entries.flatMap((e) => (e.kind === 'exchange' ? [e] : []));
  const text = (rows: ReadonlyArray<{ text: string }>) => rows.map((r) => r.text).join('').trim();
  const withTranslation = exchanges.filter((e) => e.translation.length > 0);
  return {
    sources: snapshot.segments.filter((s) => s.side === 'source' && s.text.trim() !== '').length,
    paired: withTranslation.reduce((n, e) => n + new Set(e.source.map((r) => r.segmentId)).size, 0),
    orphans: withTranslation.filter((e) => e.source.length === 0).length,
    pairings: withTranslation.map((e) => e.pairing),
    exchanges: exchanges.map((e) => [text(e.source), text(e.translation)]),
    leg: snapshot,
  };
}
