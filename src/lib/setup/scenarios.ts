// src/lib/setup/scenarios.ts
//
// The five first-run scenarios and what each one sets. This is the whole
// "preset" concept: a scenario is a translation mode plus whether the speaker
// leg should speak, plus which half of a bilingual utterance each leg shows.
// The participant leg never speaks (every descriptor's
// buildParticipantSessionConfig forces textOnly, see utils/effectiveTextOnly),
// so `participant` has no voice variant.
//
// Local unions rather than the stores' types: this module must stay a leaf.
import type { ScenarioId } from './types';

export type ScenarioMode = 'speaker' | 'participant' | 'both';
export type ScenarioDisplayMode = 'source' | 'translation' | 'both';

export interface ScenarioPreset {
  id: ScenarioId;
  mode: ScenarioMode;
  textOnly: boolean;
  /** Left undefined when the scenario does not run that leg (spec §1.2). */
  speakerDisplayMode?: ScenarioDisplayMode;
  participantDisplayMode?: ScenarioDisplayMode;
}

export const SCENARIOS: readonly ScenarioPreset[] = [
  { id: 'understand-others', mode: 'participant', textOnly: true, participantDisplayMode: 'translation' },
  { id: 'be-heard', mode: 'speaker', textOnly: false, speakerDisplayMode: 'both' },
  { id: 'subtitle-myself', mode: 'speaker', textOnly: true, speakerDisplayMode: 'translation' },
  { id: 'two-way-voice', mode: 'both', textOnly: false, speakerDisplayMode: 'both', participantDisplayMode: 'both' },
  { id: 'two-way-text', mode: 'both', textOnly: true, speakerDisplayMode: 'both', participantDisplayMode: 'both' },
];

export function getScenario(id: ScenarioId): ScenarioPreset {
  const found = SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown scenario: ${id}`);
  return found;
}

/** Does the scenario produce spoken translation? Only a speaker leg can. */
export function scenarioSpeaks(s: ScenarioPreset): boolean {
  return s.mode !== 'participant' && !s.textOnly;
}

/** Does the scenario require the speaker leg to stay silent? */
export function scenarioWantsTextOnly(s: ScenarioPreset): boolean {
  return s.mode !== 'participant' && s.textOnly;
}

export type ProviderFit =
  | { ok: true }
  | { ok: false; reason: 'cannot-speak' | 'cannot-be-text-only' };

/** Whether a provider can serve a scenario, judged on its
 *  ProviderCapabilities.textOnlyCapability alone (spec §1.2, step 2). */
export function providerFitForScenario(
  textOnlyCapability: 'always' | 'optional' | 'never',
  scenario: ScenarioPreset,
): ProviderFit {
  if (textOnlyCapability === 'always' && scenarioSpeaks(scenario)) {
    return { ok: false, reason: 'cannot-speak' };
  }
  if (textOnlyCapability === 'never' && scenarioWantsTextOnly(scenario)) {
    return { ok: false, reason: 'cannot-be-text-only' };
  }
  return { ok: true };
}
