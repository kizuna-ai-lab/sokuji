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
  /** What the translation said it failed with while the leg was still starting. */
  private failure: Parameters<TranslationEvents['failed']>[0] | null = null;

  /** The leg's one counter of segments. */
  private nextRef = 1;
  /** The leg's ref for each ref of the unit that transcribes, and for each of the unit that translates. */
  private readonly heardRefs = new Map<Ref, Ref>();
  private readonly translatedRefs = new Map<Ref, Ref>();
  /** The origin of each translation, by the leg's ref: its close names it, as a text unit's does. */
  private readonly origins = new Map<Ref, string>();
  /** The source segments still open, by the ref their unit gave them. */
  private readonly open = new Map<Ref, Source>();
  /** Who spoke a source, by its origin, where the unit says: its translations say the same. */
  private readonly persons = new Map<string, string>();
  /** Segments the unit that transcribes opened as translations, against the contract: dropped with all that follows. */
  private readonly dropped = new Set<Ref>();
  private saidUnexpected = false;

  constructor(
    private readonly units: SeparateStages,
    private readonly request: PlanRequest,
    private readonly events: AdapterEvents,
    private readonly name: LegName,
  ) {
    this.inner = new CompositeLeg(name, units.transcription, units.speech, request, events, undefined, true);
  }

  /**
   * Opens the leg (spec §7.4): the voice is started and opened, not awaited; then the translation, awaited; then
   * the transcription. A unit that cannot start rejects the start with its own error, and what had started is
   * stopped.
   */
  async start(): Promise<AdapterSession> {
    const { units, request, inner } = this;
    inner.openVoice(new Map());
    let session: AdapterSession;
    try {
      this.translation = units.translation.unit.startTranslation!({
        leg: this.name,
        context: { ...request.context, speech: false },
        config: request.config.get(units.translation),
        credentials: request.credentials(units.translation),
        clock: request.clock,
        signal: request.signal,
      }, this.translationEvents());
      await this.translation.open();
      this.throwIfFailed();
      session = await units.transcription.unit.start!(inner.textRequest(), this.transcriptionEvents());
      this.transcription = session;
      this.throwIfFailed();
    } catch (error) {
      this.abandon();
      throw error;
    }
    this.isOpen = true;
    inner.opened();
    return inner.session(session, () => this.stop(session));
  }

  /** The translation said `failed` while the leg was starting: the start fails with it. */
  private throwIfFailed(): void {
    const { failure } = this;
    if (!failure) return;
    if (failure.code !== undefined) throw new AdapterStartError(failure.message, failure.code, undefined, { cause: failure.cause });
    throw failure.cause instanceof Error ? failure.cause : new Error(failure.message);
  }

  /** A start that failed: whatever started is stopped, in the order of a stop, and nothing is said of it. */
  private abandon(): void {
    this.state = 'over';
    this.inner.cut();
    const { transcription, translation } = this;
    if (transcription) quietly(() => transcription.stop());
    if (translation) quietly(() => translation.stop());
    this.inner.closeVoice(false);
  }

  /** The caller's stop (spec §7.4): transcription first, then translation, then the voice, all before the first await. */
  private async stop(session: AdapterSession): Promise<void> {
    if (this.state === 'live') this.state = 'stopping';
    this.inner.cut();
    const call = (run: () => Promise<void>): Promise<void> => {
      try {
        return run();
      } catch (error) {
        return Promise.reject(error);
      }
    };
    const stops = [call(() => session.stop()), call(() => this.translation!.stop())];
    this.inner.closeVoice(true);
    const settled = await Promise.allSettled(stops);
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
        const origin = e.origin ?? `composite-${ref}`;
        this.open.set(e.ref, { origin, text: '', stable: 0, handed: false });
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
        if (e.person !== undefined) this.persons.set(source.origin, e.person);
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
        // The row first: a translation that answers at once finds its source closed on the leg.
        out.segmentClosed({ ...e, ref: this.refFor(this.heardRefs, e.ref), ...(source ? { origin: source.origin } : {}) });
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
        out.reconnecting(e);
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
      translationText: ({ ref, text, stableLen, language }) => {
        if (live()) out.segmentText({ ref: this.refFor(this.translatedRefs, ref), text, stableLen, ...(language === undefined ? {} : { language }) });
      },
      translationClosed: ({ ref }) => {
        if (!live()) return;
        const mine = this.refFor(this.translatedRefs, ref);
        const origin = this.origins.get(mine);
        this.origins.delete(mine);
        out.segmentClosed({ ref: mine, ...(origin === undefined ? {} : { origin }) });
      },
      // Nothing useful remains of a leg that cannot translate (spec §7.5): it fails, naming the stage.
      failed: (e) => {
        if (!live()) return;
        if (!this.isOpen) {
          this.failure ??= e;
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
 * A leg that cannot start rejects with a `LegStartError` naming it, once the other has been stopped.
 */
export async function startStagedBoth(
  units: SeparateStages,
  requests: Record<LegName, PlanRequest>,
  events: Record<LegName, AdapterEvents>,
): Promise<Record<LegName, AdapterSession>> {
  const started = await Promise.allSettled(LEGS.map((name) => startStagedLeg(units, requests[name], events[name], name)));
  const failedAt = started.findIndex((outcome) => outcome.status === 'rejected');
  if (failedAt >= 0) {
    for (const outcome of started) if (outcome.status === 'fulfilled') quietly(() => outcome.value.stop());
    throw new LegStartError(LEGS[failedAt], (started[failedAt] as PromiseRejectedResult).reason);
  }
  const [speaker, participant] = started.map((outcome) => (outcome as PromiseFulfilledResult<AdapterSession>).value);
  return { speaker, participant };
}
