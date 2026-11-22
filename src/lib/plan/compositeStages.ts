// src/lib/plan/compositeStages.ts
//
// One leg of a plan whose transcription and translation are separate units:
// a unit that transcribes, a unit that translates what it heard, and a unit
// that reads the translations. This is the wiring between the first two, the
// one numbering of the leg's rows over both, the order the three open and
// close in, and what the failure of one does to the leg (spec §4.4, §7.4,
// §7.5). The voice is wired as in a plan of a text unit and a speech unit
// (`compositeLeg.ts`): to it, the two units here are one text unit.
import { AdapterStartError, LegStartError } from '../contract/adapter';
import type { AdapterEvents, AdapterSession, Ref } from '../contract/adapter';
import type { TranslationEvents, TranslationSession } from '../contract/translation';
import type { LegName } from '../conversation/types';
import { CompositeLeg, type PlanRequest } from './compositeLeg';
import type { PlannedUnit, RunPlan } from './types';

/** The units of a plan whose transcription and translation are apart. `translation` and `speech` may be one unit. */
export interface SeparateStages { transcription: PlannedUnit; translation: PlannedUnit; speech: PlannedUnit }

/**
 * The units of a plan this wiring runs: one that transcribes alone, started through the adapter contract; one that
 * translates, started through the translation contract; one that speaks, started through the speech contract.
 * The last two may be one unit that has both starts. Null for any other plan.
 */
export function separateStages(plan: RunPlan): SeparateStages | null {
  const { transcription, translation, speech } = plan.byStage;
  if (translation === transcription || speech === transcription) return null;
  const units = new Set([transcription, translation, speech]);
  if (plan.units.length !== units.size || plan.units.some((unit) => !units.has(unit))) return null;
  if (!transcription.unit.start || transcription.unit.startTranslation || transcription.unit.startSpeech) return null;
  if (!translation.unit.startTranslation || translation.unit.start) return null;
  if (!speech.unit.startSpeech || speech.unit.start) return null;
  return { transcription, translation, speech };
}

/**
 * A source segment of the unit that transcribes, while it is open. `stable`: the last stable length the unit
 * stated. `handed`: the translation has had its last snapshot of it.
 */
interface Source { origin: string; text: string; stable: number; language?: string; handed: boolean }

/** What a translation the leg shows last said, by the leg's ref: said again when its source's speaker is corrected. */
type Said = Map<Ref, { text: string; stableLen: number; language?: string }>;

/**
 * The origins the leg states for sources whose unit states none: `composite-<ref>`. A unit may state any string, so
 * an origin of its own that begins like one of these is told apart (`composite-=<its origin>`): no origin a unit
 * states can then be one the leg stated, whatever either is. Every other origin stays as its unit stated it.
 */
const STATED = 'composite-';
const unitOrigin = (origin: string): string => (origin.startsWith(STATED) ? `${STATED}=${origin}` : origin);

/** A controller that aborts when `signal` does, with its reason, and may be aborted apart from it. */
function following(signal: AbortSignal): AbortController {
  const own = new AbortController();
  if (signal.aborted) own.abort(signal.reason);
  else signal.addEventListener('abort', () => own.abort(signal.reason), { once: true });
  return own;
}

/** Runs a stop, or another call a unit may throw from or reject, when its outcome is nobody's to hear. */
function quietly(run: () => Promise<void> | void): void {
  try {
    void Promise.resolve(run()).catch(() => {});
  } catch {
    // Thrown before its first await: the same nobody.
  }
}

/**
 * The leg. The unit that transcribes emits source segments; each snapshot of one goes to the translation session
 * (`source()`), and the translations that come back are the leg's translation segments, under the source's
 * origin. Both units count their own segments: the leg gives every segment a ref of its own counter, and that is
 * the ref every event above carries, and the one the voice reads and answers by.
 */
