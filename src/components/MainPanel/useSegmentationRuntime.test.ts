import React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSegmentationRuntime } from './useSegmentationRuntime';
import type { PunctuationRuntimeOptions } from '../../lib/segmentation/PunctuationRuntime';
import type { SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';
import { useSegmentationStore } from '../../stores/segmentationStore';
import useSettingsStore from '../../stores/settingsStore';
import useLogStore from '../../stores/logStore';
import { settleReports } from '../../lib/diagnostics/report';

// settingsStore's static import graph reaches ModernBrowserAudioService's
// worklet `?url` import via ServiceFactory, which this sandboxed Vite test
// transform denies outright (same reason nativeModelStore.test.ts and
// settingsStore.subtitle.test.ts mock it). This hook only ever reads the
// plain setting value, never persistence, so a stub is enough.
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, fallback: unknown) => fallback,
      setSetting: async () => undefined,
    }),
  },
}));

// PunctuationRuntime's own state machine (downloads, worker lifecycle,
// retries) is exercised end-to-end in PunctuationRuntime.test.ts. This hook's
// entire job is wiring: attach the store and diagnostics to the callbacks
// PunctuationRuntimeOptions exposes. Replacing the class here lets these
// tests invoke those callbacks directly and assert only the wiring, instead
// of re-standing-up a fake worker/ModelManager/WebGPU chain a different file
// already owns.
vi.mock('../../lib/segmentation/PunctuationRuntime', () => {
  class FakePunctuationRuntime {
    dispose = vi.fn();
    constructor(public opts: PunctuationRuntimeOptions) {}
    get enabled(): boolean {
      return this.opts.isEnabled();
    }
  }
  // A plain `function`, not an arrow: vitest's mock invokes this with `new`
  // when the hook does, and only a real function (never an arrow) can be
  // used as a constructor. It then explicitly returns the fake instance,
  // which JS's `new` substitutes for the implicitly-created `this`.
  const PunctuationRuntime = vi.fn(function (opts: PunctuationRuntimeOptions) {
    return new FakePunctuationRuntime(opts);
  });
  // segmentationStore.ts (imported transitively through useSegmentationStore
  // below) now derives its own model roster from this module's real
  // MODEL_IDS -- mocking the whole module means that lookup needs a value
  // here too, or `Object.keys(MODEL_IDS)` throws on an undefined export.
  const MODEL_IDS = {
    'fireredpunc': 'punct-zh-fireredpunc',
    'edge-punct-en': 'punct-en-edge',
    'sat-3l-sm': 'punct-multi-sat',
  };
  return { PunctuationRuntime, MODEL_IDS };
});

import { PunctuationRuntime } from '../../lib/segmentation/PunctuationRuntime';

const MockedRuntime = PunctuationRuntime as unknown as Mock;

interface FakeRuntimeHandle {
  opts: PunctuationRuntimeOptions;
  dispose: Mock;
  enabled: boolean;
}

/** Reaches through the hook's declared `SegmentationRuntime` return type to
 *  the fake's captured options, so a test can fire the callbacks the hook
 *  wired up exactly as PunctuationRuntime itself would. */
function asFake(runtime: SegmentationRuntime): FakeRuntimeHandle {
  return runtime as unknown as FakeRuntimeHandle;
}

beforeEach(() => {
  MockedRuntime.mockClear();
  useSegmentationStore.getState().resetSession();
  useSettingsStore.setState({ sentenceSegmentation: true });
  // These tests assert what reaches the log store, which records nothing
  // unless diagnostic logs are switched on (off by default in the app).
  useLogStore.getState().setEnabled(true);
});

