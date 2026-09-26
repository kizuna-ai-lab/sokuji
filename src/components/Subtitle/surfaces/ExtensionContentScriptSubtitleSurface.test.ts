import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSubtitleFeed } from '../../../app/subtitleFeed';
import type { Entry } from '../../../lib/projection/types';
import type { SubtitleSession } from '../../../lib/subtitle/session';
import type { Readable } from '../../../lib/view/conversationView';
import type { KaraokeState } from '../../../lib/view/karaoke';
import useSettingsStore from '../../../stores/settingsStore';
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

// The side panel's interface language, fixed: it is the overlay's first message.
vi.mock('../uiLanguage', () => ({ uiLanguage: { get: () => 'ja', subscribe: () => () => {} } }));

const reportWarningSpy = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/diagnostics/report')>()),
  reportWarning: reportWarningSpy,
}));

declare const globalThis: any;

function box<T>(initial: T): Readable<T> & { set(next: T): void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next) { value = next; listeners.forEach((listener) => listener()); },
  };
}

const running: SubtitleSession = { phase: 'running', since: 5, legs: ['speaker'], pair: { source: 'en', target: 'ja' }, holdToTalk: true, canStart: false, idle: { kind: 'ended' } };

function stubFeed() {
  const session = box<SubtitleSession>(running);
  const feed = {
    sources: { entries: box<readonly Entry[]>([]), session, karaoke: box<KaraokeState>({ lit: new Map(), replaying: null }) },
    clear: vi.fn(), press: vi.fn(), release: vi.fn(),
  };
  return { feed, session };
}

/**
 * An overlay's port as `onConnect` hands it over; `null` is a sender with no
 * tab (an `undefined` argument would take the default). `drop()` is Chrome
 * firing this end's `onDisconnect`; `listening()` counts the listeners left on it.
 */
function makePort(tabId: number | null = 7, name = 'sokuji-subtitle') {
  const messages = new Set<(m: unknown) => void>();
  const gone = new Set<() => void>();
  return {
    name,
    sender: tabId === null ? {} : { tab: { id: tabId } },
    postMessage: vi.fn(),
    onMessage: { addListener: (fn: (m: unknown) => void) => { messages.add(fn); }, removeListener: (fn: (m: unknown) => void) => { messages.delete(fn); } },
    onDisconnect: { addListener: (fn: () => void) => { gone.add(fn); }, removeListener: (fn: () => void) => { gone.delete(fn); } },
    disconnect: vi.fn(),
    deliver: (m: unknown) => { [...messages].forEach((fn) => fn(m)); },
    drop: () => { [...gone].forEach((fn) => fn()); },
    listening: () => messages.size + gone.size,
  };
}
const sentTypes = (port: ReturnType<typeof makePort>) => port.postMessage.mock.calls.map(([m]) => (m as { type: string }).type);
const flush = () => new Promise((r) => setTimeout(r, 0));

/** What an overlay gets when it connects, in order (plan 1e-4 ruling 5: the language first). */
const FIRST_SENDS = ['subtitle:language', 'subtitle:session', 'subtitle:entries', 'subtitle:karaoke'];

