import { describe, it, expect } from 'vitest';
import { pairSentence } from './languageSentence';
import type { PairSentenceInput } from './languageSentence';

const at = (patch: Partial<PairSentenceInput>) => pairSentence({
  mode: 'speaker', textOnly: false, capability: 'optional', source: 'en', target: 'ja', ...patch,
});
const keys = (s: ReturnType<typeof pairSentence>) => [s.my.key, s.their.key];

describe('pairSentence', () => {
  it('reads the other side in participant mode', () => {
    expect(keys(at({ mode: 'participant', textOnly: true })))
      .toEqual(['settings.langSentence.iRead', 'settings.langSentence.theySpeak']);
    // The participant leg never speaks, so the toggle cannot change this half.
    expect(keys(at({ mode: 'participant', textOnly: false, capability: 'never' })))
      .toEqual(['settings.langSentence.iRead', 'settings.langSentence.theySpeak']);
  });

  it('speaks to the other side unless the caller resolved text-only', () => {
    expect(keys(at({}))).toEqual(['settings.langSentence.iSpeak', 'settings.langSentence.theyHear']);
    expect(keys(at({ textOnly: true }))).toEqual(['settings.langSentence.iSpeak', 'settings.langSentence.theyRead']);
  });

  it('lets the provider overrule the caller, both ways', () => {
    // A provider that always speaks makes "they read" a lie...
    expect(at({ textOnly: true, capability: 'never' }).their.key).toBe('settings.langSentence.theyHear');
    // ...and one that cannot speak makes "they hear" one.
    expect(at({ textOnly: false, capability: 'always' }).their.key).toBe('settings.langSentence.theyRead');
  });

  it('states the forward leg of both mode from the speaker side', () => {
    expect(keys(at({ mode: 'both' }))).toEqual(['settings.langSentence.iSpeak', 'settings.langSentence.theyHear']);
  });

  it('mirrors only a both-mode pair it can name', () => {
    expect(at({ mode: 'both' }).showMirror).toBe(true);
    expect(at({ mode: 'speaker' }).showMirror).toBe(false);
    expect(at({ mode: 'participant' }).showMirror).toBe(false);
    // 'auto' names no language, so the reverse leg cannot be stated.
    expect(at({ mode: 'both', source: 'auto' }).showMirror).toBe(false);
    expect(at({ mode: 'both', source: null }).showMirror).toBe(false);
    expect(at({ mode: 'both', target: '' }).showMirror).toBe(false);
  });
});
