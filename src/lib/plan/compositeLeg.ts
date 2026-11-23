// src/lib/plan/compositeLeg.ts
//
// One leg of a plan in which a text unit transcribes and translates and a
// speech unit reads the translations: the wiring between the two, the order
// they open and close in, and what the failure of one does to the leg (spec
// §7.2, §7.4, §7.5).
import type { AdapterEvents, AdapterSession, Ref, StartRequest, TextRange } from '../contract/adapter';
import type { SpeechEvents, SpeechSession } from '../contract/speech';
import type { LegName } from '../conversation/types';
import { describeCause } from '../diagnostics/describeCause';
import { createSpeechFeed, type SpeechFeed } from './speechFeed';
import type { PlanConfigs, PlannedUnit, RunPlan } from './types';

/** One leg's request over a plan: its configs by unit, and each unit's own credentials. */
export type PlanRequest = StartRequest<PlanConfigs, (unit: PlannedUnit) => unknown>;

/**
 * The two units of a plan this wiring runs: a text unit that serves transcription and translation, started through
 * the adapter contract, and a speech unit that serves speech, started through the speech contract. Null for any
 * other plan.
 */
export function textAndSpeech(plan: RunPlan): { text: PlannedUnit; speech: PlannedUnit } | null {
  const { transcription: text, translation, speech } = plan.byStage;
  if (plan.units.length !== 2 || translation !== text || speech === text) return null;
  if (!plan.units.includes(text) || !plan.units.includes(speech)) return null;
  if (!text.unit.start || text.unit.startSpeech || !speech.unit.startSpeech) return null;
  return { text, speech };
}

/** Which voice reads a stretch of a leg's translation, and where the audio of a row read by another leg's voice returns. */
export interface Voices {
  /** A stable stretch of a translation on `leg`, in `language`: asks the voice that reads it, if any does. */
  speak(leg: CompositeLeg, ref: Ref, text: string, span: TextRange, language: string): void;
  /** A translation on `leg` closed: every voice that read it ends its utterance. */
  end(leg: CompositeLeg, ref: Ref): void;
  /** The leg of that name: the row's leg, for audio its voice did not read. */
  leg(name: LegName): CompositeLeg | undefined;
}

/** A leg on its own speaks into its own target; a translation in another language has nobody to read it. */
const OWN_VOICE: Voices = {
  speak: (leg, ref, text, span, language) => { if (language === leg.target) leg.speak(ref, text, span, language); },
  end: (leg, ref) => leg.endUtterance(ref),
  leg: () => undefined,
};

/**
 * One leg's half of the wiring: the events its text unit emits through, its voice, and the session the caller gets.
 * The text unit is asked for no speech; the leg's voice, when its context speaks, is the speech unit's session.
 */
export class CompositeLeg {
  /** What the text unit emits through: every event passes on to the leg's own events; translations also drive the feed. */
  readonly textEvents: AdapterEvents;
  private voice: SpeechSession | null = null;
  /** `closing`: a stop is closing the voice, which may still say a frame. `closed`: nothing of it passes on. */
  private voiceState: 'none' | 'live' | 'closing' | 'closed' = 'none';
  /** The text unit has opened: until then a start can still fail, and a failed start says nothing of its voice. */
  private isOpen = false;
  /** What the voice said of itself before the leg opened (no key, a unit that could not start): said once it has. */
  private held: Array<Parameters<AdapterEvents['degraded']>[0]> = [];
  /** The leg said `failed` or `closed`, or was stopped: no voice is asked anything more, and no audio reaches its rows. */
  private ended = false;
  private unexpectedAudio = false;
  private readonly feed: SpeechFeed;

