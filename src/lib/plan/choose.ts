// src/lib/plan/choose.ts
//
// Choosing a provider for one stage: the provider takes the stages that go
// with it (its joint group; its transcription, when it translates only what
// it transcribes), and a provider that loses a stage another of its stages
// needs loses that one too. A transcription that stands alone stays when
// another provider is chosen to translate it.
// A voice that is not offered alone reads only its own translation (OpenAI
// Realtime's, Doubao AST 2.0's, Qwen's): choosing it for speech chooses its
// text side too, as an end-to-end provider's joint group does, and it goes
// when its text side does (it follows, and the result says so).
// One more stage may change: when the text side was chosen and the voice left
// in place cannot run beside it, speech follows to the chosen host's voice.
// And two managed providers never run together: the other one's stages go to
// the chosen host's defaults. Nothing else moves. Any other
// choice the composer refuses is kept as chosen: the line-up page shows the
// refusal, and the user changes what they want (design section 8).
import { compose } from './compose';
import type { ComposeInput } from './compose';
import { isRefusal } from './types';
import { allCaps, caps, goesWith, hostDefaults } from '../lineup/catalog';
import { RUN_STAGES } from '../lineup/types';
import type { LineUp, ProviderCaps, RunStage, StageName } from '../lineup/types';

export interface Choice {
  lineUp: LineUp;
  /** The stages that changed besides the one chosen: the stages that go with it, the stages of another provider that needed one it took, and speech when it followed. */
  moved: readonly StageName[];
  /** Set when speech followed the chosen text side: the voice that could not stay, and the one that took its place. */
  followed?: { stage: 'speech'; from: string; to: string };
}

/**
 * The stages an option holds together with `stage`: the ones that go with it, and for a voice that is not offered
 * alone, everything the option serves, since it reads only what its own text side says.
 */
function needs(option: ProviderCaps, stage: RunStage): readonly RunStage[] {
  return stage === 'speech' && !option.voiceAlone ? option.stages : goesWith(option, stage);
}

/**
 * The line-up after choosing `providerId` for `stage`, and what else that moved; `input` is what the composer runs
 * the result on, to tell whether the voice left in place can stay.
 */
export function choose(lineUp: LineUp, stage: StageName, providerId: string | null, input: ComposeInput): Choice {
  if (stage === 'summarisation') return { lineUp: { ...lineUp, summarisation: providerId }, moved: [] };
  if (providerId === null) throw new Error(`The ${stage} stage cannot be switched off.`);
  // The catalog the composer is asked with: a test's own, or the app's.
  const catalog = input.catalog ?? allCaps();
  const chosen = caps(providerId, catalog);
  if (!chosen || !chosen.stages.includes(stage)) throw new Error(`${providerId} cannot serve ${stage}.`);

  const group = needs(chosen, stage);
  const defaults = hostDefaults(chosen.host, catalog);
  const next: LineUp = { ...lineUp };
  for (const s of group) next[s] = providerId;

  // A provider that lost a stage one of its other stages needs loses that one too, to the chosen host's default: a
  // joint group goes whole, a translation goes with the transcription it is bound to, and a voice that is not offered
  // alone goes with its own text side (it follows, and the result says so). A transcription whose translation went to
  // another provider stays: it stands alone.
  let followed: Choice['followed'];
  for (const s of RUN_STAGES) {
    const previous = lineUp[s];
    if (group.includes(s) || previous === null) continue;
    const option = caps(previous, catalog);
    const lost = (stages: readonly RunStage[]) => stages.some((t) => group.includes(t) && lineUp[t] === previous);
    if (!option || !lost(needs(option, s))) continue;
    next[s] = defaults[s];
    if (s === 'speech' && !lost(goesWith(option, s)) && defaults.speech !== null && defaults.speech !== previous) {
      followed = { stage: 'speech', from: previous, to: defaults.speech };
    }
  }

  // The text side was chosen and the voice left in place cannot run beside it (it reads only its own translation,
  // or the new text side takes no other voice): speech follows to the chosen host's voice, when that runs. A choice
  // made on the speech stage moves nothing this way, and any other refusal is kept as chosen.
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

  // Two managed providers never run together (`twoManaged`): another managed provider left beside a managed one chosen
  // gives its stages to the chosen host's defaults (Kizuna AI's Soniox voice beside Kizuna AI's Qwen chosen for the text
  // side, or the other way round). Said by what moved, as a joint group that goes whole is: the line-up page's sentence
  // is about a voice that reads only its own translation.
  if (chosen.account === 'kizuna') {
    for (const s of RUN_STAGES) {
      const id = next[s];
      if (id !== null && id !== providerId && caps(id, catalog)?.account === 'kizuna') next[s] = defaults[s];
    }
  }

  return { lineUp: next, moved: RUN_STAGES.filter((s) => s !== stage && next[s] !== lineUp[s]), ...(followed ? { followed } : {}) };
}
