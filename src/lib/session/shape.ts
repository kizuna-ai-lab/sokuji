import type { SessionContext } from '../contract/adapter';
import type { LegName } from '../conversation/types';
import { reverseSupported } from '../provider/languages';
import type { AnyProvider, LanguageContext, Platform } from '../provider/types';
import { formatUsdFloor } from '../../utils/formatters';
import type { RunNoticeCode } from './codes';
import type { RunNotice, RunShape } from './types';

/** Why a start was refused before anything opened. */
export interface Refusal extends RunNotice {
  leg?: LegName;
}

/**
 * What decides whether a run would speak besides its legs and its provider:
 * the text-only switch, and the participant's speech — its switch, and a
 * source that will not recapture it (`appShape`'s `speechInputsFromStores`).
 * A run's shape holds both; so does the provider store, for the language
 * offer (Stage 2 Volcengine AST2, choice 1).
 */
export interface SpeechInputs { textOnly: boolean; participantSpeech: boolean }

type Speaking = Pick<AnyProvider, 'speech' | 'participantSpeech'>;

/** Whether a leg speaks: the one rule `contextsFor`, the gate and the language offer read. */
function legSpeaks(p: Speaking, leg: LegName, inputs: SpeechInputs): boolean {
  const speaks = (wanted: boolean) => p.speech === 'always' || (p.speech === 'optional' && wanted);
  if (leg === 'speaker') return speaks(!inputs.textOnly);
  // While its provider's participant-speech flag is off (Kizuna Soniox
  // until the backend mints a participant speech key, Stage 2 ruling 2)
  // the participant stays text-only whatever the switch says.
  return p.participantSpeech === false ? false : speaks(inputs.participantSpeech);
}

/** The language context of a run over these legs (Stage 2 Volcengine AST2, choice 1): it speaks when any leg it opens does. */
export function languageContext(p: Speaking, legs: readonly LegName[], inputs: SpeechInputs): LanguageContext {
  return { speech: legs.some((leg) => legSpeaks(p, leg, inputs)) };
}

/** What each leg's adapter is told (spec: "The session request"). The participant leg runs the reverse, always with automatic turns. */
export function contextsFor(shape: RunShape): Partial<Record<LegName, SessionContext>> {
  const { provider: p, pair } = shape;
  const contexts: Partial<Record<LegName, SessionContext>> = {};
  if (shape.legs.includes('speaker')) {
    contexts.speaker = {
      direction: { source: pair.source, target: pair.target },
      speech: legSpeaks(p, 'speaker', shape),
      turns: shape.turnMode === 'auto' ? 'auto' : 'manual',
    };
  }
  if (shape.legs.includes('participant')) {
    contexts.participant = {
      direction: { source: pair.target, target: pair.source },
      speech: legSpeaks(p, 'participant', shape),
      turns: 'auto',
    };
  }
  return contexts;
}

/** What the start gate reads (F7): a run's frozen shape satisfies it, and so do the stores as they stand. `textOnly`, `participantSpeech` and `account` feed a managed provider's balance floor (Stage 2 Kizuna Soniox); absent, nothing is gated on a balance. */
export type GateInput = Pick<RunShape, 'provider' | 'settings' | 'pair' | 'legs' | 'turnMode'> & Partial<Pick<RunShape, 'textOnly' | 'participantSpeech' | 'account'>>;

/** A start refused below a managed provider's floor: worded by the old gate's "Insufficient balance: {{balance}}" (ruling 6). */
export const BALANCE_BELOW_FLOOR = 'balance_below_floor';
/** The wallet's first fetch still in flight: "Checking...", no failure words at every launch (ruling 5). */
export const QUOTA_PENDING = 'quota_pending';
/** A fetch failed and no wallet is known: the old gate's "Unable to load quota information" (ruling 5; `oldGate:254-261`). */
export const QUOTA_UNKNOWN = 'quota_unknown';

/**
 * A managed provider's balance check over the account as the client
 * knows it (Stage 2 Kizuna Soniox, rulings 5 and 6): the wallet still
 * loading, a wallet that failed to load, a frozen wallet, or a balance
 * below the floor the provider names for this start (`minimumBalance`).
 * Nothing without an account — signed out, where the sign-in check
 * speaks, or none wired — or when the provider names no floor. The
 * backend's 402 still words a balance that changed since the fetch.
 */
export function balanceRefusal(input: Pick<GateInput, 'provider' | 'settings' | 'legs' | 'textOnly' | 'participantSpeech' | 'account'>): Refusal | null {
  const floorFor = input.provider.session?.minimumBalance;
  const account = input.account;
  if (!floorFor || !account) return null;
  if (account.status === 'loading') return { code: QUOTA_PENDING, message: 'The wallet is still loading.' };
  if (account.status === 'unknown') return { code: QUOTA_UNKNOWN, message: 'The wallet could not be loaded.' };
  if (account.frozen) return { code: 'wallet_frozen', message: 'The wallet is frozen.' };
  const floor = floorFor({ legs: input.legs, textOnly: input.textOnly ?? false, participantSpeech: input.participantSpeech ?? false }, input.settings);
  if (account.balanceMicroUsd >= floor) return null;
  return {
    code: BALANCE_BELOW_FLOOR,
    message: `The balance (${account.balanceMicroUsd} µUSD) is below this start's floor (${floor} µUSD).`,
    // Floored, as every balance is: this is the moment it is too low, the worst one to round up.
    params: { balance: formatUsdFloor(account.balanceMicroUsd) },
  };
}

/**
 * The start gate: what can be refused before anything is checked, built
 * or opened — over a run's frozen shape at start (`Run.open`), and over the
 * stores as they stand while idle (`liveGate`, F7), so the surfaces keep
 * Start off and say why before it is pressed. Credentials, readiness, the
 * build and `admit` are refused by the run's later steps. The gate's own
 * last check is a managed provider's balance: the wallet loading or
 * unknown, frozen, or below the floor.
 */
export function gate(shape: GateInput, platform: Platform): Refusal | null {
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
    // D20: the participant leg runs the reversed pair, in the languages its own speech offers (Stage 2 Volcengine AST2, choice 1); an auto source never reverses.
    const participant = { speech: legSpeaks(p, 'participant', { textOnly: shape.textOnly ?? false, participantSpeech: shape.participantSpeech ?? false }) };
    if (!reverseSupported(p, s, shape.pair, participant)) {
      return { code: 'participant_unsupported' satisfies RunNoticeCode, message: `${p.id} does not translate ${shape.pair.target} into ${shape.pair.source}.`, leg: 'participant' };
    }
  }
  return balanceRefusal(shape);
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
