import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installSessionPortMirror } from './sessionPortMirror';
import useSessionStore from './sessionStore';
import useSettingsStore from './settingsStore';
import { usePlaybackStore } from './playbackStore';

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

  it('on config message, writes to the camelCase store key for providers whose enum value is snake_case', () => {
    // Regression: Provider enum values like 'local_inference' /
    // 'openai_translate' / 'volcengine_st' don't match their camelCase
    // store keys (localInference / openaiTranslate / volcengineST). The
    // earlier message handler used `s[provider]` directly, writing to a
    // garbage key while the real key kept its hardcoded defaults — so
    // SubtitleApp's `getCurrentProviderSettings()` returned the unchanged
    // defaults (local_inference → JA → EN, exactly the reported symptom).
    installSessionPortMirror();
    const onMessage = connectedPort.onMessage.addListener.mock.calls[0][0];
    onMessage({
      type: 'config',
      provider: 'local_inference',
      sourceLanguage: 'fr',
      targetLanguage: 'de',
    });
    const state = useSettingsStore.getState();
    expect(state.provider).toBe('local_inference');
    // The contract that matters: getCurrentProviderSettings (the same
    // resolver SubtitleApp uses) must observe the new languages.
    const ps = state.getCurrentProviderSettings() as any;
    expect(ps?.sourceLanguage).toBe('fr');
    expect(ps?.targetLanguage).toBe('de');
  });
});

describe('sessionPortMirror — playback inbound', () => {
  let connectedPort: any;

  beforeEach(() => {
    usePlaybackStore.setState({
      playingItemId: null,
      currentTime: null,
      progressRatio: 0,
      _cumOffset: 0,
      _lastBt: 0,
      _lastCt: 0,
      _maxProgress: 0,
      _raw: null,
    });
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
      runtime: { connect: vi.fn(() => connectedPort) },
    };
  });

  it('applies playback message with full c/d/b', () => {
    installSessionPortMirror();
    const onMessage = connectedPort.onMessage.addListener.mock.calls[0][0];
    onMessage({ type: 'playback', i: 'item_a', c: 1.0, d: 5.0, b: 4.0 });
    const s = usePlaybackStore.getState();
    expect(s.playingItemId).toBe('item_a');
    expect(s.currentTime).toBe(1.0);
    expect(s._raw).toEqual({ currentTime: 1.0, duration: 5.0, bufferedTime: 4.0 });
  });

  it('applies playback message with c:null (pause) preserving derived', () => {
    installSessionPortMirror();
    const onMessage = connectedPort.onMessage.addListener.mock.calls[0][0];
    onMessage({ type: 'playback', i: 'item_a', c: 1.0, d: 5.0, b: 4.0 });
    onMessage({ type: 'playback', i: 'item_a', c: null });
    const s = usePlaybackStore.getState();
    expect(s.playingItemId).toBe('item_a');
    expect(s.currentTime).toBe(1.0);
    expect(s._raw).toBeNull();
  });

  it('applies playback message with i:null (clear)', () => {
    installSessionPortMirror();
    const onMessage = connectedPort.onMessage.addListener.mock.calls[0][0];
    onMessage({ type: 'playback', i: 'item_a', c: 1.0, d: 5.0, b: 4.0 });
    onMessage({ type: 'playback', i: null });
    const s = usePlaybackStore.getState();
    expect(s.playingItemId).toBeNull();
    expect(s.currentTime).toBeNull();
  });

  it('state-init.payload.playback populates the store on connect', () => {
    installSessionPortMirror();
    const onMessage = connectedPort.onMessage.addListener.mock.calls[0][0];
    onMessage({
      type: 'state-init',
      payload: { items: [], playback: { i: 'item_a', c: 0.5, d: 5, b: 4 } },
    });
    const s = usePlaybackStore.getState();
    expect(s.playingItemId).toBe('item_a');
    expect(s.currentTime).toBe(0.5);
  });

  it('state-init without playback leaves the playback store at defaults', () => {
    installSessionPortMirror();
    const onMessage = connectedPort.onMessage.addListener.mock.calls[0][0];
    onMessage({ type: 'state-init', payload: { items: [] } });
    expect(usePlaybackStore.getState().playingItemId).toBeNull();
  });

  it('state-init with explicit playback:null clears stale playback state', () => {
    // Simulates port reconnect: the iframe already had a prior playingItemId
    // from a previous connection; the new state-init says the sidepanel is
    // now idle. The mirror must clear, not silently leave stale state.
    usePlaybackStore.getState().setPlayingItem('item_prior');
    usePlaybackStore.getState().setProgress({
      currentTime: 1.0,
      duration: 5.0,
      bufferedTime: 4.0,
    });
    expect(usePlaybackStore.getState().playingItemId).toBe('item_prior');

    installSessionPortMirror();
    const onMessage = connectedPort.onMessage.addListener.mock.calls[0][0];
    onMessage({ type: 'state-init', payload: { items: [], playback: null } });
    const s = usePlaybackStore.getState();
    expect(s.playingItemId).toBeNull();
    expect(s.currentTime).toBeNull();
  });
});
