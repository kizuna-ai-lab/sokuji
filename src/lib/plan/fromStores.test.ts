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

// The providers offered here are the registry's, unless a case offers none.
const offered = vi.hoisted(() => ({ none: false }));
vi.mock('../../providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers/registry')>();
  return { ...actual, presentProviders: () => (offered.none ? [] : actual.presentProviders()) };
});

import { presentProviders } from '../../providers/registry';
import { geminiProvider } from '../../providers/gemini/provider';
import { localInferenceProvider } from '../../providers/localInference/provider';
import { sonioxProvider } from '../../providers/soniox/provider';
import { storedLocalStages, useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore } from '../../stores/providerStore';
import { planFromStores, usePlan, useStageUnit } from './fromStores';
import { providersIn, transcriptionProvider } from './read';
import { planOf } from './testing';
import { unitsOf } from './wholeUnit';

const pair = { source: 'en', target: 'ja' };
const sonioxEntry = { settings: sonioxProvider.settings.defaults, credentials: { apiKey: 'k' }, pair };
const geminiEntry = { settings: geminiProvider.settings.defaults, credentials: { apiKey: 'g' }, pair };

beforeEach(() => {
  offered.none = false;
  useProviderStore.setState({ entries: {}, intent: undefined, readiness: {}, selected: null, legs: ['speaker'] });
  useLineUpStore.setState({ lineUp: null, stored: false });
});

describe('planFromStores', () => {
  it('is loading before a provider resolves: none is offered here', () => {
    offered.none = true;
    useProviderStore.setState({ selected: 'soniox', entries: { soniox: sonioxEntry } });
    expect(planFromStores()).toEqual({ state: 'loading' });
  });

  it("is loading while the plan's provider has not loaded, whatever else has", () => {
    expect(planFromStores()).toEqual({ state: 'loading' });
    useProviderStore.setState({ selected: 'soniox', entries: { gemini: geminiEntry } });
    expect(planFromStores()).toEqual({ state: 'loading' });
  });

  it('is ready with the selected provider as one whole-provider unit, and its entry as its account', () => {
    useProviderStore.setState({ selected: 'soniox', entries: { soniox: sonioxEntry, gemini: geminiEntry } });
    const found = planFromStores();
    if (found.state !== 'ready') throw new Error(`expected a ready plan, got ${found.state}`);
    expect(found.plan).toEqual(planOf(sonioxProvider));
    expect(transcriptionProvider(found.plan)).toBe(sonioxProvider);
    expect(found.accounts).toEqual({ soniox: { settings: sonioxEntry.settings, credentials: { apiKey: 'k' }, pair } });
  });

  // Before a line-up is stored the plan is the selection's, never one composed from the line-up the settings
  // show: while the local scan runs, they show the local host's defaults, Bing and Edge.
  it('runs the selected local provider whole before a line-up is stored, not the line-up shown', () => {
    useProviderStore.setState({ selected: 'local_inference', entries: { local_inference: { settings: localInferenceProvider.settings.defaults, credentials: {}, pair } } });
    useLineUpStore.setState({ lineUp: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null }, stored: false });
    const found = planFromStores();
    if (found.state !== 'ready') throw new Error(`expected a ready plan, got ${found.state}`);
    expect(found.plan).toEqual(planOf(localInferenceProvider));
    expect(providersIn(found.plan)).toEqual([localInferenceProvider]);
    expect(storedLocalStages()).toBeNull();
  });

  it('runs the first offered provider for a retired id when nothing is stored', () => {
    // OpenAI Compatible, retired (Stage 2 OpenAI Realtime, ruling 1): no build registers it.
    const first = presentProviders()[0];
    useProviderStore.setState({ selected: 'openai_compatible', entries: { [first.id]: { settings: first.settings.defaults, credentials: {}, pair } } });
    const found = planFromStores();
    if (found.state !== 'ready') throw new Error(`expected a ready plan, got ${found.state}`);
    expect(transcriptionProvider(found.plan)).toBe(first);
    expect(found.plan).toEqual(planOf(first));
  });
});

describe('usePlan', () => {
  it("keeps its identity across an unrelated provider's settings change, and follows its own entry", () => {
    useProviderStore.setState({ selected: 'soniox', entries: { soniox: sonioxEntry, gemini: geminiEntry } });
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
    useProviderStore.setState({ selected: 'soniox' });
    const { result } = renderHook(() => usePlan());
    expect(result.current).toEqual({ state: 'loading' });
    act(() => useProviderStore.setState({ entries: { soniox: sonioxEntry } }));
    expect(result.current.state).toBe('ready');
  });
});

describe('useStageUnit', () => {
  it('is null while the plan is not ready, then the unit that serves the stage, with its provider, settings and capabilities', () => {
    useProviderStore.setState({ selected: 'soniox' });
    const { result } = renderHook(() => useStageUnit('speech'));
    expect(result.current).toBeNull();

    act(() => useProviderStore.setState({ entries: { soniox: sonioxEntry } }));
    expect(result.current).toMatchObject({ provider: sonioxProvider, unit: unitsOf(sonioxProvider)[0], settings: sonioxEntry.settings });
    expect(result.current!.capabilities.speech).toBe(sonioxProvider.speech);
  });
});
