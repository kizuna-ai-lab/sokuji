import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock, type VirtualClock } from '../contract/clock';
import type { Entry } from '../projection/types';
import type { Readable } from '../view/conversationView';
import type { KaraokeState } from '../view/karaoke';
import type { SubtitleSession } from './session';
import { chromePortWire, ENTRIES_INTERVAL_MS, messagePortWire, OVERLAY_ENTRIES, publishSubtitles, receiveSubtitles, type WirePort } from './wire';

const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../diagnostics/report')>()),
  reportError: reportErrorSpy,
}));

/**
 * Two connected ends that deliver synchronously; `disconnect` tells the other
 * end. Clones with `JSON.parse(JSON.stringify(...))`, as `chrome.runtime`
 * does (a `Map` becomes `{}`, an `undefined`-valued key drops) — not
 * `structuredClone`, which is more permissive than the real transport and
 * would let a non-JSON-safe protocol pass here unnoticed.
 */
function portPair(): [WirePort & { disconnect(): void }, WirePort & { disconnect(): void }] {
  const make = () => ({ messages: new Set<(m: unknown) => void>(), gone: new Set<() => void>() });
  const a = make();
  const b = make();
  const end = (self: typeof a, other: typeof a) => ({
    post: (message: unknown) => other.messages.forEach((listener) => listener(JSON.parse(JSON.stringify(message)))),
    onMessage: (listener: (m: unknown) => void) => { self.messages.add(listener); return () => { self.messages.delete(listener); }; },
    onDisconnect: (listener: () => void) => { self.gone.add(listener); return () => { self.gone.delete(listener); }; },
    close: () => {},
    disconnect: () => other.gone.forEach((listener) => listener()),
  });
  return [end(a, b), end(b, a)];
}

function box<T>(initial: T): Readable<T> & { set(next: T): void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next) { value = next; listeners.forEach((listener) => listener()); },
  };
}

const notice = (n: number, leg: 'speaker' | 'participant' = 'speaker'): Entry => ({ kind: 'notice', id: `n${n}`, leg, severity: 'warning', message: `m${n}`, at: n });
const session: SubtitleSession = { phase: 'running', since: 5, legs: ['speaker'], pair: { source: 'en', target: 'ja' }, holdToTalk: true, canStart: false, idle: { kind: 'ended' } };
const controls = () => ({ clear: vi.fn(), exit: vi.fn(), press: vi.fn(), release: vi.fn() });

function setup(entries: Entry[] = [notice(1)], clock: VirtualClock = createVirtualClock()) {
  const [panel, overlay] = portPair();
  const sources = {
    entries: box<readonly Entry[]>(entries),
    session: box(session),
    karaoke: box<KaraokeState>({ lit: new Map([['s:speaker:2', 4]]), replaying: null }),
  };
  const received = receiveSubtitles(overlay);
  const acts = controls();
  const stop = publishSubtitles(panel, sources, acts, clock);
  return { panel, overlay, sources, received, acts, stop, clock };
}

