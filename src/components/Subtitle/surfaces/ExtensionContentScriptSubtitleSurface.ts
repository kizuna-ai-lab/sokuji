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
  'meet.jit.si',
]);

function isSupportedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try { return SUPPORTED_HOSTS.has(new URL(url).hostname); } catch { return false; }
}

/**
 * Cap how many trailing items cross the port. The overlay is a live tail, not a
 * scrollback log: compact mode only ever renders ~BUCKET_MAX_CHARS of the
 * newest text. Bounding to the most recent N keeps the per-message clone and
 * the iframe's per-render work (re-sort / filter / Map-rebuild) O(N) regardless
 * of how long the session runs. Full history stays on the side panel (the
 * source of truth) for export. Defensive bound — the dominant cost was the
 * heavy per-item fields (see stripHeavyItemFields), not item count.
 */
const MAX_FORWARDED_ITEMS = 15;

// Coalesce items forwarding to this cadence. Streaming deltas mutate the items
// array many times/sec; posting each one (structured clone + cross-process IPC
// + an iframe re-render) is wasteful for a live subtitle. ~8 refreshes/sec
// reads perfectly smoothly. Roughly matches the 100ms playback/karaoke cadence
// so text and highlight stay in step.
const ITEMS_THROTTLE_MS = 120;

function recentItems(items: any[] | undefined): any[] {
  if (!items) return [];
  return items.length > MAX_FORWARDED_ITEMS
    ? items.slice(-MAX_FORWARDED_ITEMS)
    : items;
}

/**
 * Drop the heavy replay-only fields from items before they cross the
 * chrome.runtime port: `formatted.audio` (raw PCM `Int16Array`),
 * `formatted.file` (a generated WAV blob for the download/replay button), and
 * `content[].audio`.
 *
 * Since `keepReplayAudio` defaults to false (see settingsStore), `formatted.audio`
 * is usually absent and this strip is a no-op for those fields. `formatted.file`
 * is no longer generated anywhere (the WAV path in MainPanel was removed). The
 * strip stays as defense-in-depth: when a user explicitly enables `keepReplayAudio`
 * AND uses the subtitle overlay, this still bounds the wire payload.
 *
 * Provider clients keep this audio on each conversation item to power replay,
 * but the subtitle overlay never reads any of it — it renders text and uses
 * only the small `audioSegments`/`audioTextEnd` timing metadata for the
 * karaoke highlight. Forwarding these fields was catastrophic because the items
 * subscription re-posts the whole array on every streaming delta and port
 * messages are structured-cloned in full:
 *   - `formatted.audio` grew until one message exceeded Chrome's 64MiB port
 *     limit and `postMessage` threw synchronously inside the Zustand notify,
 *     crashing the app.
 *   - `formatted.file` (the WAV, even larger than the PCM) reached multiple MB
 *     per item and, re-cloned on every delta, pegged the page (measured: a
 *     single item at 5.4MB, total payload 12MB).
 * Stripping them keeps the wire payload tiny and bounded to text.
 */
function stripHeavyItemFields(items: any[] | undefined): any[] {
  if (!items) return [];
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const next: any = { ...item };
    if (item.formatted && typeof item.formatted === 'object') {
      const { audio: _audio, file: _file, ...formattedRest } = item.formatted;
      next.formatted = formattedRest;
    }
    if (Array.isArray(item.content)) {
      next.content = item.content.map((part: any) => {
        if (!part || typeof part !== 'object') return part;
        const { audio: _partAudio, ...partRest } = part;
        return partRest;
      });
    }
    return next;
  });
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
  // Trailing throttle state for items forwarding (see ITEMS_THROTTLE_MS).
  private itemsThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingItems: { items: any[]; participantItems: any[] } | null = null;

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

  // Fullscreen is an Electron-window concept; the extension overlay lives
  // inside the host page and has no equivalent. No-op by design.
  async setFullscreen(_flag: boolean): Promise<void> {
    /* no-op */
  }

  private tearDown() {
    chrome.runtime.onConnect.removeListener(this.handleConnect);
    chrome.tabs.onRemoved.removeListener(this.handleTabRemoved);
    chrome.tabs.onUpdated.removeListener(this.handleTabUpdated);
    if (this.itemsThrottleTimer != null) {
      clearTimeout(this.itemsThrottleTimer);
      this.itemsThrottleTimer = null;
    }
    this.pendingItems = null;
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
    // on every reload. Reset the items throttle too (same as tearDown): a
    // timer scheduled by the prior generation must not fire after reconnect
    // and post its stale pendingItems snapshot to the new port.
    this.subscriptions.forEach((u) => u());
    this.subscriptions = [];
    if (this.itemsThrottleTimer != null) {
      clearTimeout(this.itemsThrottleTimer);
      this.itemsThrottleTimer = null;
    }
    this.pendingItems = null;

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
        items: stripHeavyItemFields(recentItems(session.items)),
        participantItems: stripHeavyItemFields(recentItems(session.participantItems)),
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
    const subs: (() => void)[] = [];

    subs.push(useSessionStore.subscribe(
      (s) => ({ items: s.items, participantItems: s.participantItems }),
      (next) => {
        // Trailing throttle: keep only the latest snapshot and post it at
        // most once per ITEMS_THROTTLE_MS. Bursts of streaming deltas
        // collapse into one message instead of one-per-delta.
        this.pendingItems = { items: next.items, participantItems: next.participantItems };
        if (this.itemsThrottleTimer != null) return;
        this.itemsThrottleTimer = setTimeout(() => {
          this.itemsThrottleTimer = null;
          const p = this.pendingItems;
          this.pendingItems = null;
          if (!p || !this.port) return;
          this.port.postMessage({
            type: 'items',
            items: stripHeavyItemFields(recentItems(p.items)),
            participantItems: stripHeavyItemFields(recentItems(p.participantItems)),
          });
        }, ITEMS_THROTTLE_MS);
      },
      {
        equalityFn: (a, b) =>
          a.items === b.items && a.participantItems === b.participantItems,
      },
    ));
    subs.push(useSessionStore.subscribe(
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
    ));

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
    subs.push(useSettingsStore.subscribe(pushConfigIfChanged));

    subs.push(subscribePlaybackForPort((encoded) => {
      this.port?.postMessage({ type: 'playback', ...encoded });
    }));

    this.subscriptions = subs;
  }
}

function useSessionStoreForClear() {
  // Lazy dynamic import keeps surface module testable without pulling sessionStore.
  return import('../../../stores/sessionStore').then(({ default: useSessionStore }) =>
    useSessionStore.getState().requestClearConversation(),
  );
}
