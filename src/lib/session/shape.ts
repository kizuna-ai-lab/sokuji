import type { SessionContext } from '../contract/adapter';
import type { Speak } from '../audio/outlets';
import type { LegName } from '../conversation/types';
import { checkPlan, refusalNotice } from '../plan/checks';
import { accountOf, capabilitiesOf, providersIn, servesSpeech, transcriptionProvider, unitFor } from '../plan/read';
import { reversedPair, reverseSupported } from '../provider/languages';
import type { AnyProvider, LanguageContext, Platform } from '../provider/types';
import type { RunNotice, UnitCapabilities } from '../run/types';
import { formatUsdFloor } from '../../utils/formatters';
import type { RunNoticeCode } from './codes';
import { payerBalance } from './orgNotice';
import { ORG_INSUFFICIENT_BALANCE, ORG_WALLET_FROZEN, orgNoticeParams } from './orgNotice';
import type { PlanRefusal, RunPlan } from '../plan/types';
import type { RunShape } from './types';

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

/**
 * What decides whether a leg speaks, of the one that speaks: a plan's speech unit, or a provider alone
 * (`capabilitiesAlone`). Absent `participantSpeech`: the participant may speak.
 */
export type Speaking = Pick<UnitCapabilities, 'speech'> & Partial<Pick<UnitCapabilities, 'participantSpeech'>>;

/** Whether a leg speaks: the one rule `contextsFor`, the gate and the language offer read. */
export function legSpeaks(p: Speaking, leg: LegName, inputs: SpeechInputs): boolean {
  const speaks = (wanted: boolean) => p.speech === 'always' || (p.speech === 'optional' && wanted);
  if (leg === 'speaker') return speaks(!inputs.textOnly);
  // While its provider's participant-speech flag is off (Kizuna Soniox
  // until the backend mints a participant speech key, Stage 2 ruling 2)
  // the participant stays text-only whatever the switch says.
  return p.participantSpeech === false ? false : speaks(inputs.participantSpeech);
}

/** What `speakFor` reads from the stores (`appShape.ts`'s `speechFromStores`). */
export interface SpeakInputs {
  textOnly: boolean;
  /** Translation I hear as stored: null = auto. */
  participantSpeech: boolean | null;
  /** I hear it too off (today's monitor mute). */
  isMonitorMuted: boolean;
  legs: readonly LegName[];
  faceToFace: boolean;
  /** `participantSpeechHeard` for the platform and source: the other's translation is not recaptured. */
  heard: boolean;
}

/** Translation I hear before the provider's own flags: the switch resolved (auto = face-to-face), and a source that will not recapture it. */
export function participantSpeechInput(i: Pick<SpeakInputs, 'participantSpeech' | 'faceToFace' | 'heard'>): boolean {
  return (i.participantSpeech ?? i.faceToFace) && i.heard;
}

/**
 * Who hears what (spec 2026-10-10 §4): the three rows of the Audio page's
 * Speech block, gated by the provider's flags, the mode, face-to-face and the
 * recapture rule. The route table, the run's shape, the balance floor and
 * every surface read this one function.
 */
export function speakFor(p: Speaking, i: SpeakInputs): Speak {
  const inputs: SpeechInputs = { textOnly: i.textOnly, participantSpeech: participantSpeechInput(i) };
  const other = legSpeaks(p, 'speaker', inputs);
  // The recapture rule is a safety gate outside the provider's policy: 'always' means it speaks whenever it may be heard, never that it may be recaptured.
  const them = legSpeaks(p, 'participant', inputs) && i.heard;
  // I hear it too is a sub-row of Translation the other side hears; face-to-face has no monitor of my own
  // voice; in Both a whole-system capture would recapture it (D12).
  const both = i.legs.includes('speaker') && i.legs.includes('participant');
  const me = !i.isMonitorMuted && other && !i.faceToFace && (!both || i.heard);
  return { other, me, them };
}

/** The language context of a run over these legs (Stage 2 Volcengine AST2, choice 1): it speaks when any leg it opens does. */
export function languageContext(p: Speaking, legs: readonly LegName[], inputs: SpeechInputs): LanguageContext {
  return { speech: legs.some((leg) => legSpeaks(p, leg, inputs)) };
}

