/**
 * Chrome's extension messaging carries JSON (plan 1e-4 ruling 11): every
 * message the wire sends must survive `JSON.stringify` → `JSON.parse`
 * unchanged. The preview's `MessageChannel` clones structurally, which would
 * pass a `Map` or a typed array silently. `wire.test.ts`'s port pair clones
 * through JSON as well, but asserts only what each case needs, over notice
 * fixtures. Here every message type is sent with every optional field filled,
 * and equality is asserted.
 */
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import type { Entry } from '../projection/types';
import type { Readable } from '../view/conversationView';
import type { KaraokeState } from '../view/karaoke';
import type { SubtitleSession } from './session';
import { ENTRIES_INTERVAL_MS, publishSubtitles, receiveSubtitles, type ToOverlay, type ToPanel, type WirePort } from './wire';

function box<T>(initial: T): Readable<T> & { set(next: T): void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next) { value = next; listeners.forEach((listener) => listener()); },
  };
}

const controls = () => ({ clear: vi.fn(), exit: vi.fn(), press: vi.fn(), release: vi.fn() });

const exchange: Entry = {
  kind: 'exchange', id: 'e1', leg: 'speaker', languages: { source: 'ja', target: 'en' }, pairing: 'inferred', t: 1_000,
  source: [
    { key: 'r:speaker:1:0', segmentId: 'r:speaker:1', side: 'source', start: 0, end: 6, text: '今日は天気が', final: true, language: 'ja' },
    { key: 'r:speaker:1:1', segmentId: 'r:speaker:1', side: 'source', start: 6, end: 12, text: 'いいですね。', final: false },
  ],
  translation: [{ key: 'r:speaker:2:0', segmentId: 'r:speaker:2', side: 'translation', start: 0, end: 26, text: 'The weather is nice today.', final: true }],
};
const notice: Entry = { kind: 'notice', id: 'n1', leg: 'participant', severity: 'error', message: 'No speech model for en.', code: 'no_asr', params: { source: 'en', count: 2 }, at: 2_000 };
const sessions: SubtitleSession[] = [
  { phase: 'running', since: 1_758_000_000_000, legs: ['speaker', 'participant'], pair: { source: 'ja', target: 'en' }, holdToTalk: true, canStart: false, idle: { kind: 'ended' } },
  { phase: 'idle', since: null, legs: ['speaker'], pair: null, holdToTalk: false, canStart: true, idle: { kind: 'failed', notice: { code: 'start_failed', message: 'boom', params: { attempt: 1 } } } },
  { phase: 'idle', since: null, legs: [], pair: { source: 'en', target: 'ja' }, holdToTalk: false, canStart: false, idle: { kind: 'unready', message: 'r', code: 'no_asr', params: { source: 'en' } } },
  { phase: 'starting', since: null, legs: ['speaker'], pair: null, holdToTalk: false, canStart: false, idle: { kind: 'starting' } },
];
const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** What JSON can carry of `T`: a `Map`, a `Set`, a `Date`, a typed array or a function anywhere in it turns its place into `never`. */
type JsonShaped<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends (...args: never[]) => unknown
    ? never
    : T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown> | Date | ArrayBufferView
      ? never
      : T extends readonly (infer U)[]
        ? readonly JsonShaped<U>[]
        : { [K in keyof T]: JsonShaped<T[K]> };

describe('the subtitle wire (JSON-safe messages)', () => {
  it('the wire message types are JSON-shaped, as the typecheck gate sees them', () => {
    // Fails to compile, not to run, when a message type grows a Map, Set, Date, typed array or function.
    const toOverlay: ToOverlay extends JsonShaped<ToOverlay> ? true : false = true;
    const toPanel: ToPanel extends JsonShaped<ToPanel> ? true : false = true;
    expect([toOverlay, toPanel]).toEqual([true, true]);
  });

  it('every message the side panel sends survives a round trip unchanged', () => {
    const sent: unknown[] = [];
    const port: WirePort = {
      post: (message) => { sent.push(message); },
      onMessage: () => () => {},
      onDisconnect: () => () => {},
      close: () => {},
    };
    const clock = createVirtualClock();
    const entries = box<readonly Entry[]>([exchange]);
    const session = box(sessions[0]);
    const karaoke = box<KaraokeState>({ lit: new Map([['r:speaker:1', 7]]), replaying: null });
    const language = box('ja');
    publishSubtitles(port, { entries, session, karaoke, language }, { clear: vi.fn(), exit: vi.fn(), press: vi.fn(), release: vi.fn() }, clock);

    sessions.slice(1).forEach((s) => session.set(s));
    entries.set([exchange, notice]);
    clock.advance(ENTRIES_INTERVAL_MS);
    karaoke.set({ lit: new Map([['r:speaker:1', 12], ['r:speaker:2', 26]]), replaying: 'r:speaker:1' });
    language.set('zh_CN');

    expect(sent).toHaveLength(10);
    expect(new Set(sent.map((m) => (m as { type: string }).type))).toEqual(
      new Set<ToOverlay['type']>(['subtitle:language', 'subtitle:session', 'subtitle:entries', 'subtitle:karaoke']),
    );
    for (const m of sent) expect(roundTrip(m)).toEqual(m);
  });

  it('the overlay, fed the round-tripped messages, holds what the side panel sent', () => {
    const overlayListeners = new Set<(m: unknown) => void>();
    const overlayPort: WirePort = {
      post: () => {},
      onMessage: (listener) => { overlayListeners.add(listener); return () => { overlayListeners.delete(listener); }; },
      onDisconnect: () => () => {},
      close: () => {},
    };
    const panelPort: WirePort = {
      post: (message) => { overlayListeners.forEach((listener) => listener(roundTrip(message))); },
      onMessage: () => () => {},
      onDisconnect: () => () => {},
      close: () => {},
    };
    const received = receiveSubtitles(overlayPort);
    publishSubtitles(panelPort, {
      entries: box<readonly Entry[]>([exchange, notice]),
      session: box(sessions[1]),
      karaoke: box<KaraokeState>({ lit: new Map([['r:speaker:1', 7]]), replaying: null }),
      language: box('ja'),
    }, controls());
    expect(received.get()).toEqual({ entries: [exchange, notice], session: sessions[1], lit: new Map([['r:speaker:1', 7]]), language: 'ja' });
  });

  it('every control the overlay sends survives a round trip', () => {
    const sent: unknown[] = [];
    const port: WirePort = {
      post: (message) => { sent.push(message); },
      onMessage: () => () => {},
      onDisconnect: () => () => {},
      close: () => {},
    };
    const received = receiveSubtitles(port);
    const messages: ToPanel[] = [
      { type: 'subtitle:request-clear' },
      { type: 'subtitle:user-exit' },
      { type: 'subtitle:turn-press' },
      { type: 'subtitle:turn-release' },
    ];
    messages.forEach((m) => received.send(m));
    expect(sent).toEqual(messages);
    for (const m of sent) expect(roundTrip(m)).toEqual(m);
  });

  it('the check catches what JSON loses, so toEqual is strict enough to trust above', () => {
    expect(roundTrip({ lit: new Map([['a', 1]]) })).not.toEqual({ lit: new Map([['a', 1]]) });
    expect(roundTrip({ pcm: Int16Array.of(1, 2) })).not.toEqual({ pcm: Int16Array.of(1, 2) });
    expect(roundTrip({ at: new Date(0) })).not.toEqual({ at: new Date(0) });
    expect(roundTrip({ n: Number.NaN })).not.toEqual({ n: Number.NaN });
  });
});
