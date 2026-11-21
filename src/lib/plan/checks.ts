// src/lib/plan/checks.ts
//
// The composer's checks that are not about which unit serves a stage: a voice
// that is not offered alone, a text side that takes no other voice, two
// managed providers in one plan, and, for a run, a pair the translation unit
// does not translate, face-to-face with the translation apart, and a target
// language the voice does not speak. And a refusal as the notice every surface words. Pure;
// nothing here reads a store or the registry.
import type { SessionContext } from '../contract/adapter';
import type { LegName } from '../conversation/types';
import { AUTO } from '../language/code';
import { caps, goesWith } from '../lineup/catalog';
import { RUN_STAGES } from '../lineup/types';
import type { LineUp, ProviderCaps, RunStage } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import type { PlanAccount, RunNotice } from '../session/types';
import type { PlannedUnit, PlanRefusal, RunPlan, UnitCapabilities } from './types';

/**
 * A voice that reads a translation its own host did not both hear and make: refused when the voice is not offered
 * alone, then when a host of the text side takes no other voice (the one that transcribes first, then the one
 * that translates, when it is another). A line-up whose three stages are on one host is never refused. With the
 * text on two hosts the voice is fed by the leg of three units, whoever it belongs to: it stands alone there
 * even on the host that transcribes, so both rules are asked.
 */
export function voiceRefusal(options: Readonly<Record<RunStage, Pick<ProviderCaps, 'id' | 'host' | 'voiceAlone' | 'takesVoice'>>>): PlanRefusal | null {
  const { transcription, translation, speech } = options;
  if (speech.host === transcription.host && speech.host === translation.host) return null;
  if (!speech.voiceAlone) return { refused: 'lineup_voice_not_alone', stage: 'speech', provider: speech.id };
  if (speech.host !== transcription.host && !transcription.takesVoice) return { refused: 'lineup_voice_not_taken', stage: 'speech', provider: transcription.id };
  if (translation.host !== transcription.host && speech.host !== translation.host && !translation.takesVoice) return { refused: 'lineup_voice_not_taken', stage: 'speech', provider: translation.id };
  return null;
}

/** Two managed providers in one plan: refused, at the first stage of the second one. */
export function twoManaged(units: readonly PlannedUnit[]): PlanRefusal | null {
  const first = units.find((u) => u.provider.kind === 'managed');
  const second = first && units.find((u) => u.provider.kind === 'managed' && u.provider.id !== first.provider.id);
  return second ? { refused: 'lineup_two_managed', stage: second.stages[0] } : null;
}

/** What `checkPlan` reads of a run besides its plan. */
export interface PlanCheckContext {
  /** Each provider's settings, by id: every provider of the plan. */
  accounts: Readonly<Record<string, Pick<PlanAccount, 'settings'>>>;
  /** The legs the run opens: each one's direction, and whether it is read aloud (`contextsFor`). */
  contexts: Partial<Record<LegName, Pick<SessionContext, 'direction' | 'speech'>>>;
  /** The line-up's ids, to name the option a refusal is about (Edge or Bing, not the provider that runs it). Absent: the provider's id. */
  lineUp?: Readonly<Partial<Pick<LineUp, RunStage>>>;
  /** Both, with the other side beside me, was asked for, whether or not the unit that transcribes can run it. */
  faceToFaceAsked?: boolean;
}

/** A stage's capabilities under its provider's settings; undefined while that provider's account has not loaded. */
function capabilitiesIn(plan: RunPlan, stage: RunStage, context: PlanCheckContext): UnitCapabilities | undefined {
  const { provider, unit } = plan.byStage[stage];
  // An account that has not loaded: the unit is not asked without its provider's settings, and nothing is judged yet.
  const account: Pick<PlanAccount, 'settings'> | undefined = context.accounts[provider.id];
  // Asked on the capabilities themselves: a unit may read them through `this`.
  return account && unit.capabilities(account.settings);
}

const LEGS = ['speaker', 'participant'] as const;

/**
 * A unit that says which pairs it translates (one that translates what another unit heard): every leg the run
 * opens must be a pair it translates, each leg in its own direction. A source that is not known yet is said
 * apart: such a unit works on one fixed pair, and choosing the spoken language answers it.
 */
function translationRefusal(plan: RunPlan, context: PlanCheckContext): PlanRefusal | null {
  const translating = capabilitiesIn(plan, 'translation', context);
  if (!translating?.translates) return null;
  const provider = context.lineUp?.translation ?? plan.byStage.translation.provider.id;
  for (const leg of LEGS) {
    const told = context.contexts[leg];
    if (!told) continue;
    const { source, target } = told.direction;
    if (translating.translates(source, target)) continue;
    if (source === AUTO) return { refused: 'lineup_source_not_fixed', stage: 'translation', provider };
    return { refused: 'lineup_pair_not_translated', stage: 'translation', provider, source, target };
  }
  return null;
}

/**
 * Face-to-face asked of a plan whose transcription and translation are apart, and whose transcription unit
 * cannot run it: one connection has to hear both people and translate each to the other, and a unit that
 * transcribes alone has a connection per leg. Named by the option that transcribes, on the translation stage:
 * giving it the translation too is what runs face-to-face.
 */