  constructor(
    readonly name: LegName,
    private readonly text: PlannedUnit,
    private readonly speech: PlannedUnit,
    private readonly request: PlanRequest,
    private readonly events: AdapterEvents,
    private readonly voices: Voices = OWN_VOICE,
  ) {
    this.feed = createSpeechFeed({
      speak: (ref, stretch, span, language) => voices.speak(this, ref, stretch, span, language),
      end: (ref) => voices.end(this, ref),
    }, () => this.target);
    // The segment goes on first: a voice that answers at once speaks of text the leg already has.
    this.textEvents = {
      segmentOpened: (e) => { events.segmentOpened(e); if (!this.ended) this.feed.opened(e); },
      segmentText: (e) => { events.segmentText(e); if (!this.ended) this.feed.text(e); },
      segmentClosed: (e) => { events.segmentClosed(e); if (!this.ended) this.feed.closed(e); },
      // Text that came after its segment closed: read as any stretch, by the voice that reads the row, and its
      // utterance ended again. It is not passed on: nothing above the contract takes it.
      lateSpeech: (e) => {
        if (this.ended) return;
        voices.speak(this, e.ref, e.text, e.span, e.language);
        voices.end(this, e.ref);
      },
      audio: () => this.unexpected('audio'),
      speechRanges: () => this.unexpected('speechRanges'),
      // The leg is over: its voice goes first, unheard, so nothing follows the ending.
      closed: (e) => { this.end(); events.closed(e); },
      failed: (e) => { this.end(); events.failed(e); },
      reconnecting: (e) => events.reconnecting(e),
      // The blip that dropped the text unit's connection likely left the voice's half-open. What is open in the
      // feed stays: the text unit goes on with its segments, and nothing is spoken twice.
      reconnected: (e) => {
        if (this.voiceState === 'live') this.voice!.recycle?.();
        events.reconnected(e);
      },
      degraded: (e) => events.degraded(e),
      loading: (e) => events.loading(e),
      busy: (e) => events.busy(e),
      frame: (e) => events.frame(e),
    };
  }

  get target(): string {
    return this.request.context.direction.target;
  }

  /** Whether this leg has a voice that can be asked to read. */
  get speaks(): boolean {
    return this.voiceState === 'live';
  }

  /** The text unit's request: its own config and credentials, and a context that does not speak. */
  textRequest(): StartRequest<unknown, unknown> {
    const { request } = this;
    return { ...request, context: { ...request.context, speech: false }, config: request.config.get(this.text), credentials: request.credentials(this.text) };
  }

  /**
   * Starts the leg's voice, when its context speaks, and opens it without waiting: text that comes first waits in
   * the voice. `counts`: the audio entries per row, shared with every voice that may read the same rows.
   * A speech unit that cannot start leaves the leg without a voice. That, and anything a voice says of itself while
   * the text unit is still opening, is said by `opened()`.
   * A leg that has ended starts none: its text unit says nothing more, so the voice would stay open, unasked, until
   * the run stops.
   */
  openVoice(counts: Map<Ref, number>): void {
    const { request } = this;
    if (this.ended || !request.context.speech) return;
    try {
      this.voice = this.speech.unit.startSpeech!({
        leg: this.name,
        context: request.context,
        config: request.config.get(this.speech),
        credentials: request.credentials(this.speech),
        clock: request.clock,
        signal: request.signal,
        counts,
      }, this.voiceEvents());
      this.voiceState = 'live';
      // An open never rejects by the contract; one that does is speech lost, not a failed leg: the voice is
      // closed and asked nothing more.
      this.voice.open().catch((error: unknown) => {
        this.closeVoice(false);
        this.voiceLost(error);
      });
    } catch (error) {
      this.closeVoice(false);
      this.voiceLost(error);
    }
  }

  /** The leg is open: what its voice said of itself meanwhile is said now, in order, so a start that fails says nothing of it. */
  opened(): void {
    this.isOpen = true;
    const held = this.held;
    this.held = [];
    for (const e of held) this.degraded(e);
  }

  /** Asks this leg's voice to read. `home`: the leg whose row it is, when not this one. */
  speak(ref: Ref, text: string, span: TextRange, language: string, home?: LegName): void {
    if (this.voiceState === 'live') this.voice!.speak(ref, text, span, language, home);
  }

  endUtterance(ref: Ref): void {
    if (this.voiceState === 'live') this.voice!.endUtterance(ref);
  }

  /** The caller is stopping the leg: the feed is forgotten, and no voice is asked anything more for its rows. */
  cut(): void {
    this.ended = true;
    this.feed.reset();
  }

  /** Closes the voice, once. `graceful`: a stop, whose own last frames still pass on while it closes. */
  closeVoice(graceful: boolean): void {
    const voice = this.voice;
    if (!voice || this.voiceState === 'closed') return;
    this.voiceState = graceful ? 'closing' : 'closed';
    try {
      voice.close();
    } finally {
      this.voiceState = 'closed';
    }
  }