class StagedLeg {
  /** The voice's half, and what both text-emitting units pass through: one text unit, to it. */
  private readonly inner: CompositeLeg;
  private translation: TranslationSession | null = null;
  private transcription: AdapterSession | null = null;
  /** `stopping`: the caller's stop runs, and a unit may still say a frame of its ending. `over`: nothing passes on. */
  private state: 'live' | 'stopping' | 'over' = 'live';
  /** The leg has opened: before that, a translation that fails is the start's failure, not a leg's. */
  private isOpen = false;
  /**
   * What the units that translate and transcribe are started with as their signal. It aborts when the run's does,
   * and the leg aborts it when its start fails while a unit is still opening: with the error the start then
   * rejects with. It is not aborted for any other reason, so a unit that reads it after the leg has opened reads
   * the run's.
   */
  private readonly starting: AbortController;

  /** The leg's one counter of segments. */
  private nextRef = 1;
  /**
   * The leg's ref for each ref of the unit that transcribes, kept for the session: a unit may revise a row it
   * closed. And for each ref of the unit that translates, until it closes: nothing follows a translation's close.
   */
  private readonly heardRefs = new Map<Ref, Ref>();
  private readonly translatedRefs = new Map<Ref, Ref>();
  /** The origin of each translation, by the leg's ref: its close names it, as a text unit's does. */
  private readonly origins = new Map<Ref, string>();
  /** The source segments still open, by the ref their unit gave them. */
  private readonly open = new Map<Ref, Source>();
  /** Who spoke a source, by its origin, where the unit says: its translations say the same. */
  private readonly persons = new Map<string, string>();
  /** The translations of each source that is still open, by its origin: while it is open its speaker may be corrected. */
  private readonly said = new Map<string, Said>();
  /** Segments the unit that transcribes opened as translations, against the contract: dropped with all that follows. */
  private readonly dropped = new Set<Ref>();
  private saidUnexpected = false;

  constructor(
    private readonly units: SeparateStages,
    private readonly request: PlanRequest,
    private readonly events: AdapterEvents,
    private readonly name: LegName,
  ) {
    this.inner = new CompositeLeg(name, units.transcription, units.speech, request, events);
    this.starting = following(request.signal);
  }

  /**
   * Opens the leg (spec §7.4): the voice is started and opened, not awaited; then the translation, awaited; then
   * the transcription. A unit that cannot start rejects the start with its own error, and what had started is
   * stopped.
   *
   * The start is given up as soon as its signal aborts (the run was cancelled, or the translation said `failed`
   * while the leg was starting), whatever a unit is still opening: the start rejects with the signal's reason, no
   * unit is started after it, and a transcription that opens afterwards all the same is stopped.
   */
  async start(): Promise<AdapterSession> {
    const { units, request, inner } = this;
    const { signal } = this.starting;
    inner.openVoice(new Map());
    let session: AdapterSession;
    try {
      this.throwIfGivenUp();
      this.translation = units.translation.unit.startTranslation!({
        leg: this.name,
        context: { ...request.context, speech: false },
        config: request.config.get(units.translation),
        credentials: request.credentials(units.translation),
        clock: request.clock,
        signal,
      }, this.translationEvents());
      await this.unlessGivenUp(this.translation.open());
      this.throwIfGivenUp();
      session = await this.unlessGivenUp(
        units.transcription.unit.start!({ ...inner.textRequest(), signal }, this.transcriptionEvents()),
        (late) => quietly(() => late.stop()),
      );
      this.transcription = session;
      this.throwIfGivenUp();
    } catch (error) {
      this.abandon();
      throw error;
    }
    this.isOpen = true;
    inner.opened();
    return inner.session(session, () => this.stop(session));
  }

  /** Why the start was given up: what its signal was aborted with. */
  private givenUp(): unknown {
    return this.starting.signal.reason ?? new Error('aborted');
  }

  private throwIfGivenUp(): void {
    if (this.starting.signal.aborted) throw this.givenUp();
  }