describe('useSegmentationRuntime', () => {
  it('creates the runtime once and keeps the same instance across re-renders', () => {
    const { result, rerender } = renderHook(() => useSegmentationRuntime());
    const first = result.current;
    expect(MockedRuntime).toHaveBeenCalledTimes(1);

    rerender();
    rerender();

    expect(result.current).toBe(first);
    expect(MockedRuntime).toHaveBeenCalledTimes(1);
  });

  it('follows the enabled setting without rebuilding the runtime', () => {
    const { result } = renderHook(() => useSegmentationRuntime());
    const runtime = result.current!;
    expect(runtime.enabled).toBe(true);

    act(() => { useSettingsStore.setState({ sentenceSegmentation: false }); });

    expect(result.current).toBe(runtime);
    expect(MockedRuntime).toHaveBeenCalledTimes(1);
    expect(runtime.enabled).toBe(false);
  });

  it('forwards a status event to segmentationStore', () => {
    const { result } = renderHook(() => useSegmentationRuntime());
    act(() => { asFake(result.current!).opts.onStatus?.('fireredpunc', 'downloading'); });

    expect(useSegmentationStore.getState().models.fireredpunc.status).toBe('downloading');
  });

  it('forwards a download progress event to segmentationStore', () => {
    const { result } = renderHook(() => useSegmentationRuntime());
    act(() => { asFake(result.current!).opts.onDownloadProgress?.('edge-punct-en', 42); });

    expect(useSegmentationStore.getState().models['edge-punct-en'].percent).toBe(42);
  });

  it('reports a failure once through reportWarning, and not again for an identical second failure', async () => {
    const { result } = renderHook(() => useSegmentationRuntime());
    const opts = asFake(result.current!).opts;

    act(() => { opts.onStatus?.('sat-3l-sm', 'error', 'download failed'); });
    await settleReports();
    expect(useLogStore.getState().logs.filter((l) => l.type === 'warning')).toHaveLength(1);

    // The report throttle (5s per dedupeKey) is what is expected to hide
    // this: the hook itself has no dedup logic of its own, it relies on
    // reportWarning's `dedupeKey`.
    act(() => { opts.onStatus?.('sat-3l-sm', 'error', 'download failed'); });
    await settleReports();
    expect(useLogStore.getState().logs.filter((l) => l.type === 'warning')).toHaveLength(1);
  });

  it('never puts transcript text into a reported message', async () => {
    const { result } = renderHook(() => useSegmentationRuntime());
    const opts = asFake(result.current!).opts;
    const transcriptText = 'the quick brown fox jumps over the lazy dog';

    // onStatus's signature is (model, status, detail?) — there is no
    // parameter for the text being punctuated. Passing it anyway as a 4th
    // argument, as if a future caller mistakenly tried to smuggle it through,
    // demonstrates the reported message is built only from model and detail:
    // JS silently drops an argument with no matching parameter, and the hook
    // never reads a 4th one.
    act(() => {
      (opts.onStatus as unknown as (...args: unknown[]) => void)?.(
        'edge-punct-en', 'error', 'download failed', transcriptText,
      );
    });
    await settleReports();

    const warnings = useLogStore.getState().logs.filter((l) => l.type === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toBe('[Segmentation] edge-punct-en is unavailable: download failed');
    expect(warnings[0].message).not.toContain(transcriptText);
  });

  it('disposes the runtime exactly once on unmount', () => {
    // A real dispose() defect was found in this feature area in the previous
    // slice (disposing mid-bootstrap left a live, never-terminated worker).
    // This test ensures the cleanup runs and runs only once.
    const { result, unmount } = renderHook(() => useSegmentationRuntime());
    const fake = asFake(result.current!);
    const disposeMock = fake.dispose;

    unmount();

    expect(disposeMock).toHaveBeenCalledTimes(1);
  });

  // Fix round: the hook used to construct in the render body behind
  // `if (runtimeRef.current === null)` and dispose in an empty-deps effect
  // cleanup that never nulled the ref. React 19's StrictMode simulates a
  // remount in dev (setup -> cleanup -> setup) while preserving the fiber and
  // its refs, so that cleanup called dispose() once, the second setup did
  // nothing (the ref guard still saw a non-null, now-disposed instance), and
  // every call after that silently returned null forever from
  // PunctuationRuntime.punctuate() -- indistinguishable from "no model
  // available". `renderHook` on its own does not wrap in StrictMode (see the
  // 'disposes exactly once' test above, which would not have caught this),
  // so this needs the wrapper explicitly.
  it('rebuilds a live, non-disposed runtime after a StrictMode remount', () => {
    const { result } = renderHook(() => useSegmentationRuntime(), { wrapper: React.StrictMode });

    // StrictMode's dev-mode double-invoke means two runtimes were built...
    expect(MockedRuntime).toHaveBeenCalledTimes(2);
    const [first, second] = MockedRuntime.mock.results.map((r) => r.value as FakeRuntimeHandle);

    // ...the first was torn down by the simulated remount's own cleanup...
    expect(first.dispose).toHaveBeenCalledTimes(1);

    // ...and what the hook actually hands back is the SECOND, live instance
    // -- not the first, disposed one a ref-based guard would have gotten
    // stuck returning forever. Checking dispose()'s call count alone cannot
    // tell these apart: a permanently-disposed runtime never calls dispose()
    // a second time either -- the bug is entirely in what gets RETURNED.
    expect(result.current).toBe(second);
    expect(second.dispose).not.toHaveBeenCalled();
  });
});
