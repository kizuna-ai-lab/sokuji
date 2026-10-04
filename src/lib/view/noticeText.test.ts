import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import en from '../../locales/en/translation.json';
import { APP_CAPTURE_LOST, APP_MONITOR_MISSING, LOOPBACK_DENIED, SILENT_NO_PERMISSION } from '../audio/capture/systemAudio';
import { MIC_LOST_USING_OTHER, MIC_LOST_WAITING, MIC_NOW_USING } from '../audio/capture/mic';
import { CLIENT_DIAGNOSTICS } from '../diagnostics/clientDiagnostics';
import { RUN_NOTICE_CODES } from '../session/codes';
import { NO_MICROPHONE } from '../session/shape';
import { languageLabel } from '../language/label';
import { NOTICE_ALIASES, NOTICE_WORDS, noticeText } from './noticeText';

/** A stand-in for i18next: fills `{{name}}` from the options. */
const t = ((key: string, options: Record<string, unknown>) =>
  `${key}|${String(options.defaultValue).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name]))}`) as unknown as TFunction;

/** A stand-in that just interpolates, with no key prefix — the shape a real
 * catalog lookup returns. */
const plainT = ((_key: string, options: Record<string, unknown>) =>
  String(options.defaultValue).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name]))) as unknown as TFunction;

