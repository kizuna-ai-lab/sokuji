// src/lib/history/capture/writer.ts
//
// The observer that writes a running session into its History record. It watches the runner's state and its
// conversation set, never changes either, and sends ordered writes through the `HistoryPort`: the record is opened
// when the run shows its legs, the conversation is stored as it changes, the original text is cut into numbered
// sentences, later corrections are followed, and the record is closed when the run is over. History never disturbs
// a session: every failed write is caught, and after three a record is given up and reported once.
import type { StoreApi } from 'zustand/vanilla';
import type { Clock } from '../../contract/clock';
import type { Leg, LegName, Segment } from '../../conversation/types';
import type { ConversationSet } from '../../session/conversationSet';
import type { RunState } from '../../session/types';
import type { HistoryPort } from '../port';
import type { HistorySegment, HistorySentenceInput } from '../types';
import { createSegmentCut, type SegmentCut } from './cut';

/** An open segment is written at most this often. */
export const SEGMENT_WRITE_MS = 1000;
/** While a record is open, the open segments and the time-based cuts are looked at again this often. */
export const TICK_MS = 1000;
/** A record whose writes failed this many times is given up. */
const FAILURES_TO_GIVE_UP = 3;

export interface LegComposition {
  input: 'microphone' | 'system' | 'app' | 'tab' | null;
  inputName: string | null;
  inputId: string | null;
  spoken: boolean;
}

export interface CaptureFacts {
  /** A label of the preset the user picked; nothing is decided by it. */
  mode: string;
  legs: Partial<Record<LegName, LegComposition>>;
  /** One connection serves both legs: which side said a word is inferred. */
  shared: boolean;
  /** False when the session gives no original text: the translation is cut instead. */
  originalText: boolean;
  appVersion: string;
}

export interface HistoryWriterDeps {
  state: StoreApi<RunState>;
  conversation: ConversationSet;
  port: HistoryPort;
  clock: Clock;
  facts: () => CaptureFacts;
  report?: (message: string, cause: unknown) => void;
}

export interface HistoryWriter {
  /** Every write produced so far has been answered. */
  settled(): Promise<void>;
  dispose(): void;
}

interface Tracked {
  /** The segment object last looked at (snapshots replace a segment that changed). */
  seen: Segment | null;
  cut?: SegmentCut;
  /** Sentence number by the cutter's index. */
  numbers: number[];
  writtenAt: number;
  writtenFinal: boolean;
  /** Changed since it was last written. */
  dirty: boolean;
}

interface Rec {
  id: string;
  startedAt: number;
  facts: CaptureFacts;
  transcriptId: number | null;
  nextNumber: number;
  segments: Map<string, Tracked>;
  noticesWritten: Set<string>;
  failures: number;
  givenUp: boolean;
}

const OPEN_PHASES = new Set<RunState['phase']>(['starting', 'running']);

const withoutSpeech = ({ speech: _speech, heard: _heard, ...rest }: Segment): HistorySegment => rest;