describe('the subtitle wire', () => {
  it('sends the overlay the tail of the merged entries, the session and the karaoke when it connects', () => {
    const { received } = setup(Array.from({ length: 40 }, (_, i) => notice(i)));
    const model = received.get();
    expect(model.entries).toHaveLength(OVERLAY_ENTRIES);
    expect(model.entries[0]).toMatchObject({ id: 'n10' });
    expect(model.session).toEqual(session);
    expect(model.lit.get('s:speaker:2')).toBe(4);
  });

  it('sends each change, and tells the overlay view', () => {
    const { sources, received, clock } = setup();
    const listener = vi.fn();
    received.subscribe(listener);
    sources.entries.set([notice(1), notice(2)]);
    clock.advance(ENTRIES_INTERVAL_MS);
    sources.karaoke.set({ lit: new Map([['s:speaker:2', 9]]), replaying: null });
    expect(received.get().entries).toHaveLength(2);
    expect(received.get().lit.get('s:speaker:2')).toBe(9);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('coalesces entries changes within the interval, posting once with the latest entries', () => {
    const { sources, received, clock } = setup();
    const listener = vi.fn();
    received.subscribe(listener);
    sources.entries.set([notice(1), notice(2)]);
    sources.entries.set([notice(1), notice(2), notice(3)]);
    expect(listener).not.toHaveBeenCalled();
    clock.advance(ENTRIES_INTERVAL_MS);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(received.get().entries.map((e) => e.id)).toEqual(['n1', 'n2', 'n3']);
  });

  it('sends session before entries before karaoke on connect', () => {
    const [panel] = portPair();
    const order: string[] = [];
    const tracking: WirePort = { ...panel, post: (message: unknown) => { order.push((message as { type: string }).type); panel.post(message); } };
    const sources = {
      entries: box<readonly Entry[]>([notice(1)]),
      session: box(session),
      karaoke: box<KaraokeState>({ lit: new Map(), replaying: null }),
    };
    publishSubtitles(tracking, sources, controls());
    expect(order).toEqual(['subtitle:session', 'subtitle:entries', 'subtitle:karaoke']);
  });

  it('sends the language first, before session, entries and karaoke, when the side panel has one', () => {
    const [panel] = portPair();
    const order: string[] = [];
    const tracking: WirePort = { ...panel, post: (message: unknown) => { order.push((message as { type: string }).type); panel.post(message); } };
    const sources = {
      entries: box<readonly Entry[]>([notice(1)]),
      session: box(session),
      karaoke: box<KaraokeState>({ lit: new Map(), replaying: null }),
      language: box('ja'),
    };
    publishSubtitles(tracking, sources, controls());
    expect(order).toEqual(['subtitle:language', 'subtitle:session', 'subtitle:entries', 'subtitle:karaoke']);
  });

  it('sends a language change once; the same language again sends nothing', () => {
    const [panel] = portPair();
    const sent: unknown[] = [];
    const recording: WirePort = { ...panel, post: (message: unknown) => { sent.push(message); panel.post(message); } };
    const language = box('en');
    const sources = {
      entries: box<readonly Entry[]>([notice(1)]),
      session: box(session),
      karaoke: box<KaraokeState>({ lit: new Map(), replaying: null }),
      language,
    };
    publishSubtitles(recording, sources, controls());
    expect(sent).toHaveLength(4);
    language.set('ja');
    expect(sent).toHaveLength(5);
    expect(sent[4]).toEqual({ type: 'subtitle:language', language: 'ja' });
    language.set('ja');
    expect(sent).toHaveLength(5);
  });

  it('holds the language it heard, null before', () => {
    const { panel, received } = setup();
    expect(received.get().language).toBeNull();
    const listener = vi.fn();
    received.subscribe(listener);
    panel.post({ type: 'subtitle:language', language: 'ja' });
    expect(received.get().language).toBe('ja');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores a subtitle:language message whose language is not a non-empty string', () => {
    const { panel, received } = setup();
    panel.post({ type: 'subtitle:language', language: 'ja' });
    expect(received.get().language).toBe('ja');
    panel.post({ type: 'subtitle:language' });
    expect(received.get().language).toBe('ja');
    panel.post({ type: 'subtitle:language', language: 3 });
    expect(received.get().language).toBe('ja');
    panel.post({ type: 'subtitle:language', language: '' });
    expect(received.get().language).toBe('ja');
  });

  it('sends no language after the publisher stops', () => {
    const [panel, overlay] = portPair();
    const received = receiveSubtitles(overlay);
    const language = box('ja');
    publishSubtitles(panel, {
      entries: box<readonly Entry[]>([notice(1)]),
      session: box(session),
      karaoke: box<KaraokeState>({ lit: new Map(), replaying: null }),
      language,
    }, controls());
    expect(received.get().language).toBe('ja');
    overlay.disconnect();
    language.set('fr');
    expect(received.get().language).toBe('ja');
  });

  it("keeps a quiet leg's newest entries alongside the merged tail, in merged order", () => {
    const participantEntries = [0, 1, 2].map((i) => notice(1000 + i, 'participant'));
    const speakerEntries = Array.from({ length: 40 }, (_, i) => notice(i, 'speaker'));
    const { received } = setup([...participantEntries, ...speakerEntries]);
    const ids = received.get().entries.map((e) => e.id);
    expect(ids.slice(0, 3)).toEqual(['n1000', 'n1001', 'n1002']);
    expect(ids.slice(3)).toEqual(speakerEntries.slice(-OVERLAY_ENTRIES).map((e) => e.id));
  });

  it("acts on the overlay's controls", () => {
    const { received, acts } = setup();
    received.send({ type: 'subtitle:turn-press' });
    received.send({ type: 'subtitle:turn-release' });
    received.send({ type: 'subtitle:request-clear' });
    received.send({ type: 'subtitle:user-exit' });
    expect(acts.press).toHaveBeenCalledTimes(1);
    expect(acts.release).toHaveBeenCalledTimes(1);
    expect(acts.clear).toHaveBeenCalledTimes(1);
    expect(acts.exit).toHaveBeenCalledTimes(1);
  });

  it('releases an outstanding press when the overlay disconnects', () => {
    const { overlay, received, acts } = setup();
    received.send({ type: 'subtitle:turn-press' });
    overlay.disconnect();
    expect(acts.release).toHaveBeenCalledTimes(1);
  });

  it('releases only once in total when the overlay releases before disconnecting', () => {
    const { overlay, received, acts } = setup();
    received.send({ type: 'subtitle:turn-press' });
    received.send({ type: 'subtitle:turn-release' });
    overlay.disconnect();
    expect(acts.release).toHaveBeenCalledTimes(1);
  });

  it('forwards a turn-release though nothing is outstanding (the runner ignores it)', () => {
    const { received, acts } = setup();
    received.send({ type: 'subtitle:turn-release' });
    expect(acts.release).toHaveBeenCalledTimes(1);
  });

  it('ignores a message it does not know, on either end', () => {
    const { panel, overlay, received, acts } = setup();
    overlay.post({ type: 'subtitle:turn-press-please' });
    panel.post({ nonsense: true });
    expect(acts.press).not.toHaveBeenCalled();
    expect(received.get().session).toEqual(session);
  });

  it('ignores a subtitle:session message with no session, or one whose session has no string phase', () => {
    const { panel, received } = setup();
    panel.post({ type: 'subtitle:session' });
    expect(received.get().session).toEqual(session);
    panel.post({ type: 'subtitle:session', session: { since: 1 } });
    expect(received.get().session).toEqual(session);
    panel.post({ type: 'subtitle:session', session: { phase: 3 } });
    expect(received.get().session).toEqual(session);
  });

  it('ignores a subtitle:entries message whose entries is not an array', () => {
    const { panel, received } = setup();
    panel.post({ type: 'subtitle:entries', entries: 'nope' });
    expect(received.get().entries).toEqual([notice(1)]);
  });

  it('reports a failing send once per streak, and again after a successful post', () => {
    reportErrorSpy.mockClear();
    let throwing = true;
    const broken: WirePort = {
      post: () => { if (throwing) throw new Error('port closed'); },
      onMessage: () => () => {},
      onDisconnect: () => () => {},
      close: () => {},
    };
    const received = receiveSubtitles(broken);
    received.send({ type: 'subtitle:turn-press' });
    received.send({ type: 'subtitle:turn-press' });
    expect(reportErrorSpy).toHaveBeenCalledTimes(1);
    throwing = false;
    received.send({ type: 'subtitle:turn-press' });
    throwing = true;
    received.send({ type: 'subtitle:turn-press' });
    expect(reportErrorSpy).toHaveBeenCalledTimes(2);
  });

  it('stops publishing when the overlay disconnects', () => {
    const { overlay, sources, received } = setup();
    overlay.disconnect();
    sources.entries.set([notice(7)]);
    expect(received.get().entries.map((e) => e.id)).toEqual(['n1']);
  });

  it('stops, reporting once, when posting throws', () => {
    reportErrorSpy.mockClear();
    const [panel] = portPair();
    const broken: WirePort = { ...panel, post: () => { throw new Error('port closed'); } };
    const entries = box<readonly Entry[]>([notice(1)]);
    publishSubtitles(broken, { entries, session: box(session), karaoke: box<KaraokeState>({ lit: new Map(), replaying: null }) }, controls());
    entries.set([notice(2)]);
    expect(reportErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('carries messages over a real MessageChannel', async () => {
    const channel = new MessageChannel();
    const received = receiveSubtitles(messagePortWire(channel.port2));
    publishSubtitles(messagePortWire(channel.port1), {
      entries: box<readonly Entry[]>([notice(3)]),
      session: box(session),
      karaoke: box<KaraokeState>({ lit: new Map(), replaying: null }),
    }, controls());
    await vi.waitFor(() => expect(received.get().entries.map((e) => e.id)).toEqual(['n3']));
    channel.port1.close();
    channel.port2.close();
  });

  it('adapts a chrome.runtime port', () => {
    const messageListeners: Array<(m: unknown) => void> = [];
    const goneListeners: Array<() => void> = [];
    const chromePort = {
      postMessage: vi.fn(),
      onMessage: { addListener: (fn: (m: unknown) => void) => messageListeners.push(fn), removeListener: vi.fn() },
      onDisconnect: { addListener: (fn: () => void) => goneListeners.push(fn), removeListener: vi.fn() },
      disconnect: vi.fn(),
    };
    const wire = chromePortWire(chromePort);
    const heard = vi.fn();
    const gone = vi.fn();
    wire.onMessage(heard);
    wire.onDisconnect(gone);
    wire.post({ type: 'x' });
    messageListeners[0]({ type: 'y' });
    goneListeners[0]();
    wire.close();
    expect(chromePort.postMessage).toHaveBeenCalledWith({ type: 'x' });
    expect(heard).toHaveBeenCalledWith({ type: 'y' });
    expect(gone).toHaveBeenCalledTimes(1);
    expect(chromePort.disconnect).toHaveBeenCalledTimes(1);
  });
});
