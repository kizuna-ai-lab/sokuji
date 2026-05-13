import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installSessionPortMirror } from './sessionPortMirror';
import useSessionStore from './sessionStore';
import useSettingsStore from './settingsStore';

// Mock SettingsService factory so settingsStore can be imported without
// pulling audio worklet side-effects through ServiceFactory.
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: vi.fn(async (_key: string, def: unknown) => def),
      setSetting: vi.fn(async () => ({ success: true })),
    }),
  },
}));

declare const globalThis: any;

describe('sessionPortMirror', () => {
  let connectedPort: any;

  beforeEach(() => {
    // Reset session store to known baseline before each test.
    useSessionStore.setState({
      items: [],
      systemAudioItems: [],
      isSessionActive: false,
      sessionStartTime: null,
    } as any);

    connectedPort = {
      name: 'sokuji-subtitle',
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    };
    globalThis.chrome = {
      runtime: {
        connect: vi.fn(() => connectedPort),
      },
    };
  });

  it('opens a port named sokuji-subtitle', () => {
    installSessionPortMirror();
    expect(globalThis.chrome.runtime.connect).toHaveBeenCalledWith({ name: 'sokuji-subtitle' });
  });

  it('on state-init message, populates sessionStore via setState', () => {
    installSessionPortMirror();
    const onMessage = connectedPort.onMessage.addListener.mock.calls[0][0];
    onMessage({
      type: 'state-init',
      payload: { items: [{ id: '1', text: 'hi' }], isSessionActive: true },
    });
    expect(useSessionStore.getState().items[0].id).toBe('1');
    expect(useSessionStore.getState().isSessionActive).toBe(true);
  });

  it('requestClearConversation wrapper posts subtitle:request-clear', () => {
    installSessionPortMirror();
    useSessionStore.getState().requestClearConversation();
    expect(connectedPort.postMessage).toHaveBeenCalledWith({ type: 'subtitle:request-clear' });
  });

  it('on config message, populates settingsStore.provider + language pair fields', () => {
    installSessionPortMirror();
    const onMessage = connectedPort.onMessage.addListener.mock.calls[0][0];
    onMessage({
      type: 'config',
      provider: 'gemini',
      sourceLanguage: 'ja',
      targetLanguage: 'en',
      turnDetectionMode: 'Auto',
    });
    const state = useSettingsStore.getState();
    expect(state.provider).toBe('gemini');
    const geminiSettings = (state as any).gemini;
    expect(geminiSettings?.sourceLanguage).toBe('ja');
    expect(geminiSettings?.targetLanguage).toBe('en');
    expect(geminiSettings?.turnDetectionMode).toBe('Auto');
  });

  it('on state-init with provider/languages, populates settingsStore', () => {
    installSessionPortMirror();
    const onMessage = connectedPort.onMessage.addListener.mock.calls[0][0];
    onMessage({
      type: 'state-init',
      payload: {
        items: [],
        provider: 'gemini',
        sourceLanguage: 'fr',
        targetLanguage: 'de',
      },
    });
    const state = useSettingsStore.getState();
    expect(state.provider).toBe('gemini');
    const geminiSettings = (state as any).gemini;
    expect(geminiSettings?.sourceLanguage).toBe('fr');
    expect(geminiSettings?.targetLanguage).toBe('de');
  });
});
