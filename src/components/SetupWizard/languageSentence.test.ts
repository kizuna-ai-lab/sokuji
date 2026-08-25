import { describe, it, expect } from 'vitest';
import { pairSentence } from './languageSentence';

const keys = (s: ReturnType<typeof pairSentence>) => [s.my.key, s.their.key];

describe('pairSentence', () => {
  it('reads the other side in participant mode', () => {
    expect(keys(pairSentence('participant', true, 'optional')))
      .toEqual(['settings.langSentence.iRead', 'settings.langSentence.theySpeak']);
    // The participant leg never speaks, so the toggle cannot change this half.
    expect(keys(pairSentence('participant', false, 'never')))
      .toEqual(['settings.langSentence.iRead', 'settings.langSentence.theySpeak']);
  });

  it('speaks to the other side unless the scenario asked for subtitles', () => {
    expect(keys(pairSentence('speaker', false, 'optional')))
      .toEqual(['settings.langSentence.iSpeak', 'settings.langSentence.theyHear']);
    expect(keys(pairSentence('speaker', true, 'optional')))
      .toEqual(['settings.langSentence.iSpeak', 'settings.langSentence.theyRead']);
  });

  it('lets the provider overrule the scenario, both ways', () => {
    // A provider that always speaks makes "they read" a lie...
    expect(pairSentence('speaker', true, 'never').their.key).toBe('settings.langSentence.theyHear');
    // ...and one that cannot speak makes "they hear" one.
    expect(pairSentence('speaker', false, 'always').their.key).toBe('settings.langSentence.theyRead');
  });

  it('flags the mirrored leg only for both mode', () => {
    expect(pairSentence('both', false, 'optional').showMirror).toBe(true);
    expect(pairSentence('speaker', false, 'optional').showMirror).toBe(false);
    expect(pairSentence('participant', true, 'optional').showMirror).toBe(false);
  });

  it('states the forward leg of both mode from the speaker side', () => {
    expect(keys(pairSentence('both', false, 'optional')))
      .toEqual(['settings.langSentence.iSpeak', 'settings.langSentence.theyHear']);
  });
});
