// src/lib/plan/fromStores.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

// The providers offered here are the registry's, unless a case offers none or offers another object under one's id.
const offered = vi.hoisted(() => ({ none: false, instead: null as { id: string } | null }));
vi.mock('../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/registry')>();
  const swap = (p: { id: string }) => (offered.instead?.id === p.id ? offered.instead : p);
  return { ...actual, presentProviders: () => (offered.none ? [] : actual.presentProviders().map(swap)) };
});

import { presentProviders } from '../../providers/registry';
import { geminiProvider } from '../../providers/gemini/provider';
import { edgeProvider } from '../../providers/edge/provider';
import { localInferenceProvider } from '../../providers/localInference/provider';
import { sonioxProvider } from '../../providers/soniox/provider';
import { storedLocalStages, useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import { runsOn } from '../../stores/lineUpStore.testing';
import { planFromStores, usePlan, useStageUnit } from './fromStores';
import { checkStagesOf, providersIn, transcriptionProvider } from './read';
import type { SharedSettings } from '../run/types';
import { planOf } from './testing';
import { unitsOf } from './wholeUnit';

const pair = { source: 'en', target: 'ja' };
const sonioxEntry = { settings: sonioxProvider.settings.defaults, credentials: { apiKey: 'k' }, pair };
const geminiEntry = { settings: geminiProvider.settings.defaults, credentials: { apiKey: 'g' }, pair };

beforeEach(() => {
  offered.none = false;
  offered.instead = null;
  runsOn(null);
  useProviderStore.setState({ entries: {}, intent: undefined, readiness: {}, legs: ['speaker'] });
  useLineUpStore.setState({ lineUp: null, stored: false, unstoredProvider: null });
});

describe('planFromStores', () => {
  it('is loading before a provider resolves: none is offered here', () => {
    offered.none = true;
    runsOn('soniox');
    useProviderStore.setState({ entries: { soniox: sonioxEntry } });
    expect(planFromStores()).toEqual({ state: 'loading' });
  });

  it("is loading while the plan's provider has not loaded, whatever else has", () => {
    expect(planFromStores()).toEqual({ state: 'loading' });
    runsOn('soniox');
    useProviderStore.setState({ entries: { gemini: geminiEntry } });
    expect(planFromStores()).toEqual({ state: 'loading' });
  });

  it("is ready with the selected provider's plan alone, and its entry as its account", () => {
    runsOn('soniox');
    useProviderStore.setState({ entries: { soniox: sonioxEntry, gemini: geminiEntry } });
    const found = planFromStores();
    if (found.state !== 'ready') throw new Error(`expected a ready plan, got ${found.state}`);
    expect(found.plan).toEqual(planOf(sonioxProvider));
    expect(transcriptionProvider(found.plan)).toBe(sonioxProvider);
    expect(found.accounts).toEqual({ soniox: { settings: sonioxEntry.settings, credentials: { apiKey: 'k' }, pair } });
  });

  it.each(['soniox', 'kizunaai_soniox'])("the plan the selection gives for %s is its text unit and its voice", (id) => {
    const provider = presentProviders().find((p) => p.id === id);
    // Kizuna AI's providers are offered only where the build has the hosted service.
    if (!provider) return;
    runsOn(id);
    useProviderStore.setState({ entries: { [id]: { ...sonioxEntry, credentials: {} } } });
    const found = planFromStores();
    if (found.state !== 'ready') throw new Error(`expected a ready plan, got ${found.state}`);
    expect(found.plan.units.map((u) => [u.provider.id, u.unit.id, u.stages])).toEqual([[id, 'stt', ['transcription', 'translation']], [id, 'tts', ['speech']]]);
    expect(found.plan.byStage.transcription).toBe(found.plan.byStage.translation);
    expect(found.plan.byStage.speech.unit).toBe(unitsOf(provider).find((u) => u.id === 'tts'));
    expect(providersIn(found.plan)).toEqual([provider]);
  });

  // Before a line-up is stored, this device runs the line-up the settings show (the local host's defaults: this
  // device transcribes, Bing translates, Edge speaks), not the local provider whole with Bing and Edge as cloud models.
  it('an unstored local line-up runs the line-up the settings show', () => {
    runsOn('local_inference');
    const bingEntry = { settings: {}, credentials: {}, pair };
    const edgeVoices = { ...edgeProvider.settings.defaults, voices: { 'en→ja': 'ja-JP-NanamiNeural' } };
    useProviderStore.setState({ entries: {
      local_inference: { settings: localInferenceProvider.settings.defaults, credentials: {}, pair },
      bing: bingEntry,
      edge: { settings: edgeVoices, credentials: {}, pair },
    } });
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: false, unstoredProvider: 'local_inference' });
    const found = planFromStores();
    if (found.state !== 'ready') throw new Error(`expected a ready plan, got ${found.state}`);
    expect(found.plan.units.map((u) => [u.provider.id, u.stages])).toEqual([['local_inference', ['transcription']], ['bing', ['translation']], ['edge', ['speech']]]);
    // The local provider is asked to serve transcription only: the stages the check context carries come from the plan.
    expect(checkStagesOf(found.plan, localInferenceProvider)).toEqual(['transcription']);
    // Edge's unit is built with the direction's migrated voice.
    const edgeUnit = found.plan.byStage.speech;
    const shared: SharedSettings = { pauses: { sourceSeconds: 0, translationSeconds: 0 }, reversed: () => false, segmentation: { mode: 'off', sentencesPerRow: 0 }, models: [] };
    expect(edgeUnit.unit.build({ direction: { source: 'en', target: 'ja' }, speech: true, turns: 'auto' }, found.accounts.edge.settings, shared))
      .toMatchObject({ modelId: 'edge-tts', edgeVoice: 'ja-JP-NanamiNeural' });
    // The local surfaces resolve the stages the plan runs: recognition alone on this device.
    expect(storedLocalStages()).toEqual({ translation: null, speech: null, transcription: 'local' });
  });

  it('answers a new plan for another provider object offered under the same id, with the same entry', () => {
    runsOn('soniox');
    useProviderStore.setState({ entries: { soniox: sonioxEntry } });
    const before = planFromStores();
    const other = { ...sonioxProvider };
    offered.instead = other;
    const after = planFromStores();
    if (after.state !== 'ready') throw new Error(`expected a ready plan, got ${after.state}`);
    expect(after).not.toBe(before);
    expect(transcriptionProvider(after.plan)).toBe(other);
    expect(after.accounts.soniox).toBe(sonioxEntry);
  });

  it('runs the first offered provider for a retired id when nothing is stored', () => {
    // OpenAI Compatible, retired (Stage 2 OpenAI Realtime, ruling 1): no build registers it.
    const first = presentProviders()[0];
    runsOn('openai_compatible');
    useProviderStore.setState({ entries: { [first.id]: { settings: first.settings.defaults, credentials: {}, pair } } });
    const found = planFromStores();
    if (found.state !== 'ready') throw new Error(`expected a ready plan, got ${found.state}`);
    expect(transcriptionProvider(found.plan)).toBe(first);
    expect(found.plan).toEqual(planOf(first));
  });
});

