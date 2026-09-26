import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { PunctuationRuntimeOptions } from '../lib/segmentation/PunctuationRuntime';
import type { Punctuator } from '../lib/contract/adapter';
import type { PunctuationResult } from '../lib/segmentation/SegmentationRuntime';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useSettingsStore } from '../stores/settingsStore';
import useLogStore from '../stores/logStore';
import { settleReports } from '../lib/diagnostics/report';

// Kept from before the old audio service was deleted: ServiceFactory used to
// import ModernBrowserAudioService -> ModernAudioRecorder -> a worklet
// `?url` import that this sandboxed Vite test transform denied outright.
// ServiceFactory no longer reaches ModernAudioRecorder at all, and this
// module (punctuation.ts) never imports session.ts/appCapture either, so no
// worklet `?url` import is reachable here any more. Not needed by the
// current graph for that reason. This module only ever reads the plain
// setting value, never persistence.
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, fallback: unknown) => fallback,
      setSetting: async () => undefined,
    }),
  },
}));

// Exactly as useSegmentationRuntime.test.ts mocks it: the runtime's own state
// machine (downloads, worker lifecycle, retries) is exercised end-to-end in
// PunctuationRuntime.test.ts. This module's job is wiring -- isEnabled, the
// three diagnostics callbacks, and the memo around punctuate() -- so the fake
// lets these tests invoke the captured options directly.
vi.mock('../lib/segmentation/PunctuationRuntime', () => {
  class FakePunctuationRuntime {
    dispose = vi.fn();
    punctuate = vi.fn(async () => null);
    constructor(public opts: PunctuationRuntimeOptions) {}
    get enabled(): boolean {
      return this.opts.isEnabled();
    }
  }
  // A plain `function`, not an arrow: vitest's mock invokes this with `new`
  // when the module under test does, and only a real function (never an
  // arrow) can be used as a constructor. It then explicitly returns the fake
  // instance, which JS's `new` substitutes for the implicitly-created `this`.
  const PunctuationRuntime = vi.fn(function (opts: PunctuationRuntimeOptions) {
    return new FakePunctuationRuntime(opts);
  });
  // segmentationStore.ts (imported transitively through useSegmentationStore
  // below) derives its own model roster from this module's real MODEL_IDS --
  // mocking the whole module means that lookup needs a value here too.
  const MODEL_IDS = {
    'fireredpunc': 'punct-zh-fireredpunc',
    'edge-punct-en': 'punct-en-edge',
    'sat-3l-sm': 'punct-multi-sat',
  };
  return { PunctuationRuntime, MODEL_IDS };
});

import { PunctuationRuntime } from '../lib/segmentation/PunctuationRuntime';
import {
  createAppPunctuation,
  memoizePunctuator,
  punctuationDiagnostics,
  type TrackModelLoad,
} from './punctuation';

const MockedRuntime = PunctuationRuntime as unknown as Mock;

interface FakeRuntimeHandle {
  opts: PunctuationRuntimeOptions;
  dispose: Mock;
  punctuate: Mock;
  enabled: boolean;
}

/** Reaches through `AppPunctuation.runtime`'s declared type to the fake's
 *  captured options, so a test can fire the callbacks exactly as
 *  PunctuationRuntime itself would, and drive its stubbed `punctuate()`. */
function asFake(runtime: unknown): FakeRuntimeHandle {
  return runtime as unknown as FakeRuntimeHandle;
}

beforeEach(() => {
  MockedRuntime.mockClear();
  // 'ready' + 'sentences' is the interesting default: every test but the
  // combination test below wants a runtime that is on.
  useSegmentationStore.setState({ phase: 'ready', downloadedBytes: 0, error: null });
  useSettingsStore.setState({ segmentationMode: 'sentences' });
  // These tests assert what reaches the log store, which records nothing
  // unless diagnostic logs are switched on (off by default in the app).
  useLogStore.getState().setEnabled(true);
  useLogStore.getState().clearLogs();
});