  /**
   * What a unit is opening, or the start's being given up, whichever comes first. `late`: what is done with what
   * the unit opened after the start was given up; what it rejects with then is nobody's.
   */
  private unlessGivenUp<T>(opening: Promise<T>, late?: (opened: T) => void): Promise<T> {
    const { signal } = this.starting;
    return new Promise<T>((resolve, reject) => {
      let waiting = true;
      const giveUp = () => {
        waiting = false;
        reject(this.givenUp());
      };
      if (signal.aborted) giveUp();
      else signal.addEventListener('abort', giveUp, { once: true });
      opening.then((opened) => {
        if (!waiting) return late?.(opened);
        signal.removeEventListener('abort', giveUp);
        resolve(opened);
      }, (error: unknown) => {
        signal.removeEventListener('abort', giveUp);
        if (waiting) reject(error);
      });
    });
  }

  /** A start that failed: whatever started is stopped, in the order of a stop, and nothing is said of it. */
  private abandon(): void {
    this.state = 'over';
    this.inner.cut();
    const { transcription, translation } = this;
    if (transcription) quietly(() => transcription.stop());
    if (translation) quietly(() => translation.stop());
    // A voice that throws as it closes is not the start's failure: the error that ended the start is.
    quietly(() => this.inner.closeVoice(false));
  }

  /**
   * The caller's stop (spec §7.4): transcription first, then translation, then the voice, all before the first
   * await. Whatever one of the three throws or rejects with, the other two are still asked and heard.
   */
  private async stop(session: AdapterSession): Promise<void> {
    if (this.state === 'live') this.state = 'stopping';
    this.inner.cut();
    const call = async (run: () => Promise<void> | void): Promise<void> => run();
    const settled = await Promise.allSettled([
      call(() => session.stop()),
      call(() => this.translation!.stop()),
      call(() => this.inner.closeVoice(true)),
    ]);
    this.state = 'over';
    // The transcription's rejection first: it is the one a leg of two units hands on.
    for (const outcome of settled) if (outcome.status === 'rejected') throw outcome.reason;
  }

  /** The leg's ref for a unit's ref: the one it has, or the next of the leg's counter. */
  private refFor(refs: Map<Ref, Ref>, ref: Ref): Ref {
    let mine = refs.get(ref);
    if (mine === undefined) {
      mine = this.nextRef++;
      refs.set(ref, mine);
    }
    return mine;
  }

  /**
   * Who spoke a source, as its unit now says. A correction reaches the translations the source already has: each
   * is said again as it last was, with who spoke it (a defined `person` replaces a segment's), and those that
   * open later state it. Only while the source is open: once it has closed, the leg hears nothing more of it.
   */
  private speaker(origin: string, person: string): void {
    if (this.persons.get(origin) === person) return;
    this.persons.set(origin, person);
    for (const [ref, now] of this.said.get(origin) ?? []) this.inner.textEvents.segmentText({ ref, ...now, person });
  }

  /** The translation's last snapshot of a source: all of it stable. */
  private hand(source: Source): void {
    if (source.handed || this.state !== 'live') return;
    source.handed = true;
    this.translation!.source({ origin: source.origin, text: source.text, stableLen: source.text.length, closed: true, ...(source.language === undefined ? {} : { language: source.language }) });
  }

  /**
   * The unit that transcribes emitted a translation: it was asked for none, and a second translation of a row
   * would be shown and read beside the translation unit's. A programming error: thrown where a developer runs it,
   * and elsewhere dropped and said once in the Logs.
   */
  private unexpectedTranslation(event: 'segmentOpened' | 'lateSpeech'): void {
    if (import.meta.env.DEV) throw new Error(`The unit that transcribes emitted a translation (${event}) in a plan whose translation is another unit's.`);
    if (this.saidUnexpected) return;
    this.saidUnexpected = true;
    this.events.frame({ direction: 'in', type: 'composite.unexpected_translation', payload: { event }, runStage: 'transcription' });
  }

