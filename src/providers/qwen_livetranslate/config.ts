/**
 * Qwen LiveTranslate's `C`, `build` and `describe` (spec 2026-10-13, §5).
 * One builder for both legs: the participant's is the reversed direction,
 * in its own voice and with person labels (D7). The storefront is the one
 * the check found, or null for the adapter to find (§2). A text-only target
 * on a leg that speaks is refused here, so the update the server would
 * refuse is never sent.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { isEndpointId, type EndpointId } from './endpoints';
import { QWEN_LANGUAGES, QWEN_MODEL, QWEN_SPOKEN, qwenParticipantVoice, qwenSpeakerVoice, SPEAKER_CLONE, type QwenSettings } from './settings';

export type QwenVoiceChoice = { kind: 'preset'; name: string } | { kind: 'clone' };

export interface QwenConfig {
  model: typeof QWEN_MODEL;
  /** The key's storefront as the check found it; null: the adapter finds it before it opens. */
  endpoint: EndpointId | null;
  /** A Qwen code, which is the app code. */
  target: string;
  /** `context.speech`: the update asks for audio only when the leg speaks. */
  speech: boolean;
  voice: QwenVoiceChoice;
  /** Push-to-talk: no server turn detection; a release commits. */
  manual: boolean;
  /** The participant leg: each turn carries its speaker as `person`. */
  person: boolean;
  /** WebSocket only. It reaches `info.transport`, which analytics reports. */
  transport: 'websocket';
}

export function buildQwen(context: SessionContext, s: QwenSettings, shared: SharedSettings): QwenConfig | ProviderRefusal {
  const { target } = context.direction;
  // A guard: the languages offer the 60 only (never `AUTO` as a target), so the runner never builds another.
  if (!QWEN_LANGUAGES.some((o) => o.value === target)) return { refused: `Qwen LiveTranslate does not translate into ${target}.` };
  // A stale pair can still name a text-only target on a leg that speaks: the server would refuse the update.
  if (context.speech && !QWEN_SPOKEN.some((o) => o.value === target)) return { refused: `Qwen LiveTranslate writes ${target} but does not speak it: turn speech off for this leg.` };
  const participant = shared.reversed(context.direction);
  const chosen = participant ? qwenParticipantVoice(s) : qwenSpeakerVoice(s);
  const storefront = shared.models[0]?.id;
  return {
    model: QWEN_MODEL,
    endpoint: isEndpointId(storefront) ? storefront : null,
    target,
    speech: context.speech,
    voice: chosen === SPEAKER_CLONE ? { kind: 'clone' } : { kind: 'preset', name: chosen },
    manual: context.turns === 'manual',
    person: participant,
    transport: 'websocket',
  };
}

export function describeQwen(c: QwenConfig): { translationModel: string } {
  return { translationModel: c.model };
}
