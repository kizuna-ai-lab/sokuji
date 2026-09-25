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

const trackEvent = vi.hoisted(() => vi.fn());
vi.mock('../lib/analytics', () => ({
  useAnalytics: () => ({ trackEvent }),
}));
vi.mock('../lib/auth/hooks', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: async () => 't' }),
}));

import { ToastProvider } from '../components/Toast';
import { createVirtualClock } from '../lib/contract/clock';
import { fakeProvider } from '../providers/fake/provider';
import { createFakeSource } from '../providers/fake/source';
import { useProviderStore } from '../stores/providerStore';
import { configureAppSession, getAppSession } from './session';
import { useAppSessionBridges, useRunPhase, useRunState } from './useAppSession';

// Before any render builds the page's session: the fake source, no microphone needed.
configureAppSession({
  clock: createVirtualClock(0),
  newSessionId: () => 'r1',
  capture: () => async () => createFakeSource(createVirtualClock(0)),
  microphoneRequired: () => false,
});

beforeAll(async () => {
  await useProviderStore.getState().load(fakeProvider);
  useProviderStore.getState().select('fake');
});

describe('useRunPhase', () => {
  it("follows the page's runner through a run", async () => {
    const { result } = renderHook(() => useRunPhase());
    expect(result.current).toBe('idle');
    await act(() => getAppSession().runner.start());
    expect(result.current).toBe('running');
    await act(() => getAppSession().runner.stop());
    expect(result.current).toBe('idle');
  });
});

describe('useRunState', () => {
  it("is the runner's whole state", async () => {
    const { result } = renderHook(() => useRunState());
    await act(() => getAppSession().runner.start());
    expect(result.current).toMatchObject({ phase: 'running', since: expect.any(Number) });
    await act(() => getAppSession().runner.stop());
  });
});

describe('useAppSessionBridges', () => {
  it("hands the session the page's sign-in, analytics and balance refetch", async () => {
    const refetch = vi.fn(async () => {});
    const { result } = renderHook(() => useAppSessionBridges(refetch), { wrapper: ToastProvider });
    expect(result.current.signedIn).toBe(true);
    trackEvent.mockClear();
    await act(() => getAppSession().runner.start());
    expect(trackEvent).toHaveBeenCalledWith('translation_session_start', expect.objectContaining({ session_id: 'r1' }));
    await act(() => getAppSession().runner.stop());
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
