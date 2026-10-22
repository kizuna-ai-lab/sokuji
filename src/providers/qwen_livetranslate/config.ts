/**
 * Qwen LiveTranslate's `C`, `build` and `describe` (spec 2026-10-13, §5).
 * One builder for both legs: the participant's is the reversed direction,
 * in its own voice and with person labels (D7). The endpoint is the one
 * the check found, or null for the adapter to find (§2). A text-only target
 * on a leg that speaks is refused here, so the update the server would
 * refuse is never sent.
 */
import type { SessionContext } from '../../lib/contract/adapter';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { isEndpointId, type EndpointId } from './endpoints';
import {
  QWEN_LANGUAGES, QWEN_MODEL, QWEN_PAUSE, QWEN_SPOKEN, qwenParticipantVoice, qwenSpeakerVoice, SPEAKER_CLONE, SPEAKER_CLONE_ONCE, type QwenSettings,
} from './settings';

/** A preset by name, or the speaker cloned on every turn (`always`) or once at the start (`once`). */
export type QwenVoiceChoice = { kind: 'preset'; name: string } | { kind: 'clone'; frequency: 'always' | 'once' };

export interface QwenConfig {
  model: typeof QWEN_MODEL;
  /** The key's endpoint as the check found it; null: the adapter finds it before it opens. */
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
  /** Preferred translations, source term → its translation (`translation.corpus.phrases`); empty sends none. */
  phrases: Readonly<Record<string, string>>;
  /** The pause that ends a turn, in ms; null leaves the server's own (2500), as push-to-talk always does. */
  silenceMs: number | null;
  /** WebSocket only. It reaches `info.transport`, which analytics reports. */
  transport: 'websocket';
}

/** One `source=target` per line, split at the first `=`, both sides trimmed and required; a later line for the same source wins. */
function phrasesOf(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of (typeof raw === 'string' ? raw : '').split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const source = line.slice(0, eq).trim();
    const target = line.slice(eq + 1).trim();
    if (source && target) out[source] = target;
  }
  return out;
}

export function buildQwen(context: SessionContext, s: QwenSettings, shared: SharedSettings): QwenConfig | ProviderRefusal {
  const { target } = context.direction;
  // A guard: the languages offer the 60 only (never `AUTO` as a target), so the runner never builds another.
  if (!QWEN_LANGUAGES.some((o) => o.value === target)) return { refused: `Qwen LiveTranslate does not translate into ${target}.` };
  // A stale pair can still name a text-only target on a leg that speaks: the server would refuse the update.
  if (context.speech && !QWEN_SPOKEN.some((o) => o.value === target)) return { refused: `Qwen LiveTranslate writes ${target} but does not speak it: turn speech off for this leg.` };
  const participant = shared.reversed(context.direction);
  const chosen = participant ? qwenParticipantVoice(s) : qwenSpeakerVoice(s);
  const endpoint = shared.models[0]?.id;
  const manual = context.turns === 'manual';
  // The pause field is not in 3.8's documented update: it goes on the wire only when it changes something.
  const pause = Number.isFinite(s.pauseMs) ? Math.min(QWEN_PAUSE.max, Math.max(QWEN_PAUSE.min, Math.round(s.pauseMs))) : QWEN_PAUSE.default;
  return {
    model: QWEN_MODEL,
    endpoint: isEndpointId(endpoint) ? endpoint : null,
    target,
    speech: context.speech,
    voice: chosen === SPEAKER_CLONE ? { kind: 'clone', frequency: 'always' }
      : chosen === SPEAKER_CLONE_ONCE ? { kind: 'clone', frequency: 'once' }
        : { kind: 'preset', name: chosen },
    manual,
    person: participant,
    phrases: phrasesOf(s.hotwords),
    silenceMs: manual || pause === QWEN_PAUSE.default ? null : pause,
    transport: 'websocket',
  };
}

export function describeQwen(c: QwenConfig): { translationModel: string } {
  return { translationModel: c.model };
}