describe('usePlan', () => {
  it("keeps its identity across an unrelated provider's settings change, and follows its own entry", () => {
    runsOn('soniox');
    useProviderStore.setState({ entries: { soniox: sonioxEntry, gemini: geminiEntry } });
    const { result } = renderHook(() => usePlan());
    const first = result.current;
    expect(first.state).toBe('ready');

    act(() => useProviderStore.setState((st) => ({ entries: { ...st.entries, gemini: { ...geminiEntry, settings: { ...geminiEntry.settings as object, model: 'other' } } } })));
    expect(result.current).toBe(first);

    const settings = { ...sonioxEntry.settings as object, model: 'other' };
    act(() => useProviderStore.setState((st) => ({ entries: { ...st.entries, soniox: { ...sonioxEntry, settings } } })));
    expect(result.current).not.toBe(first);
    expect(result.current.state === 'ready' && result.current.accounts.soniox.settings).toBe(settings);
  });

  it("is loading until the plan's provider has loaded", () => {
    runsOn('soniox');
    const { result } = renderHook(() => usePlan());
    expect(result.current).toEqual({ state: 'loading' });
    act(() => useProviderStore.setState({ entries: { soniox: sonioxEntry } }));
    expect(result.current.state).toBe('ready');
  });
});

describe('useStageUnit', () => {
  it('is null while the plan is not ready, then the unit that serves the stage, with its provider, settings and capabilities', () => {
    runsOn('soniox');
    const { result } = renderHook(() => useStageUnit('speech'));
    expect(result.current).toBeNull();

    act(() => useProviderStore.setState({ entries: { soniox: sonioxEntry } }));
    expect(result.current).toMatchObject({ provider: sonioxProvider, unit: unitsOf(sonioxProvider).find((u) => u.id === 'tts'), settings: sonioxEntry.settings });
    expect(result.current!.capabilities.speech).toBe('optional');
  });
});

// The line-up store has not loaded: no reader falls back to the first offered provider, even once its entry has loaded.
describe('the plan before the line-up store has loaded', () => {
  it('is loading, for the function and both hooks, then the plan of the provider that runs', () => {
    const first = presentProviders()[0];
    useProviderStore.setState({ entries: { [first.id]: { settings: first.settings.defaults, credentials: {}, pair } } });
    const { result } = renderHook(() => ({ plan: usePlan(), unit: useStageUnit('transcription') }));
    expect(planFromStores()).toEqual({ state: 'loading' });
    expect(result.current.plan).toEqual({ state: 'loading' });
    expect(result.current.unit).toBeNull();
    act(() => runsOn(first.id));
    expect(result.current.plan.state).toBe('ready');
    expect(result.current.plan).toBe(planFromStores());
    expect(result.current.unit).toMatchObject({ provider: first, unit: unitsOf(first)[0], settings: first.settings.defaults });
  });
});

