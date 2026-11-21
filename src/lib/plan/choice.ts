// src/lib/plan/choice.ts
//
// What choosing an option for a stage would lead to, before it is chosen: the
// line-up `choose` would make of it, and whether the composer would refuse
// that line-up for a reason no key, sign-in or setting can change. The
// line-up page reads it to show such an option as one that cannot be chosen.
// Pure; nothing here reads a store.
import { choose } from '../lineup/choose';
import type { LineUp, RunStage } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import { compose, type ComposeInput } from './compose';
import { isRefusal } from './types';
import type { PlanRefusal, PlanRefusalCode } from './types';

/**
 * The refusals that are about how the line-up is put together: a voice that is not offered alone, a text side
 * that takes no other voice, two managed providers. Any other refusal (a provider not offered, a unit that cannot
 * serve its stages under its settings) is not a reason to keep an option from being chosen.
 */
const STRUCTURAL: ReadonlySet<PlanRefusalCode> = new Set(['lineup_voice_not_alone', 'lineup_voice_not_taken', 'lineup_two_managed']);

/**
 * What the composer is asked with for a choice: the providers offered here, each under its stored settings, or
 * under its default settings while its entry has not loaded. The page that shows a choice and the store that
 * makes it both build theirs here, so the line-up an option is tested with is the one a click stores.
 */
export function choiceInput(providers: readonly AnyProvider[], entries: Readonly<Record<string, { settings: unknown } | undefined>>): ComposeInput {
  return { providers, settings: (id) => entries[id]?.settings ?? providers.find((p) => p.id === id)?.settings.defaults };
}

/** A choice the composer would refuse: its reason, and the line-up the choice would have made (to name the option the reason is about). */
export interface RefusedChoice { refusal: PlanRefusal; lineUp: LineUp }

/**
 * Why choosing `id` for `stage` would leave a line-up that cannot run, given the other stages as they are and
 * moved as `choose` moves them; null when the line-up it makes runs, or is refused for another kind of reason.
 */
export function refusedChoice(lineUp: LineUp, stage: RunStage, id: string, input: ComposeInput): RefusedChoice | null {
  const candidate = choose(lineUp, stage, id, input).lineUp;
  const plan = compose(candidate, input);
  return isRefusal(plan) && STRUCTURAL.has(plan.refused) ? { refusal: plan, lineUp: candidate } : null;
}
