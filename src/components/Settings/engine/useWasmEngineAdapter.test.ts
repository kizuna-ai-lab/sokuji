import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCallback, useMemo, useState } from 'react';
import { useWasmEngineAdapter } from './useWasmEngineAdapter';
import { useModelStore } from '../../../stores/modelStore';
import { getManifestByType } from '../../../lib/local-inference/modelManifest';
import { wasmCandidates } from '../../../lib/local-inference/selection/candidates.wasm';
import { LOCAL_INFERENCE_DEFAULTS, type LocalInferenceSettings } from '../../../providers/localInference/settings';
import type { LanguagePair } from '../../../lib/provider/types';

const jaAsr = () => getManifestByType('asr').filter(m => m.multilingual || m.languages.includes('ja'));

const JA_EN: LanguagePair = { source: 'ja', target: 'en' };
const ZH_KO: LanguagePair = { source: 'zh', target: 'ko' };

/** The adapter over LocalInference's own settings, held in React state as
 *  `LocalInferenceEngine` holds them: the override every mount passes
 *  (Stage 2 deletion, ruling 3). */
function useHeldAdapter(pair: LanguagePair = JA_EN) {
  const [settings, setSettings] = useState<LocalInferenceSettings>({ ...LOCAL_INFERENCE_DEFAULTS, selections: {} });
  const update = useCallback((patch: Partial<LocalInferenceSettings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const override = useMemo(() => ({ settings, update, pair }), [settings, update, pair]);
  return { adapter: useWasmEngineAdapter(false, override), settings };
}

describe('useWasmEngineAdapter', () => {
  beforeEach(() => {
    useModelStore.setState({ modelStatuses: {}, webgpuAvailable: true });
  });

  it('directions are speaker-first ja→en then en→ja', () => {
    const { result } = renderHook(() => useHeldAdapter());
    expect(result.current.adapter.directions.map(d => d.dir)).toEqual(['ja→en', 'en→ja']);
  });

  it('readyCandidates lists only downloaded/usable implementations', () => {
    const first = jaAsr()[0];
    useModelStore.setState({ modelStatuses: { [first.id]: 'downloaded' } });
    const { result } = renderHook(() => useHeldAdapter());
    const ids = result.current.adapter.readyCandidates({ dir: 'ja→en', stage: 'asr' }).map(c => c.id);
    expect(ids).toContain(first.id);
    // an un-downloaded ja-capable ASR is absent
    const notDownloaded = jaAsr().find(m => m.id !== first.id && !m.isCloudModel);
    if (notDownloaded) expect(ids).not.toContain(notDownloaded.id);
  });

  // AST-capable ASR entries (autoEligible: false in the translation pool)
  // must stay out of this quick picker even once downloaded: picking one
  // whose id != the currently-resolved ASR is immediately masked by
  // guardAstCrossStage (falls back to auto + a note) — a click that
  // visibly does the opposite of what it says. They're reachable through
  // the Library's full card flow, never this picker.
  it('excludes AST-capable (autoEligible: false) ASR entries from the translation quick picker, even when downloaded', () => {
    const pool = wasmCandidates({ modelStatuses: {}, webgpuAvailable: true, deviceFeatures: [] })
      .pool('translation', 'ja', 'en');
    const astCandidate = pool.find((c) => !c.autoEligible);
    const normalCandidate = pool.find((c) => c.autoEligible);
    // Manifest fixture assumption: at least one AST-capable ASR entry and one
    // normal translation model are ja→en compatible today (granite-speech /
    // opus-mt-ja-en). If the manifest ever drops the AST entry entirely this
    // assumption — not the filter under test — needs revisiting.
    expect(astCandidate).toBeDefined();
    expect(normalCandidate).toBeDefined();
    useModelStore.setState({
      modelStatuses: { [astCandidate!.id]: 'downloaded', [normalCandidate!.id]: 'downloaded' },
      webgpuAvailable: true,
    });
    const { result } = renderHook(() => useHeldAdapter());
    const ids = result.current.adapter.readyCandidates({ dir: 'ja→en', stage: 'translation' }).map(c => c.id);
    expect(ids).not.toContain(astCandidate!.id);
    expect(ids).toContain(normalCandidate!.id);
  });

  it('select writes an explicit pick preserving sibling stages, and "" restores auto', async () => {
    const { result } = renderHook(() => useHeldAdapter());
    await act(() => result.current.adapter.select({ dir: 'en→ja', stage: 'translation' }, 'some-model'));
    const sel = result.current.settings.selections['en→ja'];
    expect(sel.translation.modelId).toBe('some-model');
    expect(sel.asr.modelId).toBe('');
    await act(() => result.current.adapter.select({ dir: 'en→ja', stage: 'translation' }, ''));
    expect(result.current.settings.selections['en→ja']).toBeUndefined();
  });

  it('participant direction renders asr+translation only', () => {
    const { result } = renderHook(() => useHeldAdapter());
    expect(result.current.adapter.stagesFor('en→ja', false)).toEqual(['asr', 'translation']);
    expect(result.current.adapter.stagesFor('ja→en', true)).toEqual(['asr', 'translation', 'tts']);
  });

  it('reads its directions from the given pair', () => {
    const { result } = renderHook(() => useHeldAdapter(ZH_KO));
    expect(result.current.adapter.directions.map(d => d.dir)).toEqual(['zh→ko', 'ko→zh']);
  });

  it("writes a pick through the given update, with the whole selections map", async () => {
    const update = vi.fn();
    const { result } = renderHook(() => useWasmEngineAdapter(false, {
      settings: { ...LOCAL_INFERENCE_DEFAULTS, selections: {} },
      update,
      pair: JA_EN,
    }));
    await act(() => result.current.select({ dir: 'en→ja', stage: 'translation' }, 'some-model'));
    expect(update).toHaveBeenCalledWith({
      selections: { 'en→ja': { asr: { modelId: '' }, translation: { modelId: 'some-model' }, tts: { modelId: '' } } },
    });
  });
});
