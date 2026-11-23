// src/lib/plan/composite.test.ts
import { describe, expect, it, vi } from 'vitest';
import { AdapterStartError } from '../contract/adapter';
import type { AdapterEvents, AdapterSession, SessionContext, StartRequest } from '../contract/adapter';
import { createVirtualClock } from '../contract/clock';
import { recordEvents } from '../contract/events';
import type { SharedSettings } from '../run/types';
import { buildPlan, describePlan, startComposite } from './composite';
import { planOf, stubProvider } from './testing';
import type { PlanConfigs, PlannedUnit, RunPlan } from './types';

const context: SessionContext = { direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' };
const shared = { pauses: { sourceSeconds: 1, translationSeconds: 1 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 } } as unknown as SharedSettings;

/** One leg's request over a plan: these configs, these credentials by unit. */
const request = (configs: PlanConfigs, credentials: (unit: PlannedUnit) => unknown): StartRequest<PlanConfigs, (unit: PlannedUnit) => unknown> =>
  ({ context, config: configs, credentials, clock: createVirtualClock(0), signal: new AbortController().signal });

/** A plan of two units by hand: transcription and translation on one provider, speech on another; each unit's start is a spy. */
function twoUnits() {
  const starts = [vi.fn(), vi.fn()];
  const text: PlannedUnit = { ...planOf(stubProvider('soniox', { start: starts[0], describe: () => ({ asrModel: 'stt', translationModel: 'mt', ttsModel: 'not this' }) })).units[0], stages: ['transcription', 'translation'] };
  const voice: PlannedUnit = { ...planOf(stubProvider('local_inference', { start: starts[1], describe: () => ({ asrModel: 'not this', ttsModel: 'tts' }) })).units[0], stages: ['speech'] };
  const plan: RunPlan = { units: [text, voice], byStage: { transcription: text, translation: text, speech: voice } };
  return { plan, text, voice, starts };
}

describe('startComposite over one unit', () => {
  it("starts the unit once with its own config and credentials, hands it the same events, and answers with the unit's own session", async () => {
    const session = { info: {} } as AdapterSession;
    let unitEvents: AdapterEvents | undefined;
    const start = vi.fn(async (_request: unknown, events: AdapterEvents) => { unitEvents = events; return session; });
    const plan = planOf(stubProvider('soniox', { start }));
    const [unit] = plan.units;
    const config = { model: 'm' };
    const key = { apiKey: 'k' };
    const credentials = vi.fn((_unit: PlannedUnit) => key);
    const asked = request(new Map([[unit, config]]), credentials);
    const { events, log } = recordEvents();

    const started = await startComposite(plan, asked, events);

    expect(started).toBe(session);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ ...asked, config, credentials: key }, events);
    expect(credentials).toHaveBeenCalledWith(unit);
    expect(unitEvents).toBe(events);
    const payload = { ref: 1, text: 'hello' };
    unitEvents!.segmentText(payload);
    expect(log).toHaveLength(1);
    expect(log[0].payload).toBe(payload);
  });
});

describe('startComposite over one unit that is a speech unit', () => {
  it('rejects with plan_unsupported: a voice alone is no session', async () => {
    const [whole] = planOf(stubProvider('edge')).units;
    const voice: PlannedUnit = { ...whole, unit: { ...whole.unit, start: undefined, startSpeech: vi.fn() } };
    const plan: RunPlan = { units: [voice], byStage: { transcription: voice, translation: voice, speech: voice } };
    const started = startComposite(plan, request(new Map(), () => ({})), recordEvents().events);
    await expect(started).rejects.toBeInstanceOf(AdapterStartError);
    await expect(started).rejects.toMatchObject({ code: 'plan_unsupported' });
    expect(voice.unit.startSpeech).not.toHaveBeenCalled();
  });
});

describe('startComposite over several units', () => {
  it('rejects with plan_unsupported and starts no unit', async () => {
    const { plan, starts } = twoUnits();
    const started = startComposite(plan, request(new Map(), () => ({})), recordEvents().events);
    await expect(started).rejects.toBeInstanceOf(AdapterStartError);
    await expect(started).rejects.toMatchObject({ code: 'plan_unsupported' });
    for (const start of starts) expect(start).not.toHaveBeenCalled();
  });
});

describe('buildPlan', () => {
  it("builds each unit with its own provider's settings, keyed by the planned unit", () => {
    const build = vi.fn(() => ({ built: true }));
    const plan = planOf(stubProvider('soniox', { build }));
    const settings = { region: 'eu' };
    const configs = buildPlan(plan, context, { accounts: { soniox: { settings, credentials: {} } } }, shared) as PlanConfigs;
    expect([...configs]).toEqual([[plan.units[0], { built: true }]]);
    expect(build).toHaveBeenCalledWith(context, settings, shared);
  });

  it("returns the unit's refusal unchanged", () => {
    const refusal = { refused: 'No model for this pair.', code: 'model_missing', params: { pair: 'en-ja' } };
    const plan = planOf(stubProvider('soniox', { build: () => refusal }));
    expect(buildPlan(plan, context, { accounts: { soniox: { settings: {}, credentials: {} } } }, shared)).toBe(refusal);
  });
});

describe('describePlan', () => {
  it("over one unit equals the unit's own describe", () => {
    for (const described of [{ asrModel: 'a', translationModel: 'b', ttsModel: 'c' }, { asrModel: 'a' }, {}]) {
      const plan = planOf(stubProvider('soniox', { describe: () => described }));
      const [unit] = plan.units;
      const config = {};
      expect(describePlan(plan, new Map([[unit, config]]))).toStrictEqual(unit.unit.describe(config));
    }
  });

  it('takes each model from the unit of its stage', () => {
    const { plan, text, voice } = twoUnits();
    expect(describePlan(plan, new Map([[text, {}], [voice, {}]]))).toEqual({ asrModel: 'stt', translationModel: 'mt', ttsModel: 'tts' });
  });
});
