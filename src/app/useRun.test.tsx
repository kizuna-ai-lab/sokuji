import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// The same five mocks as session.test.ts, for the same reasons.
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));
vi.mock('../lib/audio/appAudio', () => ({
  getAppAudio: vi.fn(async () => {
    const queue = { position: () => null, pending: 0, subscribe: () => () => {} };
    return {
      playback: {
        queues: { speaker: queue, participant: queue, replay: queue },
        audio: vi.fn(), held: vi.fn(), clear: vi.fn(), live: vi.fn(), passthrough: vi.fn(),
        ttsTap: { read: () => new Float32Array(0) },
        meter: vi.fn(() => null),
      },
      testTone: async () => {},
    };
  }),
}));
vi.mock('../lib/audio/appCapture', () => ({
  createAppCapture: () => ({
    openSource: async () => { throw new Error('no capture in tests'); },
    echo: { attach: () => () => {}, onNotice: () => {}, setDiagnostics: () => {} },
    levels: {
      speaker: { push() {}, read: () => new Float32Array(32), reset() {} },
      participant: { push() {}, read: () => new Float32Array(32), reset() {} },
    },
  }),
}));
vi.mock('../lib/segmentation/PunctuationRuntime', () => {
  class FakePunctuationRuntime {
    dispose = vi.fn();
    punctuate = vi.fn(async () => null);
    constructor(public opts: { isEnabled(): boolean }) {}
    get enabled(): boolean {
      return this.opts.isEnabled();
    }
  }
  const PunctuationRuntime = vi.fn(function (opts: { isEnabled(): boolean }) {
    return new FakePunctuationRuntime(opts);
  });
  const MODEL_IDS = {
    'fireredpunc': 'punct-zh-fireredpunc',
    'edge-punct-en': 'punct-en-edge',
    'sat-3l-sm': 'punct-multi-sat',
  };
  return { PunctuationRuntime, MODEL_IDS };
});
vi.mock('../lib/export/appAutoSave', () => ({
  autoSaveConversation: vi.fn(async () => 'saved'),
}));

import { createVirtualClock } from '../lib/contract/clock';
import { fakeProvider } from '../providers/fake/provider';
import { createFakeSource } from '../providers/fake/source';
import { useProviderStore } from '../stores/providerStore';
import { configureAppSession, getAppSession } from './session';
import { useSessionLocked } from './useRun';

const clock = createVirtualClock(0);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Before any render builds the page's session: the fake source, no microphone needed.
configureAppSession({
  clock,
  newSessionId: () => 'r1',
  capture: () => async () => createFakeSource(clock),
  microphoneRequired: () => false,
});

beforeAll(async () => {
  await useProviderStore.getState().load(fakeProvider);
  useProviderStore.getState().select('fake');
  // A start that waits on the clock, so `starting` can be seen.
  useProviderStore.getState().updateSettings(fakeProvider, { startDelayMs: 500 });
});

describe('useSessionLocked', () => {
  it('locks from the start leaving idle until the run is idle again (1e-3 ruling 9)', async () => {
    const { runner } = getAppSession();
    const { result } = renderHook(() => useSessionLocked());
    expect(result.current).toBe(false);

    let starting!: Promise<void>;
    act(() => { starting = runner.start(); });
    expect(runner.state.getState().phase).toBe('starting');
    expect(result.current).toBe(true);

    await act(async () => {
      await flush();
      clock.advance(500);
      await starting;
    });
    expect(runner.state.getState().phase).toBe('running');
    expect(result.current).toBe(true);

    let stopping!: Promise<void>;
    act(() => { stopping = runner.stop(); });
    expect(runner.state.getState().phase).toBe('stopping');
    expect(result.current).toBe(true);

    await act(async () => { await stopping; });
    expect(runner.state.getState().phase).toBe('idle');
    expect(result.current).toBe(false);
  });
});
