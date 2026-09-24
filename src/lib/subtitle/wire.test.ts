import { describe, it, expect, vi } from 'vitest';
import type { Entry } from '../projection/types';
import type { Readable } from '../view/conversationView';
import type { KaraokeState } from '../view/karaoke';
import type { SubtitleSession } from './session';
import { chromePortWire, messagePortWire, OVERLAY_ENTRIES, publishSubtitles, receiveSubtitles, type WirePort } from './wire';

const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../diagnostics/report')>()),
  reportError: reportErrorSpy,
}));

/** Two connected ends that deliver synchronously; `disconnect` tells the other end. */
function portPair(): [WirePort & { disconnect(): void }, WirePort & { disconnect(): void }] {
  const make = () => ({ messages: new Set<(m: unknown) => void>(), gone: new Set<() => void>() });
  const a = make();
  const b = make();
  const end = (self: typeof a, other: typeof a) => ({
    post: (message: unknown) => other.messages.forEach((listener) => listener(structuredClone(message))),
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

const notice = (n: number): Entry => ({ kind: 'notice', id: `n${n}`, leg: 'speaker', severity: 'warning', message: `m${n}`, at: n });
const session: SubtitleSession = { phase: 'running', since: 5, legs: ['speaker'], pair: { source: 'en', target: 'ja' }, holdToTalk: true, canStart: false, idle: { kind: 'ended' } };
const controls = () => ({ clear: vi.fn(), exit: vi.fn(), press: vi.fn(), release: vi.fn() });

function setup(entries: Entry[] = [notice(1)]) {
  const [panel, overlay] = portPair();
  const sources = {
    entries: box<readonly Entry[]>(entries),
    session: box(session),
    karaoke: box<KaraokeState>({ lit: new Map([['s:speaker:2', 4]]), replaying: null }),
  };
  const received = receiveSubtitles(overlay);
  const acts = controls();
  const stop = publishSubtitles(panel, sources, acts);
  return { panel, overlay, sources, received, acts, stop };
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
    const { sources, received } = setup();
    const listener = vi.fn();
    received.subscribe(listener);
    sources.entries.set([notice(1), notice(2)]);
    sources.karaoke.set({ lit: new Map([['s:speaker:2', 9]]), replaying: null });
    expect(received.get().entries).toHaveLength(2);
    expect(received.get().lit.get('s:speaker:2')).toBe(9);
    expect(listener).toHaveBeenCalledTimes(2);
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

  it('ignores a message it does not know, on either end', () => {
    const { panel, overlay, received, acts } = setup();
    overlay.post({ type: 'subtitle:turn-press-please' });
    panel.post({ nonsense: true });
    expect(acts.press).not.toHaveBeenCalled();
    expect(received.get().session).toEqual(session);
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