describe('memoizePunctuator', () => {
  it('answers two asks of the same (base language, text) with one model call', async () => {
    const ask: Mock<Punctuator> = vi.fn(async () => 'answer');
    const onMiss = vi.fn();
    const punctuate = memoizePunctuator(ask, onMiss);

    const first = punctuate('en', 'hello there');
    const second = punctuate('en', 'hello there');

    expect(await first).toBe('answer');
    expect(await second).toBe('answer');
    expect(ask).toHaveBeenCalledTimes(1);
    expect(onMiss).toHaveBeenCalledTimes(1);
  });

  it('treats a different regional tag of the same base language as the same question', async () => {
    const ask: Mock<Punctuator> = vi.fn(async () => 'answer');
    const punctuate = memoizePunctuator(ask);

    await punctuate('en', 'hello there');
    await punctuate('en-US', 'hello there');

    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('asks again for a different text', async () => {
    const ask: Mock<Punctuator> = vi.fn(async () => 'answer');
    const punctuate = memoizePunctuator(ask);

    await punctuate('en', 'hello there');
    await punctuate('en', 'something else');

    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('does not keep a null answer, so a later ask tries again', async () => {
    const ask: Mock<Punctuator> = vi.fn(async () => null);
    const punctuate = memoizePunctuator(ask);

    expect(await punctuate('en', 'hello there')).toBeNull();
    expect(await punctuate('en', 'hello there')).toBeNull();

    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('does not keep a rejected ask either, and answers it as null', async () => {
    const ask: Mock<Punctuator> = vi.fn(async () => { throw new Error('boom'); });
    const punctuate = memoizePunctuator(ask);

    await expect(punctuate('en', 'hello there')).resolves.toBeNull();
    await expect(punctuate('en', 'hello there')).resolves.toBeNull();

    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('keeps only the last `size` questions asked', async () => {
    const ask: Mock<Punctuator> = vi.fn(async (_lang: string, text: string) => `${text}!`);
    const punctuate = memoizePunctuator(ask, undefined, 2);

    await punctuate('en', 'a');
    await punctuate('en', 'b');
    await punctuate('en', 'c');
    expect(ask).toHaveBeenCalledTimes(3);

    // 'a' was evicted when 'c' came in (size 2).
    await punctuate('en', 'a');
    expect(ask).toHaveBeenCalledTimes(4);

    // 'c' survived that eviction, so it is still a hit.
    await punctuate('en', 'c');
    expect(ask).toHaveBeenCalledTimes(4);
  });
});

describe('createAppPunctuation', () => {
  const noTrack = () => undefined as TrackModelLoad | undefined;

  it("captures isEnabled() as true only when the mode is 'sentences' and the pack is 'ready'", () => {
    const combos: Array<['off' | 'sentences', 'missing' | 'ready', boolean]> = [
      ['sentences', 'ready', true],
      ['sentences', 'missing', false],
      ['off', 'ready', false],
      ['off', 'missing', false],
    ];
    for (const [segmentationMode, phase, expected] of combos) {
      useSettingsStore.setState({ segmentationMode });
      useSegmentationStore.setState({ phase });
      const app = createAppPunctuation({ track: noTrack });
      expect(asFake(app.runtime).opts.isEnabled()).toBe(expected);
    }
  });

  it("ready() answers the runtime's enabled, and lastReady remembers the last answer", () => {
    // Default beforeEach state ('sentences' + 'ready') makes the runtime on.
    const app = createAppPunctuation({ track: noTrack });
    expect(app.lastReady).toBe(false);

    expect(app.ready()).toBe(true);
    expect(app.lastReady).toBe(true);

    useSettingsStore.setState({ segmentationMode: 'off' });
    expect(app.ready()).toBe(false);
    expect(app.lastReady).toBe(false);
  });

  it("maps the runtime's result to its text", async () => {
    const app = createAppPunctuation({ track: noTrack });
    asFake(app.runtime).punctuate.mockResolvedValueOnce({ text: 'A b.' } as PunctuationResult);

    expect(await app.punctuate('en', 'a b')).toBe('A b.');
  });

  it("maps the runtime's null to null", async () => {
    const app = createAppPunctuation({ track: noTrack });
    asFake(app.runtime).punctuate.mockResolvedValueOnce(null);

    expect(await app.punctuate('en', 'a b')).toBeNull();
  });

  it('counts a model call through onModelCall on a genuine miss', async () => {
    const onModelCall = vi.fn();
    const app = createAppPunctuation({ track: noTrack, onModelCall });
    asFake(app.runtime).punctuate.mockResolvedValue({ text: 'A b.' } as PunctuationResult);

    await app.punctuate('en', 'a b');
    await app.punctuate('en', 'a b');

    expect(onModelCall).toHaveBeenCalledTimes(1);
    expect(asFake(app.runtime).punctuate).toHaveBeenCalledTimes(1);
  });
});

// Asserted the way useSegmentationRuntime.test.ts asserts the hook's own
// wiring: settleReports(), then the log store, with diagnostic logs on.
describe('punctuationDiagnostics', () => {
  it('reports each model load, with its backend and how long it took', async () => {
    const track = vi.fn();
    const diagnostics = punctuationDiagnostics(() => track);

    diagnostics.onLoaded('fireredpunc', 'wasm', 1234.6);

    expect(track).toHaveBeenCalledWith('segmentation_model_load', {
      model: 'fireredpunc',
      backend: 'wasm',
      load_ms: 1235,
      result: 'ok',
    });
  });

  it('puts each model load on the exportable diagnostic log', async () => {
    const diagnostics = punctuationDiagnostics(() => undefined);

    diagnostics.onLoaded('fireredpunc', 'wasm', 1234.6);

    const events = useLogStore.getState().allLogs
      .flatMap((l) => l.events ?? [])
      .filter((e) => e.type === 'segmentation.model.loaded');
    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({ model: 'fireredpunc', backend: 'wasm', load_ms: 1235 });
  });

  it('loads a model perfectly well with nobody tracking', () => {
    const diagnostics = punctuationDiagnostics(() => undefined);
    expect(() => diagnostics.onLoaded('fireredpunc', 'webgpu', 10)).not.toThrow();
  });

  it('reports one warning when a model answer does not match its input', async () => {
    const diagnostics = punctuationDiagnostics(() => undefined);

    diagnostics.onInference('sat-3l-sm', { ms: 10, ends: 1, breaks: 1, skeletonOk: false });
    await settleReports();

    expect(useLogStore.getState().logs.filter((l) => l.type === 'warning')).toHaveLength(1);
  });

  it('reports one warning for a disabled model and one for an unavailable model', async () => {
    const diagnostics = punctuationDiagnostics(() => undefined);

    diagnostics.onStatus('sat-3l-sm', 'disabled', 'slow');
    await settleReports();
    expect(useLogStore.getState().logs.filter((l) => l.type === 'warning')).toHaveLength(1);

    diagnostics.onStatus('sat-3l-sm', 'error', 'gone');
    await settleReports();
    expect(useLogStore.getState().logs.filter((l) => l.type === 'warning')).toHaveLength(2);
  });

  it('does not report a second, identical error again (the dedupe key)', async () => {
    const diagnostics = punctuationDiagnostics(() => undefined);

    diagnostics.onStatus('sat-3l-sm', 'error', 'gone');
    await settleReports();
    expect(useLogStore.getState().logs.filter((l) => l.type === 'warning')).toHaveLength(1);

    diagnostics.onStatus('sat-3l-sm', 'error', 'gone');
    await settleReports();
    expect(useLogStore.getState().logs.filter((l) => l.type === 'warning')).toHaveLength(1);
  });
});
