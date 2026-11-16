// src/lib/history/capture/writer.ts
//
// The observer that writes a running session into its History record. It watches the runner's state and its
// conversation set, never changes either, and sends ordered writes through the `HistoryPort`: the record is opened
// when the run shows its legs, the conversation is stored as it changes, the original text is cut into numbered
// sentences, later corrections are followed, and the record is closed when the run is over. History never disturbs
// a session: every failed write is caught. A write counts once it is answered: what failed is written again at the
// next pass. After three failures in a row a record is given up; that, and anything still unwritten when the record
// closes, is reported and told to the user once.
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
/** A record whose writes failed this many times in a row is given up. */
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
  /**
   * The record's recording: prepared when the record is opened (the session's audio is its own from then on, the
   * previous record's still closing), begun once the record exists, let go when it could not be opened, ended before
   * it is closed.
   */
  recorder?: {
    prepare(recordId: string, startedAt: number): void;
    begin(recordId: string, startedAt: number): void;
    drop(recordId: string): void;
    end(recordId: string): Promise<void>;
  };
  /** Tells the user, once per record, that some of its transcript could not be saved. */
  tell?: (recordId: string) => void;
  /** A record the store kept has closed (its notes may be written now). */
  onClosed?(recordId: string): void;
  /** The store did not keep a record (nothing in it was saved): it is not in History. */
  onNotKept?(recordId: string): void;
  /** A record could not be closed: it stays in History, open until the next launch closes it. */
  onCloseFailed?(recordId: string): void;
  /** A record's writes were given up, so it was not closed: whether History keeps it is not known now. */
  onCloseSkipped?(recordId: string): void;
  /**
   * A record's run has ended: called once, right after its last sentences were handed on and before the record is
   * closed, whether or not the store keeps it (the live notes end with the run, not with the record's writes).
   */
  onEnded?(recordId: string): void;
  /**
   * Sentences as they are numbered, each once, for the live notes; a later revision is never handed on (spec §5.2).
   * `fromOpen`: cut from text the recognizer had not made final (an open segment that states no final part).
   */
  onSentences?(recordId: string, sentences: Array<HistorySentenceInput & { fromOpen: boolean }>): void;
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
  /** What was last written, and what the cutter last saw: a new segment object that changes neither (a speech chunk) is skipped. */
  writtenKey: string;
  pendingKey: string;
  cutKey: string;
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
  /**
   * Writes that failed, kept with what they wrote until a write of the same segment or notice succeeds: Clear may take
   * them off the screen before they go again, and they must not wait on the screen.
   */
  failedSegments: Map<string, { leg: LegName; segment: HistorySegment }>;
  failedNotices: Map<string, { leg: LegName; notice: Leg['notices'][number] }>;
  /** Sentences whose append failed, to go again with the next ones. */
  unsent: HistorySentenceInput[];
  /** Corrections whose write failed, by sentence number. */
  unrevised: Map<number, string>;
  /** The text each corrected sentence was last given: a failed correction goes again only while it is the last. */
  revisedTo: Map<number, string>;
  /** Failures in a row, by kind of write: a kind that keeps failing gives the record up even while others succeed. */
  failures: Map<WriteKind, number>;
  /** A kind of write that failed waits until then: one try a pass, whatever the conversation does meanwhile. */
  holdUntil: Map<WriteKind, number>;
  givenUp: boolean;
  told: boolean;
}

const OPEN_PHASES = new Set<RunState['phase']>(['starting', 'running']);

type WriteKind = 'record' | 'segments' | 'notices' | 'sentences' | 'corrections';
/** The kinds whose failed writes are kept and made again; the record's own calls are not. */
type RetriedKind = Exclude<WriteKind, 'record'>;

const withoutSpeech = ({ speech: _speech, heard: _heard, ...rest }: Segment): HistorySegment => rest;

