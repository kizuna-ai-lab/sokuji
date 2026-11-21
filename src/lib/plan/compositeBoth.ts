// src/lib/plan/compositeBoth.ts
//
// Both legs of a plan of a text unit and a speech unit, over a text provider
// that starts both legs at once: one voice per speaking leg, a translation
// into the other leg's language read by that leg's voice, and one numbering
// of a row's audio whichever voice reads it (spec §7.2). A plan whose
// transcription and translation are separate units starts each leg on its
// own instead (`compositeStages.ts`).
import { AdapterStartError } from '../contract/adapter';
import type { AdapterEvents, AdapterSession, Ref } from '../contract/adapter';
import type { LegName } from '../conversation/types';
import { CompositeLeg, textAndSpeech, type PlanRequest, type Voices } from './compositeLeg';
import { separateStages, startStagedBoth } from './compositeStages';
import type { RunPlan } from './types';

const LEGS: readonly LegName[] = ['speaker', 'participant'];

/**
 * Both legs over one start of the text provider (`session.startBoth`), which decides between one connection for
 * both and one each, and says which through its sessions' `info.shared`.
 *
 * The text sessions start first and the voices right after, opened and not awaited, before this resolves — so
 * before the caller can send any audio, and no word can come first. A leg whose text session failed or closed
 * while the legs were starting gets no voice. A voice's count of audio entries is fixed when
 * it starts, and whether the voices share one is known only from the started text sessions: legs that share a
 * connection number their rows together, and either voice may read a row; legs that do not number them apart.
 *
 * A text provider that fails to start rejects with its own error (a `LegStartError` names the leg).
 *
 * A plan whose transcription and translation are separate units is not started this way: each of its legs starts
 * on its own, with its own sessions and voice, whether or not the provider that transcribes can start both.
 */
export async function startCompositeBoth(
  plan: RunPlan,
  requests: Record<LegName, PlanRequest>,
  events: Record<LegName, AdapterEvents>,
): Promise<Record<LegName, AdapterSession>> {
  const staged = separateStages(plan);
  if (staged) return startStagedBoth(staged, requests, events);
  const units = textAndSpeech(plan);
  const startBoth = units?.text.provider.session?.startBoth;
  if (!units || !startBoth) throw new AdapterStartError('Both legs start together only over a text unit whose provider starts both, and a speech unit.', 'plan_unsupported');

  let shared = false;
  /** Per leg and translation, the other legs' voices that read it: told when the translation closes. */
  const abroad: Record<LegName, Map<Ref, Set<CompositeLeg>>> = { speaker: new Map(), participant: new Map() };
  const voices: Voices = {
    speak(leg, ref, text, span, language) {
      // A leg speaks into its own target.
      if (language === leg.target) {
        leg.speak(ref, text, span, language);
        return;
      }
      // Legs on one connection: a translation into the other leg's target (someone switched language, or the
      // tail of the last utterance landed on this one) is read by that leg's voice, into its ear. The row stays
      // this leg's: its audio and ranges return here, naming that voice. Legs apart have nobody to hand it to.
      if (!shared) return;
      const other = legs.find((l) => l !== leg && l.target === language && l.speaks);
      if (!other) return;
      let readers = abroad[leg.name].get(ref);
      if (!readers) {
        readers = new Set();
        abroad[leg.name].set(ref, readers);
      }
      readers.add(other);
      other.speak(ref, text, span, language, leg.name);
    },
    end(leg, ref) {
      leg.endUtterance(ref);
      // The voices that read this translation abroad end its utterance too.
      const readers = abroad[leg.name].get(ref);
      if (!readers) return;
      abroad[leg.name].delete(ref);
      for (const other of readers) other.endUtterance(ref);
    },
    leg: (name) => legs.find((l) => l.name === name),
  };
  const legs = LEGS.map((name) => new CompositeLeg(name, units.text, units.speech, requests[name], events[name], voices));
  const [speaker, participant] = legs;

  const sessions = await startBoth(
    { speaker: speaker.textRequest(), participant: participant.textRequest() },
    { speaker: speaker.textEvents, participant: participant.textEvents },
  );
  shared = sessions.speaker.info.shared === true;
  const counts = new Map<Ref, number>();
  for (const leg of legs) {
    leg.openVoice(shared ? counts : new Map());
    leg.opened();
  }

  /** A leg's stop: its text session first, then the voices. Legs on one connection end together, so both voices close. */
  const stop = (leg: CompositeLeg) => (): Promise<void> => {
    const ending = shared ? legs : [leg];
    for (const l of ending) {
      l.cut();
      abroad[l.name].clear();
    }
    try {
      return sessions[leg.name].stop();
    } finally {
      for (const l of ending) l.closeVoice(true);
    }
  };
  return { speaker: speaker.session(sessions.speaker, stop(speaker)), participant: participant.session(sessions.participant, stop(participant)) };
}
