import type { SubtitleSurface } from './SubtitleSurface';
import useSettingsStore from '../../../stores/settingsStore';
import { PLATFORM_HOSTNAMES } from '../../../../extension/platforms';
import { currentSubtitleFeed } from '../../../app/subtitleFeed';
import { targetTabIdFromSearch } from '../../../lib/audio/tabMicrophone';
import { reportWarning } from '../../../lib/diagnostics/report';
import { chromePortWire, publishSubtitles, SUBTITLE_PORT, type ChromePortLike, type WirePort } from '../../../lib/subtitle/wire';
import { uiLanguage } from '../uiLanguage';

declare const chrome: any;

const SUPPORTED_HOSTS = new Set<string>(PLATFORM_HOSTNAMES);

function isSupportedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try { return SUPPORTED_HOSTS.has(new URL(url).hostname); } catch { return false; }
}

/** A `chrome.runtime.Port` as `onConnect` hands it over: the wire's part, its name, and who opened it. */
interface IncomingPort extends ChromePortLike {
  name: string;
  sender?: { tab?: { id?: number } };
}

/**
 * Thrown when the meeting tab has no content-script receiver. Most common
 * cause: the user reloaded the extension after the meeting tab was already
 * open, so the (now-current) content script was never injected into it. The
 * caller is expected to surface a "refresh the tab" prompt.
 */
export const CONTENT_SCRIPT_UNAVAILABLE = 'CONTENT_SCRIPT_UNAVAILABLE';

/**
 * The extension's subtitle surface, in the side panel (plan 1e-4): it mounts
 * the overlay in its meeting tab through the content script, and publishes
 * the app session to that overlay over a `chrome.runtime` port — the wire of
 * `src/lib/subtitle/wire.ts`, with the side panel's interface language. It
 * reaches the session through `src/app/subtitleFeed.ts`, never the root
 * itself: `settingsStore` imports this class (ruling 1). Another tab's
 * overlay is left alone rather than refused, and that has a cost: while
 * another tab's side panel lives, its unheld receiving end keeps an
 * overlay's channel open after the overlay's own side panel goes, so that
 * overlay shows its last state until the user dismisses it (✕, Escape,
 * Return — D2), a new side panel on its own tab enters subtitle mode and
 * replaces it (`enter()` below), or the last panel holding its port closes.
 */
export class ExtensionContentScriptSubtitleSurface implements SubtitleSurface {
  private targetTabId: number | null = null;
  private publisher: { wire: WirePort; stop(): void; forget(): void } | null = null;

