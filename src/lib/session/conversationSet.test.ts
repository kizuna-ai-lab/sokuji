import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { Conversation } from '../conversation/Conversation';
import { ConversationSet } from './conversationSet';

const make = (leg: 'speaker' | 'participant', session: string) =>
  new Conversation({ leg, session, languages: { source: 'en', target: 'ja' }, clock: createVirtualClock() });

describe('ConversationSet', () => {
  it("lists the run's legs speaker first, and keeps the same array until a leg changes", () => {
    const set = new ConversationSet();
    const speaker = make('speaker', 'r1');
    set.replace(new Map([['participant', make('participant', 'r1')], ['speaker', speaker]]));
    const first = set.snapshot();
    expect(first.map((l) => l.leg)).toEqual(['speaker', 'participant']);
    expect(set.snapshot()).toBe(first);
    speaker.apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    expect(set.snapshot()).not.toBe(first);
  });

  it('tells subscribers about a leg change and about a new run', () => {
    const set = new ConversationSet();
    let heard = 0;
    set.subscribe(() => { heard++; });
    const speaker = make('speaker', 'r1');
    set.replace(new Map([['speaker', speaker]]));
    speaker.apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    set.replace(new Map([['speaker', make('speaker', 'r2')]]));
    speaker.apply({ kind: 'segmentOpened', payload: { ref: 2, side: 'source' } });
    expect(heard).toBe(3);
    expect(set.snapshot()[0].session).toBe('r2');
  });

  it('a subscriber that throws does not keep a later subscriber from hearing a change (F2)', () => {
    const set = new ConversationSet();
    set.subscribe(() => { throw new Error('buggy surface'); });
    let heard = 0;
    set.subscribe(() => { heard++; });
    const speaker = make('speaker', 'r1');
    set.replace(new Map([['speaker', speaker]]));
    speaker.apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    set.replace(new Map([['speaker', make('speaker', 'r2')]]));
    expect(heard).toBe(3);
  });

  it('clears every leg', () => {
    const set = new ConversationSet();
    const speaker = make('speaker', 'r1');
    set.replace(new Map([['speaker', speaker]]));
    speaker.apply({ kind: 'segmentOpened', payload: { ref: 1, side: 'source' } });
    speaker.apply({ kind: 'segmentClosed', payload: { ref: 1 } });
    set.clear();
    expect(set.snapshot()[0].segments).toEqual([]);
  });

  it("keeps the run's provider and models with the conversation, through a clear, until the next replace", () => {
    const set = new ConversationSet();
    expect(set.info).toBeNull();
    set.replace(new Map(), { provider: 'fake', models: { asrModel: 'a' } });
    set.clear();
    expect(set.info).toEqual({ provider: 'fake', models: { asrModel: 'a' } });
    set.replace(new Map(), { provider: 'other', models: {} });
    expect(set.info?.provider).toBe('other');
  });
});