export function createHistoryWriter(deps: HistoryWriterDeps): HistoryWriter {
  const { state, conversation, port, clock } = deps;
  const report = deps.report ?? (() => {});
  let rec: Rec | null = null;
  /** Records already opened in this page: a later notification about them never opens them again. */
  const known = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  let cancelTick: (() => void) | null = null;
  let disposed = false;

  /** Queues one call for `r`; calls run one at a time, in the order produced. */
  function send(r: Rec, call: () => Promise<unknown> | null): void {
    chain = chain.then(async () => {
      if (r.givenUp) return;
      try {
        const pending = call();
        if (pending) await pending;
      } catch (error) {
        r.failures += 1;
        if (r.failures >= FAILURES_TO_GIVE_UP) {
          r.givenUp = true;
          report(`History stopped writing record ${r.id} after ${r.failures} failed writes`, error);
        }
      }
    });
  }

  function armTick(): void {
    cancelTick?.();
    cancelTick = clock.setTimeout(() => {
      cancelTick = null;
      if (!rec || disposed) return;
      sync(rec, conversation.snapshot());
      armTick();
    }, TICK_MS);
  }

  function open(session: string, legs: readonly Leg[]): void {
    const facts = deps.facts();
    const info = conversation.info;
    const speaker = legs.find((l) => l.leg === 'speaker');
    const participant = legs.find((l) => l.leg === 'participant');
    const myLanguage = speaker ? speaker.languages.source : participant?.languages.target ?? '';
    const targetLanguage = speaker ? speaker.languages.target : participant?.languages.source ?? '';
    const models = Object.fromEntries(Object.entries(info?.models ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'));
    const r: Rec = {
      id: session, startedAt: clock.now(), facts, transcriptId: null, nextNumber: 1,
      segments: new Map(), noticesWritten: new Set(), failures: 0, givenUp: false,
    };
    rec = r;
    known.add(session);
    send(r, () => port.openRecord({
      id: session, startedAt: r.startedAt, mode: facts.mode, myLanguage, targetLanguage,
      services: { provider: info?.provider ?? '', models }, appVersion: facts.appVersion,
    }));
    for (const leg of legs) {
      const c = facts.legs[leg.leg];
      send(r, () => port.putLeg({
        recordId: session, leg: leg.leg, languages: leg.languages,
        input: c?.input ?? null, inputName: c?.inputName ?? null, inputId: c?.inputId ?? null, translated: true, spoken: c?.spoken ?? false,
      }));
    }
    send(r, () => port.createTranscript({
      recordId: session, origin: { service: info?.provider ?? '', kind: 'live' }, textKind: facts.originalText ? 'original' : 'translation',
    }).then((id) => { r.transcriptId = id; }));
    armTick();
  }

  /** Writes what changed since the last pass: segments, sentences and their corrections, notices. */
  function sync(r: Rec, legs: readonly Leg[], last = false): void {
    if (r.givenUp) return;
    const now = clock.now();
    const cutSide = r.facts.originalText ? 'source' : 'translation';
    const speakerInput = r.facts.legs.speaker;
    const participantInput = r.facts.legs.participant;
    const sameInput = !!speakerInput && !!participantInput && speakerInput.input === participantInput.input
      && speakerInput.inputId === participantInput.inputId;
    const sideCertain = !r.facts.shared && !sameInput;
    const sentences: HistorySentenceInput[] = [];
    const revisions: Array<{ n: number; text: string }> = [];
    const present = new Set<string>();
    for (const leg of legs) {
      const toWrite: HistorySegment[] = [];
      const composition = r.facts.legs[leg.leg];
      for (const seg of leg.segments) {
        present.add(seg.id);
        let t = r.segments.get(seg.id);
        if (!t) {
          t = { seen: null, numbers: [], writtenAt: Number.NEGATIVE_INFINITY, writtenFinal: false, dirty: true };
          r.segments.set(seg.id, t);
        }
        const changed = t.seen !== seg;
        if (changed) { t.dirty = true; t.seen = seg; }
        // Final segments go at once; open ones at most once a second each.
        if (t.dirty && (seg.final || last || now - t.writtenAt >= SEGMENT_WRITE_MS)) {
          toWrite.push(withoutSpeech(seg));
          t.dirty = false;
          t.writtenAt = now;
          t.writtenFinal = seg.final;
        }
        // The cut: on every change, and for an open segment on every pass (its cuts wait on time).
        if (seg.side !== cutSide || (!changed && seg.final)) continue;
        t.cut ??= createSegmentCut();
        const result = t.cut.update({ text: seg.text, final: seg.final, openedAt: seg.openedAt, marks: seg.marks, heard: seg.heard, now });
        for (const s of result.added) {
          const n = r.nextNumber++;
          t.numbers[s.index] = n;
          const startMs = Math.max(0, Math.round(s.startAt - r.startedAt));
          sentences.push({
            n, segmentId: seg.id, side: leg.leg === 'speaker' ? 'mine' : 'other', sideCertain,
            track: composition?.input === 'microphone' ? 'microphone' : 'other',
            speaker: seg.person ?? '1', startMs, endMs: Math.max(startMs, Math.round(s.endAt - r.startedAt)), text: s.text,
            language: seg.language ?? (cutSide === 'source' ? leg.languages.source : leg.languages.target), timeKind: s.timeKind,
          });
        }
        for (const v of result.revised) {
          const n = t.numbers[v.index];
          if (n !== undefined) revisions.push({ n, text: v.text });
        }
      }
      if (toWrite.length > 0) send(r, () => port.putSegments({ recordId: r.id, leg: leg.leg, segments: toWrite }));
      const notices = leg.notices.filter((n) => n.lifetime !== 'transient' && !r.noticesWritten.has(n.id));
      if (notices.length > 0) {
        for (const n of notices) r.noticesWritten.add(n.id);
        send(r, () => port.putNotices({ recordId: r.id, leg: leg.leg, notices }));
      }
    }
    // A segment gone from the snapshot is forgotten, not deleted.
    for (const id of r.segments.keys()) if (!present.has(id)) r.segments.delete(id);
    if (sentences.length > 0) {
      send(r, () => (r.transcriptId === null ? Promise.reject(new Error('No transcript')) : port.appendSentences({ transcriptId: r.transcriptId, sentences })));
    }
    if (revisions.length > 0) {
      send(r, () => (r.transcriptId === null ? Promise.reject(new Error('No transcript')) : port.reviseSentences({ transcriptId: r.transcriptId, revisions })));
    }
  }

  function closeCurrent(): void {
    const r = rec;
    if (!r) return;
    // One last pass: the run has finished its late corrections by now.
    sync(r, conversation.snapshot(), true);
    send(r, () => port.closeRecord({ id: r.id, endedAt: clock.now() }));
    rec = null;
    cancelTick?.();
    cancelTick = null;
  }

  function look(): void {
    if (disposed) return;
    const phase = state.getState().phase;
    if (phase === 'idle') { closeCurrent(); return; }
    const legs = conversation.snapshot();
    const session = legs[0]?.session;
    if (OPEN_PHASES.has(phase) && session && session !== rec?.id && !known.has(session)) {
      closeCurrent();
      open(session, legs);
    }
    if (rec && rec.id === session) sync(rec, legs);
  }

  const offState = state.subscribe(look);
  const offConversation = conversation.subscribe(look);
  // Clear empties the screen, not the record: tracking starts afresh, nothing is written for it.
  const offReset = conversation.onReset((reason) => { if (reason === 'clear' && rec) rec.segments.clear(); });
  look();

  return {
    settled: () => chain,
    dispose() {
      disposed = true;
      offState();
      offConversation();
      offReset();
      cancelTick?.();
      cancelTick = null;
    },
  };
}
