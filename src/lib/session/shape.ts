import type { SessionContext } from '../contract/adapter';
import type { LegName } from '../conversation/types';
import { reverseSupported } from '../provider/languages';
import type { Platform } from '../provider/types';
import type { RunNoticeCode } from './codes';
import type { RunNotice, RunShape } from './types';

/** Why a start was refused before anything opened. */
export interface Refusal extends RunNotice {
  leg?: LegName;
}

/** What each leg's adapter is told (spec: "The session request"). The participant leg runs the reverse, always with automatic turns. */
export function contextsFor(shape: RunShape): Partial<Record<LegName, SessionContext>> {
  const { provider: p, pair } = shape;
  const speaks = (wanted: boolean) => p.speech === 'always' || (p.speech === 'optional' && wanted);
  const contexts: Partial<Record<LegName, SessionContext>> = {};
  if (shape.legs.includes('speaker')) {
    contexts.speaker = {
      direction: { source: pair.source, target: pair.target },
      speech: speaks(!shape.textOnly),
      turns: shape.turnMode === 'auto' ? 'auto' : 'manual',
    };
  }
  if (shape.legs.includes('participant')) {
    contexts.participant = {
      direction: { source: pair.target, target: pair.source },
      speech: speaks(shape.participantSpeech),
      turns: 'auto',
    };
  }
  return contexts;
}

/**
 * The start gate over a frozen shape: what can be refused before anything is
 * checked, built or opened. Credentials, readiness, the build and `admit` are
 * refused by the run's later steps.
 */
export function gate(shape: RunShape, platform: Platform): Refusal | null {
  const { provider: p, settings: s, legs } = shape;
  if (legs.length === 0) return { code: 'no_legs' satisfies RunNoticeCode, message: 'The audio mode asks for no leg.' };
  const offered = p.turns(s);
  const speakerTurns = shape.turnMode === 'auto' ? 'auto' : 'manual';
  if (legs.includes('speaker') && !offered.includes(speakerTurns)) {
    return { code: 'turn_mode_unsupported' satisfies RunNoticeCode, message: `${p.id} does not offer ${speakerTurns} turns with these settings.`, leg: 'speaker' };
  }
  if (legs.includes('participant')) {
    if (!offered.includes('auto')) {
      return { code: 'turn_mode_unsupported' satisfies RunNoticeCode, message: `${p.id} does not offer automatic turns, which the participant leg needs.`, leg: 'participant' };
    }
    if (platform === 'web') {
      return { code: 'participant_source_unavailable' satisfies RunNoticeCode, message: 'This build has no participant source.', leg: 'participant' };
    }
    // D20: the participant leg runs the reversed pair; an auto source never reverses.
    if (!reverseSupported(p, s, shape.pair)) {
      return { code: 'participant_unsupported' satisfies RunNoticeCode, message: `${p.id} does not translate ${shape.pair.target} into ${shape.pair.source}.`, leg: 'participant' };
    }
  }
  return null;
}

/** Why the app's surfaces keep Start off while no microphone is chosen. */
export const NO_MICROPHONE = 'no_microphone';

/**
 * A start would open the speaker's leg with no microphone chosen (1e-3
 * ruling 5): the surfaces keep Start off, as today — the microphone source
 * would open the system default, which may be a loopback input. Muting never
 * blocks a start. The subtitle session's gate reads it now, MainPanel's mode
 * picker in plan 1e-3b.
 */
export function microphoneMissing(legs: readonly LegName[], deviceId: string | undefined): boolean {
  return legs.includes('speaker') && !deviceId;
}
