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
});