describe('the plan of a stored line-up', () => {
  const localEntry = { settings: localInferenceProvider.settings.defaults, credentials: {}, pair };
  const edgeEntry = { settings: edgeProvider.settings.defaults, credentials: {}, pair };
  const stored = (transcription: string | null, translation: string | null, speech: string | null) =>
    useLineUpStore.setState({ lineUp: { transcription, translation, speech, summarisation: null }, stored: true, unstoredProvider: null });

  it('is what the composer makes of it, with the entry of each of its providers', () => {
    stored('soniox', 'soniox', 'edge');
    useProviderStore.setState({ entries: { soniox: sonioxEntry, edge: edgeEntry, gemini: geminiEntry } });
    const found = planFromStores();
    if (found.state !== 'ready') throw new Error(`expected a ready plan, got ${found.state}`);
    expect(found.plan.units.map((u) => [u.provider.id, u.stages])).toEqual([['soniox', ['transcription', 'translation']], ['edge', ['speech']]]);
    expect(providersIn(found.plan)).toEqual([sonioxProvider, edgeProvider]);
    expect(found.accounts).toEqual({ soniox: sonioxEntry, edge: edgeEntry });
    expect(planFromStores()).toBe(found);
  });

  it('all on one provider, is the plan of that provider alone', () => {
    stored('soniox', 'soniox', 'soniox');
    useProviderStore.setState({ entries: { soniox: sonioxEntry } });
    const found = planFromStores();
    if (found.state !== 'ready') throw new Error(`expected a ready plan, got ${found.state}`);
    expect(found.plan).toEqual(planOf(sonioxProvider));
    stored('local_inference', 'local_inference', 'local_inference');
    useProviderStore.setState({ entries: { local_inference: localEntry } });
    const local = planFromStores();
    if (local.state !== 'ready') throw new Error(`expected a ready plan, got ${local.state}`);
    expect(local.plan).toEqual(planOf(localInferenceProvider));
  });

  it('decides what runs, whatever provider ran before it was stored', () => {
    useProviderStore.setState({ entries: { soniox: sonioxEntry, gemini: geminiEntry } });
    useLineUpStore.setState({ lineUp: { transcription: 'gemini', translation: 'gemini', speech: 'gemini', summarisation: null }, stored: true, unstoredProvider: 'soniox' });
    const found = planFromStores();
    if (found.state !== 'ready') throw new Error(`expected a ready plan, got ${found.state}`);
    expect(transcriptionProvider(found.plan)).toBe(geminiProvider);
  });

  it('is loading until every provider it names has loaded', () => {
    stored('soniox', 'soniox', 'edge');
    expect(planFromStores()).toEqual({ state: 'loading' });
    useProviderStore.setState({ entries: { soniox: sonioxEntry } });
    expect(planFromStores()).toEqual({ state: 'loading' });
    useProviderStore.setState({ entries: { soniox: sonioxEntry, edge: edgeEntry } });
    expect(planFromStores().state).toBe('ready');
  });

  it('is refused with the reason of the composer when it leaves a stage out, the same object each time', () => {
    stored('soniox', 'soniox', null);
    useProviderStore.setState({ entries: { soniox: sonioxEntry } });
    const found = planFromStores();
    expect(found).toEqual({ state: 'refused', refusal: { refused: 'lineup_incomplete', stage: 'speech' } });
    expect(planFromStores()).toBe(found);
  });

  it('is refused, not loading, when it names a provider that is not offered here', () => {
    offered.instead = null;
    stored('soniox', 'soniox', 'soniox');
    useProviderStore.setState({ entries: {} });
    offered.none = true;
    expect(planFromStores()).toEqual({ state: 'refused', refusal: { refused: 'lineup_not_offered', stage: 'transcription', provider: 'soniox' } });
  });

  it('is refused when no unit of a provider serves the stages it is given', () => {
    // Gemini is one connection for all three stages: it cannot be asked for speech alone.
    stored('soniox', 'soniox', 'gemini');
    useProviderStore.setState({ entries: { soniox: sonioxEntry, gemini: geminiEntry } });
    const found = planFromStores();
    expect(found.state).toBe('refused');
  });

  it('usePlan follows the line-up, and keeps its identity while the line-up and its entries stand', () => {
    stored('soniox', 'soniox', 'soniox');
    useProviderStore.setState({ entries: { soniox: sonioxEntry, gemini: geminiEntry, edge: edgeEntry } });
    const { result } = renderHook(() => usePlan());
    const first = result.current;
    expect(first.state).toBe('ready');
    act(() => useProviderStore.setState((st) => ({ entries: { ...st.entries, gemini: { ...geminiEntry } } })));
    expect(result.current).toBe(first);
    act(() => stored('soniox', 'soniox', 'edge'));
    expect(result.current).not.toBe(first);
    expect(result.current.state === 'ready' && providersIn(result.current.plan)).toEqual([sonioxProvider, edgeProvider]);
    act(() => stored('soniox', 'soniox', null));
    expect(result.current.state).toBe('refused');
  });
});
