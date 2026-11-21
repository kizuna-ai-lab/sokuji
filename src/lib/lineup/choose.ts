// src/lib/lineup/choose.ts
//
// Choosing a provider for one stage: the provider takes the stages it holds
// jointly, and a provider that loses part of a joint group loses all of it.
// One more stage may change: when the text side was chosen and the voice left
// in place cannot run beside it, speech follows to the chosen host's voice.
// Nothing else moves. Any other choice the composer refuses is kept as chosen:
// the line-up page shows the refusal, and the user changes what they want
// (design section 8).
import { compose } from '../plan/compose';
import type { ComposeInput } from '../plan/compose';
import { isRefusal } from '../plan/types';
import { caps, hostDefaults } from './catalog';
import { RUN_STAGES } from './types';
import type { LineUp, RunStage, StageName } from './types';

export interface Choice {
  lineUp: LineUp;
  /** The stages that changed besides the one chosen: its joint partners, a joint group that lost a stage to it, and speech when it followed. */
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

  const group: readonly RunStage[] = chosen.joint?.includes(stage) ? chosen.joint : [stage];
  const defaults = hostDefaults(chosen.host);
  const next: LineUp = { ...lineUp };
  for (const s of group) next[s] = providerId;

  // A provider that lost one stage of a joint group loses the whole group.
  for (const s of RUN_STAGES) {
    const previous = lineUp[s];
    if (group.includes(s) || previous === null) continue;
    const joint = caps(previous)?.joint;
    const lostPartner = !!joint && joint.includes(s) && joint.some((t) => group.includes(t) && lineUp[t] === previous);
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
