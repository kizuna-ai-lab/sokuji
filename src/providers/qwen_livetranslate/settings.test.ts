import { describe, it, expect } from 'vitest';
import { canonicalTag, parseCode } from '../../lib/language/code';
import { AUTO } from '../../lib/provider/languages';
import type { AuthContext } from '../../lib/provider/types';
import {
  QWEN_DEFAULTS, QWEN_LANGUAGES, QWEN_MODEL, QWEN_PAUSE, QWEN_SPOKEN, QWEN_VOICES, qwenCredentials, qwenLanguages, qwenParticipantVoice, qwenSpeakerVoice,
  SPEAKER_CLONE, SPEAKER_CLONE_ONCE,
} from './settings';

const signedOut: AuthContext = { signedIn: false, getToken: async () => null };
const codes = (list: readonly { value: string }[]) => list.map((o) => o.value);

describe("Qwen LiveTranslate's settings", () => {
  it('runs one model, and starts from two different presets, no hotwords and the server\'s own pause', () => {
    expect(QWEN_MODEL).toBe('qwen3.8-livetranslate-flash-realtime');
    expect(QWEN_DEFAULTS).toEqual({ voice: 'Tina', participantVoice: 'Ethan', hotwords: '', pauseMs: 2500 });
  });

  it('offers a pause from half a second to six, in tenths, the server default in range', () => {
    expect(QWEN_PAUSE).toEqual({ min: 500, max: 6000, step: 100, default: 2500 });
    expect(QWEN_DEFAULTS.pauseMs).toBe(QWEN_PAUSE.default);
  });

  it('lists the 47 presets in the vendor order, names sent verbatim, none named like the clone choice', () => {
    expect(QWEN_VOICES).toHaveLength(47);
    expect(new Set(QWEN_VOICES.map((v) => v.value)).size).toBe(47);
    expect(QWEN_VOICES.slice(0, 3).map((v) => v.value)).toEqual(['Tina', 'Cindy', 'Liora Mira']);
    expect(QWEN_VOICES[QWEN_VOICES.length - 1].value).toBe('Chloe');
    expect(QWEN_VOICES.map((v) => v.value)).toContain('Eliška');
    for (const v of QWEN_VOICES) {
      expect(v.name, v.value).toBe(v.value);
      expect(v.description, v.value).not.toBe('');
    }
    expect(QWEN_VOICES.map((v) => v.value)).not.toContain(SPEAKER_CLONE);
    expect(QWEN_VOICES.map((v) => v.value)).not.toContain(SPEAKER_CLONE_ONCE);
    expect(SPEAKER_CLONE_ONCE).not.toBe(SPEAKER_CLONE);
    expect(QWEN_VOICES.map((v) => v.value)).toContain(QWEN_DEFAULTS.voice);
    expect(QWEN_VOICES.map((v) => v.value)).toContain(QWEN_DEFAULTS.participantVoice);
  });

  it('runs my choice — a preset or the clone — and Tina for anything the list does not have', () => {
    expect(qwenSpeakerVoice({ voice: 'Serena' })).toBe('Serena');
    expect(qwenSpeakerVoice({ voice: SPEAKER_CLONE })).toBe(SPEAKER_CLONE);
    expect(qwenSpeakerVoice({ voice: SPEAKER_CLONE_ONCE })).toBe(SPEAKER_CLONE_ONCE);
    expect(qwenSpeakerVoice({ voice: 'Cherry' })).toBe('Tina');
    expect(qwenSpeakerVoice({ voice: '' })).toBe('Tina');
  });

  it("never gives the other party my preset, lets both legs clone, and runs Ethan for anything the list does not have", () => {
    expect(qwenParticipantVoice({ voice: 'Tina', participantVoice: 'Serena' })).toBe('Serena');
    expect(qwenParticipantVoice({ voice: 'Serena', participantVoice: 'Serena' })).toBe('Ethan');
    expect(qwenParticipantVoice({ voice: 'Ethan', participantVoice: 'Ethan' })).toBe('Tina');
    expect(qwenParticipantVoice({ voice: SPEAKER_CLONE, participantVoice: SPEAKER_CLONE })).toBe(SPEAKER_CLONE);
    expect(qwenParticipantVoice({ voice: SPEAKER_CLONE_ONCE, participantVoice: SPEAKER_CLONE_ONCE })).toBe(SPEAKER_CLONE_ONCE);
    expect(qwenParticipantVoice({ voice: 'Tina', participantVoice: SPEAKER_CLONE_ONCE })).toBe(SPEAKER_CLONE_ONCE);
    expect(qwenParticipantVoice({ voice: SPEAKER_CLONE, participantVoice: 'Tina' })).toBe('Tina');
    expect(qwenParticipantVoice({ voice: 'Tina', participantVoice: 'Cherry' })).toBe('Ethan');
    // A stale choice of mine falls to Tina first, so the other party still differs from what I run.
    expect(qwenParticipantVoice({ voice: 'Cherry', participantVoice: 'Tina' })).toBe('Ethan');
  });

  it('offers 60 canonical app codes, 29 of them spoken, each once', () => {
    expect(QWEN_LANGUAGES).toHaveLength(60);
    expect(QWEN_SPOKEN).toHaveLength(29);
    expect(new Set(codes(QWEN_LANGUAGES)).size).toBe(60);
    expect(codes(QWEN_LANGUAGES).slice(0, 29)).toEqual(codes(QWEN_SPOKEN));
    for (const code of codes(QWEN_LANGUAGES)) {
      expect(canonicalTag(code), code).toBe(code);
      expect(parseCode(code), code).not.toBeNull();
    }
    expect(codes(QWEN_SPOKEN)).toEqual(expect.arrayContaining(['zh', 'en', 'ja', 'ko', 'nb', 'fil', 'fa']));
    expect(codes(QWEN_LANGUAGES)).toEqual(expect.arrayContaining(['yue', 'uk', 'ast', 'ceb']));
    expect(codes(QWEN_SPOKEN)).not.toContain('uk');
    expect(codes(QWEN_LANGUAGES)).not.toContain('zh-TW');
  });

  it('offers Auto-detect and the 60 as sources, the 29 spoken targets to a speaking run and all 60 otherwise, through the identity wire', () => {
    const s = QWEN_DEFAULTS;
    expect(codes(qwenLanguages.sources(s))).toEqual([AUTO, ...codes(QWEN_LANGUAGES)]);
    expect(codes(qwenLanguages.sources(s, { speech: true }))).toEqual([AUTO, ...codes(QWEN_LANGUAGES)]);
    expect(codes(qwenLanguages.targets('zh', s, { speech: true }))).toEqual(codes(QWEN_SPOKEN));
    expect(codes(qwenLanguages.targets('zh', s, { speech: false }))).toEqual(codes(QWEN_LANGUAGES));
    expect(codes(qwenLanguages.targets('zh', s))).toEqual(codes(QWEN_LANGUAGES));
    expect(qwenLanguages.initial).toBeUndefined();
    expect(qwenLanguages.wire.toWire('fil')).toBe('fil');
  });

  it('reads one trimmed key, and an empty one as missing', () => {
    expect(qwenCredentials.keys).toEqual(['apiKey']);
    expect(qwenCredentials.fields(QWEN_DEFAULTS)).toEqual([{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }]);
    expect(qwenCredentials.read({ apiKey: '  sk-ws-T.ABCDEFGH.ijklmnop\n' }, signedOut)).toEqual({ apiKey: 'sk-ws-T.ABCDEFGH.ijklmnop' });
    expect(qwenCredentials.read({ apiKey: ' ' }, signedOut)).toEqual({ missing: 'Enter your Qwen API key.' });
  });
});
