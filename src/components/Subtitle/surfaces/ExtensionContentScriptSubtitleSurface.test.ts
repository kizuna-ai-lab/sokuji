import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExtensionContentScriptSubtitleSurface } from './ExtensionContentScriptSubtitleSurface';
import { usePlaybackStore } from '../../../stores/playbackStore';

// Mock SettingsService factory so settingsStore can be imported without
// pulling audio worklet side-effects through ServiceFactory.
vi.mock('../../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: vi.fn(async (_key: string, def: unknown) => def),
      setSetting: vi.fn(async () => ({ success: true })),
    }),
  },
}));

declare const globalThis: any;

// Items forwarding is trailing-throttled (ITEMS_THROTTLE_MS = 120ms in the
// surface). After mutating sessionStore.items, wait past that window for the
// coalesced 'items' message to be posted. state-init is NOT throttled.
const waitThrottle = () => new Promise((r) => setTimeout(r, 160));

describe('ExtensionContentScriptSubtitleSurface', () => {
  let listeners: { onConnect: Function[]; onRemoved: Function[]; onUpdated: Function[]; onMessage: Function[] };
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listeners = { onConnect: [], onRemoved: [], onUpdated: [], onMessage: [] };
    sendMessage = vi.fn(async () => undefined);
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [{ id: 7, url: 'https://meet.google.com/abc' }]),
        sendMessage,
        onRemoved: { addListener: (fn: Function) => listeners.onRemoved.push(fn), removeListener: vi.fn() },
        onUpdated: { addListener: (fn: Function) => listeners.onUpdated.push(fn), removeListener: vi.fn() },
      },
      runtime: {
        onConnect: { addListener: (fn: Function) => listeners.onConnect.push(fn), removeListener: vi.fn() },
      },
    };
  });

  it('enter() sends subtitle:enter to the active meeting tab', async () => {
    const surface = new ExtensionContentScriptSubtitleSurface();
    await surface.enter();
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'subtitle:enter' });
  });

  it('enter() throws when active tab is not a supported site', async () => {
    globalThis.chrome.tabs.query = vi.fn(async () => [{ id: 9, url: 'https://example.com/' }]);
    const surface = new ExtensionContentScriptSubtitleSurface();
    await expect(surface.enter()).rejects.toThrow(/not on supported site/);
  });

  it('enter() throws CONTENT_SCRIPT_UNAVAILABLE when sendMessage fails (stale tab)', async () => {
    // Repro: extension was reloaded while the meeting tab was already open.
    // The content script that ships with the new extension was not injected
    // into the pre-existing tab, so sendMessage cannot reach a receiver.
    // Surface must classify this so the caller can prompt the user to
    // refresh the tab.
    sendMessage.mockImplementationOnce(async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    });
    const surface = new ExtensionContentScriptSubtitleSurface();
    const removeOnConnect = globalThis.chrome.runtime.onConnect.removeListener;
    const removeOnRemoved = globalThis.chrome.tabs.onRemoved.removeListener;
    const removeOnUpdated = globalThis.chrome.tabs.onUpdated.removeListener;
    await expect(surface.enter()).rejects.toMatchObject({
      code: 'CONTENT_SCRIPT_UNAVAILABLE',
    });
    // Listeners that were attached before the failed sendMessage must be
    // cleaned up; otherwise a follow-up enter() that succeeds would
    // double-register them.
    expect(removeOnConnect).toHaveBeenCalledTimes(1);
    expect(removeOnRemoved).toHaveBeenCalledTimes(1);
    expect(removeOnUpdated).toHaveBeenCalledTimes(1);
  });

  it('exit() sends subtitle:exit to the captured tab', async () => {
    const surface = new ExtensionContentScriptSubtitleSurface();
    await surface.enter();
    sendMessage.mockClear();
    await surface.exit();
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'subtitle:exit' });
  });

  it('tabs.onRemoved for the target tab flips subtitleModeActive=false', async () => {
    const { default: useSettingsStore } = await import('../../../stores/settingsStore');
    useSettingsStore.setState({ subtitleModeActive: true });
    const surface = new ExtensionContentScriptSubtitleSurface();
    await surface.enter();
    listeners.onRemoved[0](7);
    expect(useSettingsStore.getState().subtitleModeActive).toBe(false);
  });

  it('port reconnect unsubscribes the prior generation of store subscriptions', async () => {
    // Regression: meeting-tab reload destroys the iframe, which disconnects
    // the port. The surface intentionally doesn't tearDown on disconnect
    // (the content script re-mounts on subsequent subtitle:enter). But
    // before, installStoreSubscriptions() overwrote `this.subscriptions`
    // without unsubscribing the prior ones, leaving old listeners alive on
    // the Zustand stores and accumulating on every reload.
    //
    // We assert the cleanup directly (not via message count): the items
    // forwarding is now trailing-throttled at the instance level, so a leaked
    // duplicate subscription would be coalesced and wouldn't change the number
    // of posted messages — only the count of live store subscriptions.
    const { default: useSessionStore } = await import('../../../stores/sessionStore');
    useSessionStore.setState({ items: [], participantItems: [], isSessionActive: false } as any);

    // Wrap each subscribe's returned unsubscribe in a spy to detect tear-down.
    const realSubscribe = useSessionStore.subscribe.bind(useSessionStore);
    const unsubSpies: ReturnType<typeof vi.fn>[] = [];
    const subSpy = vi
      .spyOn(useSessionStore, 'subscribe')
      .mockImplementation((...args: any[]) => {
        const realUnsub = (realSubscribe as any)(...args);
        const spy = vi.fn(() => realUnsub());
        unsubSpies.push(spy);
        return spy as any;
      });

    try {
      const surface = new ExtensionContentScriptSubtitleSurface();
      await surface.enter();

      const makePort = () => ({
        name: 'sokuji-subtitle',
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
        postMessage: vi.fn(),
        disconnect: vi.fn(),
      });
      const handleConnect = listeners.onConnect[0];

      // Gen 1 — installs the first generation of sessionStore subscriptions.
      const port1 = makePort();
      handleConnect(port1);
      await new Promise((r) => setTimeout(r, 0));
      const gen1Unsubs = unsubSpies.slice();
      expect(gen1Unsubs.length).toBeGreaterThanOrEqual(2); // items + session

      // Tab reload: port1 disconnects, port2 connects → gen2 installs, which
      // must first unsubscribe gen1.
      port1.onDisconnect.addListener.mock.calls[0][0]();
      const port2 = makePort();
      handleConnect(port2);
      await new Promise((r) => setTimeout(r, 0));

      for (const u of gen1Unsubs) expect(u).toHaveBeenCalled();
    } finally {
      subSpy.mockRestore();
    }
  });

  describe('strips heavy replay fields from forwarded items (memory-leak guard)', () => {
    const makePort = () => ({
      name: 'sokuji-subtitle',
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    });

    // An item as the provider clients build it: carries retained PCM audio
    // (formatted.audio / content[].audio) AND a generated WAV blob
    // (formatted.file) for the replay/download feature. The subtitle overlay
    // never reads any of them, yet the surface used to forward them verbatim —
    // formatted.audio grew until a single message blew past Chrome's 64MiB port
    // limit and crashed the app; formatted.file (multi-MB) re-cloned per delta
    // pegged the page. Both must be stripped on the wire.
    const makeAudioItem = (id: string) => ({
      id,
      role: 'assistant',
      type: 'message',
      status: 'completed',
      formatted: {
        transcript: 'hello world',
        audioSegments: [{ textEnd: 5, audioEnd: 1.2 }],
        audioTextEnd: 5,
        audio: new Int16Array(1024).fill(7),
        file: { blob: 'x'.repeat(5000), mimeType: 'audio/wav' },
      },
      content: [{ type: 'audio', transcript: 'hello world', audio: new Int16Array(512) }],
    });

    const expectStripped = (item: any) => {
      expect(item.formatted.audio).toBeUndefined();
      expect(item.formatted.file).toBeUndefined();
      expect(item.content?.[0]?.audio).toBeUndefined();
      // Metadata the overlay actually uses must survive.
      expect(item.formatted.transcript).toBe('hello world');
      expect(item.formatted.audioSegments).toEqual([{ textEnd: 5, audioEnd: 1.2 }]);
    };

    it('state-init payload omits audio + file but keeps text + timing metadata', async () => {
      const { default: useSessionStore } = await import('../../../stores/sessionStore');
      useSessionStore.setState({
        items: [makeAudioItem('a')],
        participantItems: [makeAudioItem('p')],
        isSessionActive: true,
      } as any);

      const surface = new ExtensionContentScriptSubtitleSurface();
      await surface.enter();
      const port = makePort();
      listeners.onConnect[0](port);
      await new Promise((r) => setTimeout(r, 0));

      const init = port.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'state-init',
      );
      expect(init).toBeDefined();
      expectStripped(init![0].payload.items[0]);
      expectStripped(init![0].payload.participantItems[0]);
    });

    it('items message omits audio + file but keeps text + timing metadata', async () => {
      const { default: useSessionStore } = await import('../../../stores/sessionStore');
      useSessionStore.setState({ items: [], participantItems: [], isSessionActive: true } as any);

      const surface = new ExtensionContentScriptSubtitleSurface();
      await surface.enter();
      const port = makePort();
      listeners.onConnect[0](port);
      await new Promise((r) => setTimeout(r, 0));
      port.postMessage.mockClear();

      useSessionStore.setState({ items: [makeAudioItem('b')] } as any);
      await waitThrottle();

      const msg = port.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'items',
      );
      expect(msg).toBeDefined();
      expectStripped(msg![0].items[0]);
    });
  });

  describe('windows forwarded items to the recent tail (perf cap)', () => {
    const makePort = () => ({
      name: 'sokuji-subtitle',
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    });

    const makeItems = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: String(i),
        role: 'user',
        type: 'message',
        status: 'completed',
        formatted: { transcript: `t${i}` },
      }));

    it('state-init forwards only the last 15 items (newest tail)', async () => {
      const { default: useSessionStore } = await import('../../../stores/sessionStore');
      useSessionStore.setState({
        items: makeItems(150),
        participantItems: makeItems(130),
        isSessionActive: true,
      } as any);

      const surface = new ExtensionContentScriptSubtitleSurface();
      await surface.enter();
      const port = makePort();
      listeners.onConnect[0](port);
      await new Promise((r) => setTimeout(r, 0));

      const init = port.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'state-init',
      );
      expect(init).toBeDefined();
      expect(init![0].payload.items).toHaveLength(15);
      expect(init![0].payload.items[0].id).toBe('135'); // 150 items → keep ids 135..149
      expect(init![0].payload.items[14].id).toBe('149');
      expect(init![0].payload.participantItems).toHaveLength(15);
      expect(init![0].payload.participantItems[14].id).toBe('129');
    });

    it('items message forwards only the last 15 items (newest tail)', async () => {
      const { default: useSessionStore } = await import('../../../stores/sessionStore');
      useSessionStore.setState({ items: [], participantItems: [], isSessionActive: true } as any);

      const surface = new ExtensionContentScriptSubtitleSurface();
      await surface.enter();
      const port = makePort();
      listeners.onConnect[0](port);
      await new Promise((r) => setTimeout(r, 0));
      port.postMessage.mockClear();

      useSessionStore.setState({ items: makeItems(150) } as any);
      await waitThrottle();

      const msg = port.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'items',
      );
      expect(msg).toBeDefined();
      expect(msg![0].items).toHaveLength(15);
      expect(msg![0].items[14].id).toBe('149');
    });

    it('forwards the array unchanged when under the cap', async () => {
      const { default: useSessionStore } = await import('../../../stores/sessionStore');
      useSessionStore.setState({ items: makeItems(10), participantItems: [], isSessionActive: true } as any);

      const surface = new ExtensionContentScriptSubtitleSurface();
      await surface.enter();
      const port = makePort();
      listeners.onConnect[0](port);
      await new Promise((r) => setTimeout(r, 0));

      const init = port.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'state-init',
      );
      expect(init![0].payload.items).toHaveLength(10);
      expect(init![0].payload.items[0].id).toBe('0');
    });
  });

  describe('throttles items forwarding (coalesces bursts)', () => {
    const makePort = () => ({
      name: 'sokuji-subtitle',
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    });

    it('collapses a burst of items updates into one trailing message with the latest items', async () => {
      const { default: useSessionStore } = await import('../../../stores/sessionStore');
      useSessionStore.setState({ items: [], participantItems: [], isSessionActive: true } as any);

      const surface = new ExtensionContentScriptSubtitleSurface();
      await surface.enter();
      const port = makePort();
      listeners.onConnect[0](port);
      await new Promise((r) => setTimeout(r, 0));
      port.postMessage.mockClear();

      // Three rapid updates inside the throttle window (mimics streaming deltas).
      useSessionStore.setState({ items: [{ id: 'a' }] } as any);
      useSessionStore.setState({ items: [{ id: 'a' }, { id: 'b' }] } as any);
      useSessionStore.setState({ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } as any);

      // Synchronously, before the window elapses: nothing posted yet.
      expect(port.postMessage.mock.calls.filter((c: any[]) => c[0]?.type === 'items')).toHaveLength(0);

      await waitThrottle();

      const itemsMsgs = port.postMessage.mock.calls.filter((c: any[]) => c[0]?.type === 'items');
      expect(itemsMsgs).toHaveLength(1); // coalesced
      expect(itemsMsgs[0][0].items.map((i: any) => i.id)).toEqual(['a', 'b', 'c']); // latest snapshot
    });

    it('reconnect cancels a pending throttle timer (no stale post to the new port)', async () => {
      // A throttle timer scheduled by the prior port's subscription must not
      // fire after a reconnect and post a stale pendingItems snapshot to the
      // new port. installStoreSubscriptions must reset the throttle state, the
      // same way tearDown does.
      const { default: useSessionStore } = await import('../../../stores/sessionStore');
      useSessionStore.setState({ items: [], participantItems: [], isSessionActive: true } as any);

      const surface = new ExtensionContentScriptSubtitleSurface();
      await surface.enter();
      const handleConnect = listeners.onConnect[0];

      // Gen 1 connects.
      const port1 = makePort();
      handleConnect(port1);
      await new Promise((r) => setTimeout(r, 0));

      // Items change → schedules a throttle timer holding this snapshot. Do NOT
      // wait for it to fire.
      useSessionStore.setState({ items: [{ id: 'stale' }] } as any);

      // Tab reload: port1 disconnects, port2 connects → gen2 installs.
      port1.onDisconnect.addListener.mock.calls[0][0]();
      const port2 = makePort();
      handleConnect(port2);
      await new Promise((r) => setTimeout(r, 0));
      port2.postMessage.mockClear();

      // Past the throttle window: the carried-over gen1 timer must not post.
      await waitThrottle();
      const itemsMsgs = port2.postMessage.mock.calls.filter((c: any[]) => c[0]?.type === 'items');
      expect(itemsMsgs).toHaveLength(0);
    });
  });

  describe('playback forwarding', () => {
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
    });

    const makePort = () => ({
      name: 'sokuji-subtitle',
      onMessage: { addListener: vi.fn() },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    });

    it('state-init carries playback=null when nothing is playing', async () => {
      const surface = new ExtensionContentScriptSubtitleSurface();
      await surface.enter();
      const port = makePort();
      listeners.onConnect[0](port);
      // Drain the lazy import + initial state-init push.
      await new Promise((r) => setTimeout(r, 0));

      const init = port.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'state-init',
      );
      expect(init).toBeDefined();
      expect(init![0].payload.playback).toBeNull();
    });

    it('state-init carries playback snapshot when item is playing', async () => {
      usePlaybackStore.getState().setPlayingItem('item_a');
      usePlaybackStore.getState().setProgress({ currentTime: 1.234, duration: 5, bufferedTime: 4 });

      const surface = new ExtensionContentScriptSubtitleSurface();
      await surface.enter();
      const port = makePort();
      listeners.onConnect[0](port);
      await new Promise((r) => setTimeout(r, 0));

      const init = port.postMessage.mock.calls.find(
        (call: any[]) => call[0]?.type === 'state-init',
      );
      expect(init![0].payload.playback).toEqual({ i: 'item_a', c: 1.234, d: 5, b: 4 });
    });

    it('forwards playback changes as typed messages', async () => {
      const surface = new ExtensionContentScriptSubtitleSurface();
      await surface.enter();
      const port = makePort();
      listeners.onConnect[0](port);
      await new Promise((r) => setTimeout(r, 0));
      port.postMessage.mockClear();

      usePlaybackStore.getState().setPlayingItem('item_a');
      await new Promise((r) => setTimeout(r, 0));
      expect(port.postMessage.mock.calls).toContainEqual([
        { type: 'playback', i: 'item_a', c: null },
      ]);

      usePlaybackStore.getState().setProgress({ currentTime: 1.0, duration: 5.0, bufferedTime: 4.0 });
      await new Promise((r) => setTimeout(r, 0));
      expect(port.postMessage.mock.calls).toContainEqual([
        { type: 'playback', i: 'item_a', c: 1, d: 5, b: 4 },
      ]);
    });

    it('dedupes round-equal raw values', async () => {
      const surface = new ExtensionContentScriptSubtitleSurface();
      await surface.enter();
      const port = makePort();
      listeners.onConnect[0](port);
      await new Promise((r) => setTimeout(r, 0));

      usePlaybackStore.getState().setPlayingItem('item_a');
      usePlaybackStore.getState().setProgress({ currentTime: 1.2345, duration: 5, bufferedTime: 4 });
      await new Promise((r) => setTimeout(r, 0));
      port.postMessage.mockClear();

      usePlaybackStore.getState().setProgress({ currentTime: 1.2347, duration: 5, bufferedTime: 4 });
      await new Promise((r) => setTimeout(r, 0));

      const playbackMsgs = port.postMessage.mock.calls.filter(
        (c: any[]) => c[0]?.type === 'playback',
      );
      expect(playbackMsgs.length).toBe(0);
    });
  });
});
