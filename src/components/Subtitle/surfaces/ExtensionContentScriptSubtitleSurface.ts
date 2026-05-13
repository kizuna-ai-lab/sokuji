import type { SubtitleSurface } from './SubtitleSurface';
import useSettingsStore from '../../../stores/settingsStore';

declare const chrome: any;

const SUPPORTED_HOSTS = new Set([
  'meet.google.com',
  'teams.live.com', 'teams.microsoft.com', 'teams.cloud.microsoft',
  'app.zoom.us',
  'app.gather.town', 'app.v2.gather.town',
  'whereby.com',
  'discord.com',
  'app.slack.com',
]);

function isSupportedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try { return SUPPORTED_HOSTS.has(new URL(url).hostname); } catch { return false; }
}

export class ExtensionContentScriptSubtitleSurface implements SubtitleSurface {
  private targetTabId: number | null = null;
  private port: any = null;

  private handleConnect = (p: any) => {
    if (p.name !== 'sokuji-subtitle') return;
    this.port = p;
    p.onMessage.addListener(this.handlePortMessage);
    p.onDisconnect.addListener(() => {
      if (this.port === p) this.port = null;
      // NOTE: do NOT call tearDown — disconnects also fire on page reload.
    });
    // Initial push happens via store subscriptions installed lazily on first connect.
    this.installStoreSubscriptions();
  };

  private handlePortMessage = (msg: { type?: string }) => {
    if (msg?.type === 'subtitle:user-exit') {
      void useSettingsStore.getState().exitSubtitleMode();
    } else if (msg?.type === 'subtitle:request-clear') {
      void useSessionStoreForClear();
    }
  };

  private handleTabRemoved = (tabId: number) => {
    if (tabId === this.targetTabId) this.tearDown();
  };

  private handleTabUpdated = (
    tabId: number,
    info: any,
    _tab: any,
  ) => {
    if (tabId !== this.targetTabId) return;
    if (info.status === 'complete') {
      // Content script just (re-)loaded; re-mount the host.
      void chrome.tabs.sendMessage(tabId, { type: 'subtitle:enter' });
      return;
    }
    if (info.url !== undefined) {
      if (isSupportedUrl(info.url)) {
        void chrome.tabs.sendMessage(tabId, { type: 'subtitle:enter' });
      } else {
        this.tearDown();
      }
    }
  };

  async enter(): Promise<void> {
    if (this.targetTabId != null) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isSupportedUrl(tab.url)) {
      throw new Error('not on supported site');
    }
    chrome.runtime.onConnect.addListener(this.handleConnect);
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved);
    chrome.tabs.onUpdated.addListener(this.handleTabUpdated);
    await chrome.tabs.sendMessage(tab.id, { type: 'subtitle:enter' });
    this.targetTabId = tab.id;
  }

  async exit(): Promise<void> {
    if (this.targetTabId == null) return;
    try {
      await chrome.tabs.sendMessage(this.targetTabId, { type: 'subtitle:exit' });
    } catch {
      /* tab may already be gone */
    }
    this.tearDown();
  }

  private tearDown() {
    chrome.runtime.onConnect.removeListener(this.handleConnect);
    chrome.tabs.onRemoved.removeListener(this.handleTabRemoved);
    chrome.tabs.onUpdated.removeListener(this.handleTabUpdated);
    this.port?.disconnect();
    this.port = null;
    this.targetTabId = null;
    useSettingsStore.getState().__notifySubtitleSurfaceExited();
  }

  private installStoreSubscriptions() {
    // Implemented in Task 12 (sessionPortMirror sidepanel side). For now,
    // push an empty initial snapshot so the iframe doesn't sit empty.
    this.port?.postMessage({ type: 'state-init', payload: {} });
  }
}

function useSessionStoreForClear() {
  // Lazy dynamic import keeps surface module testable without pulling sessionStore.
  return import('../../../stores/sessionStore').then(({ default: useSessionStore }) =>
    useSessionStore.getState().requestClearConversation(),
  );
}
