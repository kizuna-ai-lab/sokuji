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

/**
 * Thrown when the meeting tab has no content-script receiver. Most common
 * cause: the user reloaded the extension after the meeting tab was already
 * open, so the (now-current) content script was never injected into it. The
 * caller is expected to surface a "refresh the tab" prompt.
 */
export const CONTENT_SCRIPT_UNAVAILABLE = 'CONTENT_SCRIPT_UNAVAILABLE';

export class ExtensionContentScriptSubtitleSurface implements SubtitleSurface {
  private targetTabId: number | null = null;
  private port: any = null;
  private subscriptions: (() => void)[] = [];

  private handleConnect = (p: any) => {
    if (p.name !== 'sokuji-subtitle') return;
    this.port = p;
    p.onMessage.addListener(this.handlePortMessage);
    p.onDisconnect.addListener(() => {
      if (this.port === p) this.port = null;
      // NOTE: do NOT call tearDown — disconnects also fire on page reload.
    });
    // Initial push happens via store subscriptions installed lazily on first connect.
    void this.installStoreSubscriptions();
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
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'subtitle:enter' });
    } catch (rawError) {
      // The most common cause is a stale meeting tab — the extension was
      // reloaded after the tab was opened, so the new content script was
      // never injected and there's nothing on the other side to receive
      // the message. Roll back the listeners we just attached, then throw
      // a classified error so the caller can prompt the user to refresh.
      chrome.runtime.onConnect.removeListener(this.handleConnect);
      chrome.tabs.onRemoved.removeListener(this.handleTabRemoved);
      chrome.tabs.onUpdated.removeListener(this.handleTabUpdated);
      const err = new Error(
        rawError instanceof Error ? rawError.message : String(rawError),
      ) as Error & { code: string };
      err.code = CONTENT_SCRIPT_UNAVAILABLE;
      throw err;
    }
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
    this.subscriptions.forEach((u) => u());
    this.subscriptions = [];
    this.port?.disconnect();
    this.port = null;
    this.targetTabId = null;
    useSettingsStore.getState().__notifySubtitleSurfaceExited();
  }

  private async installStoreSubscriptions(): Promise<void> {
    // Drop any subscriptions from a prior port. handleConnect runs again
    // when the meeting tab reloads (iframe re-mounts → new port), and
    // without this cleanup the previous generation of Zustand listeners
    // would stay alive, fan messages to the new port too, and accumulate
    // on every reload.
    this.subscriptions.forEach((u) => u());
    this.subscriptions = [];

    // Lazy dynamic import keeps the surface module testable in environments
    // that don't want to pull in sessionStore (and its audio dependencies)
    // until the surface is actually used.
    const { default: useSessionStore } = await import('../../../stores/sessionStore');
    const {
      getWirePlaybackSnapshot,
      subscribePlaybackForPort,
    } = await import('../../../stores/playbackStore');
    // If the port was torn down while we awaited the import, bail out.
    if (!this.port) return;

    // Snapshot session + settings state so SubtitleApp's selectors
    // (useProvider / useGetCurrentProviderSettings / useCurrentTurnDetectionMode)
    // resolve to the user's real values inside the iframe.
    const session = useSessionStore.getState();
    const settings = useSettingsStore.getState();
    const providerSettings = settings.getCurrentProviderSettings();
    const langs = providerSettings as
      | { sourceLanguage?: string; targetLanguage?: string }
      | null
      | undefined;
    const turnDetectionMode =
      providerSettings && 'turnDetectionMode' in providerSettings
        ? (providerSettings as { turnDetectionMode?: string }).turnDetectionMode
        : undefined;

    // Track last-emitted config so we can dedupe and avoid spamming the port
    // on every unrelated settings-store change.
    let lastConfig = {
      provider: settings.provider as string,
      sourceLanguage: langs?.sourceLanguage ?? 'en',
      targetLanguage: langs?.targetLanguage ?? 'zh',
      turnDetectionMode,
    };

    const playbackSnapshot = getWirePlaybackSnapshot();

    this.port.postMessage({
      type: 'state-init',
      payload: {
        items: session.items,
        participantItems: session.participantItems,
        isSessionActive: session.isSessionActive,
        sessionStartTime: session.sessionStartTime,
        provider: lastConfig.provider,
        sourceLanguage: lastConfig.sourceLanguage,
        targetLanguage: lastConfig.targetLanguage,
        turnDetectionMode: lastConfig.turnDetectionMode,
        playback: playbackSnapshot,
      },
    });

    // Subscribe to subsequent changes.
    const unsubItems = useSessionStore.subscribe(
      (s) => ({ items: s.items, participantItems: s.participantItems }),
      (next) => {
        this.port?.postMessage({
          type: 'items',
          items: next.items,
          participantItems: next.participantItems,
        });
      },
      {
        equalityFn: (a, b) =>
          a.items === b.items && a.participantItems === b.participantItems,
      },
    );
    const unsubSession = useSessionStore.subscribe(
      (s) => ({ isSessionActive: s.isSessionActive, sessionStartTime: s.sessionStartTime }),
      (next) => {
        this.port?.postMessage({
          type: 'session',
          isSessionActive: next.isSessionActive,
          sessionStartTime: next.sessionStartTime,
        });
      },
      {
        equalityFn: (a, b) =>
          a.isSessionActive === b.isSessionActive &&
          a.sessionStartTime === b.sessionStartTime,
      },
    );

    // Forward provider + language pair + turn detection mode whenever they
    // change in the side panel. We listen to the full state (rather than a
    // narrow selector) because the language pair lives inside a
    // provider-specific sub-object that varies by provider, so dedupe in the
    // callback against `lastConfig`.
    const pushConfigIfChanged = () => {
      if (!this.port) return;
      const s = useSettingsStore.getState();
      const ps = s.getCurrentProviderSettings();
      const l = ps as { sourceLanguage?: string; targetLanguage?: string } | null | undefined;
      const tdm = ps && 'turnDetectionMode' in ps
        ? (ps as { turnDetectionMode?: string }).turnDetectionMode
        : undefined;
      const next = {
        provider: s.provider as string,
        sourceLanguage: l?.sourceLanguage ?? 'en',
        targetLanguage: l?.targetLanguage ?? 'zh',
        turnDetectionMode: tdm,
      };
      if (
        next.provider === lastConfig.provider &&
        next.sourceLanguage === lastConfig.sourceLanguage &&
        next.targetLanguage === lastConfig.targetLanguage &&
        next.turnDetectionMode === lastConfig.turnDetectionMode
      ) {
        return;
      }
      lastConfig = next;
      this.port.postMessage({ type: 'config', ...next });
    };
    const unsubConfig = useSettingsStore.subscribe(pushConfigIfChanged);

    const unsubPlayback = subscribePlaybackForPort((encoded) => {
      this.port?.postMessage({ type: 'playback', ...encoded });
    });

    this.subscriptions = [unsubItems, unsubSession, unsubConfig, unsubPlayback];
  }
}

function useSessionStoreForClear() {
  // Lazy dynamic import keeps surface module testable without pulling sessionStore.
  return import('../../../stores/sessionStore').then(({ default: useSessionStore }) =>
    useSessionStore.getState().requestClearConversation(),
  );
}
