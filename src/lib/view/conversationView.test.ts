import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import type { Leg, Segment } from '../conversation/types';
import { DEFAULT_PROJECTION } from '../projection/project';
import type { ProjectionSettings } from '../projection/types';
import { createConversationView, VIEW_INTERVAL_MS, type Readable } from './conversationView';

const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../diagnostics/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../diagnostics/report')>()),
  reportError: reportErrorSpy,
}));

const segment = (text: string): Segment => ({ id: 's:speaker:1', ref: 1, side: 'source', text, final: true, openedAt: 0, marks: [], speech: [] });
const legWith = (text: string): Leg => ({ leg: 'speaker', session: 's', languages: { source: 'en', target: 'ja' }, segments: [segment(text)], notices: [] });

function conversation(initial: readonly Leg[]) {
  let legs = initial;
  const listeners = new Set<() => void>();
  return {
    snapshot: () => legs,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next: readonly Leg[]) { legs = next; listeners.forEach((listener) => listener()); },
    listening: () => listeners.size,
  };
}

function settings(initial: ProjectionSettings): Readable<ProjectionSettings> & { set(next: ProjectionSettings): void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next) { value = next; listeners.forEach((listener) => listener()); },
  };
}

const firstSourceTexts = (view: Readable<{ entries: readonly import('../projection/types').Entry[] }>) => {
  const entry = view.get().entries[0];
  return entry?.kind === 'exchange' ? entry.source.map((row) => row.text) : [];
};

describe('createConversationView', () => {
  it('projects the conversation at once', () => {
    const view = createConversationView(conversation([legWith('Hello.')]), settings(DEFAULT_PROJECTION), createVirtualClock(0));
    expect(firstSourceTexts(view)).toEqual(['Hello.']);
  });

  it('gathers changes and projects them once per interval', () => {
    const clock = createVirtualClock(0);
    const conv = conversation([legWith('He')]);
    const view = createConversationView(conv, settings(DEFAULT_PROJECTION), clock);
    const listener = vi.fn();
    view.subscribe(listener);
    conv.set([legWith('Hel')]);
    conv.set([legWith('Hello.')]);
    expect(listener).not.toHaveBeenCalled();
    clock.advance(VIEW_INTERVAL_MS);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(firstSourceTexts(view)).toEqual(['Hello.']);
  });

  it('re-projects when the settings change', () => {
    const clock = createVirtualClock(0);
    const cut = settings(DEFAULT_PROJECTION);
    const view = createConversationView(conversation([legWith('One. Two.')]), cut, clock);
    cut.set({ ...DEFAULT_PROJECTION, mode: 'sentences', sentencesPerRow: 1 });
    clock.advance(VIEW_INTERVAL_MS);
    expect(firstSourceTexts(view)).toEqual(['One.', ' Two.']);
  });

  it('tells no one when nothing it shows changed', () => {
    const clock = createVirtualClock(0);
    const legs = [legWith('Hello.')];
    const conv = conversation(legs);
    const view = createConversationView(conv, settings(DEFAULT_PROJECTION), clock);
    const listener = vi.fn();
    view.subscribe(listener);
    conv.set(legs);
    clock.advance(VIEW_INTERVAL_MS);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps telling the others when one listener throws', () => {
    const clock = createVirtualClock(0);
    const conv = conversation([legWith('a.')]);
    const view = createConversationView(conv, settings(DEFAULT_PROJECTION), clock);
    const after = vi.fn();
    view.subscribe(() => { throw new Error('boom'); });
    view.subscribe(after);
    conv.set([legWith('ab.')]);
    clock.advance(VIEW_INTERVAL_MS);
    expect(after).toHaveBeenCalledTimes(1);
    expect(reportErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('lets go of its sources when disposed', () => {
    const conv = conversation([legWith('a.')]);
    const view = createConversationView(conv, settings(DEFAULT_PROJECTION), createVirtualClock(0));
    view.dispose();
    expect(conv.listening()).toBe(0);
  });
});