  /**
   * The session of this leg over its text session. Audio in, typed text, the turns, the network's return, agent
   * text and `info` are the text session's; `setSpeech` switches the voice. `stop`: the text session first, then
   * the voice, both before the first `await`.
   */
  session(text: AdapterSession, stop: () => Promise<void> = () => this.stop(text)): AdapterSession {
    return {
      info: text.info,
      appendAudio: (pcm) => text.appendAudio(pcm),
      appendText: (typed) => text.appendText(typed),
      beginTurn: () => text.beginTurn(),
      endTurn: () => text.endTurn(),
      cancelTurn: () => text.cancelTurn(),
      setSpeech: (on) => { if (this.voiceState === 'live') this.voice!.setOn(on); },
      ...(text.networkRestored ? { networkRestored: () => text.networkRestored!() } : {}),
      ...(text.agentText ? { agentText: (said: string, endOfSegment: boolean) => text.agentText!(said, endOfSegment) } : {}),
      stop,
    };
  }

  /** A row of this leg was read: its audio, by this leg's voice or the one named. */
  rowAudio(e: Parameters<AdapterEvents['audio']>[0]): void {
    if (!this.ended) this.events.audio(e);
  }

  rowRanges(e: Parameters<AdapterEvents['speechRanges']>[0]): void {
    if (!this.ended) this.events.speechRanges(e);
  }

  private stop(text: AdapterSession): Promise<void> {
    this.cut();
    try {
      return text.stop();
    } finally {
      this.closeVoice(true);
    }
  }

  /** The text unit said the leg is over. */
  private end(): void {
    this.cut();
    this.closeVoice(false);
  }

  /** The leg whose row a voice's audio belongs to: this one, or the one the voice names. */
  private row(home: LegName | undefined): CompositeLeg | undefined {
    return home === undefined || home === this.name ? this : this.voices.leg(home);
  }

  /** What the voice says of itself names its stage (`runStage`), so the run files its errors under the unit that speaks. */
  private voiceEvents(): SpeechEvents {
    return {
      audio: ({ pcm, ref, range, home }) => {
        if (this.voiceState !== 'live') return;
        const row = this.row(home);
        row?.rowAudio({ pcm, ref, ...(range ? { range } : {}), ...(row === this ? {} : { voice: this.name }) });
      },
      speechRanges: ({ ref, ranges, home }) => {
        if (this.voiceState === 'live') this.row(home)?.rowRanges({ ref, ranges });
      },
      degraded: (e) => { if (this.voiceState === 'live') this.degraded(e); },
      frame: (e) => { if (this.voiceState === 'live' || this.voiceState === 'closing') this.events.frame({ ...e, runStage: 'speech' }); },
    };
  }

  /** Speech is gone for this leg and its subtitles go on (spec §7.5). */
  private voiceLost(error: unknown): void {
    this.degraded({ code: 'tts_degraded', message: `Translated speech could not start: ${describeCause(error)}`, cause: error });
  }

  /** Speech is degraded: said at once on an open leg, held while the text unit is still opening, dropped once the leg is over. */
  private degraded(e: Parameters<AdapterEvents['degraded']>[0]): void {
    if (this.ended) return;
    if (this.isOpen) this.events.degraded({ ...e, runStage: 'speech' });
    else this.held.push(e);
  }

  /** A text unit asked for no speech emitted some: a programming error, said once in the Logs and dropped. */
  private unexpected(event: 'audio' | 'speechRanges'): void {
    if (this.unexpectedAudio || this.ended) return;
    this.unexpectedAudio = true;
    this.events.frame({ direction: 'in', type: 'composite.unexpected_audio', payload: { event } });
  }
}

/**
 * One leg over a text unit and a speech unit (spec §7.4): the voice is started and opened, not awaited, then the
 * text unit starts. A text unit that fails to start closes the voice and rejects with its own error.
 */
export async function startCompositeLeg(text: PlannedUnit, speech: PlannedUnit, request: PlanRequest, events: AdapterEvents, name: LegName): Promise<AdapterSession> {
  const leg = new CompositeLeg(name, text, speech, request, events);
  leg.openVoice(new Map());
  let session: AdapterSession;
  try {
    session = await text.unit.start!(leg.textRequest(), leg.textEvents);
  } catch (error) {
    leg.cut();
    leg.closeVoice(false);
    throw error;
  }
  leg.opened();
  return leg.session(session);
}
