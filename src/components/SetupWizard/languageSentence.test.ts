import { describe, it, expect } from 'vitest';
import { pairSentence } from './languageSentence';
import type { PairSentenceInput } from './languageSentence';

const at = (patch: Partial<PairSentenceInput>) => pairSentence({
  mode: 'speaker', textOnly: false, capability: 'optional', participantSpeaks: false, source: 'en', target: 'ja', ...patch,
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

  it('hears the other side when their translation is read aloud to me', () => {
    expect(keys(at({ mode: 'participant', participantSpeaks: true })))
      .toEqual(['settings.langSentence.iHear', 'settings.langSentence.theySpeak']);
    // My half of the forward leg is what I speak, whatever is read to me.
    expect(keys(at({ mode: 'speaker', participantSpeaks: true })))
      .toEqual(['settings.langSentence.iSpeak', 'settings.langSentence.theyHear']);
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

  it('mirrors with the verb of the reverse leg: I hear when it is read aloud to me, else I read', () => {
    expect(at({ mode: 'both' }).mirror.key).toBe('settings.langSentence.mirror');
    expect(at({ mode: 'both', participantSpeaks: true }).mirror.key).toBe('settings.langSentence.mirrorHear');
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