describe('noticeText', () => {
  it("looks a known code up, with the notice's own message as its detail", () => {
    expect(noticeText(t, { code: 'leg_failed', message: 'Invalid API key' })).toBe('notices.leg_failed|The session stopped: Invalid API key');
  });

  it('passes the params through', () => {
    const words = noticeText(((key: string, options: Record<string, unknown>) => `${key}:${String(options.minutes)}`) as unknown as TFunction, { code: 'source_ended', message: 'x', params: { minutes: 3 } });
    expect(words).toBe('notices.source_ended:3');
  });

  it('shows the message itself for a code it has no words for, or no code', () => {
    expect(noticeText(t, { code: 'fake_build_refused', message: 'The fake refuses to build (fault knob).' })).toBe('The fake refuses to build (fault knob).');
    expect(noticeText(t, { message: 'plain' })).toBe('plain');
  });

  it("words an alias code with the sentence its key already has, the diagnostic message as the fallback", () => {
    expect(noticeText(t, { code: 'sign_in_required', message: 'Signed out.' })).toBe('auth.signedOut|Signed out.');
  });

  it('names a source/target language param the way every language menu does, and leaves other params alone', () => {
    expect(noticeText(plainT, { code: 'no_asr', message: 'x', params: { source: 'en' } })).toBe(`No speech recognition model is installed for ${languageLabel('en', 'en')}.`);
    expect(noticeText(plainT, { code: 'no_asr', message: 'x', params: { source: 'ja' } })).toBe(`No speech recognition model is installed for ${languageLabel('ja', 'en')}.`);
    // A code that is not a language is not named.
    expect(noticeText(plainT, { code: 'no_asr', message: 'x', params: { source: 'xx' } })).toBe('No speech recognition model is installed for xx.');
    // A param that isn't `source`/`target` (a detail-style one) is untouched —
    // not named, unlike `source`/`target` above.
    const capture = ((key: string, options: Record<string, unknown>) => `${key}:${String(options.device)}`) as unknown as TFunction;
    expect(noticeText(capture, { code: 'source_ended', message: 'x', params: { device: 'USB microphone' } })).toBe('notices.source_ended:USB microphone');
  });

  it("names the microphone's devices in its notices", () => {
    expect(noticeText(plainT, { code: 'mic_lost_using_other', message: 'x', params: { lost: 'AirPods', device: 'MacBook Microphone' } }))
      .toBe('The microphone “AirPods” went away, so “MacBook Microphone” is being used instead.');
    expect(noticeText(plainT, { code: 'mic_now_using', message: 'x', params: { device: 'AirPods' } })).toBe('Now using the microphone “AirPods”.');
  });

  it('puts the five API error types into words', () => {
    for (const code of ['auth', 'rate_limit', 'network', 'server', 'client']) {
      expect(NOTICE_WORDS[code]).toBeDefined();
      expect(noticeText(t, { code, message: 'HTTP 401' })).toContain('HTTP 401');
    }
  });

  it('has words for every code the runner, the capture and the adapters record', () => {
    for (const code of [...RUN_NOTICE_CODES, ...Object.keys(CLIENT_DIAGNOSTICS), APP_CAPTURE_LOST, APP_MONITOR_MISSING, SILENT_NO_PERMISSION, LOOPBACK_DENIED, MIC_LOST_USING_OTHER, MIC_LOST_WAITING, MIC_NOW_USING, NO_MICROPHONE]) {
      // An adapter's code may be worded by an alias instead (never both: see below).
      expect(NOTICE_WORDS[code] ?? NOTICE_ALIASES[code], code).toBeDefined();
    }
  });

  it("words speech's two failures with the sentences every locale already has", () => {
    expect(noticeText(t, { code: 'tts_segment_lost', message: 'x' })).toMatch(/^mainPanel\.sonioxTtsSegmentLost\|/);
    expect(noticeText(t, { code: 'tts_stopped', message: 'x' })).toMatch(/^mainPanel\.sonioxTtsFailed\|/);
    const enCatalog = en as unknown as Record<string, unknown>;
    expect(at(enCatalog, NOTICE_ALIASES.tts_segment_lost)).toBe('Part of the spoken translation could not be played. Transcription and text translation are unaffected.');
    expect(at(enCatalog, NOTICE_ALIASES.tts_stopped)).toBe('Spoken translation has stopped. Transcription and text translation are still running.');
  });

  it("words Kizuna Soniox's codes with the sentences every locale already has", () => {
    const enCatalog = en as unknown as Record<string, unknown>;
    const sentences: Record<string, string> = {
      soniox_service_unavailable: 'Soniox is temporarily unavailable. Please try again in a moment.',
      soniox_service_busy: 'Soniox is at capacity right now. Please try again shortly.',
      voice_clip_missing: 'This device has no voice recording, so this session uses a built-in voice. Record one in Settings to speak in your own voice here.',
      voice_pool_busy: 'All custom voice slots are in use right now, so this session uses a built-in voice. Your own voice will be used again next time.',
      voice_build_failed: 'Your custom voice could not be built, so this session uses a built-in voice. Try recording a clearer clip in Settings.',
      voice_unavailable: 'Your custom voice is unavailable right now, so this session uses a built-in voice.',
      balance_below_floor: 'Insufficient balance: {{balance}}',
      sign_in_pending: 'Checking...',
      quota_pending: 'Checking...',
      quota_unknown: 'Unable to load quota information',
    };
    for (const [code, sentence] of Object.entries(sentences)) {
      expect(NOTICE_ALIASES[code], code).toBeDefined();
      expect(at(enCatalog, NOTICE_ALIASES[code]), code).toBe(sentence);
    }
    // The gate's balance reaches the sentence's `{{balance}}`: seen through a `t` that shows the param it was handed.
    const balance = ((key: string, options: Record<string, unknown>) => `${key}:${String(options.balance)}`) as unknown as TFunction;
    const words = noticeText(balance, { code: 'balance_below_floor', params: { balance: '$0.01' }, message: 'x' });
    expect(words).toContain('mainPanel.insufficientBalance');
    expect(words).toContain('$0.01');
  });

  it("words Gemini's two model codes with the old client's sentences, which every locale already has", () => {
    const enCatalog = en as unknown as Record<string, unknown>;
    expect(noticeText(t, { code: 'no_realtime_model', message: 'x' })).toMatch(/^settings\.realtimeModelNotAvailable\|/);
    expect(noticeText(t, { code: 'models_required', message: 'x' })).toMatch(/^mainPanel\.modelsRequired\|/);
    expect(at(enCatalog, NOTICE_ALIASES.no_realtime_model)).toBe('Realtime model is not available');
    expect(at(enCatalog, NOTICE_ALIASES.models_required)).toBe('Models are required. Please validate your API key first to load available models.');
  });

  it("words OpenAI Translate's two check codes with the old validation's sentences, which every locale already has", () => {
    const enCatalog = en as unknown as Record<string, unknown>;
    expect(noticeText(t, { code: 'no_translate_model', message: 'x' })).toMatch(/^settings\.translateModelNotAvailable\|/);
    expect(noticeText(t, { code: 'region_unsupported', message: 'x' })).toMatch(/^settings\.regionNotSupported\|/);
    expect(at(enCatalog, NOTICE_ALIASES.no_translate_model)).toBe('API key works, but gpt-realtime-translate is not accessible with this key.');
    expect(at(enCatalog, NOTICE_ALIASES.region_unsupported)).toBe('Service not available in your region. Please check your network environment or try a different provider.');
  });

  it('words the panel notes by the export keys (spec 2026-10-05 §5)', () => {
    const t = ((key: string, opts?: { defaultValue?: string }) => `${key}|${opts?.defaultValue ?? ''}`) as unknown as import('i18next').TFunction;
    expect(noticeText(t, { code: 'export_copied', message: 'copied' })).toBe('mainPanel.export.copySuccess|copied');
    expect(noticeText(t, { code: 'export_copy_failed', message: 'failed' })).toBe('mainPanel.export.copyFailed|failed');
    expect(noticeText(t, { code: 'autosave_saved', message: 'saved' })).toBe('mainPanel.export.autoSave.saved|saved');
    expect(noticeText(t, { code: 'autosave_failed', message: 'failed' })).toBe('mainPanel.export.autoSave.failed|failed');
  });

  it("puts the local engines' notices into words", () => {
    for (const code of ['no_asr', 'memory_exceeded', 'gpu_out_of_memory', 'transcription_failed', 'translation_failed', 'translation_unavailable']) {
      expect(NOTICE_WORDS[code]).toBeDefined();
    }
  });

  it('matches the English locale word for word', () => {
    expect((en as unknown as { notices: Record<string, string> }).notices).toEqual(NOTICE_WORDS);
  });
});

