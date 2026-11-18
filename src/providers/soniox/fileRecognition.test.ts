// Soniox declares it can transcribe a saved recording, with the key of the region its settings name.
import { describe, it, expect } from 'vitest';
import { sonioxFileRecognitionBase, sonioxProvider } from './provider';
import { buildSoniox } from './config';
import { SONIOX_LANGUAGES } from './languages';
import type { SharedSettings } from '../../lib/provider/types';

describe('Soniox file recognition', () => {
  it('names the service, the region and that region’s key', () => {
    const spec = sonioxProvider.fileRecognition!;
    const settings = { ...sonioxProvider.settings.defaults, region: 'eu' as const };
    const named = { service: 'soniox', languageHint: expect.any(Function), languages: expect.any(Array) };
    expect(spec(settings, { apiKey: 'sk-us', apiKeyEu: ' sk-eu ', apiKeyJp: '', apiKeyIn: '' } as never)).toEqual({ ...named, apiKey: 'sk-eu', region: 'eu' });
    expect(spec({ ...settings, region: 'us' }, { apiKey: 'sk-us' } as never)).toEqual({ ...named, apiKey: 'sk-us', region: 'us' });
  });

  it('says the key is missing when the region has none', () => {
    expect(sonioxProvider.fileRecognition!({ ...sonioxProvider.settings.defaults, region: 'jp' }, { apiKey: 'sk-us' } as never)).toEqual({ missing: 'no-key' });
  });

  it('lists the languages it transcribes and translates files in: Soniox\u2019s own', () => {
    const spec = sonioxProvider.fileRecognition!({ ...sonioxProvider.settings.defaults, region: 'us' }, { apiKey: 'k' } as never);
    if ('missing' in spec) throw new Error('no spec');
    expect(spec.languages).toEqual(SONIOX_LANGUAGES.map((l) => l.value));
    expect(spec.languages).toEqual(expect.arrayContaining(['en', 'ja', 'zh']));
  });

  it('sends the word list as a live session sends it, and none when the list is empty', () => {
    const words = { entries: [{ written: 'Sokuji' }, { written: 'Kizuna', translation: '絆' }], background: 'A weekly meeting.' };
    const spec = sonioxProvider.fileRecognition!({ ...sonioxProvider.settings.defaults, region: 'us' }, { apiKey: 'k' } as never, words);
    if ('missing' in spec) throw new Error('no spec');
    expect(spec.context).toEqual({ terms: ['Sokuji', 'Kizuna'], translation_terms: [{ source: 'Kizuna', target: '絆' }], text: 'A weekly meeting.' });
    const live = buildSoniox(
      { direction: { source: 'en', target: 'ja' }, speech: false } as never,
      sonioxProvider.settings.defaults,
      { words, reversed: () => false } as unknown as SharedSettings,
    );
    expect(spec.context).toEqual(live.stt.context);
    const none = sonioxProvider.fileRecognition!({ ...sonioxProvider.settings.defaults, region: 'us' }, { apiKey: 'k' } as never, { entries: [], background: ' ' });
    if ('missing' in none) throw new Error('no spec');
    expect(none.context).toBeUndefined();
  });

  // Kizuna AI's Soniox builds its file recognition on the same parts, reached with the sign-in instead of the key.
  it('is the key and the region over what any Soniox file recognition asks with: the languages, their codes, the word list', () => {
    const words = { entries: [{ written: 'Sokuji' }], background: '' };
    const spec = sonioxProvider.fileRecognition!({ ...sonioxProvider.settings.defaults, region: 'us' }, { apiKey: 'k' } as never, words);
    expect(spec).toEqual({ service: 'soniox', apiKey: 'k', region: 'us', ...sonioxFileRecognitionBase(words) });
    expect(sonioxFileRecognitionBase()).not.toHaveProperty('context');
  });

  it('writes the app’s language codes as Soniox writes them, and drops what it does not know', () => {
    const spec = sonioxProvider.fileRecognition!({ ...sonioxProvider.settings.defaults, region: 'us' }, { apiKey: 'k' } as never);
    if ('missing' in spec) throw new Error('no spec');
    expect(spec.languageHint?.('fil')).toBe('tl');
    expect(spec.languageHint?.('ja')).toBe('ja');
    expect(spec.languageHint?.('xx')).toBeNull();
    // "Automatic" is no language to hint or translate into.
    expect(spec.languageHint?.('auto')).toBeNull();
  });
});
