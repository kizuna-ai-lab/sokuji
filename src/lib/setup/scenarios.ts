// src/lib/setup/scenarios.ts
//
// The seven first-run scenarios and what each one sets. This is the whole
// "preset" concept: a scenario is a translation mode plus whether the speaker
// leg should speak. It sets no display mode: which half of a bilingual
// utterance each leg shows stays the user's, a re-run of the wizard included
// (Stage 2 session end, ruling 1).
// The participant leg speaks in a Both scenario when asked (Translation I hear): on
// with voice, off with text; so `participant` alone has no voice variant.
//
// Local unions rather than the stores' types: this module must stay a leaf.
import type { ScenarioId } from './types';

export type ScenarioMode = 'speaker' | 'participant' | 'both';

export interface ScenarioPreset {
  id: ScenarioId;
  mode: ScenarioMode;
  textOnly: boolean;
  /** Both with the other side beside me (face-to-face). Absent: a meeting. */
  otherSide?: 'beside';
  /** Translation I hear for the Both scenarios: on with voice, off with text. Absent: the wizard leaves it as it is. */
  participantSpeech?: boolean;
}

export const SCENARIOS: readonly ScenarioPreset[] = [
  { id: 'understand-others', mode: 'participant', textOnly: true },
  { id: 'be-heard', mode: 'speaker', textOnly: false },
  { id: 'subtitle-myself', mode: 'speaker', textOnly: true },
  { id: 'two-way-voice', mode: 'both', textOnly: false, participantSpeech: true },
  { id: 'two-way-text', mode: 'both', textOnly: true, participantSpeech: false },
  { id: 'face-to-face-voice', mode: 'both', textOnly: false, otherSide: 'beside', participantSpeech: true },
  { id: 'face-to-face-text', mode: 'both', textOnly: true, otherSide: 'beside', participantSpeech: false },
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
  | { ok: false; reason: 'cannot-speak' | 'cannot-be-text-only' | 'cannot-face-to-face' };

/** Whether a provider can serve a scenario, judged on its
 *  ProviderCapabilities.textOnlyCapability and, for a face-to-face scenario, its
 *  `faceToFace` capability (spec §1.2, step 2).
 *  No registered provider currently carries 'always' — the last two that did
 *  (Zoom AI, Volcengine ST) were removed on 2026-09-20 — so no live provider
 *  reaches the 'cannot-speak' branch today; scenarios.test.ts does exercise it
 *  directly, since the capability is a plain parameter here. The branch stays
 *  because textOnlyCapability is a three-valued descriptor contract: a future
 *  text-only provider registers, it does not re-derive this. */
export function providerFitForScenario(
  textOnlyCapability: 'always' | 'optional' | 'never',
  scenario: ScenarioPreset,
  faceToFace = false,
): ProviderFit {
  if (scenario.otherSide === 'beside' && !faceToFace) {
    return { ok: false, reason: 'cannot-face-to-face' };
  }
  if (textOnlyCapability === 'always' && scenarioSpeaks(scenario)) {
    return { ok: false, reason: 'cannot-speak' };
  }
  if (textOnlyCapability === 'never' && scenarioWantsTextOnly(scenario)) {
    return { ok: false, reason: 'cannot-be-text-only' };
  }
  return { ok: true };
}