const COPIES = {
  local_models_missing: 'mainPanel.localModelsRequired',
  no_microphone: 'modePicker.missingDevice',
  silent_no_permission: 'audioPanel.participantNoAudioYet',
  loopback_denied: 'audioPanel.screenRecordingDeniedText1',
} as const;
const at = (tree: unknown, path: string) => path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], tree);
const catalogs = import.meta.glob('../../locales/*/translation.json', { eager: true, import: 'default' });
it('words the four new codes with a sentence every locale already has', () => {
  expect(Object.keys(catalogs)).toHaveLength(30);
  for (const [path, catalog] of Object.entries(catalogs)) {
    for (const [code, key] of Object.entries(COPIES)) {
      expect(at(catalog, `notices.${code}`), `${path}: ${code}`).toBe(at(catalog, key));
    }
  }
});

it("en carries the four new sentences, word for word", () => {
  const enCatalog = en as unknown as Record<string, unknown>;
  expect(at(enCatalog, 'mainPanel.replayBlockedWholeSystem')).toBe("Replay is off while Other's audio captures all system sound: it would be translated again.");
  expect(at(enCatalog, 'audioPanel.participantSpeech')).toBe("Speak Other's translation");
  expect(at(enCatalog, 'audioPanel.participantSpeechDesc')).toBe("Reads what Other says aloud to you, in your language, on your speakers. It follows their voice with a delay.");
  expect(at(enCatalog, 'audioPanel.participantSpeechBlockedWholeSystem')).toBe("Off while Other's audio captures all system sound: their translation would be captured and translated again. Pick an application as Other's source.");
});

it('no code is both an alias and worded under notices', () => {
  expect(Object.keys(NOTICE_ALIASES).filter((code) => code in NOTICE_WORDS)).toEqual([]);
});

it('every alias names a sentence in all 30 locales', () => {
  expect(Object.keys(catalogs)).toHaveLength(30);
  for (const [path, catalog] of Object.entries(catalogs)) {
    for (const [code, key] of Object.entries(NOTICE_ALIASES)) {
      expect(at(catalog, key), `${path}: ${code}`).toBeTypeOf('string');
      expect(at(catalog, key), `${path}: ${code}`).not.toBe('');
    }
  }
});

it("a signed-out managed provider reads the sign-in sentence, word for word in en", () => {
  expect(at(en as unknown as Record<string, unknown>, NOTICE_ALIASES.sign_in_required)).toBe("Sign in to use Kizuna AI's built-in translation service.");
});