/** The record's "my language": what my side speaks, else what the other side is translated into. */
export function myLanguageOf(legs: readonly Leg[]): string {
  const speaker = legs.find((l) => l.leg === 'speaker');
  const participant = legs.find((l) => l.leg === 'participant');
  return speaker ? speaker.languages.source : participant?.languages.target ?? '';
}

export function createHistoryWriter(deps: HistoryWriterDeps): HistoryWriter {
  const { state, conversation, port, clock } = deps;
  const report = deps.report ?? (() => {});
  let rec: Rec | null = null;
  /** Records already opened in this page: a later notification about them never opens them again. */
  const known = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  let cancelTick: (() => void) | null = null;
  let disposed = false;
  let failedOnce = false;

  /** A failure of the writer itself: reported once, and never passed on to the run. */
  function guard(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      if (failedOnce) return;
      failedOnce = true;
      report('History could not follow the session', error);
    }
  }

  function tellOnce(r: Rec): void {
    if (r.told) return;
    r.told = true;
    try { deps.tell?.(r.id); } catch { /* telling never reaches the run */ }
  }

  /**
   * Queues one call for `r`; calls run one at a time, in the order produced. `failed` puts back what the call carried,
   * so the next pass writes it again.
   */
  function held(r: Rec, kind: RetriedKind): boolean {
    return (r.holdUntil.get(kind) ?? Number.NEGATIVE_INFINITY) > clock.now();
  }

  function send(r: Rec, kind: WriteKind, call: () => Promise<unknown> | null, failed?: () => void): void {
    chain = chain.then(async () => {
      if (r.givenUp) return;
      // Queued before its kind failed: it waits with what failed, uncounted.
      if (kind !== 'record' && held(r, kind)) {
        try { failed?.(); } catch { /* the next pass starts from what is known */ }
        return;
      }
      try {
        const pending = call();
        if (pending) await pending;
        r.failures.set(kind, 0);
      } catch (error) {
        try { failed?.(); } catch { /* the next pass starts from what is known */ }
        if (kind !== 'record') r.holdUntil.set(kind, clock.now() + TICK_MS);
        const failures = (r.failures.get(kind) ?? 0) + 1;
        r.failures.set(kind, failures);
        if (failures >= FAILURES_TO_GIVE_UP) {
          r.givenUp = true;
          report(`History stopped writing record ${r.id} after ${failures} failed writes in a row`, error);
          tellOnce(r);
        }
      }
    });
  }

  function armTick(): void {
    cancelTick?.();
    cancelTick = clock.setTimeout(() => {
      cancelTick = null;
      if (!rec || disposed) return;
      guard(() => { if (rec) sync(rec, conversation.snapshot()); });
      if (rec) armTick();
    }, TICK_MS);
  }

  function open(session: string, legs: readonly Leg[]): void {
    const facts = deps.facts();
    const info = conversation.info;
    const speaker = legs.find((l) => l.leg === 'speaker');
    const participant = legs.find((l) => l.leg === 'participant');
    const myLanguage = myLanguageOf(legs);
    const targetLanguage = speaker ? speaker.languages.target : participant?.languages.source ?? '';
    const models = Object.fromEntries(Object.entries(info?.models ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'));
    const r: Rec = {
      id: session, startedAt: clock.now(), facts, transcriptId: null, nextNumber: 1,
      segments: new Map(), noticesWritten: new Set(), failedSegments: new Map(), failedNotices: new Map(), unsent: [], unrevised: new Map(), revisedTo: new Map(),
      failures: new Map(), holdUntil: new Map(), givenUp: false, told: false,
    };
    rec = r;
    known.add(session);
    // The recording's pieces need the record to exist: the audio from now on is held for it, written once the record
    // is open, and let go when the record could not be opened (every piece would be refused).
    deps.recorder?.prepare(session, r.startedAt);
    send(r, 'record', () => port.openRecord({
      id: session, startedAt: r.startedAt, mode: facts.mode, myLanguage, targetLanguage,
      services: { provider: info?.provider ?? '', models }, appVersion: facts.appVersion,
    }).then(() => { deps.recorder?.begin(session, r.startedAt); }), () => { deps.recorder?.drop(session); });
    for (const leg of legs) {
      const c = facts.legs[leg.leg];
      send(r, 'record', () => port.putLeg({
        recordId: session, leg: leg.leg, languages: leg.languages,
        input: c?.input ?? null, inputName: c?.inputName ?? null, inputId: c?.inputId ?? null, translated: true, spoken: c?.spoken ?? false,
      }));
    }
    send(r, 'record', () => port.createTranscript({
      recordId: session, origin: { service: info?.provider ?? '', kind: 'live' }, textKind: facts.originalText ? 'original' : 'translation',
    }).then((id) => { r.transcriptId = id; }));
    armTick();
  }

  /** Writes what changed since the last pass: segments, sentences and their corrections, notices. */
  /**
   * Segments of one leg written; a failure keeps what they wrote, a success forgets an earlier failure of them. A
   * `retained` write (a failed write going again from what it wrote) is checked when it runs: a newer write of the same
   * segment that went before it has replaced it, and it is dropped rather than written over the newer text.
   */
  function writeSegments(r: Rec, leg: LegName, segments: HistorySegment[], retained = false): void {
    let sent = segments;
    send(r, 'segments', () => {
      sent = retained ? segments.filter((g) => r.failedSegments.get(g.id)?.segment === g) : segments;
      if (sent.length === 0) return null;
      return port.putSegments({ recordId: r.id, leg, segments: sent }).then(() => {
        // Writes go one at a time, in order: a success is the latest of each segment it carries.
        for (const g of sent) r.failedSegments.delete(g.id);
      });
    }, () => {
      for (const g of sent) {
        // A retry held before it ran still carries everything: a newer write of the segment, gone or failed, stands.
        if (retained && r.failedSegments.get(g.id)?.segment !== g) continue;
        r.failedSegments.set(g.id, { leg, segment: g });
        const t = r.segments.get(g.id);
        if (t) t.dirty = true;
      }
    });
  }

  /** Notices of one leg written, as segments are. */
  function writeNotices(r: Rec, leg: LegName, notices: Array<Leg['notices'][number]>): void {
    for (const n of notices) r.noticesWritten.add(n.id);
    send(r, 'notices', async () => {
      await port.putNotices({ recordId: r.id, leg, notices });
      for (const n of notices) r.failedNotices.delete(n.id);
    }, () => {
      for (const n of notices) {
        r.noticesWritten.delete(n.id);
        r.failedNotices.set(n.id, { leg, notice: n });
      }
    });
  }

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
    const handed: Array<HistorySentenceInput & { fromOpen: boolean }> = [];
    const revisions: Array<{ n: number; text: string }> = [];
    const present = new Set<string>();
    /** Segments the screen shows with text, and notices it shows: a failed write of anything else goes from what it wrote. */
    const shown = new Set<string>();
    for (const leg of legs) {
      const toWrite: HistorySegment[] = [];
      const composition = r.facts.legs[leg.leg];
      for (const seg of leg.segments) {
        present.add(seg.id);
        let t = r.segments.get(seg.id);
        if (!t) {
          t = { seen: null, numbers: [], writtenAt: Number.NEGATIVE_INFINITY, writtenKey: '', pendingKey: '', cutKey: '', dirty: false };
          r.segments.set(seg.id, t);
        }
        let cutChanged = false;
        if (t.seen !== seg) {
          t.seen = seg;
          const kept = withoutSpeech(seg);
          const key = JSON.stringify(kept);
          if (key !== t.writtenKey) { t.dirty = true; t.pendingKey = key; }
          const cutKey = JSON.stringify([key, seg.heard ?? null]);
          cutChanged = cutKey !== t.cutKey;
          t.cutKey = cutKey;
        }
        // Empty text (a segment just opened, or one Clear emptied while it was still open) is neither written nor cut:
        // the record keeps what it had, and the cuts already made stand when the text comes back.
        if (seg.text === '') continue;
        shown.add(seg.id);
        // Final segments go at once; open ones at most once a second each.
        if (t.dirty && !held(r, 'segments') && (seg.final || last || now - t.writtenAt >= SEGMENT_WRITE_MS)) {
          toWrite.push(withoutSpeech(seg));
          t.dirty = false;
          t.writtenAt = now;
          t.writtenKey = t.pendingKey;
        }
        // The cut: on every change, and for an open segment on every pass (its cuts wait on time).
        if (seg.side !== cutSide || (!cutChanged && seg.final)) continue;
        t.cut ??= createSegmentCut();
        const result = t.cut.update({ text: seg.text, final: seg.final, openedAt: seg.openedAt, marks: seg.marks, heard: seg.heard, now });
        for (const s of result.added) {
          const n = r.nextNumber++;
          t.numbers[s.index] = n;
          const startMs = Math.max(0, Math.round(s.startAt - r.startedAt));
          const sentence: HistorySentenceInput = {
            n, segmentId: seg.id, side: leg.leg === 'speaker' ? 'mine' : 'other', sideCertain,
            track: composition?.input === 'microphone' ? 'microphone' : 'other',
            speaker: seg.person ?? '1', startMs, endMs: Math.max(startMs, Math.round(s.endAt - r.startedAt)), text: s.text,
            language: seg.language ?? (cutSide === 'source' ? leg.languages.source : leg.languages.target), timeKind: s.timeKind,
          };
          sentences.push(sentence);
          // Unsettled only when cut before the recognizer said its words were final: with a stated final part
          // (`heard`) the cut never goes past it, so the sentence's text does not change.
          handed.push({ ...sentence, fromOpen: !seg.final && !seg.heard });
        }
        for (const v of result.revised) {
          const n = t.numbers[v.index];
          if (n !== undefined) revisions.push({ n, text: v.text });
        }
      }
      if (toWrite.length > 0) writeSegments(r, leg.leg, toWrite);
      const notices = leg.notices.filter((n) => n.lifetime !== 'transient' && !r.noticesWritten.has(n.id));
      for (const n of leg.notices) shown.add(n.id);
      if (notices.length > 0 && !held(r, 'notices')) writeNotices(r, leg.leg, notices);
    }
    // Failed writes the screen no longer shows (Clear): they go again from what they wrote.
    if (!held(r, 'segments')) {
      for (const name of ['speaker', 'participant'] as const) {
        const orphans = [...r.failedSegments.entries()].filter(([id, f]) => f.leg === name && !shown.has(id)).map(([, f]) => f.segment);
        if (orphans.length > 0) writeSegments(r, name, orphans, true);
      }
    }
    if (!held(r, 'notices')) {
      for (const name of ['speaker', 'participant'] as const) {
        const orphans = [...r.failedNotices.entries()].filter(([id, f]) => f.leg === name && !shown.has(id)).map(([, f]) => f.notice);
        if (orphans.length > 0) writeNotices(r, name, orphans);
      }
    }
    // A segment gone from the snapshot is forgotten, not deleted.
    for (const id of r.segments.keys()) if (!present.has(id)) r.segments.delete(id);
    // The live notes take what they can; whatever they do, the record's sentences are written.
    if (handed.length > 0) {
      try { deps.onSentences?.(r.id, handed); } catch (error) { report('The live notes could not take the new sentences', error); }
    }
    // What failed before goes first; a correction to a sentence still waiting goes into it.
    const batch = [...r.unsent, ...sentences];
    r.unsent = [];
    const corrections = new Map(r.unrevised);
    r.unrevised = new Map();
    for (const v of revisions) {
      corrections.set(v.n, v.text);
      r.revisedTo.set(v.n, v.text);
    }
    const byNumber = new Map(batch.map((x) => [x.n, x]));
    for (const [n, text] of corrections) {
      const waiting = byNumber.get(n);
      if (waiting) { waiting.text = text; corrections.delete(n); }
    }
    if (batch.length > 0 && held(r, 'sentences')) {
      r.unsent = batch;
    } else if (batch.length > 0) {
      send(
        r,
        'sentences',
        () => (r.transcriptId === null ? Promise.reject(new Error('No transcript')) : port.appendSentences({ transcriptId: r.transcriptId, sentences: batch })),
        () => { r.unsent = [...batch, ...r.unsent]; },
      );
    }
    const toRevise = [...corrections].map(([n, text]) => ({ n, text }));
    if (toRevise.length > 0 && held(r, 'corrections')) {
      for (const v of toRevise) r.unrevised.set(v.n, v.text);
    } else if (toRevise.length > 0) {
      send(
        r,
        'corrections',
        () => (r.transcriptId === null ? Promise.reject(new Error('No transcript')) : port.reviseSentences({ transcriptId: r.transcriptId, revisions: toRevise })),
        () => {
          for (const v of toRevise) if (r.revisedTo.get(v.n) === v.text && !r.unrevised.has(v.n)) r.unrevised.set(v.n, v.text);
        },
      );
    }
  }

  /** What the last pass left unwritten: nothing is written for the record after its close. */
  function unwritten(r: Rec, legs: readonly Leg[]): boolean {
    if (r.unsent.length > 0 || r.unrevised.size > 0 || r.failedSegments.size > 0 || r.failedNotices.size > 0) return true;
    for (const leg of legs) {
      for (const seg of leg.segments) if (seg.text !== '' && r.segments.get(seg.id)?.dirty) return true;
      if (leg.notices.some((n) => n.lifetime !== 'transient' && !r.noticesWritten.has(n.id))) return true;
    }
    return false;
  }

  function closeCurrent(): void {
    const r = rec;
    if (!r) return;
    // The session's end: read now, not after the recording's end and the writes queued before the close.
    const endedAt = clock.now();
    // One last pass: the run has finished its late corrections by now.
    const final = conversation.snapshot();
    sync(r, final, true);
    chain = chain.then(() => {
      if (r.givenUp || !unwritten(r, final)) return;
      report(`History closed record ${r.id} with some of its transcript that could not be written`, null);
      tellOnce(r);
    });
    try {
      deps.onEnded?.(r.id);
    } catch (error) {
      report('History could not tell the end of the session', error);
    }
    // The recording's last pages before the record closes; ended even when the record's writes were given up.
    const recorder = deps.recorder;
    if (recorder) chain = chain.then(() => recorder.end(r.id).catch((error) => report('History could not finish the recording', error)));
    // A record that cannot be closed stays open until the next launch closes it: said, not left silent.
    send(r, 'record', async () => {
      let answer: { kept: boolean } | undefined;
      try {
        answer = await port.closeRecord({ id: r.id, endedAt });
      } catch (error) {
        report(`History could not close record ${r.id}; the next launch closes it`, error);
        tellOnce(r);
        deps.onCloseFailed?.(r.id);
        return;
      }
      if (answer?.kept) deps.onClosed?.(r.id);
      else if (answer) deps.onNotKept?.(r.id);
    });
    // Its writes given up, the close above did not run: said all the same, so nothing waits for it.
    chain = chain.then(() => { if (r.givenUp) deps.onCloseSkipped?.(r.id); });
    rec = null;
    cancelTick?.();
    cancelTick = null;
  }

  function look(): void {
    if (disposed) return;
    guard(lookNow);
  }

  function lookNow(): void {
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
  // Clear empties the screen, not the record: what was written stays, and nothing is written for it (a segment Clear
  // emptied while still open is skipped until its text comes back; one Clear removed is forgotten by the next pass).
  look();

  return {
    settled: () => chain,
    dispose() {
      disposed = true;
      offState();
      offConversation();
      cancelTick?.();
      cancelTick = null;
    },
  };
}