/**
 * The language context one provider of a plan is asked its lists under, from the context of the run or of a
 * leg: it speaks only when a unit of that provider serves the plan's speech stage. A provider whose lists are
 * narrower when it speaks (Doubao AST 2.0) does not speak beside another provider's voice, and is asked its
 * text offer; what that voice reads is checked apart (`checkPlan`). No context stays none: the widest offer.
 */
export function contextFor(plan: RunPlan, provider: Pick<AnyProvider, 'id'>, context: LanguageContext | undefined): LanguageContext | undefined {
  return context && { speech: context.speech && servesSpeech(plan, provider) };
}

/**
 * The plan's languages in one provider's shape, each list from the one
 * that answers it: the sources and the reverse of a pair from the
 * transcription provider, the targets from the translation provider, each
 * under its own settings at start (the settings argument is not read) and
 * told that it speaks only when it is the provider that does (`contextFor`).
 *
 * Where another unit translates what the transcription unit heard, and says
 * which pairs it translates (`UnitCapabilities.translates`), the unit
 * answers, not its provider's lists (those are of a whole session on it):
 * the targets are the languages the transcription provider works in that
 * the unit translates the source into, and a source is offered only when
 * it has such a target. An automatic source has none: a translator of its
 * own works on one fixed pair. Both lists keep the transcription provider's
 * codes, which are the ones the pair is stored and reversed in.
 */
export function planLanguages(shape: Pick<RunShape, 'plan' | 'accounts'>): Pick<AnyProvider, 'languages'> {
  const heard = transcriptionProvider(shape.plan);
  const translating = unitFor(shape.plan, 'translation');
  const translated = translating.provider;
  const sHeard = accountOf(shape, heard).settings;
  const sTranslated = accountOf(shape, translated).settings;
  const reverse = heard.languages.reverse;
  const sources = (context: LanguageContext | undefined) => heard.languages.sources(sHeard, contextFor(shape.plan, heard, context));
  const apart = translating !== unitFor(shape.plan, 'transcription');
  // Asked on the capabilities themselves: a unit may read them through `this`.
  const capabilities = apart ? translating.unit.capabilities(sTranslated) : undefined;
  if (capabilities?.translates) {
    const among = (source: string, context: LanguageContext | undefined) => heard.languages.targets(source, sHeard, contextFor(shape.plan, heard, context));
    const targets = (source: string, context: LanguageContext | undefined) => among(source, context).filter((o) => capabilities.translates!(source, o.value));
    return {
      languages: {
        ...heard.languages,
        sources: (_s, context) => sources(context).filter((o) => among(o.value, context).some((t) => capabilities.translates!(o.value, t.value))),
        targets: (source, _s, context) => targets(source, context),
        reverse: reverse && ((pair) => reverse(pair, sHeard)),
      },
    };
  }
  return {
    languages: {
      ...heard.languages,
      sources: (_s, context) => sources(context),
      targets: (source, _s, context) => translated.languages.targets(source, sTranslated, contextFor(shape.plan, translated, context)),
      reverse: reverse && ((pair) => reverse(pair, sHeard)),
    },
  };
}

/**
 * What each leg's adapter is told (spec: "The session request"). The
 * participant leg runs the reverse — the provider's own where it states one
 * (Stage 2 Palabra, ruling 9) — always with automatic turns.
 */
export function contextsFor(shape: Pick<RunShape, 'plan' | 'accounts' | 'pair' | 'legs' | 'turnMode' | 'textOnly' | 'participantSpeech'>): Partial<Record<LegName, SessionContext>> {
  const { pair } = shape;
  const speaking = capabilitiesOf(shape, 'speech');
  const contexts: Partial<Record<LegName, SessionContext>> = {};
  if (shape.legs.includes('speaker')) {
    contexts.speaker = {
      direction: { source: pair.source, target: pair.target },
      speech: legSpeaks(speaking, 'speaker', shape),
      turns: shape.turnMode === 'auto' ? 'auto' : 'manual',
    };
  }
  if (shape.legs.includes('participant')) {
    contexts.participant = {
      // The gate refused a pair with no reverse before anything asks (D20); the plain swap only answers a shape nothing gated.
      direction: reversedPair(planLanguages(shape), undefined, pair) ?? { source: pair.target, target: pair.source },
      speech: legSpeaks(speaking, 'participant', shape),
      turns: 'auto',
    };
  }
  return contexts;
}

