import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

// The same mocks as useAppSession.test.tsx, for the same reasons.
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
const refetchAll = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../contexts/UserProfileContext', () => ({ useUserProfile: () => ({ refetchAll }) }));

import { ToastProvider } from '../components/Toast';
import { createVirtualClock } from '../lib/contract/clock';
import { fakeProvider } from '../providers/fake/provider';
import { createFakeSource } from '../providers/fake/source';
import { useProviderStore } from '../stores/providerStore';
import { AppSessionRoot } from './AppSessionRoot';
import { configureAppSession, getAppSession } from './session';

// Before any render builds the page's session: the fake source, no microphone needed.
configureAppSession({
  clock: createVirtualClock(0),
  newSessionId: () => 'r1',
  capture: () => async () => createFakeSource(createVirtualClock(0)),
  microphoneRequired: () => false,
  ipc: null,
});

const attach = vi.spyOn(getAppSession(), 'attach');
const renderRoot = () => render(<ToastProvider><AppSessionRoot /></ToastProvider>);

beforeAll(async () => {
  await useProviderStore.getState().load(fakeProvider);
  useProviderStore.getState().select('fake');
});

beforeEach(() => {
  attach.mockClear();
  refetchAll.mockClear();
});

afterAll(() => {
  attach.mockRestore();
});

describe('AppSessionRoot', () => {
  it("attaches the page's session once", () => {
    const { unmount } = renderRoot();
    expect(attach).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("refetches the account's balance once after a run", async () => {
    const { runner } = getAppSession();
    const { unmount } = renderRoot();
    await act(() => runner.start());
    await act(() => runner.stop());
    expect(refetchAll).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('detaches on unmount: a later pagehide leaves a new run running', async () => {
    const { runner } = getAppSession();
    const { unmount } = renderRoot();
    // Attached, a pagehide abandons the run.
    await act(() => runner.start());
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(runner.state.getState().phase).toBe('idle');

    unmount();
    await act(() => runner.start());
    window.dispatchEvent(new Event('pagehide'));
    expect(runner.state.getState().phase).toBe('running');
    await act(() => runner.stop());
  });
});
