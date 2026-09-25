import { describe, expect, it } from 'vitest';
import { currentSubtitleFeed, registerSubtitleFeed, type SubtitleFeed } from './subtitleFeed';

function stubFeed(): SubtitleFeed {
  const source = () => ({ get: () => null, subscribe: () => () => {} });
  return {
    sources: { entries: source(), session: source(), karaoke: source() } as unknown as SubtitleFeed['sources'],
    clear: () => {},
    press: () => {},
    release: () => {},
  };
}

describe('currentSubtitleFeed', () => {
  it('is null before any registration', () => {
    expect(currentSubtitleFeed()).toBeNull();
  });

  it('reads the registered feed, then null once unregistered', () => {
    const a = stubFeed();
    const off = registerSubtitleFeed(a);
    expect(currentSubtitleFeed()).toBe(a);
    off();
    expect(currentSubtitleFeed()).toBeNull();
  });

  it('leaves a newer registration alone when an older one unregisters', () => {
    const a = stubFeed();
    const b = stubFeed();
    const offA = registerSubtitleFeed(a);
    const offB = registerSubtitleFeed(b);
    offA();
    expect(currentSubtitleFeed()).toBe(b);
    offB();
    expect(currentSubtitleFeed()).toBeNull();
  });
});
