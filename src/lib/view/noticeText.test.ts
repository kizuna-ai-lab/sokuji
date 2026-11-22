import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import i18next from 'i18next';
import en from '../../locales/en/translation.json';
import { APP_CAPTURE_LOST, APP_MONITOR_MISSING, LOOPBACK_DENIED, SILENT_NO_PERMISSION } from '../audio/capture/systemAudio';
import { MIC_LOST_USING_OTHER, MIC_LOST_WAITING, MIC_NOW_USING } from '../audio/capture/mic';
import { MIC_BLOCKED, MIC_IN_USE, MIC_UNREADABLE } from '../audio/capture/micFailure';
import { CLIENT_DIAGNOSTICS } from '../diagnostics/clientDiagnostics';
import { refusalNotice } from '../plan/checks';
import { PLAN_REFUSAL_CODES } from '../plan/types';
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

  it('names the microphone that would not open on Windows, and who is using it (spec 2026-10-13 §3)', () => {
    expect(noticeText(plainT, { code: MIC_IN_USE, message: 'x', params: { device: 'Microphone (AU05)', apps: 'Zoom Meetings' } }))
      .toBe('The microphone “Microphone (AU05)” is in use by Zoom Meetings. Close Zoom Meetings and start again, or choose another microphone.');
    expect(noticeText(plainT, { code: MIC_UNREADABLE, message: 'x', params: { device: 'Microphone (AU05)' } }))
      .toMatch(/^Windows could not open the microphone “Microphone \(AU05\)”\./);
    expect(noticeText(plainT, { code: MIC_BLOCKED, message: 'x' })).toMatch(/^Windows is not letting Sokuji use the microphone\./);
  });

  describe('a line-up that cannot run', () => {
    /** A catalog of one language: the stage and service names a locale has, the sentences as their English. */
    const names: Record<string, string> = { 'settingsPage.lineup.stages.speech': 'Speech', 'settingsPage.lineup.stages.translation': 'Translation', 'providers.kizunaai_soniox.name': 'KizunaAI', 'providers.soniox.name': 'Soniox' };
    const catalogT = ((key: string, options: Record<string, unknown>) =>
      String(names[key] ?? options.defaultValue).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name]))) as unknown as TFunction;
    const words = (refusal: Parameters<typeof refusalNotice>[0], ...rest: unknown[]) => noticeText(catalogT, refusalNotice(refusal, ...(rest as [])));

    it('names the stage as it reads inside a sentence', () => {
      expect(words({ refused: 'lineup_incomplete', stage: 'speech' })).toBe('Choose a service for speech first.');
    });
    it("names the service by the line-up page's name, a managed one with its engine, Bing and Edge by theirs", () => {
      const kizuna = { id: 'kizunaai_soniox', kind: 'managed', vendor: 'Soniox' };
      expect(words({ refused: 'lineup_voice_not_alone', stage: 'speech', provider: 'kizunaai_soniox' }, null, [kizuna]))
        .toBe('Use KizunaAI (Soniox) for transcription and translation, or choose another speech service.');
      expect(words({ refused: 'lineup_not_offered', stage: 'translation', provider: 'soniox' })).toBe('Soniox is not available in this version. Choose another service for translation.');
      expect(words({ refused: 'lineup_voice_not_taken', stage: 'speech', provider: 'gemini' }))
        .toBe('Choose gemini for speech too, or choose another service for transcription and translation.');
    });
    it('names the language the way every language menu does', () => {
      expect(words({ refused: 'lineup_language_not_spoken', stage: 'speech', provider: 'edge', language: 'eu' }))
        .toBe(`Edge has no voice for ${languageLabel('eu', 'en')}. Choose another speech service, or turn speech off for this session.`);
    });
    it('another service that translates: it names the service, the pair by its languages\' names, and the words of the menus it points to', () => {
      expect(words({ refused: 'lineup_source_not_fixed', stage: 'translation', provider: 'bing' }))
        .toBe('Bing needs to know the spoken language. Choose it instead of “Auto Detect”, or choose another translation service.');
      expect(words({ refused: 'lineup_pair_not_translated', stage: 'translation', provider: 'bing', source: 'eu', target: 'ja' }))
        .toBe(`Bing does not translate ${languageLabel('eu', 'en')} into ${languageLabel('ja', 'en')}. Choose other languages, or another translation service.`);
      expect(words({ refused: 'lineup_face_to_face_apart', stage: 'translation', provider: 'soniox' }))
        .toBe('Face-to-face needs one service to transcribe and translate. Choose Soniox for translation too, or set “Other side” to “In a meeting”.');
    });
    it("a translation bound to its own transcription says which stage to change; an end-to-end service's split stages keep their sentence", () => {
      expect(words({ refused: 'lineup_translation_bound', stage: 'transcription', provider: 'soniox' }))
        .toBe('Soniox translation requires Soniox transcription. Choose Soniox for transcription, or choose another translation service.');
      expect(words({ refused: 'lineup_stage_split', stage: 'translation', provider: 'gemini' }))
        .toBe('gemini must also do translation. Choose gemini for translation, or use another service instead of gemini.');
      expect(String(at(catalogs['../../locales/zh_CN/translation.json'], 'notices.lineup_translation_bound')))
        .toBe('{{provider}} 翻译需要搭配 {{provider}} 转写。请选择 {{provider}} 转写，或更换翻译服务。');
    });
    it("the words a sentence quotes from a menu are that locale's own, in every locale", () => {
      for (const [path, catalog] of Object.entries(catalogs)) {
        const text = (key: string) => String(at(catalog, key));
        expect(text('notices.lineup_source_not_fixed'), path).toContain(text('common.autoDetect'));
        expect(text('notices.lineup_face_to_face_apart'), path).toContain(text('popover.otherSide'));
        expect(text('notices.lineup_face_to_face_apart'), path).toContain(text('popover.otherSideMeeting'));
      }
    });
    it('has a sentence for every refusal, the same in the English catalog', () => {
      const enNotices = (en as unknown as { notices: Record<string, string> }).notices;
      for (const code of PLAN_REFUSAL_CODES) {
        expect(NOTICE_WORDS[code], code).toBeDefined();
        expect(enNotices[code], code).toBe(NOTICE_WORDS[code]);
      }
    });
    it('leaves a stage or provider param of any other notice as it is', () => {
      const capture = ((key: string, options: Record<string, unknown>) => `${key}:${String(options.stage)}:${String(options.provider)}`) as unknown as TFunction;
      expect(noticeText(capture, { code: 'source_ended', message: 'x', params: { stage: 'speech', provider: 'soniox' } })).toBe('notices.source_ended:speech:soniox');
    });
  });

  it('puts the five API error types into words', () => {
    for (const code of ['auth', 'rate_limit', 'network', 'server', 'client']) {
      expect(NOTICE_WORDS[code]).toBeDefined();
      expect(noticeText(t, { code, message: 'HTTP 401' })).toContain('HTTP 401');
    }
  });

  it("puts a text model's refusals into words: its own five, and a refused request as any other's", () => {
    for (const code of ['model_missing', 'quota', 'address_invalid']) expect(noticeText(t, { code, message: 'the service said so' }), code).toContain('the service said so');
    expect(noticeText(t, { code: 'text_model_unset', message: 'x' })).toContain(NOTICE_WORDS.text_model_unset);
    expect(noticeText(t, { code: 'address_missing', message: 'x' })).toContain(NOTICE_WORDS.address_missing);
    expect(NOTICE_ALIASES.refused).toBe('notices.client');
  });

  it('has words for every code the runner, the capture and the adapters record', () => {
    for (const code of [...RUN_NOTICE_CODES, ...Object.keys(CLIENT_DIAGNOSTICS), APP_CAPTURE_LOST, APP_MONITOR_MISSING, SILENT_NO_PERMISSION, LOOPBACK_DENIED, MIC_LOST_USING_OTHER, MIC_LOST_WAITING, MIC_NOW_USING, MIC_IN_USE, MIC_UNREADABLE, MIC_BLOCKED, NO_MICROPHONE]) {
      // An adapter's code may be worded by an alias instead (never both: see below).
      expect(NOTICE_WORDS[code] ?? NOTICE_ALIASES[code], code).toBeDefined();
    }
  });

  it("words a key whose account may not use the model in the key's region, Qwen's own words as the detail (probe 2026-10-23)", () => {
    const qwen = '[Qwen AccessDenied.Unpurchased] Access to model denied. Please make sure you are eligible for using the model.';
    expect(noticeText(plainT, { code: 'model_access_denied', message: qwen })).toBe(
      "The key works, but its account can't use this model in the key's region. Enable the model for that region in the provider's console, or use a key from a region where it is enabled: " + qwen,
    );
  });

  it("words Qwen's passing request rate as the limit's own sentence, its words as the detail", () => {
    const qwen = '[Qwen Throttling] Requests rate limit exceeded, please try again later.';
    expect(noticeText(t, { code: 'throttled', message: qwen })).toBe(`notices.rate_limit|${qwen}`);
    // The catalog's sentence takes the message as {{detail}}, so the detail itself must reach the translator.
    const detailOnly = ((key: string, options: Record<string, unknown>) => `${key}:${String(options.detail)}`) as unknown as TFunction;
    expect(noticeText(detailOnly, { code: 'throttled', message: qwen })).toBe(`notices.rate_limit:${qwen}`);
    const enCatalog = en as unknown as Record<string, unknown>;
    expect(at(enCatalog, NOTICE_ALIASES.throttled)).toBe(NOTICE_WORDS.rate_limit);
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

  it("words a managed lease's refusal by what blocked it: a session elsewhere, or the previous one still ending", () => {
    expect(noticeText(t, { code: 'session_in_use', message: 'x' }))
      .toBe('notices.session_in_use|Another window or device is using this account. Stop the session there, or if Sokuji just closed unexpectedly, try again in a minute.');
    expect(noticeText(t, { code: 'previous_session_ending', message: 'x' }))
      .toBe('notices.previous_session_ending|Your previous session is still ending. Please try again in a minute.');
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

  it('words what History could not save, and no longer vouches for the transcript when the recording stops', () => {
    const t = ((key: string, opts?: { defaultValue?: string }) => `${key}|${opts?.defaultValue ?? ''}`) as unknown as import('i18next').TFunction;
    expect(noticeText(t, { code: 'history_transcript_stopped', message: 'm' })).toBe('history.transcriptStopped|m');
    const enCatalog = en as unknown as Record<string, unknown>;
    expect(at(enCatalog, NOTICE_ALIASES.history_transcript_stopped)).toBe('Part of this session’s transcript could not be saved: it could not be written to disk.');
    expect(at(enCatalog, NOTICE_ALIASES.history_recording_stopped)).toBe('The recording of this session stopped: it could not be written to disk.');
  });

  it("puts the local engines' notices into words", () => {
    for (const code of ['no_asr', 'memory_exceeded', 'gpu_out_of_memory', 'transcription_failed', 'translation_failed', 'translation_unavailable']) {
      expect(NOTICE_WORDS[code]).toBeDefined();
    }
  });

  it("words local inference's text-only warnings, naming the target language as every language menu does (#619)", () => {
    expect(noticeText(t, { code: 'speaker_tts_missing', params: { target: 'ja' }, message: 'x' }))
      .toBe(`notices.speaker_tts_missing|Translation the other side hears is text only: no speech model speaks ${languageLabel('ja', i18next.language)}.`);
    expect(noticeText(t, { code: 'participant_tts_missing', params: { target: 'en' }, message: 'x' }))
      .toBe(`notices.participant_tts_missing|Translation I hear is text only: no speech model speaks ${languageLabel('en', i18next.language)}.`);
    expect(noticeText(t, { code: 'participant_tts_over_budget', message: 'x' }))
      .toBe("notices.participant_tts_over_budget|Translation I hear is text only: not enough memory to load the other side's speech model too.");
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

it("en carries the replay-blocked sentence, word for word", () => {
  const enCatalog = en as unknown as Record<string, unknown>;
  expect(at(enCatalog, 'mainPanel.replayBlockedWholeSystem')).toBe("Replay is off while Other's audio captures all system sound: it would be translated again.");
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

it("a managed Qwen lease's refusal names Qwen, and a region the backend cannot serve says so, word for word in en", () => {
  const enCatalog = en as unknown as Record<string, unknown>;
  const sentences: Record<string, string> = {
    qwen_service_unavailable: 'Qwen is temporarily unavailable. Please try again in a moment.',
    qwen_service_busy: 'Qwen is at capacity right now. Please try again shortly.',
    qwen_region_unavailable: 'Kizuna Qwen is not available in the region you picked right now. Choose another region, or try again later.',
  };
  for (const [code, sentence] of Object.entries(sentences)) {
    expect(NOTICE_ALIASES[code], code).toBeDefined();
    expect(at(enCatalog, NOTICE_ALIASES[code]), code).toBe(sentence);
  }
});

it('two Kizuna AI services in one line-up: every locale names Kizuna AI as it is, and nothing is left to fill in', () => {
  expect(Object.keys(catalogs)).toHaveLength(30);
  expect(NOTICE_WORDS.lineup_two_managed).toBe('Two Kizuna AI services cannot run in one session yet. Choose one of them.');
  const notice = refusalNotice({ refused: 'lineup_two_managed', stage: 'speech' });
  for (const [path, catalog] of Object.entries(catalogs)) {
    // The locale's own catalog, filled as i18next fills it: a name it is not given stays as written.
    const localeT = ((key: string, options: Record<string, unknown>) =>
      String(at(catalog, key) ?? options.defaultValue).replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) => (name in options ? String(options[name]) : whole))) as unknown as TFunction;
    const text = noticeText(localeT, notice);
    expect(text, path).toBe(at(catalog, 'notices.lineup_two_managed'));
    expect(text, path).toContain('Kizuna AI');
    expect(text, path).not.toMatch(/\{\{|\}\}/);
  }
});

it("a signed-out managed provider reads the sign-in sentence, word for word in en", () => {
  expect(at(en as unknown as Record<string, unknown>, NOTICE_ALIASES.sign_in_required)).toBe("Sign in to use Kizuna AI's built-in translation service.");
});

describe('organization refusal notices', () => {
  const org = { organization: 'Acme' };
  it('words a balance held by sessions in progress', () => {
    expect(noticeText(plainT, { code: 'org_balance_held', message: 'x', params: org }))
      .toBe("Your organization's balance is held by sessions in progress. Try again when one ends, or use your own balance.");
  });
  it('tells a member to ask the owner to top up, and the owner to top up', () => {
    expect(noticeText(plainT, { code: 'org_insufficient_balance', message: 'x', params: { ...org, role: 'member' } }))
      .toBe("Ask the organization's owner to top up, or use your own balance.");
    expect(noticeText(plainT, { code: 'org_insufficient_balance', message: 'x', params: { ...org, role: 'owner' } }))
      .toBe('Top up Acme, or use your own balance.');
  });
  it('says a removed member is no longer in the organization', () => {
    expect(noticeText(plainT, { code: 'not_org_member', message: 'x', params: org })).toBe("You're no longer in Acme.");
  });
  it('words a frozen organization by role: a member contacts the owner, the owner contacts support', () => {
    expect(noticeText(plainT, { code: 'org_wallet_frozen', message: 'x', params: { ...org, role: 'member' } }))
      .toBe("Acme's account is paused. Contact its owner, or use your own balance.");
    expect(noticeText(plainT, { code: 'org_wallet_frozen', message: 'x', params: { ...org, role: 'owner' } }))
      .toBe("Acme's account is paused. Contact Sokuji support, or use your own balance.");
  });
  it('does not crash on a stale quota with no organization', () => {
    expect(noticeText(plainT, { code: 'not_org_member', message: 'x' })).toBe("You're no longer in your organization.");
    expect(noticeText(plainT, { code: 'org_wallet_frozen', message: 'x' })).toBe("The organization's account is paused. Contact its owner, or use your own balance.");
  });
  it('keeps the owner wording when the name is missing, through the unnamed variant', () => {
    expect(noticeText(plainT, { code: 'org_wallet_frozen', message: 'x', params: { role: 'owner' } }))
      .toBe("The organization's account is paused. Contact Sokuji support, or use your own balance.");
  });
  it('words an owner with no organization name as the owner, so the text matches the Top up action', () => {
    expect(noticeText(plainT, { code: 'org_insufficient_balance', message: 'x', params: { role: 'owner' } }))
      .toBe('Top up your organization, or use your own balance.');
    expect(noticeText(plainT, { code: 'org_insufficient_balance', message: 'x' }))
      .toBe("Ask the organization's owner to top up, or use your own balance.");
  });
  it('has the words in every locale', () => {
    for (const [path, catalog] of Object.entries(catalogs)) {
      for (const key of ['org_balance_held', 'org_insufficient_balance', 'org_insufficient_balance_owner', 'org_insufficient_balance_owner_unnamed', 'not_org_member', 'org_wallet_frozen', 'org_wallet_frozen_owner', 'not_org_member_unnamed', 'org_wallet_frozen_unnamed', 'org_wallet_frozen_owner_unnamed']) {
        expect(at(catalog, `notices.${key}`), `${path}: ${key}`).toBeTypeOf('string');
      }
    }
  });
});