describe('ExtensionContentScriptSubtitleSurface', () => {
  let listeners: { onConnect: Function[]; onRemoved: Function[]; onUpdated: Function[]; onMessage: Function[] };
  let sendMessage: ReturnType<typeof vi.fn>;
  let feed: ReturnType<typeof stubFeed>['feed'];
  let session: ReturnType<typeof stubFeed>['session'];
  let off: () => void;
  let settingsBefore: ReturnType<typeof useSettingsStore.getState>;

  beforeAll(() => {
    settingsBefore = useSettingsStore.getState();
  });

  beforeEach(() => {
    listeners = { onConnect: [], onRemoved: [], onUpdated: [], onMessage: [] };
    sendMessage = vi.fn(async () => undefined);
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [{ id: 7, url: 'https://meet.google.com/abc' }]),
        get: vi.fn(async (id: number) => ({ id, url: 'https://meet.google.com/abc' })),
        sendMessage,
        onRemoved: { addListener: (fn: Function) => listeners.onRemoved.push(fn), removeListener: vi.fn() },
        onUpdated: { addListener: (fn: Function) => listeners.onUpdated.push(fn), removeListener: vi.fn() },
      },
      runtime: {
        onConnect: { addListener: (fn: Function) => listeners.onConnect.push(fn), removeListener: vi.fn() },
      },
    };
    ({ feed, session } = stubFeed());
    off = registerSubtitleFeed(feed);
    reportWarningSpy.mockClear();
  });

  afterEach(() => {
    off();
    useSettingsStore.setState(settingsBefore, true);
  });

  /** A surface that has entered subtitle mode on its tab. */
  async function entered() {
    const surface = new ExtensionContentScriptSubtitleSurface();
    await surface.enter();
    return surface;
  }
  /** An overlay connecting, as Chrome hands its port to the side panel. */
  const connect = (port: ReturnType<typeof makePort>) => listeners.onConnect[0](port);

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

  it('enter() accepts meet.jit.si as a supported site', async () => {
    globalThis.chrome.tabs.query = vi.fn(async () => [{ id: 11, url: 'https://meet.jit.si/SomeRoomName' }]);
    const surface = new ExtensionContentScriptSubtitleSurface();
    await expect(surface.enter()).resolves.not.toThrow();
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
    // A failed enter forgets its tab: an overlay that connects anyway is not
    // this side panel's, so it is left alone…
    const stray = makePort(7);
    listeners.onConnect[0](stray);
    expect(stray.disconnect).not.toHaveBeenCalled();
    expect(stray.postMessage).not.toHaveBeenCalled();
    expect(stray.listening()).toBe(0);
    // …and the next enter() is not short-circuited by a tab it never reached.
    sendMessage.mockClear();
    await surface.enter();
    expect(sendMessage.mock.calls.map(([, m]) => (m as { type: string }).type)).toEqual(['subtitle:exit', 'subtitle:enter']);
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'subtitle:enter' });
  });

  it('enter() sends subtitle:exit before subtitle:enter, to this tab, so a stale host from an earlier session is cleared first (final-fix review Minor 1)', async () => {
    const surface = new ExtensionContentScriptSubtitleSurface();
    await surface.enter();
    expect(sendMessage.mock.calls.map(([, m]) => (m as { type: string }).type)).toEqual(['subtitle:exit', 'subtitle:enter']);
    expect(sendMessage).toHaveBeenNthCalledWith(1, 7, { type: 'subtitle:exit' });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 7, { type: 'subtitle:enter' });
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

  it("publishes the app session to its own tab's overlay: language, session, entries, karaoke, in that order", async () => {
    await entered();
    const port = makePort(7);
    connect(port);
    expect(sentTypes(port)).toEqual(FIRST_SENDS);
    expect(port.postMessage.mock.calls[0][0]).toEqual({ type: 'subtitle:language', language: 'ja' });
    expect((port.postMessage.mock.calls[1][0] as { session: unknown }).session).toEqual(running);
  });

  // Chrome's "Port lifetime": a `disconnect()` on any one receiving port fires
  // `onDisconnect` only at the sender — so a refusal by disconnect would close
  // the other tab's live overlay, and its own side panel would never learn.
  it('leaves a port from another tab, or from no tab, alone: never disconnected, never posted to, nothing listening', async () => {
    await entered();
    const otherTab = makePort(8);
    connect(otherTab);
    const noTab = makePort(null);
    connect(noTab);
    await flush();
    for (const port of [otherTab, noTab]) {
      expect(port.disconnect).not.toHaveBeenCalled();
      expect(port.postMessage).not.toHaveBeenCalled();
      expect(port.listening()).toBe(0);
    }
    const own = makePort(7);
    connect(own);
    expect(sentTypes(own)).toEqual(FIRST_SENDS);
  });

  it("keeps publishing to its own overlay when another tab's overlay connects after it", async () => {
    await entered();
    const own = makePort(7);
    connect(own);
    const foreign = makePort(8);
    connect(foreign);
    expect(own.disconnect).not.toHaveBeenCalled();
    expect(foreign.disconnect).not.toHaveBeenCalled();
    const ownPosts = own.postMessage.mock.calls.length;
    session.set({ ...running, since: 9 });
    expect(own.postMessage).toHaveBeenCalledTimes(ownPosts + 1);
    expect(foreign.postMessage).not.toHaveBeenCalled();
  });

  it('leaves a port of another name alone', async () => {
    await entered();
    const port = makePort(7, 'other');
    connect(port);
    await flush();
    expect(port.disconnect).not.toHaveBeenCalled();
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it('leaves a foreign-tab port alone even when no feed is attached: the tab check runs before the feed check (review Minor 6)', async () => {
    off();
    await entered();
    const port = makePort(8);
    connect(port);
    await flush();
    expect(port.disconnect).not.toHaveBeenCalled();
    expect(port.postMessage).not.toHaveBeenCalled();
    expect(reportWarningSpy).not.toHaveBeenCalled();
  });

  it('closes the port, with one warning, when no session is attached', async () => {
    off();
    await entered();
    const port = makePort(7);
    connect(port);
    await flush();
    expect(port.disconnect).toHaveBeenCalledTimes(1);
    expect(port.postMessage).not.toHaveBeenCalled();
    expect(reportWarningSpy).toHaveBeenCalledTimes(1);
    expect(reportWarningSpy).toHaveBeenCalledWith('SubtitleSurface', expect.any(String), expect.objectContaining({ dedupeKey: 'subtitle-surface:no-feed' }));
  });

  it("gives a tab reload's new overlay a fresh publisher", async () => {
    await entered();
    const p1 = makePort(7);
    connect(p1);
    p1.drop();
    const p1Posts = p1.postMessage.mock.calls.length;
    const p2 = makePort(7);
    connect(p2);
    expect(sentTypes(p2)).toEqual(FIRST_SENDS);
    session.set({ ...running, since: 9 });
    expect(sentTypes(p2)).toEqual([...FIRST_SENDS, 'subtitle:session']);
    expect(p1.postMessage).toHaveBeenCalledTimes(p1Posts);
    // It had gone by itself: nothing to close.
    expect(p1.disconnect).not.toHaveBeenCalled();
  });

  it('replaces the first overlay with a second while the first is still connected: the first is stopped, then disconnected', async () => {
    await entered();
    const p1 = makePort(7);
    connect(p1);
    const p2 = makePort(7);
    connect(p2);
    expect(p1.disconnect).toHaveBeenCalledTimes(1);
    const p1Posts = p1.postMessage.mock.calls.length;
    const p2Posts = p2.postMessage.mock.calls.length;
    session.set({ ...running, since: 9 });
    expect(p1.postMessage).toHaveBeenCalledTimes(p1Posts);
    expect(p2.postMessage).toHaveBeenCalledTimes(p2Posts + 1);
  });

  it("carries the overlay's controls to the runner's, and its exit leaves subtitle mode", async () => {
    const exitSpy = vi.fn(async () => {});
    useSettingsStore.setState({ exitSubtitleMode: exitSpy });
    await entered();
    const p1 = makePort(7);
    connect(p1);
    p1.deliver({ type: 'subtitle:request-clear' });
    p1.deliver({ type: 'subtitle:turn-press' });
    p1.deliver({ type: 'subtitle:turn-release' });
    p1.deliver({ type: 'subtitle:user-exit' });
    expect(feed.clear).toHaveBeenCalledTimes(1);
    expect(feed.press).toHaveBeenCalledTimes(1);
    expect(feed.release).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });

  it('exit() stops the publisher before disconnecting its port, releasing a held press', async () => {
    const surface = await entered();
    const p1 = makePort(7);
    connect(p1);
    p1.deliver({ type: 'subtitle:turn-press' });
    const order: string[] = [];
    feed.release.mockImplementation(() => { order.push('release'); });
    p1.disconnect.mockImplementation(() => { order.push('disconnect'); });
    await surface.exit();
    expect(sendMessage).toHaveBeenLastCalledWith(7, { type: 'subtitle:exit' });
    expect(order).toEqual(['release', 'disconnect']);
    const p1Posts = p1.postMessage.mock.calls.length;
    session.set({ ...running, since: 9 });
    expect(p1.postMessage).toHaveBeenCalledTimes(p1Posts);
    // Nothing is left listening on the closed port: the publisher's, nor the surface's own.
    expect(p1.listening()).toBe(0);
  });

  it('tears the publisher down when the tab closes', async () => {
    await entered();
    const p1 = makePort(7);
    connect(p1);
    listeners.onRemoved[0](7);
    expect(p1.disconnect).toHaveBeenCalledTimes(1);
    const p1Posts = p1.postMessage.mock.calls.length;
    session.set({ ...running, since: 9 });
    await flush();
    expect(p1.postMessage).toHaveBeenCalledTimes(p1Posts);
  });

  it('releases a held press when the overlay goes away', async () => {
    await entered();
    const p1 = makePort(7);
    connect(p1);
    p1.deliver({ type: 'subtitle:turn-press' });
    p1.drop();
    expect(feed.release).toHaveBeenCalledTimes(1);
  });

  it('enter() targets the tab the side panel was opened for, not the active tab (ruling 4)', async () => {
    window.history.replaceState(null, '', '/?tabId=42');
    try {
      await entered();
      expect(globalThis.chrome.tabs.get).toHaveBeenCalledWith(42);
      expect(sendMessage).toHaveBeenCalledWith(42, { type: 'subtitle:enter' });
      expect(globalThis.chrome.tabs.query).not.toHaveBeenCalled();
      const own = makePort(42);
      connect(own);
      expect(sentTypes(own)).toEqual(FIRST_SENDS);
      const active = makePort(7);
      connect(active);
      expect(active.disconnect).not.toHaveBeenCalled();
      expect(active.postMessage).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('enter() refuses its tab when the tab has left the meeting, or is gone', async () => {
    window.history.replaceState(null, '', '/?tabId=42');
    try {
      globalThis.chrome.tabs.get = vi.fn(async (id: number) => ({ id, url: 'https://example.com/' }));
      await expect(new ExtensionContentScriptSubtitleSurface().enter()).rejects.toThrow(/not on supported site/);
      globalThis.chrome.tabs.get = vi.fn(async () => { throw new Error('No tab with id: 42.'); });
      await expect(new ExtensionContentScriptSubtitleSurface().enter()).rejects.toThrow(/not on supported site/);
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it("accepts its tab's overlay while subtitle:exit is still in flight", async () => {
    let arrived!: () => void;
    sendMessage.mockImplementationOnce(() => new Promise<void>((resolve) => { arrived = resolve; }));
    const entering = new ExtensionContentScriptSubtitleSurface().enter();
    await vi.waitFor(() => expect(listeners.onConnect).toHaveLength(1));
    const port = makePort(7);
    connect(port);
    expect(sentTypes(port)).toEqual(FIRST_SENDS);
    arrived();
    await entering;
  });

  it('closes the publisher an in-flight enter accepted when subtitle:exit then fails', async () => {
    let refused!: (error: Error) => void;
    sendMessage.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { refused = reject; }));
    const entering = new ExtensionContentScriptSubtitleSurface().enter();
    await vi.waitFor(() => expect(listeners.onConnect).toHaveLength(1));
    const port = makePort(7);
    connect(port);
    port.deliver({ type: 'subtitle:turn-press' });
    refused(new Error('Could not establish connection. Receiving end does not exist.'));
    await expect(entering).rejects.toMatchObject({ code: 'CONTENT_SCRIPT_UNAVAILABLE' });
    expect(feed.release).toHaveBeenCalledTimes(1);
    expect(port.disconnect).toHaveBeenCalledTimes(1);
    const posts = port.postMessage.mock.calls.length;
    session.set({ ...running, since: 9 });
    expect(port.postMessage).toHaveBeenCalledTimes(posts);
  });
});
