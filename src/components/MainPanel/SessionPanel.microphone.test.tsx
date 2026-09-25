import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

// SessionPanel.test.tsx's mocks. A file of its own because the page's session
// is one per module graph, and this one is configured to need a microphone.
vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

vi.mock('../../lib/audio/appAudio', () => ({
  getAppAudio: async () => {
    const queue = { position: () => null, pending: 0, subscribe: () => () => {} };
    return {
      playback: {
        queues: { speaker: queue, participant: queue, replay: queue },
        audio() {}, held() {}, clear() {}, live() {}, passthrough() {},
        replay() {}, stopReplay() {}, preview: async () => {}, stopPreview() {},
        ttsTap: { read: () => new Float32Array(0) },
        meter: () => null,
      },
      testTone: async () => {},
    };
  },
}));

vi.mock('../../lib/audio/appCapture', () => ({
  createAppCapture: () => ({
    openSource: async () => { throw new Error('no capture in tests'); },
    echo: { attach: () => () => {}, onNotice: () => {}, setDiagnostics: () => {} },
    levels: {
      speaker: { push() {}, read: () => new Float32Array(32), reset() {} },
      participant: { push() {}, read: () => new Float32Array(32), reset() {} },
    },
  }),
}));

vi.mock('../../lib/segmentation/PunctuationRuntime', () => {
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

const t = vi.hoisted(() => (key: string) => key);
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t }) };
});

vi.mock('../../lib/analytics', () => ({ useAnalytics: () => ({ trackEvent: vi.fn() }) }));

vi.mock('../Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

vi.mock('../../config/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../config/analytics')>()),
  isDevelopment: () => true,
}));

import { configureAppSession, getAppSession } from '../../app/session';
import { createVirtualClock } from '../../lib/contract/clock';
import { fakeProvider } from '../../providers/fake/provider';
import { createFakeSource } from '../../providers/fake/source';
import useAudioStore from '../../stores/audioStore';
import { useProviderStore } from '../../stores/providerStore';
import SessionPanel from './SessionPanel';

const clock = createVirtualClock(0);
// The app's own rule (1e-3 ruling 5): a start needs a chosen microphone.
configureAppSession({
  clock,
  newSessionId: () => 'r1',
  capture: () => async () => createFakeSource(clock),
  microphoneRequired: () => true,
});

beforeAll(async () => {
  await useProviderStore.getState().load(fakeProvider);
  useProviderStore.getState().select('fake');
});

describe('SessionPanel without a microphone', () => {
  it('keeps Start off, in words, and paints the speaker segment amber until a microphone is chosen', async () => {
    useAudioStore.setState({ mode: 'speaker', selectedInputDevice: null });
    const { container } = render(<SessionPanel />);
    // The page's playback loads after the first render.
    await act(() => getAppSession().audio());
    const start = () => container.querySelector('[data-tour="main-action"]') as HTMLButtonElement;
    const speakerSegment = () => container.querySelector('.mode-picker__segment[aria-label="modePicker.modeYou"]') as HTMLButtonElement;

    expect(start().disabled).toBe(true);
    expect(start().title).toBe('notices.no_microphone');
    expect(speakerSegment().classList.contains('mode-picker__segment--warn')).toBe(true);

    act(() => { useAudioStore.setState({ selectedInputDevice: { deviceId: 'mic-1', label: 'Mic' } }); });
    expect(start().disabled).toBe(false);
    expect(start().title).toBe('');
    expect(speakerSegment().classList.contains('mode-picker__segment--warn')).toBe(false);
  });
});
