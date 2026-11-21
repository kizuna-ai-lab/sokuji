// src/lib/plan/composite.ts
//
// The composite adapter: the adapter contract over a run plan, so that
// everything above the contract runs a plan as it runs one provider (spec
// §4.4). In step 1 a plan holds one unit and the composite passes the contract
// straight through to it; the wiring between units arrives with the second.
import { AdapterStartError } from '../contract/adapter';
import type { AdapterEvents, AdapterSession, SessionContext, StartRequest } from '../contract/adapter';
import { RUN_STAGES } from '../lineup/types';
import type { RunStage } from '../lineup/types';
import type { ProviderRefusal, SharedSettings } from '../provider/types';
import type { RunShape } from '../session/types';
import { accountOf, unitFor } from './read';
import type { PlannedUnit, RunPlan } from './types';

/** One leg's configs: one per unit of the plan, keyed by `PlannedUnit` identity. */
export type PlanConfigs = ReadonlyMap<PlannedUnit, unknown>;

type Models = { asrModel?: string; translationModel?: string; ttsModel?: string };

/** The model each stage's unit reports. */
const MODEL_OF: Readonly<Record<RunStage, keyof Models>> = { transcription: 'asrModel', translation: 'translationModel', speech: 'ttsModel' };

/** One leg's configs: each unit built with its own provider's settings from `shape`, or the first unit's refusal, unchanged. */
export function buildPlan(plan: RunPlan, context: SessionContext, shape: Pick<RunShape, 'accounts'>, shared: SharedSettings): PlanConfigs | ProviderRefusal {
  const configs = new Map<PlannedUnit, unknown>();
  for (const planned of plan.units) {
    const built = planned.unit.build(context, accountOf(shape, planned.provider).settings, shared);
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
 * `events`, and its own session. Several cannot start yet.
 */
export function startComposite(
  plan: RunPlan,
  request: StartRequest<PlanConfigs, (unit: PlannedUnit) => unknown>,
  events: AdapterEvents,
): Promise<AdapterSession> {
  if (plan.units.length !== 1) return Promise.reject(new AdapterStartError('A plan of several units cannot start yet.', 'plan_unsupported'));
  const [unit] = plan.units;
  return unit.unit.start({ ...request, config: request.config.get(unit), credentials: request.credentials(unit) }, events);
}
