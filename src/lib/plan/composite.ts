// src/lib/plan/composite.ts
//
// The composite adapter: the adapter contract over a run plan, so that
// everything above the contract runs a plan as it runs one provider (spec
// §4.4). A plan of one unit passes the contract straight through to it; a plan
// of a text unit and a speech unit is wired per leg (`compositeLeg.ts`), and
// so is a plan whose transcription and translation are separate units
// (`compositeStages.ts`).
import { AdapterStartError } from '../contract/adapter';
import type { AdapterEvents, AdapterSession, SessionContext, StartRequest } from '../contract/adapter';
import { RUN_STAGES } from '../lineup/types';
import type { RunStage } from '../lineup/types';
import type { LegName } from '../conversation/types';
import type { ProviderRefusal, SharedSettings } from '../provider/types';
import type { RunShape } from '../session/types';
import { startCompositeLeg, textAndSpeech } from './compositeLeg';
import { separateStages, startStagedLeg } from './compositeStages';
import { accountOf, unitFor } from './read';
import type { PlannedUnit, RunPlan } from './types';

/** One leg's configs: one per unit of the plan, keyed by `PlannedUnit` identity. */
export type PlanConfigs = ReadonlyMap<PlannedUnit, unknown>;

type Models = { asrModel?: string; translationModel?: string; ttsModel?: string };

/** The model each stage's unit reports. */
const MODEL_OF: Readonly<Record<RunStage, keyof Models>> = { transcription: 'asrModel', translation: 'translationModel', speech: 'ttsModel' };

/**
 * One leg's configs: each unit built with its own provider's settings from `shape`, or the first unit's refusal,
 * unchanged. A unit is asked for speech only where it serves that stage and the leg speaks: a text unit beside a
 * speech unit is built for no speech. `shared`: what every unit reads, or what each unit reads where it differs by
 * unit (a run hands each its own provider's models).
 */
export function buildPlan(
  plan: RunPlan,
  context: SessionContext,
  shape: Pick<RunShape, 'accounts'>,
  shared: SharedSettings | ((unit: PlannedUnit) => SharedSettings),
): PlanConfigs | ProviderRefusal {
  const configs = new Map<PlannedUnit, unknown>();
  for (const planned of plan.units) {
    const speech = context.speech && planned.stages.includes('speech');
    const built = planned.unit.build(
      speech === context.speech ? context : { ...context, speech },
      accountOf(shape, planned.provider).settings,
      typeof shared === 'function' ? shared(planned) : shared,
    );
    // A config has no `refused` member (the provider type's constraint), so this tells a refusal from a config.
    if (typeof built?.refused === 'string') return built as ProviderRefusal;
    configs.set(planned, built);
  }
  return configs;
}

/** The models a leg runs: each from the unit that serves its stage, as that unit describes its own config. */
export function describePlan(plan: RunPlan, configs: PlanConfigs): Models {
  const described = new Map<PlannedUnit, Models>();
  const models: Models = {};
  for (const stage of RUN_STAGES) {
    const planned = unitFor(plan, stage);
    let said = described.get(planned);
    if (!said) {
      said = planned.unit.describe(configs.get(planned));
      described.set(planned, said);
    }
    // Only what the unit states: a model it leaves out stays out.
    const key = MODEL_OF[stage];
    if (key in said) models[key] = said[key];
  }
  return models;
}

/**
 * The adapter contract over a plan. `credentials` answers each unit's own `K`.
 * One unit: its own `start`, with its config and credentials and the same
 * `events`, and its own session. A text unit and a speech unit: one leg wired
 * between them. A unit that transcribes, a unit that translates and a unit
 * that speaks: one leg wired through all three. `leg`: the leg's name, told to
 * the units that translate and speak; a lone leg is the speaker to its units
 * unless the caller says otherwise. Any other plan rejects with
 * `plan_unsupported`.
 */
export function startComposite(
  plan: RunPlan,
  request: StartRequest<PlanConfigs, (unit: PlannedUnit) => unknown>,
  events: AdapterEvents,
  leg: LegName = 'speaker',
): Promise<AdapterSession> {
  if (plan.units.length !== 1) {
    const units = textAndSpeech(plan);
    if (units) return startCompositeLeg(units.text, units.speech, request, events, leg);
    const staged = separateStages(plan);
    if (staged) return startStagedLeg(staged, request, events, leg);
    return Promise.reject(new AdapterStartError('Only a plan of one unit, of a text unit and a speech unit, or of a unit for transcription, one for translation and one for speech, can start.', 'plan_unsupported'));
  }
  const [unit] = plan.units;
  if (!unit.unit.start) return Promise.reject(new AdapterStartError('A plan of a speech unit alone cannot start.', 'plan_unsupported'));
  // Called on the unit, as before: a unit's `start` may read `this`.
  return unit.unit.start({ ...request, config: request.config.get(unit), credentials: request.credentials(unit) }, events);
}