/** What the start gate reads (F7): a run's frozen shape satisfies it, and so do the stores as they stand. `textOnly`, `participantSpeech` and `account` feed a managed provider's balance floor (Stage 2 Kizuna Soniox); absent, nothing is gated on a balance. `lineUp` names the option a refusal of the plan is about. */
export type GateInput = Pick<RunShape, 'plan' | 'accounts' | 'pair' | 'legs' | 'turnMode'> & Partial<Pick<RunShape, 'textOnly' | 'participantSpeech' | 'faceToFace' | 'faceToFaceAsked' | 'account' | 'payer' | 'lineUp'>>;

/**
 * What the plan cannot do for this run (`checkPlan`): face-to-face with the translation apart, a pair the
 * translation unit does not translate, a leg that is read aloud in a language the voice does not speak. Null when
 * the plan can run it. The gate refuses with it; a surface shows it on the line-up's card.
 */
export function planRefusalFor(shape: GateInput): PlanRefusal | null {
  const contexts = contextsFor({ ...shape, textOnly: shape.textOnly ?? false, participantSpeech: shape.participantSpeech ?? false });
  return checkPlan(shape.plan, {
    accounts: shape.accounts,
    contexts,
    ...(shape.lineUp ? { lineUp: shape.lineUp } : {}),
    ...(shape.faceToFaceAsked ? { faceToFaceAsked: true } : {}),
  });
}

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
 * below the floor for this start: the highest the plan's providers name
 * (`minimumBalance`). Nothing without an account — signed out, where the
 * sign-in check speaks, or none wired — or when no provider of the plan
 * names a floor. The backend's 402 still words a balance that changed
 * since the fetch.
 */
export function balanceRefusal(input: Pick<GateInput, 'plan' | 'accounts' | 'legs' | 'textOnly' | 'participantSpeech' | 'faceToFace' | 'account' | 'payer'>): Refusal | null {
  // The plan's providers that name a floor: the start's floor is the highest of theirs.
  const floored = providersIn(input.plan).filter((p) => p.session?.minimumBalance);
  const account = input.account;
  if (floored.length === 0 || !account) return null;
  if (account.status === 'loading') return { code: QUOTA_PENDING, message: 'The wallet is still loading.' };
  if (account.status === 'unknown') return { code: QUOTA_UNKNOWN, message: 'The wallet could not be loaded.' };
  // The wallet the chosen payer spends: a member's organization or own balance, a non-member's only one.
  const wallet = payerBalance(account, input.payer);
  // The organization pays (and the account still holds it): its refusals carry its name and the member's role.
  // The code follows the payer; the params follow the name (an empty one leaves them out and the words fall back).
  const org = input.payer === 'organization' && account.organization !== undefined;
  const orgParams = org ? orgNoticeParams(account) : undefined;
  if (wallet.frozen) {
    return org
      ? { code: ORG_WALLET_FROZEN, message: 'The organization wallet is frozen.', ...(orgParams ? { params: orgParams } : {}) }
      : { code: 'wallet_frozen', message: 'The wallet is frozen.' };
  }
  // The plan goes with it: a provider whose unit does not serve speech prices a session that asks it for text only.
  const balanceShape = { plan: input.plan, legs: input.legs, textOnly: input.textOnly ?? false, participantSpeech: input.participantSpeech ?? false, faceToFace: input.faceToFace ?? false };
  const floor = Math.max(...floored.map((p) => p.session!.minimumBalance!(balanceShape, accountOf(input, p).settings)));
  // No balance known for the chosen wallet: the server checks it, as it does an organization below the floor.
  if (wallet.microUsd === undefined || wallet.microUsd >= floor) return null;
  return {
    code: org ? ORG_INSUFFICIENT_BALANCE : BALANCE_BELOW_FLOOR,
    message: `The balance (${wallet.microUsd} µUSD) is below this start's floor (${floor} µUSD).`,
    // Floored, as every balance is: this is the moment it is too low, the worst one to round up.
    params: { ...orgParams, balance: formatUsdFloor(wallet.microUsd) },
  };
}