  private handleConnect = (port: IncomingPort) => {
    // Another extension port is not this surface's to judge.
    if (port.name !== SUBTITLE_PORT) return;
    // One overlay per tab (ruling 4): `runtime.connect` reaches every
    // extension page that listens, so a side panel in subtitle mode for
    // another meeting tab hears this overlay too. Leave it alone — no
    // disconnect, no listener, no reference: a `disconnect()` on any one
    // receiving port fires `onDisconnect` only at the sender (Chrome's "Port
    // lifetime"), so a refusal by disconnect would close that tab's live
    // overlay, and its own side panel would never learn.
    if (this.targetTabId === null || port.sender?.tab?.id !== this.targetTabId) return;
    const feed = currentSubtitleFeed();
    if (!feed) {
      // Nothing to show: closing the port unmounts the overlay (its sidepanel-gone; choice 5).
      reportWarning('SubtitleSurface', 'The subtitle overlay connected while the side panel had no session attached; it was closed.', { dedupeKey: 'subtitle-surface:no-feed' });
      port.disconnect();
      return;
    }
    // A reload of the meeting tab connects a new overlay; the old port has
    // usually gone already (its publisher stopped itself), but not necessarily.
    this.closePublisher();
    const wire = chromePortWire(port);
    const stop = publishSubtitles(wire, { ...feed.sources, language: uiLanguage }, {
      clear: feed.clear,
      press: feed.press,
      release: feed.release,
      exit: () => void useSettingsStore.getState().exitSubtitleMode(),
    });
    // The publisher stops itself when the overlay goes (a tab reload, the tab
    // closing); forget it then, so a teardown does not close it a second time.
    const forget = wire.onDisconnect(() => {
      if (this.publisher === current) this.publisher = null;
    });
    const current = { wire, stop, forget };
    this.publisher = current;
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
    const tab = await this.targetTab();
    if (!tab?.id || !isSupportedUrl(tab.url)) {
      throw new Error('not on supported site');
    }
    const tabId = tab.id;
    // Known before the overlay can connect: `handleConnect` accepts this tab's port only (ruling 4).
    this.targetTabId = tabId;
    chrome.runtime.onConnect.addListener(this.handleConnect);
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved);
    chrome.tabs.onUpdated.addListener(this.handleTabUpdated);
    try {
      // `subtitle:exit` first: an overlay orphaned on this tab by an earlier
      // side panel that has since closed keeps its host mounted, and the
      // content script's `mountHost` returns early on an existing host
      // (`subtitle-overlay-content.js:76-77`) — so without this, a new
      // panel's `subtitle:enter` would never mount a fresh overlay.
      // `unmountHost` is idempotent (`:115-121`), and a tab has at most one
      // side panel, so the only host this can ever remove is a stale one
      // (final-fix review Minor 1).
      await chrome.tabs.sendMessage(tabId, { type: 'subtitle:exit' });
      await chrome.tabs.sendMessage(tabId, { type: 'subtitle:enter' });
    } catch (rawError) {
      // The most common cause is a stale meeting tab — the extension was
      // reloaded after the tab was opened, so the new content script was
      // never injected and there's nothing on the other side to receive
      // the message. Roll back the listeners we just attached, then throw
      // a classified error so the caller can prompt the user to refresh.
      chrome.runtime.onConnect.removeListener(this.handleConnect);
      chrome.tabs.onRemoved.removeListener(this.handleTabRemoved);
      chrome.tabs.onUpdated.removeListener(this.handleTabUpdated);
      // An overlay may have connected while the message was in flight.
      this.closePublisher();
      this.targetTabId = null;
      const err = new Error(
        rawError instanceof Error ? rawError.message : String(rawError),
      ) as Error & { code: string };
      err.code = CONTENT_SCRIPT_UNAVAILABLE;
      throw err;
    }
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

  async setAlwaysOnTop(_flag: boolean): Promise<void> {
    /* no-op — the extension overlay has no OS window to pin */
  }

  /**
   * The meeting tab: the one this side panel was opened for (its `?tabId=`,
   * `extension/background/background.js:145-149`), else — the default side
   * panel carries none — the active tab of the current window (ruling 4).
   */
  private async targetTab(): Promise<{ id?: number; url?: string } | undefined> {
    const own = targetTabIdFromSearch(window.location.search);
    if (own === null) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab;
    }
    try {
      return await chrome.tabs.get(own);
    } catch {
      // The tab it was opened for is gone; `enter()` refuses as for any unsupported tab.
      return undefined;
    }
  }

  /**
   * Stops the publisher, then closes its port — in that order (choice 1):
   * `disconnect()` fires no `onDisconnect` on the end that calls it, so a
   * publisher not stopped first would keep its subscriptions and an
   * outstanding press. The surface's own forgetting listener goes with it.
   */
  private closePublisher(): void {
    const current = this.publisher;
    if (!current) return;
    this.publisher = null;
    current.forget();
    current.stop();
    current.wire.close();
  }

  private tearDown() {
    chrome.runtime.onConnect.removeListener(this.handleConnect);
    chrome.tabs.onRemoved.removeListener(this.handleTabRemoved);
    chrome.tabs.onUpdated.removeListener(this.handleTabUpdated);
    this.closePublisher();
    this.targetTabId = null;
    useSettingsStore.getState().__notifySubtitleSurfaceExited();
  }
}