  /** What the unit that transcribes emits through. */
  private transcriptionEvents(): AdapterEvents {
    const { inner } = this;
    const out = inner.textEvents;
    const live = () => this.state === 'live';
    /** The unit's own ending: the translation goes first, unheard, so nothing follows the ending. */
    const ending = () => {
      this.state = 'over';
      const { translation } = this;
      if (translation) quietly(() => translation.stop());
    };
    return {
      segmentOpened: (e) => {
        if (!live()) return;
        if (e.side === 'translation') {
          this.dropped.add(e.ref);
          this.unexpectedTranslation('segmentOpened');
          return;
        }
        const ref = this.refFor(this.heardRefs, e.ref);
        // A source whose unit names no origin gets one here: its translations have to name it.
        const origin = e.origin === undefined ? `${STATED}${ref}` : unitOrigin(e.origin);
        this.open.set(e.ref, { origin, text: '', stable: 0, handed: false });
        this.said.set(origin, new Map());
        if (e.person !== undefined) this.persons.set(origin, e.person);
        out.segmentOpened({ ...e, ref, origin });
      },
      segmentText: (e) => {
        if (!live() || this.dropped.has(e.ref)) return;
        out.segmentText({ ...e, ref: this.refFor(this.heardRefs, e.ref) });
        // A text for a segment that is not open (a closed row revised) is the row's alone.
        const source = this.open.get(e.ref);
        if (!source) return;
        source.text = e.text;
        if (e.language !== undefined) source.language = e.language;
        if (e.person !== undefined) this.speaker(source.origin, e.person);
        // Stable is what the unit said will not change (`heard.stableLen`), held to the text it has now. A unit
        // that never says leaves nothing stable until the close.
        if (e.heard) source.stable = e.heard.stableLen;
        if (source.handed || this.state !== 'live') return;
        const stableLen = Math.max(0, Math.min(source.stable, source.text.length));
        this.translation!.source({ origin: source.origin, text: source.text, stableLen, closed: false, ...(source.language === undefined ? {} : { language: source.language }) });
      },
      segmentClosed: (e) => {
        if (!live() || this.dropped.has(e.ref)) return;
        const source = this.open.get(e.ref);
        this.open.delete(e.ref);
        // A closed source's speaker is corrected no more: what its translations said need not be kept.
        if (source) this.said.delete(source.origin);
        const origin = source?.origin ?? (e.origin === undefined ? undefined : unitOrigin(e.origin));
        // The row first: a translation that answers at once finds its source closed on the leg.
        out.segmentClosed({ ...e, ref: this.refFor(this.heardRefs, e.ref), ...(origin === undefined ? {} : { origin }) });
        if (source) this.hand(source);
      },
      lateSpeech: () => { if (live()) this.unexpectedTranslation('lateSpeech'); },
      audio: (e) => { if (live()) out.audio(e); },
      speechRanges: (e) => { if (live()) out.speechRanges(e); },
      closed: (e) => {
        if (!live()) return;
        ending();
        out.closed(e);
      },
      failed: (e) => {
        if (!live()) return;
        ending();
        out.failed({ ...e, runStage: 'transcription' });
      },
      // The connection that was hearing them is gone: what is open has been heard as far as it will be, so the
      // translation gets it now, closed. The rows stay their unit's, to close as it sees fit.
      reconnecting: (e) => {
        if (!live()) return;
        for (const source of this.open.values()) this.hand(source);
        // A translation that failed on what it was just handed has ended the leg: nothing follows its `failed`.
        if (live()) out.reconnecting(e);
      },
      reconnected: (e) => { if (live()) out.reconnected(e); },
      degraded: (e) => { if (live()) out.degraded({ ...e, runStage: 'transcription' }); },
      loading: (e) => { if (live()) out.loading({ ...e, runStage: 'transcription' }); },
      busy: (e) => { if (live()) out.busy(e); },
      // A frame of its own ending still passes while the stop runs.
      frame: (e) => { if (this.state !== 'over') out.frame({ ...e, runStage: 'transcription' }); },
    };
  }