/**
 * The start gate: what can be refused before anything is checked, built
 * or opened — over a run's frozen shape at start (`Run.open`), and over the
 * stores as they stand while idle (`liveGate`, F7), so the surfaces keep
 * Start off and say why before it is pressed. Credentials, readiness, the
 * build and `admit` are refused by the run's later steps. After the legs
 * and the turns comes what the plan's translation unit refuses (a pair it
 * does not translate, an automatic source, face-to-face), then the reversed
 * pair, then a voice that does not speak a leg's target. The gate's own
 * last check is a managed provider's balance: the wallet loading or
 * unknown, frozen, or below the floor.
 */
export function gate(shape: GateInput, platform: Platform): Refusal | null {
  const { legs } = shape;
  if (legs.length === 0) return { code: 'no_legs' satisfies RunNoticeCode, message: 'The audio mode asks for no leg.' };
  // Turns are the transcribing unit's to offer; a refusal names its provider.
  const heard = transcriptionProvider(shape.plan);
  const offered = capabilitiesOf(shape, 'transcription').turns;
  const speakerTurns = shape.turnMode === 'auto' ? 'auto' : 'manual';
  if (legs.includes('speaker') && !offered.includes(speakerTurns)) {
    return { code: 'turn_mode_unsupported' satisfies RunNoticeCode, message: `${heard.id} does not offer ${speakerTurns} turns with these settings.`, leg: 'speaker' };
  }
  // The plan against this run's languages and legs. What its translation unit refuses (the pair, a source it
  // cannot be given, face-to-face) is said before the reversed pair is asked: it names the service and the way out.
  const unserved = planRefusalFor(shape);
  if (unserved && unserved.stage !== 'speech') return refusalNotice(unserved, shape.lineUp ?? null, providersIn(shape.plan));
  if (legs.includes('participant')) {
    if (!offered.includes('auto')) {
      return { code: 'turn_mode_unsupported' satisfies RunNoticeCode, message: `${heard.id} does not offer automatic turns, which the participant leg needs.`, leg: 'participant' };
    }
    // Face-to-face's participant hears through my microphone: its source is silent, and the web can open it.
    if (platform === 'web' && !shape.faceToFace) {
      return { code: 'participant_source_unavailable' satisfies RunNoticeCode, message: 'This build has no participant source.', leg: 'participant' };
    }
    // D20: the participant leg runs the reversed pair, in the languages its own speech offers (Stage 2 Volcengine AST2, choice 1); an auto source never reverses.
    const participant = { speech: legSpeaks(capabilitiesOf(shape, 'speech'), 'participant', { textOnly: shape.textOnly ?? false, participantSpeech: shape.participantSpeech ?? false }) };
    const languages = planLanguages(shape);
    if (!reverseSupported(languages, undefined, shape.pair, participant)) {
      // Worded from the pair actually checked (Stage 2 Palabra, ruling 9; choice 3): a hooked provider's reverse of `shape.pair`, not the plain swap.
      const reversed = reversedPair(languages, undefined, shape.pair);
      const message = reversed === null
        ? `${heard.id} has no reverse of ${shape.pair.source} → ${shape.pair.target}.`
        : `${heard.id} does not offer ${reversed.source} → ${reversed.target}.`;
      return { code: 'participant_unsupported' satisfies RunNoticeCode, message, leg: 'participant' };
    }
  }
  // A leg read aloud in a language the voice does not speak.
  if (unserved) return refusalNotice(unserved, shape.lineUp ?? null, providersIn(shape.plan));
  const refusal = balanceRefusal(shape);
  // An organization payer below the floor is not refused here: the status can be minutes old and cannot tell money held
  // by colleagues' running sessions from an empty organization, so the server answers precisely. A frozen one still is.
  if (refusal?.code === ORG_INSUFFICIENT_BALANCE) return null;
  return refusal;
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
