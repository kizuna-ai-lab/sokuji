import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExtensionContentScriptSubtitleSurface } from './ExtensionContentScriptSubtitleSurface';

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

  it('port reconnect does not leak Zustand subscriptions', async () => {
    // Regression: meeting-tab reload destroys the iframe, which disconnects
    // the port. The surface intentionally doesn't tearDown on disconnect
    // (the content script re-mounts on subsequent subtitle:enter). But
    // before, installStoreSubscriptions() overwrote `this.subscriptions`
    // without unsubscribing the prior ones, leaving old listeners alive on
    // the Zustand stores. Each store change would then fan out to N copies.
    const { default: useSessionStore } = await import('../../../stores/sessionStore');
    useSessionStore.setState({ items: [], systemAudioItems: [], isSessionActive: false } as any);

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

    // First connect — installs initial subscriptions
    const port1 = makePort();
    handleConnect(port1);
    // Let the lazily-imported installStoreSubscriptions() resolve.
    await new Promise((r) => setTimeout(r, 0));

    // Capture port1's onDisconnect callback before "tab reload" tears it down.
    const port1Disconnect = port1.onDisconnect.addListener.mock.calls[0][0];
    port1Disconnect();

    // Second connect — would previously stack a second set of subscriptions
    const port2 = makePort();
    handleConnect(port2);
    await new Promise((r) => setTimeout(r, 0));

    port2.postMessage.mockClear();

    // Mutate sessionStore.items → exactly ONE 'items' message should reach
    // port2 (was 2 before the fix: one from each generation of subscription).
    useSessionStore.setState({ items: [{ id: 'x' }] } as any);
    await new Promise((r) => setTimeout(r, 0));

    const itemsMessages = port2.postMessage.mock.calls.filter(
      (call: any[]) => call[0]?.type === 'items',
    );
    expect(itemsMessages.length).toBe(1);
  });
});