  /** What the unit that translates emits through: its segments become the leg's translation segments. */
  private translationEvents(): TranslationEvents {
    const out = this.inner.textEvents;
    const live = () => this.state === 'live';
    return {
      translationOpened: ({ ref, origin }) => {
        if (!live()) return;
        const mine = this.refFor(this.translatedRefs, ref);
        this.origins.set(mine, origin);
        const person = this.persons.get(origin);
        out.segmentOpened({ ref: mine, side: 'translation', origin, ...(person === undefined ? {} : { person }) });
      },
      // Text and a close are of a translation that is open: what a unit says of a ref it never opened, or has
      // closed, is nobody's row.
      translationText: ({ ref, text, stableLen, language }) => {
        const mine = this.translatedRefs.get(ref);
        if (!live() || mine === undefined) return;
        const origin = this.origins.get(mine);
        const person = origin === undefined ? undefined : this.persons.get(origin);
        const now = { text, stableLen, ...(language === undefined ? {} : { language }) };
        if (origin !== undefined) this.said.get(origin)?.set(mine, now);
        out.segmentText({ ref: mine, ...now, ...(person === undefined ? {} : { person }) });
      },
      translationClosed: ({ ref }) => {
        const mine = this.translatedRefs.get(ref);
        if (!live() || mine === undefined) return;
        this.translatedRefs.delete(ref);
        const origin = this.origins.get(mine);
        this.origins.delete(mine);
        out.segmentClosed({ ref: mine, ...(origin === undefined ? {} : { origin }) });
      },
      // Nothing useful remains of a leg that cannot translate (spec §7.5): it fails, naming the stage.
      failed: (e) => {
        if (!live()) return;
        if (!this.isOpen) {
          // The start is given up with it, and whatever is still opening is cancelled, not waited for.
          const error = e.code !== undefined ? new AdapterStartError(e.message, e.code, undefined, { cause: e.cause }) : e.cause instanceof Error ? e.cause : new Error(e.message);
          this.starting.abort(error);
          return;
        }
        this.state = 'over';
        const { transcription, translation } = this;
        if (transcription) quietly(() => transcription.stop());
        if (translation) quietly(() => translation.stop());
        // Ends the voice's half too: the feed is forgotten and the voice closed, unheard.
        out.failed({ ...e, runStage: 'translation' });
      },
      degraded: (e) => { if (live()) out.degraded({ ...e, runStage: 'translation' }); },
      loading: (e) => { if (live()) out.loading({ ...e, runStage: 'translation' }); },
      frame: (e) => { if (this.state !== 'over') out.frame({ ...e, runStage: 'translation' }); },
    };
  }
}

/** One leg over a unit that transcribes, a unit that translates and a unit that speaks. */
export function startStagedLeg(units: SeparateStages, request: PlanRequest, events: AdapterEvents, name: LegName): Promise<AdapterSession> {
  return new StagedLeg(units, request, events, name).start();
}

const LEGS: readonly LegName[] = ['speaker', 'participant'];

/**
 * Both legs of such a plan, each on its own: its own transcription session, its own translation session in its
 * own direction, its own voice. The provider that transcribes is not asked to start both at once: a connection
 * that carries both legs has one direction too many for a translation session, which has one.
 * A leg that cannot start rejects with a `LegStartError` naming it, once the other has been stopped: the first leg
 * to fail cancels the other's start, so a leg still opening is given up, not waited for.
 */
export async function startStagedBoth(
  units: SeparateStages,
  requests: Record<LegName, PlanRequest>,
  events: Record<LegName, AdapterEvents>,
): Promise<Record<LegName, AdapterSession>> {
  // Each leg's signal: the run's, and the other leg's failure to start.
  const cancels = LEGS.map((name) => following(requests[name].signal));
  const failures: Array<{ leg: LegName; cause: unknown }> = [];
  const started = await Promise.allSettled(LEGS.map((name, at) => startStagedLeg(units, { ...requests[name], signal: cancels[at].signal }, events[name], name).catch((cause: unknown) => {
    failures.push({ leg: name, cause });
    for (const cancel of cancels) cancel.abort();
    throw cause;
  })));
  if (failures.length > 0) {
    for (const outcome of started) if (outcome.status === 'fulfilled') quietly(() => outcome.value.stop());
    // The leg that failed first: the other's rejection is its cancelling.
    throw new LegStartError(failures[0].leg, failures[0].cause);
  }
  const [speaker, participant] = started.map((outcome) => (outcome as PromiseFulfilledResult<AdapterSession>).value);
  return { speaker, participant };
}
