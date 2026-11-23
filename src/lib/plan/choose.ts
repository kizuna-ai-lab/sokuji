// src/lib/plan/choose.ts
//
// Choosing a provider for one stage: the provider takes the stages that go
// with it (its joint group; its transcription, when it translates only what
// it transcribes), and a provider that loses a stage another of its stages
// needs loses that one too. A transcription that stands alone stays when
// another provider is chosen to translate it.
// One more stage may change: when the text side was chosen and the voice left
// in place cannot run beside it, speech follows to the chosen host's voice.
// No option offered today brings that about (every voice with a unit of its
// own is offered alone, Kizuna AI's Soniox included); the rule stays for a
// voice that reads only its own translation. Nothing else moves. Any other
// choice the composer refuses is kept as chosen: the line-up page shows the
// refusal, and the user changes what they want (design section 8).
import { compose } from './compose';
import type { ComposeInput } from './compose';
import { isRefusal } from './types';
import { caps, goesWith, hostDefaults } from '../lineup/catalog';
import { RUN_STAGES } from '../lineup/types';
import type { LineUp, StageName } from '../lineup/types';

export interface Choice {
  lineUp: LineUp;
  /** The stages that changed besides the one chosen: the stages that go with it, the stages of another provider that needed one it took, and speech when it followed. */
  moved: readonly StageName[];
  /** Set when speech followed the chosen text side: the voice that could not stay, and the one that took its place. */
  followed?: { stage: 'speech'; from: string; to: string };
}

/**
 * The line-up after choosing `providerId` for `stage`, and what else that moved; `input` is what the composer runs
 * the result on, to tell whether the voice left in place can stay.
 */
export function choose(lineUp: LineUp, stage: StageName, providerId: string | null, input: ComposeInput): Choice {
  if (stage === 'summarisation') return { lineUp: { ...lineUp, summarisation: providerId }, moved: [] };
  if (providerId === null) throw new Error(`The ${stage} stage cannot be switched off.`);
  const chosen = caps(providerId);
  if (!chosen || !chosen.stages.includes(stage)) throw new Error(`${providerId} cannot serve ${stage}.`);

  const group = goesWith(chosen, stage);
  const defaults = hostDefaults(chosen.host);
  const next: LineUp = { ...lineUp };
  for (const s of group) next[s] = providerId;

  // A provider that lost a stage one of its other stages needs loses that one too, to the chosen host's default: a
  // joint group goes whole, and a translation goes with the transcription it is bound to. A transcription whose
  // translation went to another provider stays: it stands alone.
  for (const s of RUN_STAGES) {
    const previous = lineUp[s];
    if (group.includes(s) || previous === null) continue;
    const option = caps(previous);
    const lostPartner = !!option && goesWith(option, s).some((t) => group.includes(t) && lineUp[t] === previous);
    if (lostPartner) next[s] = defaults[s];
  }

  // The text side was chosen and the voice left in place cannot run beside it (it reads only its own translation,
  // or the new text side takes no other voice): speech follows to the chosen host's voice, when that runs. A choice
  // made on the speech stage moves nothing this way, and any other refusal is kept as chosen.
  let followed: Choice['followed'];
  const voice = next.speech;
  if (stage !== 'speech' && voice !== null && defaults.speech !== null && defaults.speech !== voice) {
    const plan = compose(next, input);
    if (isRefusal(plan) && (plan.refused === 'lineup_voice_not_alone' || plan.refused === 'lineup_voice_not_taken')) {
      const withDefault: LineUp = { ...next, speech: defaults.speech };
      if (!isRefusal(compose(withDefault, input))) {
        next.speech = defaults.speech;
        followed = { stage: 'speech', from: voice, to: defaults.speech };
      }
    }
  }

  return { lineUp: next, moved: RUN_STAGES.filter((s) => s !== stage && next[s] !== lineUp[s]), ...(followed ? { followed } : {}) };
}
