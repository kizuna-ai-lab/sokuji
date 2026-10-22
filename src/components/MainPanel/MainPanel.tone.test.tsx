import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

// MainPanel.microphone.test.tsx's harness, copied: the page's session
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
import MainPanel from './MainPanel';

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
import { useConversationDisplayStore } from '../../stores/conversationDisplayStore';

// The app's scheme, as the conversation sees it. The hook's own wiring to
// installTheme is useScheme.test.tsx's; here it is a value to flip.
const scheme = vi.hoisted(() => ({ current: 'dark' as 'dark' | 'light' }));
vi.mock('../../lib/theme/useScheme', () => ({ useScheme: () => scheme.current }));

// A user-coloured surface carries the tone of its own background (spec
// 2026-10-22 §3): the conversation keeps the user's colours in both app
// themes, so its palette follows them, not the theme.
describe('MainPanel passes the tone of the conversation background', () => {
  it('a white background makes the conversation a light surface; the dark default keeps it dark', async () => {
    useAudioStore.setState({ mode: 'speaker', selectedInputDevice: { deviceId: 'mic-1', label: 'Mic' } });
    act(() => { useConversationDisplayStore.setState({ bgColor: '#FFFFFF' }); });
    const { container } = render(<MainPanel />);
    await act(() => getAppSession().audio());
    const tone = () => container.querySelector('.conversation-display')?.getAttribute('data-tone');
    expect(tone()).toBe('light');
    act(() => { useConversationDisplayStore.setState({ bgColor: '#1f1f1f' }); });
    expect(tone()).toBe('dark');
  });
});

// A colour the user never set follows the scheme (spec §3, R3 as amended
// 2026-10-22): white in the light app, today's dark in the dark one. A colour
// the user did set stays, whichever the scheme.
describe('MainPanel resolves an unset conversation colour from the scheme', () => {
  it('nothing stored: dark colours under the dark scheme, the white set under the light one', async () => {
    useAudioStore.setState({ mode: 'speaker', selectedInputDevice: { deviceId: 'mic-1', label: 'Mic' } });
    scheme.current = 'dark';
    act(() => { useConversationDisplayStore.setState({ bgColor: null, sourceTextColor: null, translationTextColor: null }); });
    const { container, rerender } = render(<MainPanel />);
    await act(() => getAppSession().audio());
    const wrapper = () => container.querySelector('.main-panel-wrapper') as HTMLElement;
    const tone = () => container.querySelector('.conversation-display')?.getAttribute('data-tone');
    expect(wrapper().style.getPropertyValue('--conversation-bg-color')).toBe('#1f1f1f');
    expect(wrapper().style.getPropertyValue('--conversation-source-color')).toBe('#9aa0a6');
    expect(wrapper().style.getPropertyValue('--conversation-translation-color')).toBe('#e8e8e8');
    expect(tone()).toBe('dark');

    scheme.current = 'light';
    rerender(<MainPanel />);
    expect(wrapper().style.getPropertyValue('--conversation-bg-color')).toBe('#ffffff');
    expect(wrapper().style.getPropertyValue('--conversation-source-color')).toBe('#5f6368');
    expect(wrapper().style.getPropertyValue('--conversation-translation-color')).toBe('#1a1a1a');
    expect(tone()).toBe('light');
    scheme.current = 'dark';
  });

  // A stored background stays under either scheme, and the text the user
  // never set follows that background's tone: light text on a stored dark
  // background in the light app, never dark on dark.
  it('a stored colour stays under either scheme, and unset text follows its tone', async () => {
    useAudioStore.setState({ mode: 'speaker', selectedInputDevice: { deviceId: 'mic-1', label: 'Mic' } });
    scheme.current = 'light';
    act(() => { useConversationDisplayStore.setState({ bgColor: '#1f1f1f', sourceTextColor: null, translationTextColor: null }); });
    const { container } = render(<MainPanel />);
    await act(() => getAppSession().audio());
    const wrapper = container.querySelector('.main-panel-wrapper') as HTMLElement;
    expect(wrapper.style.getPropertyValue('--conversation-bg-color')).toBe('#1f1f1f');
    expect(wrapper.style.getPropertyValue('--conversation-source-color')).toBe('#9aa0a6');
    expect(wrapper.style.getPropertyValue('--conversation-translation-color')).toBe('#e8e8e8');
    expect(container.querySelector('.conversation-display')?.getAttribute('data-tone')).toBe('dark');
    scheme.current = 'dark';
  });
});