function faceToFaceRefusal(plan: RunPlan, context: PlanCheckContext): PlanRefusal | null {
  if (!context.faceToFaceAsked || plan.byStage.transcription === plan.byStage.translation) return null;
  const hearing = capabilitiesIn(plan, 'transcription', context);
  if (!hearing || hearing.faceToFace) return null;
  return { refused: 'lineup_face_to_face_apart', stage: 'translation', provider: context.lineUp?.transcription ?? plan.byStage.transcription.provider.id };
}

/** On a leg that speaks, the leg's target must be a language the speech unit has a voice for; a unit that does not say speaks whatever its provider translates into. */
function speechRefusal(plan: RunPlan, context: PlanCheckContext): PlanRefusal | null {
  const speaking = capabilitiesIn(plan, 'speech', context);
  if (!speaking?.speaks) return null;
  for (const leg of LEGS) {
    const told = context.contexts[leg];
    if (!told?.speech) continue;
    const { target } = told.direction;
    if (!speaking.speaks(target)) {
      return { refused: 'lineup_language_not_spoken', stage: 'speech', provider: context.lineUp?.speech ?? plan.byStage.speech.provider.id, language: target };
    }
  }
  return null;
}

/**
 * The checks of a plan that need the run: its pair, its legs, who is read aloud and whether face-to-face was
 * asked for. In stage order: face-to-face with the translation apart, a pair the translation unit does not
 * translate (or a source it cannot be given), then a leg read aloud in a language the voice does not speak. Null
 * when the plan can run this session.
 */
export function checkPlan(plan: RunPlan, context: PlanCheckContext): PlanRefusal | null {
  return faceToFaceRefusal(plan, context) ?? translationRefusal(plan, context) ?? speechRefusal(plan, context);
}

/** The option a refusal is about: the one it names, else the one the line-up gives the refusal's stage or splits. */
function optionOf(refusal: PlanRefusal, lineUp: Readonly<Pick<LineUp, RunStage>> | null): string | undefined {
  if (refusal.provider !== undefined) return refusal.provider;
  if (!lineUp) return undefined;
  if (refusal.refused === 'lineup_no_unit') return lineUp[refusal.stage] ?? undefined;
  if (refusal.refused !== 'lineup_stage_split') return undefined;
  // The stage was given to another option than the one it goes with: that one, named on a stage that needs it.
  for (const stage of RUN_STAGES) {
    const id = lineUp[stage];
    if (id === null || id === lineUp[refusal.stage]) continue;
    const option = caps(id);
    if (option && goesWith(option, stage).includes(refusal.stage)) return id;
  }
  return undefined;
}

/**
 * A refusal as the notice every surface words: the refusal's code, diagnostic English, and what the words name:
 * the stage, the option the refusal is about (with the engine of a managed one, whose names are alike) and the
 * language. `lineUp` and `providers` only help to name the option; null and none, and the words name less.
 */
export function refusalNotice(refusal: PlanRefusal, lineUp: Readonly<Pick<LineUp, RunStage>> | null = null, providers: readonly AnyProvider[] = []): RunNotice {
  const { refused, stage, language, source, target } = refusal;
  const option = optionOf(refusal, lineUp);
  const host = option === undefined ? undefined : providers.find((p) => p.id === (caps(option)?.host ?? option));
  const vendor = host?.kind === 'managed' ? host.vendor : undefined;
  const named = option ?? 'a provider';
  const message: Record<PlanRefusal['refused'], string> = {
    lineup_incomplete: `The line-up names no provider for ${stage}.`,
    lineup_not_offered: `The line-up names ${named} for ${stage}, which is not offered here.`,
    lineup_stage_split: `The line-up gives ${stage} to another provider than the stage it goes with.`,
    lineup_translation_bound: `The translation of ${named} needs its own transcription, and another provider transcribes.`,
    lineup_no_unit: `The provider the line-up names for ${stage} cannot serve it beside the other stages.`,
    lineup_voice_not_alone: `The voice of ${named} is not offered beside another provider's transcription.`,
    lineup_voice_not_taken: `The translation of ${named} is not read by another provider's voice.`,
    lineup_two_managed: `The line-up names two managed providers; the second serves ${stage}.`,
    lineup_language_not_spoken: `${named} has no voice for ${language ?? 'the target language'}.`,
    lineup_source_not_fixed: `${named} translates from one stated language, and the source is detected automatically.`,
    lineup_pair_not_translated: `${named} does not translate ${source ?? 'the source'} into ${target ?? 'the target'}.`,
    lineup_face_to_face_apart: `Face-to-face needs ${named} to translate what it transcribes, and another provider translates.`,
  };
  return {
    code: refused,
    message: message[refused],
    params: {
      stage,
      ...(option !== undefined ? { provider: option } : {}),
      ...(vendor ? { vendor } : {}),
      ...(language !== undefined ? { language } : {}),
      ...(source !== undefined ? { source } : {}),
      ...(target !== undefined ? { target } : {}),
    },
  };
}
